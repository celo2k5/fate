import { describe, it, expect } from "vitest";
import { fresh, launch, trader, buy, sell, sig, timeTravel } from "./helpers";
import { PROTOCOL } from "@/engine/config";
import { sol, tokens } from "@/engine/units";

/** Generate enough fee volume to push the vault over the 0.3 SOL threshold set in helpers. */
function pumpFees(p: ReturnType<typeof fresh>, tokenId: string, who: string, rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    const b = buy(p, tokenId, who, sol(5));
    sell(p, tokenId, who, (b.token_amount as bigint) / 2n);
  }
}

describe("PHOENIX", () => {
  it("accumulates fees, becomes eligible, buys back and burns", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p, sol(200));
    expect(p.crank(token.id)).toMatchObject({ executed: false, state: "IDLE" });
    buy(p, token.id, t, sol(1));
    expect(p.crank(token.id)).toMatchObject({ executed: false, state: "ACCUMULATING", reason: "vault below threshold" });
    pumpFees(p, token.id, t);
    const vaultBefore = p.vaultBalance(token.id);
    expect(vaultBefore >= sol(0.3)).toBe(true);
    const supplyBefore = p.getToken(token.id)!.circulating;
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    const st = p.getState(token.id);
    expect(st.state).toBe("COMPLETED");
    expect(st.executions).toBe(1n);
    expect(st.total_burned > 0n).toBe(true);
    const tk = p.getToken(token.id)!;
    expect(tk.burned).toBe(st.total_burned);
    expect(tk.circulating).toBe(supplyBefore - st.total_burned);
    expect(p.holding(token.id, PROTOCOL.burnAddress)).toBe(st.total_burned);
    expect(p.holding(token.id, `vault:${token.id}`)).toBe(0n); // nothing lingers in the vault
    const ex = p.db.prepare("SELECT * FROM destiny_executions WHERE token_id=?").all(token.id) as { status: string; seq: bigint }[];
    expect(ex).toHaveLength(1);
    expect(ex[0].status).toBe("COMPLETED");
  });

  it("respects cooldown and never double-executes", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p, sol(400));
    pumpFees(p, token.id, t, 8);
    expect(p.crank(token.id).executed).toBe(true);
    pumpFees(p, token.id, t, 8);
    expect(p.vaultBalance(token.id) >= sol(0.3)).toBe(true);
    const again = p.crank(token.id);
    expect(again.executed).toBe(false);
    expect(again.reason).toBe("cooldown");
    timeTravel(p, 10_000);
    expect(p.crank(token.id).executed).toBe(true);
    expect(p.getState(token.id).executions).toBe(2n);
    // seq uniqueness is enforced by the schema
    expect(() => p.db.prepare("INSERT INTO destiny_executions(id,token_id,destiny,seq,status,vault_before,created_at) VALUES ('x',?, 'PHOENIX', 1, 'COMPLETED', 0, 0)").run(token.id)).toThrow();
  });

  it("bounds the buyback by the slippage limit", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX", { maxSlippageBps: 50 });
    const t = trader(p, sol(400));
    pumpFees(p, token.id, t, 8);
    const vault = p.vaultBalance(token.id);
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    const ex = p.db.prepare("SELECT amount_used, result_json FROM destiny_executions WHERE token_id=?").get(token.id) as { amount_used: bigint; result_json: string };
    expect(ex.amount_used < vault).toBe(true);
    expect(JSON.parse(ex.result_json).priceImpactBps).toBeLessThanOrEqual(50);
  });
});

describe("GRAVITY", () => {
  it("pairs half the vault into an escrowed locked position pre-graduation", () => {
    const p = fresh();
    const { token } = launch(p, "GRAVITY");
    const t = trader(p, sol(200));
    pumpFees(p, token.id, t);
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    const pos = p.db.prepare("SELECT * FROM locked_liquidity WHERE token_id=?").all(token.id) as { stage: string; sol_amount: bigint; token_amount: bigint }[];
    expect(pos).toHaveLength(1);
    expect(pos[0].stage).toBe("ESCROW");
    expect(pos[0].sol_amount > 0n && pos[0].token_amount > 0n).toBe(true);
    expect(p.getWallet(`escrow:${token.id}`)!.lamports).toBe(pos[0].sol_amount);
    expect(p.holding(token.id, `escrow:${token.id}`)).toBe(pos[0].token_amount);
    expect(p.getState(token.id).total_liquidity_added).toBe(pos[0].sol_amount);
  });

  it("escrow migrates into the pool at graduation and LP stays locked; no withdrawal path exists", () => {
    const p = fresh();
    const { token } = launch(p, "GRAVITY", { graduationThreshold: sol(30) });
    const t = trader(p, sol(200));
    pumpFees(p, token.id, t, 6);
    expect(p.crank(token.id).executed).toBe(true);
    buy(p, token.id, t, sol(20));
    expect(p.getToken(token.id)!.status).toBe("AMM");
    const pool = p.getPool(token.id)!;
    expect(pool.lp_locked).toBe(pool.lp_supply);
    const pos = p.db.prepare("SELECT stage, lp_amount FROM locked_liquidity WHERE token_id=?").all(token.id) as { stage: string; lp_amount: bigint }[];
    expect(pos.every((x) => x.stage === "POOL")).toBe(true);
    expect(p.getWallet(`escrow:${token.id}`)!.lamports).toBe(0n);
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(p));
    expect(api.some((m) => /withdraw|removeLiquidity|burnLp/i.test(m))).toBe(false);
  });

  it("adds liquidity directly to the AMM after graduation", () => {
    const p = fresh();
    const { token } = launch(p, "GRAVITY", { graduationThreshold: sol(10) });
    const t = trader(p, sol(400));
    buy(p, token.id, t, sol(12));
    expect(p.getToken(token.id)!.status).toBe("AMM");
    const before = p.getPool(token.id)!;
    pumpFees(p, token.id, t, 10);
    timeTravel(p, 10_000);
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    const after = p.getPool(token.id)!;
    expect(after.sol_reserve > before.sol_reserve).toBe(true);
    expect(after.lp_supply > before.lp_supply).toBe(true);
    expect(after.lp_locked).toBe(after.lp_supply);
    expect(p.getWallet(after.pool_address)!.lamports).toBe(after.sol_reserve);
    expect(p.holding(token.id, after.pool_address)).toBe(after.token_reserve);
  });
});

describe("ECHO", () => {
  it("settles an epoch from a ledger snapshot and lets holders claim exactly once", () => {
    const p = fresh();
    const { token } = launch(p, "ECHO", { params: { minBalance: tokens(100_000), epochMs: 10_000 } });
    const f = trader(p, sol(200)), a = trader(p, sol(200)), b = trader(p, sol(200)), c = trader(p, sol(10));
    pumpFees(p, token.id, f, 6);   // f generates volume but sells -> forfeits the epoch
    buy(p, token.id, a, sol(3));
    buy(p, token.id, b, sol(2));
    buy(p, token.id, c, sol(0.001)); // below min balance
    expect(p.crank(token.id)).toMatchObject({ executed: false, reason: "epoch in progress" });
    timeTravel(p, 20_000);
    const vault = p.vaultBalance(token.id);
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    const ep = p.db.prepare("SELECT * FROM reward_epochs WHERE token_id=?").get(token.id) as { id: string; eligible_wallets: bigint; funded: bigint; snapshot_json: string };
    expect(ep.eligible_wallets).toBe(2n);
    expect(ep.funded <= vault).toBe(true);
    const snap = JSON.parse(ep.snapshot_json) as [string, string, string][];
    expect(snap.map((s) => s[0]).sort()).toEqual([a, b].sort());
    expect(snap.some((s) => s[0] === `curve:${token.id}` || s[0] === f || s[0] === c)).toBe(false);
    // claims
    const claimable = p.claimable(token.id, a);
    expect(claimable[0].claimed).toBe(false);
    const before = p.getWallet(a)!.lamports;
    const cl = p.claim(ep.id, a, sig());
    expect(p.getWallet(a)!.lamports).toBe(before + cl.amount);
    expect(() => p.claim(ep.id, a, sig())).toThrow(/already claimed/);
    expect(() => p.claim(ep.id, c, sig())).toThrow(/not in the epoch/);
    p.claim(ep.id, b, sig());
    const after = p.db.prepare("SELECT claimed, funded FROM reward_epochs WHERE id=?").get(ep.id) as { claimed: bigint; funded: bigint };
    expect(after.claimed <= after.funded).toBe(true);
    expect(p.claimable(token.id, a)[0].claimed).toBe(true);
  });

  it("forfeits the epoch for wallets that sold during it", () => {
    const p = fresh();
    const { token } = launch(p, "ECHO", { params: { minBalance: tokens(1_000), epochMs: 10_000 } });
    const a = trader(p, sol(200)), b = trader(p, sol(200));
    pumpFees(p, token.id, a, 6); // a sells inside epoch 1
    buy(p, token.id, b, sol(2));
    timeTravel(p, 20_000);
    expect(p.crank(token.id).executed).toBe(true);
    const ep = p.db.prepare("SELECT snapshot_json FROM reward_epochs WHERE token_id=?").get(token.id) as { snapshot_json: string };
    const snap = JSON.parse(ep.snapshot_json) as [string][];
    expect(snap.map((s) => s[0])).toEqual([b]);
    // a is eligible again next epoch if it holds
    pumpFees(p, token.id, b, 6);
    timeTravel(p, 20_000);
    expect(p.crank(token.id).executed).toBe(true);
    const ep2 = p.db.prepare("SELECT snapshot_json FROM reward_epochs WHERE token_id=? AND epoch=2").get(token.id) as { snapshot_json: string };
    expect((JSON.parse(ep2.snapshot_json) as [string][]).map((s) => s[0])).toEqual([a]);
  });

  it("fails safely with no eligible holders and recovers", () => {
    const p = fresh();
    const { token } = launch(p, "ECHO", { params: { minBalance: tokens(10_000_000), epochMs: 10_000 } });
    const a = trader(p, sol(200));
    pumpFees(p, token.id, a, 6);
    timeTravel(p, 20_000);
    const r = p.crank(token.id);
    expect(r.executed).toBe(false);
    expect(p.getState(token.id).state).toBe("FAILED");
    expect(p.vaultBalance(token.id) > 0n).toBe(true); // vault untouched
    buy(p, token.id, a, sol(0.5));
    timeTravel(p, 20_000);
    const r2 = p.crank(token.id);
    expect(r2.executed).toBe(false); // still no eligible holders, but it retried rather than freezing
    expect(p.db.prepare("SELECT COUNT(*) c FROM destiny_executions WHERE token_id=? AND status='FAILED'").get(token.id)).toEqual({ c: 2n });
  });
});

describe("ORBIT", () => {
  it("allocates the vault across approved assets within slippage and reconciles", () => {
    const p = fresh();
    const { token } = launch(p, "ORBIT");
    const t = trader(p, sol(200));
    pumpFees(p, token.id, t);
    const vault = p.vaultBalance(token.id);
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    const assets = p.db.prepare("SELECT asset, amount, cost_basis_lamports FROM treasury_assets WHERE token_id=?").all(token.id) as { asset: string; amount: bigint; cost_basis_lamports: bigint }[];
    const byAsset = Object.fromEntries(assets.map((a) => [a.asset, a]));
    expect(byAsset.SOL.amount).toBe((vault * 4000n) / 10000n);
    expect(byAsset.RESERVE.amount).toBe((vault * 1000n) / 10000n);
    expect(byAsset.USDC.amount > 0n && byAsset.LST.amount > 0n).toBe(true);
    const totalCost = assets.reduce((s, a) => s + a.cost_basis_lamports, 0n);
    expect(totalCost <= vault).toBe(true);
    expect(p.getWallet(`treasury:${token.id}`)!.lamports).toBe(byAsset.SOL.amount + byAsset.RESERVE.amount);
    expect(p.getState(token.id).total_treasury_deployed).toBe(totalCost);
    const d = p.detail(token.id)!;
    expect((d as unknown as { treasuryValue: bigint }).treasuryValue > 0n).toBe(true);
  });

  it("rejects unapproved assets at launch", () => {
    const p = fresh();
    expect(() => launch(p, "ORBIT", { params: { allocationBps: { SOL: 5000, USDC: 0, LST: 0, RESERVE: 0, BONK: 5000 } as never } })).toThrow(/not approved/);
  });
});
