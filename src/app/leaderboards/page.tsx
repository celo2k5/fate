import Link from "next/link";
import { getProtocol } from "@/engine/keeper";
import { DESTINY_META } from "@/engine/config";
import { fmtSol, fmtTok } from "@/lib/format";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

function Board({ title, rows, metric }: { title: string; rows: Row[]; metric: (r: Row) => string }) {
  return (
    <div className="card px-5 py-4">
      <h3 className="display text-[22px]" style={{ color: "var(--accent)" }}>{title}</h3>
      {rows.length === 0 ? <p className="mt-3 small text-ivory-3">No verified data yet.</p> : (
        <ol className="mt-3 divide-y divide-line">
          {rows.map((r, i) => (
            <li key={String(r.id)} className="py-2.5 flex items-center gap-3 small">
              <span className="num text-ivory-3 w-5">{i + 1}</span>
              <Link href={`/coin/${r.id}`} className="link flex-1 truncate">{String(r.name)} <span className="text-ivory-3">{String(r.ticker)}</span></Link>
              <span className="num gold">{metric(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Leaderboards() {
  const lb = getProtocol().leaderboards();
  return (
    <div className="mx-auto max-w-[1320px] px-5 sm:px-8 pt-28 pb-16">
      <h1 className="display text-[40px] sm:text-[56px]">The <span className="display-light">board</span></h1>
      <p className="lede mt-3 max-w-xl">Ranked only by executions the protocol recorded. Nothing here is self-reported.</p>
      <div className="mt-12 grid gap-12">
        {([
          ["PHOENIX", [["Most tokens burned", lb.PHOENIX.mostBurned, (r: Row) => fmtTok(r.total_burned)], ["Most completed buybacks", lb.PHOENIX.mostBuybacks, (r: Row) => String(r.executions)]]],
          ["GRAVITY", [["Most liquidity added", lb.GRAVITY.mostLiquidity, (r: Row) => `${fmtSol(r.total_liquidity_added, 2)} SOL`], ["Largest locked position", lb.GRAVITY.largestPosition, (r: Row) => `${fmtSol(r.position, 2)} SOL`]]],
          ["ECHO", [["Most rewards distributed", lb.ECHO.mostRewards, (r: Row) => `${fmtSol(r.total_rewards_distributed, 2)} SOL`], ["Most eligible claimants", lb.ECHO.mostClaimants, (r: Row) => String(r.claimants)]]],
          ["ORBIT", [["Largest treasury", lb.ORBIT.largestTreasury, (r: Row) => `${fmtSol(r.total_treasury_deployed, 2)} SOL`], ["Most completed cycles", lb.ORBIT.mostCycles, (r: Row) => String(r.executions)]]],
        ] as const).map(([d, boards]) => (
          <section key={d} data-destiny={d}>
            <h2 className="display text-[36px] sm:text-[48px] mb-5" style={{ color: "var(--accent)" }}>{DESTINY_META[d].title}</h2>
            <div className="grid gap-5 md:grid-cols-2">{boards.map(([t, rows, m]) => <Board key={t} title={t} rows={rows as Row[]} metric={m} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
