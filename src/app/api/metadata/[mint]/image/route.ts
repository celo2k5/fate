import { NextResponse } from "next/server";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const row = getProtocol().db.prepare("SELECT image_data_url FROM token_metadata WHERE mint=?").get(mint) as { image_data_url: string | null } | undefined;
  if (!row?.image_data_url?.startsWith("data:")) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [head, b64] = row.image_data_url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  return new NextResponse(Buffer.from(b64, "base64"), { headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" } });
}
