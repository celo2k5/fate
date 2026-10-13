/**
 * External keeper worker: `npm run keeper` (Render background worker / cron / systemd).
 * Loops forever (or once with --once, for cron), writes a heartbeat the web tier reads, backs off on
 * repeated errors, and exits cleanly on SIGTERM so a deploy never interrupts a tick mid-write (SQLite
 * transactions make a hard kill safe too; the next tick recovers a stale EXECUTING row).
 */
import { getProtocol, keeperTick } from "../src/engine/keeper";
import { log } from "../src/lib/log";

const klog = log.child({ component: "keeper", shape: "worker" });
const once = process.argv.includes("--once");
const interval = Number(process.env.FATE_KEEPER_INTERVAL_MS ?? 4000);
let stopping = false;
let tick = 0;
let consecutiveErrors = 0;

process.on("SIGTERM", () => { stopping = true; klog.info("sigterm"); });
process.on("SIGINT", () => { stopping = true; klog.info("sigint"); });

async function main() {
  const p = getProtocol();
  klog.info("started", { interval, once, chain: process.env.FATE_CHAIN ?? "simnet", db: process.env.FATE_DB_PATH ?? "data/fate.db" });
  do {
    const started = Date.now();
    try {
      tick++;
      const r = await keeperTick(p, tick, "worker");
      consecutiveErrors = 0;
      if (once) klog.info("tick", { tick, ...r });
    } catch (e) {
      consecutiveErrors++;
      klog.error("tick.error", { tick, consecutiveErrors, error: e });
    }
    if (once) break;
    // backoff: 1× interval normally, up to 8× after repeated errors (RPC outage, locked db), so we never hot-loop
    const wait = Math.max(0, interval * Math.min(8, 2 ** Math.min(consecutiveErrors, 3)) - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  } while (!stopping);
  klog.info("stopped", { tick });
  process.exit(0);
}

main().catch((e) => { klog.error("fatal", { error: e }); process.exit(1); });
