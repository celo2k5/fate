# FATE — verification report (2026-10-13)

Architecture chosen by the owner: **Pump.fun launch + per-coin custodial vault** (the coin's pump.fun creator fee goes to a vault key the
server derives per mint; destiny agents spend it under server policy). Environments: **mock** = unit tests with no network;
**local** = local server; **devnet sim** / **mainnet sim** = real programs simulating FATE-built transactions, nothing sent;
**devnet signed** = real devnet transactions; **mainnet** = real money (never run; not authorized).

| Subsystem | Status | Key files | Verified in | Evidence |
|---|---|---|---|---|
| Branding (official F emblem, favicons, OG/banner, tokens) | done | `public/brand/*`, `src/components/Logo.tsx`, `src/app/globals.css`, `src/app/layout.tsx` | local + live | desktop/mobile screenshots of 6 pages; traced SVG removed (did not match the official geometry); live `/brand/emblem-64.png` 200 |
| Wallet auth (nonce + ed25519 intent signatures, sessions) | done (pre-existing) | `src/lib/auth.ts`, `src/app/api/auth/*` | mock + local | vitest; Playwright journeys sign every action |
| Launch on pump.fun (`create_v2`, creator = vault key, user signs) | done | `src/app/api/chain/launch/route.ts`, `src/chain/pump.ts`, `src/chain/config.ts` | devnet sim | `npm run verify:devnet` tier 2: `create_v2` simulated OK (≈101k CU) with creator = derived vault key. Signed tx is byte-compared to the built one; the coin is recorded only after its CreateEvent is decoded |
| Metadata (Pinata IPFS or self-hosted) | done | `src/chain/metadata.ts`, `src/app/api/metadata/*` | local | IPFS required on mainnet by the breaker |
| Trade path (user-signed buy/sell on the curve) | done | `src/app/api/chain/trade/route.ts`, `src/components/TradePanel.tsx` | devnet sim | buy simulated OK on a live devnet curve (≈101k CU) |
| Trade indexing (curve TradeEvent, PumpSwap Buy/Sell) | done | `src/chain/pump.ts` (`newTrades`, `newPoolTrades`, decoders), `src/chain/agents.ts#indexToken` | devnet + mainnet (read) | AMM events decoded from live mainnet transactions; idempotent by `signature#index` (unit test). A bug was fixed where Anchor camelCases IDL event names, which made AMM decoding silently return nothing |
| Fee accounting (creator fee → 80 % destiny / 20 % protocol) | done | `Protocol.recordChainTrade` | mock | vitest `chain-mirror`, `chain-agents` |
| Fee collection (+ PumpSwap `sweep_creator_fee`) | done | `src/chain/agents.ts#collectFees` | mainnet sim | sweep + collect simulated OK for a real graduated pool's coin creator (≈72k CU) |
| Graduation (observed, not simulated) | done | `syncVenue`, `Protocol.recordChainGraduation` | mock | tests: no simulated graduation for chain coins; the observed graduation is idempotent; curve inventory moves to the pool; reconciliation stays clean |
| Agent: **Phoenix** (buy + burn, curve or PumpSwap) | done | `executePhoenix`, `amm.buildPoolBuybackBurnTx` | devnet sim + mainnet sim | curve buy+burn simulated OK on devnet (Burn instruction ran); PumpSwap buy+burn simulated OK on mainnet via FATE's builder; the burn is checked against the mint-supply delta at runtime |
| Agent: **Gravity** (escrow → PumpSwap deposit, LP kept) | done | `executeGravity`, `amm.buildPoolDepositTx` | mainnet sim | pool buy + deposit simulated OK, LP minted (≈160k CU) |
| Agent: **Echo** (snapshot, forfeits, claim once) | done | `executeEcho`, `payClaim`, claim route | mock | vitest: sellers in an epoch forfeit; claims are reserved once per wallet; payout tx is idempotent. Known limit: transfers out and back within an epoch are not caught |
| Agent: **Orbit** (Jupiter USDC/JitoSOL legs) | done (mainnet only) | `executeOrbit`, `src/chain/jupiter.ts` | mainnet sim | Jupiter quotes + swap txs simulated OK for both legs. On devnet it refuses with VENUE_UNAVAILABLE (Jupiter has no devnet). Treasury is no longer priced by the simnet oracle on chain coins |
| Durable tx tracking / restart recovery | done | `src/chain/rpc.ts` (`TxLedger`, `sendAndConfirm`, `confirmPending`) | mock | failure injection: 429 retry, RPC down (bounded), on-chain failure → FAILED, blockhash expiry → EXPIRED and rebuildable, crash → `confirmPending` settles all states, replay can't resend a CONFIRMED tx |
| Execution claim / duplicates | done | `Protocol.beginChainExecution` | mock | atomic compare-and-set + `UNIQUE(token_id, seq)`; test: a second keeper gets IN_PROGRESS |
| Immutability + audit trail | done | `src/db/schema.sql` triggers | mock | vitest `hardening` |
| Mainnet circuit breaker | done | `mainnetBlockers()` in `src/chain/config.ts` | mock | test: blocks until `FATE_MAINNET_ENABLED=1`, `FATE_DB_PERSISTENT=1`, Pinata and the vault seed are all set; never gates devnet. Applies to launches, agent spends, payouts and protocol sweeps |
| Agent status in the UI | done | `src/components/TokenView.tsx#AgentPanel`, `Protocol.detail().agent` | local | screenshot: state, last error, retry countdown, pending tx, explorer links, trust model |
| Health / monitoring | done | `/api/health` (503 on problems), structured logs `src/lib/log.ts`, keeper heartbeat | live | `https://fate-launchpad.onrender.com/api/health?quick=1` → ok, commit `2af3340` |
| Keeper / worker | done | `scripts/keeper.ts`, `src/engine/keeper.ts` | local | in-process and external modes; heartbeat; no overlapping ticks; backoff |
| Render deployment | simnet live; on-chain blueprint ready | `render.yaml` | live (simnet) | Free plan sleeps and has no disk, so not suitable for real-money agents; `render.yaml` = paid web + disk + in-process keeper |

## Test runs (exact)
- `npx vitest run`: **8 files, 56 tests passed**.
- `npx playwright test`: **9 passed** (simnet journeys incl. all four destinies, graduation, admin).
- `npx tsc --noEmit`: clean. `npm run lint`: no warnings or errors. `npm run build`: compiled successfully.
- `npm run verify:devnet` (no funded key): tier 1 + tier 2 passed (output in this session's log).
- `npm run verify:mainnet-sim`: all 8 checks passed (simulation only; nothing signed by a real key or sent).

## Not yet verified
- **Devnet signed round trip** (launch → buy → sell → index → collect → Phoenix burn vs mint supply). It needs devnet SOL in
  `AE4SuUADpVWcANW1jVko2XHZvTeA6rv58msMxDUEF94b`; the public airdrop is rate-limited from the build machine, and the web faucet has a captcha.
  Run: `FATE_DEVNET_KEY=<key> npm run verify:devnet`.
- **Gravity / Phoenix post-graduation and Orbit with real signatures:** no FATE coin has graduated, and Orbit is mainnet-only. Both are
  verified by mainnet simulation only.
- **Mainnet:** not run, by design. Needs your authorization, a funded keeper, durable hosting, and ideally an external audit.

## Trust assumptions (state them publicly)
- Whoever holds `FATE_VAULT_MASTER_SEED` controls every coin's vault and could spend outside the destiny. There is no code path that
  does; every spend is a public, signed transaction; the immutable-config triggers hold. This is **server-policy enforcement with an
  audit trail, not a trustless program**. A trustless version needs `programs/fate` (Anchor scaffold, not built) with pump.fun's
  creator set to a program PDA.
- Pump.fun's creator-fee rates, fee tiers, graduation and migration are pump.fun's, and can change.

## Manual actions before production
1. Fund the devnet test key and run tier 3. Then launch one coin from the UI on a `FATE_CHAIN=devnet` deployment.
2. Deploy with `render.yaml`; set `FATE_VAULT_MASTER_SEED` (back it up offline), `FATE_RPC_URL` (keyed RPC), `FATE_ADMIN_KEY` and `FATE_SITE_URL`;
   set the protocol treasury and Pinata in the admin console.
3. Confirm the 80/20 creator-fee split for pump.fun coins (it reuses the protocol's governed `destiny_share_bps`).
4. Security review / audit; then `FATE_MAINNET_ENABLED=1` only with explicit sign-off.
