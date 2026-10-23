#!/usr/bin/env python3
"""Download VADTree release artifacts and verify them against MANIFEST.json.

Large experiment outputs live as GitHub Release assets, not in git. A fresh
clone has the code and the metric summaries only; run this script to populate
`result/` with the intermediate files each pipeline step needs.

Typical use:

    python scripts/fetch_artifacts.py --list          # show bundles
    python scripts/fetch_artifacts.py                 # required bundles only
    python scripts/fetch_artifacts.py --all           # everything, incl. CoT archive
    python scripts/fetch_artifacts.py --verify        # check what is on disk
    python scripts/fetch_artifacts.py --bundles step4-scores

Downloads are cached in `dist/`, so an interrupted run resumes by skipping
archives whose checksum already matches.
"""
import argparse
import hashlib
import json
import os
import sys
import tarfile
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO_ROOT, "MANIFEST.json")
CACHE_DIR = os.path.join(REPO_ROOT, "dist")
USER_AGENT = "vadtree-fetch/1.0"


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024.0


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest():
    if not os.path.exists(MANIFEST):
        sys.exit("MANIFEST.json not found next to the repository root")
    with open(MANIFEST) as f:
        return json.load(f)


def select(manifest, names, want_all):
    bundles = manifest["bundles"]
    if want_all:
        return bundles
    if names:
        known = {b["name"] for b in bundles}
        unknown = [n for n in names if n not in known]
        if unknown:
            sys.exit("unknown bundle(s): %s\nknown: %s"
                     % (", ".join(unknown), ", ".join(sorted(known))))
        return [b for b in bundles if b["name"] in set(names)]
    return [b for b in bundles if b.get("required")]


def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                pct = 100.0 * done / total
                sys.stdout.write("\r      %5.1f%%  %s / %s"
                                 % (pct, human(done), human(total)))
                sys.stdout.flush()
    sys.stdout.write("\r" + " " * 45 + "\r")
    os.replace(tmp, dest)


def safe_extract(archive, dest):
    """Extract a tarball, refusing absolute paths and parent-directory escapes."""
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            name = member.name
            if os.path.isabs(name) or ".." in name.split("/"):
                sys.exit("refusing unsafe archive member: %s" % name)
            if not (member.isfile() or member.isdir()):
                continue
        tar.extractall(dest, members=[m for m in tar.getmembers()
                                      if m.isfile() or m.isdir()])


def verify_files(bundle, dest, quiet=False):
    bad = []
    missing = []
    for entry in bundle["files"]:
        path = os.path.join(dest, entry["path"])
        if not os.path.exists(path):
            missing.append(entry["path"])
            continue
        if os.path.getsize(path) != entry["bytes"] or sha256_file(path) != entry["sha256"]:
            bad.append(entry["path"])
    if not quiet:
        if not missing and not bad:
            print("    ok  %d files" % len(bundle["files"]))
        for p in missing[:5]:
            print("    missing  %s" % p)
        for p in bad[:5]:
            print("    mismatch %s" % p)
        if len(missing) > 5 or len(bad) > 5:
            print("    ... and %d more" % (len(missing) + len(bad) - 10))
    return missing, bad


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true", help="list bundles and exit")
    ap.add_argument("--bundles", default="", help="comma separated bundle names")
    ap.add_argument("--all", action="store_true", help="fetch every bundle")
    ap.add_argument("--verify", action="store_true",
                    help="only check files already on disk")
    ap.add_argument("--dest", default=REPO_ROOT, help="extraction root")
    ap.add_argument("--keep-archives", action="store_true",
                    help="keep the downloaded tarballs in dist/")
    args = ap.parse_args()

    manifest = load_manifest()
    names = [n.strip() for n in args.bundles.split(",") if n.strip()]
    bundles = select(manifest, names, args.all)

    if args.list:
        print("release %s  (%s)" % (manifest["release_tag"], manifest["repo"]))
        for b in manifest["bundles"]:
            print("  %-32s %8s  %-3s %s"
                  % (b["name"], human(b["bytes"]),
                     "yes" if b["required"] else "opt",
                     b["description"][:64]))
        print("\ntotal %.1f MB" % (manifest["total_bytes"] / 1048576.0))
        print("select with --bundles <a,b> or --all")
        return 0

    if args.verify:
        failed = 0
        for b in bundles:
            print("%s:" % b["name"])
            missing, bad = verify_files(b, args.dest)
            failed += len(missing) + len(bad)
        print("\n%s" % ("all files verified" if failed == 0
                         else "%d file(s) missing or modified" % failed))
        return 0 if failed == 0 else 1

    failed = 0
    for b in bundles:
        print("[%s] %.1f MB" % (b["name"], b["bytes"] / 1048576.0))
        cached = os.path.join(CACHE_DIR, b["asset"])
        if os.path.exists(cached) and sha256_file(cached) == b["sha256"]:
            print("    cached  %s" % b["asset"])
        else:
            url = "https://github.com/%s/releases/download/%s/%s" % (
                manifest["repo"], manifest["release_tag"], b["asset"])
            print("    get     %s" % url)
            try:
                download(url, cached)
            except urllib.error.HTTPError as e:
                print("    FAILED  HTTP %s (was the release published?)" % e.code)
                failed += 1
                continue
            got = sha256_file(cached)
            if got != b["sha256"]:
                print("    FAILED  checksum mismatch")
                failed += 1
                continue
        print("    unpack  -> %s" % args.dest)
        safe_extract(cached, args.dest)
        missing, bad = verify_files(b, args.dest)
        failed += len(missing) + len(bad)
        if not args.keep_archives and os.path.exists(cached):
            os.remove(cached)

    print("\n%s" % ("done" if failed == 0 else "%d error(s)" % failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
