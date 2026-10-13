import Link from "next/link";
import { CharacterScene } from "./Scene";
import { fmtSol, pct, destinyWord, actionWord, countdown } from "@/lib/format";

export interface TokenListItem {
  id: string; name: string; ticker: string; destiny: "PHOENIX" | "GRAVITY" | "ECHO" | "ORBIT"; status: string; image: string | null;
  state: string; executions: string | bigint; vault: string | bigint; vol: string | bigint; holders: string | bigint;
  marketCap: string | bigint; graduationProgress: number; vaultProgress: number; execution_threshold: string | bigint;
  total_burned: string | bigint; total_liquidity_added: string | bigint; total_rewards_distributed: string | bigint; total_treasury_deployed: string | bigint;
  created_at: string | bigint; nextAt?: number | null;
}

const STATE: Record<string, string> = { IDLE: "Idle", ACCUMULATING: "Accumulating", ELIGIBLE: "Eligible", EXECUTING: "Executing", COMPLETED: "Accumulating", FAILED: "Retrying" };

/** Coin card. The border takes the destiny color once the vault is accumulating; `featured` adds the character loop. */
export function TokenCard({ t, featured = false }: { t: TokenListItem; featured?: boolean }) {
  const accumulating = t.vaultProgress > 0 || t.state !== "IDLE";
  const away = BigInt(String(t.execution_threshold)) - BigInt(String(t.vault));
  return (
    <Link href={`/coin/${t.id}`} data-destiny={t.destiny} data-testid="token-card"
      className={`card card-hover group block overflow-hidden ${accumulating ? "card-accent" : ""} ${featured ? "md:grid md:grid-cols-[18rem_1fr]" : ""}`}>
      {featured && (
        <div className="relative p-3 pb-0 md:pb-3"><div className="glow" /><div className="media"><CharacterScene name={t.destiny.toLowerCase()} className="!rounded-[18px]" /></div></div>
      )}
      <div className="p-5 sm:p-6 flex flex-col">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 shrink-0 rounded-full overflow-hidden bg-surface flex items-center justify-center text-sm font-semibold" style={{ color: "var(--accent)" }}>
            {t.image ? <img src={t.image} alt="" className="h-full w-full object-cover" /> : t.ticker.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2"><span className={`display-md truncate ${featured ? "text-[26px]" : "text-[19px]"}`}>{t.name}</span><span className="text-sm text-dim">{t.ticker}</span></div>
            <div className="text-xs text-faint mt-0.5">{destinyWord[t.destiny]} · {STATE[t.state] ?? t.state} · {t.status === "AMM" ? "AMM" : `curve ${pct(t.graduationProgress)}`}</div>
          </div>
          <span className="chip ml-auto">{destinyWord[t.destiny]}</span>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3 text-sm num">
          <div><dt className="text-faint text-xs">Market cap</dt><dd className="mt-0.5">{fmtSol(t.marketCap, 1)} SOL</dd></div>
          <div><dt className="text-faint text-xs">Volume 24h</dt><dd className="mt-0.5">{fmtSol(t.vol, 1)} SOL</dd></div>
          <div><dt className="text-faint text-xs">Holders</dt><dd className="mt-0.5">{String(t.holders)}</dd></div>
        </dl>
        <div className="mt-5">
          <div className="flex justify-between text-xs"><span className="text-dim">Vault {fmtSol(t.vault, 2)} / {fmtSol(t.execution_threshold, 2)} SOL</span><span className="num" style={{ color: "var(--accent)" }}>{pct(t.vaultProgress)}</span></div>
          <div className="meter mt-1.5"><i style={{ width: pct(t.vaultProgress) }} /></div>
          <div className="mt-1.5 text-xs text-faint">Next {actionWord[t.destiny]}: {t.vaultProgress >= 1 ? (t.nextAt ? countdown(t.nextAt) : "eligible now") : `${fmtSol(away, 2)} SOL away`}</div>
        </div>
      </div>
    </Link>
  );
}
