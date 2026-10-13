import { EngineError } from "@/engine/units";

/**
 * Per-process token bucket keyed by (bucket, client). It is a first line of defence for the
 * monetary POST routes (launch, trade, faucet, crank, nonce); it is not durable across instances —
 * put a real limiter (Render's, Cloudflare's) in front for mainnet. Limits are per minute.
 */
const LIMITS: Record<string, { perMinute: number; burst: number }> = {
  launch: { perMinute: 5, burst: 5 },
  trade: { perMinute: 60, burst: 20 },
  claim: { perMinute: 30, burst: 10 },
  faucet: { perMinute: 30, burst: 15 },   // simnet test SOL only (the route refuses off-simnet)
  crank: { perMinute: 30, burst: 10 },
  nonce: { perMinute: 30, burst: 10 },
  chain: { perMinute: 30, burst: 10 },
};
const buckets = new Map<string, { tokens: number; at: number }>();

export function clientKey(req: Request): string {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

export function rateLimit(bucket: keyof typeof LIMITS, req: Request) {
  if (process.env.NODE_ENV === "test" || process.env.FATE_RATELIMIT === "off") return;
  const lim = LIMITS[bucket];
  const key = `${bucket}:${clientKey(req)}`;
  const t = Date.now();
  const b = buckets.get(key) ?? { tokens: lim.burst, at: t };
  b.tokens = Math.min(lim.burst, b.tokens + ((t - b.at) / 60_000) * lim.perMinute);
  b.at = t;
  if (b.tokens < 1) { buckets.set(key, b); throw new EngineError("RATE_LIMITED", `too many ${bucket} requests; try again shortly`); }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (t - v.at > 600_000) buckets.delete(k);
}
