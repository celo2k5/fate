/**
 * Keeper: the permissionless crank, run on a schedule.
 *
 * Two deployment shapes, both writing the same heartbeat so /api/health can tell whether *anything* is cranking:
 *  - external worker (`npm run keeper`, scripts/keeper.ts): a separate process / Render background worker or cron.
 *    This is the shape for devnet/mainnet: it survives web dynos sleeping and restarts independently.
 *  - in-process (`FATE_KEEPER_MODE=inprocess`, started from src/instrumentation.ts): a bounded setInterval inside the
 *    web server. Fine for the simnet demo; NOT a durable execution mechanism for financial agents (the web process
 *    can sleep or be replaced at any time). The default is `auto`: in-process unless an external heartbeat is fresh.
 *
 * The keeper holds no authority: every condition is re-validated by the engine (`Protocol.crank`), duplicates are
 * impossible by schema, and a crash mid-execution is recovered on the next tick (stale EXECUTING → FAILED → retry
 * with exponential backoff).
 */
import { getDb } from "@/db";
import { Protocol } from "./protocol";
import { log } from "@/lib/log";

const klog = log.child({ component: "keeper" });

export function getProtocol(): Protocol {
  const g = globalThis as unknown as { __fateProtocol?: Protocol };
  if (!g.__fateProtocol) g.__fateProtocol = new Protocol(getDb());
  return g.__fateProtocol;
}

export interface TickResult { cranked: number; executed: number; failed: number; snapshots: number; chain?: Record<string, unknown>; ms: number }

/** One keeper tick: crank every live coin, record snapshots every 5th tick, run the chain mirror when enabled. */
export async function keeperTick(p: Protocol, tick: number, source: string): Promise<TickResult> {
  const t0 = Date.now();
  let executed = 0, failed = 0, snapshots = 0;
  const results = p.crankAll();
  for (const r of results) { if (r.executed) executed++; else if (r.state === "FAILED" && r.executionId) failed++; }
  if (tick % 5 === 0) {
    for (const r of p.db.prepare("SELECT id FROM tokens WHERE status <> 'GRADUATING'").all() as { id: string }[]) { p.snapshotMarket(r.id); snapshots++; }
  }
  let chain: Record<string, unknown> | undefined;
  if ((process.env.FATE_CHAIN ?? "simnet") !== "simnet") {
    const { chainTick } = await import("@/chain/agents");
    chain = await chainTick(p, tick);
  }
  const ms = Date.now() - t0;
  p.heartbeat(source, { tick, executed, failed, ms });
  if (executed || failed) klog.info("tick", { source, tick, cranked: results.length, executed, failed, ms });
  return { cranked: results.length, executed, failed, snapshots, chain, ms };
}

export function startKeeper(intervalMs = Number(process.env.FATE_KEEPER_INTERVAL_MS ?? 4000)) {
  const g = globalThis as unknown as { __fateKeeper?: NodeJS.Timeout; __fateKeeperTicks?: number; __fateKeeperBusy?: boolean };
  const mode = process.env.FATE_KEEPER_MODE ?? "auto";
  if (g.__fateKeeper || intervalMs <= 0 || mode === "off" || mode === "external") return;
  g.__fateKeeperTicks = 0;
  g.__fateKeeper = setInterval(async () => {
    if (g.__fateKeeperBusy) return; // never overlap ticks
    g.__fateKeeperBusy = true;
    try {
      const p = getProtocol();
      // auto: stand down while an external worker is alive (its heartbeat is fresher than 3 intervals)
      const hb = p.keeperHeartbeat();
      if (mode === "auto" && hb && hb.source === "worker" && hb.ageMs < intervalMs * 3) return;
      g.__fateKeeperTicks = (g.__fateKeeperTicks ?? 0) + 1;
      await keeperTick(p, g.__fateKeeperTicks, "inprocess");
    } catch (e) {
      klog.error("tick.error", { error: e });
    } finally {
      g.__fateKeeperBusy = false;
    }
  }, intervalMs);
  g.__fateKeeper.unref?.();
  klog.info("started", { mode, intervalMs, shape: "inprocess" });
}

export function keeperStatus() {
  const g = globalThis as unknown as { __fateKeeper?: NodeJS.Timeout; __fateKeeperTicks?: number };
  const hb = getProtocol().keeperHeartbeat();
  return { running: Boolean(g.__fateKeeper), ticks: g.__fateKeeperTicks ?? 0, heartbeat: hb, mode: process.env.FATE_KEEPER_MODE ?? "auto" };
}
