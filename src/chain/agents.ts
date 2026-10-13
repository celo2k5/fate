import { PublicKey } from "@solana/web3.js";
import type { Protocol, TokenRow } from "@/engine/protocol";
import { EngineError, bps } from "@/engine/units";
import { PROTOCOL } from "@/engine/config";
import { log } from "@/lib/log";
import { activeChain, hasChainSecrets, mainnetBlockers, protocolTreasury, vaultAuthority } from "./config";
import { TxLedger, confirmPending, connection, sendAndConfirm, withRetry } from "./rpc";
import * as pump from "./pump";
import * as amm from "./amm";
import * as jup from "./jupiter";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { getMint } from "@solana/spl-token";

/**
 * On-chain destiny agents. Same state machine, tables and guards as the simnet engine
 * (ACCUMULATING → ELIGIBLE → EXECUTING → COMPLETED | FAILED, UNIQUE(token_id, seq), cooldown + backoff),
 * but every input is read from the chain and every effect is a confirmed transaction:
 *
 *   trades   ← pump.fun TradeEvents on the coin's bonding curve (indexed per tick, replay-safe by signature)
 *   vault    ← the coin's creator fee (pump.fun's creator_vault for FATE's per-coin vault authority)
 *   Phoenix  → collect fees → buy on the curve → burn, in one atomic transaction; burn verified from the TradeEvent + mint supply
 *   Phoenix  → after graduation: the same, on the coin's canonical PumpSwap pool (buy + burn in one transaction)
 *   Gravity  → before graduation: collect → buy half → hold in escrow (no sell / withdraw path exists);
 *              after graduation: buy half on PumpSwap, then deposit escrow + new tokens with the paired SOL into the pool;
 *              LP tokens stay with the vault authority (no withdraw path exists in FATE)
 *   Echo     → snapshot holders from token accounts → allocations fixed in reward_epochs → each wallet claims once (SOL transfer)
 *   Orbit    → SOL + RESERVE legs stay in the vault authority's treasury; USDC / JitoSOL legs swap through Jupiter on mainnet,
 *              bounded by the coin's max slippage. Jupiter has no devnet deployment, so on devnet Orbit refuses to execute
 *              (reported as a venue blocker) rather than invent a fill
 *   venue    ← graduation is observed from the chain (curve complete + canonical PumpSwap pool exists), never simulated
 *
 * Trust model: the vault authority is a server-held key derived per coin. This is server-side policy enforcement
 * with an on-chain audit trail (every spend is a signed, recorded transaction), not a trustless program. See README.
 */
const alog = log.child({ component: "chain-agents" });

function ledger(p: Protocol) { return new TxLedger(p.db); }
function pk(s: string) { return new PublicKey(s); }

export async function chainHealth(): Promise<{ ok: boolean; cluster: string; rpc: string; slot?: number; blockHeight?: number; secrets: { keeper: boolean; vaultSeed: boolean }; error?: string }> {
  const secrets = hasChainSecrets();
  try {
    const c = connection();
    const [slot, blockHeight] = await Promise.all([withRetry("getSlot", () => c.getSlot("confirmed"), 2), withRetry("getBlockHeight", () => c.getBlockHeight("confirmed"), 2)]);
    return { ok: true, cluster: activeChain(), rpc: c.rpcEndpoint.replace(/api-key=[^&]+/i, "api-key=•••"), slot, blockHeight, secrets };
  } catch (e) {
    return { ok: false, cluster: activeChain(), rpc: "", secrets, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Index new on-chain trades for one coin (oldest first), mirroring each into the ledger exactly once: curve TradeEvents, and PumpSwap Buy/Sell events once graduated. */
export async function indexToken(p: Protocol, t: TokenRow): Promise<number> {
  const cur = p.db.prepare("SELECT last_signature, pool_last_signature FROM chain_cursor WHERE token_id=?").get(t.id) as { last_signature: string | null; pool_last_signature: string | null } | undefined;
  const upsert = p.db.prepare("INSERT INTO chain_cursor(token_id,last_signature,last_slot,updated_at) VALUES (?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET last_signature=excluded.last_signature, last_slot=excluded.last_slot, updated_at=excluded.updated_at");
  let n = 0;
  const trades = await pump.newTrades(pk(t.mint!), cur?.last_signature ?? null);
  for (const tr of trades) {
    const e = tr.event;
    const trader = e.user.toBase58();
    const r = p.recordChainTrade({
      tokenId: t.id, signature: `${tr.signature}#${tr.index}`, slot: tr.slot, blockTime: tr.blockTime, trader,
      side: e.isBuy ? "BUY" : "SELL", solAmount: BigInt(e.solAmount.toString()), tokenAmount: BigInt(e.tokenAmount.toString()),
      creatorFee: BigInt(e.creatorFee.toString()), totalFee: BigInt(e.fee.toString()) + BigInt(e.creatorFee.toString()),
      virtualSol: BigInt(e.virtualSolReserves.toString()), virtualTokens: BigInt(e.virtualTokenReserves.toString()),
      realSol: BigInt(e.realSolReserves.toString()), realTokens: BigInt(e.realTokenReserves.toString()),
      isProtocol: trader === t.vault_authority,
    });
    if (!r.duplicate) n++;
    upsert.run(t.id, tr.signature, tr.slot, Date.now());
  }
  if (t.status === "AMM") {
    const pool = amm.canonicalPumpPoolPda(pk(t.mint!)).toBase58();
    const ptrades = await pump.newPoolTrades(pk(t.mint!), cur?.pool_last_signature ?? null);
    for (const tr of ptrades) {
      const r = p.recordChainTrade({
        tokenId: t.id, signature: `${tr.signature}#amm${tr.index}`, slot: tr.slot, blockTime: tr.blockTime, trader: tr.user, side: tr.side,
        solAmount: tr.sol, tokenAmount: tr.tokens, creatorFee: tr.creatorFee, totalFee: tr.totalFee,
        virtualSol: tr.poolQuote, virtualTokens: tr.poolBase, realSol: tr.poolQuote, realTokens: tr.poolBase,
        isProtocol: tr.user === t.vault_authority, venue: "AMM", poolAddress: pool,
      });
      if (!r.duplicate) n++;
      p.db.prepare("INSERT INTO chain_cursor(token_id,pool_last_signature,last_slot,updated_at) VALUES (?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET pool_last_signature=excluded.pool_last_signature, updated_at=excluded.updated_at").run(t.id, tr.signature, tr.slot, Date.now());
    }
  }
  return n;
}

/** Observe graduation from the chain: curve complete + canonical PumpSwap pool exists → status AMM. Returns why the coin cannot trade, if it cannot. */
export async function syncVenue(p: Protocol, t: TokenRow): Promise<{ status: string; blocked?: string }> {
  if (t.status === "AMM") return { status: "AMM" };
  const cv = await pump.fetchCurve(pk(t.mint!));
  if (!cv.complete) return { status: "CURVE" };
  const pool = await amm.fetchPool(pk(t.mint!));
  if (!pool) return { status: "CURVE", blocked: "bonding curve complete; waiting for pump.fun to migrate the coin to PumpSwap" };
  if (p.recordChainGraduation(t.id, { poolKey: pool.poolKey, baseReserve: pool.baseReserve, quoteReserve: pool.quoteReserve, lpSupply: pool.lpSupply })) {
    alog.info("graduated", { token: t.ticker, pool: pool.poolKey });
  }
  return { status: "AMM" };
}

const RENT_HEADROOM = 5_000_000n; // lamports kept in the vault authority for rent and transaction fees

/** What the agent may spend: the smaller of what the ledger says the destiny owns and what the chain says the authority holds. */
async function spendable(p: Protocol, t: TokenRow, authority: PublicKey) {
  const onChain = BigInt(await withRetry("getBalance", () => connection().getBalance(authority, "confirmed")));
  const mirror = p.vaultBalance(t.id);
  const available = (onChain < mirror ? onChain : mirror) - RENT_HEADROOM;
  return { onChain, mirror, available: available > 0n ? available : 0n };
}

/**
 * Collect the coin's accrued creator fees into the vault authority wallet. After graduation, PumpSwap v2 trades hold the
 * creator's cut in the pool's bucket until `sweep_creator_fee` moves it to the coin creator vault, so the sweep runs first
 * (dropped if the program rejects it, e.g. an older pool with nothing to sweep). Idempotent per (coin, accrued amount).
 */
async function collectFees(p: Protocol, t: TokenRow, execId: string): Promise<bigint> {
  const auth = vaultAuthority(t.mint!);
  let ixs = await pump.collectFeesIxs(auth.publicKey);
  if (t.status === "AMM") {
    try {
      const pool = await amm.fetchPool(pk(t.mint!));
      if (!pool) throw new Error("no pool");
      const sweep = await PUMP_SDK.sweepPoolCreatorFeeInstruction({ payer: auth.publicKey, mint: pk(t.mint!), coinCreator: pk(pool.coinCreator), quoteMint: pk(pool.quoteMint) });
      const trial = await pump.assembleSigned(auth, [sweep, ...ixs]);
      const sim = await connection().simulateTransaction(trial.tx, { sigVerify: false, replaceRecentBlockhash: true });
      if (!sim.value.err) ixs = [sweep, ...ixs];
    } catch { /* no sweep available for this pool */ }
  }
  const accrued = await pump.creatorVaultBalance(auth.publicKey);
  if (accrued <= 0n && t.status !== "AMM") return 0n;
  if (!ixs.length) return 0n;
  const built = await pump.assembleSigned(auth, ixs);
  const L = ledger(p);
  const rec = L.begin("collect_fees", execId, t.id, built.blockhash, built.lastValidBlockHeight, accrued);
  if (rec.status === "CONFIRMED") return accrued;
  await sendAndConfirm(L, rec, built.tx);
  alog.info("fees.collected", { token: t.ticker, lamports: accrued, venue: t.status });
  return accrued;
}

/** Largest buy ≤ budget whose price impact fits the coin's slippage bound (same halving search as the simnet). */
async function boundedBuy(mint: PublicKey, budget: bigint, maxSlippageBps: number) {
  let amount = budget;
  for (let i = 0; i < 12; i++) {
    const q = await pump.quote(mint, "BUY", amount, maxSlippageBps);
    if (q.amountOut > 0n && q.priceImpactBps <= maxSlippageBps) return { amount, quote: q };
    amount /= 2n;
    if (amount < 10_000_000n) break; // 0.01 SOL floor
  }
  throw new EngineError("SLIPPAGE", `no buy size within ${maxSlippageBps} bps slippage bound`);
}

async function supply(mint: PublicKey, tokenProgram: PublicKey): Promise<bigint> {
  return (await withRetry("getMint", () => getMint(connection(), mint, "confirmed", tokenProgram))).supply;
}

async function executePhoenix(p: Protocol, t: TokenRow, execId: string, seq: number) {
  const cfg = p.getConfig(t.id);
  const params = JSON.parse(cfg.params_json) as { buybackShareBps?: number };
  const auth = vaultAuthority(t.mint!);
  const mint = pk(t.mint!);
  const slip = Number(cfg.max_slippage_bps);
  await collectFees(p, t, execId);
  const { onChain, mirror, available } = await spendable(p, t, auth.publicKey);
  const budget = bps(available, params.buybackShareBps ?? 10_000);
  if (budget <= 0n) throw new EngineError("INSUFFICIENT_FUNDS", `vault authority holds ${onChain} lamports on-chain (ledger ${mirror}); nothing spendable`);
  const L = ledger(p);

  if (t.status === "AMM") {
    // graduated: buy on the canonical PumpSwap pool and burn the guaranteed minimum, atomically; verified by balances + mint supply
    const { lamports } = await amm.boundedPoolBuy(mint, auth.publicKey, budget, slip);
    const built = await amm.buildPoolBuybackBurnTx({ authority: auth, mint, lamports, slippageBps: slip });
    const supplyBefore = await supply(mint, built.tokenProgram);
    const solBefore = BigInt(await connection().getBalance(auth.publicKey, "confirmed"));
    const ataBefore = await amm.ataBalance(mint, auth.publicKey, built.tokenProgram);
    const rec = L.begin("phoenix_pool_buy_burn", execId, t.id, built.blockhash, built.lastValidBlockHeight, lamports);
    const { signature, slot } = await sendAndConfirm(L, rec, built.tx);
    const burned = supplyBefore - (await supply(mint, built.tokenProgram));
    if (burned !== built.burnFloor) throw new EngineError("UNVERIFIED", `pool buyback ${signature}: mint supply fell by ${burned}, expected ${built.burnFloor}`);
    const kept = (await amm.ataBalance(mint, auth.publicKey, built.tokenProgram)) - ataBefore; // dust above the floor, burned next cycle
    const spent = solBefore - BigInt(await connection().getBalance(auth.publicKey, "confirmed"));
    p.completeChainExecution(t.id, execId, seq, signature, spent, { tokensBought: burned + kept, tokensBurned: burned, signature, slot, venue: "AMM" }, () => {
      p.spendVault(t.id, spent);
      p.burnMirror(t.id, auth.publicKey.toBase58(), burned);
    });
    return;
  }

  const { amount } = await boundedBuy(mint, budget, slip);
  const built = await pump.buildBuybackBurnTx({ authority: auth, mint, lamports: amount, slippageBps: slip });
  const rec = L.begin("phoenix_buy_burn", execId, t.id, built.blockhash, built.lastValidBlockHeight, amount);
  const { signature, slot } = await sendAndConfirm(L, rec, built.tx);
  // verify from the chain: the TradeEvent this transaction emitted is the truth about what was bought
  const tx = await pump.getTx(signature);
  const ev = tx ? pump.decodeEvents(tx).trades.find((e) => e.mint.equals(mint)) : undefined;
  if (!ev) throw new EngineError("UNVERIFIED", `buyback ${signature} confirmed but no TradeEvent decoded; not recorded as executed`);
  const bought = BigInt(ev.tokenAmount.toString());
  const burned = built.burnFloor < bought ? built.burnFloor : bought;
  const spent = BigInt(ev.solAmount.toString()) + BigInt(ev.fee.toString()) + BigInt(ev.creatorFee.toString());
  p.completeChainExecution(t.id, execId, seq, signature, spent, { tokensBought: bought, tokensBurned: burned, priceImpactBps: 0, signature, slot, venue: "CURVE" }, () => {
    // the buy itself is also a trade on the curve: mirror it (fees it paid flow back to the vault like any trade)
    p.recordChainTrade({ tokenId: t.id, signature: `${signature}#0`, slot, blockTime: tx?.blockTime ?? null, trader: auth.publicKey.toBase58(), side: "BUY", solAmount: BigInt(ev.solAmount.toString()), tokenAmount: bought, creatorFee: BigInt(ev.creatorFee.toString()), totalFee: BigInt(ev.fee.toString()) + BigInt(ev.creatorFee.toString()), virtualSol: BigInt(ev.virtualSolReserves.toString()), virtualTokens: BigInt(ev.virtualTokenReserves.toString()), realSol: BigInt(ev.realSolReserves.toString()), realTokens: BigInt(ev.realTokenReserves.toString()), isProtocol: true });
    p.spendVault(t.id, spent);
    p.burnMirror(t.id, auth.publicKey.toBase58(), burned);
    p.db.prepare("INSERT INTO chain_cursor(token_id,last_signature,last_slot,updated_at) VALUES (?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET last_signature=excluded.last_signature, last_slot=excluded.last_slot, updated_at=excluded.updated_at").run(t.id, signature, slot, Date.now());
  });
}

async function executeGravity(p: Protocol, t: TokenRow, execId: string, seq: number) {
  const cfg = p.getConfig(t.id);
  const auth = vaultAuthority(t.mint!);
  const mint = pk(t.mint!);
  const slip = Number(cfg.max_slippage_bps);
  await collectFees(p, t, execId);
  const { available: total } = await spendable(p, t, auth.publicKey);
  if (total <= 0n) throw new EngineError("INSUFFICIENT_FUNDS", "nothing spendable in the vault authority");
  const half = total / 2n;
  const L = ledger(p);

  if (t.status === "AMM") {
    // graduated: (1) buy the token half on PumpSwap, (2) deposit every token the authority holds (escrow + this buy) with the
    // paired SOL (escrowed SOL + the other half) into the canonical pool. Two transactions, each idempotent per execution.
    const escrow = p.db.prepare("SELECT COALESCE(SUM(sol_amount),0) sol FROM locked_liquidity WHERE token_id=? AND stage='ESCROW'").get(t.id) as { sol: bigint };
    const solBefore = BigInt(await connection().getBalance(auth.publicKey, "confirmed"));
    const { lamports } = await amm.boundedPoolBuy(mint, auth.publicKey, half, slip);
    const buy = await amm.buildPoolBuyTx({ authority: auth, mint, lamports, slippageBps: slip });
    const r1 = L.begin("gravity_pool_buy", execId, t.id, buy.blockhash, buy.lastValidBlockHeight, lamports);
    if (r1.status !== "CONFIRMED") await sendAndConfirm(L, r1, buy.tx);
    const buySpent = solBefore - BigInt(await connection().getBalance(auth.publicKey, "confirmed"));
    const baseHeld = await amm.ataBalance(mint, auth.publicKey, buy.tokenProgram);
    const solAfterBuy = BigInt(await connection().getBalance(auth.publicKey, "confirmed"));
    const pairBudget = escrow.sol + (total - half);
    const maxQuote = (pairBudget < solAfterBuy - RENT_HEADROOM ? pairBudget : solAfterBuy - RENT_HEADROOM);
    if (baseHeld <= 0n || maxQuote <= 0n) throw new EngineError("INSUFFICIENT_FUNDS", `nothing to deposit (tokens ${baseHeld}, SOL ${maxQuote})`);
    const dep = await amm.buildPoolDepositTx({ authority: auth, mint, maxBase: baseHeld, maxQuote, slippageBps: slip });
    const lpBefore = await connection().getTokenAccountBalance(dep.lpAta, "confirmed").then((b) => BigInt(b.value.amount)).catch(() => 0n);
    const r2 = L.begin("gravity_pool_deposit", execId, t.id, dep.blockhash, dep.lastValidBlockHeight, dep.quote);
    const { signature, slot } = await sendAndConfirm(L, r2, dep.tx);
    const lp = (await connection().getTokenAccountBalance(dep.lpAta, "confirmed").then((b) => BigInt(b.value.amount))) - lpBefore;
    if (lp <= 0n) throw new EngineError("UNVERIFIED", `deposit ${signature} confirmed but the vault's LP balance did not increase`);
    const solUsed = solAfterBuy - BigInt(await connection().getBalance(auth.publicKey, "confirmed"));
    const fromVault = solUsed > escrow.sol ? solUsed - escrow.sol : 0n;
    const escrowLeft = escrow.sol > solUsed ? escrow.sol - solUsed : 0n;
    p.completeChainExecution(t.id, execId, seq, signature, buySpent + fromVault, { stage: "POOL", lpTokens: lp, tokensDeposited: dep.base, solDeposited: solUsed, signature, slot, venue: "AMM" }, () => {
      p.spendVault(t.id, buySpent + fromVault);
      if (escrowLeft > 0n) p.db.prepare("UPDATE wallets SET lamports = lamports + ? WHERE address=?").run(escrowLeft, `vault:${t.id}`); // unpaired escrow SOL returns to the vault
      p.db.prepare("UPDATE locked_liquidity SET stage='POOL' WHERE token_id=? AND stage='ESCROW'").run(t.id);
      p.db.prepare("INSERT INTO locked_liquidity(id,token_id,sol_amount,token_amount,lp_amount,stage,execution_id,created_at) VALUES (?,?,?,?,?,'POOL',?,?)").run(`ll_${execId}`, t.id, solUsed, dep.base, lp, execId, Date.now());
      p.db.prepare("UPDATE pools SET lp_locked = lp_locked + ? WHERE token_id=?").run(lp, t.id);
      p.db.prepare("UPDATE destiny_states SET total_liquidity_added = total_liquidity_added + ? WHERE token_id=?").run(solUsed, t.id);
    });
    return;
  }

  const { amount } = await boundedBuy(mint, half, slip);
  const built = await pump.buildEscrowBuyTx({ authority: auth, mint, lamports: amount, slippageBps: slip });
  const rec = L.begin("gravity_escrow_buy", execId, t.id, built.blockhash, built.lastValidBlockHeight, amount);
  const { signature, slot } = await sendAndConfirm(L, rec, built.tx);
  const tx = await pump.getTx(signature);
  const ev = tx ? pump.decodeEvents(tx).trades.find((e) => e.mint.equals(mint)) : undefined;
  if (!ev) throw new EngineError("UNVERIFIED", `escrow buy ${signature} confirmed but no TradeEvent decoded`);
  const bought = BigInt(ev.tokenAmount.toString());
  const spent = BigInt(ev.solAmount.toString()) + BigInt(ev.fee.toString()) + BigInt(ev.creatorFee.toString());
  p.completeChainExecution(t.id, execId, seq, signature, spent, { stage: "ESCROW", tokensBought: bought, solPaired: amount, signature, slot }, () => {
    p.recordChainTrade({ tokenId: t.id, signature: `${signature}#0`, slot, blockTime: tx?.blockTime ?? null, trader: auth.publicKey.toBase58(), side: "BUY", solAmount: BigInt(ev.solAmount.toString()), tokenAmount: bought, creatorFee: BigInt(ev.creatorFee.toString()), totalFee: BigInt(ev.fee.toString()) + BigInt(ev.creatorFee.toString()), virtualSol: BigInt(ev.virtualSolReserves.toString()), virtualTokens: BigInt(ev.virtualTokenReserves.toString()), realSol: BigInt(ev.realSolReserves.toString()), realTokens: BigInt(ev.realTokenReserves.toString()), isProtocol: true });
    p.spendVault(t.id, spent + amount); // the SOL half that pairs with the position stays reserved in the authority wallet
    p.db.prepare("INSERT INTO locked_liquidity(id,token_id,sol_amount,token_amount,lp_amount,stage,execution_id,created_at) VALUES (?,?,?,?,0,'ESCROW',?,?)").run(`ll_${execId}`, t.id, amount, bought, execId, Date.now());
    p.db.prepare("UPDATE destiny_states SET total_liquidity_added = total_liquidity_added + ? WHERE token_id=?").run(amount, t.id);
    p.db.prepare("INSERT INTO chain_cursor(token_id,last_signature,last_slot,updated_at) VALUES (?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET last_signature=excluded.last_signature, last_slot=excluded.last_slot, updated_at=excluded.updated_at").run(t.id, signature, slot, Date.now());
  });
}

async function executeEcho(p: Protocol, t: TokenRow, execId: string, seq: number) {
  const cfg = p.getConfig(t.id);
  const params = JSON.parse(cfg.params_json) as { minBalance: string };
  const auth = vaultAuthority(t.mint!);
  await collectFees(p, t, execId);
  const cv = await pump.fetchCurve(pk(t.mint!));
  // protocol-owned balances never earn: the bonding curve, the PumpSwap pool, the vault authority itself
  const exclude = [pk(cv.bondingCurve), amm.canonicalPumpPoolPda(pk(t.mint!)), auth.publicKey];
  const all = await pump.holders(pk(t.mint!), cv.tokenProgram, exclude);
  const epoch = Number(p.getState(t.id).executions) + 1;
  const minBalance = BigInt(params.minBalance);
  const sold = new Set((p.db.prepare("SELECT address FROM holdings WHERE token_id=? AND last_sell_epoch=?").all(t.id, epoch) as { address: string }[]).map((r) => r.address));
  const eligible = all.filter((h) => h.amount >= minBalance && !sold.has(h.owner));
  if (!eligible.length) throw new EngineError("NO_HOLDERS", "no eligible holders in this epoch");
  const { available: funded } = await spendable(p, t, auth.publicKey);
  if (funded <= 0n) throw new EngineError("INSUFFICIENT_FUNDS", "nothing spendable in the vault authority");
  const supply = eligible.reduce((a, h) => a + h.amount, 0n);
  const snapshot = eligible.map((h) => [h.owner, h.amount.toString(), ((funded * h.amount) / supply).toString()]);
  const epochId = `epoch_${execId}`;
  // settlement is a ledger event (allocations fixed); payouts happen when each wallet claims (one SOL transfer, once)
  p.completeChainExecution(t.id, execId, seq, "ledger", funded, { epochId, epoch, funded, eligibleWallets: eligible.length }, () => {
    p.db.prepare("INSERT INTO reward_epochs(id,token_id,epoch,funded,eligible_wallets,eligible_supply,min_balance,claimed,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,0,?,?)").run(epochId, t.id, epoch, funded, eligible.length, supply, minBalance, JSON.stringify(snapshot), Date.now());
    p.spendVault(t.id, funded);
    p.creditHolding(t.id, `rewards:${t.id}`, 0n);
    p.db.prepare("UPDATE wallets SET lamports = lamports + ? WHERE address=?").run(funded, `rewards:${t.id}`);
    p.db.prepare("UPDATE destiny_states SET total_rewards_distributed = total_rewards_distributed + ? WHERE token_id=?").run(funded, t.id);
  });
}

/** Pay a settled Echo claim on-chain (called from the claim route after the ledger reserved it). */
export async function payClaim(p: Protocol, tokenId: string, claimId: string, to: string, lamports: bigint): Promise<string> {
  const blockers = mainnetBlockers();
  if (blockers.length) throw new EngineError("MAINNET_DISABLED", `payouts are disabled: ${blockers.join("; ")}`);
  const t = p.getToken(tokenId)!;
  const auth = vaultAuthority(t.mint!);
  const built = await pump.buildTransfersTx(auth, [{ to: pk(to), lamports }]);
  const L = ledger(p);
  const rec = L.begin("echo_payout", claimId, tokenId, built.blockhash, built.lastValidBlockHeight);
  if (rec.status === "CONFIRMED" && rec.signature) return rec.signature;
  const { signature } = await sendAndConfirm(L, rec, built.tx);
  return signature;
}

/**
 * Orbit: split the spendable vault by the coin's immutable allocation. SOL and RESERVE legs stay as SOL in the vault
 * authority's treasury (recorded); USDC and LST legs swap through Jupiter (mainnet only) inside the slippage bound. Each
 * leg settles on its own as soon as its transaction confirms, so a failure mid-cycle never double-spends: the next cycle
 * works from what the vault has left.
 */
async function executeOrbit(p: Protocol, t: TokenRow, execId: string, seq: number) {
  if (activeChain() !== "mainnet") throw new EngineError("VENUE_UNAVAILABLE", "Orbit's USDC / LST legs need Jupiter, which has no devnet deployment; Orbit executes on mainnet only");
  const cfg = p.getConfig(t.id);
  const params = JSON.parse(cfg.params_json) as { allocationBps?: Record<"SOL" | "USDC" | "LST" | "RESERVE", number> };
  const alloc = params.allocationBps ?? PROTOCOL.orbit.allocationBps;
  const auth = vaultAuthority(t.mint!);
  const slip = Number(cfg.max_slippage_bps);
  await collectFees(p, t, execId);
  const { available } = await spendable(p, t, auth.publicKey);
  if (available <= 0n) throw new EngineError("INSUFFICIENT_FUNDS", "nothing spendable in the vault authority");
  const L = ledger(p);
  const fills: Record<string, { lamportsIn: string; amountOut: string; signature?: string }> = {};
  let used = 0n;
  for (const asset of ["USDC", "LST"] as const) {
    const slice = bps(available, alloc[asset]);
    if (slice < 10_000_000n) continue;
    const q = await jup.quoteSolTo(asset, slice, slip);
    const tx = jup.signSwap(await jup.buildSwapTx(q, auth.publicKey), auth);
    const before = await jup.tokenHoldings(auth.publicKey, jup.ORBIT_MINTS[asset]);
    const { blockhash } = { blockhash: tx.message.recentBlockhash };
    const lastValid = (await connection().getLatestBlockhash("confirmed")).lastValidBlockHeight;
    const rec = L.begin(`orbit_swap_${asset.toLowerCase()}`, execId, t.id, blockhash, lastValid, slice);
    const { signature } = await sendAndConfirm(L, rec, tx);
    const out = (await jup.tokenHoldings(auth.publicKey, jup.ORBIT_MINTS[asset])) - before;
    if (out < BigInt(q.otherAmountThreshold)) throw new EngineError("UNVERIFIED", `${asset} swap ${signature} delivered ${out}, below the bound ${q.otherAmountThreshold}`);
    p.db.transaction(() => {
      p.spendVault(t.id, slice);
      p.db.prepare("UPDATE treasury_assets SET amount = amount + ?, cost_basis_lamports = cost_basis_lamports + ? WHERE token_id=? AND asset=?").run(out, slice, t.id, asset);
    })();
    fills[asset] = { lamportsIn: slice.toString(), amountOut: out.toString(), signature };
    used += slice;
  }
  // SOL and RESERVE legs: no swap; the lamports stay with the treasury authority and are recorded as treasury SOL
  const solLeg = bps(available, alloc.SOL), reserveLeg = bps(available, alloc.RESERVE);
  p.completeChainExecution(t.id, execId, seq, fills.USDC?.signature ?? fills.LST?.signature ?? "ledger", used + solLeg + reserveLeg, { fills, solLeg, reserveLeg, venue: "JUPITER" }, () => {
    p.spendVault(t.id, solLeg + reserveLeg);
    p.db.prepare("UPDATE treasury_assets SET amount = amount + ?, cost_basis_lamports = cost_basis_lamports + ? WHERE token_id=? AND asset='SOL'").run(solLeg, solLeg, t.id);
    p.db.prepare("UPDATE treasury_assets SET amount = amount + ?, cost_basis_lamports = cost_basis_lamports + ? WHERE token_id=? AND asset='RESERVE'").run(reserveLeg, reserveLeg, t.id);
    p.db.prepare("UPDATE destiny_states SET total_treasury_deployed = total_treasury_deployed + ? WHERE token_id=?").run(used + solLeg + reserveLeg, t.id);
  });
}

/** Forward FATE's governed share of collected fees to the protocol treasury (real transfer, recorded). */
async function sweepProtocolShare(p: Protocol, t: TokenRow) {
  if (mainnetBlockers().length) return;
  const treasury = protocolTreasury();
  if (!treasury) return;
  const owed = (p.db.prepare("SELECT COALESCE(SUM(protocol_fee),0) s FROM fee_events WHERE token_id=?").get(t.id) as { s: bigint }).s;
  const paid = (p.db.prepare("SELECT COALESCE(SUM(lamports),0) s FROM chain_txs WHERE token_id=? AND purpose='protocol_share' AND status='CONFIRMED'").get(t.id) as { s: bigint }).s;
  const due = owed - paid;
  if (due < 10_000_000n) return; // batch small amounts
  const auth = vaultAuthority(t.mint!);
  const built = await pump.buildTransfersTx(auth, [{ to: treasury, lamports: due }]);
  const L = ledger(p);
  const ref = `${t.id}:${owed}`;
  const rec = L.begin("protocol_share", ref, t.id, built.blockhash, built.lastValidBlockHeight, due);
  if (rec.status === "CONFIRMED") return;
  const { signature } = await sendAndConfirm(L, rec, built.tx);
  p.db.prepare("UPDATE wallets SET lamports = lamports - ? WHERE address=?").run(due, PROTOCOL.protocolTreasury);
  alog.info("protocol_share.paid", { token: t.ticker, lamports: due, signature });
}

/** Crank one on-chain coin. */
export async function chainCrank(p: Protocol, t0: TokenRow): Promise<{ executed: boolean; reason?: string; executionId?: string }> {
  let t = t0;
  if (p.isPaused()) return { executed: false, reason: "executions paused by operator" };
  const st = p.getState(t.id);
  if (st.state === "EXECUTING") {
    if (Number(st.updated_at) + 180_000 > Date.now()) return { executed: false, reason: "execution in progress" };
    // a crash mid-execution: settle the open row by what the chain says (confirmPending did that), then mark failed/retryable
    const open = p.db.prepare("SELECT id, seq FROM destiny_executions WHERE token_id=? AND status='EXECUTING'").get(t.id) as { id: string; seq: bigint } | undefined;
    if (open) p.failChainExecution(t.id, open.id, Number(open.seq), "stale execution recovered after restart");
  }
  const el = p.eligibility(t.id);
  if (!el.eligible) {
    const next = el.vault === 0n && st.lifetime_fees === 0n ? "IDLE" : st.state === "FAILED" ? "FAILED" : "ACCUMULATING";
    if (next !== st.state && st.state !== "FAILED") p.db.prepare("UPDATE destiny_states SET state=?, updated_at=? WHERE token_id=?").run(next, Date.now(), t.id);
    return { executed: false, reason: el.reason };
  }
  if (!hasChainSecrets().vaultSeed) return { executed: false, reason: "FATE_VAULT_MASTER_SEED not configured; cannot sign vault transactions" };
  const blockers = mainnetBlockers();
  if (blockers.length) return { executed: false, reason: `mainnet agent spending disabled: ${blockers.join("; ")}` };
  const venue = await syncVenue(p, t);
  if (venue.blocked) return { executed: false, reason: venue.blocked };
  t = p.getToken(t.id)!; // status may have changed to AMM
  const { execId, seq } = p.beginChainExecution(t.id);
  try {
    if (t.destiny === "PHOENIX") await executePhoenix(p, t, execId, seq);
    else if (t.destiny === "GRAVITY") await executeGravity(p, t, execId, seq);
    else if (t.destiny === "ECHO") await executeEcho(p, t, execId, seq);
    else await executeOrbit(p, t, execId, seq);
    return { executed: true, executionId: execId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.failChainExecution(t.id, execId, seq, msg);
    alog.warn("execution.failed", { token: t.ticker, destiny: t.destiny, execId, error: msg });
    return { executed: false, executionId: execId, reason: msg };
  }
}

/** One chain keeper tick: settle pending transactions, index trades, crank every on-chain coin. */
export async function chainTick(p: Protocol, tick: number): Promise<Record<string, unknown>> {
  const L = ledger(p);
  const settled = await confirmPending(L);
  const tokens = p.chainTokens();
  let indexed = 0, executed = 0, failed = 0;
  for (const t of tokens) {
    try {
      await syncVenue(p, t).catch((e) => alog.warn("venue.sync.failed", { token: t.ticker, error: e }));
      const fresh = p.getToken(t.id)!;
      indexed += await indexToken(p, fresh);
      const r = await chainCrank(p, fresh);
      if (r.executed) executed++; else if (r.executionId) failed++;
      if (tick % 15 === 0) await sweepProtocolShare(p, t).catch((e) => alog.warn("protocol_share.failed", { token: t.ticker, error: e }));
    } catch (e) {
      alog.error("token.tick.error", { token: t.ticker, error: e });
    }
  }
  return { tokens: tokens.length, indexed, executed, failed, settled };
}

export { PROTOCOL };
