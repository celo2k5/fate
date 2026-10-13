import { describe, it, expect, vi, afterEach } from "vitest";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { fresh } from "./helpers";
import { newAddress } from "@/engine/ids";
import { TxLedger, withRetry, sendAndConfirm, confirmPending, connection } from "@/chain/rpc";
import { vaultAuthority } from "@/chain/config";
import { quoteSolTo } from "@/chain/jupiter";

/**
 * On-chain agent logic that runs without a network: graduation observed from the chain, the PumpSwap venue mirror,
 * the atomic execution claim, and failure injection on the RPC layer (rate limits, dropped / failed / expired
 * transactions, restarts). Live-network behaviour is covered by scripts/devnet-verify.ts and scripts/verify-amm-sim.ts.
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
  return { p, token, mint };
}
const trade = (tokenId: string, sig: string, side: "BUY" | "SELL", sol: bigint, tokens: bigint, creatorFee: bigint, extra: Record<string, unknown> = {}) => ({
  tokenId, signature: sig, slot: 1, blockTime: null, trader: newAddress(), side, solAmount: sol, tokenAmount: tokens, creatorFee, totalFee: creatorFee * 4n,
  virtualSol: 1_000_000_000n + sol, virtualTokens: 1_000_000_000_000_000n, realSol: sol, realTokens: 700_000_000_000_000n, isProtocol: false, ...extra,
});

describe("graduation on-chain", () => {
  it("never runs the simulated graduation for an on-chain coin, however much SOL the mirror sees", () => {
    const { p, token } = chainLaunch();
    p.recordChainTrade(trade(token.id, "big#0", "BUY", 500_000_000_000n, 600_000_000_000_000n, 1_000_000n));
    expect(p.getToken(token.id)!.status).toBe("CURVE");
    expect(p.db.prepare("SELECT COUNT(*) c FROM graduations WHERE token_id=?").get(token.id)).toEqual({ c: 0n });
  });

  it("records the graduation pump.fun did (from the pool account), once, with no FATE-owned LP", () => {
    const { p, token } = chainLaunch();
    const pool = { poolKey: newAddress(), baseReserve: 206_900_000_000_000n, quoteReserve: 79_000_000_000n, lpSupply: 4_000_000_000_000n };
    expect(p.recordChainGraduation(token.id, pool)).toBe(true);
    expect(p.recordChainGraduation(token.id, pool)).toBe(false); // idempotent
    expect(p.getToken(token.id)!.status).toBe("AMM");
    const row = p.db.prepare("SELECT pool_address, lp_locked FROM pools WHERE token_id=?").get(token.id) as { pool_address: string; lp_locked: bigint };
    expect(row).toEqual({ pool_address: pool.poolKey, lp_locked: 0n });
  });

  it("mirrors PumpSwap trades against the pool (not the curve), routes the creator fee, and is replay-safe", () => {
    const { p, token } = chainLaunch();
    const poolKey = newAddress();
    p.recordChainGraduation(token.id, { poolKey, baseReserve: 1_000n, quoteReserve: 1_000n, lpSupply: 1n });
    const curveBefore = p.getCurve(token.id);
    const vault0 = p.vaultBalance(token.id);
    const ev = trade(token.id, "ammsig#amm0", "BUY", 1_000_000_000n, 5_000_000_000n, 3_000_000n, { venue: "AMM", poolAddress: poolKey, realSol: 80_000_000_000n, realTokens: 200_000_000_000_000n });
    expect(p.recordChainTrade(ev).duplicate).toBe(false);
    expect(p.recordChainTrade(ev).duplicate).toBe(true);
    expect(p.getCurve(token.id).virtual_sol).toBe(curveBefore.virtual_sol); // curve untouched
    expect(p.db.prepare("SELECT sol_reserve, token_reserve FROM pools WHERE token_id=?").get(token.id)).toEqual({ sol_reserve: 80_000_000_000n, token_reserve: 200_000_000_000_000n });
    expect(p.vaultBalance(token.id) - vault0).toBe(2_400_000n); // 80% of the 3_000_000 creator fee
    expect((p.db.prepare("SELECT venue FROM trades WHERE signature=?").get("ammsig#amm0") as { venue: string }).venue).toBe("AMM");
    const integ = p.verifyIntegrity();
    expect(integ.problems).toEqual([]);
  });
});

describe("execution claim", () => {
  it("is atomic: a second keeper cannot open an execution while one is open", () => {
    const { p, token } = chainLaunch();
    p.recordChainTrade(trade(token.id, "fee#0", "BUY", 50_000_000_000n, 1_000_000_000_000n, 400_000_000n));
    const first = p.beginChainExecution(token.id);
    expect(() => p.beginChainExecution(token.id)).toThrow(/in progress/i);
    p.failChainExecution(token.id, first.execId, first.seq, "rpc down");
    expect(p.getState(token.id).state).toBe("FAILED");
  });
});

describe("vault authority derivation", () => {
  it("is deterministic per mint, distinct across mints, and refuses a short master seed", () => {
    const prev = process.env.FATE_VAULT_MASTER_SEED;
    process.env.FATE_VAULT_MASTER_SEED = "x".repeat(40);
    const a = newAddress(), b = newAddress();
    expect(vaultAuthority(a).publicKey.toBase58()).toBe(vaultAuthority(a).publicKey.toBase58());
    expect(vaultAuthority(a).publicKey.toBase58()).not.toBe(vaultAuthority(b).publicKey.toBase58());
    process.env.FATE_VAULT_MASTER_SEED = "short";
    expect(() => vaultAuthority(a)).toThrow(/MASTER_SEED/);
    process.env.FATE_VAULT_MASTER_SEED = prev;
  });
});

// ───────────────────────── failure injection on the RPC layer ─────────────────────────
function dummyTx() {
  const kp = Keypair.generate();
  const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);
  return tx;
}
afterEach(() => vi.restoreAllMocks());

describe("RPC failure injection", () => {
  it("withRetry retries 429 / network errors with backoff and gives up on deterministic errors at once", async () => {
    let n = 0;
    const flaky = () => { n++; if (n < 3) throw new Error("429 Too Many Requests"); return Promise.resolve("ok"); };
    await expect(withRetry("flaky", async () => flaky(), 5, 1)).resolves.toBe("ok");
    expect(n).toBe(3);
    let m = 0;
    await expect(withRetry("bad", async () => { m++; throw new Error("custom program error: 0x1771"); }, 5, 1)).rejects.toThrow(/0x1771/);
    expect(m).toBe(1);
    let k = 0;
    await expect(withRetry("down", async () => { k++; throw new Error("fetch failed"); }, 3, 1)).rejects.toThrow(/fetch failed/);
    expect(k).toBe(3); // RPC fully down: bounded attempts, then the error surfaces (the keeper backs off)
  });

  it("marks a transaction that failed on-chain FAILED and one whose blockhash expired EXPIRED (safe to rebuild)", async () => {
    const { p, token } = chainLaunch();
    const L = new TxLedger(p.db);
    vi.spyOn(connection(), "sendRawTransaction").mockResolvedValue("SigFailed111");
    vi.spyOn(connection(), "getSignatureStatuses").mockResolvedValue({ context: { slot: 1 }, value: [{ slot: 9, confirmations: 1, err: { InstructionError: [1, { Custom: 6002 }] }, confirmationStatus: "confirmed" }] } as never);
    vi.spyOn(connection(), "getBlockHeight").mockResolvedValue(100);
    const r1 = L.begin("phoenix_buy_burn", "exec_A", token.id, "bh", 1_000);
    await expect(sendAndConfirm(L, r1, dummyTx())).rejects.toThrow(/failed on-chain/);
    expect(L.get("phoenix_buy_burn", "exec_A")!.status).toBe("FAILED");

    vi.spyOn(connection(), "sendRawTransaction").mockResolvedValue("SigExpired11");
    vi.spyOn(connection(), "getSignatureStatuses").mockResolvedValue({ context: { slot: 1 }, value: [null] } as never);
    vi.spyOn(connection(), "getBlockHeight").mockResolvedValue(2_000); // past last_valid_block_height
    const r2 = L.begin("phoenix_buy_burn", "exec_B", token.id, "bh", 1_000);
    await expect(sendAndConfirm(L, r2, dummyTx())).rejects.toThrow(/expired/);
    expect(L.get("phoenix_buy_burn", "exec_B")!.status).toBe("EXPIRED");
    // a rebuilt retry re-arms the same row (no second row, attempts counted)
    const again = L.begin("phoenix_buy_burn", "exec_B", token.id, "bh2", 3_000);
    expect(again.id).toBe(r2.id);
    expect(again.status).toBe("BUILT");
    expect(again.attempts).toBe(2n);
  });

  it("after a crash, confirmPending settles every SENT transaction from the chain (confirmed / failed / expired / still pending)", async () => {
    const { p, token } = chainLaunch();
    const L = new TxLedger(p.db);
    const rows = ["ok", "bad", "old", "wait"].map((ref, i) => { const r = L.begin("collect_fees", ref, token.id, "bh", ref === "old" ? 50 : 5_000); L.markSent(r.id, `Sig${i}${"1".repeat(40)}`); return r; });
    vi.spyOn(connection(), "getSignatureStatuses").mockResolvedValue({ context: { slot: 1 }, value: [
      { slot: 7, confirmations: null, err: null, confirmationStatus: "finalized" },
      { slot: 7, confirmations: 1, err: { InstructionError: [0, "InvalidAccountData"] }, confirmationStatus: "confirmed" },
      null, null,
    ] } as never);
    vi.spyOn(connection(), "getBlockHeight").mockResolvedValue(100);
    const out = await confirmPending(L);
    expect(out).toEqual({ confirmed: 1, failed: 1, expired: 1, pending: 1 });
    expect(rows.map((r) => p.db.prepare("SELECT status FROM chain_txs WHERE id=?").get(r.id))).toEqual([{ status: "CONFIRMED" }, { status: "FAILED" }, { status: "EXPIRED" }, { status: "SENT" }]);
  });

  it("a replayed keeper tick cannot re-send a CONFIRMED transaction (idempotent by purpose + reference)", () => {
    const { p, token } = chainLaunch();
    const L = new TxLedger(p.db);
    const r = L.begin("echo_payout", "claim_1", token.id, "bh", 10);
    L.markSent(r.id, "SigPaid" + "1".repeat(40));
    L.markConfirmed(r.id, 5);
    const replay = L.begin("echo_payout", "claim_1", token.id, "bh-new", 99);
    expect(replay.status).toBe("CONFIRMED");
    expect(replay.signature).toBe("SigPaid" + "1".repeat(40));
    expect(p.db.prepare("SELECT COUNT(*) c FROM chain_txs WHERE purpose='echo_payout'").get()).toEqual({ c: 1n });
  });
});

describe("Orbit venue bounds", () => {
  it("refuses a Jupiter route whose price impact exceeds the coin's slippage bound, and surfaces API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ inAmount: "100", outAmount: "90", otherAmountThreshold: "89", priceImpactPct: "0.25", routePlan: [] }), { status: 200 }));
    await expect(quoteSolTo("USDC", 100_000_000n, 300)).rejects.toThrow(/exceeds the 300 bps bound/);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Bad Request: no route", { status: 400 }));
    await expect(quoteSolTo("LST", 100_000_000n, 300)).rejects.toThrow(/jupiter 400/);
  });
});

describe("mainnet circuit breaker", () => {
  it("blocks mainnet until opt-in, durable storage and IPFS are all configured; never gates devnet", async () => {
    const { mainnetBlockers } = await import("@/chain/config");
    const env = { ...process.env };
    process.env.FATE_VAULT_MASTER_SEED = "y".repeat(40);
    process.env.FATE_CHAIN = "devnet";
    expect(mainnetBlockers()).toEqual([]);
    process.env.FATE_CHAIN = "mainnet";
    delete process.env.FATE_MAINNET_ENABLED; delete process.env.FATE_DB_PERSISTENT;
    const b = mainnetBlockers();
    expect(b.join(" ")).toMatch(/FATE_MAINNET_ENABLED/);
    expect(b.join(" ")).toMatch(/FATE_DB_PERSISTENT/);
    expect(b.join(" ")).toMatch(/Pinata/);
    process.env = env;
  });
});
