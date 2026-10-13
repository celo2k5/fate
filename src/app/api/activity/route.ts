import { ok, fail } from "@/lib/api";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    return ok(getProtocol().activity(Number(u.searchParams.get("limit") ?? 30)));
  } catch (e) { return fail(e); }
}
