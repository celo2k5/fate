import { ok, fail } from "@/lib/api";
import { isAdmin } from "@/lib/admin-auth";
import { getSettings, saveSettings, maskSecrets, readiness } from "@/lib/settings";
import { EngineError } from "@/engine/units";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (!(await isAdmin())) throw new EngineError("UNAUTHENTICATED", "admin only");
    const s = getSettings();
    return ok({ settings: maskSecrets(s), readiness: readiness(s) });
  } catch (e) { return fail(e); }
}
export async function PUT(req: Request) {
  try {
    if (!(await isAdmin())) throw new EngineError("UNAUTHENTICATED", "admin only");
    const r = saveSettings(await req.json());
    if (!r.ok) return ok({ errors: r.errors }, { status: 400 });
    return ok({ settings: maskSecrets(r.settings), readiness: readiness(r.settings) });
  } catch (e) { return fail(e); }
}
