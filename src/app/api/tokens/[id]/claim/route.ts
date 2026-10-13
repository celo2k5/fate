import { ok, fail } from "@/lib/api";
import { requireSession, verifyIntent } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";

interface ClaimIntent { kind: "claim"; address: string; issuedAt: number; tokenId: string; epochId: string }

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const s = await requireSession();
    const { intent, signature } = verifyIntent<ClaimIntent>(await req.json(), "claim", s.address);
    const p = getProtocol();
    const r = p.claim(intent.epochId, s.address, signature);
    return ok({ claim: r, claimable: p.claimable(id, s.address), portfolio: p.portfolio(s.address) });
  } catch (e) { return fail(e); }
}
export const dynamic = "force-dynamic";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const s = await requireSession();
    return ok({ claimable: getProtocol().claimable(id, s.address) });
  } catch (e) { return fail(e); }
}
