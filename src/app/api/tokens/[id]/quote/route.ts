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
    return ok(getProtocol().quote(id, side, amount, slippage));
  } catch (e) { return fail(e); }
}
