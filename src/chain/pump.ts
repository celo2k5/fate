import {
  ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
  type TransactionInstruction, type VersionedTransactionResponse,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  OnlinePumpSdk, PUMP_SDK, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, bondingCurvePda, creatorVaultPda, pumpIdl, getPumpAmmProgram, canonicalPumpPoolPda,
  getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount,
  type Global, type FeeConfig, type BondingCurve, type TradeEventBc, type CreateEventBc, type BuyEventAmm, type SellEventAmm,
} from "@pump-fun/pump-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import { connection, withRetry } from "./rpc";

/**
 * Pump.fun adapter, built on the official `@pump-fun/pump-sdk` (the published spec of the on-chain program).
 * Everything that costs money is built as an unsigned/partially-signed transaction for the *user's wallet* to sign;
 * the server never holds or spends a user's funds. Keeper-side work (fee collection, buyback, burn, payouts) is
 * signed by the per-coin vault authority (see config.ts) and is custodial by design — disclosed in README.
 */
const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const EVENT_CPI_TAG = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]); // anchor `emit_cpi` instruction tag
const EVENT_NAMES = new Map<string, string>(pumpIdl.events.map((e) => [Buffer.from(e.discriminator).toString("hex"), e.name]));
let AMM_EVENT_NAMES: Map<string, string> | null = null;
function ammEventNames(): Map<string, string> {
  // the pump-amm IDL ships inside the SDK; the Program object is only used to read it (no RPC)
  AMM_EVENT_NAMES ??= new Map<string, string>((getPumpAmmProgram(connection()).idl.events ?? []).map((e: { discriminator: number[]; name: string }) => [Buffer.from(e.discriminator).toString("hex"), e.name]));
  return AMM_EVENT_NAMES;
}

let cache: { at: number; global: Global; feeConfig: FeeConfig | null } | null = null;

export async function pumpState(): Promise<{ global: Global; feeConfig: FeeConfig | null }> {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const sdk = new OnlinePumpSdk(connection());
  const global = await withRetry("fetchGlobal", () => sdk.fetchGlobal());
  const feeConfig = await withRetry("fetchFeeConfig", () => sdk.fetchFeeConfig()).catch(() => null);
  cache = { at: Date.now(), global, feeConfig };
  return cache;
}

export interface CurveView {
  mint: string; bondingCurve: string; creator: string; tokenProgram: PublicKey; complete: boolean;
  virtualSol: bigint; virtualTokens: bigint; realSol: bigint; realTokens: bigint; totalSupply: bigint; raw: BondingCurve;
}

export async function fetchCurve(mint: PublicKey): Promise<CurveView> {
  const c = connection();
  const [curveInfo, mintInfo] = await withRetry("getMultipleAccountsInfo", () => c.getMultipleAccountsInfo([bondingCurvePda(mint), mint]));
  if (!curveInfo) throw new Error(`bonding curve not found for ${mint.toBase58()}`);
  const bc = PUMP_SDK.decodeBondingCurve(curveInfo);
  const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const big = (b: BN) => BigInt(b.toString());
  return {
    mint: mint.toBase58(), bondingCurve: bondingCurvePda(mint).toBase58(), creator: bc.creator.toBase58(), tokenProgram, complete: bc.complete,
    virtualSol: big(bc.virtualQuoteReserves), virtualTokens: big(bc.virtualTokenReserves), realSol: big(bc.realQuoteReserves), realTokens: big(bc.realTokenReserves), totalSupply: big(bc.tokenTotalSupply), raw: bc,
  };
}

/** Quote against the live curve with the program's own math (fees included), plus FATE's min-out for the slippage bound. */
export async function quote(mint: PublicKey, side: "BUY" | "SELL", amountIn: bigint, slippageBps: number) {
  const { global, feeConfig } = await pumpState();
  const cv = await fetchCurve(mint);
  const amount = new BN(amountIn.toString());
  if (side === "BUY") {
    const tokensOut = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: cv.raw.tokenTotalSupply, bondingCurve: cv.raw, amount, quoteMint: NATIVE_MINT });
    const out = BigInt(tokensOut.toString());
    const spot = Number(cv.virtualSol) / Number(cv.virtualTokens);
    const exec = out > 0n ? Number(amountIn) / Number(out) : spot;
    return { amountIn, amountOut: out, minOut: out - (out * BigInt(slippageBps)) / 10_000n, priceLamportsPerUnit: exec, priceImpactBps: Math.max(0, Math.round((exec / spot - 1) * 10_000)), venue: cv.complete ? "AMM" : "CURVE", curve: cv };
  }
  const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: cv.raw.tokenTotalSupply, bondingCurve: cv.raw, amount });
  const out = BigInt(solOut.toString());
  const spot = Number(cv.virtualSol) / Number(cv.virtualTokens);
  const exec = Number(out) / Number(amountIn);
  return { amountIn, amountOut: out, minOut: out - (out * BigInt(slippageBps)) / 10_000n, priceLamportsPerUnit: exec, priceImpactBps: Math.max(0, Math.round((1 - exec / spot) * 10_000)), venue: cv.complete ? "AMM" : "CURVE", curve: cv };
}

async function assemble(payer: PublicKey, ixs: TransactionInstruction[], signers: Keypair[] = [], units = 300_000) {
  const c = connection();
  const { blockhash, lastValidBlockHeight } = await withRetry("getLatestBlockhash", () => c.getLatestBlockhash("confirmed"));
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...ixs] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  if (signers.length) tx.sign(signers);
  return { tx, blockhash, lastValidBlockHeight };
}

/** Assemble + sign with the vault authority (keeper-side transactions). */
export async function assembleSigned(authority: Keypair, ixs: TransactionInstruction[], units = 200_000) {
  return assemble(authority.publicKey, ixs, [authority], units);
}

/** `create_v2`: a new Token-2022 mint + bonding curve, paid and signed by the creator's wallet; `creator` (fee recipient) is FATE's per-coin vault authority. */
export async function buildCreateTx(input: { user: PublicKey; name: string; symbol: string; uri: string; creator: PublicKey; mint?: Keypair }) {
  const mintKp = input.mint ?? Keypair.generate();
  const ix = await PUMP_SDK.createV2Instruction({ mint: mintKp.publicKey, name: input.name, symbol: input.symbol, uri: input.uri, creator: input.creator, user: input.user, mayhemMode: false, holderReward: false });
  const built = await assemble(input.user, [ix], [mintKp], 400_000);
  return { ...built, mint: mintKp.publicKey, mintKeypair: mintKp };
}

export async function buildBuyTx(input: { user: PublicKey; mint: PublicKey; lamports: bigint; slippageBps: number }) {
  const { global, feeConfig } = await pumpState();
  const cv = await fetchCurve(input.mint);
  const sdk = new OnlinePumpSdk(connection());
  const st = await withRetry("fetchBuyState", () => sdk.fetchBuyState(input.mint, input.user, cv.tokenProgram));
  const solAmount = new BN(input.lamports.toString());
  const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: cv.raw.tokenTotalSupply, bondingCurve: cv.raw, amount: solAmount, quoteMint: NATIVE_MINT });
  const ixs = await PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo: st.bondingCurveAccountInfo, bondingCurve: st.bondingCurve, associatedUserAccountInfo: st.associatedUserAccountInfo, mint: input.mint, user: input.user, amount, solAmount, slippage: input.slippageBps / 100, tokenProgram: cv.tokenProgram });
  return { ...(await assemble(input.user, ixs)), expectedTokens: BigInt(amount.toString()) };
}

export async function buildSellTx(input: { user: PublicKey; mint: PublicKey; tokens: bigint; slippageBps: number }) {
  const { global, feeConfig } = await pumpState();
  const cv = await fetchCurve(input.mint);
  const sdk = new OnlinePumpSdk(connection());
  const st = await withRetry("fetchSellState", () => sdk.fetchSellState(input.mint, input.user, cv.tokenProgram));
  const amount = new BN(input.tokens.toString());
  const solAmount = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: cv.raw.tokenTotalSupply, bondingCurve: cv.raw, amount });
  const ixs = await PUMP_SDK.sellInstructions({ global, bondingCurveAccountInfo: st.bondingCurveAccountInfo, bondingCurve: st.bondingCurve, mint: input.mint, user: input.user, amount, solAmount, slippage: input.slippageBps / 100, tokenProgram: cv.tokenProgram, mayhemMode: false });
  return { ...(await assemble(input.user, ixs)), expectedLamports: BigInt(solAmount.toString()) };
}

/** Keeper side: collect accrued creator fees for a vault authority (permissionless on-chain; signed by the authority so it pays its own fee). */
export async function collectFeesIxs(creator: PublicKey): Promise<TransactionInstruction[]> {
  const sdk = new OnlinePumpSdk(connection());
  return withRetry("collectCoinCreatorFeeInstructions", () => sdk.collectCoinCreatorFeeInstructions(creator));
}

export async function creatorVaultBalance(creator: PublicKey): Promise<bigint> {
  const sdk = new OnlinePumpSdk(connection());
  const b = await withRetry("getCreatorVaultBalanceBothPrograms", () => sdk.getCreatorVaultBalanceBothPrograms(creator)).catch(async () => {
    const info = await connection().getAccountInfo(creatorVaultPda(creator));
    return new BN(info?.lamports ?? 0);
  });
  return BigInt(b.toString());
}

/** Buy with the vault authority's SOL and burn everything bought, atomically (one transaction: buy ix + burn ix). */
export async function buildBuybackBurnTx(input: { authority: Keypair; mint: PublicKey; lamports: bigint; slippageBps: number }) {
  const { global, feeConfig } = await pumpState();
  const cv = await fetchCurve(input.mint);
  const sdk = new OnlinePumpSdk(connection());
  const st = await withRetry("fetchBuyState", () => sdk.fetchBuyState(input.mint, input.authority.publicKey, cv.tokenProgram));
  const solAmount = new BN(input.lamports.toString());
  const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: cv.raw.tokenTotalSupply, bondingCurve: cv.raw, amount: solAmount, quoteMint: NATIVE_MINT });
  const buy = await PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo: st.bondingCurveAccountInfo, bondingCurve: st.bondingCurve, associatedUserAccountInfo: st.associatedUserAccountInfo, mint: input.mint, user: input.authority.publicKey, amount, solAmount, slippage: input.slippageBps / 100, tokenProgram: cv.tokenProgram });
  // burn the minimum the buy guarantees (the buy's own slippage floor) so the transaction cannot fail on a few units of rounding; dust is burned next cycle
  const floor = amount.sub(amount.muln(input.slippageBps).divn(10_000));
  const ata = getAssociatedTokenAddressSync(input.mint, input.authority.publicKey, true, cv.tokenProgram);
  const burn = createBurnInstruction(ata, input.mint, input.authority.publicKey, BigInt(floor.toString()), [], cv.tokenProgram);
  return { ...(await assemble(input.authority.publicKey, [...buy, burn], [input.authority], 400_000)), expectedTokens: BigInt(amount.toString()), burnFloor: BigInt(floor.toString()) };
}

/** Buy and hold (Gravity escrow before graduation): tokens stay in the vault authority's ATA; there is no code path that sells or withdraws them. */
export async function buildEscrowBuyTx(input: { authority: Keypair; mint: PublicKey; lamports: bigint; slippageBps: number }) {
  const b = await buildBuyTx({ user: input.authority.publicKey, mint: input.mint, lamports: input.lamports, slippageBps: input.slippageBps });
  b.tx.sign([input.authority]);
  return b;
}

/** Plain SOL transfers signed by the vault authority (Echo claims, protocol share). */
export async function buildTransfersTx(authority: Keypair, transfers: { to: PublicKey; lamports: bigint }[]) {
  const ixs = transfers.map((t) => SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: t.to, lamports: t.lamports }));
  return assemble(authority.publicKey, ixs, [authority], 50_000);
}

/** The holders of a Token-2022 / SPL mint, excluding program-owned accounts (curve, pool, vault). */
export async function holders(mint: PublicKey, tokenProgram: PublicKey, exclude: PublicKey[]): Promise<{ owner: string; amount: bigint }[]> {
  const c = connection();
  const accounts = await withRetry("getParsedProgramAccounts", () => c.getParsedProgramAccounts(tokenProgram, { filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] }));
  const ex = new Set(exclude.map((e) => e.toBase58()));
  const out: { owner: string; amount: bigint }[] = [];
  for (const a of accounts) {
    const info = (a.account.data as { parsed?: { info?: { owner: string; tokenAmount: { amount: string } } } }).parsed?.info;
    if (!info || ex.has(info.owner)) continue;
    const amt = BigInt(info.tokenAmount.amount);
    if (amt > 0n) out.push({ owner: info.owner, amount: amt });
  }
  return out;
}

export interface ParsedTrade { signature: string; slot: number; blockTime: number | null; index: number; event: TradeEventBc }

/** Decode every pump `TradeEvent` / `CreateEvent` a transaction emitted (anchor `emit_cpi` inner instructions). */
export function decodeEvents(tx: VersionedTransactionResponse): { trades: TradeEventBc[]; creates: CreateEventBc[] } {
  const trades: TradeEventBc[] = []; const creates: CreateEventBc[] = [];
  if (!tx.meta || tx.meta.err) return { trades, creates };
  const keys = tx.transaction.message.staticAccountKeys.concat(tx.meta.loadedAddresses?.writable ?? [], tx.meta.loadedAddresses?.readonly ?? []);
  for (const inner of tx.meta.innerInstructions ?? []) for (const ix of inner.instructions) {
    if (!keys[ix.programIdIndex]?.equals(PUMP_PROGRAM_ID)) continue;
    const data = Buffer.from(bs58.decode(ix.data));
    if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_CPI_TAG)) continue;
    const name = EVENT_NAMES.get(data.subarray(8, 16).toString("hex"));
    try {
      if (name?.toLowerCase() === "tradeevent") trades.push(PUMP_SDK.decodeTradeEventBc(data.subarray(16)));
      else if (name?.toLowerCase() === "createevent") creates.push(PUMP_SDK.decodeCreateEventBc(data.subarray(16)));
    } catch { /* unknown layout: ignore, never fabricate */ }
  }
  return { trades, creates };
}

/** Decode PumpSwap Buy/Sell events from a transaction (graduated coins). */
export function decodeAmmEvents(tx: VersionedTransactionResponse): { buys: BuyEventAmm[]; sells: SellEventAmm[] } {
  const buys: BuyEventAmm[] = []; const sells: SellEventAmm[] = [];
  if (!tx.meta || tx.meta.err) return { buys, sells };
  const names = ammEventNames();
  const keys = tx.transaction.message.staticAccountKeys.concat(tx.meta.loadedAddresses?.writable ?? [], tx.meta.loadedAddresses?.readonly ?? []);
  for (const inner of tx.meta.innerInstructions ?? []) for (const ix of inner.instructions) {
    if (!keys[ix.programIdIndex]?.equals(PUMP_AMM_PROGRAM_ID)) continue;
    const data = Buffer.from(bs58.decode(ix.data));
    if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_CPI_TAG)) continue;
    const name = names.get(data.subarray(8, 16).toString("hex"))?.toLowerCase();
    try {
      if (name === "buyevent") buys.push(PUMP_SDK.decodeBuyEventAmm(data.subarray(16)));
      else if (name === "sellevent") sells.push(PUMP_SDK.decodeSellEventAmm(data.subarray(16)));
    } catch { /* unknown layout: ignore, never fabricate */ }
  }
  return { buys, sells };
}

export interface ParsedPoolTrade { signature: string; slot: number; blockTime: number | null; index: number; side: "BUY" | "SELL"; user: string; sol: bigint; tokens: bigint; creatorFee: bigint; totalFee: bigint; poolBase: bigint; poolQuote: bigint }

/** New confirmed PumpSwap trades on a graduated coin's canonical pool since `untilSignature` (oldest first). */
export async function newPoolTrades(mint: PublicKey, untilSignature: string | null, limit = 50): Promise<ParsedPoolTrade[]> {
  const c = connection();
  const pool = canonicalPumpPoolPda(mint);
  const sigs = await withRetry("getSignaturesForAddress(pool)", () => c.getSignaturesForAddress(pool, { limit, until: untilSignature ?? undefined }, "confirmed"));
  const out: ParsedPoolTrade[] = [];
  for (const s of sigs.reverse()) {
    if (s.err) continue;
    const tx = await getTx(s.signature);
    if (!tx) continue;
    const { buys, sells } = decodeAmmEvents(tx);
    let index = 0;
    const big = (b: BN) => BigInt(b.toString());
    for (const e of buys) if (e.pool.equals(pool)) out.push({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, index: index++, side: "BUY", user: e.user.toBase58(), sol: big(e.quoteAmountIn), tokens: big(e.baseAmountOut), creatorFee: big(e.coinCreatorFee), totalFee: big(e.lpFee) + big(e.protocolFee) + big(e.coinCreatorFee), poolBase: big(e.poolBaseTokenReserves), poolQuote: big(e.poolQuoteTokenReserves) });
    for (const e of sells) if (e.pool.equals(pool)) out.push({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, index: index++, side: "SELL", user: e.user.toBase58(), sol: big(e.quoteAmountOut), tokens: big(e.baseAmountIn), creatorFee: big(e.coinCreatorFee), totalFee: big(e.lpFee) + big(e.protocolFee) + big(e.coinCreatorFee), poolBase: big(e.poolBaseTokenReserves), poolQuote: big(e.poolQuoteTokenReserves) });
  }
  return out;
}

export async function getTx(signature: string): Promise<VersionedTransactionResponse | null> {
  return withRetry("getTransaction", () => connection().getTransaction(signature, { maxSupportedTransactionVersion: 1, commitment: "confirmed" }));
}

/** New confirmed trades on a bonding curve since `untilSignature` (oldest first), decoded from the chain — the only source of trade data on devnet/mainnet. */
export async function newTrades(mint: PublicKey, untilSignature: string | null, limit = 50): Promise<ParsedTrade[]> {
  const c = connection();
  const sigs = await withRetry("getSignaturesForAddress", () => c.getSignaturesForAddress(bondingCurvePda(mint), { limit, until: untilSignature ?? undefined }, "confirmed"));
  const out: ParsedTrade[] = [];
  for (const s of sigs.reverse()) {
    if (s.err) continue;
    const tx = await getTx(s.signature);
    if (!tx) continue;
    const { trades } = decodeEvents(tx);
    trades.forEach((event, index) => { if (event.mint.equals(mint)) out.push({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, index, event }); });
  }
  return out;
}

export const pumpProgramId = PUMP_PROGRAM_ID;
export { bondingCurvePda, creatorVaultPda };
