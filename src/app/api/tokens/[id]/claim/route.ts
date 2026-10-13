import { rateLimit } from "@/lib/ratelimit";
import { ok, fail } from "@/lib/api";
import { requireSession, verifyIntent } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";

interface ClaimIntent { kind: "claim"; address: string; issuedAt: number; tokenId: string; epochId: string }

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    rateLimit("claim", req);
    const { id } = await ctx.params;
    const s = await requireSession();
    const { intent, signature } = verifyIntent<ClaimIntent>(await req.json(), "claim", s.address);
    const p = getProtocol();
    const r = p.claim(intent.epochId, s.address, signature);
    const t = p.getToken(id);
    let txSignature: string | null = null;
    if (t?.chain && t.chain !== "SIMNET") {
      // the ledger reserved the allocation (UNIQUE(epoch_id,address)); now pay it on-chain — idempotent per claim id
      const { payClaim } = await import("@/chain/agents");
      txSignature = await payClaim(p, id, r.claimId, s.address, r.amount);
      p.db.prepare("UPDATE wallets SET lamports = lamports - ? WHERE address=?").run(r.amount, s.address); // the SOL is in the user's real wallet, not the mirror
    }
    return ok({ claim: { ...r, signature: txSignature }, claimable: p.claimable(id, s.address), portfolio: p.portfolio(s.address) });
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
