import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { API_URL } from "@shared/api";
import type { SearchHit } from "./types";

const I = {
  overview: <path d="M2 2h5v5H2zM9 2h5v3H9zM9 7h5v7H9zM2 9h5v5H2z" />,
  models: <path d="M8 1.5 14 5v6l-6 3.5L2 11V5zM2 5l6 3.5L14 5M8 8.5V14.5" />,
  datasets: <><ellipse cx="8" cy="3.5" rx="5.5" ry="2" /><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" /></>,
  projects: <path d="M1.5 4.5V13a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3h-4a1 1 0 0 0-1 1z" />,
  people: <><circle cx="6" cy="5.5" r="2.5" /><path d="M1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M11 3.2a2.5 2.5 0 0 1 0 4.6M12.5 9.8c1.2.6 2 1.9 2 4.2" /></>,
  activity: <path d="M1.5 8.5h3l2-5 3 9 2-4h3" />,
  system: <><rect x="1.5" y="2.5" width="13" height="8" rx="1" /><path d="M5.5 14h5M8 10.5V14" /></>,
};

function Icon({ d }: { d: JSX.Element }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
      {d}
    </svg>
  );
}

const KIND_LABEL: Record<SearchHit["type"], string> = {
  model_version: "Model", project: "Project", dataset: "Dataset", researcher: "Person",
};

function Search() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [meta, setMeta] = useState<{ ms: number; cache: string | null } | null>(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      const t0 = performance.now();
      try {
        const res = await fetch(`${API_URL}/api/v1/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as SearchHit[];
        setHits(data);
        setSel(0);
        setMeta({ ms: performance.now() - t0, cache: res.headers.get("X-Cache") });
      } catch {
        /* aborted or offline; keep previous results */
      }
    }, 120);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [q]);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    if (h.type === "model_version") nav(`/models/${h.id}`);
    else if (h.type === "project") nav(`/projects/${h.id}`);
    else if (h.type === "dataset") nav(`/datasets#${h.id}`);
    else nav(`/people#${h.id}`);
  };

  return (
    <div className="search">
      <svg className="icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="7" cy="7" r="5" /><path d="m11 11 3.5 3.5" />
      </svg>
      <input
        ref={input}
        type="search"
        placeholder="Search models, datasets, commits, people"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === "Enter") go(hits[sel]);
          if (e.key === "Escape") input.current?.blur();
        }}
        aria-label="Search"
      />
      {!q && <kbd>⌘K</kbd>}
      {open && hits && (
        <div className="search-results" role="listbox">
          {hits.length === 0 && <div className="empty" style={{ padding: 14 }}>No matches for “{q}”</div>}
          {hits.map((h, i) => (
            <button key={`${h.type}${h.id}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onMouseDown={() => go(h)}>
              <span className="kind">{KIND_LABEL[h.type]}</span>
              <span>{h.title}</span>
              <span className="sub">{h.subtitle}</span>
            </button>
          ))}
          {meta && (
            <div className="search-meta num">
              {hits.length} result{hits.length === 1 ? "" : "s"} · {meta.ms.toFixed(0)} ms{meta.cache === "HIT" ? " · cached" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const docs = `${API_URL || ""}/docs`;

  return (
    <div className="shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <NavLink to="/" className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#1c5cab" />
            <rect x="8" y="8" width="16" height="4" rx="1" fill="#fff" />
            <rect x="8" y="14" width="16" height="4" rx="1" fill="#fff" opacity=".75" />
            <rect x="8" y="20" width="10" height="4" rx="1" fill="#fff" opacity=".5" />
          </svg>
          <span>LabLedger<small>Model & dataset registry</small></span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end><Icon d={I.overview} />Overview</NavLink>
          <NavLink to="/models"><Icon d={I.models} />Models</NavLink>
          <NavLink to="/datasets"><Icon d={I.datasets} />Datasets</NavLink>
          <NavLink to="/projects"><Icon d={I.projects} />Projects</NavLink>
          <NavLink to="/people"><Icon d={I.people} />People</NavLink>
          <div className="nav-section">Platform</div>
          <NavLink to="/activity"><Icon d={I.activity} />Activity</NavLink>
          <NavLink to="/system"><Icon d={I.system} />System</NavLink>
        </nav>
        <div className="sidebar-foot">
          <a href={docs} target="_blank" rel="noreferrer">API reference ↗</a>
          <span className="env-tag" title="This deployment runs on sample data">Demo environment · sample data</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn menu-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu">☰</button>
          <Search />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
