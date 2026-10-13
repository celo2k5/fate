import "server-only";
import { cookies } from "next/headers";
export const PREVIEW_COOKIE = "fate_preview";
/** Preview mode: the public site renders with the admin's mainnet configuration (network label, links, launch date). */
export async function getPreview(): Promise<boolean> {
  const c = await cookies();
  return c.get(PREVIEW_COOKIE)?.value === "1";
}
