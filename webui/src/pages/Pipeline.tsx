import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api, formatBytes, formatNumber, relativeTime } from "../api";
import { ArrowIcon, PlayIcon, StopIcon } from "../components/Icons";
import { StatusTag } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { Health, Job, Pipeline } from "../types";

const DATASETS = [
  { id: "UCF", label: "UCF-Crime" },
  { id: "MSAD", label: "MSAD" },
  { id: "XD", label: "XD-Violence" },
];

const STEPS = [
  { id: "2", label: "HGTree" },
  { id: "6", label: "Refinement" },
  { id: "7", label: "Ensemble" },
];

function EnvironmentSummary({ health }: { health: Health | null }) {
  if (!health) return <div className="loading">checking environment…</div>;
  const videos = health.videos;
  return (
    <div className="env-summary">
      <div className="env-summary__head">
        <span className="micro">Environment / local</span>
        <span className="tag tag--moss">{health.dist_built ? "console built" : "api ready"}</span>
      </div>
      <div className="env-summary__grid">
        <div><span>python</span><b>{health.venv.python ?? "—"}</b></div>
        <div><span>numpy</span><b>{health.packages.numpy ?? "—"}</b></div>
        <div><span>sklearn</span><b>{health.packages.sklearn ?? "—"}</b></div>
        <div><span>gpu</span><b>{health.gpu?.name ?? "cpu only"}</b></div>
        <div><span>result</span><b>{formatBytes(health.result.bytes)}</b></div>
        <div><span>videos</span><b className={videos.configured ? "" : "ochre"}>{videos.configured ? "configured" : "not configured"}</b></div>
      </div>
      <div className="env-summary__note">
        {videos.configured
          ? "Raw videos are available; steps 1/3/4/5 can be attempted with the matching checkpoints."
          : "Steps 1/3/4/5 are blocked: no raw video root is configured. Steps 2/6/7 only need the published JSON/pickles."}
      </div>
      <Link className="section-head__action" to="/archive">full environment <ArrowIcon size={10} /></Link>
    </div>
  );
}

function StageList({ pipeline }: { pipeline: Pipeline | null }) {
  if (!pipeline) return <div className="loading">reading stage status…</div>;
  return (
    <div className="stage-list">
      {pipeline.stages.map((stage) => (
        <article className="stage" key={stage.id}>
          <div className="stage__num">{String(stage.id).padStart(2, "0")}</div>
          <div>
            <div className="stage__head">
              <h2 className="stage__name">{stage.name}</h2>
              <span className="stage__owner">{stage.owner}</span>
            </div>
            <p className="stage__note">{stage.note}</p>
            <div className="stage__meta">
              <span><b>needs</b> {stage.needs.join(" · ")}</span>
              <span><b>writes</b> {stage.outputs.join(" · ")}</span>
            </div>
            <div className="stage__cmd">{stage.command}</div>
            {stage.blockers.length ? (
              <div className="stage__blockers">blocked · {stage.blockers.join(" · ")}</div>
            ) : null}
          </div>
          <div className="stage__side">
            <StatusTag status={stage.status} />
            {stage.checks.length ? (
              <div className="stage__checks">
                {stage.checks.map((check) => (
                  <div className="stage-check" key={check.id}>
                    <span>{check.id.replace(/^(UCF_Crime_test|MSAD_test|XD_Violence_test)-/, "")}</span>
                    <b className={check.status === "warning" ? "ochre" : check.status === "pass" ? "moss" : "red"}>
                      {check.status}
                      {check.delta !== null && check.delta !== undefined ? " Δ" + check.delta : ""}
                    </b>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function JobConsole({ job }: { job: Job | null }) {
  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log_text]);
  if (!job) {
    return (
      <div className="job-console">
        <div className="job-console__head">
          <h2 className="job-console__title">No job selected</h2>
          <span className="micro">sandbox · runs/&lt;id&gt;/</span>
        </div>
        <div className="empty">Run a verification or an artifact check. Logs and generated files stay under runs/.</div>
      </div>
    );
  }
  const report = job.report;
  const checks = report?.checks ?? [];
  return (
    <div className="job-console">
      <div className="job-console__head">
        <div>
          <h2 className="job-console__title">{job.kind === "verify" ? "Artifact check" : "Reproduction job"}</h2>
          <div className="micro">
            {job.id} · {job.datasets.join(", ") || "manifest"} {job.steps ? "· steps " + job.steps : ""} · {job.elapsed}s
          </div>
        </div>
        <StatusTag status={job.status} />
      </div>
      <pre className="job-console__log" ref={logRef}>{job.log_text || "waiting for output…"}</pre>
      {checks.length ? (
        <div className="job-report">
          <div className="micro" style={{ marginBottom: 5 }}>Report summary</div>
          {checks.map((check) => (
            <div className="job-report__row" key={check.id}>
              <span>{check.id}</span>
              <StatusTag status={check.status} />
              <span className="mono">{check.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
      {job.error ? <div className="error-box" style={{ marginTop: 10 }}>{job.error}</div> : null}
    </div>
  );
}

export default function PipelinePage() {
  useTitle("Pipeline");
  const pipeline = useAsync<Pipeline>(() => api.pipeline(), []);
  const health = useAsync<Health>(() => api.health(), []);
  const jobsQuery = useAsync(() => api.jobs(), []);
  const [datasets, setDatasets] = useState<string[]>(["UCF"]);
  const [steps, setSteps] = useState<string[]>(["2", "6", "7"]);
  const [active, setActive] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const jobs = jobsQuery.data?.jobs ?? [];
  const busy = active?.status === "queued" || active?.status === "running";

  useEffect(() => {
    if (!active || (active.status !== "queued" && active.status !== "running")) return;
    let live = true;
    const handle = window.setInterval(async () => {
      try {
        const next = await api.job(active.id);
        if (live) {
          setActive(next);
          if (next.status !== "queued" && next.status !== "running") {
            jobsQuery.reload();
            pipeline.reload();
          }
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => {
      live = false;
      window.clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.status]);

  const toggle = (value: string, list: string[], set: (next: string[]) => void) => {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const run = async () => {
    if (!datasets.length || !steps.length) {
      setMessage("Pick at least one dataset and one stage.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const job = await api.createJob({ kind: "reproduce", datasets, steps: steps.join(",") });
      setActive(job);
      jobsQuery.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      const job = await api.createJob({ kind: "verify", datasets: [], steps: "" });
      setActive(job);
      jobsQuery.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const stop = async () => {
    if (!active) return;
    try {
      setActive(await api.cancelJob(active.id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const repro = pipeline.data?.reproduction;
  const counts = repro?.counts ?? {};
  const total = (counts.pass ?? 0) + (counts.warning ?? 0) + (counts.fail ?? 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">
            <span>Pipeline / docket</span><span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>{total ? total + " checks" : "not checked"}</span>
          </div>
          <h1 className="page-head__title">The docket, <em>with receipts.</em></h1>
          <p className="page-head__lede">
            Steps 2, 6 and 7 are deterministic and can be re-run into a sandbox. Steps 1, 3, 4 and 5 need raw
            videos and model checkpoints; this desk says so instead of offering a dead button.
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">LOCAL EXECUTION</span>
          <div className="stamp">
            <b>sandbox · runs/&lt;job-id&gt;/</b>
            no writes to result/<br />
            log · report.json<br />
            {busy ? "job running" : "idle"}
          </div>
        </div>
      </header>

      <div className="pipeline-top">
        <section className="run-panel" aria-labelledby="run-verification">
          <div className="run-panel__head">
            <h2 className="run-panel__title" id="run-verification">Run a verification</h2>
            <span className="micro">{busy ? "busy" : "ready"}</span>
          </div>
          <div className="run-panel__body">
            <div>
              <div className="micro" style={{ marginBottom: 6 }}>Datasets</div>
              <div className="check-row">
                {DATASETS.map((dataset) => (
                  <label className="check" key={dataset.id}>
                    <input
                      type="checkbox"
                      checked={datasets.includes(dataset.id)}
                      onChange={() => toggle(dataset.id, datasets, setDatasets)}
                    />
                    {dataset.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="micro" style={{ marginBottom: 6 }}>Stages</div>
              <div className="check-row">
                {STEPS.map((step) => (
                  <label className="check" key={step.id}>
                    <input
                      type="checkbox"
                      checked={steps.includes(step.id)}
                      onChange={() => toggle(step.id, steps, setSteps)}
                    />
                    {step.id} · {step.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="run-panel__actions">
            <button className="button" onClick={run} disabled={submitting || busy}>
              <PlayIcon size={11} /> {busy ? "running…" : "run verification"}
            </button>
            {busy ? (
              <button className="button button--ghost" onClick={stop}><StopIcon size={11} /> stop</button>
            ) : null}
            <button className="button button--ghost" onClick={verify} disabled={submitting || busy}>
              verify artifacts
            </button>
          </div>
          <p className="run-panel__note">
            The job shells out to <span className="mono">scripts/reproduce.py</span> and compares scores plus
            aggregate ROC/PR with the published JSON. It never writes into <span className="mono">result/</span>.
          </p>
          {message ? <div className="error-box" style={{ marginTop: 10 }}>{message}</div> : null}
          {active ? (
            <div className="run-panel__active">
              <StatusTag status={active.status} />
              <span className="mono">{active.id}</span>
              <button className="section-head__action" onClick={() => setActive(null)}>clear</button>
            </div>
          ) : null}
        </section>
        <EnvironmentSummary health={health.data} />
      </div>

      <section className="section" style={{ marginTop: 30 }}>
        <div className="section-head">
          <div className="section-head__left">
            <span className="section-head__index">01</span>
            <h2 className="section-head__title">Seven stages</h2>
          </div>
          <div className="section-head__note">
            verified · checked against released JSON · warning · non-bit-identical but close · asset · present but not regenerated
          </div>
        </div>
        <StageList pipeline={pipeline.data} />
      </section>

      <section className="section">
        <div className="section-head">
          <div className="section-head__left">
            <span className="section-head__index">02</span>
            <h2 className="section-head__title">Job console</h2>
          </div>
          <div className="section-head__note">Every run is local, logged, and disposable.</div>
        </div>
        <JobConsole job={active} />
        <div className="job-list">
          {jobs.length ? jobs.slice(0, 8).map((job) => (
            <button className="job-row" key={job.id} onClick={() => setActive(job)}>
              <span><b>{job.id}</b> · {job.kind} · {job.datasets.join(", ") || "manifest"} {job.steps ? "· " + job.steps : ""}</span>
              <StatusTag status={job.status} />
              <span>{relativeTime(job.created_at)}</span>
              <span>{job.elapsed}s</span>
            </button>
          )) : <div className="empty">No jobs yet. The first verification will appear here.</div>}
        </div>
      </section>
    </div>
  );
}
