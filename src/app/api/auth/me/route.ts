import { ok, fail } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const s = await getSession();
    if (!s) return ok({ session: null });
    const p = getProtocol();
    return ok({ session: s, portfolio: p.portfolio(s.address) });
  } catch (e) { return fail(e); }
}
