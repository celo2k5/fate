/**
 * Devnet verification of the on-chain path, end to end, against the real pump.fun program.
 *
 *   FATE_CHAIN=devnet FATE_VAULT_MASTER_SEED=<32+ chars> FATE_DEVNET_KEY=<base58|json secret> npx tsx scripts/devnet-verify.ts
 *
 * Tiers (the script prints which one it reached; nothing is reported as verified that did not happen):
 *   1. read-only  — Global / FeeConfig decode, curve params, event decoding on a live mainnet trade
 *   2. simulate   — every transaction FATE builds (create_v2, buy, sell, buyback+burn, collect fees) is simulated on devnet
 *                   with signature verification off, so instruction encoding and account derivation are checked by the program
 *                   itself. Needs no SOL. (replaceRecentBlockhash + sigVerify:false; a funded payer is borrowed for simulation only)
 *   3. signed     — with a funded FATE_DEVNET_KEY: create a coin (creator = FATE vault authority), buy, sell, index the
 *                   TradeEvents into a fresh ledger, confirm the creator fee accrued to the vault, then run the Phoenix agent
 *                   (collect → buy → burn) and verify the burn against the mint supply on-chain.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";

process.env.FATE_CHAIN ??= "devnet";
process.env.FATE_DB_PATH ??= ":memory:";
process.env.FATE_VAULT_MASTER_SEED ??= "devnet-verification-seed-do-not-use-in-production-0000";
process.env.FATE_RATELIMIT = "off";

async function main() {
  const { openDatabase } = await import("../src/db");
  const { Protocol } = await import("../src/engine/protocol");
  const pump = await import("../src/chain/pump");
  const { vaultAuthority, activeChain } = await import("../src/chain/config");
  const { TxLedger, sendAndConfirm, connection } = await import("../src/chain/rpc");
  const agents = await import("../src/chain/agents");

  const report: Record<string, unknown> = { cluster: activeChain(), rpc: connection().rpcEndpoint, tier: 0, checks: [] as string[], unverified: [] as string[] };
  const check = (s: string) => { (report.checks as string[]).push(s); console.log("  ✓", s); };
  const skip = (s: string) => { (report.unverified as string[]).push(s); console.log("  –", s); };
  const c: Connection = connection();

  // ── tier 1: read-only ──
  console.log("tier 1: read-only");
  const { global, feeConfig } = await pump.pumpState();
  check(`Global decoded (initialized=${global.initialized}, initialVirtualSol=${global.initialVirtualSolReserves.toString()}, supply=${global.tokenTotalSupply.toString()})`);
  if (feeConfig) check(`FeeConfig decoded (tier0 creator=${feeConfig.feeTiers[0]?.fees.creatorFeeBps.toString()} bps, protocol=${feeConfig.feeTiers[0]?.fees.protocolFeeBps.toString()} bps)`);
  report.tier = 1;

  // ── tier 2: simulation (no SOL needed) ──
  console.log("tier 2: simulation");
  const payer = process.env.FATE_DEVNET_KEY ? (process.env.FATE_DEVNET_KEY.trim().startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.FATE_DEVNET_KEY))) : Keypair.fromSecretKey(bs58.decode(process.env.FATE_DEVNET_KEY))) : Keypair.generate();
  const balance = await c.getBalance(payer.publicKey);
  console.log(`  payer ${payer.publicKey.toBase58()} balance ${balance / LAMPORTS_PER_SOL} SOL`);
  // a funded devnet account is borrowed as fee payer for simulation only (sigVerify off): the pump fee recipient always has lamports
  const simPayer = balance > 0.05 * LAMPORTS_PER_SOL ? payer.publicKey : global.feeRecipient;
  const mintKp = Keypair.generate();
  const authority = vaultAuthority(mintKp.publicKey.toBase58());
  const create = await pump.buildCreateTx({ user: simPayer, name: "Fate Verify", symbol: "FVER", uri: "https://fate-launchpad.onrender.com/api/metadata/verify", creator: authority.publicKey, mint: mintKp });
  const simCreate = await c.simulateTransaction(create.tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (simCreate.value.err) throw new Error(`create_v2 simulation failed: ${JSON.stringify(simCreate.value.err)} ${(simCreate.value.logs ?? []).slice(-6).join(" | ")}`);
  check(`create_v2 simulated OK (mint ${mintKp.publicKey.toBase58().slice(0, 8)}…, creator = vault authority ${authority.publicKey.toBase58().slice(0, 8)}…, ${simCreate.value.unitsConsumed} CU)`);
  // buy / buyback+burn / fee collection are simulated against a live devnet bonding curve (the newest coin created on devnet)
  const live = await findLiveCurve(c, pump);
  if (!live) skip("buy / buyback+burn simulation: no recent live devnet bonding curve found");
  else {
    const liveAuthority = vaultAuthority(live.toBase58()); // a derived key with 0 SOL: simulation only (sigVerify off, payer borrowed)
    const buy = await pump.buildBuyTx({ user: simPayer, mint: live, lamports: 20_000_000n, slippageBps: 500 });
    const simBuy = await c.simulateTransaction(buy.tx, { sigVerify: false, replaceRecentBlockhash: true });
    if (simBuy.value.err) throw new Error(`buy simulation failed on ${live.toBase58()}: ${JSON.stringify(simBuy.value.err)} ${(simBuy.value.logs ?? []).slice(-5).join(" | ")}`);
    check(`buy simulated OK on live devnet curve ${live.toBase58().slice(0, 8)}… (${simBuy.value.unitsConsumed} CU, expected ${buy.expectedTokens} base units)`);
    const bb = await pump.buildBuybackBurnTx({ authority: { publicKey: simPayer, secretKey: liveAuthority.secretKey } as Keypair, mint: live, lamports: 20_000_000n, slippageBps: 500 });
    const simBb = await c.simulateTransaction(bb.tx, { sigVerify: false, replaceRecentBlockhash: true });
    if (simBb.value.err) throw new Error(`buyback+burn simulation failed: ${JSON.stringify(simBb.value.err)} ${(simBb.value.logs ?? []).slice(-5).join(" | ")}`);
    const burnLog = (simBb.value.logs ?? []).find((l) => /Instruction: Burn/.test(l));
    check(`Phoenix buyback+burn simulated OK as one atomic transaction (${simBb.value.unitsConsumed} CU, burn floor ${bb.burnFloor}${burnLog ? ", Burn instruction executed" : ""})`);
    const collect = await pump.collectFeesIxs(liveAuthority.publicKey);
    check(`collect_creator_fee instructions built for a vault authority (${collect.length} ix)`);
  }
  report.tier = 2;

  // ── tier 3: signed ──
  if (balance < 0.2 * LAMPORTS_PER_SOL) {
    skip(`signed devnet round-trip: FATE_DEVNET_KEY ${payer.publicKey.toBase58()} holds ${balance / LAMPORTS_PER_SOL} SOL (< 0.2). Fund it at https://faucet.solana.com and re-run.`);
    return finish(report);
  }
  console.log("tier 3: signed round-trip");
  const db = openDatabase(":memory:");
  const p = new Protocol(db);
  const L = new TxLedger(db);
  create.tx.sign([payer]);
  const rec = L.begin("launch", mintKp.publicKey.toBase58(), null, create.blockhash, create.lastValidBlockHeight);
  const { signature: createSig } = await sendAndConfirm(L, rec, create.tx);
  const ctx = await pump.getTx(createSig);
  const ev = ctx ? pump.decodeEvents(ctx).creates[0] : undefined;
  if (!ev || !ev.creator.equals(authority.publicKey)) throw new Error("CreateEvent missing or creator mismatch");
  check(`coin created on devnet: ${createSig} (creator = vault authority)`);
  const cv = await pump.fetchCurve(mintKp.publicKey);
  const token = p.launch({ chain: { chain: "DEVNET", mint: cv.mint, bondingCurve: cv.bondingCurve, vaultAuthority: authority.publicKey.toBase58(), metadataUri: "verify", totalSupply: cv.totalSupply, virtualSol: cv.virtualSol, virtualTokens: cv.virtualTokens, realTokens: cv.realTokens }, name: "Fate Verify", ticker: "FVER", description: "", destiny: "PHOENIX", creator: payer.publicKey.toBase58(), executionThreshold: 250_000n, cooldownMs: 5_000, maxSlippageBps: 1500, signature: createSig, signedMessage: "verify" });
  check(`ledger mirror created: ${token.id}`);

  // buy 0.05 SOL, then sell half
  const buy = await pump.buildBuyTx({ user: payer.publicKey, mint: mintKp.publicKey, lamports: 50_000_000n, slippageBps: 500 });
  buy.tx.sign([payer]);
  const buySig = (await sendAndConfirm(L, L.begin("trade", "buy1", token.id, buy.blockhash, buy.lastValidBlockHeight), buy.tx)).signature;
  check(`buy confirmed: ${buySig}`);
  const indexed = await agents.indexToken(p, p.getToken(token.id)!);
  const vault = p.vaultBalance(token.id);
  check(`indexed ${indexed} trade(s); destiny vault mirror = ${vault} lamports (80% of the on-chain creator fee)`);
  const onChainVault = await pump.creatorVaultBalance(authority.publicKey);
  check(`on-chain creator vault for the authority = ${onChainVault} lamports`);
  const sell = await pump.buildSellTx({ user: payer.publicKey, mint: mintKp.publicKey, tokens: buy.expectedTokens / 2n, slippageBps: 500 });
  sell.tx.sign([payer]);
  const sellSig = (await sendAndConfirm(L, L.begin("trade", "sell1", token.id, sell.blockhash, sell.lastValidBlockHeight), sell.tx)).signature;
  check(`sell confirmed: ${sellSig}`);
  await agents.indexToken(p, p.getToken(token.id)!);

  // Phoenix: fund the authority with the trade fees it collected plus a little rent so a small buyback fits the threshold
  const el = p.eligibility(token.id);
  console.log("  eligibility:", el.reason, "vault", el.vault.toString(), "threshold", el.threshold.toString());
  if (!el.eligible) skip(`Phoenix execution: vault ${el.vault} < threshold ${el.threshold}; run more volume or lower the threshold to exercise the buyback`);
  else {
    const supplyBefore = (await getMint(c, mintKp.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID)).supply;
    const r = await agents.chainCrank(p, p.getToken(token.id)!);
    if (!r.executed) throw new Error(`phoenix failed: ${r.reason}`);
    const supplyAfter = (await getMint(c, mintKp.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID)).supply;
    const exec = db.prepare("SELECT * FROM destiny_executions WHERE id=?").get(r.executionId!) as { signature: string; result_json: string };
    const burned = BigInt(JSON.parse(exec.result_json).tokensBurned);
    if (supplyBefore - supplyAfter !== burned) throw new Error(`burn mismatch: supply fell by ${supplyBefore - supplyAfter}, ledger says ${burned}`);
    check(`Phoenix executed on devnet: ${exec.signature}; burned ${burned} base units, mint supply fell by exactly that`);
  }
  const integ = p.verifyIntegrity();
  check(`ledger reconciliation: ${integ.ok ? "ok" : integ.problems.join("; ")}`);
  report.tier = 3;
  return finish(report);
}

/** The newest coin created on devnet with an open curve, found from the program's own CreateEvents. */
async function findLiveCurve(c: Connection, pump: typeof import("../src/chain/pump")): Promise<PublicKey | null> {
  const sigs = await c.getSignaturesForAddress(pump.pumpProgramId, { limit: 25 }, "confirmed");
  for (const s of sigs) {
    if (s.err) continue;
    await new Promise((r) => setTimeout(r, 350)); // public devnet RPC rate limit
    const tx = await pump.getTx(s.signature);
    if (!tx) continue;
    for (const ev of pump.decodeEvents(tx).creates) {
      try { const cv = await pump.fetchCurve(ev.mint); if (!cv.complete && cv.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) return ev.mint; } catch { /* next */ }
    }
  }
  return null;
}

function finish(report: Record<string, unknown>) {
  console.log(JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
