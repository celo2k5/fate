import { isAdmin } from "@/lib/admin-auth";
import { exportEnv, getSettings } from "@/lib/settings";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await isAdmin())) return new Response("admin only", { status: 401 });
  return new Response(exportEnv(getSettings()), { headers: { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename=".env.mainnet"' } });
}
