import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, formatBytes, formatNumber, relativeTime, reproDetailZh } from "../api";
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
          {running ? "正在哈希…" : "校验产物哈希"}
        </button>
        <span className="micro">逐文件对照 MANIFEST.json</span>
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      {job ? (
        <>
          <div className="repro-detail__status">
            <StatusTag status={job.status} />
            <span className="mono" style={{ fontSize: 9 }}>{job.id} · {job.elapsed} 秒</span>
          </div>
          <pre className="verify-log">{job.log_text || "等待输出…"}</pre>
        </>
      ) : null}
      {artifacts ? (
        <div className="archive-note">
          {artifacts.manifest?.repo ?? "—"} · {artifacts.manifest?.release_tag ?? "—"} · 缓存{" "}
          {formatBytes(artifacts.cache_bytes)}
        </div>
      ) : null}
    </>
  );
}

export default function ArchivePage() {
  useTitle("档案");
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
            <span>档案 / 证据</span><span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>{present}/{files} 个文件在磁盘</span>
          </div>
          <h1 className="page-head__title">证据，<em>收进档案。</em></h1>
          <p className="page-head__lede">
            发布清单、本机环境，以及支撑案头数字的复现校验。
            缺失文件与非逐位一致的警告都会留在记录里。
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">发布产物</span>
          <div className="stamp">
            <b>{bundles.length} 个包 / {files} 个文件</b>
            {formatBytes(artifacts.data?.manifest?.total_bytes)} 已发布<br />
            {totalChecks} 项复现校验<br />
            git {health.data?.git ?? "—"}
          </div>
        </div>
      </header>

      <div className="archive-grid">
        <section>
          <div className="section-head">
            <div className="section-head__left">
              <span className="section-head__index">01</span>
              <h2 className="section-head__title">清单包</h2>
            </div>
            <div className="section-head__note">必需包供步骤 2/6/7 使用；可选包携带 CoT 或便捷输出。</div>
          </div>
          {artifacts.loading && !artifacts.data ? <div className="loading">正在读取清单…</div> : null}
          {artifacts.error ? <div className="error-box">{artifacts.error}</div> : null}
          {bundles.map((bundle) => {
            const ratio = bundle.files ? bundle.present / bundle.files : 0;
            return (
              <div className="bundle" key={bundle.name}>
                <div>
                  <div className="bundle__name">{bundle.name}</div>
                  <div className="bundle__meta">
                    步骤 {bundle.steps.length ? bundle.steps.join(", ") : "—"} · {bundle.required ? "必需" : "可选"}
                    {bundle.stripped_cot ? " · 已去 CoT" : ""}
                    {bundle.full_cot ? " · " + bundle.full_cot + " 个完整 CoT 变体在磁盘" : ""}
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
            校验器通过规范化哈希接受完整 CoT；清单本身记录的是
            去 CoT 的发布形态。参见 <span className="mono">docs/REPRODUCTION.md</span> and{" "}
            <span className="mono">repro/latest.json</span>.
          </div>
        </section>

        <aside>
          <div className="section-head">
            <div className="section-head__left">
              <span className="section-head__index">02</span>
              <h2 className="section-head__title">本机环境</h2>
            </div>
          </div>
          {health.loading && !health.data ? <div className="loading">正在检查…</div> : null}
          {health.data ? (
            <div className="env-list">
              {[
                ["Python", health.data.venv.python ? health.data.venv.python + " · " + (health.data.venv.present ? "venv 就绪" : "无 venv") : "缺少 .venv"],
                ["numpy", health.data.packages.numpy ?? "—"],
                ["scipy", health.data.packages.scipy ?? "—"],
                ["sklearn", health.data.packages.sklearn ?? "—"],
                ["GPU", health.data.gpu ? health.data.gpu.name + " · " + health.data.gpu.memory : "仅 CPU"],
                ["结果", formatBytes(health.data.result.bytes) + " · " + health.data.result.files + " 个文件"],
                ["磁盘可用", formatBytes(health.data.disk.free)],
                ["视频", health.data.videos.configured ? health.data.videos.root : "未配置"],
                ["权重", Object.values(health.data.weights).filter((weight) => weight.present).length + "/" + Object.keys(health.data.weights).length + " 已配置"],
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
              步骤 1/3/4/5 仍受阻。设置 <span className="mono">VADTREE_VIDEO_ROOT</span> 与模型
              环境变量后才能尝试；当前案头只声明它能验证的部分。
            </div>
          ) : null}
          <Link className="section-head__action" to="/pipeline" style={{ display: "inline-flex", marginTop: 14, alignItems: "center", gap: 4 }}>
            打开流程 <ArrowIcon size={10} />
          </Link>
        </aside>
      </div>

      <section className="archive-section">
        <div className="section-head">
          <div className="section-head__left">
            <span className="section-head__index">03</span>
            <h2 className="section-head__title">复现校验</h2>
          </div>
          <div className="section-head__note">
            {counts.pass ?? 0} 通过 · {counts.warning ?? 0} 警告 · {counts.fail ?? 0} 失败 ·{" "}
            {repro.data?.generated_at ? relativeTime(repro.data.generated_at) : "未运行"}
          </div>
        </div>
        <div className="repro-table">
          {(repro.data?.checks ?? []).map((check) => (
            <div className="repro-row" key={check.id}>
              <div>
                <div className="repro-row__id">{check.id}</div>
                <div className="repro-row__detail">
                  {reproDetailZh(check.detail)}
                  {check.published_metric && check.reproduced_metric ? (
                    <>
                      {" "}· 发布 {formatNumber(rocOf(check.published_metric), 4)}
                      {" "}→ 复现 {formatNumber(rocOf(check.reproduced_metric), 4)}
                    </>
                  ) : null}
                  {check.max_score_delta !== null && check.max_score_delta !== undefined ? (
                    <> · 最大分数 Δ {formatNumber(check.max_score_delta, 4)}</>
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
            <div className="empty">没有找到复现报告。运行 <span className="mono">scripts/reproduce.py</span>。</div>
          ) : null}
        </div>
        <div className="archive-note">
          通过表示分数与聚合 ROC/PR 一致；警告表示明确非逐位一致，但在
          文档记录的容差内。参见 <span className="mono">docs/REPRODUCTION.md</span>.
        </div>
      </section>
    </div>
  );
}