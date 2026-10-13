/** Client-safe formatting helpers (string/bigint in, string out). */
const LAMPORTS = 1_000_000_000;
const TOKEN = 1_000_000;

export const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v ?? 0)));
export const solNum = (v: unknown) => Number(big(v)) / LAMPORTS;
export const tokNum = (v: unknown) => Number(big(v)) / TOKEN;

export function fmtSol(v: unknown, dp = 3): string {
  const n = solNum(v);
  if (n === 0) return "0";
  if (Math.abs(n) < 0.001) return n.toFixed(6);
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtTok(v: unknown): string {
  const n = tokNum(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
/** lamports per whole token -> SOL string with sensible precision */
export function fmtPrice(lamportsPerToken: number): string {
  const s = lamportsPerToken / LAMPORTS;
  if (s === 0) return "0";
  if (s < 1e-6) return s.toExponential(2);
  return s.toFixed(s < 0.001 ? 8 : 6);
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const bpsPct = (b: number) => `${(b / 100).toFixed(2)}%`;
export function ago(ts: number | string | bigint): string {
  const d = Date.now() - Number(ts);
  if (d < 60_000) return `${Math.max(1, Math.floor(d / 1000))}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
export function countdown(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = Number(ts) - Date.now();
  if (d <= 0) return "now";
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export const shortAddr = (a: string | null | undefined, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : "");
export const destinyWord: Record<string, string> = { PHOENIX: "Phoenix", GRAVITY: "Gravity", ECHO: "Echo", ORBIT: "Orbit" };
export const actionWord: Record<string, string> = { PHOENIX: "buyback", GRAVITY: "liquidity add", ECHO: "epoch settlement", ORBIT: "treasury cycle" };
