import { useEffect, useRef, useState } from "react";

import { api, formatBytes, formatSeconds, uploadVideo } from "../api";
import { ArrowIcon, PlayIcon, QueryIcon } from "../components/Icons";
import { StatusTag } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { Job, QueryResult, QueryWindow, UploadMeta, VlmStatus } from "../types";

const EXAMPLES = [
  "有人翻越围栏或攀爬",
  "画面中出现爆炸或明显火光",
  "有人打架、推搡或攻击他人",
  "车辆逆行、碰撞或突然冲向人群",
];

function probabilityTone(value: number): string {
  if (value >= 70) return "red";
  if (value >= 45) return "ochre";
  return "moss";
}

function ResultPanel({ result, uploadId }: { result: QueryResult; uploadId: string }) {
  const aggregate = result.aggregate;
  if (!aggregate) {
    return <div className="empty">任务没有生成聚合结果。查看日志或重新运行。</div>;
  }
  const duration = result.video.duration || 1;
  const windows = [...result.windows].sort((a, b) => b.probability - a.probability || a.start - b.start);
  const coverageSeconds = aggregate.coverage.reduce((sum, item) => sum + (item.end - item.start), 0);
  const tone = probabilityTone(aggregate.score);
  return (
    <div className="query-result">
      <div className="query-result__head">
        <div>
          <div className="micro">本地图文匹配 / Chinese-CLIP</div>
          <h2 className="query-result__title">这段视频里，<br /><em>{result.description}</em></h2>
        </div>
        <span className={"tag tag--" + tone}>{aggregate.verdict}</span>
      </div>

      <div className="query-score">
        <div className="query-score__number">{aggregate.score}<small>/100</small></div>
        <div className="query-score__body">
          <div className="micro">图文匹配可信值 · 非校准概率</div>
          <div className="query-meter" aria-hidden="true">
            <span style={{ width: aggregate.score + "%" }} className={"query-meter__fill query-meter__fill--" + tone} />
          </div>
          <div className="query-score__stats">
            <span>平均 {aggregate.mean_probability}%</span>
            <span>最高窗口 {formatSeconds(aggregate.best_start)}–{formatSeconds(aggregate.best_end)}</span>
            <span>{aggregate.windows_total} 个窗口</span>
          </div>
        </div>
      </div>

      <div className="query-timeline-wrap">
        <div className="micro">时间定位 / 每个窗口的模型判断</div>
        <div className="query-timeline">
          {result.windows.map((window) => {
            const left = Math.max(0, (window.start / duration) * 100);
            const width = Math.max(1, ((window.end - window.start) / duration) * 100);
            return (
              <span
                key={window.index}
                className={"query-timeline__bar query-timeline__bar--" + probabilityTone(window.probability)}
                style={{ left: left + "%", width: width + "%" }}
                title={formatSeconds(window.start) + "–" + formatSeconds(window.end) + " · " + window.probability + "%"}
              />
            );
          })}
        </div>
        <div className="query-timeline__axis">
          <span>0:00</span><span>{formatSeconds(duration / 2)}</span><span>{formatSeconds(duration)}</span>
        </div>
        <div className="query-timeline__legend">
          <span><i className="query-dot query-dot--red" />≥ 70</span>
          <span><i className="query-dot query-dot--ochre" />45–69</span>
          <span><i className="query-dot query-dot--moss" />&lt; 45</span>
          <span>覆盖 {coverageSeconds.toFixed(1)} 秒 · {aggregate.coverage.length} 个高概率窗口</span>
        </div>
      </div>

      <div className="query-evidence-head">
        <div className="micro">证据窗口 / 按可信值排序</div>
        <span className="mono">{windows.length} 个窗口</span>
      </div>
      <div className="query-evidence-grid">
        {windows.map((window) => (
          <EvidenceCard key={window.index} window={window} uploadId={uploadId} />
        ))}
      </div>

      <div className="query-disclaimer">
        可信值是 Chinese-CLIP 对该窗口的图文匹配度，再取最高窗口汇总；它<strong>不是统计学校准概率</strong>，
        也不构成事实认定。请结合原视频和证据帧复核，特别是低分辨率、远距离、遮挡或夜间画面。
      </div>
      <div className="query-result__meta">
        模型 · {result.model} · 窗口 {result.settings.window}s / 步长 {result.settings.stride}s / {result.settings.frames} 帧
      </div>
    </div>
  );
}

function EvidenceCard({ window, uploadId }: { window: QueryWindow; uploadId: string }) {
  const tone = probabilityTone(window.probability);
  return (
    <article className="query-evidence">
      {window.thumb ? (
        <img
          src={"/api/uploads/" + uploadId + "/frames/" + window.thumb}
          alt={"证据帧 " + window.index}
          loading="lazy"
        />
      ) : <div className="query-evidence__noimg">无证据帧</div>}
      <div className="query-evidence__body">
        <div className="query-evidence__head">
          <span className="mono">{formatSeconds(window.start)}–{formatSeconds(window.end)}</span>
          <span className={"tag tag--" + tone}>{window.probability}%</span>
        </div>
        <p>{window.evidence || "模型没有给出文字依据。"}</p>
        {window.evidence_frames.length ? (
          <div className="query-evidence__frames">证据帧 #{window.evidence_frames.join(", #")}</div>
        ) : null}
      </div>
    </article>
  );
}

function VlmStatusLine({ status }: { status: VlmStatus | null }) {
  if (!status) return <span className="micro">检查本地模型…</span>;
  return (
    <span className={"tag " + (status.ready ? "tag--moss" : "tag--ochre")}>
      <span className="dot dot--sm" style={{ background: status.ready ? "var(--moss)" : "var(--ochre)" }} />
      {status.ready ? "Chinese-CLIP 已就绪" : "CLIP 未就绪"}
    </span>
  );
}

export default function QueryPage() {
  useTitle("描述检索");
  const vlm = useAsync<VlmStatus>(() => api.vlmStatus(), []);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [upload, setUpload] = useState<UploadMeta | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [drag, setDrag] = useState(false);
  const [description, setDescription] = useState("");
  const [windowSize, setWindowSize] = useState("8");
  const [stride, setStride] = useState("4");
  const [maxWindows, setMaxWindows] = useState("12");
  const [frames, setFrames] = useState("6");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const running = job?.status === "queued" || job?.status === "running";
  const result = job?.kind === "query" && job.report && (job.report as unknown as QueryResult).status === "completed"
    ? (job.report as unknown as QueryResult)
    : null;
  const progress = (() => {
    const matches = Array.from((job?.log_text ?? "").matchAll(/WINDOW (\d+)\/(\d+)/g));
    if (!matches.length) return 0;
    const last = matches[matches.length - 1];
    return Math.min(100, Math.round((Number(last[1]) / Number(last[2])) * 100));
  })();

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
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
  }, [job?.id, job?.status]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setJob(null);
    setUpload(null);
    setUploadProgress(0);
    setUploading(true);
    try {
      const meta = await uploadVideo(file, setUploadProgress);
      setUpload(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const start = async () => {
    if (!upload) {
      setError("请先上传一段视频。");
      return;
    }
    if (!description.trim()) {
      setError("请先写下你想确认的事件描述。");
      return;
    }
    if (!vlm.data?.ready) {
      setError("本地图文模型 后端未就绪，请先安装模型与 .venv-vlm。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const next = await api.createJob({
        kind: "query",
        params: {
          upload_id: upload.id,
          description: description.trim(),
          window: Number(windowSize),
          stride: Number(stride),
          max_windows: Number(maxWindows),
          frames: Number(frames),
        },
      });
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = uploading || running || submitting;
  return (
    <div className="page query-page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">
            <span>描述 / 开放词检索</span>
            <span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>本地图文模型</span>
          </div>
          <h1 className="page-head__title">把描述，<em>带进视频。</em></h1>
          <p className="page-head__lede">
            上传一段视频，用一句自然语言描述你想确认的事件。本地 Chinese-CLIP 会按时间窗口逐段比对，
            给出可信值、时间定位和可复核的证据帧。它独立于固定类别的 VADTree 离线分数。
          </p>
        </div>
        <div className="page-head__side">
          <VlmStatusLine status={vlm.data} />
          <div className="stamp">
            <b>Chinese-CLIP</b>
            本地推理 · 不上传云端<br />
            窗口采样 · 证据帧<br />
            可信值 · 非校准概率
          </div>
        </div>
      </header>

      <div className="query-layout">
        <section className="query-form">
          <div className="micro" style={{ marginBottom: 8 }}>01 / 视频</div>
          <div
            className={"dropzone" + (drag ? " is-drag" : "") + (upload ? " has-file" : "")}
            onClick={() => !uploading && inputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDrag(false);
              handleFile(event.dataTransfer.files?.[0] ?? null);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo"
              hidden
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            />
            {upload ? (
              <div className="upload-preview">
                <img src={upload.preview_url} alt="视频预览" />
                <div className="upload-preview__meta">
                  <b>{upload.name}</b>
                  <span>{formatBytes(upload.size)} · {formatSeconds(upload.duration)} · {upload.width}×{upload.height}</span>
                  <span className="micro">点击更换视频</span>
                </div>
              </div>
            ) : (
              <div className="dropzone__empty">
                <QueryIcon size={22} />
                <b>{uploading ? "正在上传…" : "拖入视频，或点击选择"}</b>
                <span>MP4 / MOV / MKV / WebM · 最大 1GB</span>
              </div>
            )}
            {uploading ? (
              <div className="upload-progress"><span style={{ width: uploadProgress + "%" }} /></div>
            ) : null}
          </div>

          <div className="micro" style={{ marginTop: 22, marginBottom: 8 }}>02 / 描述你想确认什么</div>
          <textarea
            className="query-description"
            value={description}
            maxLength={500}
            placeholder="例如：画面中有人翻越围栏，或有一辆车逆行冲向人群。"
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="query-examples">
            {EXAMPLES.map((example) => (
              <button key={example} className="sample-chip" onClick={() => setDescription(example)}>
                {example}
              </button>
            ))}
          </div>

          <div className="query-settings">
            <label className="field"><span>窗口长度 / 秒</span><input className="input" type="number" min="2" max="30" step="1" value={windowSize} onChange={(e) => setWindowSize(e.target.value)} /></label>
            <label className="field"><span>步长 / 秒</span><input className="input" type="number" min="1" max="30" step="1" value={stride} onChange={(e) => setStride(e.target.value)} /></label>
            <label className="field"><span>最多窗口</span><input className="input" type="number" min="1" max="60" step="1" value={maxWindows} onChange={(e) => setMaxWindows(e.target.value)} /></label>
            <label className="field"><span>每窗帧数</span><input className="input" type="number" min="2" max="12" step="1" value={frames} onChange={(e) => setFrames(e.target.value)} /></label>
          </div>

          {vlm.data && !vlm.data.ready ? (
            <div className="query-warning">
              本地 CLIP 未就绪。需要 <span className="mono">.venv-vlm</span> 与
              <span className="mono">models/chinese-clip-vit-base-patch16</span>；配置后运行
              <span className="mono">scripts/setup_vlm.sh</span>。
            </div>
          ) : null}
          {error ? <div className="error-box">{error}</div> : null}

          <div className="query-actions">
            <button className="button button--red" onClick={start} disabled={busy || !vlm.data?.ready || !upload || !description.trim()}>
              <PlayIcon size={11} /> {running ? "判断中…" : uploading ? "上传中…" : submitting ? "提交中…" : "开始本地判断"}
            </button>
            {(upload || job) ? (
              <button className="button button--ghost" onClick={() => { setJob(null); setUpload(null); setDescription(""); setError(null); }} disabled={running || uploading}>
                清空
              </button>
            ) : null}
            {job ? <StatusTag status={job.status} /> : null}
          </div>

          <p className="query-note">
            匹配完全在本机进行。视频与帧只写入本地 <span className="mono">uploads/</span>，任务日志在 <span className="mono">runs/</span>；
            只有你点“开始”时才会调用本地模型。
          </p>

          {job ? (
            <div className="query-job">
              <div className="query-job__head">
                <span className="micro">{job.id}</span>
                <span className="mono">{progress}%</span>
              </div>
              <div className="query-job__bar"><span style={{ width: progress + "%" }} /></div>
              <pre className="query-log">{job.log_text || "等待模型加载…"}</pre>
              {job.error ? <div className="error-box">{job.error}</div> : null}
            </div>
          ) : null}
        </section>

        <section className="query-output">
          {result ? <ResultPanel result={result} uploadId={job?.upload_id ?? upload?.id ?? ""} /> : (
            <div className="query-placeholder">
              <div className="micro">结果 / 等待输入</div>
              <h2>先给一段视频，<br /><em>再给一句描述。</em></h2>
              <p>
                本地图文模型会逐窗口比对画面与描述。每个窗口给出 0–100 的匹配分和证据帧，
                最后取最高窗口并标出覆盖区间。
              </p>
              <div className="query-placeholder__steps">
                <span>01 上传</span><span>02 描述</span><span>03 本地窗口判定</span><span>04 证据复核</span>
              </div>
              <div className="query-placeholder__foot">
                <StatusTag status={vlm.data?.ready ? "verified" : "warning"} label={vlm.data?.ready ? "后端就绪" : "等待后端"} />
                <span className="micro">Chinese-CLIP · 本地</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}