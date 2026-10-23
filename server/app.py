#!/usr/bin/env python3
"""Local HTTP API + static server for the VADTree evidence console.

Run:
    .venv/bin/python -m server.app --port 8765

The server binds to 127.0.0.1 by default and has no authentication: it is a
single-user local tool. Do not expose it on a public interface.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import math
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import data, health, pipeline
from .jobs import manager

REPO_ROOT = Path(__file__).resolve().parent.parent
WEBUI_DIST = REPO_ROOT / "webui" / "dist"


def clean(value):
    """Strict-JSON cleanup: NaN/inf -> None, Path -> str."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, Path):
        return str(value)
    return value


class Handler(BaseHTTPRequestHandler):
    server_version = "VADTreeConsole/1.0"

    # -- plumbing ---------------------------------------------------------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, payload, status=200, cache="no-store"):
        body = json.dumps(clean(payload), ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message, status=400):
        self._json({"error": str(message)}, status=status)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise ValueError("invalid JSON body: %s" % exc)

    def log_message(self, fmt, *args):
        # Keep the console quiet; jobs have their own logs.
        if "/api/" in (args[0] if args else ""):
            return

    # -- routing ----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = {k: v[-1] for k, v in parse_qs(parsed.query).items()}
        try:
            if path.startswith("/api/"):
                self._api_get(path, query)
            else:
                self._static(path)
        except BrokenPipeError:
            return
        except Exception as exc:  # noqa: BLE001
            self._error("internal error: %s" % exc, status=500)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path == "/api/jobs":
                body = self._read_json()
                job = manager.create(
                    body.get("kind", "reproduce"),
                    datasets=body.get("datasets") or ["UCF"],
                    steps=body.get("steps") or "6,7",
                )
                self._json(job, status=201)
            elif path.startswith("/api/jobs/") and path.endswith("/cancel"):
                job_id = path[len("/api/jobs/"):-len("/cancel")].strip("/")
                job = manager.cancel(job_id)
                if not job:
                    self._error("job not found", 404)
                else:
                    self._json(job)
            else:
                self._error("not found", 404)
        except BrokenPipeError:
            return
        except Exception as exc:  # noqa: BLE001
            self._error("internal error: %s" % exc, status=500)

    def _api_get(self, path, query):
        if path == "/api/health":
            self._json(health.environment(force=query.get("refresh") == "1"))
        elif path == "/api/overview":
            self._json(data.overview(query.get("dataset")))
        elif path == "/api/runs":
            self._json({"runs": data.runs()})
        elif path.startswith("/api/runs/"):
            run_id = path[len("/api/runs/"):].strip("/")
            run = data.get_run(run_id)
            if not run:
                self._error("run not found", 404)
                return
            try:
                videos = data.video_records(run)
            except Exception:
                videos = []
            self._json({"run": run, "videos": videos,
                        "categories": run["metrics"].get("categories", [])})
        elif path == "/api/evidence":
            run_id = query.get("run", "")
            video = query.get("video", "")
            if not run_id or not video:
                self._error("run and video are required", 400)
                return
            try:
                self._json(data.evidence(run_id, video))
            except KeyError as exc:
                self._error(str(exc), 404)
        elif path == "/api/artifacts":
            self._json(data.artifacts())
        elif path == "/api/reproduction":
            self._json(data.reproduction_summary() or {})
        elif path == "/api/pipeline":
            self._json(pipeline.build())
        elif path == "/api/jobs":
            self._json({"jobs": manager.list()})
        elif path.startswith("/api/jobs/"):
            job_id = path[len("/api/jobs/"):].strip("/")
            job = manager.get(job_id)
            if not job:
                self._error("job not found", 404)
            else:
                self._json(job)
        elif path == "/api/search":
            self._json({"hits": data.search(query.get("q", ""))})
        else:
            self._error("not found", 404)

    # -- static -----------------------------------------------------------
    def _static(self, path):
        if not WEBUI_DIST.exists():
            body = (
                "<!doctype html><meta charset='utf-8'><title>VADTree console</title>"
                "<body style='font-family:system-ui;padding:48px;background:#F4EFE4;color:#191713'>"
                "<h1>VADTree console</h1><p>Frontend is not built yet.</p>"
                "<pre>cd webui && npm install && npm run build</pre>"
                "<p>API is available under <code>/api</code>.</p></body>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        rel = path.lstrip("/")
        candidate = (WEBUI_DIST / rel).resolve()
        dist_root = WEBUI_DIST.resolve()
        if not candidate.is_relative_to(dist_root):
            self._error("forbidden", 403)
            return
        if not candidate.exists() or candidate.is_dir():
            candidate = WEBUI_DIST / "index.html"
        if not candidate.exists():
            self._error("not found", 404)
            return
        body = candidate.read_bytes()
        ctype = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if candidate.name == "index.html":
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description="VADTree evidence console")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    httpd = Server((args.host, args.port), Handler)
    print("VADTree console: http://%s:%d" % (args.host, args.port), flush=True)
    print("API:            http://%s:%d/api/health" % (args.host, args.port), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    sys.exit(main())
