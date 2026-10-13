import { ok } from "@/lib/api";
import { endAdminSession } from "@/lib/admin-auth";
export async function POST() { await endAdminSession(); return ok({ ok: true }); }
