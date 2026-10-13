import Link from "next/link";
import { getProtocol } from "@/engine/keeper";
import { serialize } from "@/engine/units";
import { Scene, CharacterScene } from "@/components/Scene";
import { LiveActivity } from "@/components/LiveActivity";
import { LiveTicker } from "@/components/LiveTicker";
import { CountUp } from "@/components/CountUp";
import { TokenCard, type TokenListItem } from "@/components/TokenCard";
import { Mark } from "@/components/Logo";
import { DESTINIES, DESTINY_META } from "@/engine/config";
import { getSettings } from "@/lib/settings";
import { getPreview } from "@/lib/preview";

export const dynamic = "force-dynamic";

const Arrow = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export default async function Home() {
  const p = getProtocol();
  const stats = p.stats();
  const preview = await getPreview();
  const settings = getSettings();
  const trending = serialize(p.list({ sort: "trending", limit: 6 })) as unknown as TokenListItem[];
  const activity = p.activity(24, ["destiny.executed", "graduation", "token.launched", "reward.claimed", "destiny.failed"]);
  const solNum = (v: bigint) => Number(v) / 1e9;

  return (
    <>
      {/* HOME — centered poster over the loop, stats + ticker along the base */}
      <section id="home" className="relative min-h-[100svh] overflow-hidden rounded-b-[36px]">
        <div className="absolute inset-0" data-parallax="0.2"><Scene name="hero" overlay="" /></div>
        <div className="absolute inset-0 bg-gradient-to-b from-obsidian/70 via-obsidian/20 to-obsidian/90" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 min-h-[100svh] flex flex-col pt-32 sm:pt-36 pb-8">
          <div className="mx-auto max-w-5xl text-center">
            <p className="eyebrow rise">Solana launchpad · {preview ? `${settings.network} preview` : "simnet"}</p>
            <h1 className="display text-[clamp(2.4rem,6.4vw,5.6rem)] text-ivory mt-4">
              <span className="rise block">Every coin</span>
              <span className="rise rise-1 block">has a destiny</span>
            </h1>
            <div className="mt-5 rise rise-2"><span className="sticker sticker-in text-[clamp(1.4rem,2.8vw,2.4rem)]">chosen once · enforced forever</span></div>
            <p className="lede max-w-xl mx-auto mt-6 rise rise-3">Launch a token with an autonomous economy. Trading fees fuel its destiny. The rules are chosen at launch and executed by the protocol, never by the creator.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 rise rise-4">
              <Link href="/launch" className="btn btn-primary" data-testid="cta-launch">Choose your fate</Link>
              <Link href="/coins" className="btn">Explore coins</Link>
            </div>
          </div>
          <div className="mt-auto pt-20 grid gap-3 rise rise-4">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {[
                ["Coins", <CountUp key="a" value={stats.tokens} />], ["Executions", <CountUp key="b" value={stats.executions} />],
                ["Fees routed", <CountUp key="c" value={solNum(stats.feesRouted)} decimals={2} suffix=" SOL" />], ["Burned", <CountUp key="d" value={Number(stats.burned) / 1e12} decimals={2} suffix="M" />],
                ["Liquidity locked", <CountUp key="e" value={solNum(stats.liquidity)} decimals={2} suffix=" SOL" />], ["Rewards paid", <CountUp key="f" value={solNum(stats.rewards)} decimals={2} suffix=" SOL" />],
              ].map(([k, v]) => (
                <div key={String(k)} className="glass rounded-[20px] px-4 py-3"><div className="eyebrow">{k}</div><div className="display text-[20px] sm:text-[22px] text-mint mt-1">{v}</div></div>
              ))}
            </div>
            <LiveTicker initial={activity} />
          </div>
        </div>
      </section>

      {/* ABOUT — the vault spends it. Three cards, the vault card carries the coin render. */}
      <section id="about" className="relative">
        <Scene name="garden" overlay="bg-obsidian/55" />
        <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 py-24 sm:py-32">
          <div className="mb-12 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <h2 className="display text-[clamp(2.2rem,5.4vw,4.4rem)] reveal">The vault spends it. <span className="sticker text-[clamp(1.3rem,2.6vw,2.2rem)] align-middle">not you</span></h2>
            <p className="lede max-w-sm reveal">One destiny is sewn into the coin at launch. It never comes off, and the creator never touches the fees.</p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <article className="card px-6 py-6 reveal">
              <p className="voice text-[32px]">The coin</p>
              <p className="copy mt-3">Name it, set the ticker, pick one destiny, sign once. Supply is fixed at one billion. The curve trades against SOL. Liquidity migrates and locks at graduation.</p>
            </article>
            <article className="card card-accent px-6 py-6 reveal lg:row-span-2 flex flex-col" style={{ transitionDelay: "90ms" }}>
              <div className="media"><img src="/brand/coin.jpg" alt="The Fate coin: an obsidian coin engraved with the astrolabe sigil" className="w-full aspect-square object-cover" /></div>
              <p className="voice text-[32px] mt-5">The vault</p>
              <p className="copy mt-3">Trading fees never pay the creator. 80% of every fee fills this coin&apos;s own vault. Only its destiny is allowed to spend it. No volume, no vault, nothing moves.</p>
              <dl className="mt-auto pt-6 grid grid-cols-3 gap-3 mono num">
                <div><dt className="eyebrow">Fee</dt><dd className="text-mint mt-1">1.00%</dd></div>
                <div><dt className="eyebrow">To vault</dt><dd className="text-mint mt-1">80%</dd></div>
                <div><dt className="eyebrow">Withdrawable</dt><dd className="text-mint mt-1">0</dd></div>
              </dl>
            </article>
            <article className="card px-6 py-6 reveal" style={{ transitionDelay: "180ms" }}>
              <p className="voice text-[32px]">The crank</p>
              <p className="copy mt-3">Anyone can run it. The protocol re-checks the vault, the threshold, the cooldown and the slippage bound itself, then executes. Every execution gets a sequence number that can never repeat.</p>
            </article>
            <article className="card px-6 py-6 reveal" style={{ transitionDelay: "120ms" }}>
              <p className="voice text-[32px]">Graduation</p>
              <p className="copy mt-3">At the graduation threshold the curve closes, liquidity moves to an AMM at the same price, LP is locked, and the destiny keeps executing on the pool.</p>
            </article>
            <article className="card px-6 py-6 reveal" style={{ transitionDelay: "210ms" }}>
              <p className="voice text-[32px]">The ledger</p>
              <p className="copy mt-3">Every fee, execution, claim and graduation is a recorded event. The board, the leaderboards and the ticker only show what the protocol verified.</p>
            </article>
          </div>
        </div>
      </section>

      {/* CREW — a horizontal deck of the four destinies */}
      <section id="crew" className="bg-obsidian py-20 sm:py-28 overflow-hidden">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
            <h2 className="display text-[clamp(2.2rem,5.4vw,4.4rem)] reveal">Four destinies. <span className="sticker text-[clamp(1.3rem,2.6vw,2.2rem)] align-middle">pick one, forever</span></h2>
            <Link href="/destinies" className="group inline-flex items-center gap-3 reveal"><span className="display text-[20px]">All four, in depth</span><span className="arrow"><Arrow /></span></Link>
          </div>
        </div>
        <div className="mt-12 flex gap-6 overflow-x-auto snap-x snap-mandatory px-5 sm:px-8 pb-6 [scrollbar-width:thin]" style={{ scrollPaddingLeft: "max(1.25rem, calc((100vw - 1440px) / 2 + 2rem))" }}>
          <div className="shrink-0 w-[max(0px,calc((100vw-1440px)/2))]" aria-hidden="true" />
          {DESTINIES.map((d, i) => {
            const m = DESTINY_META[d];
            return (
              <article key={d} data-destiny={d} className="glass group snap-start shrink-0 w-[88vw] sm:w-[560px] rounded-[28px] p-[14px] grid grid-cols-[42%_1fr] gap-4 reveal-scale" style={{ transitionDelay: `${i * 90}ms` }}>
                <div className="relative"><div className="glow" /><div className="media h-full"><CharacterScene name={d.toLowerCase()} className="!rounded-[18px] h-full !pb-0 min-h-[260px]" /></div></div>
                <div className="py-3 pr-3 flex flex-col">
                  <span className="chip">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="display text-[32px] mt-3" style={{ color: "var(--accent)" }}>{m.title}</h3>
                  <p className="voice text-[22px] mt-1">{m.tagline}</p>
                  <p className="copy mt-3">{m.purpose}</p>
                  <dl className="mt-4 grid gap-1.5 text-[13px]">
                    <div className="grid grid-cols-[6rem_1fr] gap-2"><dt className="text-faint">Executes</dt><dd className="text-ivory/85">{m.conditions}</dd></div>
                    <div className="grid grid-cols-[6rem_1fr] gap-2"><dt className="text-faint">Risk</dt><dd className="text-ivory/85">{m.risks.split(".")[0]}.</dd></div>
                  </dl>
                  <div className="mt-auto pt-5 flex items-center justify-between gap-3">
                    <Link href={`/launch?destiny=${d}`} className="btn btn-sm btn-accent" style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#0b0516" }}>Launch as {m.title}</Link>
                    <Link href={`/destinies/${d.toLowerCase()}`} aria-label={`Open ${m.title}`} className="arrow"><Arrow /></Link>
                  </div>
                </div>
              </article>
            );
          })}
          <div className="shrink-0 w-8" aria-hidden="true" />
        </div>
      </section>

      {/* BOARD */}
      <section id="board" className="bg-obsidian pb-20 sm:pb-28">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 grid gap-8 lg:grid-cols-[1fr_24rem]">
          <div>
            <div className="flex items-end justify-between mb-8 reveal">
              <h2 className="display text-[clamp(2rem,4.4vw,3.4rem)]">On the board <span className="sticker text-[clamp(1.2rem,2.2vw,1.8rem)] align-middle">live</span></h2>
              <Link href="/coins?tab=trending" className="btn btn-sm btn-ghost">Trending</Link>
            </div>
            {trending.length === 0 ? (
              <div className="card p-12 text-center reveal">
                <Mark size={64} className="mx-auto" />
                <p className="voice text-[36px] mt-4">No coins yet</p>
                <p className="copy mt-2 text-ivory/70">Be the first to choose a fate.</p>
                <Link href="/launch" className="btn btn-primary mt-6">Launch a coin</Link>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">{trending.map((t, i) => <div key={t.id} className="reveal" style={{ transitionDelay: `${(i % 2) * 90}ms` }}><TokenCard t={t} /></div>)}</div>
            )}
          </div>
          <div className="reveal"><LiveActivity initial={activity} /></div>
        </div>
      </section>

      {/* CLOSING — centered */}
      <section id="closing" className="relative overflow-hidden min-h-[560px]">
        <Scene name="observatory" overlay="bg-gradient-to-b from-obsidian/60 via-obsidian/30 to-obsidian" />
        <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 py-28 sm:py-36 text-center">
          <Mark size={72} className="mx-auto reveal" />
          <p className="display text-[clamp(2.2rem,5.4vw,4.4rem)] mt-6 reveal" style={{ transitionDelay: "90ms" }}>Choose your fate.<br />Fill the vault.<br />Live with it.</p>
          <div className="mt-8 reveal" style={{ transitionDelay: "180ms" }}><Link href="/launch" className="btn btn-primary">Launch a coin</Link></div>
        </div>
      </section>
    </>
  );
}
