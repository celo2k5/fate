/**
 * Post-graduation and Orbit verification by SIMULATION on mainnet (nothing is signed by a real key, nothing is sent).
 *
 *   npx tsx scripts/verify-amm-sim.ts            (uses FATE_RPC_URL or the public mainnet RPC)
 *
 * It finds a live graduated pump.fun coin from recent PumpSwap events, borrows a recent trader with SOL as the fee payer
 * (simulation only: sigVerify off), and has the real programs execute what FATE's agents would build:
 *   - AMM event decoding on real Buy/Sell transactions
 *   - Phoenix after graduation: pool buy + burn in one transaction
 *   - Gravity after graduation: pool buy + deposit (LP minted) in one simulated transaction
 *   - pool creator-fee sweep + collect for the pool's real coin creator
 *   - Orbit: Jupiter SOL→USDC and SOL→JitoSOL swaps built for the payer
 * Prints exactly which checks passed; a failure exits 1 with the program logs.
 */
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import { createBurnInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import { PUMP_AMM_PROGRAM_ID, PUMP_SDK } from "@pump-fun/pump-sdk";
import { OnlinePumpAmmSdk, PUMP_AMM_SDK } from "@pump-fun/pump-swap-sdk";

process.env.FATE_CHAIN = "mainnet";
process.env.FATE_DB_PATH ??= ":memory:";
process.env.FATE_RATELIMIT = "off";

async function main() {
  const { connection, withRetry } = await import("../src/chain/rpc");
  const pump = await import("../src/chain/pump");
  const amm = await import("../src/chain/amm");
  const jup = await import("../src/chain/jupiter");
  const c = connection();
  const checks: string[] = [];
  const ok = (s: string) => { checks.push(s); console.log("  ✓", s); };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const sim = async (label: string, payer: PublicKey, ixs: TransactionInstruction[], units = 600_000) => {
    const { blockhash } = await c.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...ixs] }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    const r = await withRetry(`simulate(${label})`, () => c.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }), 6, 2000);
    if (r.value.err) throw new Error(`${label} simulation failed: ${JSON.stringify(r.value.err)}\n    ${(r.value.logs ?? []).slice(-8).join("\n    ")}`);
    return r.value;
  };

  // 1. a live graduated coin + a funded recent trader, from real PumpSwap events
  console.log("finding a live PumpSwap pool from recent program activity…");
  const sigs = await c.getSignaturesForAddress(PUMP_AMM_PROGRAM_ID, { limit: 40 }, "confirmed");
  let found: { mint: PublicKey; pool: PublicKey; trader: PublicKey } | null = null;
  let decoded = 0;
  for (const s of sigs) {
    if (s.err || found) continue;
    await sleep(250);
    const tx = await pump.getTx(s.signature).catch(() => null);
    if (!tx) continue;
    const { buys, sells } = pump.decodeAmmEvents(tx);
    decoded += buys.length + sells.length;
    for (const e of [...buys, ...sells]) {
      const poolAcct = await new OnlinePumpAmmSdk(c).fetchPool(e.pool).catch(() => null);
      if (!poolAcct || !poolAcct.quoteMint.equals(new PublicKey("So11111111111111111111111111111111111111112"))) continue;
      if (!amm.canonicalPumpPoolPda(poolAcct.baseMint).equals(e.pool)) continue; // only canonical (graduated pump.fun) pools
      const bal = await c.getBalance(e.user);
      const info = await c.getAccountInfo(e.user);
      if (bal > 300_000_000 && info?.owner.equals(new PublicKey("11111111111111111111111111111111"))) { found = { mint: poolAcct.baseMint, pool: e.pool, trader: e.user }; break; }
    }
  }
  if (!decoded) throw new Error("no PumpSwap events decoded from recent transactions");
  ok(`decoded ${decoded} PumpSwap Buy/Sell events from live mainnet transactions`);
  if (!found) throw new Error("no canonical SOL pool with a funded system-account trader in the sample; re-run");
  ok(`graduated coin ${found.mint.toBase58()} (pool ${found.pool.toBase58().slice(0, 8)}…), simulation payer ${found.trader.toBase58().slice(0, 8)}…`);
  const pool = await amm.fetchPool(found.mint);
  if (!pool) throw new Error("fetchPool returned null for a live pool");
  ok(`fetchPool: base ${pool.baseReserve} / quote ${pool.quoteReserve} lamports, LP supply ${pool.lpSupply}, coinCreator ${pool.coinCreator.slice(0, 8)}…`);

  // a stand-in authority: the borrowed payer's public key, a throwaway secret (signature is never checked)
  const authority = { publicKey: found.trader, secretKey: Keypair.generate().secretKey } as Keypair;
  const lamports = 20_000_000n, slip = 1500;

  // 2. Phoenix after graduation: buy + burn atomically
  const st = await new OnlinePumpAmmSdk(c).swapSolanaState(found.pool, found.trader);
  const q = amm.quoteBuy(st, lamports, slip);
  const buyIxs = await PUMP_AMM_SDK.buyQuoteInput(st, new BN(lamports.toString()), slip / 100);
  const ata = getAssociatedTokenAddressSync(found.mint, found.trader, true, st.baseTokenProgram);
  const burn = createBurnInstruction(ata, found.mint, found.trader, q.minBase, [], st.baseTokenProgram);
  const s1 = await sim("phoenix pool buy+burn", found.trader, [...buyIxs, burn]);
  if (!(s1.logs ?? []).some((l) => /Instruction: Burn/.test(l))) throw new Error("burn instruction did not run");
  ok(`Phoenix (graduated): PumpSwap buy of ${lamports} lamports + burn of ${q.minBase} base units simulated OK in one tx (${s1.unitsConsumed} CU)`);
  // also through FATE's own builder (amm.buildPoolBuybackBurnTx), simulated
  const built = await amm.buildPoolBuybackBurnTx({ authority, mint: found.mint, lamports, slippageBps: slip });
  const s1b = await c.simulateTransaction(built.tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (s1b.value.err) throw new Error(`buildPoolBuybackBurnTx simulation failed: ${JSON.stringify(s1b.value.err)} ${(s1b.value.logs ?? []).slice(-6).join(" | ")}`);
  ok(`FATE builder buildPoolBuybackBurnTx simulated OK (${s1b.value.unitsConsumed} CU, burn floor ${built.burnFloor})`);

  // 3. Gravity after graduation: buy then deposit at pool ratio (one simulated tx so the deposit sees the bought tokens)
  const ls = await new OnlinePumpAmmSdk(c).liquiditySolanaState(found.pool, found.trader);
  const depPlan = PUMP_AMM_SDK.depositBaseInput(ls, new BN((q.minBase / 2n).toString()), slip / 100);
  const depIxs = await PUMP_AMM_SDK.depositInstructions(ls, depPlan.lpToken, slip / 100);
  const s2 = await sim("gravity pool buy+deposit", found.trader, [...buyIxs, ...depIxs], 800_000);
  if (!(s2.logs ?? []).some((l) => /Instruction: Deposit/i.test(l))) throw new Error("deposit instruction did not run");
  ok(`Gravity (graduated): buy + deposit of ${q.minBase / 2n} base / ${depPlan.quote} lamports for ${depPlan.lpToken} LP simulated OK (${s2.unitsConsumed} CU)`);

  // 4. creator fee sweep + collect for the pool's real coin creator
  const creator = new PublicKey(pool.coinCreator);
  const sweep = await PUMP_SDK.sweepPoolCreatorFeeInstruction({ payer: found.trader, mint: found.mint, coinCreator: creator, quoteMint: new PublicKey(pool.quoteMint) });
  const collect = await pump.collectFeesIxs(creator);
  const s3 = await sim("sweep+collect", found.trader, [sweep, ...collect], 400_000);
  ok(`creator fees (graduated): sweep_creator_fee + collect (${collect.length} ix) simulated OK for coin creator ${creator.toBase58().slice(0, 8)}… (${s3.unitsConsumed} CU)`);

  // 5. Orbit via Jupiter
  for (const asset of ["USDC", "LST"] as const) {
    const quote = await jup.quoteSolTo(asset, 50_000_000n, 300);
    const tx = await jup.buildSwapTx(quote, found.trader);
    await sleep(2500);
    const r = await withRetry("simulate(jupiter)", () => c.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }), 6, 2000);
    if (r.value.err) throw new Error(`Jupiter ${asset} swap simulation failed: ${JSON.stringify(r.value.err)} ${(r.value.logs ?? []).slice(-5).join(" | ")}`);
    ok(`Orbit leg ${asset}: Jupiter quote 0.05 SOL → ${quote.outAmount} (floor ${quote.otherAmountThreshold}, impact ${(Number(quote.priceImpactPct) * 1e4).toFixed(1)} bps), swap tx simulated OK (${r.value.unitsConsumed} CU)`);
    await sleep(500);
  }
  console.log(JSON.stringify({ cluster: "mainnet-beta", mode: "simulation only (sigVerify off, nothing sent)", checks }, null, 2));
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
