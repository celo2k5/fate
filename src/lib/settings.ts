import { z } from "zod";
import { getProtocol } from "@/engine/keeper";
import { isBase58Address } from "@/engine/ids";

/**
 * Mainnet readiness settings. Entered by the admin, stored in the `protocol`
 * key/value table, validated here, and exported as the backend's .env for the
 * devnet/mainnet milestone. Secrets are stored but never returned unmasked.
 */
const addr = z.string().trim().refine((s) => s === "" || isBase58Address(s), "must be a base58 32-byte address");
const url = z.string().trim().refine((s) => s === "" || /^https?:\/\/.+/.test(s), "must start with http(s)://");
const wss = z.string().trim().refine((s) => s === "" || /^wss?:\/\/.+/.test(s), "must start with ws(s)://");
const bps = (max: number) => z.coerce.number().int().min(0).max(max);

export const SettingsSchema = z.object({
  // network
  network: z.enum(["mainnet-beta", "devnet", "localnet"]).default("devnet"),
  rpcUrl: url.default(""),
  wsUrl: wss.default(""),
  programId: addr.default(""),
  // authorities
  protocolAuthority: addr.default(""),
  protocolTreasury: addr.default(""),
  keeperWallet: addr.default(""),
  // economics (governed)
  tradeFeeBps: bps(500).default(100),
  destinyShareBps: bps(10_000).default(8000),
  migrationFeeBps: bps(1000).default(150),
  executionThresholdMinSol: z.coerce.number().min(0.01).default(0.25),
  executionThresholdMaxSol: z.coerce.number().min(0.01).default(50),
  graduationThresholdMinSol: z.coerce.number().min(1).default(5),
  graduationThresholdMaxSol: z.coerce.number().min(1).default(300),
  cooldownMinSeconds: z.coerce.number().int().min(1).default(5),
  maxSlippageBpsCap: bps(5000).default(1500),
  // venues
  raydiumCpmmProgram: addr.default(""),
  jupiterApiUrl: url.default("https://quote-api.jup.ag/v6"),
  pythSolUsdFeed: z.string().trim().default(""),
  usdcMint: addr.default(""),
  lstMint: addr.default(""),
  // metadata storage
  metadataGateway: url.default(""),
  metadataApiKey: z.string().default(""), // secret
  // keeper
  keeperIntervalMs: z.coerce.number().int().min(1000).default(4000),
  // site
  siteUrl: url.default(""),
  xHandle: z.string().trim().default(""),
  telegram: z.string().trim().default(""),
  docsUrl: url.default(""),
  supportEmail: z.string().trim().refine((s) => s === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), "must be an email").default(""),
  launchDate: z.string().trim().default(""),
  auditReportUrl: url.default(""),
  mainnetEnabled: z.coerce.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.executionThresholdMinSol >= v.executionThresholdMaxSol) ctx.addIssue({ code: "custom", path: ["executionThresholdMaxSol"], message: "max must exceed min" });
  if (v.graduationThresholdMinSol >= v.graduationThresholdMaxSol) ctx.addIssue({ code: "custom", path: ["graduationThresholdMaxSol"], message: "max must exceed min" });
  if (v.destinyShareBps > 10_000) ctx.addIssue({ code: "custom", path: ["destinyShareBps"], message: "cannot exceed 100%" });
});

export type Settings = z.infer<typeof SettingsSchema>;
export const SECRET_KEYS: (keyof Settings)[] = ["metadataApiKey"];
const KEY = "settings";

export function getSettings(): Settings {
  const p = getProtocol();
  const row = p.db.prepare("SELECT value FROM protocol WHERE key=?").get(KEY) as { value: string } | undefined;
  const parsed = SettingsSchema.safeParse(row ? JSON.parse(row.value) : {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export function saveSettings(input: unknown): { ok: true; settings: Settings } | { ok: false; errors: Record<string, string> } {
  const current = getSettings();
  const merged: Record<string, unknown> = { ...current, ...(input as Record<string, unknown>) };
  // masked secrets keep their stored value
  for (const k of SECRET_KEYS) if (typeof merged[k] === "string" && /^•+/.test(merged[k] as string)) merged[k] = current[k];
  const parsed = SettingsSchema.safeParse(merged);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".")] = i.message;
    return { ok: false, errors };
  }
  const p = getProtocol();
  p.db.prepare("INSERT INTO protocol(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(KEY, JSON.stringify(parsed.data));
  // append-only audit trail of configuration changes (secrets never written, only "changed")
  const changed = (Object.keys(parsed.data) as (keyof Settings)[]).filter((k) => JSON.stringify(parsed.data[k]) !== JSON.stringify(current[k]));
  if (changed.length) p.db.prepare("INSERT INTO events(type, token_id, payload_json, created_at) VALUES ('admin.settings.updated', NULL, ?, ?)")
    .run(JSON.stringify({ changed: changed.map((k) => (SECRET_KEYS.includes(k) ? { key: k, value: "(secret changed)" } : { key: k, from: current[k], to: parsed.data[k] })) }), Date.now());
  return { ok: true, settings: parsed.data };
}

export function maskSecrets(s: Settings): Settings {
  const out = { ...s };
  for (const k of SECRET_KEYS) { const v = out[k] as string; (out as Record<string, unknown>)[k] = v ? "••••••••" + v.slice(-4) : ""; }
  return out;
}

/** Mainnet readiness: grouped checks the admin must satisfy before the launch switch means anything. */
export function readiness(s: Settings) {
  const g = (name: string, items: { label: string; ok: boolean; hint?: string }[]) => ({ name, items, done: items.filter((i) => i.ok).length, total: items.length });
  const groups = [
    g("Network", [
      { label: "Cluster selected", ok: Boolean(s.network) },
      { label: "RPC endpoint", ok: Boolean(s.rpcUrl), hint: "Helius, Triton or QuickNode URL" },
      { label: "WebSocket endpoint", ok: Boolean(s.wsUrl) },
      { label: "Program ID (deployed Anchor program)", ok: Boolean(s.programId), hint: "from `anchor deploy`" },
    ]),
    g("Authorities", [
      { label: "Protocol authority (multisig)", ok: Boolean(s.protocolAuthority) },
      { label: "Protocol treasury", ok: Boolean(s.protocolTreasury) },
      { label: "Keeper wallet", ok: Boolean(s.keeperWallet) },
      { label: "Authority ≠ keeper ≠ treasury", ok: Boolean(s.protocolAuthority && s.keeperWallet && s.protocolTreasury) && new Set([s.protocolAuthority, s.keeperWallet, s.protocolTreasury]).size === 3 },
    ]),
    g("Economics", [
      { label: "Trade fee ≤ 5%", ok: s.tradeFeeBps > 0 && s.tradeFeeBps <= 500 },
      { label: "Destiny share set", ok: s.destinyShareBps > 0 },
      { label: "Bounds are sane", ok: s.executionThresholdMinSol < s.executionThresholdMaxSol && s.graduationThresholdMinSol < s.graduationThresholdMaxSol },
    ]),
    g("Venues", [
      { label: "Raydium CPMM program", ok: Boolean(s.raydiumCpmmProgram) },
      { label: "Jupiter API", ok: Boolean(s.jupiterApiUrl) },
      { label: "Pyth SOL/USD feed", ok: Boolean(s.pythSolUsdFeed) },
      { label: "USDC mint", ok: Boolean(s.usdcMint) },
      { label: "LST mint", ok: Boolean(s.lstMint) },
    ]),
    g("Metadata & keeper", [
      { label: "Metadata gateway", ok: Boolean(s.metadataGateway) },
      { label: "Metadata API key", ok: Boolean(s.metadataApiKey) },
      { label: "Keeper interval", ok: s.keeperIntervalMs >= 1000 },
    ]),
    g("Site & disclosure", [
      { label: "Site URL", ok: Boolean(s.siteUrl) },
      { label: "Support email", ok: Boolean(s.supportEmail) },
      { label: "Docs URL", ok: Boolean(s.docsUrl) },
      { label: "Audit report", ok: Boolean(s.auditReportUrl), hint: "required before the mainnet switch" },
      { label: "Launch date", ok: Boolean(s.launchDate) },
    ]),
  ];
  const done = groups.reduce((a, x) => a + x.done, 0), total = groups.reduce((a, x) => a + x.total, 0);
  return { groups, done, total, score: Math.round((done / total) * 100), canEnableMainnet: done === total };
}

/** .env for the backend's devnet/mainnet milestone. Secrets included; download is admin-only. */
export function exportEnv(s: Settings): string {
  const lines = [
    "# FATE — generated by the admin console", `FATE_NETWORK=${s.network}`, `SOLANA_RPC_URL=${s.rpcUrl}`, `SOLANA_WS_URL=${s.wsUrl}`, `FATE_PROGRAM_ID=${s.programId}`,
    `FATE_PROTOCOL_AUTHORITY=${s.protocolAuthority}`, `FATE_PROTOCOL_TREASURY=${s.protocolTreasury}`, `FATE_KEEPER_WALLET=${s.keeperWallet}`,
    `FATE_TRADE_FEE_BPS=${s.tradeFeeBps}`, `FATE_DESTINY_SHARE_BPS=${s.destinyShareBps}`, `FATE_MIGRATION_FEE_BPS=${s.migrationFeeBps}`,
    `FATE_EXEC_THRESHOLD_MIN_SOL=${s.executionThresholdMinSol}`, `FATE_EXEC_THRESHOLD_MAX_SOL=${s.executionThresholdMaxSol}`,
    `FATE_GRAD_THRESHOLD_MIN_SOL=${s.graduationThresholdMinSol}`, `FATE_GRAD_THRESHOLD_MAX_SOL=${s.graduationThresholdMaxSol}`,
    `FATE_COOLDOWN_MIN_SECONDS=${s.cooldownMinSeconds}`, `FATE_MAX_SLIPPAGE_BPS_CAP=${s.maxSlippageBpsCap}`,
    `RAYDIUM_CPMM_PROGRAM=${s.raydiumCpmmProgram}`, `JUPITER_API_URL=${s.jupiterApiUrl}`, `PYTH_SOL_USD_FEED=${s.pythSolUsdFeed}`, `USDC_MINT=${s.usdcMint}`, `LST_MINT=${s.lstMint}`,
    `METADATA_GATEWAY=${s.metadataGateway}`, `METADATA_API_KEY=${s.metadataApiKey}`, `FATE_KEEPER_INTERVAL_MS=${s.keeperIntervalMs}`,
    `SITE_URL=${s.siteUrl}`, `SITE_X=${s.xHandle}`, `SITE_TELEGRAM=${s.telegram}`, `SITE_DOCS=${s.docsUrl}`, `SUPPORT_EMAIL=${s.supportEmail}`, `LAUNCH_DATE=${s.launchDate}`, `AUDIT_REPORT_URL=${s.auditReportUrl}`,
    `FATE_MAINNET_ENABLED=${s.mainnetEnabled ? "1" : "0"}`,
  ];
  return lines.join("\n") + "\n";
}
