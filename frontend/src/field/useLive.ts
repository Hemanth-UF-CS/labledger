import { useEffect, useRef, useState } from "react";
import { API_URL } from "@shared/api";

export type LiveMessage = { channel: "reading" | "prediction" | "health" | "pong"; data: any };
export type LiveStatus = "connecting" | "live" | "reconnecting";

function wsUrl() {
  const base = API_URL || window.location.origin;
  return base.replace(/^http/, "ws") + "/api/field/ws";
}

/**
 * WebSocket subscription with exponential-backoff reconnect and a heartbeat.
 * `onMessage` is read through a ref so callers can pass an inline closure.
 */
export function useLive(onMessage: (m: LiveMessage) => void) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [rate, setRate] = useState(0);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const stamps = useRef<number[]>([]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let reconnectTimer: number | undefined;
    let ping: number | undefined;

    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        retry = 0;
        setStatus("live");
        ws?.send(JSON.stringify({ subscribe: ["reading", "prediction", "health"] }));
        ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 25_000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as LiveMessage;
        if (msg.channel === "pong") return;
        const now = Date.now();
        stamps.current.push(now);
        setLastAt(now);
        handler.current(msg);
      };
      ws.onclose = () => {
        window.clearInterval(ping);
        if (closed) return;
        setStatus("reconnecting");
        retry += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(15_000, 500 * 2 ** retry));
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    const rateTimer = window.setInterval(() => {
      const cutoff = Date.now() - 60_000;
      stamps.current = stamps.current.filter((t) => t > cutoff);
      setRate(stamps.current.length);
    }, 2000);

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(ping);
      window.clearInterval(rateTimer);
      ws?.close();
    };
  }, []);

  return { status, lastAt, rate };
}
