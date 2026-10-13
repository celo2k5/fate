import { ok, fail } from "@/lib/api";
import { endSession } from "@/lib/auth";
export async function POST() {
  try { await endSession(); return ok({ ok: true }); } catch (e) { return fail(e); }
}
