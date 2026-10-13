import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getProtocol } from "@/engine/keeper";
import { serialize } from "@/engine/units";
import { TokenView } from "@/components/TokenView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = getProtocol().getToken(id);
  return { title: t ? `${t.name} (${t.ticker}) — ${t.destiny}` : "Coin" };
}

export default async function CoinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getProtocol();
  const d = p.detail(id);
  if (!d) notFound();
  const activity = p.activity(60).filter((e) => e.tokenId === id).slice(0, 12);
  return <TokenView initial={serialize(d)} initialActivity={activity} />;
}
