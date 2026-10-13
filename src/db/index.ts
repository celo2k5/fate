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
  const migrations: { name: string; sql: string }[] = [
    // Future migrations go here; the base schema is idempotent (IF NOT EXISTS).
  ];
  const insert = db.prepare("INSERT INTO migrations(name, applied_at) VALUES (?, ?)");
  for (const m of migrations) {
    if (names.has(m.name)) continue;
    db.exec(m.sql);
    insert.run(m.name, Date.now());
  }
}

/** Process-wide singleton (Next.js dev reloads modules; keep one handle). */
export function getDb(): DB {
  const g = globalThis as unknown as { __fateDb?: DB };
  if (!g.__fateDb) g.__fateDb = openDatabase();
  return g.__fateDb;
}
