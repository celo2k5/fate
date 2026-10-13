import { ok, fail, parseBig } from "@/lib/api";
import { requireSession, verifyIntent } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";

interface TradeIntent { kind: "trade"; address: string; issuedAt: number; tokenId: string; side: "BUY" | "SELL"; amountIn: string; minOut: string; slippageBps: number }

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const s = await requireSession();
    const { intent, signature } = verifyIntent<TradeIntent>(await req.json(), "trade", s.address);
    if (intent.tokenId !== id) throw new Error("intent token mismatch");
    const p = getProtocol();
    const input = { tokenId: id, trader: s.address, amountIn: parseBig(intent.amountIn, "amountIn"), minOut: parseBig(intent.minOut, "minOut"), signature, slippageBps: intent.slippageBps };
    const trade = intent.side === "SELL" ? p.sell(input) : p.buy(input);
    return ok({ trade, portfolio: p.portfolio(s.address), token: p.detail(id) });
  } catch (e) { return fail(e); }
}
