import { ok, fail } from "@/lib/api";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET() { try { return ok(getProtocol().stats()); } catch (e) { return fail(e); } }
