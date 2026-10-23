import type { ReactNode } from "react";

const STATUS_LABEL: Record<string, string> = {
  pass: "pass",
  verified: "verified",
  completed: "completed",
  warning: "warning",
  fail: "fail",
  error: "error",
  blocked: "blocked",
  asset: "asset only",
  untested: "untested",
  skipped: "skipped",
  queued: "queued",
  running: "running",
  cancelled: "cancelled",
};

function tone(status: string): { cls: string; dot: string } {
  switch (status) {
    case "pass":
    case "verified":
    case "completed":
      return { cls: "tag--moss", dot: "var(--moss)" };
    case "warning":
    case "queued":
      return { cls: "tag--ochre", dot: "var(--ochre)" };
    case "fail":
    case "error":
    case "running":
      return { cls: "tag--red", dot: "var(--vermilion)" };
    case "asset":
      return { cls: "tag--ink", dot: "var(--ink)" };
    default:
      return { cls: "tag--faint", dot: "var(--ink-faint)" };
  }
}

export function StatusTag({ status, label }: { status: string; label?: ReactNode }) {
  const { cls, dot } = tone(status);
  return (
    <span className={"tag " + cls}>
      <span
        className={"dot dot--sm" + (status === "running" ? " pulse" : "")}
        style={{ background: dot }}
      />
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function StatusDot({ status, title }: { status: string; title?: string }) {
  const { dot } = tone(status);
  return (
    <span
      className={"dot" + (status === "running" ? " pulse" : "")}
      style={{ background: dot }}
      title={title ?? status}
      aria-label={title ?? status}
    />
  );
}

export function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}
