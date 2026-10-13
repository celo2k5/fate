import { describe, it, expect } from "vitest";
import { fresh, launch, trader, buy, sell, timeTravel } from "./helpers";
import { sol } from "@/engine/units";
import { newAddress } from "@/engine/ids";

describe("immutability enforced by the database", () => {
  it("rejects any UPDATE or DELETE on destiny_configs, launches and events", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    expect(() => p.db.prepare("UPDATE destiny_configs SET execution_threshold = 1 WHERE token_id=?").run(token.id)).toThrow(/immutable/);
    expect(() => p.db.prepare("DELETE FROM destiny_configs WHERE token_id=?").run(token.id)).toThrow(/immutable/);
    expect(() => p.db.prepare("UPDATE launches SET signature='x' WHERE token_id=?").run(token.id)).toThrow(/append-only/);
    expect(() => p.db.prepare("UPDATE tokens SET destiny='ECHO' WHERE id=?").run(token.id)).toThrow(/immutable/);
    expect(() => p.db.prepare("UPDATE tokens SET creator=? WHERE id=?").run(newAddress(), token.id)).toThrow(/immutable/);
    expect(() => p.db.prepare("DELETE FROM events").run()).toThrow(/append-only/);
    // non-economic metadata stays editable
    expect(() => p.db.prepare("UPDATE tokens SET description='new' WHERE id=?").run(token.id)).not.toThrow();
  });

  it("keeps trades, claims and settled executions append-only", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p); buy(p, token.id, t, sol(1));
    expect(() => p.db.prepare("DELETE FROM trades").run()).toThrow(/append-only/);
    expect(() => p.db.prepare("UPDATE trades SET sol_amount = 1").run()).toThrow(/append-only/);
    for (let i = 0; i < 40; i++) buy(p, token.id, t, sol(1));
    const r = p.crank(token.id);
    expect(r.executed).toBe(true);
    expect(() => p.db.prepare("UPDATE destiny_executions SET status='FAILED' WHERE id=?").run(r.executionId)).toThrow(/settled/);
    expect(() => p.db.prepare("DELETE FROM destiny_executions").run()).toThrow(/append-only/);
  });
});

describe("failure handling", () => {
  it("backs off exponentially after failed executions and resets on success", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p);
    for (let i = 0; i < 40; i++) buy(p, token.id, t, sol(1));
    // a deterministic failure inside the executor (e.g. venue rejects the buy)
    (p as unknown as { executePhoenix: () => never }).executePhoenix = () => { throw new Error("venue rejected the buy"); };
    const r1 = p.crank(token.id);
    expect(r1.executed).toBe(false); expect(r1.state).toBe("FAILED");
    const st1 = p.getState(token.id);
    expect(Number(st1.failure_count)).toBe(1);
    expect(Number(st1.next_retry_at)).toBeGreaterThan(Date.now());
    // not eligible until the backoff elapses
    expect(p.eligibility(token.id).reason).toMatch(/cooldown|backoff/);
    timeTravel(p, 20_000);
    p.db.prepare("UPDATE destiny_states SET next_retry_at = next_retry_at - 20000").run();
    const r2 = p.crank(token.id);
    expect(r2.state).toBe("FAILED");
    const st2 = p.getState(token.id);
    expect(Number(st2.failure_count)).toBe(2);
    expect(Number(st2.next_retry_at) - Date.now()).toBeGreaterThan(15_000); // 5 s cooldown × 2² = 20 s
    // every attempt got its own execution row; no seq collision
    const rows = p.db.prepare("SELECT seq, status FROM destiny_executions WHERE token_id=? ORDER BY seq").all(token.id) as { seq: bigint; status: string }[];
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect(rows.every((r) => r.status === "FAILED")).toBe(true);
  });

  it("recovers a stale EXECUTING row after a crash and retries later", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p);
    for (let i = 0; i < 40; i++) buy(p, token.id, t, sol(1));
    // simulate a crash mid-execution
    p.db.prepare("INSERT INTO destiny_executions(id,token_id,destiny,seq,status,vault_before,created_at) VALUES ('exec_crash',?,'PHOENIX',1,'EXECUTING',0,?)").run(token.id, Date.now() - 120_000);
    p.db.prepare("UPDATE destiny_states SET state='EXECUTING', updated_at=? WHERE token_id=?").run(Date.now() - 120_000, token.id);
    const r = p.crank(token.id);
    expect(p.db.prepare("SELECT status, error FROM destiny_executions WHERE id='exec_crash'").get()).toMatchObject({ status: "FAILED", error: "stale execution recovered" });
    // the recovery marks the coin FAILED and the next attempt (seq 2) proceeds once eligible again
    expect(["COMPLETED", "FAILED", "ACCUMULATING"]).toContain(r.state); // cooldown after the recovery, or retried at once
    expect(p.verifyIntegrity().problems.filter((x) => /stuck/.test(x))).toEqual([]);
  });

  it("the operator breaker stops executions and launches, resumes cleanly, and is audited", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p);
    for (let i = 0; i < 40; i++) buy(p, token.id, t, sol(1));
    p.setPaused(true);
    expect(p.crank(token.id)).toMatchObject({ executed: false, reason: /paused/ });
    expect(() => launch(p, "ECHO")).toThrow(/paused/);
    p.setPaused(false);
    expect(p.crank(token.id).executed).toBe(true);
    const audit = p.db.prepare("SELECT type FROM events WHERE type IN ('protocol.paused','protocol.resumed') ORDER BY id").all() as { type: string }[];
    expect(audit.map((a) => a.type)).toEqual(["protocol.paused", "protocol.resumed"]);
  });
});

describe("reconciliation", () => {
  it("passes on a consistent ledger through trades, executions, graduation and claims", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const { token: echo } = launch(p, "ECHO", { params: { minBalance: 1n, epochMs: 10_000 } });
    const t = trader(p, sol(400));
    for (let i = 0; i < 40; i++) { buy(p, token.id, t, sol(1)); buy(p, echo.id, t, sol(1)); }
    sell(p, token.id, t, 1_000_000n);
    expect(p.crank(token.id).executed).toBe(true);
    timeTravel(p, 20_000);
    expect(p.crank(echo.id).executed).toBe(true);
    const integ = p.verifyIntegrity();
    expect(integ.problems).toEqual([]);
    expect(integ.checked).toBeGreaterThan(0);
  });

  it("detects tampering: a vault credit outside the engine, or a burn count edit", () => {
    const p = fresh();
    const { token } = launch(p, "PHOENIX");
    const t = trader(p);
    buy(p, token.id, t, sol(1));
    p.db.prepare("UPDATE wallets SET lamports = lamports + 1 WHERE address=?").run(`vault:${token.id}`);
    expect(p.verifyIntegrity().problems.some((x) => /vault drift/.test(x))).toBe(true);
    p.db.prepare("UPDATE wallets SET lamports = lamports - 1 WHERE address=?").run(`vault:${token.id}`);
    p.db.prepare("UPDATE tokens SET burned = burned + 5, circulating = circulating - 5 WHERE id=?").run(token.id);
    expect(p.verifyIntegrity().problems.some((x) => /burn drift/.test(x))).toBe(true);
  });
});

describe("keeper heartbeat", () => {
  it("records and ages a heartbeat", () => {
    const p = fresh();
    expect(p.keeperHeartbeat()).toBeNull();
    p.heartbeat("worker", { tick: 3 });
    const hb = p.keeperHeartbeat()!;
    expect(hb.source).toBe("worker");
    expect(hb.ageMs).toBeLessThan(1000);
  });
});
