"use client";
import { Ago } from "@/components/Ago";
import Link from "next/link";
import { useState } from "react";
import { useStream, type StreamEvent } from "@/lib/useStream";
import { describe } from "./LiveActivity";

/** Continuous marquee of ledger-verified events. Pauses on hover; keeps filling from the SSE stream. */
export function LiveTicker({ initial }: { initial: StreamEvent[] }) {
  const [live, setLive] = useState<StreamEvent[]>([]);
  useStream({ onEvent: (e) => setLive((xs) => [e, ...xs].slice(0, 20)) });
  const all = [...live, ...initial.filter((i) => !live.some((l) => l.id === i.id))].slice(0, 14);
  const rows = all.map((e) => ({ e, d: describe(e) })).filter((x) => x.d);
  if (rows.length === 0) return null;
  const items = [...rows, ...rows];
  return (
    <div className="glass rounded-full overflow-hidden" aria-label="Live protocol activity">
      <div className="marquee py-3">
        {items.map(({ e, d }, i) => (
          <Link key={`${e.id}-${i}`} href={e.tokenId ? `/coin/${e.tokenId}` : "/coins"} data-destiny={d!.destiny} className="flex items-center gap-3 px-6 text-sm whitespace-nowrap hover:text-mint transition-colors">
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            <span>{d!.text}</span>
            <span className="text-faint num"><Ago t={e.createdAt} /></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
