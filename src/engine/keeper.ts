/**
 * Keeper: a bounded, in-process service that periodically calls the
 * permissionless crank for every token and records market snapshots.
 * It holds no authority — every condition is re-validated by the engine.
 */
import { getDb } from "@/db";
import { Protocol } from "./protocol";

export function getProtocol(): Protocol {
  const g = globalThis as unknown as { __fateProtocol?: Protocol };
  if (!g.__fateProtocol) g.__fateProtocol = new Protocol(getDb());
  return g.__fateProtocol;
}

export function startKeeper(intervalMs = Number(process.env.FATE_KEEPER_INTERVAL_MS ?? 4000)) {
  const g = globalThis as unknown as { __fateKeeper?: NodeJS.Timeout; __fateKeeperTicks?: number };
  if (g.__fateKeeper || intervalMs <= 0) return;
  g.__fateKeeperTicks = 0;
  g.__fateKeeper = setInterval(() => {
    try {
      const p = getProtocol();
      p.crankAll();
      g.__fateKeeperTicks = (g.__fateKeeperTicks ?? 0) + 1;
      if (g.__fateKeeperTicks % 5 === 0) {
        for (const r of p.db.prepare("SELECT id FROM tokens WHERE status <> 'GRADUATING'").all() as { id: string }[]) p.snapshotMarket(r.id);
      }
    } catch (e) {
      console.error("[keeper]", e);
    }
  }, intervalMs);
  g.__fateKeeper.unref?.();
  console.log(`[keeper] started, interval ${intervalMs}ms`);
}

export function keeperStatus() {
  const g = globalThis as unknown as { __fateKeeper?: NodeJS.Timeout; __fateKeeperTicks?: number };
  return { running: Boolean(g.__fateKeeper), ticks: g.__fateKeeperTicks ?? 0 };
}
