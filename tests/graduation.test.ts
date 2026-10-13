import { describe, it, expect } from "vitest";
import { fresh, launch, trader, buy, sell, timeTravel } from "./helpers";
import { PROTOCOL } from "@/engine/config";
import { sol } from "@/engine/units";
import { spotPrice } from "@/engine/curve";

describe("graduation", () => {
  it("detects the threshold, migrates liquidity with price continuity and locks LP", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX", { graduationThreshold: sol(10) });
    const t = trader(p, sol(100));
    buy(p, token.id, t, sol(9));
    expect(p.getToken(token.id)!.status).toBe("CURVE");
    buy(p, token.id, t, sol(2));
    const tk = p.getToken(token.id)!;
    expect(tk.status).toBe("AMM");
    const pool = p.getPool(token.id)!;
    const curveFinal = p.getCurve(token.id); // virtual reserves are frozen at graduation
    const priceBefore = spotPrice({ virtualSol: curveFinal.virtual_sol, virtualTokens: curveFinal.virtual_tokens });
    const priceAfter = spotPrice({ virtualSol: pool.sol_reserve, virtualTokens: pool.token_reserve });
    // pool opens within 0.5% of the curve's final price
    expect(Math.abs(priceAfter / priceBefore - 1)).toBeLessThan(0.005);
    expect(pool.lp_locked).toBe(pool.lp_supply);
    expect(p.getWallet(pool.pool_address)!.lamports).toBe(pool.sol_reserve);
    expect(p.holding(token.id, pool.pool_address)).toBe(pool.token_reserve);
    expect(p.getCurve(token.id).complete).toBe(1n);
    const g = p.db.prepare("SELECT * FROM graduations WHERE token_id=?").get(token.id) as { signature: string; sol_migrated: bigint };
    expect(g.signature).toMatch(/^grad:/);
    // surplus reserve tokens were burned, not kept by anyone
    expect(p.holding(token.id, `reserve:${token.id}`)).toBe(0n);
    expect(tk.burned > 0n).toBe(true);
    expect(tk.circulating).toBe(PROTOCOL.totalSupply - tk.burned);
  });

  it("cannot graduate twice and cannot graduate early", () => {
    const p = fresh();
    const { token } = launch(p, "GRAVITY", { graduationThreshold: sol(10) });
    expect(() => p.graduate(token.id)).toThrow(/threshold/);
    const t = trader(p, sol(100));
    buy(p, token.id, t, sol(11));
    expect(() => p.graduate(token.id)).toThrow(/already/);
  });

  it("trading and destiny execution continue on the AMM after graduation", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX", { graduationThreshold: sol(10) });
    const t = trader(p, sol(300));
    buy(p, token.id, t, sol(11));
    expect(p.getToken(token.id)!.status).toBe("AMM");
    const b = buy(p, token.id, t, sol(5));
    expect(b.venue).toBe("AMM");
    sell(p, token.id, t, (b.token_amount as bigint) / 2n);
    for (let i = 0; i < 10; i++) { const x = buy(p, token.id, t, sol(5)); sell(p, token.id, t, x.token_amount as bigint); }
    timeTravel(p, 10_000);
    expect(p.vaultBalance(token.id) >= sol(0.3)).toBe(true);
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    const ex = p.db.prepare("SELECT venue, status FROM destiny_executions WHERE token_id=?").get(token.id) as { venue: string; status: string };
    expect(ex.venue).toBe("AMM");
    expect(ex.status).toBe("COMPLETED");
    expect(p.getState(token.id).total_burned > 0n).toBe(true);
  });
});
