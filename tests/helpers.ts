import { openDatabase } from "@/db";
import { Protocol } from "@/engine/protocol";
import { newAddress } from "@/engine/ids";
import { sol } from "@/engine/units";
import type { DestinyType, LaunchInput } from "@/engine/config";

let sigCounter = 0;
export const sig = () => `sig_${++sigCounter}_${Math.random().toString(36).slice(2)}`;

export function fresh() {
  const db = openDatabase(":memory:");
  return new Protocol(db);
}

export function launch(p: Protocol, destiny: DestinyType, overrides: Partial<LaunchInput> = {}) {
  const creator = overrides.creator ?? newAddress();
  p.faucet(creator, sol(100));
  const token = p.launch({
    name: `${destiny} Test`, ticker: destiny.slice(0, 4), description: "test", destiny, creator,
    executionThreshold: sol(0.3), cooldownMs: 5_000, maxSlippageBps: 1_500, graduationThreshold: sol(100),
    signature: sig(), signedMessage: "test", ...overrides,
  });
  return { token, creator };
}

export function trader(p: Protocol, amount = sol(50)) {
  const a = newAddress();
  p.faucet(a, amount);
  return a;
}

export function buy(p: Protocol, tokenId: string, who: string, lamports: bigint) {
  const q = p.quote(tokenId, "BUY", lamports, 100);
  return p.buy({ tokenId, trader: who, amountIn: lamports, minOut: q.minOut, signature: sig() });
}
export function sell(p: Protocol, tokenId: string, who: string, units: bigint) {
  const q = p.quote(tokenId, "SELL", units, 100);
  return p.sell({ tokenId, trader: who, amountIn: units, minOut: q.minOut, signature: sig() });
}

/** Simulate time passing by rewinding timestamps in the ledger. */
export function timeTravel(p: Protocol, ms: number) {
  p.db.prepare("UPDATE destiny_states SET last_execution_at = last_execution_at - ? WHERE last_execution_at IS NOT NULL").run(ms);
  p.db.prepare("UPDATE tokens SET created_at = created_at - ?").run(ms);
}
