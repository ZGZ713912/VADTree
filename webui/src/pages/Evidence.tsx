import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, formatNumber, formatSeconds } from "../api";
import { Timeline } from "../components/Charts";
import { ArrowIcon, EvidenceIcon, SearchIcon } from "../components/Icons";
import { StatusTag } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { Evidence, NodeEvidence, Run, RunDetail } from "../types";

function nodeId(node: NodeEvidence | null, kind: "coarse" | "fine" | null) {
  return node && kind ? kind + ":" + node.key : "";
}

function NodeDetail({ node, kind, source }: { node: NodeEvidence; kind: "coarse" | "fine"; source: string | null }) {
  const delta = node.original_score !== null && node.score !== null ? node.score - node.original_score : null;
  return (
    <div className="node-detail">
      <div className="node-detail__head">
        <div>
          <div className="node-detail__range">
            {formatSeconds(node.start_s)} — {formatSeconds(node.end_s)}
          </div>
          <div className="node-detail__sub">
            {kind} node · frames {node.start}–{node.end} · {node.key}
          </div>
        </div>
        <div className="node-detail__score">
          {formatNumber(node.score, 3)}
          <span>refined score</span>
        </div>
      </div>
      <div className="node-scores">
        <div><span>original</span><b>{formatNumber(node.original_score, 3)}</b></div>
        <div><span>delta</span><b className={delta !== null && delta >= 0 ? "red" : "moss"}>{delta === null ? "—" : (delta >= 0 ? "+" : "") + delta.toFixed(3)}</b></div>
        <div><span>source</span><b>{source ?? "—"}</b></div>
      </div>
      <div className="prose-block">
        <div className="prose-block__label"><span>Caption / what the VLM saw</span></div>
        {node.caption ? <div className="prose-block__body">{node.caption}</div> : (
          <div className="prose-block__empty">No caption stored for this node in the release.</div>
        )}
      </div>
      <div className="prose-block">
        <div className="prose-block__label">
          <span>Reasoning / chain of thought</span>
          {node.reasoning_truncated ? <span className="tag tag--ochre">truncated</span> : null}
        </div>
        {node.reasoning ? (
          <div className="prose-block__body prose-block__body--tall">{node.reasoning}</div>
        ) : (
          <div className="prose-block__empty">
            This run does not carry a chain-of-thought trace for the node. The score is still reproducible from the
            released JSON; only the explanatory text is missing.
          </div>
        )}
      </div>
    </div>
  );
}

export default function EvidencePage() {
  useTitle("Evidence");
  const [params, setParams] = useSearchParams();
  const runs = useAsync(() => api.runs(), []);
  const allRuns = runs.data?.runs ?? [];
  const featured = allRuns.find((run) => run.featured) ?? allRuns[0];
  const runId = params.get("run") ?? featured?.id ?? "";
  const detail = useAsync<RunDetail | null>(
    () => (runId ? api.run(runId) : Promise.resolve(null)),
    [runId],
  );
  const videos = detail.data?.videos ?? [];
  const defaultVideo = useMemo(() => {
    const anomaly = videos.find((video) => video.anomaly && video.auc !== null && video.auc >= 0.8);
    return anomaly?.name ?? videos[0]?.name ?? "";
  }, [videos]);
  const requestedVideo = params.get("video") ?? "";
  const videoName = videos.some((video) => video.name === requestedVideo) ? requestedVideo : defaultVideo;
  const evidence = useAsync<Evidence | null>(
    () => (runId && videoName ? api.evidence(runId, videoName) : Promise.resolve(null)),
    [runId, videoName],
  );
  const [activeTab, setActiveTab] = useState<"coarse" | "fine">("coarse");
  const [selectedId, setSelectedId] = useState<string>("");
  const [videoQuery, setVideoQuery] = useState("");

  useEffect(() => {
    if (detail.data && runId && defaultVideo && videoName !== requestedVideo) {
      setParams({ run: runId, video: videoName }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, runId, defaultVideo, requestedVideo]);

  useEffect(() => {
    const data = evidence.data;
    if (!data) return;
    const pool = activeTab === "coarse" ? data.coarse : data.fine;
    const best = [...pool].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] ?? null;
    setSelectedId(nodeId(best, activeTab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence.data]);

  const selectNode = (node: NodeEvidence, kind: "coarse" | "fine") => {
    setActiveTab(kind);
    setSelectedId(nodeId(node, kind));
  };

  const setRun = (next: string) => {
    const run = allRuns.find((item) => item.id === next);
    if (!run) return;
    setParams({ run: next });
  };

  const setVideo = (next: string) => {
    if (!runId) return;
    setParams({ run: runId, video: next });
  };

  const visibleVideos = useMemo(() => {
    const q = videoQuery.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter((video) => video.name.toLowerCase().includes(q) || video.category.toLowerCase().includes(q));
  }, [videos, videoQuery]);

  const data = evidence.data;
  const nodePool = data ? (activeTab === "coarse" ? data.coarse : data.fine) : [];
  const selectedNode = nodePool.find((node) => nodeId(node, activeTab) === selectedId) ?? nodePool[0] ?? null;
  const currentRun: Run | null = detail.data?.run ?? allRuns.find((run) => run.id === runId) ?? null;

  if (runs.loading && !runs.data) return <div className="loading">opening evidence index…</div>;
  if (runs.error) return <div className="error-box">Could not read runs. {runs.error}</div>;
  if (!allRuns.length) return <div className="empty">No runs found under result/.</div>;

  return (
    <div className="page evidence-page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">
            <span>Evidence / node trace</span>
            <span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>{currentRun?.dataset_label ?? "dataset"}</span>
          </div>
          <h1 className="page-head__title">Read the <em>trace.</em></h1>
          <p className="page-head__lede">
            One video, two granularities, one time axis. Hover the curve for a score; click a node to read the
            caption and the chain-of-thought that produced it.
          </p>
        </div>
        <div className="page-head__side">
          <StatusTag status="verified" label="read only" />
          <div className="stamp">
            <b>{videos.length} videos indexed</b>
            {currentRun?.label ?? "—"}<br />
            {data?.redundant_count ?? 0} redundant nodes
          </div>
        </div>
      </header>

      <div className="evidence-toolbar">
        <label className="field">
          <span>Run</span>
          <select className="select" value={runId} onChange={(event) => setRun(event.target.value)} aria-label="Choose run">
            {allRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.dataset_label} · {run.label} · {formatNumber(run.metrics.roc_auc, 4)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ minWidth: 260 }}>
          <span>Video</span>
          <select className="select" value={videoName} onChange={(event) => setVideo(event.target.value)} aria-label="Choose video">
            {videos.map((video) => (
              <option key={video.name} value={video.name}>
                {video.stem} · {formatNumber(video.auc, 3)}
              </option>
            ))}
          </select>
        </label>
        <div className="evidence-toolbar__meta">
          <span className="tag tag--faint">{currentRun?.kind ?? "run"}</span>
          <span className="mono" style={{ fontSize: 9 }}>{currentRun?.config.similarity_type ?? ""}{currentRun?.config.topK ? " · top" + currentRun.config.topK : ""}{currentRun?.config.tao !== null && currentRun?.config.tao !== undefined ? " · τ" + currentRun.config.tao : ""}</span>
          {currentRun ? <Link className="section-head__action" to={"/runs?run=" + encodeURIComponent(currentRun.id)}>run register <ArrowIcon size={10} /></Link> : null}
        </div>
      </div>

      <div className="evidence-layout">
        <aside className="evidence-index">
          <div className="micro" style={{ marginBottom: 8 }}>Case file / {visibleVideos.length} shown</div>
          <label className="video-search">
            <span className="sr-only">Filter videos</span>
            <span style={{ display: "flex", alignItems: "center", border: "1px solid var(--rule-strong)", background: "var(--card)", padding: "0 8px" }}>
              <SearchIcon size={12} />
              <input
                className="input"
                style={{ border: 0, background: "transparent", paddingLeft: 6 }}
                value={videoQuery}
                placeholder="Filter videos / categories"
                onChange={(event) => setVideoQuery(event.target.value)}
              />
            </span>
          </label>
          <div className="video-list">
            {visibleVideos.map((video) => {
              const active = video.name === videoName;
              return (
                <button
                  key={video.name}
                  className={"video-item" + (active ? " is-active" : "")}
                  onClick={() => setVideo(video.name)}
                  title={video.name}
                  aria-pressed={active}
                >
                  <span>
                    <span className="video-item__name">{video.stem}</span>
                    <span className="video-item__meta">
                      <span>{video.category}</span>
                      {video.anomaly ? <span className="red">anomaly</span> : <span>normal</span>}
                    </span>
                  </span>
                  <span className={"video-item__auc" + (video.auc !== null && video.auc >= 0.8 ? " video-item__auc--good" : video.auc !== null && video.auc < 0.5 ? " video-item__auc--bad" : "")}>
                    {formatNumber(video.auc, 3)}
                  </span>
                </button>
              );
            })}
            {!visibleVideos.length ? <div className="empty">No video matches this filter.</div> : null}
          </div>
        </aside>

        <section className="evidence-main">
          {evidence.loading && !data ? <div className="loading">loading video trace…</div> : null}
          {evidence.error ? <div className="error-box">Could not load evidence. {evidence.error}</div> : null}
          {data ? (
            <>
              <div className="video-title">
                <div>
                  <div className="micro" style={{ marginBottom: 6 }}>{data.video.category} / {data.video.has_anomaly ? "ground-truth anomaly" : "normal"}</div>
                  <h2>{data.video.stem}</h2>
                  <div className="video-title__meta">
                    <span className="tag tag--faint">{formatSeconds(data.video.duration)}</span>
                    <span className="tag tag--faint">{data.video.fps.toFixed(2)} fps</span>
                    <span className="tag tag--faint">{data.video.frames.toLocaleString()} frames</span>
                    <span className="tag tag--faint">{data.video.gt.length} GT intervals</span>
                    {data.reasoning_source ? <span className="tag tag--ochre">{data.reasoning_source}</span> : <span className="tag tag--faint">no CoT</span>}
                  </div>
                </div>
                <div className="video-title__score">
                  <b>{formatNumber(data.video.auc, 4)}</b>
                  <span>video ROC AUC</span>
                </div>
              </div>
              <Timeline evidence={data} selected={selectedNode} onSelect={selectNode} />
              <div className="evidence-note">
                <span><EvidenceIcon size={12} /> {data.coarse.length} coarse / {data.fine.length} fine nodes</span>
                <span>score source · {currentRun?.kind === "ensemble" ? "ensemble mean over node span" : "published node score"}</span>
                <span>{data.redundant_count} redundant candidates kept in the tree JSON</span>
              </div>
            </>
          ) : null}
        </section>

        <aside className="inspector">
          <div className="inspector__tabs" role="tablist" aria-label="Granularity">
            {(["coarse", "fine"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                className={"inspector__tab" + (activeTab === tab ? " is-active" : "")}
                onClick={() => {
                  setActiveTab(tab);
                  const pool = data ? (tab === "coarse" ? data.coarse : data.fine) : [];
                  const best = [...pool].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] ?? null;
                  setSelectedId(nodeId(best, tab));
                }}
              >
                {tab} / {data ? (tab === "coarse" ? data.coarse.length : data.fine.length) : 0}
              </button>
            ))}
          </div>
          {data ? (
            <>
              <div className="node-list">
                {nodePool.map((node) => (
                  <button
                    key={node.key}
                    className={"node-chip" + (selectedNode?.key === node.key ? " is-active" : "")}
                    onClick={() => setSelectedId(nodeId(node, activeTab))}
                    title={node.key + " · score " + formatNumber(node.score, 3)}
                  >
                    {formatSeconds(node.start_s)}–{formatSeconds(node.end_s)} · {formatNumber(node.score, 2)}
                  </button>
                ))}
              </div>
              {selectedNode ? <NodeDetail node={selectedNode} kind={activeTab} source={data.reasoning_source} /> : (
                <div className="empty">No {activeTab} nodes for this video.</div>
              )}
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
