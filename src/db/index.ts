import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const SCHEMA_PATH = path.join(process.cwd(), "src", "db", "schema.sql");

/**
 * Opens (and migrates) a FATE ledger database.
 * - `:memory:` is used by tests.
 * - Integers are returned as BigInt (safe for lamports / base units).
 */
export function openDatabase(file?: string): DB {
  const target = file ?? process.env.FATE_DB_PATH ?? path.join(process.cwd(), "data", "fate.db");
  if (target !== ":memory:") fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.defaultSafeIntegers(true);
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  const applied = db.prepare("SELECT name FROM migrations").all() as { name: string }[];
  const names = new Set(applied.map((m) => m.name));
  const has = (table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  const addColumn = (table: string, col: string, decl: string) => { if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); };
  // Column migrations are guarded by PRAGMA table_info so a pre-existing ledger upgrades in place (ADD COLUMN is not IF NOT EXISTS in SQLite).
  const migrations: { name: string; up: () => void }[] = [
    { name: "0001_retry_backoff", up: () => { addColumn("destiny_states", "failure_count", "INTEGER NOT NULL DEFAULT 0"); addColumn("destiny_states", "next_retry_at", "INTEGER"); } },
    { name: "0002_chain_mirror", up: () => {
      addColumn("tokens", "chain", "TEXT NOT NULL DEFAULT 'SIMNET'");       // SIMNET | DEVNET | MAINNET
      addColumn("tokens", "mint", "TEXT");                                    // on-chain mint (null on simnet)
      addColumn("tokens", "bonding_curve", "TEXT");                           // pump.fun bonding-curve PDA
      addColumn("tokens", "vault_authority", "TEXT");                         // per-coin creator/vault authority (custodial, derived)
      addColumn("tokens", "metadata_uri", "TEXT");
      addColumn("destiny_executions", "signature", "TEXT");                   // confirming on-chain signature (null on simnet)
      addColumn("trades", "slot", "INTEGER");
    } },
    { name: "0003_pool_cursor", up: () => {
      addColumn("chain_cursor", "pool_last_signature", "TEXT");               // newest PumpSwap pool signature ingested (graduated coins)
    } },
  ];
  const insert = db.prepare("INSERT INTO migrations(name, applied_at) VALUES (?, ?)");
  for (const m of migrations) {
    if (names.has(m.name)) continue;
    const run = db.transaction(() => { m.up(); insert.run(m.name, Date.now()); });
    run();
  }
}

/** Process-wide singleton (Next.js dev reloads modules; keep one handle). */
export function getDb(): DB {
  const g = globalThis as unknown as { __fateDb?: DB };
  if (!g.__fateDb) g.__fateDb = openDatabase();
  return g.__fateDb;
}
