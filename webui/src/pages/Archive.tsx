import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, formatBytes, formatNumber, relativeTime } from "../api";
import { ArrowIcon, BlockIcon, CheckIcon, WarnIcon } from "../components/Icons";
import { StatusTag } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { Artifacts, Health, Job, Reproduction } from "../types";

function rocOf(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const metric = value as Record<string, unknown>;
  const direct = metric.roc_auc;
  if (typeof direct === "number") return direct;
  const nested = metric.all;
  if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).roc_auc === "number") {
    return (nested as Record<string, number>).roc_auc;
  }
  return null;
}

function EvidenceIconForStatus({ status }: { status: string }) {
  if (status === "pass") return <CheckIcon size={12} />;
  if (status === "warning") return <WarnIcon size={12} />;
  return <BlockIcon size={12} />;
}

function VerifyPanel({ artifacts }: { artifacts: Artifacts | null }) {
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = job?.status === "running" || job?.status === "queued";

  useEffect(() => {
    if (!job || !running) return;
    let live = true;
    const handle = window.setInterval(async () => {
      try {
        const next = await api.job(job.id);
        if (live) setJob(next);
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => {
      live = false;
      window.clearInterval(handle);
    };
  }, [job?.id, running]);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      setJob(await api.createJob({ kind: "verify", datasets: [], steps: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="archive-actions">
        <button className="button button--ghost" onClick={verify} disabled={busy || running}>
          {running ? "hashing artifacts…" : "verify artifact hashes"}
        </button>
        <span className="micro">compares every shipped file against MANIFEST.json</span>
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      {job ? (
        <>
          <div className="repro-detail__status">
            <StatusTag status={job.status} />
            <span className="mono" style={{ fontSize: 9 }}>{job.id} · {job.elapsed}s</span>
          </div>
          <pre className="verify-log">{job.log_text || "waiting for output…"}</pre>
        </>
      ) : null}
      {artifacts ? (
        <div className="archive-note">
          {artifacts.manifest?.repo ?? "—"} · {artifacts.manifest?.release_tag ?? "—"} · cache{" "}
          {formatBytes(artifacts.cache_bytes)}
        </div>
      ) : null}
    </>
  );
}

export default function ArchivePage() {
  useTitle("Archive");
  const artifacts = useAsync<Artifacts>(() => api.artifacts(), []);
  const health = useAsync<Health>(() => api.health(), []);
  const repro = useAsync<Reproduction>(() => api.reproduction(), []);
  const bundles = artifacts.data?.bundles ?? [];
  const present = bundles.reduce((sum, bundle) => sum + bundle.present, 0);
  const files = bundles.reduce((sum, bundle) => sum + bundle.files, 0);
  const counts = repro.data?.counts ?? {};
  const totalChecks = (counts.pass ?? 0) + (counts.warning ?? 0) + (counts.fail ?? 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">
            <span>Archive / proof</span><span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>{present}/{files} files on disk</span>
          </div>
          <h1 className="page-head__title">The proof, <em>in the archive.</em></h1>
          <p className="page-head__lede">
            Release manifest, local environment, and the reproduction checks that back the numbers on the desk.
            Missing files and non-bit-identical warnings stay in the record.
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">RELEASE ARTIFACTS</span>
          <div className="stamp">
            <b>{bundles.length} bundles / {files} files</b>
            {formatBytes(artifacts.data?.manifest?.total_bytes)} shipped<br />
            {totalChecks} reproduction checks<br />
            git {health.data?.git ?? "—"}
          </div>
        </div>
      </header>

      <div className="archive-grid">
        <section>
          <div className="section-head">
            <div className="section-head__left">
              <span className="section-head__index">01</span>
              <h2 className="section-head__title">Manifest bundles</h2>
            </div>
            <div className="section-head__note">Required bundles are needed for steps 2/6/7; optional bundles carry CoT or convenience outputs.</div>
          </div>
          {artifacts.loading && !artifacts.data ? <div className="loading">reading manifest…</div> : null}
          {artifacts.error ? <div className="error-box">{artifacts.error}</div> : null}
          {bundles.map((bundle) => {
            const ratio = bundle.files ? bundle.present / bundle.files : 0;
            return (
              <div className="bundle" key={bundle.name}>
                <div>
                  <div className="bundle__name">{bundle.name}</div>
                  <div className="bundle__meta">
                    steps {bundle.steps.length ? bundle.steps.join(", ") : "—"} · {bundle.required ? "required" : "optional"}
                    {bundle.stripped_cot ? " · CoT stripped" : ""}
                    {bundle.full_cot ? " · " + bundle.full_cot + " full-CoT variant on disk" : ""}
                  </div>
                  <div className="bundle__bar" aria-hidden="true">
                    <span style={{ width: ratio * 100 + "%" }} />
                  </div>
                </div>
                <div className="bundle__size">{formatBytes(bundle.bytes)}</div>
                <div className="bundle__status">
                  <StatusTag
                    status={bundle.missing_count ? "warning" : "pass"}
                    label={bundle.present + "/" + bundle.files}
                  />
                </div>
              </div>
            );
          })}
          <VerifyPanel artifacts={artifacts.data} />
          <div className="archive-note">
            Full CoT copies are accepted by the verifier via a normalised hash; the manifest itself records the
            stripped release form. See <span className="mono">docs/REPRODUCTION.md</span> and{" "}
            <span className="mono">repro/latest.json</span>.
          </div>
        </section>

        <aside>
          <div className="section-head">
            <div className="section-head__left">
              <span className="section-head__index">02</span>
              <h2 className="section-head__title">This machine</h2>
            </div>
          </div>
          {health.loading && !health.data ? <div className="loading">checking…</div> : null}
          {health.data ? (
            <div className="env-list">
              {[
                ["python", health.data.venv.python ? health.data.venv.python + " · " + (health.data.venv.present ? "venv ready" : "no venv") : "missing .venv"],
                ["numpy", health.data.packages.numpy ?? "—"],
                ["scipy", health.data.packages.scipy ?? "—"],
                ["sklearn", health.data.packages.sklearn ?? "—"],
                ["gpu", health.data.gpu ? health.data.gpu.name + " · " + health.data.gpu.memory : "cpu only"],
                ["result", formatBytes(health.data.result.bytes) + " · " + health.data.result.files + " files"],
                ["disk free", formatBytes(health.data.disk.free)],
                ["videos", health.data.videos.configured ? health.data.videos.root : "not configured"],
                ["weights", Object.values(health.data.weights).filter((weight) => weight.present).length + "/" + Object.keys(health.data.weights).length + " configured"],
                ["git", health.data.git ?? "—"],
              ].map(([label, value]) => (
                <div className="env-row" key={label}>
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
          ) : null}
          {health.data && !health.data.videos.configured ? (
            <div className="archive-note">
              Steps 1/3/4/5 remain blocked. Set <span className="mono">VADTREE_VIDEO_ROOT</span> and the model
              environment variables to attempt them; the current desk only claims what it can verify.
            </div>
          ) : null}
          <Link className="section-head__action" to="/pipeline" style={{ display: "inline-flex", marginTop: 14, alignItems: "center", gap: 4 }}>
            open pipeline <ArrowIcon size={10} />
          </Link>
        </aside>
      </div>

      <section className="archive-section">
        <div className="section-head">
          <div className="section-head__left">
            <span className="section-head__index">03</span>
            <h2 className="section-head__title">Reproduction checks</h2>
          </div>
          <div className="section-head__note">
            {counts.pass ?? 0} passed · {counts.warning ?? 0} warning · {counts.fail ?? 0} failed ·{" "}
            {repro.data?.generated_at ? relativeTime(repro.data.generated_at) : "not run"}
          </div>
        </div>
        <div className="repro-table">
          {(repro.data?.checks ?? []).map((check) => (
            <div className="repro-row" key={check.id}>
              <div>
                <div className="repro-row__id">{check.id}</div>
                <div className="repro-row__detail">
                  {check.detail ?? "—"}
                  {check.published_metric && check.reproduced_metric ? (
                    <>
                      {" "}· published {formatNumber(rocOf(check.published_metric), 4)}
                      {" "}→ reproduced {formatNumber(rocOf(check.reproduced_metric), 4)}
                    </>
                  ) : null}
                  {check.max_score_delta !== null && check.max_score_delta !== undefined ? (
                    <> · max score Δ {formatNumber(check.max_score_delta, 4)}</>
                  ) : null}
                </div>
              </div>
              <div className="repro-detail__status">
                <EvidenceIconForStatus status={check.status} />
                <StatusTag status={check.status} />
              </div>
            </div>
          ))}
          {!(repro.data?.checks ?? []).length ? (
            <div className="empty">No reproduction report found. Run <span className="mono">scripts/reproduce.py</span>.</div>
          ) : null}
        </div>
        <div className="archive-note">
          Pass means scores and aggregate ROC/PR match; warnings are explicitly non-bit-identical but within the
          documented tolerance. See <span className="mono">docs/REPRODUCTION.md</span>.
        </div>
      </section>
    </div>
  );
}
