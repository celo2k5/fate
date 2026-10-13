/**
 * Simulated price oracle for Orbit treasury swaps.
 *
 * simnet has no external markets, so prices come from a deterministic feed:
 * a base price plus a slow sinusoidal drift keyed on time. On devnet/mainnet
 * this module is replaced by a Pyth/Switchboard read and the swap executes
 * through Jupiter; the engine only ever consumes `quote()` so the swap path
 * stays identical. Nothing here is a market prediction.
 */
import { LAMPORTS_PER_SOL } from "./units";

export type SwapAsset = "USDC" | "LST";

const BASE = {
  USDC: 142.0, // USDC per SOL
  LST: 0.915,  // LST per SOL (LST trades above SOL: 1 LST ≈ 1.093 SOL)
};
const DECIMALS: Record<SwapAsset, bigint> = { USDC: 1_000_000n, LST: 1_000_000_000n };

export function oraclePrice(asset: SwapAsset, at = Date.now()): number {
  const t = at / 1000;
  const drift = asset === "USDC" ? Math.sin(t / 900) * 0.6 : Math.sin(t / 1300) * 0.004;
  return BASE[asset] + drift;
}

export interface SwapQuote {
  asset: SwapAsset;
  lamportsIn: bigint;
  amountOut: bigint;     // base units of the asset
  oraclePrice: number;   // units per SOL
  executionPrice: number;
  slippageBps: number;   // realised vs oracle, positive = worse
}

/** Venue quote: the oracle price with a size-dependent execution cost (bounded, linear). */
export function quoteSwap(asset: SwapAsset, lamportsIn: bigint, at = Date.now()): SwapQuote {
  const px = oraclePrice(asset, at);
  const solIn = Number(lamportsIn) / Number(LAMPORTS_PER_SOL);
  // 2 bps per SOL of size, capped at 80 bps — a stand-in for pool depth.
  const costBps = Math.min(80, 2 * solIn);
  const execPx = px * (1 - costBps / 10_000);
  const out = BigInt(Math.floor(solIn * execPx * Number(DECIMALS[asset])));
  return { asset, lamportsIn, amountOut: out, oraclePrice: px, executionPrice: execPx, slippageBps: Math.round(costBps) };
}

/** Value an asset holding back into lamports at the oracle price (for treasury reporting). */
export function valueInLamports(asset: SwapAsset | "SOL" | "RESERVE", amount: bigint, at = Date.now()): bigint {
  if (asset === "SOL" || asset === "RESERVE") return amount;
  const px = oraclePrice(asset, at);
  const units = Number(amount) / Number(DECIMALS[asset]);
  return BigInt(Math.floor((units / px) * Number(LAMPORTS_PER_SOL)));
}
