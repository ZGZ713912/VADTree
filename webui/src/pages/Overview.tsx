import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, formatNumber } from "../api";
import { CategoryLollipop, MetricRuler, ScoreStrip } from "../components/Charts";
import { StatusDot, StatusTag, statusLabel } from "../components/Status";
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
          <span className="micro">本机复现</span>
          <StatusTag status="untested" />
        </div>
        <div className="repro-stamp__count">—</div>
        <div className="repro-stamp__rows">
          <div className="repro-stamp__row"><span>状态</span><b>未在当前检出中运行</b></div>
        </div>
      </div>
    );
  }
  const counts = repro.counts ?? {};
  const total = (counts.pass ?? 0) + (counts.warning ?? 0) + (counts.fail ?? 0);
  return (
    <div className="repro-stamp">
      <div className="repro-stamp__head">
        <span className="micro">本机复现</span>
        <span className="tag tag--moss">本机</span>
      </div>
      <div className="repro-stamp__count">
        {counts.pass ?? 0}<span> / {total} 项校验</span>
      </div>
      <div className="repro-stamp__rows">
        <div className="repro-stamp__row"><span>通过</span><b>{counts.pass ?? 0}</b></div>
        <div className="repro-stamp__row"><span>警告</span><b>{counts.warning ?? 0}</b></div>
        <div className="repro-stamp__row"><span>失败</span><b>{counts.fail ?? 0}</b></div>
        <div className="repro-stamp__row">
          <span>生成</span>
          <b>{repro.generated_at ? repro.generated_at.slice(0, 16).replace("T", " ") : "—"}</b>
        </div>
      </div>
    </div>
  );
}

function DatasetStats({ dataset, metrics }: { dataset: DatasetSummary; metrics: Metrics }) {
  return (
    <div className="stat-grid">
      <Stat label="PR AUC" value={formatNumber(metrics.pr_auc, 4)} note="精确率–召回率" />
      <Stat label="视频" value={dataset.videos} note="当前树中已计分" />
      <Stat label="运行" value={dataset.runs} note="细化 + 集成" />
      <Stat
        label="粗粒度基线"
        value={formatNumber(dataset.baseline?.coarse?.roc_auc, 4)}
        note="单一粒度"
      />
    </div>
  );
}

function PipelineLedger({ pipeline }: { pipeline: Pipeline | null }) {
  if (!pipeline) return <div className="loading">正在读取流程清单…</div>;
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
            {statusLabel(stage.status)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  useTitle("总览");
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
    return <div className="loading">正在打开案件登记…</div>;
  }
  if (overview.error) {
    return <div className="error-box">无法读取证据接口。{overview.error}</div>;
  }
  if (!data || !selected || !best) {
    return <div className="empty">result/ 中没有已完成的运行。请先恢复发布产物。</div>;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="page-head__kicker micro">
            <span>案头 / 案件登记</span>
            <span className="dot dot--sm" style={{ background: "var(--vermilion)" }} />
            <span>第 001 期</span>
          </div>
          <h1 className="page-head__title">异常，<em>有迹可循。</em></h1>
          <p className="page-head__lede">
            把每一个分数读回一段视频、一个 HGTree 节点，以及模型用来自证的那句话。
            这里是已发布 VADTree 运行的本地索引——没有演示数据，也没有隐藏的重跑。
          </p>
        </div>
        <div className="page-head__side">
          <span className="tag tag--ink">本地证据控制台</span>
          <div className="stamp">
            <b>{data.counts.datasets} 个数据集 / {data.counts.runs} 次运行</b>
            {data.counts.videos.toLocaleString()} 段视频已计分<br />
            {selected.label} 精选<br />
            本机 · 4060 Ti
          </div>
        </div>
      </header>

      <section className="hero" aria-labelledby="featured-metric">
        <div className="hero__metric">
          <div className="metric__top">
            <span className="micro" id="featured-metric">精选运行 / {selected.label}</span>
            <span className="tag tag--red">集成</span>
          </div>
          <div className="metric__value">
            {formatNumber(best.metrics.roc_auc, 4)}
            <small>ROC AUC</small>
          </div>
          <div className="metric__caption">
            {best.label} · {best.videos} 段视频 · {best.kind === "ensemble" ? "粗/细粒度关联" : "单一粒度"}
          </div>
          {delta !== null ? (
            <div className={"metric__delta" + (delta < 0 ? " metric__delta--warn" : "")}>
              <span className="dot dot--sm" />
              {delta >= 0 ? "+" : ""}{delta.toFixed(4)}，较粗粒度基线 {formatNumber(coarse?.roc_auc, 4)}
            </div>
          ) : null}
          <MetricRuler value={best.metrics.roc_auc} />
        </div>
        <div className="hero__side">
          <div className="dataset-tabs" role="tablist" aria-label="数据集">
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
              台账最高分：<b>{formatNumber(highest.metrics.roc_auc, 4)}</b><br />
              {highest.label} · 非头条变体，保留可见而非替换精选结果。
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
          title="分数图谱"
          note="精选运行中的 12 段真实视频。峰不是缩略图，而是发布版异常分数。"
          action={<Link to={"/evidence?run=" + encodeURIComponent(best.id) + "&video=" + encodeURIComponent(data.strips[0]?.name ?? "")}>打开证据 →</Link>}
        />
        {data.strips.length ? (
          <div className="atlas-grid">
            {data.strips.map((strip) => <ScoreStrip key={strip.name} runId={best.id} strip={strip} />)}
          </div>
        ) : (
          <div className="empty">精选运行暂时没有逐视频分数条带。</div>
        )}
      </section>

      <section className="section">
        <div className="two-col">
          <div>
            <SectionHead
              index="02"
              title="类别账本"
              note="按发布类别统计 ROC AUC。正常类没有 ROC（全为负样本），故省略。"
            />
            <CategoryLollipop categories={data.categories} />
            <p className="muted" style={{ marginTop: 14, fontSize: 12, maxWidth: 560 }}>
              {selected.blurb} 类别分数读取自精选集成的 <span className="mono">dataset_metric</span>。
            </p>
          </div>
          <div>
            <SectionHead index="03" title="流程清单" note="七个阶段，以及它们在本机的实际校验状态。" />
            <PipelineLedger pipeline={pipeline.data} />
          </div>
        </div>
      </section>

      <section className="stamp-row">
        <div>
          <div className="micro">阅读说明</div>
          <p style={{ maxWidth: 640, marginTop: 8, fontSize: 13, color: "var(--ink-soft)" }}>
            实心红带是真值区间。曲线是发布包实际给出的分数。遇到不能逐位一致的校验，
            这里保留差值，而不是把它抹成一个绿色徽章。打开任一条带，可阅读粗/细节点、
            模型描述与思维链。
          </p>
          <div className="micro" style={{ marginTop: 12 }}>
            数据 · result/ · 清单 · {data.counts.videos.toLocaleString()} 段视频 · 仅本地
          </div>
        </div>
        <ReproStamp repro={data.reproduction} />
      </section>
    </div>
  );
}
