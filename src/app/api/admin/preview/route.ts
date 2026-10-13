import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/admin-auth";
import { PREVIEW_COOKIE } from "@/lib/preview";
/** GET ?on=1 enables preview for this browser and opens the site; ?off=1 clears it. Admin only to enable. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await cookies();
  if (u.searchParams.get("off")) { c.delete(PREVIEW_COOKIE); return NextResponse.redirect(new URL("/", req.url)); }
  if (!(await isAdmin())) return NextResponse.redirect(new URL("/admin/login", req.url));
  c.set(PREVIEW_COOKIE, "1", { sameSite: "lax", path: "/", maxAge: 3600 });
  return NextResponse.redirect(new URL(u.searchParams.get("to") ?? "/", req.url));
}
