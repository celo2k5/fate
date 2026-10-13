import { ok, fail } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const s = await requireSession(); return ok(getProtocol().portfolio(s.address)); } catch (e) { return fail(e); }
}
