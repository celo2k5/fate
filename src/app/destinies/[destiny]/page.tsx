import Link from "next/link";
import { notFound } from "next/navigation";
import { getProtocol } from "@/engine/keeper";
import { serialize } from "@/engine/units";
import { DESTINY_META, PROTOCOL, type DestinyType } from "@/engine/config";
import { Scene, CharacterScene } from "@/components/Scene";
import { TokenCard, type TokenListItem } from "@/components/TokenCard";
import { LiveActivity } from "@/components/LiveActivity";
import { fmtSol, fmtTok } from "@/lib/format";

export const dynamic = "force-dynamic";

const DETAILS: Record<DestinyType, { steps: string[]; safety: string[]; shows: string[] }> = {
  PHOENIX: {
    steps: ["Fees accumulate in the Phoenix vault.", "When the vault reaches the execution threshold and the cooldown has passed, the coin is eligible.", "The crank buys on the active venue (curve or AMM), sized so price impact stays inside the slippage bound.", "Everything bought is burned. Supply, burn total and the execution are recorded."],
    safety: ["Buybacks use only vault funds.", "No creator withdrawals, no minting.", "Slippage-bounded; oversized buys are reduced, never forced.", "Buybacks do not guarantee price."],
    shows: ["Vault balance", "Total tokens burned", "Last buyback", "Next execution threshold", "Execution history"],
  },
  GRAVITY: {
    steps: ["Fees accumulate in the Gravity vault.", "At the threshold, half the vault buys tokens inside the slippage bound.", "Those tokens are paired with the other half as a locked liquidity position.", "Before graduation the position sits in escrow and migrates with the pool; after, it is added to the AMM directly. LP never leaves protocol custody."],
    safety: ["Uses actual vault balances only.", "LP is non-withdrawable by design: there is no instruction to remove it.", "Positions are tracked individually.", "'Locked' is enforced by the absence of a withdrawal path, not by a promise."],
    shows: ["Liquidity vault", "Total liquidity added", "Current locked position", "Next contribution threshold", "Execution history"],
  },
  ECHO: {
    steps: ["Fees accumulate in the Echo vault across an epoch.", "When the epoch ends and the vault holds at least the threshold, the crank snapshots eligible holders on the ledger.", "Eligible: user wallets at or above the minimum balance that did not sell during the epoch. Vaults, curve, pool and escrow accounts are excluded.", "Rewards are allocated pro-rata and moved to a rewards escrow. Each wallet claims once per epoch."],
    safety: ["Eligibility is computed server-side from the ledger, never from the frontend.", "Double claims are rejected by a unique (epoch, wallet) constraint.", "Total claims can never exceed what an epoch funded.", "Selling inside an epoch forfeits that epoch only."],
    shows: ["Reward vault", "Current epoch", "Eligible wallets", "Claimable rewards", "Next distribution", "Reward history"],
  },
  ORBIT: {
    steps: ["Fees accumulate in the Orbit vault.", "At the threshold, the vault is split by the coin's fixed allocation.", "SOL and the retained reserve move to the treasury; USDC and the LST are acquired through an approved venue inside the slippage bound.", "Every acquisition is recorded and the treasury is revalued at the oracle price."],
    safety: ["Approved assets only: SOL, USDC, LST, reserve.", "No leverage, no arbitrary strategies.", "Price and slippage constraints on every swap.", "A treasury is not a promise of profit."],
    shows: ["Treasury value", "Asset allocation", "Available reserves", "Recent acquisitions", "Execution history"],
  },
};

export default async function DestinyPage({ params }: { params: Promise<{ destiny: string }> }) {
  const { destiny } = await params;
  const d = destiny.toUpperCase() as DestinyType;
  if (!DESTINY_META[d]) notFound();
  const m = DESTINY_META[d];
  const det = DETAILS[d];
  const p = getProtocol();
  const coins = serialize(p.list({ destiny: d, sort: "trending", limit: 12 })) as unknown as TokenListItem[];
  const agg = p.db.prepare("SELECT COUNT(*) n, COALESCE(SUM(executions),0) e, COALESCE(SUM(total_burned),0) b, COALESCE(SUM(total_liquidity_added),0) l, COALESCE(SUM(total_rewards_distributed),0) r, COALESCE(SUM(total_treasury_deployed),0) t FROM destiny_states s JOIN tokens k ON k.id=s.token_id WHERE k.destiny=?").get(d) as Record<string, bigint>;
  const activity = p.activity(40).filter((e) => (e.payload as { destiny?: string }).destiny === d).slice(0, 20);
  const metric = d === "PHOENIX" ? ["Burned", fmtTok(agg.b)] : d === "GRAVITY" ? ["Liquidity locked", `${fmtSol(agg.l, 2)} SOL`] : d === "ECHO" ? ["Rewards paid", `${fmtSol(agg.r, 2)} SOL`] : ["Treasury deployed", `${fmtSol(agg.t, 2)} SOL`];

  return (
    <div data-destiny={d}>
      <section className="relative min-h-[70vh] overflow-hidden rounded-b-[32px]">
        <Scene name="garden" overlay="bg-obsidian/35" />
        <div className="relative mx-auto max-w-[1320px] px-5 sm:px-8 pt-28 pb-16 grid gap-10 md:grid-cols-[1fr_380px] items-center">
          <div>
            <h1 className="display text-[56px] sm:text-[80px]" style={{ color: "var(--accent)" }}>{m.title}</h1>
            <p className="lede">{m.tagline}</p>
            <p className="lede mt-6 max-w-xl">{m.purpose}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/launch?destiny=${d}`} className="btn btn-accent">Launch a {m.title} coin</Link>
              <Link href={`/coins?destiny=${d}`} className="btn card-sm border-0">See {m.title} coins</Link>
            </div>
          </div>
          <div className="card p-4 w-full max-w-[380px] mx-auto md:mx-0"><CharacterScene name={destiny.toLowerCase()} /></div>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-5 sm:px-8 py-12 grid grid-cols-2 sm:grid-cols-4 gap-5 small">
        {[["Coins", String(agg.n)], ["Executions", String(agg.e)], metric, ["Fee to vault", `${PROTOCOL.destinyShareBps / 100}% of ${PROTOCOL.tradeFeeBps / 100}%`]].map(([k, v]) => (
          <div key={k} className="card px-5 py-4 reveal"><div className="text-ivory-3">{k}</div><div className="display text-[26px] mt-1 num" style={{ color: "var(--accent)" }}>{v}</div></div>
        ))}
      </section>

      <section className="mx-auto max-w-[1320px] px-5 sm:px-8 pb-16 grid gap-5 lg:grid-cols-3">
        <div className="card px-5 py-4 reveal">
          <p className="display text-[22px]" style={{ color: "var(--accent)" }}>How it executes</p>
          <ol className="mt-3 space-y-3 small">{det.steps.map((s, i) => <li key={i} className="flex gap-3"><span className="text-ivory-3 num">{i + 1}</span><span>{s}</span></li>)}</ol>
        </div>
        <div className="card px-5 py-4 reveal" style={{ transitionDelay: "90ms" }}>
          <p className="display text-[22px]" style={{ color: "var(--accent)" }}>Rules the program enforces</p>
          <ul className="mt-3 space-y-3 small">{det.safety.map((s) => <li key={s} className="flex gap-3"><i className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />{s}</li>)}</ul>
        </div>
        <div className="card px-5 py-4 reveal" style={{ transitionDelay: "180ms" }}>
          <p className="display text-[22px]" style={{ color: "var(--accent)" }}>What a {m.title} coin shows</p>
          <ul className="mt-3 space-y-2 small text-ivory-2">{det.shows.map((s) => <li key={s}>{s}</li>)}</ul>
          <p className="mt-4 small text-ivory-2">Risks: {m.risks}</p>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-5 sm:px-8 pb-24 grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div>
          <h2 className="display text-[36px] sm:text-[48px] mb-6 reveal">{m.title} <span className="display-light">coins</span></h2>
          {coins.length === 0 ? <p className="card p-8 small text-ivory-2">No {m.title} coins yet. <Link className="link" href={`/launch?destiny=${d}`}>Launch the first.</Link></p>
            : <div className="grid gap-5 sm:grid-cols-2">{coins.map((t) => <TokenCard key={t.id} t={t} />)}</div>}
        </div>
        <LiveActivity initial={activity} />
      </section>
    </div>
  );
}
