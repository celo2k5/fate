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

FATE runs in one of three modes, set by `FATE_CHAIN`:

| mode | ledger | money | what moves |
|---|---|---|---|
| `simnet` (default; the public demo) | SQLite in-process | none | everything is simulated: curve, AMM, oracle, Jupiter stand-ins |
| `devnet` | SQLite mirror of chain events | devnet SOL | real pump.fun coins on Solana devnet; agents send real devnet transactions |
| `mainnet` | same | real SOL | same as devnet, **behind a circuit breaker** (see Going on-chain) |

### On-chain architecture (Pump.fun + custodial vault)
- **Launch**: the creator's wallet pays for and signs a pump.fun `create_v2` (official `@pump-fun/pump-sdk`). The coin's pump.fun `creator`
  (the fee recipient) is a **per-coin vault key derived on the server** from `FATE_VAULT_MASTER_SEED` + the mint. The server rebuilds and
  compares the signed transaction byte for byte, sends it, and records the coin only after decoding its `CreateEvent` from the chain.
- **Fees**: pump.fun keeps its own trading fees; FATE's input is the coin's **creator fee**. The governed share (`destiny_share_bps`, 80 %)
  funds the destiny, the rest goes to the protocol treasury. Trades are indexed from `TradeEvent`s (curve) and `BuyEvent`/`SellEvent`s
  (PumpSwap, after graduation), idempotent by `signature#index`.
- **Agents** (`src/chain/agents.ts`): collect creator fees (with the PumpSwap `sweep_creator_fee` after graduation) → spend only
  `min(ledger vault, on-chain balance − rent headroom)` → confirmed transaction → state recorded from what the chain shows:
  - **Phoenix**: buy + burn in one transaction, on the curve or on PumpSwap; the burn is checked against the mint supply.
  - **Gravity**: before graduation, buy half and hold in escrow; after, buy half on PumpSwap and deposit escrow + new tokens with the paired SOL
    into the canonical pool. LP tokens stay with the vault key; FATE has no withdraw code path.
  - **Echo**: holder snapshot from token accounts (curve, pool and vault excluded); sellers during the epoch forfeit it; allocations are fixed,
    each wallet claims once (one SOL transfer, idempotent).
  - **Orbit**: USDC and JitoSOL legs swap through Jupiter inside the coin's slippage bound (output allowlist; fill verified by balance delta);
    SOL and reserve legs stay as SOL. **Mainnet only**: Jupiter has no devnet, so on devnet Orbit refuses to execute and says why.
- **Graduation** is observed (curve complete + canonical PumpSwap pool exists), never simulated, for on-chain coins.
- **Durability**: every transaction has a `chain_txs` row keyed by (purpose, reference). Retries reuse it, `EXPIRED` is safe to rebuild, and
  the keeper settles `SENT` rows after a restart. The execution claim is an atomic compare-and-set backed by `UNIQUE(token_id, seq)`.
  Destiny configs, launches, events, trades and claims are append-only, enforced by SQLite triggers.

### Trust model (say it this way, not "trustless")
On devnet/mainnet the destiny is **enforced by server policy with a public audit trail**, not by an on-chain program. Whoever holds
`FATE_VAULT_MASTER_SEED` controls every coin's vault key and could, in principle, spend outside the destiny. Mitigations: there is no code path
that does, every spend is a signed public transaction shown on the coin page, the mainnet breaker defaults off, and the immutable-config
triggers hold. A trustless version needs the Anchor program in `programs/fate` (a scaffold, not built or deployed) with pump.fun's creator
set to a program PDA. The UI states the custodial model on every on-chain coin.

### Verification evidence (what was actually run)
- Unit / integration: `npm test` (vitest, 56 tests), including failure injection (429s, RPC down, failed and expired transactions, restart
  settlement, replay idempotency, Jupiter bound violations, the mainnet breaker). E2E: `npm run e2e` (Playwright, simnet).
- `npm run verify:devnet` (`scripts/devnet-verify.ts`). Tier 1: decodes pump.fun Global/FeeConfig on devnet. Tier 2: the real program
  simulates create_v2 (creator = vault key), buy, and the atomic Phoenix buy+burn on a live devnet curve. Tier 3: signed launch → buy → sell →
  index → fee collection → Phoenix with the burn checked against mint supply. Needs a funded `FATE_DEVNET_KEY`.
- `npm run verify:mainnet-sim` (`scripts/verify-amm-sim.ts`): mainnet **simulation only** (nothing signed or sent) against a live graduated pump.fun pool: AMM event
  decoding, Phoenix pool buy+burn, Gravity pool buy+deposit (LP minted), creator-fee sweep+collect, Orbit's Jupiter USDC and JitoSOL swaps.

### Going on-chain
1. Deploy with `render.yaml` (one paid web service + persistent disk; the keeper runs in-process). Free instances sleep and lose their disk.
2. Set `FATE_VAULT_MASTER_SEED` (≥ 32 random chars; back it up offline), `FATE_RPC_URL` (a keyed RPC), `FATE_ADMIN_KEY`, `FATE_SITE_URL`.
3. In the admin console set the protocol treasury and Pinata (metadata URIs are immutable on-chain, so they must not depend on this server).
4. Devnet first: `FATE_CHAIN=devnet`, then `npm run verify:devnet` with a funded key, then a launch from the UI.
5. Mainnet only after review: `FATE_CHAIN=mainnet`, `FATE_DB_PERSISTENT=1`, `FATE_MAINNET_ENABLED=1`. Until all hold, launches, agent spends,
   payouts and protocol sweeps refuse with the missing items listed.

### Not done (honest list)
- No external security audit. Do not call this audited.
- The Anchor program (`programs/fate`) is a scaffold; not compiled or deployed.
- Echo's "held through the epoch" uses indexed sells plus the end snapshot. A wallet that transfers tokens out (not a sell) and back
  within the epoch is not caught; closing that needs per-account transfer indexing.
- Single-writer SQLite: horizontal scaling needs Postgres + a queue.
- Live mainnet execution has not been performed (none was authorized). Post-graduation and Orbit paths are verified by mainnet simulation only.

## Security considerations
Documented trust assumptions: the keeper is untrusted (anyone can crank; the engine validates). The protocol authority can change fee bps and bounds for *future* launches only; a launched coin's `destiny_configs` row is never updated (there is no code path, and the test suite asserts it). Vault funds move only inside destiny execution paths. All arithmetic is checked `bigint`/`u64`. Slippage bounds apply to protocol trades and swaps. Reserve underflow, inventory exhaustion, duplicate settlement, double claims and double graduation are rejected by code and by schema constraints.

Nothing here is financial advice. Buybacks, liquidity, rewards and treasuries do not guarantee price.
