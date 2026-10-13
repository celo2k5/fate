/**
 * FATE bonding curve — documented model.
 *
 * Constant-product curve with virtual reserves (the same family as Pump.fun):
 *
 *     (vSol + realSol) * (vTok) = k            (vTok already nets out sold tokens)
 *
 * Buy  (Δsol in, after fee):  tokensOut = vTok - k / (vSol + Δsol)
 * Sell (Δtok in):             solOut    = vSol - k / (vTok + Δtok)
 *
 * where vSol/vTok are the *current* virtual reserves. Real SOL reserves track the
 * SOL actually deposited (they can never exceed what was paid in). The curve is
 * authoritative for reserves, price, inventory and graduation; the UI only
 * displays quotes produced here.
 *
 * Fees are charged in SOL on both sides:
 *   buy : fee = feeBps * solIn           (net = solIn - fee goes to reserves)
 *   sell: fee = feeBps * solOut          (trader receives solOut - fee)
 * Fee is split destinyShareBps -> destiny vault, remainder -> protocol treasury.
 *
 * Price impact is reported against the spot price before the trade.
 */
import { EngineError, bps, checkedAdd, checkedSub, BPS_DENOM, LAMPORTS_PER_SOL } from "./units";

export interface Reserves {
  virtualSol: bigint;
  virtualTokens: bigint;
  realSol: bigint;
  realTokens: bigint; // tokens still available for sale on the curve
}

export interface Quote {
  side: "BUY" | "SELL";
  amountIn: bigint;      // what the trader gives (lamports for BUY, token units for SELL)
  amountOut: bigint;     // what the trader receives (token units for BUY, lamports for SELL) net of fee
  fee: bigint;           // lamports
  destinyFee: bigint;    // lamports
  protocolFee: bigint;   // lamports
  spotBefore: number;    // lamports per whole token
  spotAfter: number;
  priceImpactBps: number;
  minOut: bigint;        // after slippage tolerance
}

/** lamports per whole token (floating, for display only) */
export function spotPrice(r: { virtualSol: bigint; virtualTokens: bigint }): number {
  if (r.virtualTokens === 0n) return 0;
  return (Number(r.virtualSol) / Number(r.virtualTokens)) * 1e6; // tokens have 6 dp
}

function splitFee(fee: bigint, destinyShareBps: number) {
  const destinyFee = bps(fee, destinyShareBps);
  return { destinyFee, protocolFee: fee - destinyFee };
}

export function quoteBuy(
  r: Reserves,
  solIn: bigint,
  feeBps: number,
  destinyShareBps: number,
  slippageBps: number,
): Quote {
  if (solIn <= 0n) throw new EngineError("BAD_AMOUNT", "amount must be positive");
  const fee = bps(solIn, feeBps);
  const net = checkedSub(solIn, fee, "net sol");
  const k = r.virtualSol * r.virtualTokens;
  const newVSol = checkedAdd(r.virtualSol, net);
  const newVTok = k / newVSol + (k % newVSol === 0n ? 0n : 1n); // ceil keeps k non-decreasing
  const tokensOut = checkedSub(r.virtualTokens, newVTok, "tokens out");
  if (tokensOut <= 0n) throw new EngineError("BAD_AMOUNT", "amount too small");
  if (tokensOut > r.realTokens) throw new EngineError("INSUFFICIENT_INVENTORY", "curve inventory exhausted — reduce amount");
  const spotBefore = spotPrice(r);
  const spotAfter = spotPrice({ virtualSol: newVSol, virtualTokens: newVTok });
  const { destinyFee, protocolFee } = splitFee(fee, destinyShareBps);
  return {
    side: "BUY",
    amountIn: solIn,
    amountOut: tokensOut,
    fee, destinyFee, protocolFee,
    spotBefore, spotAfter,
    priceImpactBps: spotBefore ? Math.round(((spotAfter - spotBefore) / spotBefore) * 10_000) : 0,
    minOut: (tokensOut * (BPS_DENOM - BigInt(slippageBps))) / BPS_DENOM,
  };
}

export function quoteSell(
  r: Reserves,
  tokensIn: bigint,
  feeBps: number,
  destinyShareBps: number,
  slippageBps: number,
): Quote {
  if (tokensIn <= 0n) throw new EngineError("BAD_AMOUNT", "amount must be positive");
  const k = r.virtualSol * r.virtualTokens;
  const newVTok = checkedAdd(r.virtualTokens, tokensIn);
  const newVSol = k / newVTok + (k % newVTok === 0n ? 0n : 1n);
  const solOutGross = checkedSub(r.virtualSol, newVSol, "sol out");
  if (solOutGross > r.realSol) throw new EngineError("INSUFFICIENT_RESERVES", "curve reserves cannot cover this sale");
  const fee = bps(solOutGross, feeBps);
  const solOut = checkedSub(solOutGross, fee);
  const spotBefore = spotPrice(r);
  const spotAfter = spotPrice({ virtualSol: newVSol, virtualTokens: newVTok });
  const { destinyFee, protocolFee } = splitFee(fee, destinyShareBps);
  return {
    side: "SELL",
    amountIn: tokensIn,
    amountOut: solOut,
    fee, destinyFee, protocolFee,
    spotBefore, spotAfter,
    priceImpactBps: spotBefore ? Math.round(((spotAfter - spotBefore) / spotBefore) * 10_000) : 0,
    minOut: (solOut * (BPS_DENOM - BigInt(slippageBps))) / BPS_DENOM,
  };
}

/** Apply a BUY quote to reserves; returns new reserves. Pure. */
export function applyBuy(r: Reserves, q: Quote): Reserves {
  const net = q.amountIn - q.fee;
  return {
    virtualSol: r.virtualSol + net,
    virtualTokens: r.virtualTokens - q.amountOut,
    realSol: r.realSol + net,
    realTokens: r.realTokens - q.amountOut,
  };
}
export function applySell(r: Reserves, q: Quote): Reserves {
  const gross = q.amountOut + q.fee;
  return {
    virtualSol: r.virtualSol - gross,
    virtualTokens: r.virtualTokens + q.amountIn,
    realSol: r.realSol - gross,
    realTokens: r.realTokens + q.amountIn,
  };
}

/** Market cap in lamports = spot * circulating supply. */
export function marketCapLamports(spot: number, circulating: bigint): bigint {
  return BigInt(Math.floor((spot * Number(circulating)) / 1e6));
}

export const solToNumber = (l: bigint) => Number(l) / Number(LAMPORTS_PER_SOL);
