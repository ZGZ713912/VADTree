"""Pipeline stage metadata and verification status."""
from __future__ import annotations

from pathlib import Path

from . import data

REPO_ROOT = Path(__file__).resolve().parent.parent

STAGES = [
    {
        "id": 1,
        "name": "GEBD 边界提取",
        "short": "边界",
        "owner": "EfficientGEBD",
        "needs": ["原始视频", "EfficientGEBD 权重"],
        "outputs": ["pred_scenes_th0.5.json", "scenes_th0.5.json"],
        "command": "python GEBD_split100.py --video_dir <videos> --resume <weight> --config-file <config>",
        "note": "发布版边界输出已在磁盘上；重新生成需要原始视频与 GEBD 权重。",
    },
    {
        "id": 2,
        "name": "HGTree 构建",
        "short": "HGTree",
        "owner": "VADTree",
        "needs": ["步骤 1 边界 JSON"],
        "outputs": ["dfs_coarse_scenes.json", "dfs_fine_scenes.json", "dfs_redundant_scenes.json", "pred.json"],
        "command": "python HGTree_generation.py --json_path <boundaries> --threshold kmeans --gamma 0.4",
        "note": "确定性 CPU 步骤。本机重跑后与发布结构逐项对账。",
    },
    {
        "id": 3,
        "name": "节点描述生成",
        "short": "描述",
        "owner": "LLaVA-Video-7B-Qwen2",
        "needs": ["原始视频", "LLaVA-Video-7B-Qwen2 权重"],
        "outputs": ["maxf64_*.json (vid_captions)"],
        "command": "python infer_VAD.py --pretrained <vlm> --video_root <videos> --json_path <coarse|fine>",
        "note": "发布版节点描述已在磁盘上；重新生成需要原始视频与 7B 权重。",
    },
    {
        "id": 4,
        "name": "节点推理",
        "short": "推理",
        "owner": "DeepSeek-R1-Distill-Qwen-14B",
        "needs": ["原始视频", "DeepSeek-R1-14B 权重"],
        "outputs": ["maxf64_*.json (segment scores + CoT)"],
        "command": "python deepseek_batch_infer.py --video_root <videos> --ckpt_dir <llm> --video_clip_summary_json <captions>",
        "note": "按 temperature=0.6 采样，因此不可逐位复现；发布包直接提供采样后的分数。",
    },
    {
        "id": 5,
        "name": "特征相似度",
        "short": "相似度",
        "owner": "ImageBind",
        "needs": ["原始视频", "ImageBind 特征"],
        "outputs": ["sim_*.pkl (VxT / TxV / VxV / TxT)"],
        "command": "python imagebind_sim.py --video_summary_json <captions> --video_root <videos>",
        "note": "发布版相似度缓存在磁盘上；重建需要 GPU 时间和原始视频。",
    },
    {
        "id": 6,
        "name": "簇内细化",
        "short": "细化",
        "owner": "VADTree",
        "needs": ["步骤 4 分数", "步骤 5 相似度缓存", "树结构"],
        "outputs": ["refine_*.json", "00vid_metric.json"],
        "command": "python refinement_eval.py --scores_json <scores> --topK 10 --num_neighbors 10 --tao 0.1",
        "note": "确定性 CPU 步骤。分数与聚合 ROC/PR 会和发布版逐项对账。",
    },
    {
        "id": 7,
        "name": "簇间关联",
        "short": "集成",
        "owner": "VADTree",
        "needs": ["步骤 6 粗粒度细化", "步骤 6 细粒度细化", "pred.json"],
        "outputs": ["ense_refine_*.json", "00vid_metric.json"],
        "command": "python correlation_eval.py --coarse_scores_json <coarse> --fine_scores_json <fine> --beta 0.2",
        "note": "确定性 CPU 步骤。粗/细粒度关联结果会和发布版逐项对账。",
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
        1: ("asset", "发布版边界输出已在磁盘上；步骤 1 本身需要原始视频与权重。"),
        3: ("asset", "发布版节点描述已在磁盘上；步骤 3 本身需要原始视频与 7B 权重。"),
        4: ("asset", "发布版采样分数已在磁盘上；步骤 4 不可逐位复现。"),
        5: ("asset", "发布版相似度缓存在磁盘上；步骤 5 需要原始视频与 ImageBind。"),
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
            item["blockers"] = ["未配置原始视频", "未配置模型权重"]
            if sid == 4:
                item["blockers"].append("按 temperature 0.6 采样，不可逐位复现")
            item["note"] = note
        stages.append(item)
    return {
        "stages": stages,
        "reproduction": repro,
        "generated_at": repro.get("generated_at"),
    }
