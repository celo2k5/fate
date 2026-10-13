import { z } from "zod";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ok, fail } from "@/lib/api";
import { requireSession, verifyIntent } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { getProtocol } from "@/engine/keeper";
import { EngineError, sol } from "@/engine/units";
import { activeChain, chainLabel, vaultAuthority, hasChainSecrets, mainnetBlockers } from "@/chain/config";
import { TxLedger, sendAndConfirm } from "@/chain/rpc";
import * as pump from "@/chain/pump";
import { uploadMetadata } from "@/chain/metadata";
import { newId } from "@/engine/ids";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.literal("launch"), address: z.string(), issuedAt: z.number(),
  name: z.string().trim().min(2).max(32),
  ticker: z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/, "2–8 letters or digits"),
  description: z.string().trim().max(500).default(""),
  image: z.string().max(200_000).nullable().optional(),
  website: z.string().url().max(200).nullable().optional().or(z.literal("")),
  x: z.string().max(80).nullable().optional(),
  telegram: z.string().max(80).nullable().optional(),
  destiny: z.enum(["PHOENIX", "GRAVITY", "ECHO", "ORBIT"]),
  executionThresholdSol: z.number().min(0.25).max(50).optional(),
  cooldownMs: z.number().int().min(5_000).optional(),
  maxSlippageBps: z.number().int().min(50).max(1500).optional(),
  graduationThresholdSol: z.number().min(5).max(300).optional(),
  echoMinBalance: z.number().int().min(1_000).max(10_000_000).optional(),
  echoEpochMs: z.number().int().min(10_000).optional(),
  orbitAllocation: z.object({ SOL: z.number().int(), USDC: z.number().int(), LST: z.number().int(), RESERVE: z.number().int() }).optional(),
});

function requireChain() {
  if (activeChain() === "simnet") throw new EngineError("SIMNET", "this deployment runs the simnet ledger; on-chain launch is disabled (set FATE_CHAIN=devnet|mainnet)");
  if (!hasChainSecrets().vaultSeed) throw new EngineError("NOT_CONFIGURED", "FATE_VAULT_MASTER_SEED is not configured on the server");
  const blockers = mainnetBlockers();
  if (blockers.length) throw new EngineError("MAINNET_DISABLED", `mainnet launches are disabled: ${blockers.join("; ")}`);
}

/** Step 1: validate the signed launch intent, upload metadata, build the `create_v2` transaction for the creator's wallet to sign. */
export async function POST(req: Request) {
  try {
    rateLimit("chain", req);
    requireChain();
    const s = await requireSession();
    const p = getProtocol();
    if (p.isPaused()) throw new EngineError("PAUSED", "launches are paused by the operator");
    const { intent, signature, message } = verifyIntent<z.infer<typeof schema>>(await req.json(), "launch", s.address);
    const v = schema.parse(intent);
    // a fresh mint keypair decides the coin's address; the vault authority (pump.fun `creator`, fee recipient) is derived from it
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;
    const authority = vaultAuthority(mint.toBase58()).publicKey;
    const uri = await uploadMetadata({ name: v.name, symbol: v.ticker.toUpperCase(), description: v.description, image: v.image ?? null, website: v.website || null, x: v.x || null, telegram: v.telegram || null, destiny: v.destiny, mint: mint.toBase58() });
    const built = await pump.buildCreateTx({ user: new PublicKey(s.address), name: v.name, symbol: v.ticker.toUpperCase(), uri, creator: authority, mint: mintKp });
    const id = newId("prep");
    p.db.prepare("INSERT INTO chain_prepares(id,kind,address,token_id,message_b64,payload_json,blockhash,last_valid_block_height,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, "launch", s.address, mint.toBase58(), Buffer.from(built.tx.message.serialize()).toString("base64"),
        JSON.stringify({ ...v, uri, vaultAuthority: authority.toBase58(), signature, message }), built.blockhash, built.lastValidBlockHeight, Date.now());
    return ok({ prepareId: id, mint: mint.toBase58(), vaultAuthority: authority.toBase58(), metadataUri: uri, tx: Buffer.from(built.tx.serialize()).toString("base64"), lastValidBlockHeight: built.lastValidBlockHeight, cluster: activeChain() });
  } catch (e) {
    if (e instanceof z.ZodError) return ok({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
    return fail(e);
  }
}

/** Step 2: the wallet signed it. Verify it is byte-for-byte what we built, send, confirm, read the CreateEvent back, then record the coin. */
export async function PUT(req: Request) {
  try {
    rateLimit("chain", req);
    requireChain();
    const s = await requireSession();
    const p = getProtocol();
    const body = z.object({ prepareId: z.string(), signedTx: z.string() }).parse(await req.json());
    const prep = p.db.prepare("SELECT * FROM chain_prepares WHERE id=? AND kind='launch' AND address=?").get(body.prepareId, s.address) as { token_id: string; message_b64: string; payload_json: string; blockhash: string; last_valid_block_height: bigint } | undefined;
    if (!prep) throw new EngineError("NOT_FOUND", "no such prepared launch for this wallet");
    const tx = VersionedTransaction.deserialize(Buffer.from(body.signedTx, "base64"));
    if (Buffer.from(tx.message.serialize()).toString("base64") !== prep.message_b64) throw new EngineError("TAMPERED", "the signed transaction does not match the prepared one");
    if (!tx.message.staticAccountKeys[0].equals(new PublicKey(s.address))) throw new EngineError("BAD_PAYER", "fee payer is not the session wallet");
    const v = JSON.parse(prep.payload_json) as z.infer<typeof schema> & { uri: string; vaultAuthority: string; signature: string; message: string };
    const L = new TxLedger(p.db);
    const rec = L.begin("launch", prep.token_id, prep.token_id, prep.blockhash, Number(prep.last_valid_block_height));
    const { signature, slot } = await sendAndConfirm(L, rec, tx);
    const confirmed = await pump.getTx(signature);
    const create = confirmed ? pump.decodeEvents(confirmed).creates.find((c) => c.mint.toBase58() === prep.token_id) : undefined;
    if (!create) throw new EngineError("UNVERIFIED", `transaction ${signature} confirmed but no CreateEvent for the mint was decoded; the coin was not recorded`);
    if (create.creator.toBase58() !== v.vaultAuthority) throw new EngineError("UNVERIFIED", "on-chain creator is not the FATE vault authority; not recorded");
    const cv = await pump.fetchCurve(new PublicKey(prep.token_id));
    const token = p.launch({
      chain: { chain: chainLabel() as "DEVNET" | "MAINNET", mint: prep.token_id, bondingCurve: cv.bondingCurve, vaultAuthority: v.vaultAuthority, metadataUri: v.uri, totalSupply: cv.totalSupply, virtualSol: cv.virtualSol, virtualTokens: cv.virtualTokens, realTokens: cv.realTokens },
      name: v.name, ticker: v.ticker, description: v.description, image: v.image ?? null, website: v.website || null, x: v.x || null, telegram: v.telegram || null,
      destiny: v.destiny, creator: s.address,
      executionThreshold: v.executionThresholdSol !== undefined ? sol(v.executionThresholdSol) : undefined,
      cooldownMs: v.cooldownMs, maxSlippageBps: v.maxSlippageBps,
      graduationThreshold: v.graduationThresholdSol !== undefined ? sol(v.graduationThresholdSol) : undefined,
      params: { minBalance: v.echoMinBalance !== undefined ? BigInt(v.echoMinBalance) * 1_000_000n : undefined, epochMs: v.echoEpochMs, allocationBps: v.orbitAllocation },
      signature, signedMessage: v.message,
    });
    p.db.prepare("DELETE FROM chain_prepares WHERE id=?").run(body.prepareId);
    log.info("chain.launched", { mint: prep.token_id, signature, slot, destiny: v.destiny, cluster: activeChain() });
    return ok({ token, signature, slot, explorer: `https://explorer.solana.com/tx/${signature}?cluster=${activeChain() === "mainnet" ? "mainnet-beta" : "devnet"}` });
  } catch (e) {
    if (e instanceof z.ZodError) return ok({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
    return fail(e);
  }
}
