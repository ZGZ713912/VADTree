import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { CategoryMetric, Evidence, NodeEvidence, Strip } from "../types";
import { formatNumber, formatSeconds } from "../api";
import { useSize } from "../hooks";

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function scoreBucket(score: number | null): number {
  if (score === null || Number.isNaN(score)) return 0;
  if (score < 0.2) return 0;
  if (score < 0.4) return 1;
  if (score < 0.6) return 2;
  if (score < 0.8) return 3;
  return 4;
}

/* ------------------------------------------------------------- score strip */

export function ScoreStrip({ runId, strip }: { runId: string; strip: Strip }) {
  const patternId = useId().replace(/:/g, "");
  const duration = strip.duration || strip.curve[strip.curve.length - 1]?.[0] || 1;
  const width = 300;
  const height = 52;
  const baseY = height - 4;
  const topPad = 6;

  const { line, area, peak } = useMemo(() => {
    if (!strip.curve.length) return { line: "", area: "", peak: null as [number, number] | null };
    let highest = strip.curve[0];
    const points = strip.curve.map(([t, score]) => {
      if (score > highest[1]) highest = [t, score];
      const x = clamp(t / duration, 0, 1) * width;
      const y = baseY - score * (height - topPad - 6);
      return [x, y] as [number, number];
    });
    const line = points.map(([x, y], index) => (index === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2)).join(" ");
    const area = line + " L" + width + "," + baseY + " L0," + baseY + " Z";
    const peakX = clamp(highest[0] / duration, 0, 1) * width;
    const peakY = baseY - highest[1] * (height - topPad - 6);
    return { line, area, peak: [peakX, peakY] as [number, number] };
  }, [strip.curve, duration]);

  const href = "/evidence?run=" + encodeURIComponent(runId) + "&video=" + encodeURIComponent(strip.name);

  return (
    <Link className="strip" to={href} aria-label={"Open evidence for " + strip.stem}>
      <div className="strip__head">
        <span className="strip__name" title={strip.name}>{strip.stem}</span>
        <span className="strip__auc">{formatNumber(strip.auc, 4)}</span>
      </div>
      <div className="strip__meta">
        <span>{strip.category}</span>
        <span>·</span>
        <span>{formatSeconds(duration)}</span>
      </div>
      <svg
        className="strip__chart"
        viewBox={"0 0 " + width + " " + height}
        preserveAspectRatio="none"
        role="img"
        aria-label={strip.stem + " anomaly score over time"}
      >
        <defs>
          <pattern id={"hatch-" + patternId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(198,63,34,.34)" strokeWidth="1" />
          </pattern>
        </defs>
        {strip.gt.map(([start, end], index) => {
          const x = clamp(start / duration, 0, 1) * width;
          const w = Math.max(1, clamp((end - start) / duration, 0, 1) * width);
          return <rect key={index} x={x} y={topPad} width={w} height={baseY - topPad} fill={"url(#hatch-" + patternId + ")"} />;
        })}
        <path d={area} fill="rgba(25,23,19,.035)" />
        <path d={line} className="curve-line" />
        {peak ? <circle cx={peak[0]} cy={peak[1]} r="1.7" className="peak-dot" /> : null}
        <line x1="0" y1={baseY} x2={width} y2={baseY} className="axis-line" />
      </svg>
    </Link>
  );
}

/* -------------------------------------------------------------- timeline */

function nearestPoint(curve: [number, number][], t: number): [number, number] | null {
  if (!curve.length) return null;
  let low = 0;
  let high = curve.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (curve[mid][0] < t) low = mid;
    else high = mid;
  }
  return Math.abs(curve[low][0] - t) <= Math.abs(curve[high][0] - t) ? curve[low] : curve[high];
}

export function Timeline({
  evidence,
  selected,
  onSelect,
}: {
  evidence: Evidence;
  selected: NodeEvidence | null;
  onSelect: (node: NodeEvidence, kind: "coarse" | "fine") => void;
}) {
  const { ref, size } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; t: number; score: number } | null>(null);
  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);
  const duration = evidence.video.duration || evidence.curve[evidence.curve.length - 1]?.[0] || 1;
  const patternId = useId().replace(/:/g, "");
  const padTop = 10;
  const padBottom = 6;

  const geometry = useMemo(() => {
    if (!width || !height || !evidence.curve.length) return null;
    const plotHeight = height - padTop - padBottom;
    const xOf = (t: number) => clamp(t / duration, 0, 1) * width;
    const yOf = (score: number) => padTop + (1 - clamp(score, 0, 1)) * plotHeight;
    let line = "";
    evidence.curve.forEach(([t, score], index) => {
      line += (index === 0 ? "M" : "L") + xOf(t).toFixed(2) + "," + yOf(score).toFixed(2);
    });
    const area = line + " L" + width + "," + (height - padBottom) + " L0," + (height - padBottom) + " Z";
    return { xOf, yOf, line, area, plotHeight };
  }, [width, height, evidence.curve, duration]);

  if (!evidence.curve.length) {
    return <div className="empty">This run has no per-frame score curve for {evidence.video.stem}.</div>;
  }

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const t = (x / rect.width) * duration;
    const point = nearestPoint(evidence.curve, t);
    if (point) setHover({ x, t: point[0], score: point[1] });
  };

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const t = (x / rect.width) * duration;
    const node = evidence.coarse.find((item) => t >= item.start_s && t <= item.end_s);
    if (node) onSelect(node, "coarse");
    else {
      const fine = evidence.fine.find((item) => t >= item.start_s && t <= item.end_s);
      if (fine) onSelect(fine, "fine");
    }
  };

  const selectedNode = selected;
  const gtLabel = evidence.video.gt[0];

  return (
    <div className="timeline">
      <div className="timeline__plot">
        <div className="timeline__y" aria-hidden="true">
          <span>1.0</span>
          <span>0.5</span>
          <span>0.0</span>
        </div>
        <div className="timeline__canvas" ref={ref}>
        {width > 0 && geometry ? (
          <>
            <svg
              className="timeline__svg"
              width={width}
              height={height}
              viewBox={"0 0 " + width + " " + height}
              role="img"
              aria-label={"Anomaly score timeline for " + evidence.video.name}
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
              onClick={handleClick}
            >
              <defs>
                <pattern id={"timeline-hatch-" + patternId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(198,63,34,.4)" strokeWidth="1" />
                </pattern>
              </defs>
              {[0.25, 0.5, 0.75].map((ratio) => (
                <line key={ratio} x1="0" y1={geometry.yOf(ratio)} x2={width} y2={geometry.yOf(ratio)} className="grid" />
              ))}
              {evidence.video.gt.map((range, index) => {
                const x = geometry.xOf(range.start_s);
                const w = Math.max(1, geometry.xOf(range.end_s) - x);
                return <rect key={index} x={x} y={padTop} width={w} height={geometry.plotHeight} className="gt" fill={"url(#timeline-hatch-" + patternId + ")"} />;
              })}
              {selectedNode ? (
                <rect
                  x={geometry.xOf(selectedNode.start_s)}
                  y={padTop}
                  width={Math.max(1, geometry.xOf(selectedNode.end_s) - geometry.xOf(selectedNode.start_s))}
                  height={geometry.plotHeight}
                  fill="rgba(198,63,34,.045)"
                />
              ) : null}
              <path d={geometry.area} className="area" />
              <path d={geometry.line} className="curve" />
              {evidence.coarse.map((node, index) => (
                <line
                  key={index}
                  x1={geometry.xOf(node.start_s)}
                  y1={padTop}
                  x2={geometry.xOf(node.start_s)}
                  y2={height - padBottom}
                  className="node-line"
                />
              ))}
              {hover ? (
                <>
                  <line x1={hover.x} y1={0} x2={hover.x} y2={height - padBottom} stroke="var(--vermilion)" strokeWidth="0.8" />
                  <circle cx={geometry.xOf(hover.t)} cy={geometry.yOf(hover.score)} r="2.2" fill="var(--vermilion)" />
                </>
              ) : null}
            </svg>
            {gtLabel ? (
              <span
                className="gt-label"
                style={{ left: Math.max(0, geometry.xOf(gtLabel.start_s)) + 4 }}
              >
                GT
              </span>
            ) : null}
            {hover ? (
              <div
                className="timeline__tooltip"
                style={{ left: Math.min(Math.max(hover.x + 10, 8), Math.max(8, width - 118)) }}
              >
                <div>{formatSeconds(hover.t)}</div>
                <b>{formatNumber(hover.score, 3)}</b>
              </div>
            ) : null}
          </>
        ) : null}
        </div>
      </div>
      <div className="timeline__axis" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <span key={ratio}>{formatSeconds(duration * ratio)}</span>
        ))}
      </div>
      <div className="timeline__legend">
        <span><i className="legend-swatch legend-swatch--curve" /> score</span>
        <span><i className="legend-swatch legend-swatch--gt" /> ground truth</span>
        <span><i className="legend-swatch" style={{ borderStyle: "dashed" }} /> coarse node boundary</span>
      </div>
      <NodeLanes evidence={evidence} selected={selected} onSelect={onSelect} />
    </div>
  );
}

export function NodeLanes({
  evidence,
  selected,
  onSelect,
}: {
  evidence: Evidence;
  selected: NodeEvidence | null;
  onSelect: (node: NodeEvidence, kind: "coarse" | "fine") => void;
}) {
  const duration = evidence.video.duration || evidence.curve[evidence.curve.length - 1]?.[0] || 1;
  const lanes: { kind: "coarse" | "fine"; label: string; nodes: NodeEvidence[] }[] = [
    { kind: "coarse", label: "COARSE", nodes: evidence.coarse },
    { kind: "fine", label: "FINE", nodes: evidence.fine },
  ];
  return (
    <div className="lanes" aria-label="HGTree node lanes">
      {lanes.map((lane) => (
        <div className="lane" key={lane.kind}>
          <div className="lane__label">{lane.label}</div>
          <div className="lane__track">
            {lane.nodes.map((node) => {
              const left = clamp(node.start_s / duration, 0, 1) * 100;
              const width = Math.max(0.5, clamp((node.end_s - node.start_s) / duration, 0, 1) * 100);
              const isSelected = selected?.key === node.key && selected?.start === node.start;
              return (
                <button
                  key={lane.kind + "-" + node.key}
                  className={"node node--s" + scoreBucket(node.score) + (isSelected ? " is-selected" : "")}
                  style={{ left: left + "%", width: width + "%" }}
                  title={lane.label + " " + node.key + " · score " + formatNumber(node.score, 3)}
                  aria-label={lane.label + " node " + node.key + ", score " + formatNumber(node.score, 3)}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(node, lane.kind)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="lane__hint">
        {evidence.coarse.length} coarse · {evidence.fine.length} fine · {evidence.redundant_count} redundant candidates · click a node to inspect
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- lollipop */

export function CategoryLollipop({ categories }: { categories: CategoryMetric[] }) {
  const rows = categories
    .filter((item) => item.roc_auc !== null && item.name !== "all")
    .sort((a, b) => (b.roc_auc ?? 0) - (a.roc_auc ?? 0))
    .slice(0, 12);
  if (!rows.length) {
    return <div className="empty">No category breakdown was published for this run.</div>;
  }
  return (
    <div className="lollipop" role="list" aria-label="ROC AUC by category">
      {rows.map((row) => {
        const value = row.roc_auc ?? 0;
        const tone = row.name === "Abnormal" ? "red" : row.name === "Normal" ? "moss" : value < 0.6 ? "ochre" : "";
        return (
          <div className="lollipop__row" role="listitem" key={row.name}>
            <span className="lollipop__label" title={row.name}>{row.name}</span>
            <span className="lollipop__track" aria-hidden="true">
              {[0.25, 0.5, 0.75].map((tick) => (
                <i key={tick} className="lollipop__tick" style={{ left: tick * 100 + "%" }} />
              ))}
              <i className={"lollipop__dot" + (tone ? " lollipop__dot--" + tone : "")} style={{ left: value * 100 + "%" }} />
            </span>
            <span className="lollipop__value">{formatNumber(value, 4)}</span>
          </div>
        );
      })}
      <div className="lollipop__scale" aria-hidden="true">
        <span>0</span><span>0.5</span><span>1.0 ROC</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ruler */

export function MetricRuler({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = clamp(value, 0, 1) * 100;
  return (
    <div className="ruler" aria-hidden="true">
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <span className="ruler__tick" key={tick} style={{ left: tick * 100 + "%" }}>
          <span>{tick === 0 ? "0" : tick === 1 ? "1.0" : tick.toFixed(2)}</span>
        </span>
      ))}
      <span className="ruler__mark" style={{ left: pct + "%" }}>
        <span>ROC {formatNumber(value, 4)}</span>
      </span>
    </div>
  );
}
