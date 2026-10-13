"use client";
import { useEffect, useRef, useState } from "react";

export interface StreamEvent { id: number; type: string; tokenId: string | null; payload: Record<string, unknown>; createdAt: number }

/**
 * Subscribes to /api/stream (SSE). EventSource reconnects on its own and
 * sends Last-Event-ID, so missed events are replayed; `onEvent` callers
 * should still refetch authoritative state after reconnect ("hello").
 */
export function useStream(opts: { tokenId?: string; onEvent?: (e: StreamEvent) => void; onReconnect?: () => void; enabled?: boolean } = {}) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const cb = useRef(opts);
  cb.current = opts;
  useEffect(() => {
    if (opts.enabled === false) return;
    const url = `/api/stream${opts.tokenId ? `?tokenId=${encodeURIComponent(opts.tokenId)}` : ""}`;
    const es = new EventSource(url);
    let first = true;
    es.addEventListener("hello", () => {
      setConnected(true);
      if (!first) cb.current.onReconnect?.();
      first = false;
    });
    const types = ["token.launched", "trade", "fee.deposited", "destiny.eligible", "destiny.executing", "destiny.executed", "destiny.failed", "graduation", "reward.settled", "reward.claimed", "treasury.acquired", "wallet.funded"];
    const handler = (ev: MessageEvent) => {
      try {
        const e = JSON.parse(ev.data) as StreamEvent;
        setEvents((xs) => [e, ...xs].slice(0, 60));
        cb.current.onEvent?.(e);
      } catch { /* ignore */ }
    };
    for (const t of types) es.addEventListener(t, handler);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [opts.tokenId, opts.enabled]);
  return { events, connected };
}
