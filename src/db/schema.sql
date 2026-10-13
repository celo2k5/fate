-- FATE ledger schema (SQLite). All amounts are integers:
--   SOL in lamports (1 SOL = 1_000_000_000), tokens in base units (6 decimals).
-- The schema is deliberately relational and idempotency-constrained; the same
-- model maps 1:1 onto on-chain PDAs (see programs/fate).

CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  lamports INTEGER NOT NULL DEFAULT 0 CHECK (lamports >= 0),
  kind TEXT NOT NULL DEFAULT 'user', -- user | vault | curve | pool | protocol | burn | escrow
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL REFERENCES wallets(address),
  nonce TEXT NOT NULL,
  provider TEXT NOT NULL, -- phantom | fate-local
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_address ON wallet_sessions(address);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,               -- mint address (simnet: base58 of random 32 bytes)
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  website TEXT, x TEXT, telegram TEXT,
  destiny TEXT NOT NULL CHECK (destiny IN ('PHOENIX','GRAVITY','ECHO','ORBIT')),
  creator TEXT NOT NULL REFERENCES wallets(address),
  decimals INTEGER NOT NULL DEFAULT 6,
  total_supply INTEGER NOT NULL,
  circulating INTEGER NOT NULL,      -- supply - burned
  burned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'CURVE' CHECK (status IN ('CURVE','GRADUATING','AMM')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_destiny ON tokens(destiny);
CREATE INDEX IF NOT EXISTS idx_tokens_created ON tokens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_ticker ON tokens(ticker);

CREATE TABLE IF NOT EXISTS launches (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  signature TEXT NOT NULL UNIQUE,    -- launch "transaction" signature (wallet-signed intent)
  signed_message TEXT NOT NULL,
  authorities_json TEXT NOT NULL,    -- remaining admin authorities, shown on review step
  created_at INTEGER NOT NULL
);

-- Immutable after launch. There is no UPDATE path in the engine for this table.
CREATE TABLE IF NOT EXISTS destiny_configs (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  destiny TEXT NOT NULL,
  trade_fee_bps INTEGER NOT NULL,
  destiny_share_bps INTEGER NOT NULL,
  execution_threshold INTEGER NOT NULL,     -- lamports in vault that make an action eligible
  cooldown_ms INTEGER NOT NULL,
  max_slippage_bps INTEGER NOT NULL,
  graduation_threshold INTEGER NOT NULL,    -- real SOL reserves (lamports) that trigger graduation
  params_json TEXT NOT NULL,                -- destiny-specific bounded params
  config_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS destiny_states (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  vault_address TEXT NOT NULL REFERENCES wallets(address),
  state TEXT NOT NULL DEFAULT 'IDLE' CHECK (state IN ('IDLE','ACCUMULATING','ELIGIBLE','EXECUTING','COMPLETED','FAILED')),
  executions INTEGER NOT NULL DEFAULT 0,
  last_execution_at INTEGER,
  last_error TEXT,
  lifetime_fees INTEGER NOT NULL DEFAULT 0,
  -- destiny aggregate metrics (verified from executions)
  total_burned INTEGER NOT NULL DEFAULT 0,          -- phoenix
  total_liquidity_added INTEGER NOT NULL DEFAULT 0, -- gravity (lamports side)
  total_rewards_distributed INTEGER NOT NULL DEFAULT 0, -- echo
  total_treasury_deployed INTEGER NOT NULL DEFAULT 0,   -- orbit
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curves (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  curve_address TEXT NOT NULL REFERENCES wallets(address),
  virtual_sol INTEGER NOT NULL,
  virtual_tokens INTEGER NOT NULL,
  real_sol INTEGER NOT NULL DEFAULT 0,
  real_tokens INTEGER NOT NULL,       -- tokens still held by the curve
  reserved_tokens INTEGER NOT NULL,   -- set aside for the AMM at graduation
  complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pools (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  pool_address TEXT NOT NULL REFERENCES wallets(address),
  sol_reserve INTEGER NOT NULL,
  token_reserve INTEGER NOT NULL,
  lp_supply INTEGER NOT NULL,
  lp_locked INTEGER NOT NULL,         -- LP permanently custodied by the protocol (non-withdrawable)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS holdings (
  token_id TEXT NOT NULL REFERENCES tokens(id),
  address TEXT NOT NULL REFERENCES wallets(address),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  last_sell_epoch INTEGER,            -- echo eligibility: selling in an epoch forfeits that epoch
  PRIMARY KEY (token_id, address)
);
CREATE INDEX IF NOT EXISTS idx_holdings_address ON holdings(address);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  trader TEXT NOT NULL REFERENCES wallets(address),
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  venue TEXT NOT NULL CHECK (venue IN ('CURVE','AMM')),
  sol_amount INTEGER NOT NULL,        -- gross SOL paid (buy) or received (sell) before fees
  token_amount INTEGER NOT NULL,
  fee_lamports INTEGER NOT NULL,
  price_lamports_per_token REAL NOT NULL,
  signature TEXT NOT NULL UNIQUE,     -- client-signed intent signature: idempotency key
  is_protocol INTEGER NOT NULL DEFAULT 0, -- buyback / gravity acquisition
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader);

CREATE TABLE IF NOT EXISTS fee_events (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id), -- one settlement per trade
  total_fee INTEGER NOT NULL,
  destiny_fee INTEGER NOT NULL,
  protocol_fee INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  balance INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_snapshots ON vault_snapshots(token_id, created_at DESC);

CREATE TABLE IF NOT EXISTS destiny_executions (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  destiny TEXT NOT NULL,
  seq INTEGER NOT NULL,                -- per-token monotonically increasing; UNIQUE prevents duplicates
  status TEXT NOT NULL CHECK (status IN ('EXECUTING','COMPLETED','FAILED')),
  vault_before INTEGER NOT NULL,
  amount_used INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  venue TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (token_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_exec_token ON destiny_executions(token_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  price REAL NOT NULL,
  market_cap INTEGER NOT NULL,
  volume_24h INTEGER NOT NULL,
  holders INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_snapshots ON market_snapshots(token_id, created_at DESC);

CREATE TABLE IF NOT EXISTS graduations (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  sol_migrated INTEGER NOT NULL,
  tokens_migrated INTEGER NOT NULL,
  lp_locked INTEGER NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_epochs (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  epoch INTEGER NOT NULL,
  funded INTEGER NOT NULL,
  eligible_wallets INTEGER NOT NULL,
  eligible_supply INTEGER NOT NULL,
  min_balance INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,         -- [[address, balance, allocation], ...]
  created_at INTEGER NOT NULL,
  UNIQUE (token_id, epoch)
);

CREATE TABLE IF NOT EXISTS reward_claims (
  id TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL REFERENCES reward_epochs(id),
  address TEXT NOT NULL REFERENCES wallets(address),
  amount INTEGER NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE (epoch_id, address)           -- double-claim prevention
);

CREATE TABLE IF NOT EXISTS treasury_assets (
  token_id TEXT NOT NULL REFERENCES tokens(id),
  asset TEXT NOT NULL,                 -- SOL | USDC | LST | RESERVE
  amount INTEGER NOT NULL DEFAULT 0,   -- base units of the asset (USDC 6dp, LST 9dp, SOL lamports)
  cost_basis_lamports INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, asset)
);

CREATE TABLE IF NOT EXISTS locked_liquidity (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES tokens(id),
  sol_amount INTEGER NOT NULL,
  token_amount INTEGER NOT NULL,
  lp_amount INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL CHECK (stage IN ('ESCROW','POOL')), -- ESCROW pre-graduation, POOL after
  execution_id TEXT REFERENCES destiny_executions(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  token_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_token ON events(token_id, id DESC);

CREATE TABLE IF NOT EXISTS protocol (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ───────────────────────── on-chain mirror (devnet / mainnet adapter) ─────────────────────────
-- Every transaction the backend builds or sends. Durable across restarts: a PENDING row is
-- re-checked (confirmed / expired) by the keeper before any state that depends on it is written.
CREATE TABLE IF NOT EXISTS chain_txs (
  id TEXT PRIMARY KEY,
  cluster TEXT NOT NULL CHECK (cluster IN ('devnet','mainnet-beta','localnet')),
  purpose TEXT NOT NULL,               -- launch | buy | sell | collect_fees | phoenix_buy | phoenix_burn | echo_payout | gravity_deposit | orbit_swap
  token_id TEXT,
  reference_id TEXT,                   -- execution id / trade intent / epoch id the tx belongs to (idempotency scope)
  signature TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('BUILT','SENT','CONFIRMED','FAILED','EXPIRED')),
  blockhash TEXT,
  last_valid_block_height INTEGER,
  slot INTEGER,
  error TEXT,
  lamports INTEGER NOT NULL DEFAULT 0,     -- amount moved by the transaction, for reconciliation
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (purpose, reference_id)       -- one live transaction per purpose+reference: retries re-use the row
);
CREATE INDEX IF NOT EXISTS idx_chain_txs_status ON chain_txs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_chain_txs_token ON chain_txs(token_id, created_at DESC);

-- Trade events ingested from chain logs (pump.fun TradeEvent), keyed by signature+index: replay-safe.
CREATE TABLE IF NOT EXISTS chain_cursor (
  token_id TEXT PRIMARY KEY REFERENCES tokens(id),
  last_signature TEXT,                 -- newest signature already ingested for the bonding curve
  last_slot INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- ───────────────────────── immutability, enforced by the database ─────────────────────────
-- The engine has no UPDATE path for these rows; these triggers make sure nothing else has one either
-- (an operator with a SQL shell included). Append-only audit trail: events, launches, executions, trades, claims.
CREATE TRIGGER IF NOT EXISTS destiny_configs_immutable_update BEFORE UPDATE ON destiny_configs
  BEGIN SELECT RAISE(ABORT, 'destiny_configs is immutable after launch'); END;
CREATE TRIGGER IF NOT EXISTS destiny_configs_immutable_delete BEFORE DELETE ON destiny_configs
  BEGIN SELECT RAISE(ABORT, 'destiny_configs is immutable after launch'); END;
CREATE TRIGGER IF NOT EXISTS launches_immutable_update BEFORE UPDATE ON launches
  BEGIN SELECT RAISE(ABORT, 'launches are append-only'); END;
CREATE TRIGGER IF NOT EXISTS launches_immutable_delete BEFORE DELETE ON launches
  BEGIN SELECT RAISE(ABORT, 'launches are append-only'); END;
CREATE TRIGGER IF NOT EXISTS tokens_destiny_immutable BEFORE UPDATE OF destiny, creator, total_supply, decimals ON tokens
  BEGIN SELECT RAISE(ABORT, 'token destiny/creator/supply are immutable after launch'); END;
CREATE TRIGGER IF NOT EXISTS events_append_only_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_append_only_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS executions_no_delete BEFORE DELETE ON destiny_executions
  BEGIN SELECT RAISE(ABORT, 'executions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS executions_terminal_state BEFORE UPDATE OF status ON destiny_executions
  WHEN OLD.status IN ('COMPLETED','FAILED')
  BEGIN SELECT RAISE(ABORT, 'a settled execution cannot change status'); END;
CREATE TRIGGER IF NOT EXISTS trades_no_delete BEFORE DELETE ON trades
  BEGIN SELECT RAISE(ABORT, 'trades are append-only'); END;
CREATE TRIGGER IF NOT EXISTS trades_no_update BEFORE UPDATE ON trades
  BEGIN SELECT RAISE(ABORT, 'trades are append-only'); END;
CREATE TRIGGER IF NOT EXISTS claims_no_delete BEFORE DELETE ON reward_claims
  BEGIN SELECT RAISE(ABORT, 'claims are append-only'); END;
CREATE TRIGGER IF NOT EXISTS graduations_no_delete BEFORE DELETE ON graduations
  BEGIN SELECT RAISE(ABORT, 'graduations are append-only'); END;

-- Server-built transactions waiting for the user's signature (launch / trade). Expire with their blockhash.
CREATE TABLE IF NOT EXISTS chain_prepares (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                  -- launch | buy | sell
  address TEXT NOT NULL,               -- the wallet that must sign (fee payer)
  token_id TEXT,
  message_b64 TEXT NOT NULL,           -- the exact compiled message; the submitted transaction must match it byte for byte
  payload_json TEXT NOT NULL,          -- validated launch params / trade intent
  blockhash TEXT NOT NULL,
  last_valid_block_height INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prepares_addr ON chain_prepares(address, created_at DESC);

-- Self-hosted token metadata (served at /api/metadata/<mint>) when no IPFS pinning service is configured.
CREATE TABLE IF NOT EXISTS token_metadata (
  mint TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  image_data_url TEXT,
  created_at INTEGER NOT NULL
);
