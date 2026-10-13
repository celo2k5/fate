import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "fate_admin";
const TTL = 12 * 3_600_000;

/** Admin key comes from FATE_ADMIN_KEY. The dev default is announced in the console so it is never a silent backdoor. */
export function adminKey(): string {
  const k = process.env.FATE_ADMIN_KEY;
  if (k) return k;
  const g = globalThis as unknown as { __fateAdminWarned?: boolean };
  if (!g.__fateAdminWarned) { g.__fateAdminWarned = true; console.warn("[admin] FATE_ADMIN_KEY not set — using the development key 'fate-admin'. Set it before any deployment."); }
  return "fate-admin";
}
function secret() { return process.env.FATE_SESSION_SECRET ?? adminKey() + ":session"; }
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("hex"); }

export function verifyKey(input: string): boolean {
  const a = Buffer.from(String(input)), b = Buffer.from(adminKey());
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function createAdminSession() {
  const payload = `${Date.now() + TTL}.${randomBytes(8).toString("hex")}`;
  const c = await cookies();
  c.set(ADMIN_COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: TTL / 1000 });
}
export async function isAdmin(): Promise<boolean> {
  const c = await cookies();
  const v = c.get(ADMIN_COOKIE)?.value;
  if (!v) return false;
  const i = v.lastIndexOf(".");
  if (i < 0) return false;
  const payload = v.slice(0, i), sig = v.slice(i + 1);
  const exp = Number(payload.split(".")[0]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(payload));
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function endAdminSession() { (await cookies()).delete(ADMIN_COOKIE); }
