import { ok, fail } from "@/lib/api";
import { isAdmin } from "@/lib/admin-auth";
import { getProtocol, keeperStatus } from "@/engine/keeper";
import { EngineError } from "@/engine/units";
import { seedDemo } from "@/engine/seed";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (!(await isAdmin())) throw new EngineError("UNAUTHENTICATED", "admin only");
    const p = getProtocol();
    const tokens = (p.list({ limit: 200 }) as unknown as Record<string, unknown>[]).map((t) => ({ id: t.id, name: t.name, ticker: t.ticker, destiny: t.destiny, status: t.status, state: t.state, executions: t.executions, vault: t.vault, holders: t.holders, created_at: t.created_at }));
    const failed = p.db.prepare("SELECT e.id, e.token_id, t.ticker, e.seq, e.error, e.created_at FROM destiny_executions e JOIN tokens t ON t.id=e.token_id WHERE e.status='FAILED' ORDER BY e.created_at DESC LIMIT 20").all();
    const sessions = Number((p.db.prepare("SELECT COUNT(*) c FROM wallet_sessions WHERE expires_at > ?").get(Date.now()) as { c: bigint }).c);
    return ok({ stats: p.stats(), keeper: keeperStatus(), tokens, failed, sessions, protocolTreasury: p.getWallet("FATEprotoco1Treasury11111111111111111111111")?.lamports ?? 0n });
  } catch (e) { return fail(e); }
}
export async function POST(req: Request) {
  try {
    if (!(await isAdmin())) throw new EngineError("UNAUTHENTICATED", "admin only");
    const { action, tokenId } = await req.json();
    const p = getProtocol();
    if (action === "crank") return ok(tokenId ? p.crank(String(tokenId)) : p.crankAll());
    if (action === "seed") return ok({ seeded: seedDemo(p) });
    if (action === "snapshot") { for (const r of p.db.prepare("SELECT id FROM tokens").all() as { id: string }[]) p.snapshotMarket(r.id); return ok({ ok: true }); }
    throw new EngineError("BAD_ACTION", "unknown action");
  } catch (e) { return fail(e); }
}
