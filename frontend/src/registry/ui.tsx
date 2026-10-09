import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import type { FetchState } from "@shared/api";
import type { Stage } from "./types";

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`badge ${stage}`}>
      <span className="dot" />
      {stage}
    </span>
  );
}

const AVATAR_COLORS = ["#2a78d6", "#c2531f", "#13865d", "#a86f00", "#c14a7b", "#007000", "#4a3aa7", "#c43c3b", "#52514e"];
const HANDLES = ["hreddy", "mokafor", "druiz", "pnatarajan", "lzhao", "tbrooks", "abello", "kmensah", "sherrera"];

export function Avatar({ handle, name }: { handle: string; name: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const i = Math.max(0, HANDLES.indexOf(handle));
  return <span className="avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }} aria-hidden>{initials}</span>;
}

export function Who({ handle, name }: { handle: string; name: string }) {
  return (
    <Link to={`/people#${handle}`} className="who" style={{ color: "var(--ink)" }} onClick={(e) => e.stopPropagation()}>
      <Avatar handle={handle} name={name} />
      {name}
    </Link>
  );
}

export function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy"
      title="Copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "copied" : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="copy">
          <rect x="5" y="5" width="9" height="9" rx="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
        </svg>
      )}
    </button>
  );
}

/** Loading, reconnecting and error handling around a fetch. */
export function Async<T>({ state, children, skeleton = 240 }: { state: FetchState<T>; children: (data: T) => ReactNode; skeleton?: number }) {
  if (state.error) {
    return (
      <div className="card empty">
        {state.error.message}
        <div style={{ marginTop: 10 }}><button className="btn" onClick={state.reload}>Retry</button></div>
      </div>
    );
  }
  if (state.data === undefined) {
    return (
      <>
        {state.reconnecting && (
          <div className="banner"><span className="spinner" /> Connecting to the registry API…</div>
        )}
        <div className="skeleton" style={{ height: skeleton }} />
      </>
    );
  }
  return <>{children(state.data)}</>;
}

export function PageHead({ title, sub, crumbs, right }: { title: ReactNode; sub?: ReactNode; crumbs?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}
