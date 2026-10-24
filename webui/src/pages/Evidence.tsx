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
            {kind === "coarse" ? "粗粒度" : "细粒度"}节点 · 帧 {node.start}–{node.end} · {node.key}
          </div>
        </div>
        <div className="node-detail__score">
          {formatNumber(node.score, 3)}
          <span>细化分数</span>
        </div>
      </div>
      <div className="node-scores">
        <div><span>原始分数</span><b>{formatNumber(node.original_score, 3)}</b></div>
        <div><span>增量</span><b className={delta !== null && delta >= 0 ? "red" : "moss"}>{delta === null ? "—" : (delta >= 0 ? "+" : "") + delta.toFixed(3)}</b></div>
        <div><span>来源</span><b>{source ?? "—"}</b></div>
      </div>
      <div className="prose-block">
        <div className="prose-block__label"><span>描述 / VLM 看到的内容</span></div>
        {node.caption ? <div className="prose-block__body">{node.caption}</div> : (
          <div className="prose-block__empty">发布包没有为这个节点保留描述。</div>
        )}
      </div>
      <div className="prose-block">
        <div className="prose-block__label">
          <span>推理 / 思维链</span>
          {node.reasoning_truncated ? <span className="tag tag--ochre">已截断</span> : null}
        </div>
        {node.reasoning ? (
          <div className="prose-block__body prose-block__body--tall">{node.reasoning}</div>
        ) : (
          <div className="prose-block__empty">
            该运行没有为这个节点保留思维链。分数仍可从发布 JSON 复现，
            只是缺少解释文本。
          </div>
        )}
      </div>
    </div>
  );
}

export default function EvidencePage() {
  useTitle("证据");
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

  if (runs.loading && !runs.data) return <div className="loading">正在打开证据索引…</div>;
  if (runs.error) return <div className="error-box">无法读取运行记录。{runs.error}</div>;
  if (!allRuns.length) return <div className="empty">result/ 中没有运行。</div>;

  return (
    <div className="page evidence-page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">
            <span>证据 / 节点追踪</span>
            <span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>{currentRun?.dataset_label ?? "数据集"}</span>
          </div>
          <h1 className="page-head__title">读懂<em>痕迹。</em></h1>
          <p className="page-head__lede">
            一段视频，两种粒度，一条时间轴。悬停曲线读取分数；点击节点阅读
            模型描述与思维链。
          </p>
        </div>
        <div className="page-head__side">
          <StatusTag status="verified" label="只读" />
          <div className="stamp">
            <b>已索引 {videos.length} 段视频</b>
            {currentRun?.label ?? "—"}<br />
            {data?.redundant_count ?? 0} 个冗余节点
          </div>
        </div>
      </header>

      <div className="evidence-toolbar">
        <label className="field">
          <span>运行</span>
          <select className="select" value={runId} onChange={(event) => setRun(event.target.value)} aria-label="选择运行">
            {allRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.dataset_label} · {run.label} · {formatNumber(run.metrics.roc_auc, 4)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ minWidth: 260 }}>
          <span>视频</span>
          <select className="select" value={videoName} onChange={(event) => setVideo(event.target.value)} aria-label="选择视频">
            {videos.map((video) => (
              <option key={video.name} value={video.name}>
                {video.stem} · {formatNumber(video.auc, 3)}
              </option>
            ))}
          </select>
        </label>
        <div className="evidence-toolbar__meta">
          <span className="tag tag--faint">{currentRun?.kind === "ensemble" ? "集成" : "细化"}</span>
          <span className="mono" style={{ fontSize: 9 }}>{currentRun?.config.similarity_type ?? ""}{currentRun?.config.topK ? " · top" + currentRun.config.topK : ""}{currentRun?.config.tao !== null && currentRun?.config.tao !== undefined ? " · τ" + currentRun.config.tao : ""}</span>
          {currentRun ? <Link className="section-head__action" to={"/runs?run=" + encodeURIComponent(currentRun.id)}>运行台账 <ArrowIcon size={10} /></Link> : null}
        </div>
      </div>

      <div className="evidence-layout">
        <aside className="evidence-index">
          <div className="micro" style={{ marginBottom: 8 }}>案件卷宗 / 显示 {visibleVideos.length} 段</div>
          <label className="video-search">
            <span className="sr-only">筛选视频</span>
            <span style={{ display: "flex", alignItems: "center", border: "1px solid var(--rule-strong)", background: "var(--card)", padding: "0 8px" }}>
              <SearchIcon size={12} />
              <input
                className="input"
                style={{ border: 0, background: "transparent", paddingLeft: 6 }}
                value={videoQuery}
                placeholder="筛选视频 / 类别"
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
                      {video.anomaly ? <span className="red">异常</span> : <span>正常</span>}
                    </span>
                  </span>
                  <span className={"video-item__auc" + (video.auc !== null && video.auc >= 0.8 ? " video-item__auc--good" : video.auc !== null && video.auc < 0.5 ? " video-item__auc--bad" : "")}>
                    {formatNumber(video.auc, 3)}
                  </span>
                </button>
              );
            })}
            {!visibleVideos.length ? <div className="empty">没有视频匹配当前筛选。</div> : null}
          </div>
        </aside>

        <section className="evidence-main">
          {evidence.loading && !data ? <div className="loading">正在读取视频痕迹…</div> : null}
          {evidence.error ? <div className="error-box">无法读取证据。 {evidence.error}</div> : null}
          {data ? (
            <>
              <div className="video-title">
                <div>
                  <div className="micro" style={{ marginBottom: 6 }}>{data.video.category} / {data.video.has_anomaly ? "真值异常" : "正常"}</div>
                  <h2>{data.video.stem}</h2>
                  <div className="video-title__meta">
                    <span className="tag tag--faint">{formatSeconds(data.video.duration)}</span>
                    <span className="tag tag--faint">{data.video.fps.toFixed(2)} fps</span>
                    <span className="tag tag--faint">{data.video.frames.toLocaleString()} 帧</span>
                    <span className="tag tag--faint">{data.video.gt.length} 个真值区间</span>
                    {data.reasoning_source ? <span className="tag tag--ochre">{data.reasoning_source}</span> : <span className="tag tag--faint">无思维链</span>}
                  </div>
                </div>
                <div className="video-title__score">
                  <b>{formatNumber(data.video.auc, 4)}</b>
                  <span>视频 ROC AUC</span>
                </div>
              </div>
              <Timeline evidence={data} selected={selectedNode} onSelect={selectNode} />
              <div className="evidence-note">
                <span><EvidenceIcon size={12} /> {data.coarse.length} 个粗节点 / {data.fine.length} 个细节点</span>
                <span>分数来源 · {currentRun?.kind === "ensemble" ? "节点区间内的集成均值" : "发布版节点分数"}</span>
                <span>{data.redundant_count} 个冗余候选保留在树 JSON 中</span>
              </div>
            </>
          ) : null}
        </section>

        <aside className="inspector">
          <div className="inspector__tabs" role="tablist" aria-label="粒度">
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
                {tab === "coarse" ? "粗粒度" : "细粒度"} / {data ? (tab === "coarse" ? data.coarse.length : data.fine.length) : 0}
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
                    title={node.key + " · 分数 " + formatNumber(node.score, 3)}
                  >
                    {formatSeconds(node.start_s)}–{formatSeconds(node.end_s)} · {formatNumber(node.score, 2)}
                  </button>
                ))}
              </div>
              {selectedNode ? <NodeDetail node={selectedNode} kind={activeTab} source={data.reasoning_source} /> : (
                <div className="empty">该视频没有{activeTab === "coarse" ? "粗粒度" : "细粒度"}节点。</div>
              )}
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}