"use client";
import { useCallback, useEffect, useState } from "react";
import { Sigil } from "@/components/Sigil";
import { fmtSol, fmtTok, ago } from "@/lib/format";

type Settings = Record<string, string | number | boolean>;
interface Readiness { groups: { name: string; items: { label: string; ok: boolean; hint?: string }[]; done: number; total: number }[]; done: number; total: number; score: number; canEnableMainnet: boolean }
interface Ops { stats: Record<string, string | number>; keeper: { running: boolean; ticks: number }; tokens: Record<string, string>[]; failed: Record<string, string>[]; sessions: number; protocolTreasury: string }

const SECTIONS: { title: string; blurb: string; fields: { key: string; label: string; type?: "text" | "number" | "password" | "date" | "select" | "checkbox"; options?: string[]; hint?: string; step?: string }[] }[] = [
  { title: "Network", blurb: "Where the program runs and how the backend reaches it.", fields: [
    { key: "network", label: "Cluster", type: "select", options: ["devnet", "mainnet-beta", "localnet"] },
    { key: "rpcUrl", label: "RPC URL", hint: "https://… (Helius, Triton, QuickNode)" },
    { key: "wsUrl", label: "WebSocket URL", hint: "wss://…" },
    { key: "programId", label: "Program ID", hint: "base58, from anchor deploy" },
  ]},
  { title: "Authorities", blurb: "Three different keys. The authority should be a multisig.", fields: [
    { key: "protocolAuthority", label: "Protocol authority" },
    { key: "protocolTreasury", label: "Protocol treasury" },
    { key: "keeperWallet", label: "Keeper wallet" },
  ]},
  { title: "Economics", blurb: "Protocol-governed parameters. They apply to future launches only; a launched coin's destiny config is immutable.", fields: [
    { key: "tradeFeeBps", label: "Trade fee (bps)", type: "number" },
    { key: "destinyShareBps", label: "Destiny share of fee (bps)", type: "number" },
    { key: "migrationFeeBps", label: "Graduation migration fee (bps)", type: "number" },
    { key: "executionThresholdMinSol", label: "Execution threshold min (SOL)", type: "number", step: "0.01" },
    { key: "executionThresholdMaxSol", label: "Execution threshold max (SOL)", type: "number", step: "0.01" },
    { key: "graduationThresholdMinSol", label: "Graduation threshold min (SOL)", type: "number" },
    { key: "graduationThresholdMaxSol", label: "Graduation threshold max (SOL)", type: "number" },
    { key: "cooldownMinSeconds", label: "Minimum cooldown (seconds)", type: "number" },
    { key: "maxSlippageBpsCap", label: "Max slippage cap (bps)", type: "number" },
  ]},
  { title: "Venues", blurb: "Approved programs and feeds the destinies execute through.", fields: [
    { key: "raydiumCpmmProgram", label: "Raydium CPMM program" },
    { key: "jupiterApiUrl", label: "Jupiter API URL" },
    { key: "pythSolUsdFeed", label: "Pyth SOL/USD feed ID" },
    { key: "usdcMint", label: "USDC mint" },
    { key: "lstMint", label: "LST mint" },
  ]},
  { title: "Metadata & keeper", blurb: "Where token images and metadata are stored, and how often the keeper cranks.", fields: [
    { key: "metadataGateway", label: "Metadata gateway URL" },
    { key: "metadataApiKey", label: "Metadata API key", type: "password" },
    { key: "keeperIntervalMs", label: "Keeper interval (ms)", type: "number" },
  ]},
  { title: "Site & disclosure", blurb: "What the public site shows in preview and at launch.", fields: [
    { key: "siteUrl", label: "Site URL" },
    { key: "xHandle", label: "X handle" },
    { key: "telegram", label: "Telegram" },
    { key: "docsUrl", label: "Docs URL" },
    { key: "supportEmail", label: "Support email" },
    { key: "auditReportUrl", label: "Audit report URL" },
    { key: "launchDate", label: "Launch date", type: "date" },
  ]},
];

export function AdminConsole() {
  const [s, setS] = useState<Settings | null>(null);
  const [r, setR] = useState<Readiness | null>(null);
  const [ops, setOps] = useState<Ops | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"readiness" | "ops">("readiness");

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/admin/settings", { cache: "no-store" }), fetch("/api/admin/ops", { cache: "no-store" })]);
    if (a.status === 401) { location.href = "/admin/login"; return; }
    const j = await a.json(); setS(j.settings); setR(j.readiness);
    if (b.ok) setOps(await b.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(extra: Partial<Settings> = {}) {
    if (!s) return;
    setSaving(true); setMsg(null);
    const res = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...s, ...extra }) });
    const j = await res.json();
    if (!res.ok) { setErrors(j.errors ?? {}); setMsg("Some fields need attention."); }
    else { setErrors({}); setS(j.settings); setR(j.readiness); setMsg("Saved."); }
    setSaving(false);
  }
  async function op(action: string, tokenId?: string) {
    setMsg(null);
    const res = await fetch("/api/admin/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, tokenId }) });
    const j = await res.json();
    setMsg(Array.isArray(j) ? `Cranked ${j.length} coins, ${j.filter((x: { executed: boolean }) => x.executed).length} executed.` : j.executed ? `Executed ${j.executionId}.` : `Not executed: ${j.reason ?? j.error ?? "see state"}.`);
    load();
  }

  if (!s || !r) return <div className="min-h-screen flex items-center justify-center"><Sigil size={48} className="text-gold spin-slow" /></div>;

  return (
    <div className="min-h-screen bg-obsidian">
      <header className="hairline border-b border-line sticky top-0 z-30 glass">
        <div className="mx-auto max-w-[1360px] px-5 sm:px-8 h-16 flex items-center gap-4">
          <Sigil size={24} className="text-gold" /><span className="display text-[18px]">Fate</span><span className="chip">Admin</span>
          <nav className="ml-6 flex gap-1">
            <button className={`tab ${tab === "readiness" ? "tab-on" : ""}`} onClick={() => setTab("readiness")}>Mainnet readiness</button>
            <button className={`tab ${tab === "ops" ? "tab-on" : ""}`} onClick={() => setTab("ops")}>Operations</button>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href="/api/admin/preview?on=1" target="_blank" rel="noreferrer" className="btn btn-sm" data-testid="open-preview">Open preview</a>
            <a href="/api/admin/export" className="btn btn-sm btn-ghost">Export .env</a>
            <button className="btn btn-sm btn-ghost" onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); location.href = "/admin/login"; }}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1360px] px-5 sm:px-8 py-10">
        {tab === "readiness" && (
          <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
            <aside className="lg:sticky lg:top-24 self-start grid gap-5">
              <div className="card p-6">
                <div className="flex items-end justify-between">
                  <div><div className="eyebrow">Readiness</div><div className="display text-[56px] num leading-none mt-1" data-testid="score">{r.score}%</div></div>
                  <div className="label text-right">{r.done} of {r.total}<br />checks</div>
                </div>
                <div className="meter mt-4"><i style={{ width: `${r.score}%` }} /></div>
                <ul className="mt-5 grid gap-2">
                  {r.groups.map((g) => (
                    <li key={g.name} className="flex items-center justify-between text-sm">
                      <span className={g.done === g.total ? "text-ivory" : "text-dim"}>{g.name}</span>
                      <span className={`num ${g.done === g.total ? "text-orbit" : "text-dim"}`}>{g.done}/{g.total}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`card p-6 ${r.canEnableMainnet ? "card-accent" : ""}`}>
                <div className="eyebrow">Mainnet switch</div>
                <p className="mt-2 text-sm text-dim">{r.canEnableMainnet ? "All checks pass. Enabling makes the exported .env flag the backend as mainnet-ready." : "Complete every check before the switch becomes available."}</p>
                <label className="mt-4 flex items-center gap-3 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-[var(--color-gold)]" disabled={!r.canEnableMainnet} checked={Boolean(s.mainnetEnabled)} onChange={(e) => { const v = e.target.checked; setS({ ...s, mainnetEnabled: v }); save({ mainnetEnabled: v }); }} data-testid="mainnet-switch" />
                  Mainnet enabled
                </label>
              </div>
              <div className="card p-6">
                <div className="eyebrow">Preview</div>
                <p className="mt-2 text-sm text-dim">Open the public site with this configuration applied (network label, links, launch date). Only your browser sees it.</p>
                <a href="/api/admin/preview?on=1" target="_blank" rel="noreferrer" className="btn btn-primary mt-4 w-full">Open preview</a>
              </div>
            </aside>

            <form className="grid gap-6" onSubmit={(e) => { e.preventDefault(); save(); }}>
              {SECTIONS.map((sec, si) => {
                const g = r.groups[si];
                return (
                  <section key={sec.title} className="card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div><h2 className="display-md text-[22px]">{sec.title}</h2><p className="text-sm text-dim mt-1">{sec.blurb}</p></div>
                      <span className={`chip ${g.done === g.total ? "" : "!bg-ivory/8 !text-dim"}`}>{g.done}/{g.total}</span>
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      {sec.fields.map((f) => (
                        <label key={f.key} className={`text-sm ${["rpcUrl", "wsUrl", "metadataGateway", "jupiterApiUrl"].includes(f.key) ? "sm:col-span-2" : ""}`}>
                          <span className="label">{f.label}</span>
                          {f.type === "select" ? (
                            <select className="field mt-1" value={String(s[f.key] ?? "")} onChange={(e) => setS({ ...s, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                          ) : (
                            <input className={`field mt-1 ${errors[f.key] ? "field-error" : ""}`} type={f.type ?? "text"} step={f.step} placeholder={f.hint} data-testid={`f-${f.key}`}
                              value={String(s[f.key] ?? "")} onChange={(e) => setS({ ...s, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })} />
                          )}
                          {errors[f.key] && <span className="text-phoenix text-xs">{errors[f.key]}</span>}
                        </label>
                      ))}
                    </div>
                    <ul className="mt-5 grid gap-1.5 sm:grid-cols-2">
                      {g.items.map((it) => (
                        <li key={it.label} className="flex items-center gap-2 text-sm">
                          <i className={`h-4 w-4 rounded-full flex items-center justify-center text-[10px] ${it.ok ? "bg-orbit text-obsidian" : "bg-ivory/10 text-dim"}`}>{it.ok ? "✓" : ""}</i>
                          <span className={it.ok ? "text-ivory" : "text-dim"}>{it.label}</span>
                          {!it.ok && it.hint && <span className="label">· {it.hint}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <div className="sticky bottom-4 flex items-center gap-3 glass rounded-full px-4 py-3">
                <button className="btn btn-primary" disabled={saving} data-testid="save">{saving ? "Saving…" : "Save configuration"}</button>
                {msg && <span className="text-sm text-dim" data-testid="save-msg">{msg}</span>}
              </div>
            </form>
          </div>
        )}

        {tab === "ops" && ops && (
          <div className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[["Coins", ops.stats.tokens], ["Executions", ops.stats.executions], ["Fees routed", `${fmtSol(ops.stats.feesRouted, 2)} SOL`], ["Protocol treasury", `${fmtSol(ops.protocolTreasury, 2)} SOL`], ["Active sessions", ops.sessions], ["Keeper", ops.keeper.running ? `running · ${ops.keeper.ticks} ticks` : "stopped"]].map(([k, v]) => (
                <div key={String(k)} className="card p-5"><div className="eyebrow">{k}</div><div className="display-md text-[22px] num mt-1">{String(v)}</div></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => op("crank")}>Crank all</button>
              <button className="btn btn-ghost" onClick={() => op("snapshot")}>Snapshot markets</button>
              {msg && <span className="self-center text-sm text-dim">{msg}</span>}
            </div>
            <div className="card p-6 overflow-x-auto">
              <h2 className="display-md text-[22px]">Coins</h2>
              <table className="table mt-3"><thead><tr><th>Coin</th><th>Destiny</th><th>Venue</th><th>State</th><th>Executions</th><th>Vault</th><th>Holders</th><th></th></tr></thead>
                <tbody>{ops.tokens.map((t) => (
                  <tr key={t.id}><td><a className="link" href={`/coin/${t.id}`} target="_blank" rel="noreferrer">{t.name} <span className="text-dim">{t.ticker}</span></a></td><td data-destiny={t.destiny} style={{ color: "var(--accent)" }}>{t.destiny}</td><td>{t.status}</td><td>{t.state}</td><td className="num">{String(t.executions)}</td><td className="num">{fmtSol(t.vault, 3)}</td><td className="num">{String(t.holders)}</td>
                    <td className="text-right"><button className="btn btn-sm" onClick={() => op("crank", t.id)}>Crank</button></td></tr>))}</tbody></table>
            </div>
            <div className="card p-6">
              <h2 className="display-md text-[22px]">Failed executions</h2>
              {ops.failed.length === 0 ? <p className="text-sm text-dim mt-2">None.</p> : (
                <table className="table mt-3"><thead><tr><th>Coin</th><th>Seq</th><th>Error</th><th>When</th></tr></thead>
                  <tbody>{ops.failed.map((f) => <tr key={f.id}><td>{f.ticker}</td><td className="num">{String(f.seq)}</td><td className="text-phoenix">{f.error}</td><td className="text-dim">{ago(f.created_at)}</td></tr>)}</tbody></table>)}
            </div>
            <p className="label">Burned {fmtTok(ops.stats.burned)} · liquidity {fmtSol(ops.stats.liquidity, 2)} SOL · rewards {fmtSol(ops.stats.rewards, 2)} SOL · treasuries {fmtSol(ops.stats.treasury, 2)} SOL</p>
          </div>
        )}
      </div>
    </div>
  );
}
