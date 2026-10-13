# FATE — every coin has a destiny

A Solana token launchpad where every coin launches with one permanent economic destiny. Trading fees never go to the creator: they fill a program-controlled vault that only the coin's destiny can spend.

| Destiny | What the fees become |
| --- | --- |
| **Phoenix** | Buyback and burn, slippage-bounded, on the active venue |
| **Gravity** | Permanent liquidity: a protocol-custodied position with no withdrawal path |
| **Echo** | Holder rewards, settled per epoch from a ledger snapshot, claimed once per wallet |
| **Orbit** | An autonomous treasury diversified into an approved basket (SOL / USDC / LST / reserve) |

Everything is server-side: Next.js 15 (App Router, server components, route handlers), a TypeScript protocol engine over a SQLite ledger, an in-process keeper, SSE realtime, and wallet sign-in by ed25519 signature. The on-chain program (`programs/fate`) mirrors the engine's account model and is a scaffold for the devnet milestone (see *Status* below — read it before assuming anything is deployed).

## Run it

```bash
npm install
cp .env.example .env.local      # optional; defaults work
npm run build && npm start      # http://localhost:3000   (or: npm run dev)
npm run seed                    # optional demo ledger: four coins with volume and executions
```

Connect with **Phantom** (sign-message only; no transaction is ever sent) or the built-in **Fate simnet wallet** (a keypair kept in your browser). Use *Get 25 test SOL* on the wallet page.

## Brand kit (`public/brand/`)

Mark: an astrolabe coin whose pointer becomes the F (`mark.svg`, `mark-mono.svg`, inline `<Mark/>`/`<Logo/>` in `src/components/Logo.tsx`). Favicons: `favicon.svg`, `/favicon.ico`, `icon-16/32/48/180/192/512.png`, `manifest.webmanifest`. Social: `og.png` (1200×630, wired as OpenGraph/Twitter card), `banner-x.png` (1500×500 X header), `logo-dark.png`/`logo-transparent.png` lockups. Renders: `coin.jpg` (the Fate coin), `banner-bg.jpg`. Regenerate the rasters with `node scripts/brand.mjs`.

## Admin console

`/admin` (key from `FATE_ADMIN_KEY`; dev default `fate-admin` with a console warning). Two tabs:

- **Mainnet readiness** — every value the backend needs before devnet/mainnet: cluster + RPC/WS, program ID, authorities (authority / treasury / keeper, must differ), governed economics and bounds, venues (Raydium CPMM, Jupiter, Pyth feed, USDC/LST mints), metadata gateway + API key (stored, masked on read-back), keeper interval, site/disclosure (URL, support, docs, audit report, launch date). Inputs are validated server-side (base58 addresses, URLs, bps ranges, min<max); readiness is scored per group and the **Mainnet enabled** switch only unlocks at 24/24. **Export .env** downloads `.env.mainnet` for the backend; **Open preview** shows the public site with this configuration applied (network label, banner) for your browser only.
- **Operations** — ledger stats, keeper status, active sessions, per-coin state with a crank button, failed executions, market snapshot.

Covered by `e2e/admin.spec.ts` (guarding, rejection, validation, readiness to 100%, masking, export, preview on/off, ops crank).

## Verify it

```bash
npm run lint && npm run typecheck && npm run build
npm test            # 31 engine tests (vitest, in-memory ledger)
npm run e2e         # Playwright journey against a running server on :3000
```

Last verified run (this environment, Chromium headless, fresh ledger):

- `vitest`: **31 passed** — launch & immutability, curve math, fee routing, slippage, idempotent replay, vault isolation, Phoenix (accumulate → eligible → buyback → burn, cooldown, no double execution, slippage bound), Gravity (escrow, migration at graduation, post-graduation AMM add, no withdrawal path), Echo (snapshot, eligibility, sells forfeit the epoch, single claim, over-claim guard, failed-settlement recovery), Orbit (allocation, approved assets, reconciliation), graduation (price continuity, LP locked, no double graduation, post-graduation execution).
- `playwright`: **9 passed** (6 journey + 3 admin) — the required journey through the real UI: connect wallet → create token → choose Phoenix → review the immutable destiny → launch (success shown only after state is read back) → buy → sell → fees verified in the Phoenix vault → accumulate → buyback executes → burned tokens verified against supply → history inspected; then Gravity, Echo (epoch settles, holder claims exactly once), Orbit, graduation + post-graduation buyback on the AMM, and discovery/leaderboards/activity.

Signatures in this build are **simnet signatures**: wallet-signed intents verified server-side and used as idempotency keys (e.g. a launch signature is the base58 ed25519 signature over the launch intent; a graduation signature is `grad:<sha256>`). They are not Solana transaction signatures. None were fabricated; they are all visible in the UI and the `launches`, `trades`, `graduations` and `reward_claims` tables.

## How it works

### Bonding curve (`src/engine/curve.ts`)
Constant product with virtual reserves (Pump.fun family): 1B supply, 793.1M sold on the curve, 206.9M reserved for the AMM, 30 SOL / 1.073B virtual. `tokensOut = vTok − k/(vSol + Δsol)`, `solOut = vSol − k/(vTok + Δtok)`. 1% fee in SOL on both sides, 80% to the coin's vault, 20% to the protocol treasury, settled exactly once per trade (`fee_events.trade_id UNIQUE`). The engine is authoritative for reserves, prices, fees, inventory and graduation; the UI only renders quotes it produced. Price impact and minimum output are shown on every quote; `minOut` is enforced server-side so stale quotes fail.

### Destiny engine (`src/engine/protocol.ts`)
States: `IDLE → ACCUMULATING → ELIGIBLE → EXECUTING → COMPLETED | FAILED`. `crank(tokenId)` is permissionless (`POST /api/crank`, the *Run crank* button, or the keeper) and re-validates balance, threshold, cooldown, venue and slippage itself. Duplicate execution is impossible by schema (`destiny_executions UNIQUE(token_id, seq)`); a failed execution leaves the vault untouched and becomes retryable after the cooldown; a stale `EXECUTING` is recovered automatically.

- **Phoenix**: largest buy ≤ vault whose price impact fits `max_slippage_bps` (halving search), executed as a protocol trade on the curve or AMM, then burned (`tokens.burned`, `circulating`, burn address).
- **Gravity**: half the vault buys tokens, the other half pairs with them. Pre-graduation → `locked_liquidity` in `ESCROW` (migrates into the pool at graduation at pool ratio; leftover tokens burned); post-graduation → added to the pool at ratio, LP minted to `lp_locked`. There is no instruction or method that removes liquidity.
- **Echo**: when the epoch elapses and the vault ≥ threshold, holders are snapshotted from the ledger (user wallets only, ≥ min balance, no sells in that epoch). Allocation is pro-rata and moved to a rewards escrow; `reward_claims UNIQUE(epoch_id, address)` prevents double claims; claims can never exceed `funded`.
- **Orbit**: the vault is split by the fixed allocation. SOL and the retained reserve move to the treasury; USDC and LST are "swapped" through `src/engine/oracle.ts` (a deterministic simnet oracle with size-dependent execution cost, slippage-checked). Values are revalued at the oracle price for display. No leverage, no other assets.

### Graduation
When real SOL on the curve ≥ the coin's graduation threshold, the engine takes a 1.5% migration fee, moves the remaining SOL plus tokens priced at the curve's final price into a constant-product pool (price continuity, verified in tests), burns surplus reserve/unsold tokens, merges any Gravity escrow, mints all LP to protocol custody (`lp_locked == lp_supply`), and switches the token to `AMM`. Trading and destiny execution continue on the pool through the same `venue()` abstraction.

### Wallets and signatures (`src/lib/auth.ts`, `src/lib/wallet.tsx`)
Sign-in: server issues a nonce, wallet signs it, server verifies with tweetnacl and sets an httpOnly session. Launch, trade and claim are **signed intents**: the wallet signs a canonical JSON message; the server checks the signature against the session wallet, freshness (5 min), and uses the signature as the idempotency key. Phantom works via `signMessage` (nothing is ever sent on-chain by this build); the built-in wallet signs with a browser-held ed25519 key.

### Realtime
`GET /api/stream` (SSE; `?tokenId=` narrows). Every ledger write emits an event row; the stream replays by `Last-Event-ID` on reconnect and clients refetch authoritative state on `hello`. The activity feed only reads from the `events` table.

### Keeper
`src/engine/keeper.ts` starts from `src/instrumentation.ts` (`FATE_KEEPER_INTERVAL_MS`, default 4 s): calls `crankAll()` and records market snapshots. It holds no authority.

## Project layout

```
src/engine/      units · curve · config (bounds, destiny copy) · protocol · oracle · keeper · events
src/db/          schema.sql (14 models + ledger tables, indexes, uniqueness/idempotency constraints), migrations
src/app/         pages (home, destinies, launch, coins, coin/[id], leaderboards, wallet) and /api route handlers
src/components/  Character (procedural SVGs) · DestinyWheel · TokenView · TradePanel · LiveActivity · Nav · WalletModal
src/lib/         auth (sessions, signed intents) · wallet (client) · useStream (SSE) · format
tests/           vitest engine suites · e2e/ Playwright journey
programs/fate/   Anchor program scaffold (Rust) + Anchor.toml
scripts/         seed.ts · restart-server.sh · screenshots.mjs
public/scenes/   generated scene loops (.mp4) + posters (.jpg): hero, garden, observatory, phoenix, gravity, echo, orbit
design-reference/ skillui ultra extraction of reefy.cash (tokens, layout, animations, screenshots) the UI is built on
```

Database models (spec §18): Token, Launch, DestinyConfig, DestinyState, FeeEvent, VaultSnapshot, DestinyExecution, Trade, MarketSnapshot, Graduation, RewardEpoch, RewardClaim, TreasuryAsset, WalletSession — plus wallets, holdings, curves, pools, locked_liquidity, events, auth_nonces.

## Status — read this

**What is real and verified here**
- The full product loop, server-side, against a persistent ledger, with all four destinies, graduation, realtime, wallet signatures, discovery, leaderboards, and the tests above.

**What is simulated**
- *simnet*: the ledger is SQLite in this process, not Solana. "SOL" and tokens are ledger balances. Signatures are wallet signatures over intents, not transaction signatures.
- The Orbit price feed and swap venue (`oracle.ts`) are deterministic stand-ins for Pyth/Switchboard + Jupiter.
- The AMM is the engine's own constant-product pool, standing in for Raydium CPMM / Meteora.

**Not done (honest list)**
- The Anchor program is a **scaffold**: launch, buy, sell, begin_execution, execute_phoenix and claim_echo are written; execute_gravity, settle_echo_epoch, execute_orbit and graduate are declared but need venue CPIs (Raydium/Jupiter) whose interfaces must be confirmed against the live programs. It was **not compiled, tested or deployed** here (no Solana toolchain in this sandbox). No program ID exists; no devnet transaction signatures exist.
- No independent audit. Do not call this audited.
- Echo on-chain uses a Merkle snapshot produced by an indexer; simnet snapshots directly from the ledger.
- No mainnet deployment, and none should happen without explicit approval.

**Remaining production requirements**
1. Build/test the Anchor program on localnet; wire the backend to RPC (replace `Protocol`'s ledger writes with transaction building + confirmation; keep the same interfaces).
2. Indexer from program events (Geyser/webhooks) → the same tables; realtime unchanged.
3. Venue integrations: Raydium CPMM (graduation pool creation, Gravity adds, post-graduation buybacks), Jupiter (Orbit), Pyth (valuation).
4. Postgres + Redis/BullMQ for the keeper in a multi-instance deployment (the SQL is standard; `better-sqlite3` is isolated in `src/db`).
5. Rate limiting on auth/faucet routes, metadata upload to decentralized storage, Phantom transaction signing.
6. Security review of PDAs, authority revocation, CPI account validation, and an external audit.

## Security considerations
Documented trust assumptions: the keeper is untrusted (anyone can crank; the engine validates). The protocol authority can change fee bps and bounds for *future* launches only; a launched coin's `destiny_configs` row is never updated (there is no code path, and the test suite asserts it). Vault funds move only inside destiny execution paths. All arithmetic is checked `bigint`/`u64`. Slippage bounds apply to protocol trades and swaps. Reserve underflow, inventory exhaustion, duplicate settlement, double claims and double graduation are rejected by code and by schema constraints.

Nothing here is financial advice. Buybacks, liquidity, rewards and treasuries do not guarantee price.
