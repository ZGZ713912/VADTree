import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, formatNumber } from "../api";
import { ArrowIcon, ChevronIcon, SearchIcon } from "../components/Icons";
import { StatusTag } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { Run, RunDetail } from "../types";

function RunDetailPanel({ detail }: { detail: RunDetail | null }) {
  if (!detail) return <div className="loading">reading run…</div>;
  const { run, videos } = detail;
  const topVideos = videos.filter((video) => video.auc !== null).slice(0, 7);
  const metric = run.metrics;
  const rows = [
    ["similarity", run.config.similarity_type ?? "—"],
    ["top-k", run.config.topK ?? "—"],
    ["neighbors", run.config.num_neighbors ?? "—"],
    ["dyn ratio", run.config.dyn_ratio ?? "—"],
    ["tau", run.config.tao ?? "—"],
    ["beta", run.config.beta ?? "—"],
    ["frame interval", run.config.frame_interval ?? "—"],
  ];
  return (
    <aside className="run-detail">
      <div className="run-detail__head">
        <div className="micro">RUN / {run.dataset_label}</div>
        <h2 className="run-detail__title">{run.featured ? "Headline configuration" : run.kind === "ensemble" ? "Ensemble variant" : "Single-granularity run"}</h2>
        <div className="run-detail__tags">
          <StatusTag status={run.kind === "ensemble" ? "verified" : "asset"} label={run.kind} />
          <span className="tag tag--faint">{run.resolution ?? "coarse + fine"}</span>
          {run.featured ? <span className="tag tag--red">featured</span> : null}
        </div>
      </div>
      <div className="run-detail__metrics">
        <div>
          <div className="micro">ROC AUC</div>
          <div className="run-detail__metric">{formatNumber(metric.roc_auc, 4)}</div>
        </div>
        <div>
          <div className="micro">PR AUC</div>
          <div className="run-detail__metric">{formatNumber(metric.pr_auc, 4)}</div>
        </div>
        <div>
          <div className="micro">VIDEOS</div>
          <div className="run-detail__metric">{run.videos}</div>
        </div>
      </div>
      <div className="run-detail__config">
        {rows.map(([key, value]) => (
          <div className="config-row" key={String(key)}>
            <span>{key}</span>
            <b>{String(value)}</b>
          </div>
        ))}
      </div>
      <div className="run-detail__path mono" title={run.path}>{run.path}</div>
      <div className="run-detail__videos">
        <div className="micro" style={{ marginBottom: 8 }}>Top scored videos</div>
        {topVideos.map((video) => (
          <Link
            className="detail-video"
            key={video.name}
            to={"/evidence?run=" + encodeURIComponent(run.id) + "&video=" + encodeURIComponent(video.name)}
          >
            <span title={video.name}>{video.stem}</span>
            <span className={video.auc !== null && video.auc >= 0.8 ? "moss" : ""}>{formatNumber(video.auc, 3)}</span>
          </Link>
        ))}
      </div>
      <Link className="button button--ghost" to={"/evidence?run=" + encodeURIComponent(run.id)}>
        Open full evidence index <ArrowIcon size={12} />
      </Link>
    </aside>
  );
}

export default function RunsPage() {
  useTitle("Runs");
  const [params, setParams] = useSearchParams();
  const [datasetFilter, setDatasetFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const runs = useAsync(() => api.runs(), []);
  const selectedFromQuery = params.get("run");
  const allRuns = runs.data?.runs ?? [];

  const selectedId = useMemo(() => {
    if (selectedFromQuery && allRuns.some((run) => run.id === selectedFromQuery)) return selectedFromQuery;
    const featured = allRuns.find((run) => run.featured);
    return featured?.id ?? allRuns[0]?.id ?? null;
  }, [selectedFromQuery, allRuns]);

  useEffect(() => {
    if (!selectedFromQuery && selectedId) setParams({ run: selectedId }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const detail = useAsync<RunDetail | null>(
    () => (selectedId ? api.run(selectedId) : Promise.resolve(null)),
    [selectedId],
  );

  const filtered = useMemo(() => {
    return allRuns.filter((run) => {
      if (datasetFilter !== "all" && run.dataset !== datasetFilter) return false;
      if (kindFilter !== "all" && run.kind !== kindFilter) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!run.label.toLowerCase().includes(q) && !run.dataset_label.toLowerCase().includes(q) && !run.path.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allRuns, datasetFilter, kindFilter, query]);

  const selectRun = (run: Run) => setParams({ run: run.id });

  if (runs.loading && !runs.data) return <div className="loading">opening run register…</div>;
  if (runs.error) return <div className="error-box">Could not read runs. {runs.error}</div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">Runs / register <span className="dot dot--sm" style={{ background: "var(--vermilion)" }} /> {allRuns.length} entries</div>
          <h1 className="page-head__title">Every run <em>leaves a mark.</em></h1>
          <p className="page-head__lede">
            Refinements and ensembles from the release tree, including non-headline variants. Featured marks the
            README configuration; the highest score is not automatically the canonical one.
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">READ ONLY</span>
          <div className="stamp">
            <b>sort · ROC descending</b>
            source · result/<br />
            metrics · dataset_metric
          </div>
        </div>
      </header>

      <div className="runs-toolbar">
        <div className="dataset-tabs" role="tablist" aria-label="Dataset filter">
          {[
            ["all", "ALL"],
            ["UCF_Crime_test", "UCF"],
            ["MSAD_test", "MSAD"],
            ["XD_Violence_test", "XD"],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={datasetFilter === value}
              className={"dataset-tab" + (datasetFilter === value ? " is-active" : "")}
              onClick={() => setDatasetFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="runs-toolbar__right">
          <label className="runs-search">
            <SearchIcon size={12} />
            <input
              className="input"
              value={query}
              placeholder="Filter by run, dataset, path"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter runs"
            />
          </label>
          <select className="select" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} aria-label="Run kind">
            <option value="all">all kinds</option>
            <option value="ensemble">ensemble</option>
            <option value="refine">refinement</option>
          </select>
        </div>
      </div>

      <div className="runs-layout">
        <div>
          <div className="table-wrap">
            <table className="table run-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th>run</th>
                  <th>dataset</th>
                  <th>stage</th>
                  <th className="num">ROC</th>
                  <th className="num">PR</th>
                  <th className="num">videos</th>
                  <th style={{ width: 22 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((run, index) => (
                  <tr
                    key={run.id}
                    className={"run-row" + (run.id === selectedId ? " is-selected" : "")}
                    onClick={() => selectRun(run)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectRun(run);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={run.id === selectedId}
                  >
                    <td className="num-cell muted">{String(index + 1).padStart(2, "0")}</td>
                    <td>
                      <div className="run-name">
                        {run.featured ? <span className="tag tag--red">featured</span> : null}
                        <span>{run.label}</span>
                      </div>
                      <span className="run-name__path" title={run.path}>{run.path}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 9 }}>{run.dataset_label}</td>
                    <td className="mono" style={{ fontSize: 9 }}>{run.kind === "ensemble" ? "ensemble" : run.resolution}</td>
                    <td className="num-cell"><strong>{formatNumber(run.metrics.roc_auc, 4)}</strong></td>
                    <td className="num-cell">{formatNumber(run.metrics.pr_auc, 4)}</td>
                    <td className="num-cell">{run.videos}</td>
                    <td><ChevronIcon size={12} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length ? <div className="empty">No run matches these filters.</div> : null}
          <div className="micro" style={{ marginTop: 12 }}>
            {filtered.length} of {allRuns.length} runs · click a row to inspect · source paths are relative to result/
          </div>
        </div>
        <RunDetailPanel detail={detail.data} />
      </div>
    </div>
  );
}
