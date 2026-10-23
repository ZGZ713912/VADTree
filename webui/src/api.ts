import type {
  Artifacts, Evidence, Health, Job, Overview, Pipeline, ReproductionResponse,
  Run, RunDetail, SearchHit,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore non-JSON errors */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  overview: (dataset?: string) =>
    request<Overview>("/api/overview" + (dataset ? "?dataset=" + encodeURIComponent(dataset) : "")),
  runs: () => request<{ runs: Run[] }>("/api/runs"),
  run: (id: string) => request<RunDetail>("/api/runs/" + encodeURIComponent(id)),
  evidence: (run: string, video: string) =>
    request<Evidence>("/api/evidence?run=" + encodeURIComponent(run) + "&video=" + encodeURIComponent(video)),
  pipeline: () => request<Pipeline>("/api/pipeline"),
  health: (refresh = false) => request<Health>("/api/health" + (refresh ? "?refresh=1" : "")),
  artifacts: () => request<Artifacts>("/api/artifacts"),
  reproduction: () => request<ReproductionResponse>("/api/reproduction"),
  jobs: () => request<{ jobs: Job[] }>("/api/jobs"),
  job: (id: string) => request<Job>("/api/jobs/" + encodeURIComponent(id)),
  createJob: (payload: { kind: string; datasets: string[]; steps: string }) =>
    request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(payload) }),
  cancelJob: (id: string) =>
    request<Job>("/api/jobs/" + encodeURIComponent(id) + "/cancel", { method: "POST" }),
  search: (q: string) => request<{ hits: SearchHit[] }>("/api/search?q=" + encodeURIComponent(q)),
};

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (unit === 0 ? value.toFixed(0) : value.toFixed(1)) + " " + units[unit];
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function formatSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return m + ":" + String(s).padStart(2, "0");
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.round(hours / 24) + "d ago";
}
