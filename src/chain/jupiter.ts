import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { withRetry, connection } from "./rpc";

/**
 * Jupiter swap adapter for Orbit's USDC / LST legs (mainnet only: Jupiter has no devnet deployment).
 * Approved basket and venue rules (from DESTINY_META.ORBIT: "approved venues only, inside price and slippage limits,
 * no leverage"):
 *   - output mints are a fixed allowlist (USDC, JitoSOL); nothing else can be bought
 *   - the quote's price impact must be ≤ the coin's max slippage, and `slippageBps` bounds the fill on-chain
 *   - the swap transaction is built for the vault authority, then checked to be payer = authority before signing
 * Base URL: FATE_JUPITER_URL (default the free lite API; set a keyed endpoint for production volume).
 */
export const ORBIT_MINTS = {
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  LST: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"), // JitoSOL
} as const;
const SOL = "So11111111111111111111111111111111111111112";
const base = () => (process.env.FATE_JUPITER_URL ?? "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");

export interface JupQuote { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string; routePlan: { swapInfo: { label?: string; ammKey: string } }[]; [k: string]: unknown }

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`jupiter ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

export async function quoteSolTo(asset: keyof typeof ORBIT_MINTS, lamports: bigint, slippageBps: number): Promise<JupQuote> {
  const url = `${base()}/quote?inputMint=${SOL}&outputMint=${ORBIT_MINTS[asset].toBase58()}&amount=${lamports}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  const q = await withRetry(`jupiter.quote(${asset})`, () => getJson<JupQuote>(url), 4);
  const impactBps = Math.round(Number(q.priceImpactPct) * 10_000);
  if (!Number.isFinite(impactBps) || impactBps > slippageBps) throw new Error(`jupiter ${asset} price impact ${impactBps} bps exceeds the ${slippageBps} bps bound`);
  if (BigInt(q.outAmount) <= 0n) throw new Error(`jupiter returned no output for ${asset}`);
  return q;
}

/** Build the swap for `user` (the vault authority). Signed only after verifying the fee payer. */
export async function buildSwapTx(quote: JupQuote, user: PublicKey): Promise<VersionedTransaction> {
  const res = await withRetry("jupiter.swap", () => getJson<{ swapTransaction: string }>(`${base()}/swap`, {
    method: "POST",
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: "auto" }),
  }), 3);
  const tx = VersionedTransaction.deserialize(Buffer.from(res.swapTransaction, "base64"));
  if (!tx.message.staticAccountKeys[0].equals(user)) throw new Error("jupiter swap transaction fee payer is not the vault authority");
  return tx;
}

export function signSwap(tx: VersionedTransaction, authority: Keypair) { tx.sign([authority]); return tx; }

/** Units of `mint` held by `owner` across its token accounts (balance-delta verification of a fill). */
export async function tokenHoldings(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const r = await withRetry("getParsedTokenAccountsByOwner", () => connection().getParsedTokenAccountsByOwner(owner, { mint }, "confirmed"));
  return r.value.reduce((a, acc) => a + BigInt((acc.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount.amount), 0n);
}
