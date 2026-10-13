/**
 * Integer-safe arithmetic for the FATE engine. Mirrors the checked_* semantics
 * the on-chain program uses: any overflow / underflow throws instead of wrapping.
 */
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const TOKEN_DECIMALS = 6;
export const TOKEN_UNIT = 10n ** BigInt(TOKEN_DECIMALS);
export const BPS_DENOM = 10_000n;
export const U64_MAX = (1n << 64n) - 1n;

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EngineError";
  }
}

export function assertU64(x: bigint, what = "value"): bigint {
  if (x < 0n) throw new EngineError("UNDERFLOW", `${what} underflow`);
  if (x > U64_MAX) throw new EngineError("OVERFLOW", `${what} overflow`);
  return x;
}
export const checkedAdd = (a: bigint, b: bigint, what?: string) => assertU64(a + b, what);
export const checkedSub = (a: bigint, b: bigint, what?: string) => assertU64(a - b, what);
export const checkedMul = (a: bigint, b: bigint, what?: string) => assertU64(a * b, what);
export function checkedDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new EngineError("DIV_ZERO", "division by zero");
  return a / b;
}
/** floor(a * bps / 10_000) */
export const bps = (a: bigint, basisPoints: bigint | number) => (a * BigInt(basisPoints)) / BPS_DENOM;

export const sol = (n: number | string) => {
  // parse decimal SOL into lamports without float error
  const [i, f = ""] = String(n).split(".");
  const frac = (f + "000000000").slice(0, 9);
  return BigInt(i || "0") * LAMPORTS_PER_SOL + BigInt(frac);
};
export const tokens = (n: number | string) => {
  const [i, f = ""] = String(n).split(".");
  const frac = (f + "000000").slice(0, TOKEN_DECIMALS);
  return BigInt(i || "0") * TOKEN_UNIT + BigInt(frac);
};

export function formatSol(lamports: bigint, dp = 4): string {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const whole = v / LAMPORTS_PER_SOL;
  const frac = (v % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${dp ? "." + frac : ""}`;
}
export function formatTokens(units: bigint, dp = 2): string {
  const whole = units / TOKEN_UNIT;
  const frac = (units % TOKEN_UNIT).toString().padStart(TOKEN_DECIMALS, "0").slice(0, dp);
  return `${whole.toLocaleString("en-US")}${dp ? "." + frac : ""}`;
}
export function compactTokens(units: bigint): string {
  const n = Number(units / TOKEN_UNIT);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

/** Safe JSON for API responses: bigint -> string. */
export function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}
