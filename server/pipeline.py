"""Pipeline stage metadata and verification status."""
from __future__ import annotations

from pathlib import Path

from . import data

REPO_ROOT = Path(__file__).resolve().parent.parent

STAGES = [
    {
        "id": 1,
        "name": "GEBD boundary extraction",
        "short": "Boundaries",
        "owner": "EfficientGEBD",
        "needs": ["raw videos", "EfficientGEBD checkpoint"],
        "outputs": ["pred_scenes_th0.5.json", "scenes_th0.5.json"],
        "command": "python GEBD_split100.py --video_dir <videos> --resume <weight> --config-file <config>",
        "note": "Published boundary output is present; regenerating needs the videos and the GEBD checkpoint.",
    },
    {
        "id": 2,
        "name": "HGTree construction",
        "short": "HGTree",
        "owner": "VADTree",
        "needs": ["step-1 boundary JSON"],
        "outputs": ["dfs_coarse_scenes.json", "dfs_fine_scenes.json", "dfs_redundant_scenes.json", "pred.json"],
        "command": "python HGTree_generation.py --json_path <boundaries> --threshold kmeans --gamma 0.4",
        "note": "Deterministic CPU step. Re-run and compared against the published structure.",
    },
    {
        "id": 3,
        "name": "Node captioning",
        "short": "Captions",
        "owner": "LLaVA-Video-7B-Qwen2",
        "needs": ["raw videos", "LLaVA-Video-7B-Qwen2 checkpoint"],
        "outputs": ["maxf64_*.json (vid_captions)"],
        "command": "python infer_VAD.py --pretrained <vlm> --video_root <videos> --json_path <coarse|fine>",
        "note": "Published captions are present; regenerating needs the videos and the 7B checkpoint.",
    },
    {
        "id": 4,
        "name": "Node reasoning",
        "short": "Reasoning",
        "owner": "DeepSeek-R1-Distill-Qwen-14B",
        "needs": ["raw videos", "DeepSeek-R1-14B checkpoint"],
        "outputs": ["maxf64_*.json (segment scores + CoT)"],
        "command": "python deepseek_batch_infer.py --video_root <videos> --ckpt_dir <llm> --video_clip_summary_json <captions>",
        "note": "Sampled at temperature=0.6, so it is not bit-reproducible; the release ships the sampled scores.",
    },
    {
        "id": 5,
        "name": "Feature similarity",
        "short": "Similarity",
        "owner": "ImageBind",
        "needs": ["raw videos", "ImageBind features"],
        "outputs": ["sim_*.pkl (VxT / TxV / VxV / TxT)"],
        "command": "python imagebind_sim.py --video_summary_json <captions> --video_root <videos>",
        "note": "Published similarity caches are present; rebuilding costs GPU hours and needs the videos.",
    },
    {
        "id": 6,
        "name": "Intra-cluster refinement",
        "short": "Refinement",
        "owner": "VADTree",
        "needs": ["step-4 scores", "step-5 similarity cache", "tree structure"],
        "outputs": ["refine_*.json", "00vid_metric.json"],
        "command": "python refinement_eval.py --scores_json <scores> --topK 10 --num_neighbors 10 --tao 0.1",
        "note": "Deterministic CPU step. Scores and aggregate ROC/PR are compared with the release.",
    },
    {
        "id": 7,
        "name": "Inter-cluster correlation",
        "short": "Ensemble",
        "owner": "VADTree",
        "needs": ["step-6 coarse refine", "step-6 fine refine", "pred.json"],
        "outputs": ["ense_refine_*.json", "00vid_metric.json"],
        "command": "python correlation_eval.py --coarse_scores_json <coarse> --fine_scores_json <fine> --beta 0.2",
        "note": "Deterministic CPU step. Coarse/fine correlation is compared with the release.",
    },
]


def _check_status(checks, prefix):
    matched = [c for c in checks if str(c.get("id", "")).startswith(prefix)]
    if not matched:
        return "untested", None, []
    statuses = [c.get("status") for c in matched]
    if "fail" in statuses or "error" in statuses:
        status = "fail"
    elif "warning" in statuses:
        status = "warning"
    elif all(s == "pass" for s in statuses):
        status = "verified"
    else:
        status = "untested"
    bad = [c for c in matched if c.get("status") in ("warning", "fail", "error")]
    return status, bad, matched


def _exists_any(pattern):
    return any(REPO_ROOT.glob(pattern))


def build():
    repro = data.reproduction_summary() or {}
    checks = repro.get("checks") or []
    stages = []
    status_map = {
        1: ("asset", "Published boundary output is on disk; step 1 itself needs videos + checkpoint."),
        3: ("asset", "Published captions are on disk; step 3 itself needs videos + 7B checkpoint."),
        4: ("asset", "Published sampled scores are on disk; step 4 is not bit-reproducible."),
        5: ("asset", "Published similarity caches are on disk; step 5 needs videos + ImageBind."),
    }
    for stage in STAGES:
        item = dict(stage)
        sid = stage["id"]
        if sid in (2, 6, 7):
            if sid == 2:
                matched = [c for c in checks if str(c.get("id", "")).endswith("step2")]
            else:
                matched = [c for c in checks
                           if ("step%d-" % sid) in str(c.get("id", ""))
                           or str(c.get("id", "")).endswith("step%d" % sid)]
            status = "untested"
            if matched:
                if any(c["status"] in ("fail", "error") for c in matched):
                    status = "fail"
                elif any(c["status"] == "warning" for c in matched):
                    status = "warning"
                elif all(c["status"] == "pass" for c in matched):
                    status = "verified"
            item["status"] = status
            item["runnable"] = True
            item["checks"] = [
                {"id": c.get("id"), "status": c.get("status"),
                 "detail": c.get("detail"), "published": c.get("published_metric"),
                 "reproduced": c.get("reproduced_metric"),
                 "delta": c.get("max_score_delta")}
                for c in matched
            ]
            item["blockers"] = []
        else:
            status, note = status_map.get(sid, ("untested", stage.get("note")))
            # A stage that has no published artifact is truly blocked, not just asset-only.
            if sid == 1 and not _exists_any("result/*/*/pred_scenes_th0.5.json"):
                status = "blocked"
            if sid == 3 and not _exists_any("result/*/*/LLaVA*/max*.json"):
                status = "blocked"
            if sid == 4 and not _exists_any("result/*/*/LLaVA*/DeepSeek*/max*.json"):
                status = "blocked"
            if sid == 5 and not _exists_any("result/*/*/LLaVA*/sim_*.pkl"):
                status = "blocked"
            item["status"] = status
            item["runnable"] = False
            item["checks"] = []
            item["blockers"] = ["raw videos not configured", "model checkpoint not configured"]
            if sid == 4:
                item["blockers"].append("sampled at temperature 0.6")
            item["note"] = note
        stages.append(item)
    return {
        "stages": stages,
        "reproduction": repro,
        "generated_at": repro.get("generated_at"),
    }
