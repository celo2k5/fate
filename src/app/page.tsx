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

  const story: { title: string; body: string; destiny?: string }[] = [
    { title: "The coin", body: "Name it, set the ticker, pick one destiny, sign once. Supply is fixed at one billion. The curve trades against SOL. Liquidity migrates and locks at graduation." },
    { title: "The vault", body: "Trading fees never pay the creator. 80% of every fee fills this coin's own vault. Only its destiny is allowed to spend it. No volume, no vault, nothing moves." },
    { title: "The crank", body: "Anyone can run it. The protocol re-checks the vault, the threshold, the cooldown and the slippage bound itself, then executes. Every execution gets a sequence number that can never repeat." },
    { title: "Graduation", body: "At the graduation threshold the curve closes, liquidity moves to an AMM at the same price, LP is locked, and the destiny keeps executing on the pool." },
  ];

  return (
    <>
      {/* HOME — full-screen loop, poster headline, sticker, stats strip, ticker */}
      <section id="home" className="relative min-h-[100svh] overflow-hidden rounded-b-[32px]">
        <div className="absolute inset-0" data-parallax="0.2"><Scene name="hero" overlay="" /></div>
        <div className="absolute inset-0 bg-gradient-to-b from-obsidian/55 via-transparent to-obsidian/85" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 min-h-[100svh] flex flex-col pt-32 sm:pt-40 pb-8">
          <div className="max-w-5xl">
            <h1 className="display text-[clamp(3.2rem,9vw,8rem)] text-ivory">
              <span className="rise block">Every coin</span>
              <span className="rise rise-1 block sm:whitespace-nowrap">has a destiny <span className="sticker sticker-in text-[clamp(2rem,4.4vw,4rem)] ml-1 align-top">chosen once</span></span>
            </h1>
            <p className="lede max-w-md mt-6 rise rise-2">Launch a token with an autonomous economy. Trading fees fuel its destiny. The rules are chosen at launch and executed by the protocol, never by the creator.</p>
            <div className="mt-8 flex flex-wrap gap-3 rise rise-3">
              <Link href="/launch" className="btn btn-primary" data-testid="cta-launch">Choose your fate</Link>
              <Link href="/coins" className="btn">Explore coins</Link>
            </div>
          </div>
          <div className="mt-auto pt-16 grid gap-3 rise rise-4">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {[
                ["Coins", <CountUp key="a" value={stats.tokens} />], ["Executions", <CountUp key="b" value={stats.executions} />],
                ["Fees routed", <CountUp key="c" value={solNum(stats.feesRouted)} decimals={2} suffix=" SOL" />], ["Burned", <CountUp key="d" value={Number(stats.burned) / 1e12} decimals={2} suffix="M" />],
                ["Liquidity locked", <CountUp key="e" value={solNum(stats.liquidity)} decimals={2} suffix=" SOL" />], ["Rewards paid", <CountUp key="f" value={solNum(stats.rewards)} decimals={2} suffix=" SOL" />],
              ].map(([k, v]) => (
                <div key={String(k)} className="glass rounded-[20px] px-4 py-3"><div className="eyebrow">{k}</div><div className="display text-[26px] text-mint mt-0.5">{v}</div></div>
              ))}
            </div>
            <LiveTicker initial={activity} />
          </div>
        </div>
      </section>

      {/* ABOUT — the vault spends it */}
      <section id="about" className="relative min-h-screen">
        <Scene name="garden" overlay="bg-obsidian/50" />
        <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 py-24 sm:py-32">
          <div className="mb-12 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-8">
            <h2 className="display text-[clamp(2.8rem,7vw,5.5rem)] relative reveal">
              The vault<br />spends it <span className="sticker text-[clamp(1.8rem,3.6vw,3.2rem)] -ml-2 align-middle">not you</span>
            </h2>
            <p className="lede sm:text-right max-w-xs reveal">A launchpad on Solana. One destiny is sewn into the coin at launch. It never comes off.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {story.map((s, i) => (
              <article key={s.title} className="card h-full px-6 py-5 reveal" style={{ transitionDelay: `${(i % 2) * 90}ms` }}>
                <p className="voice text-[30px]">{s.title}</p>
                <p className="copy mt-2">{s.body}</p>
              </article>
            ))}
          </div>
          <p className="eyebrow mt-6 reveal">{preview ? `${settings.network} preview` : "Running on simnet"} · fees 1% · 80% to the vault · nothing withdrawable</p>
        </div>
      </section>

      {/* CREW — the four destinies */}
      <section id="crew" className="bg-obsidian py-20 sm:py-28">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
            <h2 className="display text-[clamp(2.8rem,7vw,5.5rem)] reveal">
              Four destinies<br /><span className="sticker text-[clamp(2rem,4.4vw,4rem)] ml-8 sm:ml-16">pick one</span> forever
            </h2>
            <Link href="/coins" className="group inline-flex w-fit flex-col reveal">
              <span className="display text-[40px] sm:text-[56px] leading-none">See all coins</span>
              <span className="neon-rule mt-2 w-full" />
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {DESTINIES.map((d, i) => (
              <article key={d} data-destiny={d} className="glass group rounded-[28px] p-[14px] reveal-scale" style={{ transitionDelay: `${i * 90}ms` }}>
                <div className="relative"><div className="glow" /><div className="media"><CharacterScene name={d.toLowerCase()} className="!rounded-[18px]" /></div></div>
                <div className="glass mt-[14px] flex items-center justify-between gap-3 rounded-[20px] px-5 py-4">
                  <div className="min-w-0">
                    <p className="display text-[24px]" style={{ color: "var(--accent)" }}>{DESTINY_META[d].title}</p>
                    <p className="copy text-ivory/70 mt-0.5 truncate">{DESTINY_META[d].purpose.split(".")[0]}</p>
                  </div>
                  <Link href={`/destinies/${d.toLowerCase()}`} aria-label={`Open ${DESTINY_META[d].title}`} className="arrow"><Arrow /></Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* BOARD */}
      <section id="board" className="bg-obsidian pb-20 sm:pb-28">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 grid gap-8 lg:grid-cols-[1fr_24rem]">
          <div>
            <div className="flex items-end justify-between mb-8 reveal">
              <h2 className="display text-[clamp(2.4rem,5vw,4rem)]">On the board <span className="sticker text-[clamp(1.6rem,3vw,2.6rem)]">live</span></h2>
              <Link href="/coins?tab=trending" className="btn btn-sm btn-ghost">Trending</Link>
            </div>
            {trending.length === 0 ? (
              <div className="card p-12 text-center reveal">
                <p className="voice text-[40px]">No coins yet</p>
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

      {/* CLOSING */}
      <section id="closing" className="relative overflow-hidden min-h-[560px]">
        <Scene name="observatory" overlay="bg-gradient-to-r from-obsidian/30 via-transparent to-obsidian/60" />
        <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 py-28 sm:py-36 flex justify-end">
          <div className="text-right">
            <span className="sticker text-[clamp(2.4rem,5vw,4.5rem)] mr-10 sm:mr-24 reveal">Fate</span>
            <p className="display text-[clamp(2.8rem,7vw,5.5rem)] reveal" style={{ transitionDelay: "90ms" }}>Choose your fate.<br />Fill the vault.<br />Live with it.</p>
            <div className="mt-8 reveal" style={{ transitionDelay: "180ms" }}><Link href="/launch" className="btn btn-primary">Launch a coin</Link></div>
          </div>
        </div>
      </section>
    </>
  );
}
