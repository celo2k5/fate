import { ok, fail } from "@/lib/api";
import { getProtocol, keeperStatus } from "@/engine/keeper";
/** Permissionless crank: anyone may call it; the engine validates everything. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const p = getProtocol();
    if (body?.tokenId) return ok(p.crank(String(body.tokenId)));
    return ok(p.crankAll());
  } catch (e) { return fail(e); }
}
export const dynamic = "force-dynamic";
export async function GET() { return ok(keeperStatus()); }
