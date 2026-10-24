import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api, formatBytes, relativeTime, reproDetailZh } from "../api";
import { ArrowIcon, PlayIcon, StopIcon } from "../components/Icons";
import { StatusTag, statusLabel } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import type { Health, Job, Pipeline } from "../types";

const DATASETS = [
  { id: "UCF", label: "UCF-Crime" },
  { id: "MSAD", label: "MSAD" },
  { id: "XD", label: "XD-Violence" },
];

const STEPS = [
  { id: "2", label: "HGTree" },
  { id: "6", label: "细化" },
  { id: "7", label: "集成" },
];

function EnvironmentSummary({ health }: { health: Health | null }) {
  if (!health) return <div className="loading">正在检查环境…</div>;
  const videos = health.videos;
  return (
    <div className="env-summary">
      <div className="env-summary__head">
        <span className="micro">环境 / 本机</span>
        <span className="tag tag--moss">{health.dist_built ? "控制台已构建" : "接口就绪"}</span>
      </div>
      <div className="env-summary__grid">
        <div><span>Python</span><b>{health.venv.python ?? "—"}</b></div>
        <div><span>numpy</span><b>{health.packages.numpy ?? "—"}</b></div>
        <div><span>sklearn</span><b>{health.packages.sklearn ?? "—"}</b></div>
        <div><span>GPU</span><b>{health.gpu?.name ?? "仅 CPU"}</b></div>
        <div><span>结果</span><b>{formatBytes(health.result.bytes)}</b></div>
        <div><span>视频</span><b className={videos.configured ? "" : "ochre"}>{videos.configured ? "已配置" : "未配置"}</b></div>
      </div>
      <div className="env-summary__note">
        {videos.configured
          ? "原始视频已配置；在具备对应权重时，可以尝试步骤 1/3/4/5。"
          : "步骤 1/3/4/5 受阻：未配置原始视频目录。步骤 2/6/7 只需要已发布的 JSON / pickle。"}
      </div>
      <Link className="section-head__action" to="/archive">完整环境 <ArrowIcon size={10} /></Link>
    </div>
  );
}

function StageList({ pipeline }: { pipeline: Pipeline | null }) {
  if (!pipeline) return <div className="loading">正在读取阶段状态…</div>;
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
              <span><b>需要</b> {stage.needs.join(" · ")}</span>
              <span><b>写出</b> {stage.outputs.join(" · ")}</span>
            </div>
            <div className="stage__cmd">{stage.command}</div>
            {stage.blockers.length ? (
              <div className="stage__blockers">受阻 · {stage.blockers.join(" · ")}</div>
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
                      {statusLabel(check.status)}
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
          <h2 className="job-console__title">未选择任务</h2>
          <span className="micro">沙箱 · runs/&lt;id&gt;/</span>
        </div>
        <div className="empty">运行一次复现验证或产物校验。日志与生成文件都留在 runs/。</div>
      </div>
    );
  }
  const report = job.report;
  const checks = report?.checks ?? [];
  return (
    <div className="job-console">
      <div className="job-console__head">
        <div>
          <h2 className="job-console__title">{job.kind === "verify" ? "产物校验" : "复现任务"}</h2>
          <div className="micro">
            {job.id} · {job.datasets.join(", ") || "清单"} {job.steps ? "· 步骤 " + job.steps : ""} · {job.elapsed} 秒
          </div>
        </div>
        <StatusTag status={job.status} />
      </div>
      <pre className="job-console__log" ref={logRef}>{job.log_text || "等待输出…"}</pre>
      {checks.length ? (
        <div className="job-report">
          <div className="micro" style={{ marginBottom: 5 }}>报告摘要</div>
          {checks.map((check) => (
            <div className="job-report__row" key={check.id}>
              <span>{check.id}</span>
              <StatusTag status={check.status} />
              <span className="mono">{reproDetailZh(check.detail)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {job.error ? <div className="error-box" style={{ marginTop: 10 }}>{job.error}</div> : null}
    </div>
  );
}

export default function PipelinePage() {
  useTitle("流程");
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
      setMessage("请至少选择一个数据集和一个阶段。");
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
            <span>流程 / 清单</span><span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>{total ? total + " 项校验" : "尚未校验"}</span>
          </div>
          <h1 className="page-head__title">每一步，<em>都有回执。</em></h1>
          <p className="page-head__lede">
            步骤 2、6、7 是确定性的，可以重跑到沙箱；步骤 1、3、4、5 需要原始
            视频与模型权重。这里直接说明阻塞，而不是摆一个死按钮。
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">本地执行</span>
          <div className="stamp">
            <b>沙箱 · runs/&lt;job-id&gt;/</b>
            不写入 result/<br />
            日志 · report.json<br />
            {busy ? "任务运行中" : "空闲"}
          </div>
        </div>
      </header>

      <div className="pipeline-top">
        <section className="run-panel" aria-labelledby="run-verification">
          <div className="run-panel__head">
            <h2 className="run-panel__title" id="run-verification">运行复现验证</h2>
            <span className="micro">{busy ? "运行中" : "就绪"}</span>
          </div>
          <div className="run-panel__body">
            <div>
              <div className="micro" style={{ marginBottom: 6 }}>数据集</div>
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
              <div className="micro" style={{ marginBottom: 6 }}>阶段</div>
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
              <PlayIcon size={11} /> {busy ? "运行中…" : "运行验证"}
            </button>
            {busy ? (
              <button className="button button--ghost" onClick={stop}><StopIcon size={11} /> 停止</button>
            ) : null}
            <button className="button button--ghost" onClick={verify} disabled={submitting || busy}>
              校验产物
            </button>
          </div>
          <p className="run-panel__note">
            任务会调用 <span className="mono">scripts/reproduce.py</span>，核对分数与
            聚合 ROC/PR；不会写入 <span className="mono">result/</span>。
          </p>
          {message ? <div className="error-box" style={{ marginTop: 10 }}>{message}</div> : null}
          {active ? (
            <div className="run-panel__active">
              <StatusTag status={active.status} />
              <span className="mono">{active.id}</span>
              <button className="section-head__action" onClick={() => setActive(null)}>清除</button>
            </div>
          ) : null}
        </section>
        <EnvironmentSummary health={health.data} />
      </div>

      <section className="section" style={{ marginTop: 30 }}>
        <div className="section-head">
          <div className="section-head__left">
            <span className="section-head__index">01</span>
            <h2 className="section-head__title">七个阶段</h2>
          </div>
          <div className="section-head__note">
            已验证 · 与发布 JSON 对账 · 警告 · 非逐位一致但接近 · 仅产物 · 已存在但未重跑
          </div>
        </div>
        <StageList pipeline={pipeline.data} />
      </section>

      <section className="section">
        <div className="section-head">
          <div className="section-head__left">
            <span className="section-head__index">02</span>
            <h2 className="section-head__title">作业控制台</h2>
          </div>
          <div className="section-head__note">每次运行都在本地，有日志，也可丢弃。</div>
        </div>
        <JobConsole job={active} />
        <div className="job-list">
          {jobs.length ? jobs.slice(0, 8).map((job) => (
            <button className="job-row" key={job.id} onClick={() => setActive(job)}>
              <span><b>{job.id}</b> · {job.kind === "verify" ? "产物校验" : "复现"} · {job.datasets.join(", ") || "清单"} {job.steps ? "· 步骤 " + job.steps : ""}</span>
              <StatusTag status={job.status} />
              <span>{relativeTime(job.created_at)}</span>
              <span>{job.elapsed} 秒</span>
            </button>
          )) : <div className="empty">还没有任务。第一次复现验证会出现在这里。</div>}
        </div>
      </section>
    </div>
  );
}