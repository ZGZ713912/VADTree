#!/usr/bin/env python3
"""Local open-vocabulary video query with Chinese-CLIP.

This is a semantic text/image matcher, not an LLM reasoning system. For each
window it compares sampled frames against the user's Chinese description and
several neutral negatives, then reports the best frame and a softmax-based
match score. The score is a heuristic, not a calibrated probability.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kwargs)


def probe(video: Path):
    out = run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=width,height,avg_frame_rate,codec_type",
        "-of", "json", str(video),
    ]).stdout
    data = json.loads(out)
    stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    duration = float(data.get("format", {}).get("duration") or 0)
    fps_raw = stream.get("avg_frame_rate") or "0/1"
    try:
        num, den = fps_raw.split("/")
        fps = float(num) / float(den) if float(den) else 0.0
    except Exception:
        fps = 0.0
    return {
        "duration": round(duration, 3),
        "fps": round(fps, 3),
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
    }


def windows_for(duration: float, window: float, stride: float, max_windows: int):
    if duration <= 0:
        return []
    if duration <= window:
        return [(0.0, round(duration, 3))]
    starts = []
    start = 0.0
    while start + window <= duration + 0.05:
        starts.append(round(start, 3))
        start += stride
    if not starts or starts[-1] + window < duration - 0.25:
        starts.append(round(max(0.0, duration - window), 3))
    if max_windows and len(starts) > max_windows:
        idx = [round(i * (len(starts) - 1) / (max_windows - 1)) for i in range(max_windows)]
        starts = [starts[i] for i in sorted(set(idx))]
    return [(s, round(min(duration, s + window), 3)) for s in starts]


def extract_frames(video: Path, start: float, end: float, frames: int, work: Path):
    length = max(0.2, end - start)
    fps = max(0.1, frames / length)
    out_pattern = work / "frame_%03d.jpg"
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(video),
        "-vf", f"fps={fps:.4f},scale='min(448,iw)':-2",
        "-frames:v", str(frames), "-q:v", "3", str(out_pattern),
    ])
    return sorted(work.glob("frame_*.jpg"))


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--description", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--thumb-dir", default="")
    ap.add_argument("--model", default=os.environ.get("VADTREE_VLM_MODEL", "models/chinese-clip-vit-base-patch16"))
    ap.add_argument("--window", type=float, default=8.0)
    ap.add_argument("--stride", type=float, default=4.0)
    ap.add_argument("--frames", type=int, default=6)
    ap.add_argument("--max-windows", type=int, default=12)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    video = Path(args.video).resolve()
    out = Path(args.out).resolve()
    thumb_dir = Path(args.thumb_dir).resolve() if args.thumb_dir else None
    if not video.exists():
        sys.exit("video not found: %s" % video)
    description = args.description.strip()
    if not description:
        sys.exit("description is empty")
    meta = probe(video)
    wins = windows_for(meta["duration"], args.window, args.stride, args.max_windows)
    if not wins:
        sys.exit("could not derive windows (duration=%s)" % meta["duration"])

    payload = {
        "status": "running",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "description": description,
        "video": {"path": str(video), **meta},
        "settings": {"window": args.window, "stride": args.stride,
                     "frames": args.frames, "max_windows": args.max_windows},
        "windows": [],
        "aggregate": None,
        "model": Path(args.model).name,
        "backend": "chinese-clip",
    }
    write_json(out, payload)

    import torch
    from PIL import Image
    from transformers import ChineseCLIPModel, ChineseCLIPProcessor

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    print("DEVICE", device, flush=True)
    processor = ChineseCLIPProcessor.from_pretrained(args.model)
    model = ChineseCLIPModel.from_pretrained(args.model, torch_dtype=torch.float32).to(device)
    model.eval()
    print("LOADED_MODEL", args.model, flush=True)

    positives = [
        "一张照片，内容为：" + description,
        "监控画面中出现：" + description,
        description,
    ]
    negatives = [
        "一段正常的监控视频，没有异常事件",
        "画面中只有普通的日常活动",
        "一个空无一人的静态场景",
        "画面与描述无关",
    ]
    texts = positives + negatives
    n_pos = len(positives)

    root = Path(tempfile.mkdtemp(prefix="vadtree-clip-"))
    try:
        for idx, (start, end) in enumerate(wins, 1):
            work = root / ("w%03d" % idx)
            work.mkdir(parents=True, exist_ok=True)
            try:
                frames = extract_frames(video, start, end, args.frames, work)
            except Exception as exc:
                print("WINDOW %d/%d %s-%s FRAME_ERROR %s" % (idx, len(wins), start, end, exc), flush=True)
                frames = []
            if not frames:
                payload["windows"].append({
                    "index": idx, "start": start, "end": end, "probability": 0,
                    "evidence": "无法抽取视频帧", "evidence_frames": [], "thumb": None,
                })
                write_json(out, payload)
                continue
            images = [Image.open(str(frame)).convert("RGB") for frame in frames]
            inputs = processor(text=texts, images=images, return_tensors="pt",
                               padding=True, truncation=True, max_length=64)
            inputs = {key: value.to(device) for key, value in inputs.items()}
            with torch.inference_mode():
                logits = model(**inputs).logits_per_image
                # Compare the best positive prompt against the strongest
                # neutral prompt. Raw CLIP logits are scaled cosine scores;
                # dividing by 2 keeps the sigmoid from saturating on tiny
                # differences. This is a heuristic calibration, not a
                # statistically calibrated probability.
                pos = logits[:, :n_pos].max(dim=1).values
                neg = logits[:, n_pos:].max(dim=1).values
                frame_scores = torch.sigmoid((pos - neg) / 2.0)
            values = [int(round(float(v) * 100)) for v in frame_scores]
            best_local = max(range(len(values)), key=lambda i: values[i])
            prob = values[best_local]
            thumb_name = None
            if thumb_dir:
                thumb_dir.mkdir(parents=True, exist_ok=True)
                thumb_name = "w%03d.jpg" % idx
                shutil.copy2(frames[best_local], thumb_dir / thumb_name)
            payload["windows"].append({
                "index": idx, "start": start, "end": end,
                "probability": prob,
                "evidence": "第 %d 帧与描述最匹配（图文匹配 %d%%）" % (best_local + 1, prob),
                "evidence_frames": [best_local + 1],
                "thumb": thumb_name,
            })
            write_json(out, payload)
            print("WINDOW %d/%d %s-%s p=%d" % (idx, len(wins), start, end, prob), flush=True)
            if device.startswith("cuda"):
                torch.cuda.empty_cache()

        ws = payload["windows"]
        if not ws:
            sys.exit("no windows processed")
        best = max(ws, key=lambda w: w.get("probability", 0))
        mean = sum(w.get("probability", 0) for w in ws) / len(ws)
        score = int(best.get("probability", 0))
        if score >= 70:
            verdict = "疑似出现"
        elif score >= 45:
            verdict = "不确定"
        else:
            verdict = "未发现"
        payload["aggregate"] = {
            "score": score,
            "verdict": verdict,
            "mean_probability": round(mean, 1),
            "best_window": best.get("index"),
            "best_start": best.get("start"),
            "best_end": best.get("end"),
            "coverage": [w for w in ws if w.get("probability", 0) >= 50],
            "windows_total": len(ws),
        }
        payload["status"] = "completed"
        payload["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        write_json(out, payload)
        print("RESULT score=%d verdict=%s" % (score, verdict), flush=True)
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
