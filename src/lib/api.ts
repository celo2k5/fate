import { NextResponse } from "next/server";
import { EngineError, serialize } from "@/engine/units";

export const ok = (data: unknown, init?: ResponseInit) => NextResponse.json(serialize(data), init);

export function fail(e: unknown) {
  if (e instanceof EngineError) {
    const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "NOT_FOUND" ? 404 : e.code === "RATE_LIMITED" ? 429 : e.code === "PAUSED" ? 503 : 400;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  console.error(e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

export const parseBig = (v: unknown, what: string): bigint => {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  throw new EngineError("BAD_AMOUNT", `${what} must be an integer string`);
};
