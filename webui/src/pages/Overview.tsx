import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, formatNumber } from "../api";
import { CategoryLollipop, MetricRuler, ScoreStrip } from "../components/Charts";
import { StatusDot, StatusTag } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { DatasetSummary, Metrics, Overview, Pipeline, Reproduction } from "../types";

function SectionHead({
  index, title, note, action,
}: { index: string; title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="section-head__left">
        <span className="section-head__index">{index}</span>
        <h2 className="section-head__title">{title}</h2>
      </div>
      <div className="section-head__note">{note}</div>
      {action ? <div className="section-head__action">{action}</div> : null}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {note ? <div className="stat__note">{note}</div> : null}
    </div>
  );
}

function ReproStamp({ repro }: { repro: Reproduction | null }) {
  if (!repro) {
    return (
      <div className="repro-stamp">
        <div className="repro-stamp__head">
          <span className="micro">REPRODUCTION</span>
          <StatusTag status="untested" />
        </div>
        <div className="repro-stamp__count">—</div>
        <div className="repro-stamp__rows">
          <div className="repro-stamp__row"><span>status</span><b>not run on this checkout</b></div>
        </div>
      </div>
    );
  }
  const counts = repro.counts ?? {};
  const total = (counts.pass ?? 0) + (counts.warning ?? 0) + (counts.fail ?? 0);
  return (
    <div className="repro-stamp">
      <div className="repro-stamp__head">
        <span className="micro">REPRODUCTION / THIS MACHINE</span>
        <span className="tag tag--moss">LOCAL</span>
      </div>
      <div className="repro-stamp__count">
        {counts.pass ?? 0}<span> / {total} checks</span>
      </div>
      <div className="repro-stamp__rows">
        <div className="repro-stamp__row"><span>passed</span><b>{counts.pass ?? 0}</b></div>
        <div className="repro-stamp__row"><span>warnings</span><b>{counts.warning ?? 0}</b></div>
        <div className="repro-stamp__row"><span>failed</span><b>{counts.fail ?? 0}</b></div>
        <div className="repro-stamp__row">
          <span>generated</span>
          <b>{repro.generated_at ? repro.generated_at.slice(0, 16).replace("T", " ") : "—"}</b>
        </div>
      </div>
    </div>
  );
}

function DatasetStats({ dataset, metrics }: { dataset: DatasetSummary; metrics: Metrics }) {
  return (
    <div className="stat-grid">
      <Stat label="PR AUC" value={formatNumber(metrics.pr_auc, 4)} note="precision–recall" />
      <Stat label="VIDEOS" value={dataset.videos} note="scored in this tree" />
      <Stat label="RUNS" value={dataset.runs} note="refine + ensemble" />
      <Stat
        label="COARSE BASE"
        value={formatNumber(dataset.baseline?.coarse?.roc_auc, 4)}
        note="single granularity"
      />
    </div>
  );
}

function PipelineLedger({ pipeline }: { pipeline: Pipeline | null }) {
  if (!pipeline) return <div className="loading">reading docket…</div>;
  return (
    <div className="ledger">
      {pipeline.stages.map((stage) => (
        <Link className="ledger__row" to="/pipeline" key={stage.id}>
          <span className="ledger__num">{String(stage.id).padStart(2, "0")}</span>
          <span className="ledger__name">
            {stage.name}
            <span className="ledger__note">{stage.owner} · {stage.needs[0]}</span>
          </span>
          <span className="ledger__status">
            <StatusDot status={stage.status} />
            {stage.status}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  useTitle("Desk");
  const [params, setParams] = useSearchParams();
  const requested = params.get("dataset") ?? undefined;
  const overview = useAsync<Overview>(() => api.overview(requested), [requested]);
  const pipeline = useAsync<Pipeline>(() => api.pipeline(), []);
  const data = overview.data;
  const selected = data?.datasets.find((item) => item.id === data.selected) ?? data?.datasets[0];
  const best = data?.best_run ?? null;
  const coarse = selected?.baseline?.coarse ?? null;
  const delta = best && coarse && best.metrics.roc_auc !== null && coarse.roc_auc !== null
    ? best.metrics.roc_auc - coarse.roc_auc
    : null;
  const highest = selected?.highest_run;

  if (overview.loading && !data) {
    return <div className="loading">opening the case register…</div>;
  }
  if (overview.error) {
    return <div className="error-box">Could not read the evidence API. {overview.error}</div>;
  }
  if (!data || !selected || !best) {
    return <div className="empty">No completed runs found under result/. Restore the release artifacts first.</div>;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">
            <span>Desk / case register</span>
            <span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>issue 001</span>
          </div>
          <h1 className="page-head__title">Anomaly, <em>with a paper trail.</em></h1>
          <p className="page-head__lede">
            Read every score back to a video, an HGTree node, and the sentence the model used to justify it.
            This desk is a local index of the released VADTree runs — no demo data, no hidden reruns.
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">LOCAL EVIDENCE CONSOLE</span>
          <div className="stamp">
            <b>{data.counts.datasets} datasets / {data.counts.runs} runs</b>
            {data.counts.videos.toLocaleString()} scored videos<br />
            {selected.label} featured<br />
            machine · 4060 Ti
          </div>
        </div>
      </header>

      <section className="hero" aria-labelledby="featured-metric">
        <div className="hero__metric">
          <div className="metric__top">
            <span className="micro" id="featured-metric">Featured run / {selected.label}</span>
            <span className="tag tag--red">ENSEMBLE</span>
          </div>
          <div className="metric__value">
            {formatNumber(best.metrics.roc_auc, 4)}
            <small>ROC AUC</small>
          </div>
          <div className="metric__caption">
            {best.label} · {best.videos} videos · {best.kind === "ensemble" ? "coarse + fine correlation" : "single granularity"}
          </div>
          {delta !== null ? (
            <div className={"metric__delta" + (delta < 0 ? " metric__delta--warn" : "")}>
              <span className="dot dot--sm" />
              {delta >= 0 ? "+" : ""}{delta.toFixed(4)} vs coarse baseline {formatNumber(coarse?.roc_auc, 4)}
            </div>
          ) : null}
          <MetricRuler value={best.metrics.roc_auc} />
        </div>
        <div className="hero__side">
          <div className="dataset-tabs" role="tablist" aria-label="Dataset">
            {data.datasets.map((dataset) => (
              <button
                key={dataset.id}
                role="tab"
                aria-selected={dataset.id === selected.id}
                className={"dataset-tab" + (dataset.id === selected.id ? " is-active" : "")}
                onClick={() => setParams(dataset.id === "UCF_Crime_test" ? {} : { dataset: dataset.id })}
              >
                {dataset.short}
              </button>
            ))}
          </div>
          <DatasetStats dataset={selected} metrics={best.metrics} />
          {highest && highest.id !== best.id ? (
            <div className="highest">
              Highest in this register: <b>{formatNumber(highest.metrics.roc_auc, 4)}</b><br />
              {highest.label} · a non-headline variant, kept visible rather than promoted.
            </div>
          ) : (
            <div className="highest">
              <b>{selected.blurb}</b>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <SectionHead
          index="01"
          title="Score atlases"
          note="Twelve real videos from the featured run. Peaks are not thumbnails; they are the published anomaly scores."
          action={<Link to={"/evidence?run=" + encodeURIComponent(best.id) + "&video=" + encodeURIComponent(data.strips[0]?.name ?? "")}>open evidence →</Link>}
        />
        {data.strips.length ? (
          <div className="atlas-grid">
            {data.strips.map((strip) => <ScoreStrip key={strip.name} runId={best.id} strip={strip} />)}
          </div>
        ) : (
          <div className="empty">The featured run has no per-video strips yet.</div>
        )}
      </section>

      <section className="section">
        <div className="two-col">
          <div>
            <SectionHead
              index="02"
              title="Category ledger"
              note="ROC AUC by published category. Normal has no ROC (all negatives) and is omitted."
            />
            <CategoryLollipop categories={data.categories} />
            <p className="muted" style={{ marginTop: 14, fontSize: 12, maxWidth: 560 }}>
              {selected.blurb} Category scores are read from the featured ensemble's <span className="mono">dataset_metric</span>.
            </p>
          </div>
          <div>
            <SectionHead index="03" title="Pipeline docket" note="Seven stages, their actual verification state on this machine." />
            <PipelineLedger pipeline={pipeline.data} />
          </div>
        </div>
      </section>

      <section className="stamp-row">
        <div>
          <div className="micro">Reading key</div>
          <p style={{ maxWidth: 640, marginTop: 8, fontSize: 13, color: "var(--ink-soft)" }}>
            A filled red band is ground truth. A curve is the score the release actually shipped. When a check
            is not bit-identical, the desk keeps the delta visible instead of rounding it into a green badge.
            Open a strip to read its coarse and fine nodes, captions, and chain-of-thought trace.
          </p>
          <div className="micro" style={{ marginTop: 12 }}>
            data · result/ · manifest · {data.counts.videos.toLocaleString()} videos · local only
          </div>
        </div>
        <ReproStamp repro={data.reproduction} />
      </section>
    </div>
  );
}
