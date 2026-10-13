import { NextResponse } from "next/server";
import { getProtocol } from "@/engine/keeper";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const row = getProtocol().db.prepare("SELECT json FROM token_metadata WHERE mint=?").get(mint) as { json: string } | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(row.json, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
}
