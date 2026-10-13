import Link from "next/link";
import { getProtocol } from "@/engine/keeper";
import { serialize } from "@/engine/units";
import { TokenCard, type TokenListItem } from "@/components/TokenCard";
import type { DestinyType } from "@/engine/config";

export const dynamic = "force-dynamic";
const TABS = [["new", "New"], ["trending", "Trending"], ["PHOENIX", "Phoenix"], ["GRAVITY", "Gravity"], ["ECHO", "Echo"], ["ORBIT", "Orbit"], ["graduated", "Graduated"]];
const DEST = ["PHOENIX", "GRAVITY", "ECHO", "ORBIT"];

export default async function Coins({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; destiny?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? (sp.destiny ? sp.destiny : "new");
  const q = sp.q?.trim() || undefined;
  const p = getProtocol();
  const list = serialize(p.list({ destiny: DEST.includes(tab) ? (tab as DestinyType) : undefined, graduated: tab === "graduated", sort: tab === "trending" ? "trending" : "new", q, limit: 80 })) as unknown as TokenListItem[];
  return (
    <div className="mx-auto max-w-[1320px] px-5 sm:px-8 pt-28 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="display text-[40px] sm:text-[56px]">All <span className="display-light">coins</span></h1>
        <form className="flex gap-2 w-full sm:w-auto" action="/coins">
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q ?? ""} placeholder="Search name, ticker or mint" className="field min-w-0 flex-1 sm:flex-none sm:!w-72" aria-label="Search coins" />
          <button className="btn shrink-0">Search</button>
        </form>
      </div>
      <nav className="mt-8 card-sm px-4 py-3 flex flex-wrap gap-1" aria-label="Filters">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/coins?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} data-destiny={DEST.includes(k) ? k : undefined}
            className={`text-[14px] font-medium px-4 py-2 rounded-[12px] transition-colors ${tab === k ? "bg-ivory text-obsidian" : "text-ivory hover:gold"}`}>{label}</Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <div className="card p-12 mt-8 text-center">
          <p className="display text-[26px]">{q ? `Nothing matches “${q}”` : "Nothing here yet"}</p>
          <Link href="/launch" className="btn btn-gold mt-5">Launch one</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{list.map((t) => <TokenCard key={t.id} t={t} />)}</div>
      )}
    </div>
  );
}
