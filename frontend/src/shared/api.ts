import { useEffect, useRef, useState } from "react";

/** Accepts a full URL or a bare host (as Render's service references provide). */
export function baseUrl(raw: string | undefined): string {
  if (!raw) return "";
  const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return url.replace(/\/$/, "");
}

export const API_URL = baseUrl(import.meta.env.VITE_API_URL as string | undefined);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API_URL + path, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export type FetchState<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** true while retrying after a network failure (API cold-starting or unreachable) */
  reconnecting: boolean;
  reload: () => void;
};

/** GET with retry on network errors. 4xx/5xx responses are not retried. */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}): FetchState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [tick, setTick] = useState(0);
  const lastPath = useRef(path);

  useEffect(() => {
    if (lastPath.current !== path) {
      setData(undefined);
      lastPath.current = path;
    }
    if (!path) return;
    const ctrl = new AbortController();
    let attempt = 0;
    let timer: number | undefined;

    const run = async () => {
      setLoading(true);
      try {
        const d = await getJson<T>(path, ctrl.signal);
        setData(d);
        setError(undefined);
        setReconnecting(false);
        setLoading(false);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError) {
          setError(e);
          setLoading(false);
          return;
        }
        attempt += 1;
        setReconnecting(true);
        timer = window.setTimeout(run, Math.min(8000, 1000 * attempt));
      }
    };
    run();
    let interval: number | undefined;
    if (opts.refreshMs) interval = window.setInterval(() => setTick((t) => t + 1), opts.refreshMs);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
    // tick re-runs the effect for polling; refreshMs is fixed per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);

  return { data, error, loading, reconnecting, reload: () => setTick((t) => t + 1) };
}
