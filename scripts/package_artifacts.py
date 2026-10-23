#!/usr/bin/env python3
"""Package VADTree experiment artifacts into GitHub Release bundles.

The repository deliberately does NOT track `result/` (see .gitignore): the
artifacts are distributed as release assets instead, so a clone stays small and
does not consume Git LFS quota. This script builds one `.tar.gz` per bundle and
writes `MANIFEST.json` which `scripts/fetch_artifacts.py` consumes.

Bundles are grouped by pipeline step (see README):

    1-2  GEBD boundaries + HGTree structure   (recomputable on CPU in minutes)
    3    LLaVA-Video node captions            (needed to re-run step 4)
    4    DeepSeek-R1 node scores              (NOT reproducible: temperature=0.6)
    5    ImageBind similarity matrices        (required by step 6, expensive to rebuild)
    6-7  refinement + inter-cluster ensemble  (recomputable on CPU in minutes)

Step 4 scores carry the full chain-of-thought text, which is ~95% of their size
and is never read downstream. Bundles flagged `strip` blank it out.

Usage:
    python scripts/package_artifacts.py                 # all bundles
    python scripts/package_artifacts.py --only step4-scores
    python scripts/package_artifacts.py --list
"""
import argparse
import gzip
import hashlib
import json
import os
import sys
import tarfile
import tempfile
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULT_ROOT = "result"
DIST_DIR = "dist"
MANIFEST = "MANIFEST.json"
COMPRESS_LEVEL = 4

BUNDLES = [
    {
        "name": "step1-2-boundaries-structure",
        "steps": [1, 2],
        "required": False,
        "strip": False,
        "description": "GEBD boundary confidences and HGTree coarse/fine/redundant nodes. "
                       "Reproducible on CPU in minutes from the videos.",
    },
    {
        "name": "step3-captions",
        "steps": [3],
        "required": True,
        "strip": False,
        "description": "LLaVA-Video-7B-Qwen2 node captions. Required to re-run step 4; "
                       "greedy decoding, but re-running needs the 7B checkpoint and the videos.",
    },
    {
        "name": "step4-scores",
        "steps": [4],
        "required": True,
        "strip": True,
        "description": "DeepSeek-R1-Distill-Qwen-14B node scores with the chain-of-thought "
                       "text stripped. Minimum input for steps 6-7. Sampled at temperature=0.6, "
                       "so it can NOT be regenerated bit-identically.",
    },
    {
        "name": "step4-cot-archive",
        "steps": [4],
        "required": False,
        "strip": False,
        "description": "The same step-4 files WITH the raw reasoning text (~95% dead weight). "
                       "Optional, for inspection only.",
    },
    {
        "name": "step5-similarity",
        "steps": [5],
        "required": True,
        "strip": False,
        "description": "ImageBind VxT/TxV/VxV/TxT similarity caches. Step 6 needs them; "
                       "rebuilding costs GPU hours and the videos.",
    },
    {
        "name": "step6-7-refined-ensemble",
        "steps": [6, 7],
        "required": False,
        "strip": True,
        "description": "Refined and inter-cluster ensemble scores (chain-of-thought stripped). "
                       "Deterministic CPU output of steps 4 + 5, shipped for convenience.",
    },
    {
        "name": "eval-metrics",
        "steps": [],
        "required": True,
        "strip": False,
        "description": "Per-run metric summaries (00vid_metric.json). Small; also tracked in git.",
    },
]


def classify(rel):
    """Map a result/ path to its pipeline step."""
    base = os.path.basename(rel)
    # Metric files live inside the DeepSeek-R1 sub-directories, so they have to be
    # classified before the directory-based rules below.
    if "metric" in base:
        return 0
    if base.startswith("sim_"):
        return 5
    if base.startswith("refine_"):
        return 6
    if base.startswith("ense_"):
        return 7
    if base.startswith("pred_scenes") or base.startswith("scenes_th"):
        return 1
    if base.startswith("dfs_") or base == "pred.json":
        return 2
    if "/DeepSeek-R1" in rel:
        return 4
    if "/LLaVA-Video" in rel:
        return 3
    if "metric" in base:
        return 0
    return -1


def collect(repo_root):
    """Return every artifact file, relative to repo_root."""
    out = []
    root = os.path.join(repo_root, RESULT_ROOT)
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            out.append(os.path.relpath(full, repo_root))
    return sorted(out)


def bundle_files(bundle, files):
    steps = set(bundle["steps"])
    picked = []
    for rel in files:
        step = classify(rel)
        if step == 0 and bundle["name"] == "eval-metrics":
            picked.append(rel)
        elif step in steps:
            picked.append(rel)
    return picked


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def strip_cot(src, dst):
    """Copy a score json with the reasoning text blanked out."""
    with open(src, "r", encoding="utf-8") as f:
        data = json.load(f)
    scores = data.get("vid_score") if isinstance(data, dict) else None
    if isinstance(scores, dict):
        for segs in scores.values():
            if not isinstance(segs, dict):
                continue
            for value in segs.values():
                if (isinstance(value, list) and len(value) > 1
                        and isinstance(value[-1], str) and len(value[-1]) > 50):
                    value[-1] = ""
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def write_archive(path, root, rels):
    """Tar the given relative paths (as result/... members) into path.tar.gz."""
    with gzip.open(path, "wb", compresslevel=COMPRESS_LEVEL) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar:
            for rel in rels:
                tar.add(os.path.join(root, rel), arcname=rel)


def build(bundle, files, repo_root, dist_dir):
    members = bundle_files(bundle, files)
    if not members:
        return None
    asset = "vadtree-%s.tar.gz" % bundle["name"]
    out_path = os.path.join(dist_dir, asset)
    entries = []
    if bundle["strip"]:
        with tempfile.TemporaryDirectory() as tmp:
            for rel in members:
                dst = os.path.join(tmp, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                strip_cot(os.path.join(repo_root, rel), dst)
                entries.append({"path": rel, "bytes": os.path.getsize(dst),
                                "sha256": sha256_file(dst)})
            write_archive(out_path, tmp, members)
    else:
        for rel in members:
            full = os.path.join(repo_root, rel)
            entries.append({"path": rel, "bytes": os.path.getsize(full),
                            "sha256": sha256_file(full)})
        write_archive(out_path, repo_root, members)
    return {
        "name": bundle["name"],
        "asset": asset,
        "steps": bundle["steps"],
        "required": bundle["required"],
        "stripped_cot": bundle["strip"],
        "description": bundle["description"],
        "bytes": os.path.getsize(out_path),
        "sha256": sha256_file(out_path),
        "files": entries,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", action="append", default=None,
                    help="build just these bundles (repeatable)")
    ap.add_argument("--list", action="store_true", help="list bundles and exit")
    ap.add_argument("--repo", default="ZGZ713912/VADTree")
    ap.add_argument("--tag", default="results-v1")
    args = ap.parse_args()

    if args.list:
        for b in BUNDLES:
            print("%-32s required=%-5s strip=%-5s %s"
                  % (b["name"], b["required"], b["strip"], b["description"][:60]))
        return 0

    repo_root = REPO_ROOT
    dist_dir = os.path.join(repo_root, DIST_DIR)
    os.makedirs(dist_dir, exist_ok=True)
    files = collect(repo_root)
    if not files:
        print("no files under %s/" % RESULT_ROOT, file=sys.stderr)
        return 1
    print("found %d artifact files under %s/" % (len(files), RESULT_ROOT))

    wanted = set(args.only) if args.only else None
    built = []
    for b in BUNDLES:
        if wanted and b["name"] not in wanted:
            continue
        print("  packing %-32s ..." % b["name"], end="", flush=True)
        entry = build(b, files, repo_root, dist_dir)
        if entry is None:
            print(" skipped (no files)")
            continue
        print(" %8.1f MB  sha256=%s" % (entry["bytes"] / 1048576, entry["sha256"][:12]))
        built.append(entry)

    manifest_path = os.path.join(repo_root, MANIFEST)
    if wanted and os.path.exists(manifest_path):
        with open(manifest_path) as f:
            previous = json.load(f)
        by_name = {b["name"]: b for b in previous.get("bundles", [])}
        by_name.update({b["name"]: b for b in built})
        built = [by_name[k] for k in sorted(by_name)]

    manifest = {
        "version": args.tag,
        "release_tag": args.tag,
        "repo": args.repo,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total_bytes": sum(b["bytes"] for b in built),
        "bundles": built,
    }
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print("\nwrote %s (%d bundles, %.1f MB total)"
          % (MANIFEST, len(built), manifest["total_bytes"] / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
