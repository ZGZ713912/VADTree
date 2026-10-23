export interface CategoryMetric {
  name: string;
  roc_auc: number | null;
  pr_auc: number | null;
}

export interface Metrics {
  roc_auc: number | null;
  pr_auc: number | null;
  categories: CategoryMetric[];
}

export interface RunConfig {
  similarity_type?: string | null;
  topK?: number | null;
  num_neighbors?: number | null;
  dyn_ratio?: number | null;
  tao?: number | null;
  beta?: number | null;
  frame_interval?: number | null;
  video_fps?: number | string | null;
}

export interface Run {
  id: string;
  kind: "refine" | "ensemble";
  resolution: "coarse" | "fine" | null;
  dataset: string;
  dataset_label: string;
  tree: string;
  stage: string;
  label: string;
  metrics: Metrics;
  config: RunConfig;
  videos: number;
  path: string;
  score_path: string;
  tree_path: string;
  mtime: number;
  featured?: boolean;
}

export interface DatasetSummary {
  id: string;
  label: string;
  short: string;
  blurb: string;
  videos: number;
  runs: number;
  best_run: Run | null;
  highest_run: Run | null;
  best_metric: Metrics;
  baseline: { coarse: Metrics | null; fine: Metrics | null };
}

export interface Strip {
  name: string;
  stem: string;
  category: string;
  auc: number | null;
  duration: number | null;
  curve: [number, number][];
  gt: [number, number][];
}

export interface ReproCheck {
  id: string;
  status: "pass" | "warning" | "fail" | "skipped" | "error" | string;
  detail?: string;
  metric_equal?: boolean;
  scores_equal?: boolean;
  max_score_delta?: number | null;
  aggregate_metric_delta?: number | null;
  published_metric?: Record<string, unknown>;
  reproduced_metric?: Record<string, unknown>;
  videos?: number;
}

export interface Reproduction {
  generated_at: string | null;
  counts: Record<string, number>;
  versions: Record<string, unknown> | null;
  checks: ReproCheck[];
}

export interface Overview {
  datasets: DatasetSummary[];
  selected: string;
  best_run: Run | null;
  categories: CategoryMetric[];
  strips: Strip[];
  counts: { runs: number; datasets: number; videos: number };
  reproduction: Reproduction | null;
}

export interface VideoRow {
  name: string;
  stem: string;
  category: string;
  fps: number;
  frames: number;
  duration: number | null;
  auc: number | null;
  pr_auc: number | null;
  anomaly: boolean;
  gt_count: number;
}

export interface RunDetail {
  run: Run;
  videos: VideoRow[];
  categories: CategoryMetric[];
}

export interface NodeEvidence {
  key: string;
  start: number;
  end: number;
  start_s: number;
  end_s: number;
  score: number | null;
  original_score: number | null;
  caption: string | null;
  reasoning: string | null;
  reasoning_truncated: boolean;
}

export interface EvidenceVideo {
  name: string;
  stem: string;
  category: string;
  fps: number;
  frames: number;
  duration: number | null;
  auc: number | null;
  pr_auc: number | null;
  gt: { start: number; end: number; start_s: number; end_s: number }[];
  has_anomaly: boolean;
}

export interface Evidence {
  run: Run;
  video: EvidenceVideo;
  curve: [number, number][];
  coarse: NodeEvidence[];
  fine: NodeEvidence[];
  redundant_count: number;
  reasoning_source: string | null;
}

export interface StageCheck {
  id: string;
  status: string;
  detail?: string;
  published?: Record<string, unknown> | null;
  reproduced?: Record<string, unknown> | null;
  delta?: number | null;
}

export interface Stage {
  id: number;
  name: string;
  short: string;
  owner: string;
  needs: string[];
  outputs: string[];
  command: string;
  note: string;
  status: "verified" | "warning" | "fail" | "asset" | "blocked" | "untested" | string;
  runnable: boolean;
  checks: StageCheck[];
  blockers: string[];
}

export interface Pipeline {
  stages: Stage[];
  reproduction: Reproduction;
  generated_at: string | null;
}

export interface Job {
  id: string;
  kind: "reproduce" | "verify";
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  datasets: string[];
  steps: string;
  command: string;
  dir: string;
  exit_code: number | null;
  report: {
    checks?: ReproCheck[];
    versions?: Record<string, unknown>;
    generated_at?: string;
  } | null;
  error: string | null;
  elapsed: number;
  log_text: string;
}

export interface ReproductionResponse extends Reproduction {}

export interface Bundle {
  name: string;
  asset: string;
  steps: number[];
  required: boolean;
  stripped_cot: boolean;
  bytes: number;
  files: number;
  present: number;
  full_cot: number;
  missing: string[];
  missing_count: number;
  description: string;
}

export interface Artifacts {
  manifest: {
    repo: string;
    release_tag: string;
    generated_at: string;
    total_bytes: number;
  } | null;
  bundles: Bundle[];
  cache_bytes: number;
}

export interface Health {
  checked_at: string;
  venv: { path: string | null; python: string | null; present: boolean };
  packages: Record<string, string | null>;
  gpu: { name: string; memory: string | null; driver: string | null } | null;
  result: { bytes: number; files: number };
  disk: { free: number; total: number };
  git: string | null;
  videos: { configured: boolean; root: string; datasets: Record<string, string> };
  weights: Record<string, { label: string; path: string | null; present: boolean }>;
  dist_built: boolean;
}

export interface SearchHit {
  type: "run" | "video";
  id?: string;
  dataset?: string;
  run?: string;
  name?: string;
  label: string;
  sub?: string;
}
