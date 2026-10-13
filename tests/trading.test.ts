import { describe, it, expect } from "vitest";
import { fresh, launch, trader, buy, sell, sig } from "./helpers";
import { PROTOCOL } from "@/engine/config";
import { sol, tokens } from "@/engine/units";
import { quoteBuy, quoteSell, applyBuy, type Reserves } from "@/engine/curve";

describe("bonding curve math", () => {
  const r: Reserves = { virtualSol: PROTOCOL.initialVirtualSol, virtualTokens: PROTOCOL.initialVirtualTokens, realSol: 0n, realTokens: PROTOCOL.curveTokens };
  it("keeps k non-decreasing on buys and sells", () => {
    const k0 = r.virtualSol * r.virtualTokens;
    const q = quoteBuy(r, sol(1), 100, 8000, 100);
    const r1 = applyBuy(r, q);
    expect(r1.virtualSol * r1.virtualTokens >= k0).toBe(true);
    const s = quoteSell(r1, q.amountOut, 100, 8000, 100);
    expect(s.amountOut < sol(1)).toBe(true); // round trip loses fees
  });
  it("buy fee is 1% split 80/20", () => {
    const q = quoteBuy(r, sol(10), 100, 8000, 100);
    expect(q.fee).toBe(sol(0.1));
    expect(q.destinyFee).toBe(sol(0.08));
    expect(q.protocolFee).toBe(sol(0.02));
  });
  it("reports positive price impact on a buy", () => {
    const q = quoteBuy(r, sol(5), 100, 8000, 100);
    expect(q.priceImpactBps).toBeGreaterThan(0);
    expect(q.spotAfter).toBeGreaterThan(q.spotBefore);
  });
  it("refuses to sell beyond real reserves", () => {
    expect(() => quoteSell(r, tokens(1_000_000), 100, 8000, 100)).toThrow(/reserves/);
  });
  it("refuses to exhaust inventory", () => {
    expect(() => quoteBuy(r, sol(10_000), 100, 8000, 100)).toThrow(/inventory/);
  });
});

describe("trading", () => {
  it("buy moves SOL to the curve, tokens to the trader and fees to the vault", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p);
    const before = p.getWallet(t)!.lamports;
    const tr = buy(p, token.id, t, sol(2));
    expect(p.getWallet(t)!.lamports).toBe(before - sol(2));
    expect(p.holding(token.id, t)).toBe(tr.token_amount);
    expect(p.getCurve(token.id).real_sol).toBe(sol(2) - sol(0.02));
    expect(p.vaultBalance(token.id)).toBe(sol(0.016));
    expect(p.getWallet(PROTOCOL.protocolTreasury)!.lamports).toBe(sol(0.004));
    expect(p.getState(token.id).state).toBe("ACCUMULATING");
    const fees = p.db.prepare("SELECT COUNT(*) c FROM fee_events WHERE token_id=?").get(token.id) as { c: bigint };
    expect(fees.c).toBe(1n);
  });

  it("sell returns SOL minus fee and keeps accounting consistent", () => {
    const p = fresh();
    const { token } = launch(p, "GRAVITY");
    const t = trader(p);
    const b = buy(p, token.id, t, sol(3));
    const s = sell(p, token.id, t, b.token_amount as bigint);
    expect(p.holding(token.id, t)).toBe(0n);
    const curve = p.getCurve(token.id);
    expect(curve.real_tokens).toBe(PROTOCOL.curveTokens);
    // real SOL left on curve == what the trader lost minus fees that left the curve
    const vault = p.vaultBalance(token.id);
    const proto = p.getWallet(PROTOCOL.protocolTreasury)!.lamports;
    const curveWallet = p.getWallet(curve.curve_address)!.lamports;
    expect(curveWallet).toBe(curve.real_sol);
    expect(curveWallet + vault + proto + p.getWallet(t)!.lamports).toBe(sol(50));
    expect(s.side).toBe("SELL");
  });

  it("enforces slippage via minOut", () => {
    const p = fresh();
    const { token } = launch(p, "ECHO");
    const t = trader(p);
    const q = p.quote(token.id, "BUY", sol(1), 100);
    expect(() => p.buy({ tokenId: token.id, trader: t, amountIn: sol(1), minOut: q.amountOut * 2n, signature: sig() })).toThrow(/stale|minimum/);
  });

  it("rejects insufficient balances", () => {
    const p = fresh();
    const { token } = launch(p, "ORBIT");
    const t = trader(p, sol(1));
    expect(() => p.buy({ tokenId: token.id, trader: t, amountIn: sol(2), minOut: 0n, signature: sig() })).toThrow(/insufficient/i);
    expect(() => p.sell({ tokenId: token.id, trader: t, amountIn: tokens(1), minOut: 0n, signature: sig() })).toThrow(/insufficient/i);
  });

  it("is idempotent on replayed signatures", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p);
    const q = p.quote(token.id, "BUY", sol(1), 100);
    const s = sig();
    const a = p.buy({ tokenId: token.id, trader: t, amountIn: sol(1), minOut: q.minOut, signature: s });
    const b = p.buy({ tokenId: token.id, trader: t, amountIn: sol(1), minOut: q.minOut, signature: s });
    expect(a.id).toBe(b.id);
    expect(p.getWallet(t)!.lamports).toBe(sol(49));
  });

  it("isolates vaults between tokens", () => {
    const p = fresh();
    const a = launch(p, "PHOENIX").token;
    const b = launch(p, "PHOENIX").token;
    const t = trader(p);
    buy(p, a.id, t, sol(5));
    expect(p.vaultBalance(a.id)).toBeGreaterThan(0n);
    expect(p.vaultBalance(b.id)).toBe(0n);
  });

  it("rejects trades on unknown tokens", () => {
    const p = fresh();
    const t = trader(p);
    expect(() => p.buy({ tokenId: "nope", trader: t, amountIn: sol(1), minOut: 0n, signature: sig() })).toThrow(/not found/);
  });
});
