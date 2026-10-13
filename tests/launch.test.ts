import { describe, it, expect } from "vitest";
import { fresh, launch } from "./helpers";
import { PROTOCOL } from "@/engine/config";
import { sol } from "@/engine/units";

describe("launch", () => {
  it("creates a token with mint, curve, vault and immutable destiny config", () => {
    const p = fresh();
    const { token, creator } = launch(p, "PHOENIX");
    expect(token.destiny).toBe("PHOENIX");
    expect(token.total_supply).toBe(PROTOCOL.totalSupply);
    const curve = p.getCurve(token.id);
    expect(curve.real_tokens).toBe(PROTOCOL.curveTokens);
    expect(curve.reserved_tokens).toBe(PROTOCOL.reservedTokens);
    expect(curve.real_sol).toBe(0n);
    expect(p.holding(token.id, curve.curve_address)).toBe(PROTOCOL.curveTokens);
    expect(p.holding(token.id, `reserve:${token.id}`)).toBe(PROTOCOL.reservedTokens);
    expect(p.vaultBalance(token.id)).toBe(0n);
    expect(p.getState(token.id).state).toBe("IDLE");
    expect(p.getWallet(`vault:${token.id}`)?.kind).toBe("vault");
    expect(token.creator).toBe(creator);
  });

  it("clamps creator-chosen parameters into protocol bounds", () => {
    const p = fresh();
    const { token } = launch(p, "ORBIT", { executionThreshold: sol(10_000), cooldownMs: 1, graduationThreshold: sol(1) });
    const cfg = p.getConfig(token.id);
    expect(cfg.execution_threshold).toBe(PROTOCOL.bounds.executionThreshold.max);
    expect(Number(cfg.cooldown_ms)).toBe(PROTOCOL.bounds.cooldownMs.min);
    expect(cfg.graduation_threshold).toBe(PROTOCOL.bounds.graduationThreshold.min);
  });

  it("has no engine path to change the destiny after launch", () => {
    const p = fresh();
    const { token } = launch(p, "ECHO");
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(p));
    expect(api.some((m) => /setDestiny|updateDestiny|changeDestiny|updateConfig/i.test(m))).toBe(false);
    // the config row is only ever inserted once; a second insert is a PK violation
    expect(() =>
      p.db.prepare("INSERT INTO destiny_configs(token_id,destiny,trade_fee_bps,destiny_share_bps,execution_threshold,cooldown_ms,max_slippage_bps,graduation_threshold,params_json,config_hash) VALUES (?,?,1,1,1,1,1,1,'{}','x')").run(token.id, "PHOENIX"),
    ).toThrow();
    expect(p.getConfig(token.id).destiny).toBe("ECHO");
  });

  it("rejects an Orbit allocation that does not sum to 100%", () => {
    const p = fresh();
    expect(() => launch(p, "ORBIT", { params: { allocationBps: { SOL: 5000, USDC: 5000, LST: 1000, RESERVE: 0 } } })).toThrow(/sum/);
  });

  it("records remaining authorities", () => {
    const p = fresh();
    const { token } = launch(p, "GRAVITY");
    const l = p.db.prepare("SELECT authorities_json FROM launches WHERE token_id=?").get(token.id) as { authorities_json: string };
    const a = JSON.parse(l.authorities_json);
    expect(a.destiny).toMatch(/immutable/);
    expect(a.mint).toMatch(/revoked/);
  });
});
