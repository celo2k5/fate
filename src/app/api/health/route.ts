import { NextResponse } from "next/server";
import { getProtocol, keeperStatus } from "@/engine/keeper";
import { serialize } from "@/engine/units";
export const dynamic = "force-dynamic";

/**
 * Operator health. 200 when the ledger is readable, the keeper heartbeat is fresh and reconciliation passes;
 * 503 otherwise (so Render's health check, and any uptime monitor, flips on a real problem). Deep checks can be
 * skipped with ?quick=1 (used as the Render health-check path).
 */
export async function GET(req: Request) {
  const started = Date.now();
  const quick = new URL(req.url).searchParams.get("quick") === "1";
  const out: Record<string, unknown> = { ok: true, version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? process.env.npm_package_version ?? "dev", chain: process.env.FATE_CHAIN ?? "simnet", now: started };
  const problems: string[] = [];
  try {
    const p = getProtocol();
    p.db.prepare("SELECT 1").get();
    out.db = { ok: true, path: process.env.FATE_DB_PATH ?? "data/fate.db", tokens: Number((p.db.prepare("SELECT COUNT(*) c FROM tokens").get() as { c: bigint }).c) };
    const ks = keeperStatus();
    const interval = Number(process.env.FATE_KEEPER_INTERVAL_MS ?? 4000);
    const fresh = Boolean(ks.heartbeat && ks.heartbeat.ageMs < interval * 5);
    out.keeper = { ...ks, fresh };
    if (!fresh) problems.push(ks.heartbeat ? `keeper heartbeat is ${Math.round((ks.heartbeat.ageMs ?? 0) / 1000)}s old` : "no keeper heartbeat yet");
    out.paused = p.isPaused();
    const pendingTx = Number((p.db.prepare("SELECT COUNT(*) c FROM chain_txs WHERE status IN ('BUILT','SENT')").get() as { c: bigint }).c);
    const failedExec = Number((p.db.prepare("SELECT COUNT(*) c FROM destiny_states WHERE state='FAILED'").get() as { c: bigint }).c);
    out.work = { pendingTx, failedExec, executing: Number((p.db.prepare("SELECT COUNT(*) c FROM destiny_states WHERE state='EXECUTING'").get() as { c: bigint }).c) };
    out.recentErrors = p.db.prepare("SELECT token_id, error, completed_at FROM destiny_executions WHERE status='FAILED' ORDER BY completed_at DESC LIMIT 5").all();
    if (!quick) {
      const integ = p.verifyIntegrity();
      out.integrity = integ;
      if (!integ.ok) problems.push(...integ.problems.slice(0, 5));
      if ((process.env.FATE_CHAIN ?? "simnet") !== "simnet") {
        const { chainHealth } = await import("@/chain/agents");
        out.rpc = await chainHealth();
        if (!(out.rpc as { ok: boolean }).ok) problems.push("rpc unreachable");
      }
    }
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  out.problems = problems; out.ok = problems.length === 0; out.ms = Date.now() - started;
  return NextResponse.json(serialize(out), { status: out.ok ? 200 : 503 });
}
