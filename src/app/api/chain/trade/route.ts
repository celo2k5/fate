import { z } from "zod";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ok, fail } from "@/lib/api";
import { requireSession, verifyIntent } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { getProtocol } from "@/engine/keeper";
import { EngineError } from "@/engine/units";
import { activeChain } from "@/chain/config";
import { TxLedger, sendAndConfirm } from "@/chain/rpc";
import * as pump from "@/chain/pump";
import { indexToken } from "@/chain/agents";
import { newId } from "@/engine/ids";

export const dynamic = "force-dynamic";
interface TradeIntent { kind: "trade"; address: string; issuedAt: number; tokenId: string; side: "BUY" | "SELL"; amountIn: string; minOut: string; slippageBps: number }

function requireChain() { if (activeChain() === "simnet") throw new EngineError("SIMNET", "this deployment runs the simnet ledger; use /api/tokens/[id]/trade"); }

/** Prepare: a signed trade intent → the real pump.fun buy/sell transaction for the user's wallet (fee payer = user). */
export async function POST(req: Request) {
  try {
    rateLimit("chain", req);
    requireChain();
    const s = await requireSession();
    const p = getProtocol();
    const { intent } = verifyIntent<TradeIntent>(await req.json(), "trade", s.address);
    const t = p.getToken(intent.tokenId);
    if (!t || !t.mint) throw new EngineError("NOT_FOUND", "on-chain coin not found");
    if (!/^\d+$/.test(intent.amountIn) || BigInt(intent.amountIn) <= 0n) throw new EngineError("BAD_AMOUNT", "amountIn must be a positive integer");
    const slippageBps = Math.min(5000, Math.max(10, Number(intent.slippageBps) || 100));
    const user = new PublicKey(s.address);
    const mint = new PublicKey(t.mint);
    const built = intent.side === "BUY"
      ? await pump.buildBuyTx({ user, mint, lamports: BigInt(intent.amountIn), slippageBps })
      : await pump.buildSellTx({ user, mint, tokens: BigInt(intent.amountIn), slippageBps });
    const id = newId("prep");
    p.db.prepare("INSERT INTO chain_prepares(id,kind,address,token_id,message_b64,payload_json,blockhash,last_valid_block_height,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, intent.side.toLowerCase(), s.address, t.id, Buffer.from(built.tx.message.serialize()).toString("base64"), JSON.stringify(intent), built.blockhash, built.lastValidBlockHeight, Date.now());
    return ok({ prepareId: id, tx: Buffer.from(built.tx.serialize()).toString("base64"), expected: "expectedTokens" in built ? built.expectedTokens : built.expectedLamports, lastValidBlockHeight: built.lastValidBlockHeight });
  } catch (e) { return fail(e); }
}

/** Submit: send the wallet-signed transaction, confirm it, and index its TradeEvent into the ledger. */
export async function PUT(req: Request) {
  try {
    rateLimit("chain", req);
    requireChain();
    const s = await requireSession();
    const p = getProtocol();
    const body = z.object({ prepareId: z.string(), signedTx: z.string() }).parse(await req.json());
    const prep = p.db.prepare("SELECT * FROM chain_prepares WHERE id=? AND address=? AND kind IN ('buy','sell')").get(body.prepareId, s.address) as { token_id: string; message_b64: string; blockhash: string; last_valid_block_height: bigint } | undefined;
    if (!prep) throw new EngineError("NOT_FOUND", "no such prepared trade for this wallet");
    const tx = VersionedTransaction.deserialize(Buffer.from(body.signedTx, "base64"));
    if (Buffer.from(tx.message.serialize()).toString("base64") !== prep.message_b64) throw new EngineError("TAMPERED", "the signed transaction does not match the prepared one");
    const L = new TxLedger(p.db);
    const rec = L.begin("trade", body.prepareId, prep.token_id, prep.blockhash, Number(prep.last_valid_block_height));
    const { signature, slot } = await sendAndConfirm(L, rec, tx);
    const t = p.getToken(prep.token_id)!;
    await indexToken(p, t); // pulls this trade (and any others) from the chain into the ledger
    p.db.prepare("DELETE FROM chain_prepares WHERE id=?").run(body.prepareId);
    const trade = p.db.prepare("SELECT * FROM trades WHERE signature LIKE ? ORDER BY created_at DESC LIMIT 1").get(`${signature}#%`);
    return ok({ signature, slot, trade: trade ?? null, token: p.detail(prep.token_id), explorer: `https://explorer.solana.com/tx/${signature}?cluster=${activeChain() === "mainnet" ? "mainnet-beta" : "devnet"}` });
  } catch (e) { return fail(e); }
}
