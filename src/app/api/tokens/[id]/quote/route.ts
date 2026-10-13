import { ok, fail, parseBig } from "@/lib/api";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const u = new URL(req.url);
    const side = u.searchParams.get("side") === "SELL" ? "SELL" : "BUY";
    const amount = parseBig(u.searchParams.get("amount"), "amount");
    const slippage = Number(u.searchParams.get("slippageBps") ?? 100);
    const p = getProtocol();
    const t = p.getToken(id);
    if (t?.chain && t.chain !== "SIMNET" && t.mint) {
      const { quote } = await import("@/chain/pump");
      const { PublicKey } = await import("@solana/web3.js");
      const q = await quote(new PublicKey(t.mint), side, amount, slippage);
      return ok({ amountIn: q.amountIn, amountOut: q.amountOut, minOut: q.minOut, priceImpactBps: q.priceImpactBps, fee: 0n, venue: q.venue, onChain: true });
    }
    return ok(p.quote(id, side, amount, slippage));
  } catch (e) { return fail(e); }
}
