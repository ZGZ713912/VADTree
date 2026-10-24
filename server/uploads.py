"""Upload handling and VLM backend status for the query page."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
UPLOADS_DIR = REPO_ROOT / "uploads"
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GiB
ALLOWED_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def _probe(video: Path):
    out = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=width,height,avg_frame_rate,codec_type",
        "-of", "json", str(video),
    ], check=True, capture_output=True, text=True, timeout=30).stdout
    data = json.loads(out)
    stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    duration = float(data.get("format", {}).get("duration") or 0)
    fps_raw = stream.get("avg_frame_rate") or "0/1"
    try:
        num, den = fps_raw.split("/")
        fps = float(num) / float(den) if float(den) else 0.0
    except Exception:
        fps = 0.0
    if duration <= 0:
        raise ValueError("无法读取视频时长")
    return {
        "duration": round(duration, 3),
        "fps": round(fps, 3),
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
    }


def _preview(video: Path, out: Path, at: float):
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{at:.3f}", "-i", str(video), "-frames:v", "1",
        "-vf", "scale='min(960,iw)':-2", "-q:v", "3", str(out),
    ], check=True, timeout=30)


def save_upload(rfile, length: int, filename: str):
    if length <= 0:
        raise ValueError("上传文件为空")
    if length > MAX_UPLOAD:
        raise ValueError("文件超过 1GB 限制")
    filename = os.path.basename(filename or "video.mp4")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise ValueError("不支持的视频格式：" + (ext or "无扩展名"))
    upload_id = uuid.uuid4().hex[:16]
    upload_dir = UPLOADS_DIR / upload_id
    upload_dir.mkdir(parents=True, exist_ok=False)
    video = upload_dir / ("video" + ext)
    remaining = length
    try:
        with open(video, "wb") as fh:
            while remaining > 0:
                chunk = rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise ValueError("上传中断")
                fh.write(chunk)
                remaining -= len(chunk)
        meta = _probe(video)
        preview = upload_dir / "preview.jpg"
        _preview(video, preview, min(0.5, max(0.0, meta["duration"] / 4)))
    except Exception:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    payload = {
        "id": upload_id,
        "name": filename,
        "size": length,
        "video_file": video.name,
        **meta,
        "preview_url": "/api/uploads/%s/preview.jpg" % upload_id,
        "created_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    (upload_dir / "meta.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def get_upload(upload_id: str):
    if not upload_id or not all(c in "0123456789abcdef" for c in upload_id):
        return None
    upload_dir = UPLOADS_DIR / upload_id
    meta_path = upload_dir / "meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def asset(upload_id: str, name: str):
    if not upload_id or not all(c in "0123456789abcdef" for c in upload_id):
        return None
    if name == "preview.jpg":
        path = UPLOADS_DIR / upload_id / "preview.jpg"
    elif name.startswith("frames/") and name.endswith(".jpg") and ".." not in name:
        path = UPLOADS_DIR / upload_id / "frames" / Path(name).name
    else:
        return None
    if not path.exists():
        return None
    return path


def vlm_status():
    python = REPO_ROOT / ".venv-vlm" / "bin" / "python"
    model = Path(os.environ.get("VADTREE_VLM_MODEL", str(REPO_ROOT / "models" / "chinese-clip-vit-base-patch16")))
    deps_ready = False
    if python.exists():
        try:
            proc = subprocess.run(
                [str(python), "-c", "import torch, transformers; print('ok')"],
                capture_output=True, text=True, timeout=20,
            )
            deps_ready = proc.returncode == 0
        except Exception:
            deps_ready = False
    weight_file = model / "pytorch_model.bin"
    weights_complete = weight_file.exists() and weight_file.stat().st_size > 500_000_000
    return {
        "ready": deps_ready and (model / "config.json").exists() and weights_complete,
        "deps_ready": deps_ready,
        "python": str(python) if python.exists() else None,
        "model": str(model),
        "model_present": (model / "config.json").exists(),
        "weights_complete": weights_complete,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
    }
