import { ok, fail } from "@/lib/api";
import { getProtocol } from "@/engine/keeper";
import type { DestinyType } from "@/engine/config";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const destiny = u.searchParams.get("destiny") as DestinyType | null;
    return ok(getProtocol().list({
      destiny: destiny ?? undefined,
      graduated: u.searchParams.get("graduated") === "1",
      sort: (u.searchParams.get("sort") as "new" | "trending") ?? "new",
      q: u.searchParams.get("q") ?? undefined,
      limit: Number(u.searchParams.get("limit") ?? 60),
    }));
  } catch (e) { return fail(e); }
}
