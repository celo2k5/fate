import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit } from "@/lib/ratelimit";

const req = (ip: string) => new Request("http://x/api", { headers: { "x-forwarded-for": ip } });

describe("rate limiter", () => {
  beforeEach(() => { process.env.FATE_RATELIMIT = "on"; (process.env as Record<string, string>).NODE_ENV = "production"; });
  it("allows a burst, then refuses with RATE_LIMITED, per client and per bucket", () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 5; i++) rateLimit("launch", req(ip));
    expect(() => rateLimit("launch", req(ip))).toThrow(/RATE|too many/i);
    expect(() => rateLimit("launch", req("10.9.9.9"))).not.toThrow();   // another client
    expect(() => rateLimit("trade", req(ip))).not.toThrow();            // another bucket
  });
});
