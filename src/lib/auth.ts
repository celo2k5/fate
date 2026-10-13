import "server-only";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getProtocol } from "@/engine/keeper";
import { isBase58Address } from "@/engine/ids";
import { EngineError } from "@/engine/units";

export const SESSION_COOKIE = "fate_session";
const SESSION_TTL = 7 * 24 * 3_600_000;
const INTENT_MAX_AGE = 5 * 60_000;

export function verifySignature(message: string, signatureB58: string, address: string): boolean {
  try {
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(address);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pub);
  } catch {
    return false;
  }
}

export function issueNonce(address: string) {
  if (!isBase58Address(address)) throw new EngineError("BAD_ADDRESS", "invalid wallet address");
  const p = getProtocol();
  const nonce = bs58.encode(randomBytes(16));
  p.db.prepare("INSERT INTO auth_nonces(nonce, address, created_at, used) VALUES (?,?,?,0)").run(nonce, address, Date.now());
  const message = `FATE sign-in\n\nWallet: ${address}\nNonce: ${nonce}\nNetwork: simnet\n\nSigning proves you control this wallet. It costs nothing and moves no funds.`;
  return { nonce, message };
}

export async function createSession(address: string, message: string, signature: string, provider: string) {
  const p = getProtocol();
  const m = /Nonce: (\S+)/.exec(message);
  if (!m) throw new EngineError("BAD_MESSAGE", "malformed sign-in message");
  const row = p.db.prepare("SELECT address, used, created_at FROM auth_nonces WHERE nonce=?").get(m[1]) as { address: string; used: bigint; created_at: bigint } | undefined;
  if (!row || row.address !== address || row.used) throw new EngineError("BAD_NONCE", "unknown or used nonce");
  if (Number(row.created_at) + INTENT_MAX_AGE < Date.now()) throw new EngineError("EXPIRED", "sign-in request expired — try again");
  if (!verifySignature(message, signature, address)) throw new EngineError("BAD_SIGNATURE", "signature does not verify");
  p.db.prepare("UPDATE auth_nonces SET used=1 WHERE nonce=?").run(m[1]);
  p.ensureWallet(address, "user");
  const id = bs58.encode(randomBytes(24));
  const t = Date.now();
  p.db.prepare("INSERT INTO wallet_sessions(id,address,nonce,provider,created_at,expires_at) VALUES (?,?,?,?,?,?)").run(id, address, m[1], provider, t, t + SESSION_TTL);
  const c = await cookies();
  c.set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL / 1000 });
  return { address, provider };
}

export async function getSession(): Promise<{ address: string; provider: string } | null> {
  const c = await cookies();
  const id = c.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const p = getProtocol();
  const s = p.db.prepare("SELECT address, provider, expires_at FROM wallet_sessions WHERE id=?").get(id) as { address: string; provider: string; expires_at: bigint } | undefined;
  if (!s || Number(s.expires_at) < Date.now()) return null;
  return { address: s.address, provider: s.provider };
}

export async function requireSession() {
  const s = await getSession();
  if (!s) throw new EngineError("UNAUTHENTICATED", "connect a wallet first");
  return s;
}

export async function endSession() {
  const c = await cookies();
  const id = c.get(SESSION_COOKIE)?.value;
  if (id) getProtocol().db.prepare("DELETE FROM wallet_sessions WHERE id=?").run(id);
  c.delete(SESSION_COOKIE);
}

/**
 * A signed intent is the simnet stand-in for a signed transaction: the wallet
 * signs a canonical JSON message, the server verifies the signature against
 * the session's wallet, checks freshness, and uses the signature as the
 * idempotency key ("transaction signature").
 */
export interface SignedIntent<T = Record<string, unknown>> { message: string; signature: string; intent: T }

export function verifyIntent<T extends { kind: string; address: string; issuedAt: number }>(body: unknown, expectedKind: string, sessionAddress: string): SignedIntent<T> {
  const b = body as { message?: string; signature?: string };
  if (!b || typeof b.message !== "string" || typeof b.signature !== "string") throw new EngineError("BAD_INTENT", "missing signed intent");
  let intent: T;
  try { intent = JSON.parse(b.message) as T; } catch { throw new EngineError("BAD_INTENT", "intent is not JSON"); }
  if (intent.kind !== expectedKind) throw new EngineError("BAD_INTENT", `expected ${expectedKind} intent`);
  if (intent.address !== sessionAddress) throw new EngineError("BAD_INTENT", "intent signed by a different wallet");
  if (typeof intent.issuedAt !== "number" || Math.abs(Date.now() - intent.issuedAt) > INTENT_MAX_AGE) throw new EngineError("EXPIRED", "intent expired — sign again");
  if (!verifySignature(b.message, b.signature, sessionAddress)) throw new EngineError("BAD_SIGNATURE", "wallet signature does not verify");
  return { message: b.message, signature: b.signature, intent };
}
