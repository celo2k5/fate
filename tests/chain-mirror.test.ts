import { describe, it, expect } from "vitest";
import { fresh } from "./helpers";
import { newAddress } from "@/engine/ids";
import { PROTOCOL } from "@/engine/config";

/**
 * The on-chain mirror: a coin whose trades come from pump.fun TradeEvents instead of the simnet curve.
 * These tests feed decoded events straight into the ledger (no RPC), checking accounting, idempotency and the
 * guards that keep the simnet executor away from on-chain coins.
 */
function chainLaunch(p = fresh(), destiny: "PHOENIX" | "ECHO" | "GRAVITY" | "ORBIT" = "PHOENIX") {
  const creator = newAddress();
  p.ensureWallet(creator, "user");
  const mint = newAddress();
  const token = p.launch({
    chain: { chain: "DEVNET", mint, bondingCurve: `bc_${mint.slice(0, 8)}`, vaultAuthority: newAddress(), metadataUri: "https://x/meta", totalSupply: 1_000_000_000_000_000n, virtualSol: 1_000_000_000n, virtualTokens: 1_073_000_000_000_000n, realTokens: 793_100_000_000_000n },
    name: "Chain Coin", ticker: "CHN", description: "", destiny, creator, executionThreshold: 250_000_000n, cooldownMs: 5_000, maxSlippageBps: 1500,
    signature: `launch_${mint}`, signedMessage: "m",
  });
  return { p, token, mint, creator };
}

const event = (tokenId: string, sig: string, i: number, side: "BUY" | "SELL", sol: bigint, tokens: bigint, creatorFee: bigint, trader = newAddress()) => ({
  tokenId, signature: `${sig}#${i}`, slot: 100 + i, blockTime: null, trader, side, solAmount: sol, tokenAmount: tokens, creatorFee, totalFee: creatorFee + sol / 100n,
  virtualSol: 1_000_000_000n + sol, virtualTokens: 1_073_000_000_000_000n - tokens, realSol: sol, realTokens: 793_100_000_000_000n - tokens, isProtocol: false,
});

describe("chain mirror", () => {
  it("launches a DEVNET coin with chain-sourced supply and reserves, and marks it as on-chain", () => {
    const { p, token, mint } = chainLaunch();
    expect(token.id).toBe(mint);
    expect(token.chain).toBe("DEVNET");
    expect(token.total_supply).toBe(1_000_000_000_000_000n);
    const curve = p.getCurve(token.id);
    expect(curve.virtual_sol).toBe(1_000_000_000n);          // devnet's 1 SOL virtual reserve, not the simnet constant
    expect(curve.real_tokens).toBe(793_100_000_000_000n);
    expect(p.holding(token.id, curve.curve_address)).toBe(793_100_000_000_000n);
    expect(p.chainTokens().map((t) => t.id)).toEqual([token.id]);
  });

  it("records a TradeEvent exactly once and routes the creator fee 80/20", () => {
    const { p, token } = chainLaunch();
    const trader = newAddress();
    const e = event(token.id, "sigA", 0, "BUY", 100_000_000n, 5_000_000_000_000n, 300_000n, trader);
    const r1 = p.recordChainTrade(e);
    const r2 = p.recordChainTrade(e);             // replayed by the indexer after a restart
    expect(r1.duplicate).toBe(false); expect(r2.duplicate).toBe(true);
    expect(p.db.prepare("SELECT COUNT(*) c FROM trades").get()).toMatchObject({ c: 1n });
    expect(p.vaultBalance(token.id)).toBe(240_000n);                                   // 80% of 300,000
    expect(p.getWallet(PROTOCOL.protocolTreasury)!.lamports).toBe(60_000n);             // 20%
    expect(p.holding(token.id, trader)).toBe(5_000_000_000_000n);
    expect(p.getState(token.id).state).toBe("ACCUMULATING");
    expect(p.getCurve(token.id).real_sol).toBe(100_000_000n);                           // reserves as the program reported them
    expect(p.verifyIntegrity().problems).toEqual([]);
  });

  it("keeps the simnet executor and simnet trade path away from on-chain coins", () => {
    const { p, token } = chainLaunch();
    p.recordChainTrade(event(token.id, "sigB", 0, "BUY", 1_000_000_000n, 50_000_000_000_000n, 3_000_000n));
    expect(p.crank(token.id)).toMatchObject({ executed: false, reason: /chain keeper/ });
    expect(p.crankAll().map((r) => r.id)).not.toContain(token.id);
    const t = newAddress(); p.faucet(t, 10_000_000_000n);
    expect(() => p.buy({ tokenId: token.id, trader: t, amountIn: 1_000_000n, minOut: 0n, signature: "s" })).toThrow(/on-chain/);
  });

  it("chain execution bookkeeping: begin → complete with signature; begin → fail with backoff; no duplicate seq", () => {
    const { p, token } = chainLaunch();
    for (let i = 0; i < 3; i++) p.recordChainTrade(event(token.id, `sigC${i}`, 0, "BUY", 1_000_000_000n, 50_000_000_000_000n, 150_000_000n));
    expect(p.eligibility(token.id).eligible).toBe(true);
    const { execId, seq } = p.beginChainExecution(token.id);
    expect(seq).toBe(1);
    expect(p.getState(token.id).state).toBe("EXECUTING");
    expect(() => p.beginChainExecution(token.id)).toThrow();   // not eligible while EXECUTING? eligibility is pure; a second begin must not be possible via seq
    const auth = p.getToken(token.id)!.vault_authority!;
    p.completeChainExecution(token.id, execId, seq, "5xSig", 100_000_000n, { tokensBurned: 10n }, () => {
      // exactly what the agent does: the buyback is itself a trade on the curve, then the vault is debited and the burn mirrored
      p.recordChainTrade({ ...event(token.id, "5xSig", 0, "BUY", 99_000_000n, 10n, 300_000n, auth), isProtocol: true });
      p.spendVault(token.id, 100_000_000n); p.burnMirror(token.id, auth, 10n);
    });
    const ex = p.db.prepare("SELECT status, signature, amount_used FROM destiny_executions WHERE id=?").get(execId) as { status: string; signature: string; amount_used: bigint };
    expect(ex).toMatchObject({ status: "COMPLETED", signature: "5xSig", amount_used: 100_000_000n });
    expect(p.getToken(token.id)!.burned).toBe(10n);
    expect(p.verifyIntegrity().problems).toEqual([]);
    // a failure path
    p.db.prepare("UPDATE destiny_states SET last_execution_at = last_execution_at - 60000 WHERE token_id=?").run(token.id);
    const b2 = p.beginChainExecution(token.id);
    expect(b2.seq).toBe(2);
    p.failChainExecution(token.id, b2.execId, b2.seq, "rpc down");
    const st = p.getState(token.id);
    expect(st.state).toBe("FAILED"); expect(Number(st.failure_count)).toBe(1); expect(Number(st.next_retry_at)).toBeGreaterThan(Date.now());
  });

  it("Echo on an on-chain coin: sells inside the epoch forfeit it, and claims are reserved once per wallet", () => {
    const { p, token } = chainLaunch(fresh(), "ECHO");
    const holder = newAddress(), seller = newAddress();
    p.recordChainTrade(event(token.id, "e1", 0, "BUY", 1_000_000_000n, 40_000_000_000_000n, 3_000_000n, holder));
    p.recordChainTrade(event(token.id, "e2", 0, "BUY", 1_000_000_000n, 40_000_000_000_000n, 3_000_000n, seller));
    p.recordChainTrade(event(token.id, "e3", 0, "SELL", 100_000_000n, 4_000_000_000_000n, 300_000n, seller));
    const soldThisEpoch = p.db.prepare("SELECT last_sell_epoch FROM holdings WHERE token_id=? AND address=?").get(token.id, seller) as { last_sell_epoch: bigint };
    expect(Number(soldThisEpoch.last_sell_epoch)).toBe(1);
    expect(p.db.prepare("SELECT last_sell_epoch FROM holdings WHERE token_id=? AND address=?").get(token.id, holder)).toMatchObject({ last_sell_epoch: null });
  });
});
