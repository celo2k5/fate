"use client";
import { Ago } from "@/components/Ago";
import Link from "next/link";
import { useState } from "react";
import { useStream, type StreamEvent } from "@/lib/useStream";
import { fmtSol, fmtTok, destinyWord } from "@/lib/format";

/** Only verified, ledger-recorded events are shown: the feed is read from the events table. */
export function describe(e: StreamEvent): { text: string; destiny?: string } | null {
  const p = e.payload as Record<string, string>;
  const d = p.destiny;
  switch (e.type) {
    case "destiny.executed":
      if (d === "PHOENIX") return { text: `Phoenix burned ${fmtTok(p.tokensBurned)} ${p.ticker} in a ${fmtSol(p.amountUsed, 2)} SOL buyback`, destiny: d };
      if (d === "GRAVITY") return { text: `Gravity locked ${fmtSol(p.solLocked, 2)} SOL of ${p.ticker} liquidity`, destiny: d };
      if (d === "ECHO") return { text: `Echo settled epoch ${p.epoch} for ${p.ticker}: ${fmtSol(p.funded, 2)} SOL to ${p.eligibleWallets} wallets`, destiny: d };
      if (d === "ORBIT") return { text: `Orbit deployed ${fmtSol(p.amountUsed, 2)} SOL into ${p.ticker}'s treasury`, destiny: d };
      return null;
    case "destiny.failed": return { text: `${destinyWord[d]} execution for ${p.ticker} failed: ${p.error}`, destiny: d };
    case "graduation": return { text: `${p.ticker} graduated to the AMM with ${fmtSol(p.solMigrated, 1)} SOL locked`, destiny: d };
    case "token.launched": return { text: `${p.ticker} launched as ${destinyWord[d]}`, destiny: d };
    case "trade": return { text: `${p.isProtocol ? "Protocol" : "Trader"} ${p.side === "BUY" ? "bought" : "sold"} ${fmtTok(p.tokenAmount)} ${p.ticker} for ${fmtSol(p.solAmount, 3)} SOL`, destiny: d };
    case "reward.claimed": return { text: `${fmtSol(p.amount, 3)} SOL of ${p.ticker} rewards claimed`, destiny: d };
    default: return null;
  }
}

export function LiveActivity({ initial, tokenId, compact }: { initial: StreamEvent[]; tokenId?: string; compact?: boolean }) {
  const [live, setLive] = useState<StreamEvent[]>([]);
  const { connected } = useStream({ tokenId, onEvent: (e) => setLive((xs) => [e, ...xs].slice(0, 40)) });
  const all = [...live, ...initial.filter((i) => !live.some((l) => l.id === i.id))].slice(0, compact ? 8 : 30);
  const rows = all.map((e) => ({ e, d: describe(e) })).filter((x) => x.d);
  return (
    <div className="card px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="voice text-[28px]">Protocol activity</h3>
        <span className="small text-ivory-3 flex items-center gap-1.5 ml-3">
          <i className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-orbit" : "bg-ivory-3"}`} /> {connected ? "live" : "reconnecting"}
        </span>
      </div>
      {rows.length === 0 && <p className="small text-ivory-3 py-4">Nothing verified yet. Activity appears here as trades, executions and graduations are recorded.</p>}
      <ul className="divide-y divide-line">
        {rows.map(({ e, d }) => (
          <li key={e.id} className="py-2.5 flex items-start gap-3 copy normal-case" data-destiny={d!.destiny}>
            <i className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
            <span className="flex-1">{e.tokenId ? <Link className="link" href={`/coin/${e.tokenId}`}>{d!.text}</Link> : d!.text}</span>
            <span className="text-ivory-3 num whitespace-nowrap"><Ago t={e.createdAt} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
