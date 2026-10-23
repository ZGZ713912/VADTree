"""Background jobs for the evidence console.

Only two kinds of work are exposed, both of which write into runs/<job-id>/
and never into result/:

* reproduce   - run scripts/reproduce.py for selected datasets/steps
* verify      - hash-check the release artifacts against MANIFEST.json
"""
from __future__ import annotations

import json
import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = REPO_ROOT / "runs"
LOG_LIMIT = 48_000
DATASETS = {"UCF", "MSAD", "XD"}
STEPS = {"2", "6", "7"}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _python():
    candidate = REPO_ROOT / ".venv" / "bin" / "python"
    return str(candidate) if candidate.exists() else sys.executable


class JobManager:
    def __init__(self):
        self._jobs = {}
        self._lock = threading.Lock()
        RUNS_DIR.mkdir(parents=True, exist_ok=True)

    def _update(self, job, **fields):
        with self._lock:
            job.update(fields)
            job["updated_at"] = _now()
            self._persist(job)

    def _persist(self, job):
        path = Path(job["dir"]) / "job.json"
        try:
            payload = {k: v for k, v in job.items() if k not in ("log_text", "report")}
            path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def _log_tail(self, job):
        path = Path(job["log_path"])
        if not path.exists():
            return ""
        size = path.stat().st_size
        with open(path, "rb") as fh:
            if size > LOG_LIMIT:
                fh.seek(size - LOG_LIMIT)
            data = fh.read().decode("utf-8", errors="replace")
        return data

    def create(self, kind, datasets=None, steps=None):
        if kind not in ("reproduce", "verify"):
            raise ValueError("unknown job kind")
        datasets = datasets or ["UCF"]
        steps = steps or "6,7"
        if kind == "reproduce":
            bad = set(datasets) - DATASETS
            if bad:
                raise ValueError("unknown dataset: " + ", ".join(sorted(bad)))
            step_set = {s.strip() for s in str(steps).split(",") if s.strip()}
            if not step_set or step_set - STEPS:
                raise ValueError("steps must be a subset of 2,6,7")
            steps = ",".join(sorted(step_set))
        job_id = "job-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
        job_dir = RUNS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        log_path = job_dir / "job.log"
        python = _python()
        if kind == "reproduce":
            cmd = [python, "scripts/reproduce.py", "--steps", steps,
                   "--keep", "--workdir", str(job_dir / "work"),
                   "--out", str(job_dir / "report.json")]
            for ds in datasets:
                cmd += ["--dataset", ds]
        else:
            cmd = [python, "scripts/fetch_artifacts.py", "--verify"]
        job = {
            "id": job_id,
            "kind": kind,
            "status": "queued",
            "created_at": _now(),
            "updated_at": _now(),
            "started_at": None,
            "finished_at": None,
            "datasets": datasets,
            "steps": steps,
            "command": " ".join(cmd),
            "dir": str(job_dir),
            "log_path": str(log_path),
            "exit_code": None,
            "report": None,
            "error": None,
        }
        with self._lock:
            self._jobs[job_id] = job
        self._persist(job)
        thread = threading.Thread(target=self._run, args=(job, cmd, log_path), daemon=True)
        thread.start()
        return self.get(job_id)

    def _run(self, job, cmd, log_path):
        self._update(job, status="running", started_at=_now(), pid=None)
        env = dict(os.environ)
        env["PYTHONUNBUFFERED"] = "1"
        env["MPLBACKEND"] = "Agg"
        try:
            with open(log_path, "w", encoding="utf-8") as log:
                log.write("$ " + " ".join(cmd) + "\n\n")
                log.flush()
                proc = subprocess.Popen(
                    cmd, cwd=str(REPO_ROOT), env=env, stdout=log,
                    stderr=subprocess.STDOUT, text=True, start_new_session=True,
                )
                self._update(job, pid=proc.pid)
                exit_code = proc.wait()
        except Exception as exc:  # noqa: BLE001 - surface the message in the UI
            self._update(job, status="failed", error=str(exc), finished_at=_now())
            return
        report = None
        if job["kind"] == "reproduce":
            report_path = Path(job["dir"]) / "report.json"
            if report_path.exists():
                try:
                    report = json.loads(report_path.read_text(encoding="utf-8"))
                except Exception:
                    report = None
        status = "completed" if exit_code == 0 else "failed"
        self._update(job, status=status, exit_code=exit_code, finished_at=_now(),
                     report=report,
                     error=None if exit_code == 0 else "command exited with %d" % exit_code)

    def get(self, job_id, include_log=True):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            payload = dict(job)
        payload["elapsed"] = round(
            (time.time() - (datetime.fromisoformat(job["started_at"]).timestamp()
                            if job.get("started_at") else time.time())), 1)
        payload["log_text"] = self._log_tail(job) if include_log else ""
        return payload

    def list(self, include_log=False):
        jobs = [self.get(job_id, include_log=include_log) for job_id in self._jobs]
        jobs.sort(key=lambda j: j["created_at"] or "", reverse=True)
        return jobs

    def cancel(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job["status"] not in ("queued", "running"):
                return self.get(job_id)
            pid = job.get("pid")
        if pid:
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except OSError:
                pass
        self._update(job, status="cancelled", finished_at=_now(),
                     error="cancelled by user")
        return self.get(job_id)


manager = JobManager()
