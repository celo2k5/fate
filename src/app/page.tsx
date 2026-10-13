import Link from "next/link";
import { getProtocol } from "@/engine/keeper";
import { serialize } from "@/engine/units";
import { Scene, CharacterScene } from "@/components/Scene";
import { LiveActivity } from "@/components/LiveActivity";
import { LiveTicker } from "@/components/LiveTicker";
import { CountUp } from "@/components/CountUp";
import { TokenCard, type TokenListItem } from "@/components/TokenCard";
import { DESTINIES, DESTINY_META } from "@/engine/config";
import { getSettings } from "@/lib/settings";
import { getPreview } from "@/lib/preview";

export const dynamic = "force-dynamic";

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export default async function Home() {
  const p = getProtocol();
  const stats = p.stats();
  const preview = await getPreview();
  const settings = getSettings();
  const trending = serialize(p.list({ sort: "trending", limit: 5 })) as unknown as TokenListItem[];
  const [featured, ...rest] = trending;
  const activity = p.activity(24, ["destiny.executed", "graduation", "token.launched", "reward.claimed", "destiny.failed"]);
  const solNum = (v: bigint) => Number(v) / 1e9;

  const steps = [
    ["Create", "Name the coin, pick one destiny, sign once. The destiny and its bounded parameters are written into the launch state."],
    ["Trade", "Buys and sells run on a bonding curve the protocol owns. Every trade pays 1%; 80% of it enters the coin's own vault."],
    ["Accumulate", "Nothing leaves the vault except through the destiny's instruction. At the threshold the coin becomes eligible."],
    ["Execute", "A permissionless crank runs the action: buyback and burn, lock liquidity, settle rewards, or diversify the treasury."],
    ["Graduate", "At the graduation threshold liquidity migrates to an AMM, LP locks, and the destiny keeps executing on the pool."],
  ];

  return (
    <>
      {/* Hero — parallax scene, headline bottom-left, live ticker across the base */}
      <section className="relative min-h-[100svh] overflow-hidden">
        <div className="absolute inset-0" data-parallax="0.25"><Scene name="hero" overlay="" /></div>
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian via-obsidian/40 to-obsidian/30" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-obsidian to-transparent" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1360px] px-5 sm:px-8 min-h-[100svh] flex flex-col justify-end pb-10 pt-32">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-3xl">
              <p className="eyebrow rise">Solana launchpad · {preview ? `${settings.network} preview` : "simnet"}</p>
              <h1 className="display text-[clamp(2.8rem,6.4vw,5.2rem)] mt-4 rise rise-1">Every coin<br />has a destiny.</h1>
              <p className="voice text-[clamp(1.6rem,3.4vw,2.6rem)] mt-3 rise rise-2">Chosen once. Enforced forever.</p>
              <p className="lede mt-6 max-w-xl rise rise-3">Launch a token with an autonomous economic system. Trading fees fuel its destiny; the rules are chosen at launch and executed by the protocol, never by the creator.</p>
              <div className="mt-8 flex flex-wrap gap-3 rise rise-4">
                <Link href="/launch" className="btn btn-primary" data-testid="cta-launch">Choose your fate</Link>
                <Link href="/coins" className="btn">Explore coins</Link>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-x-8 gap-y-2 rise rise-4 lg:text-right">
              <dt className="label order-1">Fees routed</dt><dt className="label order-2">Executions</dt><dt className="label order-3">Coins</dt>
              <dd className="order-4 display-md text-[26px]"><CountUp value={solNum(stats.feesRouted)} decimals={2} suffix=" SOL" /></dd>
              <dd className="order-5 display-md text-[26px]"><CountUp value={stats.executions} /></dd>
              <dd className="order-6 display-md text-[26px]"><CountUp value={stats.tokens} /></dd>
            </dl>
          </div>
          <div className="mt-10 rise rise-4"><LiveTicker initial={activity} /></div>
        </div>
      </section>

      {/* Lifecycle — scroll-driven timeline */}
      <section className="mx-auto max-w-[1360px] px-5 sm:px-8 py-24 sm:py-32" data-timeline>
        <div className="grid gap-10 lg:grid-cols-[18rem_1fr]">
          <div className="reveal">
            <p className="eyebrow">How a coin lives</p>
            <h2 className="display text-[40px] sm:text-[52px] mt-3">One loop.<br />Run forever.</h2>
            <p className="text-dim mt-4">The creator never holds the fees, cannot redirect them, and cannot change their purpose.</p>
          </div>
          <ol className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <div className="absolute left-0 right-0 top-[22px] hidden lg:block h-px bg-line" aria-hidden="true"><div className="timeline-fill h-px bg-gold w-full" /></div>
            {steps.map(([t, d], i) => (
              <li key={t} className="reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                <div className="h-11 w-11 rounded-full card flex items-center justify-center text-sm num text-gold relative z-10">{i + 1}</div>
                <h3 className="display-md text-[20px] mt-4">{t}</h3>
                <p className="small text-dim mt-2">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Destinies — alternating media rows */}
      <section className="mx-auto max-w-[1360px] px-5 sm:px-8 pb-10">
        <div className="max-w-2xl reveal">
          <p className="eyebrow">The four destinies</p>
          <h2 className="display text-[40px] sm:text-[52px] mt-3">What the fees become.</h2>
        </div>
        <div className="mt-12 grid gap-6">
          {DESTINIES.map((d, i) => {
            const m = DESTINY_META[d];
            const flip = i % 2 === 1;
            return (
              <article key={d} data-destiny={d} className="card card-hover group grid gap-0 md:grid-cols-2 overflow-hidden reveal-scale">
                <div className={`relative p-3 ${flip ? "md:order-2" : ""}`}>
                  <div className="glow" />
                  <div className="media"><CharacterScene name={d.toLowerCase()} className="!rounded-[18px]" /></div>
                </div>
                <div className="p-7 sm:p-10 flex flex-col">
                  <div className="flex items-center gap-3">
                    <span className="chip">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="display text-[36px] sm:text-[44px]" style={{ color: "var(--accent)" }}>{m.title}</h3>
                  </div>
                  <p className="voice text-[26px] mt-1">{m.tagline}</p>
                  <p className="text-dim mt-5 max-w-md">{m.purpose}</p>
                  <dl className="mt-6 grid gap-3 text-sm">
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3"><dt className="text-faint">Fee mechanism</dt><dd>{m.mechanism}</dd></div>
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3"><dt className="text-faint">Executes when</dt><dd>{m.conditions}</dd></div>
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3"><dt className="text-faint">Risk</dt><dd>{m.risks}</dd></div>
                  </dl>
                  <div className="mt-auto pt-8 flex items-center gap-3">
                    <Link href={`/launch?destiny=${d}`} className="btn btn-primary">Launch as {m.title}</Link>
                    <Link href={`/destinies/${d.toLowerCase()}`} className="btn btn-ghost" aria-label={`How ${m.title} works`}>How it works <span className="arrow !h-8 !w-8"><Arrow /></span></Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Board — featured + grid + activity */}
      <section className="mx-auto max-w-[1360px] px-5 sm:px-8 py-24">
        <div className="flex items-end justify-between gap-6 reveal">
          <div><p className="eyebrow">On the board</p><h2 className="display text-[40px] sm:text-[52px] mt-3">Live coins.</h2></div>
          <Link href="/coins?tab=trending" className="btn btn-ghost">All coins <span className="arrow !h-8 !w-8"><Arrow /></span></Link>
        </div>
        {!featured ? (
          <div className="card p-12 mt-10 text-center reveal">
            <p className="voice text-[32px]">No coins yet.</p>
            <p className="text-dim mt-2">Be the first to choose a fate.</p>
            <Link href="/launch" className="btn btn-primary mt-6">Launch a coin</Link>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_22rem]">
            <div className="grid gap-6">
              <div className="reveal-scale"><TokenCard t={featured} featured /></div>
              <div className="grid gap-5 sm:grid-cols-2">{rest.map((t, i) => <div key={t.id} className="reveal" style={{ transitionDelay: `${(i % 2) * 90}ms` }}><TokenCard t={t} /></div>)}</div>
            </div>
            <div className="reveal"><LiveActivity initial={activity} /></div>
          </div>
        )}
      </section>

      {/* Closing */}
      <section className="relative overflow-hidden">
        <Scene name="observatory" overlay="bg-gradient-to-b from-obsidian via-obsidian/50 to-obsidian" />
        <div className="relative mx-auto max-w-[1360px] px-5 sm:px-8 py-32 sm:py-44 text-center">
          <p className="voice text-[clamp(1.6rem,3.4vw,2.4rem)] reveal">Choose your destiny.</p>
          <h2 className="display text-[clamp(3rem,8vw,6.5rem)] mt-2 reveal" style={{ transitionDelay: "90ms" }}>Live with it.</h2>
          <p className="text-dim mt-6 max-w-xl mx-auto reveal" style={{ transitionDelay: "180ms" }}>A coin on Fate has an economic identity from the moment it exists. The protocol executes the same rules for every coin that chose them.</p>
          <div className="mt-8 reveal" style={{ transitionDelay: "260ms" }}><Link href="/launch" className="btn btn-primary">Choose your fate</Link></div>
        </div>
      </section>
    </>
  );
}
