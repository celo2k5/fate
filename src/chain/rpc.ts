import { Connection, VersionedTransaction, type Commitment } from "@solana/web3.js";
import type { DB } from "@/db";
import { cluster, rpcUrl } from "./config";
import { newId } from "@/engine/ids";
import { log } from "@/lib/log";

const rlog = log.child({ component: "rpc" });

let conn: { url: string; c: Connection } | null = null;
export function connection(): Connection {
  const url = rpcUrl();
  if (!conn || conn.url !== url) conn = { url, c: new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }) };
  return conn.c;
}

/** Retry with exponential backoff + jitter for transient RPC failures (429, 5xx, network). Deterministic errors are thrown at once. */
export async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 6, baseMs = 700): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /429|Too Many|rate|timeout|ECONNRESET|ETIMEDOUT|fetch failed|503|502|504|Blockhash not found|node is behind|Network request failed/i.test(msg);
      if (!transient || i === attempts - 1) throw e;
      const wait = baseMs * 2 ** i + Math.random() * 200;
      rlog.warn("retry", { what, attempt: i + 1, waitMs: Math.round(wait), error: msg.slice(0, 140) });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export interface TxRecord { id: string; purpose: string; token_id: string | null; reference_id: string | null; signature: string | null; status: "BUILT" | "SENT" | "CONFIRMED" | "FAILED" | "EXPIRED"; blockhash: string | null; last_valid_block_height: bigint | null; slot: bigint | null; error: string | null; lamports: bigint; attempts: bigint }

/**
 * Durable transaction tracking. Every built transaction gets a row keyed by (purpose, reference) so a retry after a
 * crash re-uses the row instead of double-submitting; `confirmPending` is run by the keeper on every tick.
 */
export class TxLedger {
  constructor(private db: DB) {}

  begin(purpose: string, referenceId: string, tokenId: string | null, blockhash: string, lastValidBlockHeight: number, lamports = 0n): TxRecord {
    const existing = this.get(purpose, referenceId);
    const t = Date.now();
    if (existing) {
      if (existing.status === "CONFIRMED") return existing;
      if (existing.status === "SENT") return existing; // still in flight: caller must wait for confirmPending
      this.db.prepare("UPDATE chain_txs SET status='BUILT', blockhash=?, last_valid_block_height=?, error=NULL, lamports=?, attempts=attempts+1, updated_at=? WHERE id=?").run(blockhash, lastValidBlockHeight, lamports, t, existing.id);
      return this.get(purpose, referenceId)!;
    }
    const id = newId("tx");
    this.db.prepare("INSERT INTO chain_txs(id,cluster,purpose,token_id,reference_id,status,blockhash,last_valid_block_height,lamports,attempts,created_at,updated_at) VALUES (?,?,?,?,?,'BUILT',?,?,?,1,?,?)")
      .run(id, cluster(), purpose, tokenId, referenceId, blockhash, lastValidBlockHeight, lamports, t, t);
    return this.get(purpose, referenceId)!;
  }
  get(purpose: string, referenceId: string): TxRecord | undefined {
    return this.db.prepare("SELECT * FROM chain_txs WHERE purpose=? AND reference_id=?").get(purpose, referenceId) as TxRecord | undefined;
  }
  markSent(id: string, signature: string) { this.db.prepare("UPDATE chain_txs SET status='SENT', signature=?, updated_at=? WHERE id=?").run(signature, Date.now(), id); }
  markConfirmed(id: string, slot: number) { this.db.prepare("UPDATE chain_txs SET status='CONFIRMED', slot=?, error=NULL, updated_at=? WHERE id=?").run(slot, Date.now(), id); }
  markFailed(id: string, error: string, status: "FAILED" | "EXPIRED" = "FAILED") { this.db.prepare("UPDATE chain_txs SET status=?, error=?, updated_at=? WHERE id=?").run(status, error.slice(0, 500), Date.now(), id); }
  pending(): TxRecord[] { return this.db.prepare("SELECT * FROM chain_txs WHERE status='SENT' ORDER BY updated_at ASC LIMIT 50").all() as TxRecord[]; }
}

/**
 * Send a signed transaction and wait for confirmation, with blockhash-expiry detection. A transaction whose
 * blockhash expired without landing is marked EXPIRED (safe to rebuild and resend: it can never land later).
 */
export async function sendAndConfirm(ledger: TxLedger, rec: TxRecord, tx: VersionedTransaction, commitment: Commitment = "confirmed"): Promise<{ signature: string; slot: number }> {
  const c = connection();
  const raw = tx.serialize();
  const signature = await withRetry("sendRawTransaction", () => c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3, preflightCommitment: commitment }), 3);
  ledger.markSent(rec.id, signature);
  rlog.info("tx.sent", { purpose: rec.purpose, reference: rec.reference_id, signature });
  const lastValid = Number(rec.last_valid_block_height ?? 0);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const st = await withRetry("getSignatureStatuses", () => c.getSignatureStatuses([signature]), 3);
    const s = st.value[0];
    if (s) {
      if (s.err) { const msg = `transaction failed on-chain: ${JSON.stringify(s.err)}`; ledger.markFailed(rec.id, msg); throw new Error(msg); }
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") { ledger.markConfirmed(rec.id, s.slot); rlog.info("tx.confirmed", { signature, slot: s.slot }); return { signature, slot: s.slot }; }
    }
    const height = await withRetry("getBlockHeight", () => c.getBlockHeight(commitment), 3);
    if (lastValid && height > lastValid) { ledger.markFailed(rec.id, "blockhash expired before confirmation", "EXPIRED"); throw new Error("blockhash expired before confirmation"); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("confirmation timed out; status will be re-checked by the keeper");
}

/** Re-check every SENT transaction (after a crash or a timeout) and settle it as CONFIRMED / FAILED / EXPIRED. */
export async function confirmPending(ledger: TxLedger): Promise<{ confirmed: number; failed: number; expired: number; pending: number }> {
  const out = { confirmed: 0, failed: 0, expired: 0, pending: 0 };
  const rows = ledger.pending();
  if (!rows.length) return out;
  const c = connection();
  const statuses = await withRetry("getSignatureStatuses", () => c.getSignatureStatuses(rows.map((r) => r.signature!), { searchTransactionHistory: true }), 3);
  const height = await withRetry("getBlockHeight", () => c.getBlockHeight("confirmed"), 3);
  rows.forEach((r, i) => {
    const s = statuses.value[i];
    if (s?.err) { ledger.markFailed(r.id, `transaction failed on-chain: ${JSON.stringify(s.err)}`); out.failed++; }
    else if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) { ledger.markConfirmed(r.id, s.slot); out.confirmed++; }
    else if (r.last_valid_block_height && height > Number(r.last_valid_block_height)) { ledger.markFailed(r.id, "blockhash expired", "EXPIRED"); out.expired++; }
    else out.pending++;
  });
  return out;
}
