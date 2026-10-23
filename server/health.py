"""Environment and reproduction checks for the console."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VENV_PY = REPO_ROOT / ".venv" / "bin" / "python"
_CACHE = {"at": 0.0, "value": None}
_CACHE_TTL = 30.0


def _run(cmd, timeout=10):
    try:
        proc = subprocess.run(cmd, cwd=str(REPO_ROOT), text=True, capture_output=True,
                              timeout=timeout)
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except Exception as exc:  # noqa: BLE001
        return 1, "", str(exc)


def _dir_stats(path: Path):
    total = 0
    files = 0
    if not path.exists():
        return {"bytes": 0, "files": 0}
    for root, _dirs, names in os.walk(path):
        for name in names:
            try:
                total += (Path(root) / name).stat().st_size
                files += 1
            except OSError:
                continue
    return {"bytes": total, "files": files}


def _packages(python: str):
    code = (
        "import json;"
        "out={};"
        "mods=['numpy','sklearn','matplotlib','scipy'];"
        "\nfor m in mods:\n"
        "    try:\n"
        "        out[m]=__import__(m).__version__\n"
        "    except Exception:\n"
        "        out[m]=None\n"
        "print(json.dumps(out))"
    )
    rc, out, _err = _run([python, "-c", code], timeout=20)
    if rc != 0:
        return {m: None for m in ("numpy", "sklearn", "matplotlib", "scipy")}
    try:
        return json.loads(out)
    except Exception:
        return {m: None for m in ("numpy", "sklearn", "matplotlib", "scipy")}


def _gpu():
    rc, out, _err = _run([
        "nvidia-smi", "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader",
    ], timeout=8)
    if rc != 0 or not out:
        return None
    first = out.splitlines()[0]
    parts = [p.strip() for p in first.split(",")]
    return {"name": parts[0] if parts else "GPU",
            "memory": parts[1] if len(parts) > 1 else None,
            "driver": parts[2] if len(parts) > 2 else None}


def _video_roots():
    roots = []
    env = os.environ.get("VADTREE_VIDEO_ROOT")
    if env:
        roots.append(Path(env))
    roots.append(REPO_ROOT / "data" / "videos")
    for root in roots:
        if not root.exists():
            continue
        datasets = {}
        for name in ("UCF_Crime_test", "MSAD_test", "XD_Violence_test"):
            for candidate in (root / name, root / name / "test_videos", root / name / "videos"):
                if candidate.exists():
                    datasets[name] = str(candidate)
                    break
        if datasets:
            return {"configured": True, "root": str(root), "datasets": datasets}
    return {"configured": False, "root": env or str(roots[-1]), "datasets": {}}


def _weights():
    keys = {
        "GEBD_MODEL_WEIGHT": "EfficientGEBD checkpoint",
        "VLM_MODEL_DIR": "LLaVA-Video-7B-Qwen2",
        "LLM_MODEL_DIR": "DeepSeek-R1-Distill-Qwen-14B",
    }
    out = {}
    for env, label in keys.items():
        value = os.environ.get(env)
        out[env] = {"label": label, "path": value, "present": bool(value and Path(value).exists())}
    return out


def environment(force=False):
    now = time.time()
    if not force and _CACHE["value"] and now - _CACHE["at"] < _CACHE_TTL:
        return _CACHE["value"]
    python = str(VENV_PY) if VENV_PY.exists() else "python3"
    rc, version, _err = _run([python, "-V"], timeout=8)
    packages = _packages(python)
    result = _dir_stats(REPO_ROOT / "result")
    disk = shutil.disk_usage(str(REPO_ROOT))
    rc_git, git, _err = _run(["git", "rev-parse", "--short", "HEAD"], timeout=5)
    value = {
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "venv": {
            "path": str(VENV_PY) if VENV_PY.exists() else None,
            "python": version.replace("Python ", "") if rc == 0 else None,
            "present": VENV_PY.exists(),
        },
        "packages": packages,
        "gpu": _gpu(),
        "result": result,
        "disk": {"free": disk.free, "total": disk.total},
        "git": git if rc_git == 0 else None,
        "videos": _video_roots(),
        "weights": _weights(),
        "dist_built": (REPO_ROOT / "webui" / "dist" / "index.html").exists(),
    }
    _CACHE.update({"at": now, "value": value})
    return value
