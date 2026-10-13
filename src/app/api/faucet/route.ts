import { ok, fail } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";
export async function POST() {
  try {
    const s = await requireSession();
    return ok(getProtocol().faucet(s.address));
  } catch (e) { return fail(e); }
}
