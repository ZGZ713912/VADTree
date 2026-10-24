"""Read-only data layer for the VADTree evidence console.

Everything here is derived from the files in result/ and dataset_info/. There is
no database: the result tree is small enough to index on demand, and the JSON
payloads are cached by (path, mtime, size).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RESULT = REPO_ROOT / "result"
DATASET_INFO = REPO_ROOT / "dataset_info"

DATASET_META = {
    "UCF_Crime_test": {
        "label": "UCF-Crime",
        "short": "UCF",
        "folder": "ucf_crime",
        "anomaly_file": "anomaly_test.txt",
        "temporal_file": "Temporal_Anomaly_Annotation_for_Testing_Videos.txt",
        "blurb": "290 段监控视频、14 类犯罪事件，是论文的快速上手数据集。",
    },
    "MSAD_test": {
        "label": "MSAD",
        "short": "MSAD",
        "folder": "MSAD",
        "anomaly_file": "anomaly_test.txt",
        "temporal_file": "Temporal_Anomaly_Annotation_for_Testing_Videos.txt",
        "blurb": "240 段多场景视频，涵盖十一类事件，帧率不统一。",
    },
    "XD_Violence_test": {
        "label": "XD-Violence",
        "short": "XD",
        "folder": "xd_violence",
        "anomaly_file": "anomaly_test.txt",
        "temporal_file": "temporal_anomaly_annotation_for_testing_videos.txt",
        "blurb": "800 段电影与网络视频，六类暴力事件，常带多标签。",
    },
}
DATASET_ORDER = ["UCF_Crime_test", "MSAD_test", "XD_Violence_test"]

# Display names for dataset categories. The annotations and metric files use
# English class tokens; the console shows Chinese labels while keeping the raw
# tokens available in the JSON/paths.
CLASS_DISPLAY = {
    "Normal": "正常",
    "Abnormal": "异常",
    "all": "全部",
    "Abuse": "虐待",
    "Arrest": "逮捕",
    "Arson": "纵火",
    "Assault": "袭击",
    "Burglary": "入室盗窃",
    "Explosion": "爆炸",
    "Fighting": "斗殴",
    "RoadAccidents": "交通事故",
    "Robbery": "抢劫",
    "Shooting": "枪击",
    "Shoplifting": "入店行窃",
    "Stealing": "盗窃",
    "Vandalism": "破坏公物",
    "Fire": "火灾",
    "Object": "物体坠落",
    "People": "人员坠落",
    "Traffic": "交通事故",
    "Water": "涉水事件",
    "Car_accident": "车祸",
    "Car Accident": "车祸",
    "Object Falling": "物体坠落",
    "People Falling": "人员坠落",
    "Traffic Accident": "交通事故",
    "Water Incident": "涉水事件",
    "Riot": "骚乱",
}

_JSON_CACHE: "OrderedDict[tuple, object]" = OrderedDict()
_JSON_CACHE_MAX = 20


def load_json(path: Path):
    """Load a JSON file, cached by mtime and size (bounded LRU)."""
    path = Path(path)
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if key in _JSON_CACHE:
        _JSON_CACHE.move_to_end(key)
        return _JSON_CACHE[key]
    with open(path, "r", encoding="utf-8") as fh:
        value = json.load(fh)
    _JSON_CACHE[key] = value
    while len(_JSON_CACHE) > _JSON_CACHE_MAX:
        _JSON_CACHE.popitem(last=False)
    return value


def rel(path: Path) -> str:
    return str(Path(path).resolve().relative_to(REPO_ROOT))


def num(value):
    """JSON-safe number: NaN/inf become None."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return value
    return None


def pretty_category(raw: str) -> str:
    if not raw:
        return "未知"
    parts = [p.strip() for p in str(raw).split(",") if p.strip()]
    if not parts:
        return "未知"
    return " / ".join(CLASS_DISPLAY.get(p, p) for p in parts)


def _strip_ext(name: str) -> str:
    return Path(name).stem


@lru_cache(maxsize=8)
def annotations(dataset: str):
    """Return {stem: {start, end, label, category, intervals, fps?}}."""
    meta = DATASET_META[dataset]
    folder = DATASET_INFO / meta["folder"] / "annotations"
    out = {}
    anomaly = folder / meta["anomaly_file"]
    if anomaly.exists():
        for line in anomaly.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) < 4:
                continue
            stem = _strip_ext(parts[0])
            try:
                start, end = int(parts[1]), int(parts[2])
            except ValueError:
                continue
            out[stem] = {"start": start, "end": end, "label": parts[3],
                         "intervals": [], "category": "未知"}
    temporal = folder / meta["temporal_file"]
    if temporal.exists():
        for line in temporal.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) < 3:
                continue
            stem = _strip_ext(parts[0])
            entry = out.setdefault(stem, {"start": 0, "end": 0, "label": "",
                                          "intervals": [], "category": "未知"})
            entry["category"] = pretty_category(parts[1])
            intervals = []
            vals = parts[2:]
            for i in range(0, len(vals) - 1, 2):
                if vals[i] == "-1":
                    break
                try:
                    start, end = int(vals[i]), int(vals[i + 1])
                except ValueError:
                    continue
                if start >= 0 and end >= 0:
                    intervals.append([start, end])
            entry["intervals"] = intervals
    return out


def _run_metric(dataset_metric):
    if not isinstance(dataset_metric, dict):
        return {"roc_auc": None, "pr_auc": None, "categories": []}
    if "all" in dataset_metric:
        all_metric = dataset_metric.get("all") or {}
        categories = [
            {"name": CLASS_DISPLAY.get(key, key), "roc_auc": num(val.get("roc_auc")),
             "pr_auc": num(val.get("pr_auc"))}
            for key, val in dataset_metric.items()
            if key != "all" and isinstance(val, dict)
        ]
    else:
        all_metric = dataset_metric
        categories = []
    return {
        "roc_auc": num(all_metric.get("roc_auc")),
        "pr_auc": num(all_metric.get("pr_auc")),
        "categories": categories,
    }


def _run_label(kind, resolution, args, path):
    if kind == "ensemble":
        beta = args.get("beta")
        if beta is None:
            m = re.search(r"beat(-?\d+(?:\.\d+)?)", path)
            beta = m.group(1) if m else None
        return "集成 · " + (("β" + str(beta)) if beta is not None else "粗粒度 + 细粒度")
    parts = [{"coarse": "粗粒度", "fine": "细粒度"}.get(resolution or "", "运行")]
    if args.get("similarity_type"):
        parts.append(str(args["similarity_type"]) + str(args.get("topK", "")))
    if args.get("num_neighbors") is not None:
        parts.append("nn" + str(args["num_neighbors"]))
    if args.get("dyn_ratio") is not None:
        parts.append("dyn" + str(args["dyn_ratio"]))
    if args.get("tao") is not None:
        parts.append("τ" + str(args["tao"]))
    return " · ".join(parts)


def _build_run(path: Path, data, kind):
    parts = Path(path).relative_to(RESULT).parts
    dataset = parts[0]
    if dataset not in DATASET_META:
        return None
    tree = parts[1]
    stage = parts[2] if len(parts) > 2 else ""
    args = data.get("args_dict") or {}
    if kind == "ensemble":
        resolution = None
    elif "_coarse" in stage:
        resolution = "coarse"
    elif "_fine" in stage:
        resolution = "fine"
    else:
        resolution = "unknown"
    metrics = _run_metric(data.get("dataset_metric"))
    beta = args.get("beta")
    if beta is None:
        match = re.search(r"beat(-?\d+(?:\.\d+)?)", str(path))
        beta = float(match.group(1)) if match else None
    relpath = rel(path)
    run_id = hashlib.sha1(relpath.encode("utf-8")).hexdigest()[:10]
    videos = data.get("vid_score") or {}
    return {
        "id": run_id,
        "kind": kind,
        "resolution": resolution,
        "dataset": dataset,
        "dataset_label": DATASET_META[dataset]["label"],
        "tree": tree,
        "stage": stage,
        "label": _run_label(kind, resolution, args, str(path)),
        "metrics": metrics,
        "config": {
            "similarity_type": args.get("similarity_type"),
            "topK": args.get("topK"),
            "num_neighbors": args.get("num_neighbors"),
            "dyn_ratio": args.get("dyn_ratio"),
            "tao": args.get("tao"),
            "beta": beta,
            "frame_interval": args.get("frame_interval"),
            "video_fps": args.get("video_fps"),
        },
        "videos": len(videos) if isinstance(videos, dict) else 0,
        "path": relpath,
        "score_path": relpath,
        "tree_path": rel(Path(RESULT, dataset, tree)),
        "mtime": path.stat().st_mtime,
    }


def _scan_runs():
    runs = []
    for pattern, kind in (("refine_*.json", "refine"), ("ense_refine_*.json", "ensemble")):
        for path in RESULT.rglob(pattern):
            if not path.is_file():
                continue
            if path.name.startswith("refine_vid_metric"):
                continue
            try:
                data = load_json(path)
            except Exception:
                continue
            if not isinstance(data, dict) or not isinstance(data.get("vid_score"), dict):
                continue
            run = _build_run(path, data, kind)
            if run:
                runs.append(run)
    order = {name: i for i, name in enumerate(DATASET_ORDER)}
    runs.sort(key=lambda r: (order.get(r["dataset"], 99),
                             -1 if r["kind"] == "ensemble" else 0,
                             -(r["metrics"]["roc_auc"] or -1)))
    # The README headline is the k-means ensemble with a dataset-specific beta.
    # Keep higher-scoring variants (e.g. the k-medoids UCF ensemble) visible but
    # do not let them silently replace the canonical result.
    canonical_beta = {"UCF_Crime_test": 0.2, "MSAD_test": -0.4, "XD_Violence_test": 0.7}
    for dataset, beta in canonical_beta.items():
        candidates = [
            r for r in runs
            if r["dataset"] == dataset and r["kind"] == "ensemble"
            and "kmeans" in r["tree"] and r["config"].get("beta") is not None
            and abs(float(r["config"]["beta"]) - beta) < 1e-9
        ]
        if candidates:
            candidates.sort(key=lambda r: r["path"])
            candidates[0]["featured"] = True
    return runs


_RUNS = None


def runs(force=False):
    global _RUNS
    if _RUNS is None or force:
        _RUNS = _scan_runs()
    return _RUNS


def get_run(run_id):
    for run in runs():
        if run["id"] == run_id:
            return run
    return None


def run_data(run):
    return load_json(REPO_ROOT / run["score_path"])


def run_metric_file(run):
    path = REPO_ROOT / run["score_path"]
    candidate = path.parent / "00vid_metric.json"
    if candidate.exists():
        return load_json(candidate)
    return {}


def tree_data(run):
    base = REPO_ROOT / run["tree_path"]
    coarse = load_json(base / "dfs_coarse_scenes.json") if (base / "dfs_coarse_scenes.json").exists() else {}
    fine = load_json(base / "dfs_fine_scenes.json") if (base / "dfs_fine_scenes.json").exists() else {}
    redundant = load_json(base / "dfs_redundant_scenes.json") if (base / "dfs_redundant_scenes.json").exists() else {}
    return coarse, fine, redundant


def _video_metric_map(run):
    data = run_metric_file(run)
    return data.get("vid_metric") or {}


def _tree_entry(entry_map, video):
    if video in entry_map:
        return entry_map[video]
    stem = _strip_ext(video)
    for key, value in entry_map.items():
        if _strip_ext(key) == stem:
            return value
    return None


def video_records(run):
    """Compact per-video rows used by the evidence index and strip selection."""
    score_data = run_data(run)
    scores = score_data.get("vid_score") or {}
    coarse, _fine, _red = tree_data(run)
    metrics = _video_metric_map(run)
    annotation = annotations(run["dataset"])
    rows = []
    for video, segments in scores.items():
        entry = _tree_entry(coarse, video) or {}
        stem = _strip_ext(video)
        ann = annotation.get(stem, {})
        m = metrics.get(stem, {})
        fps = entry.get("fps") or 30.0
        frames = entry.get("frames") or 0
        intervals = ann.get("intervals", [])
        rows.append({
            "name": video,
            "stem": stem,
            "category": ann.get("category", "未知"),
            "fps": fps,
            "frames": frames,
            "duration": round(frames / fps, 3) if frames and fps else None,
            "auc": num(m.get("roc_auc")),
            "pr_auc": num(m.get("pr_auc")),
            "anomaly": bool(intervals),
            "gt_count": len(intervals),
        })
    rows.sort(key=lambda r: (-(r["auc"] if r["auc"] is not None else -1), r["name"]))
    return rows


def _downsample(values, fps, max_points=700):
    n = len(values)
    if n == 0:
        return []
    if n <= max_points:
        return [[round(i / fps, 3), num(round(float(v), 5))] for i, v in enumerate(values)]
    bucket = math.ceil(n / max_points)
    out = []
    for start in range(0, n, bucket):
        chunk = values[start:start + bucket]
        if not chunk:
            continue
        try:
            value = max(float(x) for x in chunk if x is not None)
        except ValueError:
            continue
        t = (start + len(chunk) / 2) / fps
        out.append([round(t, 3), num(round(value, 5))])
    return out


def _flatten_segments(segments, frames):
    """Turn a segment dict into a per-frame step list."""
    values = []
    entries = []
    for key, value in segments.items():
        try:
            start, end = [int(x) for x in key.split(",")]
        except (ValueError, AttributeError):
            continue
        try:
            score = float(value[0] if isinstance(value, list) else value)
        except (TypeError, ValueError, IndexError):
            continue
        entries.append((start, end, score))
    entries.sort()
    if not entries:
        return []
    limit = frames or max(end for _, end, _ in entries)
    values = [entries[0][2]] * limit
    for start, end, score in entries:
        for i in range(max(0, start), min(limit, end)):
            values[i] = score
    return values


def curve(run, video, max_points=700):
    score_data = run_data(run)
    scores = score_data.get("vid_score") or {}
    key = video if video in scores else next(
        (k for k in scores if _strip_ext(k) == _strip_ext(video)), None)
    if key is None:
        return [], 30.0
    coarse, _fine, _red = tree_data(run)
    entry = _tree_entry(coarse, key) or {}
    fps = float(entry.get("fps") or 30.0)
    frames = int(entry.get("frames") or 0)
    segments = scores.get(key)
    if isinstance(segments, list):
        values = segments
    elif isinstance(segments, dict):
        values = _flatten_segments(segments, frames)
    else:
        values = []
    return _downsample(values, fps, max_points), fps


def _node_score(segments, start, end, flat, fps):
    key = f"{start}, {end}"
    if isinstance(segments, dict) and key in segments:
        value = segments[key]
        try:
            return num(round(float(value[0]), 5)), num(round(float(value[1]), 5)) if len(value) > 1 else None
        except (TypeError, ValueError, IndexError):
            pass
    if flat:
        lo = max(0, int(start))
        hi = min(len(flat), int(end))
        if hi > lo:
            return num(round(float(sum(flat[lo:hi]) / (hi - lo)), 5)), None
    return None, None


def _load_captions(run, resolution):
    base = REPO_ROOT / run["tree_path"]
    files = sorted(base.glob(f"LLaVA*_{resolution}/max*.json"))
    if not files:
        return {}
    data = load_json(files[0])
    return data.get("vid_captions") or {}


def _load_reasoning(run, video):
    base = REPO_ROOT / run["tree_path"]
    candidates = sorted(base.glob("LLaVA*_coarse/DeepSeek*_think/max*.json"))
    if not candidates:
        candidates = sorted(base.glob("LLaVA*_fine/DeepSeek*_think/max*.json"))
    if not candidates:
        return {}
    data = load_json(candidates[0])
    return (data.get("vid_score") or {}).get(video, {}) or {}


def _node_list(run, scenes, segments, flat, fps, captions, reasoning, max_chars=6000):
    nodes = []
    for start, end in scenes:
        key = f"{start}, {end}"
        score, original = _node_score(segments, start, end, flat, fps)
        caption = captions.get(key)
        raw = reasoning.get(key) if isinstance(reasoning, dict) else None
        reason = None
        if isinstance(raw, list):
            if len(raw) > 1 and isinstance(raw[1], str):
                reason = raw[1]
            elif len(raw) > 0 and isinstance(raw[0], str):
                reason = raw[0]
        if reason is None and isinstance(segments, dict):
            value = segments.get(key)
            if isinstance(value, list) and len(value) > 2 and isinstance(value[2], str):
                reason = value[2]
        truncated = False
        if isinstance(reason, str) and len(reason) > max_chars:
            reason = reason[:max_chars]
            truncated = True
        if isinstance(caption, str) and len(caption) > 2200:
            caption = caption[:2200]
        nodes.append({
            "key": key,
            "start": start,
            "end": end,
            "start_s": round(start / fps, 3),
            "end_s": round(end / fps, 3),
            "score": score,
            "original_score": original,
            "caption": caption,
            "reasoning": reason,
            "reasoning_truncated": truncated,
        })
    return nodes


def evidence(run_id, video):
    run = get_run(run_id)
    if not run:
        raise KeyError("run not found")
    score_data = run_data(run)
    scores = score_data.get("vid_score") or {}
    key = video if video in scores else next(
        (k for k in scores if _strip_ext(k) == _strip_ext(video)), None)
    if key is None:
        raise KeyError("video not found")
    coarse_tree, fine_tree, redundant_tree = tree_data(run)
    entry = _tree_entry(coarse_tree, key) or {}
    fps = float(entry.get("fps") or 30.0)
    frames = int(entry.get("frames") or 0)
    segments = scores.get(key)
    flat = _flatten_segments(segments, frames) if isinstance(segments, dict) else (
        segments if isinstance(segments, list) else [])
    values = flat
    if values:
        max_points = 700
        curve_points = _downsample(values, fps, max_points)
    else:
        curve_points = []

    ann = annotations(run["dataset"]).get(_strip_ext(key), {})
    gt = []
    for start, end in ann.get("intervals", []):
        gt.append({
            "start": start, "end": end,
            "start_s": round(start / fps, 3),
            "end_s": round(end / fps, 3),
        })

    captions_coarse = _load_captions(run, "coarse")
    captions_fine = _load_captions(run, "fine")
    reasoning = _load_reasoning(run, key)
    coarse_nodes = _node_list(run, (coarse_tree.get(key) or {}).get("scenes", []),
                              segments, flat, fps, captions_coarse.get(key, {}), reasoning)
    fine_nodes = _node_list(run, (fine_tree.get(key) or {}).get("scenes", []),
                            segments, flat, fps, captions_fine.get(key, {}), reasoning)
    red = (redundant_tree.get(key) or {}).get("scenes", [])
    metrics = _video_metric_map(run).get(_strip_ext(key), {})
    return {
        "run": run,
        "video": {
            "name": key,
            "stem": _strip_ext(key),
            "category": ann.get("category", "未知"),
            "fps": fps,
            "frames": frames,
            "duration": round(frames / fps, 3) if frames and fps else None,
            "auc": num(metrics.get("roc_auc")),
            "pr_auc": num(metrics.get("pr_auc")),
            "gt": gt,
            "has_anomaly": bool(gt),
        },
        "curve": curve_points,
        "coarse": coarse_nodes,
        "fine": fine_nodes,
        "redundant_count": len(red),
        "reasoning_source": "Step-4 思维链" if reasoning else (
            "细化追踪" if isinstance(segments, dict) and any(
                isinstance(v, list) and len(v) > 2 for v in segments.values()
            ) else None
        ),
    }


def dataset_summary(dataset):
    meta = DATASET_META[dataset]
    ds_runs = [r for r in runs() if r["dataset"] == dataset]
    ensembles = [r for r in ds_runs if r["kind"] == "ensemble"]
    refinements = [r for r in ds_runs if r["kind"] == "refine"]
    candidates = ensembles or refinements
    featured = next((r for r in candidates if r.get("featured")), None)
    best = featured or (max(candidates, key=lambda r: r["metrics"]["roc_auc"] or -1)
                        if candidates else None)
    highest = max(candidates, key=lambda r: r["metrics"]["roc_auc"] or -1) if candidates else None
    baseline = {}
    base_tree = best["tree"] if best else None
    for resolution in ("coarse", "fine"):
        group = [r for r in refinements
                 if r["resolution"] == resolution and (not base_tree or r["tree"] == base_tree)]
        baseline[resolution] = (max(group, key=lambda r: r["metrics"]["roc_auc"] or -1)["metrics"]
                                if group else None)
    coarse_path = None
    if ds_runs:
        coarse_path = REPO_ROOT / ds_runs[0]["tree_path"] / "dfs_coarse_scenes.json"
    videos = len(load_json(coarse_path)) if coarse_path and coarse_path.exists() else 0
    return {
        "id": dataset,
        "label": meta["label"],
        "short": meta["short"],
        "blurb": meta["blurb"],
        "videos": videos,
        "runs": len(ds_runs),
        "best_run": best,
        "highest_run": highest,
        "best_metric": best["metrics"] if best else {"roc_auc": None, "pr_auc": None, "categories": []},
        "baseline": baseline,
    }


def _pick_strips(run, count=12):
    rows = video_records(run)
    anomalies = [r for r in rows if r["anomaly"] and r["auc"] is not None]
    normals = [r for r in rows if not r["anomaly"] and r["auc"] is not None]
    picks = []
    for row in anomalies[:max(2, count // 2)]:
        picks.append(row)
    for row in normals[:max(2, count // 2)]:
        picks.append(row)
    if len(picks) < count:
        used = {r["name"] for r in picks}
        picks += [r for r in rows if r["name"] not in used][:count - len(picks)]
    picks = picks[:count]
    out = []
    coarse, _fine, _red = tree_data(run)
    annotations_map = annotations(run["dataset"])
    for row in picks:
        entry = _tree_entry(coarse, row["name"]) or {}
        fps = float(entry.get("fps") or 30.0)
        points, _ = curve(run, row["name"], max_points=90)
        ann = annotations_map.get(row["stem"], {})
        gt = [[round(s / fps, 3), round(e / fps, 3)] for s, e in ann.get("intervals", [])]
        out.append({
            "name": row["name"],
            "stem": row["stem"],
            "category": row["category"],
            "auc": row["auc"],
            "duration": row["duration"],
            "curve": points,
            "gt": gt,
        })
    return out


def overview(dataset=None):
    summaries = [dataset_summary(ds) for ds in DATASET_ORDER]
    selected = dataset if dataset in DATASET_META else None
    if not selected:
        with_data = [s for s in summaries if s["best_run"]]
        selected = with_data[0]["id"] if with_data else DATASET_ORDER[0]
    summary = next(s for s in summaries if s["id"] == selected)
    best = summary["best_run"]
    strips = _pick_strips(best) if best else []
    return {
        "datasets": summaries,
        "selected": selected,
        "best_run": best,
        "categories": summary["best_metric"]["categories"],
        "strips": strips,
        "counts": {
            "runs": len(runs()),
            "datasets": len(summaries),
            "videos": sum(s["videos"] for s in summaries),
        },
        "reproduction": reproduction_summary(),
    }


def reproduction_summary():
    path = REPO_ROOT / "repro" / "latest.json"
    if not path.exists():
        return None
    data = load_json(path)
    checks = data.get("checks") or []
    counts = {"pass": 0, "warning": 0, "fail": 0, "skipped": 0}
    for check in checks:
        status = check.get("status", "fail")
        counts[status] = counts.get(status, 0) + 1
    return {
        "generated_at": data.get("generated_at"),
        "counts": counts,
        "versions": data.get("versions"),
        "checks": checks,
    }


def artifacts():
    manifest_path = REPO_ROOT / "MANIFEST.json"
    if not manifest_path.exists():
        return {"manifest": None, "bundles": []}
    manifest = load_json(manifest_path)
    bundles = []
    for bundle in manifest.get("bundles", []):
        files = bundle.get("files", [])
        present = 0
        full_cot = 0
        missing = []
        for entry in files:
            path = REPO_ROOT / entry["path"]
            if not path.exists():
                missing.append(entry["path"])
                continue
            if path.stat().st_size == entry["bytes"]:
                present += 1
            elif bundle.get("stripped_cot") and path.suffix == ".json":
                # The workspace may hold the full-CoT archive variant; accept it
                # for the presence view. The verify button still hashes.
                present += 1
                full_cot += 1
            else:
                missing.append(entry["path"])
        bundles.append({
            "name": bundle.get("name"),
            "asset": bundle.get("asset"),
            "steps": bundle.get("steps", []),
            "required": bundle.get("required", False),
            "stripped_cot": bundle.get("stripped_cot", False),
            "bytes": bundle.get("bytes"),
            "files": len(files),
            "present": present,
            "full_cot": full_cot,
            "missing": missing[:8],
            "missing_count": len(missing),
            "description": bundle.get("description"),
        })
    return {
        "manifest": {
            "repo": manifest.get("repo"),
            "release_tag": manifest.get("release_tag"),
            "generated_at": manifest.get("generated_at"),
            "total_bytes": manifest.get("total_bytes"),
        },
        "bundles": bundles,
        "cache_bytes": sum(p.stat().st_size for p in (REPO_ROOT / "dist").glob("*.tar.gz"))
        if (REPO_ROOT / "dist").exists() else 0,
    }


def search(query, limit=30):
    q = (query or "").strip().lower()
    if not q:
        return []
    hits = []
    for run in runs():
        if q in run["label"].lower() or q in run["dataset_label"].lower():
            hits.append({"type": "run", "id": run["id"], "label": run["label"],
                         "sub": run["dataset_label"]})
    for dataset in DATASET_ORDER:
        candidates = [r for r in runs() if r["dataset"] == dataset]
        if not candidates:
            continue
        best = next((r for r in candidates if r["kind"] == "ensemble"), candidates[0])
        for row in video_records(best):
            if q in row["name"].lower() or q in row["category"].lower():
                hits.append({"type": "video", "dataset": dataset, "run": best["id"],
                             "name": row["name"], "label": row["stem"],
                             "sub": row["category"]})
                if len(hits) >= limit:
                    return hits
    return hits[:limit]
