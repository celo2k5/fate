/**
 * Structured logging: one JSON object per line on stdout/stderr so Render's log
 * collection (and any shipper) can index it. Never log secrets: callers pass
 * fields explicitly; `redact()` masks anything that looks like a key.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.FATE_LOG_LEVEL as Level) ?? "info"] ?? 20;
const SECRET_RE = /(key|secret|token|password|seed|mnemonic|authorization)/i;

export function redact(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_RE.test(k) && typeof v === "string" && v.length > 0) out[k] = `•••${v.slice(-4)}`;
    else if (typeof v === "bigint") out[k] = v.toString();
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

function write(level: Level, event: string, fields: Fields = {}) {
  if (LEVELS[level] < MIN) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) }, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
  /** A child logger that stamps every line with the same context (e.g. { component: "keeper" }). */
  child(ctx: Fields) {
    return {
      debug: (event: string, fields?: Fields) => write("debug", event, { ...ctx, ...fields }),
      info: (event: string, fields?: Fields) => write("info", event, { ...ctx, ...fields }),
      warn: (event: string, fields?: Fields) => write("warn", event, { ...ctx, ...fields }),
      error: (event: string, fields?: Fields) => write("error", event, { ...ctx, ...fields }),
    };
  },
};
