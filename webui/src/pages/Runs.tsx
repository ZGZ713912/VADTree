import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, formatNumber } from "../api";
import { ArrowIcon, ChevronIcon, SearchIcon } from "../components/Icons";
import { StatusTag } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { Run, RunDetail } from "../types";

function RunDetailPanel({ detail }: { detail: RunDetail | null }) {
  if (!detail) return <div className="loading">正在读取运行…</div>;
  const { run, videos } = detail;
  const topVideos = videos.filter((video) => video.auc !== null).slice(0, 7);
  const metric = run.metrics;
  const rows = [
    ["相似度", run.config.similarity_type ?? "—"],
    ["Top-K", run.config.topK ?? "—"],
    ["邻居数", run.config.num_neighbors ?? "—"],
    ["动态比例", run.config.dyn_ratio ?? "—"],
    ["温度 τ", run.config.tao ?? "—"],
    ["β", run.config.beta ?? "—"],
    ["帧间隔", run.config.frame_interval ?? "—"],
  ];
  return (
    <aside className="run-detail">
      <div className="run-detail__head">
        <div className="micro">运行 / {run.dataset_label}</div>
        <h2 className="run-detail__title">{run.featured ? "主配置" : run.kind === "ensemble" ? "集成变体" : "单粒度运行"}</h2>
        <div className="run-detail__tags">
          <StatusTag status={run.kind === "ensemble" ? "verified" : "asset"} label={run.kind === "ensemble" ? "集成" : "细化"} />
          <span className="tag tag--faint">{run.resolution === "coarse" ? "粗粒度" : run.resolution === "fine" ? "细粒度" : "粗 + 细"}</span>
          {run.featured ? <span className="tag tag--red">精选</span> : null}
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
          <div className="micro">视频</div>
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
        <div className="micro" style={{ marginBottom: 8 }}>高分视频</div>
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
        打开完整证据索引 <ArrowIcon size={12} />
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

  if (runs.loading && !runs.data) return <div className="loading">正在打开运行台账…</div>;
  if (runs.error) return <div className="error-box">无法读取运行记录。{runs.error}</div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">运行 / 台账 <span className="dot dot--sm" style={{ background: "var(--vermilion)" }} /> {allRuns.length} 条记录</div>
          <h1 className="page-head__title">每一次运行，<em>都留下痕迹。</em></h1>
          <p className="page-head__lede">
            来自发布树的所有细化与集成运行，包括非头条变体。精选标记 README 配置；
            最高分不会自动成为主结果。
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">只读</span>
          <div className="stamp">
            <b>排序 · ROC 降序</b>
            来源 · result/<br />
            指标 · dataset_metric
          </div>
        </div>
      </header>

      <div className="runs-toolbar">
        <div className="dataset-tabs" role="tablist" aria-label="数据集筛选">
          {[
            ["all", "全部"],
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
              placeholder="按运行、数据集、路径筛选"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="筛选运行"
            />
          </label>
          <select className="select" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} aria-label="运行类型">
            <option value="all">全部类型</option>
            <option value="ensemble">集成</option>
            <option value="refine">细化</option>
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
                  <th>运行</th>
                  <th>数据集</th>
                  <th>阶段</th>
                  <th className="num">ROC</th>
                  <th className="num">PR</th>
                  <th className="num">视频</th>
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
                        {run.featured ? <span className="tag tag--red">精选</span> : null}
                        <span>{run.label}</span>
                      </div>
                      <span className="run-name__path" title={run.path}>{run.path}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 9 }}>{run.dataset === "UCF_Crime_test" ? "UCF" : run.dataset === "MSAD_test" ? "MSAD" : "XD"}</td>
                    <td className="mono" style={{ fontSize: 9 }}>{run.kind === "ensemble" ? "集成" : run.resolution === "coarse" ? "粗粒度" : run.resolution === "fine" ? "细粒度" : run.resolution}</td>
                    <td className="num-cell"><strong>{formatNumber(run.metrics.roc_auc, 4)}</strong></td>
                    <td className="num-cell">{formatNumber(run.metrics.pr_auc, 4)}</td>
                    <td className="num-cell">{run.videos}</td>
                    <td><ChevronIcon size={12} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length ? <div className="empty">没有运行匹配当前筛选条件。</div> : null}
          <div className="micro" style={{ marginTop: 12 }}>
            显示 {filtered.length} / {allRuns.length} 次运行 · 点击一行查看详情 · 源路径相对于 result/
          </div>
        </div>
        <RunDetailPanel detail={detail.data} />
      </div>
    </div>
  );
}
