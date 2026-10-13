import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createBurnInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, canonicalPumpPoolPda, buyQuoteInput, type SwapSolanaState } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { connection, withRetry } from "./rpc";
import { assembleSigned } from "./pump";

/**
 * PumpSwap (pump-amm) adapter for graduated coins, on the official `@pump-fun/pump-swap-sdk`.
 * A pump.fun coin that completes its curve migrates to its canonical PumpSwap pool; the pool's `coinCreator` is the
 * curve's creator, so FATE's per-coin vault authority keeps receiving creator fees there (collected by the same
 * `collectCoinCreatorFeeInstructions`). Every builder here is signed by the vault authority (custodial, see config.ts).
 * Slippage arguments are FATE basis points; the SDK takes percent.
 */

export interface PoolView {
  poolKey: string; lpMint: string; baseReserve: bigint; quoteReserve: bigint; lpSupply: bigint; coinCreator: string; quoteMint: string;
}

/** The canonical PumpSwap pool for a graduated coin, or null while it has not migrated. */
export async function fetchPool(mint: PublicKey): Promise<PoolView | null> {
  const key = canonicalPumpPoolPda(mint);
  const info = await withRetry("getAccountInfo(pool)", () => connection().getAccountInfo(key, "confirmed"));
  if (!info) return null;
  const sdk = new OnlinePumpAmmSdk(connection());
  const st = await withRetry("swapSolanaState", () => sdk.swapSolanaState(key, key));
  return {
    poolKey: key.toBase58(), lpMint: st.pool.lpMint.toBase58(), baseReserve: big(st.poolBaseAmount), quoteReserve: big(st.poolQuoteAmount),
    lpSupply: big(st.pool.lpSupply), coinCreator: st.pool.coinCreator.toBase58(), quoteMint: st.pool.quoteMint.toBase58(),
  };
}

function big(b: BN): bigint { return BigInt(b.toString()); }
const pct = (bps: number) => bps / 100;

/** What a quote-input buy of `lamports` returns on the pool right now (the program's own fee math), and its slippage floor. */
export function quoteBuy(st: SwapSolanaState, lamports: bigint, slippageBps: number): { base: bigint; minBase: bigint; priceImpactBps: number } {
  const r = buyQuoteInput({
    quote: new BN(lamports.toString()), slippage: pct(slippageBps), baseReserve: st.poolBaseAmount, quoteReserve: st.poolQuoteAmount,
    virtualQuoteReserves: st.pool.virtualQuoteReserves, globalConfig: st.globalConfig, baseMintAccount: st.baseMintAccount, baseMint: st.baseMint,
    coinCreator: st.pool.coinCreator, creator: st.pool.creator, feeConfig: st.feeConfig, quoteMint: st.pool.quoteMint, isMayhemMode: st.pool.isMayhemMode,
    creatorFeeBps: st.pool.creatorFeeBps,
  });
  const base = big(r.base);
  const spot = Number(st.poolQuoteAmount.toString()) / Math.max(1, Number(st.poolBaseAmount.toString()));
  const exec = base > 0n ? Number(lamports) / Number(base) : spot;
  return { base, minBase: base - (base * BigInt(slippageBps)) / 10_000n, priceImpactBps: Math.max(0, Math.round((exec / spot - 1) * 10_000)) };
}

async function swapState(mint: PublicKey, user: PublicKey): Promise<SwapSolanaState> {
  const sdk = new OnlinePumpAmmSdk(connection());
  return withRetry("swapSolanaState", () => sdk.swapSolanaState(canonicalPumpPoolPda(mint), user));
}

/** Largest pool buy ≤ budget whose price impact fits the bound (same halving search as the curve). */
export async function boundedPoolBuy(mint: PublicKey, user: PublicKey, budget: bigint, maxSlippageBps: number): Promise<{ lamports: bigint; base: bigint; minBase: bigint }> {
  const st = await swapState(mint, user);
  let amount = budget;
  for (let i = 0; i < 12 && amount >= 10_000_000n; i++) {
    const q = quoteBuy(st, amount, maxSlippageBps);
    if (q.base > 0n && q.priceImpactBps <= maxSlippageBps) return { lamports: amount, base: q.base, minBase: q.minBase };
    amount /= 2n;
  }
  throw new Error(`no pool buy within ${maxSlippageBps} bps slippage bound`);
}

/** Phoenix after graduation: buy on PumpSwap with the vault authority's SOL and burn the guaranteed minimum, in ONE transaction. */
export async function buildPoolBuybackBurnTx(input: { authority: Keypair; mint: PublicKey; lamports: bigint; slippageBps: number }) {
  const st = await swapState(input.mint, input.authority.publicKey);
  const q = quoteBuy(st, input.lamports, input.slippageBps);
  const buy = await PUMP_AMM_SDK.buyQuoteInput(st, new BN(input.lamports.toString()), pct(input.slippageBps));
  const ata = getAssociatedTokenAddressSync(input.mint, input.authority.publicKey, true, st.baseTokenProgram);
  const burn = createBurnInstruction(ata, input.mint, input.authority.publicKey, q.minBase, [], st.baseTokenProgram);
  const built = await assembleSigned(input.authority, [...buy, burn], 400_000);
  return { ...built, expectedTokens: q.base, burnFloor: q.minBase, tokenProgram: st.baseTokenProgram };
}

/** Gravity after graduation, step 1: buy the token half on the pool; tokens stay in the vault authority's ATA. */
export async function buildPoolBuyTx(input: { authority: Keypair; mint: PublicKey; lamports: bigint; slippageBps: number }) {
  const st = await swapState(input.mint, input.authority.publicKey);
  const q = quoteBuy(st, input.lamports, input.slippageBps);
  const ixs = await PUMP_AMM_SDK.buyQuoteInput(st, new BN(input.lamports.toString()), pct(input.slippageBps));
  return { ...(await assembleSigned(input.authority, ixs, 300_000)), expectedTokens: q.base, tokenProgram: st.baseTokenProgram };
}

/**
 * Gravity after graduation, step 2: deposit `base` tokens + the matching SOL into the canonical pool. The SDK computes
 * the LP amount and the SOL required at the pool's current ratio; if the SOL on hand is the binding side, the deposit is
 * sized from the SOL instead. LP tokens land in the vault authority's ATA; FATE has no instruction path that withdraws them.
 */
export async function buildPoolDepositTx(input: { authority: Keypair; mint: PublicKey; maxBase: bigint; maxQuote: bigint; slippageBps: number }) {
  const sdk = new OnlinePumpAmmSdk(connection());
  const key = canonicalPumpPoolPda(input.mint);
  const ls = await withRetry("liquiditySolanaState", () => sdk.liquiditySolanaState(key, input.authority.publicKey));
  const slip = pct(input.slippageBps);
  let fromBase = PUMP_AMM_SDK.depositBaseInput(ls, new BN(input.maxBase.toString()), slip);
  let plan: { lpToken: BN; base: bigint; quote: bigint };
  if (big(fromBase.maxQuote) <= input.maxQuote) plan = { lpToken: fromBase.lpToken, base: input.maxBase, quote: big(fromBase.quote) };
  else {
    const fromQuote = PUMP_AMM_SDK.depositQuoteInput(ls, new BN(input.maxQuote.toString()), slip);
    // the quote side binds: shrink until the slippage-inflated max fits what is on hand
    let q = input.maxQuote, r = fromQuote;
    for (let i = 0; i < 8 && big(r.maxQuote) > input.maxQuote; i++) { q = (q * 97n) / 100n; r = PUMP_AMM_SDK.depositQuoteInput(ls, new BN(q.toString()), slip); }
    if (big(r.maxBase) > input.maxBase) throw new Error("deposit cannot be sized within the vault's base and quote balances");
    plan = { lpToken: r.lpToken, base: big(r.base), quote: q };
    fromBase = { quote: new BN(q.toString()), lpToken: r.lpToken, maxBase: r.maxBase, maxQuote: r.maxQuote };
  }
  if (plan.lpToken.lten(0)) throw new Error("deposit would mint 0 LP tokens");
  const ixs: TransactionInstruction[] = await PUMP_AMM_SDK.depositInstructions(ls, plan.lpToken, slip);
  const built = await assembleSigned(input.authority, ixs, 400_000);
  return { ...built, lpToken: big(plan.lpToken), base: plan.base, quote: plan.quote, lpMint: ls.pool.lpMint, lpAta: ls.userPoolTokenAccount, baseTokenProgram: ls.baseTokenProgram };
}

/** Token balance of an owner's ATA (0 when the account does not exist). */
export async function ataBalance(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  const r = await withRetry("getTokenAccountBalance", () => connection().getTokenAccountBalance(ata, "confirmed")).catch(() => null);
  return r ? BigInt(r.value.amount) : 0n;
}

export { canonicalPumpPoolPda };
