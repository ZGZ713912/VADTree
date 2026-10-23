import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { api } from "../api";
import { useAsync, useDebounced } from "../hooks";
import type { Health, SearchHit } from "../types";
import {
  ArchiveIcon, DeskIcon, EvidenceIcon, MarkIcon, PipelineIcon, RunsIcon, SearchIcon,
} from "./Icons";
import { StatusDot } from "./Status";

const NAV = [
  { to: "/", label: "Desk", num: "01", icon: DeskIcon },
  { to: "/runs", label: "Runs", num: "02", icon: RunsIcon },
  { to: "/evidence", label: "Evidence", num: "03", icon: EvidenceIcon },
  { to: "/pipeline", label: "Pipeline", num: "04", icon: PipelineIcon },
  { to: "/archive", label: "Archive", num: "05", icon: ArchiveIcon },
];

const CRUMB: Record<string, string> = {
  "/": "DESK",
  "/runs": "RUN REGISTER",
  "/evidence": "EVIDENCE",
  "/pipeline": "PIPELINE",
  "/archive": "ARCHIVE",
};

function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const debounced = useDebounced(query, 180);
  const navigate = useNavigate();
  const { data } = useAsync(
    () => (open && debounced.trim() ? api.search(debounced.trim()) : Promise.resolve({ hits: [] as SearchHit[] })),
    [open, debounced],
  );
  const hits = data?.hits ?? [];

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [debounced]);

  const go = (hit: SearchHit) => {
    if (hit.type === "run" && hit.id) navigate("/runs?run=" + encodeURIComponent(hit.id));
    else if (hit.type === "video" && hit.run && hit.name)
      navigate("/evidence?run=" + encodeURIComponent(hit.run) + "&video=" + encodeURIComponent(hit.name));
    onClose();
  };

  if (!open) return null;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette__input"
          autoFocus
          value={query}
          placeholder="Search runs, videos, categories…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((value) => Math.min(hits.length - 1, value + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((value) => Math.max(0, value - 1));
            }
            if (e.key === "Enter" && hits[index]) go(hits[index]);
          }}
        />
        <div className="palette__results">
          {!query.trim() ? (
            <div className="palette__empty">Type a video name, a run label, or a category. Esc closes.</div>
          ) : hits.length === 0 ? (
            <div className="palette__empty">No match in the local register.</div>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.type + "-" + (hit.id ?? hit.name ?? i)}
                className="palette__item"
                style={i === index ? { background: "var(--paper-deep)" } : undefined}
                onClick={() => go(hit)}
                onMouseEnter={() => setIndex(i)}
              >
                <b>{hit.type === "run" ? hit.label : hit.label}</b>
                <span>{hit.type} · {hit.sub}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function Shell() {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: health } = useAsync<Health>(() => api.health(), []);
  const { data: runs } = useAsync(() => api.runs(), []);
  const crumb = useMemo(() => CRUMB[location.pathname] ?? "CASE FILE", [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = paletteOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [paletteOpen]);

  const online = health?.venv?.present;
  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail__brand">
          <span className="rail__mark"><MarkIcon size={17} /></span>
          <div>
            <div className="rail__wordmark">VADTree</div>
            <div className="rail__kicker">training-free<br />explainable</div>
          </div>
        </div>
        <nav className="rail__nav" aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => "navlink" + (isActive ? " is-active" : "")}
              >
                <span className="navlink__num">{item.num}</span>
                <span className="navlink__label"><Icon size={14} style={{ marginRight: 8, verticalAlign: "-2px" }} />{item.label}</span>
                <span className="navlink__count">
                  {item.to === "/runs" && runs ? runs.runs.length : ""}
                </span>
              </NavLink>
            );
          })}
        </nav>
        <div className="rail__foot">
          <div className="rail__status">
            <StatusDot status={online ? "verified" : "fail"} />
            <span>{online ? "local ready" : "api offline"}</span>
          </div>
          <div className="rail__meta">
            {health?.git ? "commit " + health.git : "no git metadata"}<br />
            {health?.gpu?.name ? health.gpu.name : "cpu-only"}<br />
            {health?.result ? (health.result.bytes / 1073741824).toFixed(2) + " GB result" : "result not indexed"}
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar__crumb">
            <span>VADTREE</span>
            <span>/</span>
            <b>{crumb}</b>
          </div>
          <div className="topbar__right">
            <span className="topbar__status">
              <StatusDot status={online ? "verified" : "warning"} />
              {online ? "local console" : "connecting"}
            </span>
            <button className="kbd" onClick={() => setPaletteOpen(true)} aria-label="Search">
              <SearchIcon size={11} />
              <span>⌘K</span>
            </button>
          </div>
        </header>
        <main className="main">
          <div className="content">
            <Outlet />
          </div>
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
