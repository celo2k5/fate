import { ok, fail } from "@/lib/api";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const d = getProtocol().detail(id);
    if (!d) return ok({ error: "not found" }, { status: 404 });
    return ok(d);
  } catch (e) { return fail(e); }
}
