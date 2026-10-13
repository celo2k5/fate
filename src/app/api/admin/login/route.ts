import { ok, fail } from "@/lib/api";
import { createAdminSession, verifyKey } from "@/lib/admin-auth";
import { EngineError } from "@/engine/units";
export async function POST(req: Request) {
  try {
    const { key } = await req.json();
    if (!verifyKey(String(key ?? ""))) throw new EngineError("UNAUTHENTICATED", "wrong admin key");
    await createAdminSession();
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
