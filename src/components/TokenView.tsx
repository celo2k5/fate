"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Character } from "./Character";
import { CharacterScene } from "./Scene";
import { TradePanel } from "./TradePanel";
import { LiveActivity } from "./LiveActivity";
import { useStream, type StreamEvent } from "@/lib/useStream";
import { useWallet } from "@/lib/wallet";
import { fmtSol, fmtTok, fmtPrice, pct, ago, countdown, shortAddr, actionWord, bpsPct } from "@/lib/format";

// Detail is whatever Protocol.detail() returns, serialised (bigint -> string).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detail = any;

export function TokenView({ initial, initialActivity }: { initial: Detail; initialActivity: StreamEvent[] }) {
  const [d, setD] = useState<Detail>(initial);
  const [pulseKey, setPulseKey] = useState(0);
  const [crankMsg, setCrankMsg] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claimable, setClaimable] = useState<{ epochId: string; epoch: number; amount: string; claimed: boolean }[]>([]);
  const [, tick] = useState(0);
  const w = useWallet();
  const id: string = d.token.id;

  const reload = useCallback(async () => {
    const r = await fetch(`/api/tokens/${id}`, { cache: "no-store" });
    if (r.ok) setD(await r.json());
  }, [id]);

  const loadClaims = useCallback(async () => {
    if (!w.address || d.token.destiny !== "ECHO") return;
    const r = await fetch(`/api/tokens/${id}/claim`, { cache: "no-store" });
    if (r.ok) setClaimable((await r.json()).claimable);
  }, [id, w.address, d.token.destiny]);

  useEffect(() => { loadClaims(); }, [loadClaims]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  useStream({
    tokenId: id,
    onReconnect: reload,
    onEvent: (e) => {
      if (e.type === "destiny.executed") setPulseKey((k) => k + 1);
      if (["trade", "destiny.executed", "destiny.failed", "graduation", "reward.settled", "reward.claimed", "destiny.eligible"].includes(e.type)) { reload(); loadClaims(); }
    },
  });

  async function crank() {
    setCrankMsg(null);
    const r = await fetch("/api/crank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenId: id }) });
    const j = await r.json();
    setCrankMsg(j.executed ? `Executed ${actionWord[d.token.destiny]} (${j.executionId}).` : `Not executed: ${j.reason ?? j.error ?? j.state}.`);
    reload();
  }

  async function claim(epochId: string) {
    setClaimMsg(null);
    try {
      const signed = await w.signIntent({ kind: "claim", tokenId: id, epochId });
      const r = await fetch(`/api/tokens/${id}/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signed) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setClaimMsg(`Claimed ${fmtSol(j.claim.amount, 4)} SOL for epoch ${j.claim.epoch}.`);
      setClaimable(j.claimable);
      await w.refresh();
    } catch (e) { setClaimMsg(e instanceof Error ? e.message : String(e)); }
  }

  const t = d.token, st = d.state, el = d.eligibility, cfg = d.config;
  const destiny: "PHOENIX" | "GRAVITY" | "ECHO" | "ORBIT" = t.destiny;
  const level = destiny === "GRAVITY" ? d.positions?.length ?? 0 : Number(st.executions);
  const sats = destiny === "ORBIT" ? (d.assets as { asset: string; valueLamports: string | null }[]).filter((a) => a.asset !== "RESERVE" && a.valueLamports !== null).map((a) => ({ label: a.asset, share: Number(a.valueLamports) / Math.max(1, Number(d.treasuryValue)) })) : undefined;
  const stateLabel: Record<string, string> = { IDLE: "Idle — no fees yet", ACCUMULATING: "Accumulating", ELIGIBLE: "Eligible", EXECUTING: "Executing", COMPLETED: "Completed — accumulating again", FAILED: "Last attempt failed — will retry" };

  return (
    <div data-destiny={destiny} className="mx-auto max-w-[1320px] px-5 sm:px-8 pt-28 pb-16">
      {/* header */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-line pb-6">
        {t.image && <img src={t.image} alt="" className="h-16 w-16 rounded-[12px] object-cover rule" />}
        <div>
          <h1 className="display text-[40px] sm:text-[56px]">{t.name} <span className="display-light text-[28px] sm:text-[36px] text-ivory-2">{t.ticker}</span></h1>
          <div className="mt-2 small text-ivory-2 flex flex-wrap gap-x-4 gap-y-1">
            <span style={{ color: "var(--accent)" }}>{d.meta.title} destiny</span>
            <span>{t.status === "AMM" ? "Trading on AMM" : "Bonding curve"}</span>
            <span>Created by <span className="text-ivory">{shortAddr(t.creator)}</span></span>
            <span>Launch sig <span className="text-ivory" title={d.launch.signature}>{shortAddr(d.launch.signature, 6)}</span></span>
            {t.website && <a className="link" href={t.website} target="_blank" rel="noreferrer">Website</a>}
            {t.x && <a className="link" href={`https://x.com/${String(t.x).replace(/^@/, "")}`} target="_blank" rel="noreferrer">X</a>}
            {t.telegram && <a className="link" href={`https://t.me/${String(t.telegram).replace(/^@/, "")}`} target="_blank" rel="noreferrer">Telegram</a>}
          </div>
        </div>
        <dl className="ml-auto grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-1 small num">
          <dt className="text-ivory-3">Price</dt><dd data-testid="price">{fmtPrice(d.price)} SOL</dd>
          <dt className="text-ivory-3">Market cap</dt><dd>{fmtSol(d.marketCap, 1)} SOL</dd>
          <dt className="text-ivory-3">Volume 24h</dt><dd>{fmtSol(d.volume24h, 2)} SOL</dd>
          <dt className="text-ivory-3">Holders</dt><dd>{d.holders}</dd>
        </dl>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-8">
          {/* destiny character — reflects real state */}
          <section className="card card-metal p-4 sm:p-6 grid gap-6 md:grid-cols-[auto_1fr] items-center" data-testid="destiny-panel">
            <div className="relative w-full md:w-[300px]">
              <CharacterScene name={destiny.toLowerCase()} />
              <div className="absolute bottom-2 right-2 rounded-full p-1" style={{ background: "rgba(1,8,40,.85)", boxShadow: "inset 0 1px 1px rgba(255,255,255,.1)" }}><Character destiny={destiny} progress={el.progress} level={level} pulseKey={pulseKey} satellites={sats} size={96} /></div>
            </div>
            <div>
              <div className="display text-[36px]" style={{ color: "var(--accent)" }}>{d.meta.title}</div><p className="voice text-[22px]">{d.meta.tagline}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 small num">
                <dt className="text-ivory-2">Vault</dt><dd data-testid="vault">{fmtSol(d.vault, 4)} SOL</dd>
                <dt className="text-ivory-2">Next {actionWord[destiny]}</dt><dd>{fmtSol(cfg.execution_threshold, 2)} SOL</dd>
                <dt className="text-ivory-2">Progress</dt><dd data-testid="progress">{pct(el.progress)}</dd>
                <dt className="text-ivory-2">State</dt><dd data-testid="state">{stateLabel[st.state]}</dd>
                {el.nextAt && <><dt className="text-ivory-2">{destiny === "ECHO" ? "Epoch ends" : "Cooldown ends"}</dt><dd>{countdown(el.nextAt)}</dd></>}
                <dt className="text-ivory-2">Lifetime fees</dt><dd>{fmtSol(st.lifetime_fees, 4)} SOL</dd>
                {destiny === "PHOENIX" && <><dt className="text-ivory-2">Total burned</dt><dd data-testid="burned">{fmtTok(st.total_burned)} {t.ticker}</dd>
                  <dt className="text-ivory-2">Last buyback</dt><dd>{d.lastBuyback ? `${fmtSol(d.lastBuyback.amount_used, 3)} SOL · ${ago(d.lastBuyback.completed_at)}` : "none yet"}</dd></>}
                {destiny === "GRAVITY" && <><dt className="text-ivory-2">Liquidity added</dt><dd>{fmtSol(st.total_liquidity_added, 3)} SOL</dd>
                  <dt className="text-ivory-2">Locked position</dt><dd>{fmtSol(d.position.s, 3)} SOL + {fmtTok(d.position.t)} {t.ticker}{d.pool ? ` · ${fmtTok(d.position.lp)} LP` : " · escrow"}</dd></>}
                {destiny === "ECHO" && <><dt className="text-ivory-2">Current epoch</dt><dd>{d.currentEpoch}</dd>
                  <dt className="text-ivory-2">Distributed</dt><dd>{fmtSol(st.total_rewards_distributed, 3)} SOL</dd>
                  <dt className="text-ivory-2">Unclaimed escrow</dt><dd>{fmtSol(d.rewardsEscrow, 3)} SOL</dd>
                  <dt className="text-ivory-2">Min balance</dt><dd>{fmtTok(d.params.minBalance)} {t.ticker}</dd></>}
                {destiny === "ORBIT" && <><dt className="text-ivory-2">{d.treasuryValuePartial ? "Treasury (SOL legs)" : "Treasury value"}</dt><dd>{fmtSol(d.treasuryValue, 3)} SOL</dd>
                  <dt className="text-ivory-2">Deployed</dt><dd>{fmtSol(st.total_treasury_deployed, 3)} SOL</dd></>}
              </dl>
              <div className="meter mt-4"><i style={{ width: pct(el.progress) }} /></div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button className="btn small" onClick={crank} data-testid="crank">Run crank</button>
                <span className="small text-ivory-3">Permissionless. The protocol re-checks every condition.</span>
              </div>
              {crankMsg && <p className="mt-2 small text-ivory-2" data-testid="crank-result">{crankMsg}</p>}
              {st.last_error && st.state === "FAILED" && <p className="mt-2 small text-phoenix">Last error: {st.last_error}</p>}
            </div>
          </section>

          {/* destiny extras */}
          {destiny === "ORBIT" && (
            <section className="card px-6 py-5">
              <h2 className="display text-[22px]">Treasury</h2>
              <table className="mt-3 w-full small num"><thead className="text-ivory-3 text-left"><tr><th className="font-normal py-1">Asset</th><th className="font-normal">Target</th><th className="font-normal">Holding</th><th className="font-normal">Cost basis</th><th className="font-normal">Value now</th></tr></thead>
                <tbody>{(d.assets as { asset: string; amount: string; cost_basis_lamports: string; valueLamports: string }[]).map((a) => (
                  <tr key={a.asset} className="border-t border-line"><td className="py-1.5">{a.asset === "RESERVE" ? "Retained reserve" : a.asset}</td><td>{(d.params.allocationBps[a.asset] / 100).toFixed(0)}%</td>
                    <td>{a.asset === "USDC" ? (Number(a.amount) / 1e6).toFixed(2) + " USDC" : a.asset === "LST" ? (Number(a.amount) / 1e9).toFixed(4) + " LST" : fmtSol(a.amount, 4) + " SOL"}</td>
                    <td>{fmtSol(a.cost_basis_lamports, 4)} SOL</td><td>{a.valueLamports === null ? <span className="text-ivory-3" title="No price source on-chain; held amount shown">not priced</span> : `${fmtSol(a.valueLamports, 4)} SOL`}</td></tr>))}</tbody></table>
              <p className="mt-3 small text-ivory-3">Valued at the simnet oracle. A treasury is not a promise of profit.</p>
            </section>
          )}
          {destiny === "ECHO" && (
            <section className="card px-6 py-5">
              <h2 className="display text-[22px]">Rewards</h2>
              {w.address ? (
                claimable.length === 0 ? <p className="mt-2 small text-ivory-2">Your wallet is not in any settled epoch yet. Hold at least {fmtTok(d.params.minBalance)} {t.ticker} through an epoch without selling.</p> : (
                  <ul className="mt-3 divide-y divide-line small">{claimable.map((c) => (
                    <li key={c.epochId} className="py-2 flex items-center gap-4"><span>Epoch {c.epoch}</span><span className="num">{fmtSol(c.amount, 4)} SOL</span>
                      {c.claimed ? <span className="ml-auto text-ivory-3">Claimed</span> : <button className="btn btn-accent ml-auto !py-1.5 small" onClick={() => claim(c.epochId)} data-testid="claim">Claim</button>}</li>))}</ul>)
              ) : <p className="mt-2 small text-ivory-2">Connect a wallet to see claimable rewards.</p>}
              {claimMsg && <p className="mt-2 small text-ivory-2" data-testid="claim-result">{claimMsg}</p>}
              <h3 className="mt-6 small text-ivory-2">Reward history</h3>
              {d.epochs.length === 0 ? <p className="small text-ivory-3 mt-1">No epochs settled yet. Next distribution: {countdown(el.nextAt)}.</p> : (
                <table className="mt-2 w-full small num"><thead className="text-ivory-3 text-left"><tr><th className="font-normal py-1">Epoch</th><th className="font-normal">Funded</th><th className="font-normal">Eligible</th><th className="font-normal">Claimed</th><th className="font-normal">Settled</th></tr></thead>
                  <tbody>{(d.epochs as { id: string; epoch: string; funded: string; eligible_wallets: string; claimed: string; created_at: string }[]).map((e) => (
                    <tr key={e.id} className="border-t border-line"><td className="py-1.5">{e.epoch}</td><td>{fmtSol(e.funded, 4)} SOL</td><td>{e.eligible_wallets}</td><td>{fmtSol(e.claimed, 4)} SOL</td><td>{ago(e.created_at)}</td></tr>))}</tbody></table>)}
            </section>
          )}

          {/* curve / graduation */}
          <section className="card px-6 py-5">
            <div className="flex items-baseline justify-between">
              <h2 className="display text-[22px]">{t.status === "AMM" ? "Graduated" : "Bonding curve"}</h2>
              <span className="small num text-ivory-2">{t.status === "AMM" ? `LP locked ${fmtTok(d.pool.lp_locked)}` : `${pct(d.graduationProgress)} to graduation at ${fmtSol(cfg.graduation_threshold, 0)} SOL`}</span>
            </div>
            <div className="meter mt-3"><i style={{ width: pct(d.graduationProgress) }} /></div>
            <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 small num">
              {t.status === "AMM" ? <>
                <dt className="text-ivory-3">Pool SOL</dt><dd>{fmtSol(d.pool.sol_reserve, 3)}</dd>
                <dt className="text-ivory-3">Pool tokens</dt><dd>{fmtTok(d.pool.token_reserve)}</dd>
                <dt className="text-ivory-3">Migrated</dt><dd>{fmtSol(d.graduation.sol_migrated, 2)} SOL</dd>
                <dt className="text-ivory-3">Graduation sig</dt><dd title={d.graduation.signature}>{shortAddr(d.graduation.signature, 6)}</dd>
              </> : <>
                <dt className="text-ivory-3">Real SOL</dt><dd>{fmtSol(d.curve.real_sol, 3)}</dd>
                <dt className="text-ivory-3">Tokens left</dt><dd>{fmtTok(d.curve.real_tokens)}</dd>
                <dt className="text-ivory-3">Reserved for AMM</dt><dd>{fmtTok(d.curve.reserved_tokens)}</dd>
                <dt className="text-ivory-3">Circulating</dt><dd>{fmtTok(t.circulating)}</dd>
              </>}
            </dl>
          </section>

          {/* execution history */}
          {d.agent && <AgentPanel agent={d.agent} />}

          <section className="card px-6 py-5">
            <h2 className="display text-[22px]">Execution history</h2>
            {d.executions.length === 0 ? <p className="mt-2 small text-ivory-3">No executions yet. The vault needs {fmtSol(cfg.execution_threshold, 2)} SOL.</p> : (
              <ul className="mt-3 divide-y divide-line small" data-testid="executions">
                {(d.executions as { id: string; seq: string; status: string; amount_used: string; result_json: string; error: string | null; venue: string; created_at: string }[]).map((e) => {
                  const r = JSON.parse(e.result_json || "{}");
                  return (
                    <li key={e.id} className="py-2.5 grid gap-1 sm:grid-cols-[3rem_6rem_1fr_auto]">
                      <span className="num text-ivory-3">#{e.seq}</span>
                      <span className={e.status === "COMPLETED" ? "text-orbit" : e.status === "FAILED" ? "text-phoenix" : "text-ivory-2"}>{e.status.toLowerCase()}</span>
                      <span className="text-ivory-2">
                        {e.status === "FAILED" ? e.error :
                          destiny === "PHOENIX" ? `Bought and burned ${fmtTok(r.tokensBurned)} ${t.ticker} with ${fmtSol(e.amount_used, 4)} SOL on the ${e.venue === "AMM" ? "AMM" : "curve"} · impact ${bpsPct(r.priceImpactBps ?? 0)}` :
                          destiny === "GRAVITY" ? `Locked ${fmtSol(r.solLocked, 4)} SOL + ${fmtTok(r.tokensLocked)} ${t.ticker} (${r.stage === "POOL" ? "in pool" : "escrow"})` :
                          destiny === "ECHO" ? `Epoch ${r.epoch}: ${fmtSol(r.funded, 4)} SOL to ${r.eligibleWallets} wallets` :
                          `Deployed ${fmtSol(e.amount_used, 4)} SOL: ${(r.acquisitions ?? []).map((a: { asset: string }) => a.asset).join(", ")}`}
                      </span>
                      <span className="text-ivory-3 num">{ago(e.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* trades */}
          <section className="card px-6 py-5">
            <h2 className="display text-[22px]">Trades</h2>
            {d.trades.length === 0 ? <p className="mt-2 small text-ivory-3">No trades yet.</p> : (
              <table className="mt-3 w-full small num" data-testid="trades"><thead className="text-ivory-3 text-left"><tr><th className="font-normal py-1">Side</th><th className="font-normal">Trader</th><th className="font-normal">SOL</th><th className="font-normal">{t.ticker}</th><th className="font-normal">Fee</th><th className="font-normal">When</th></tr></thead>
                <tbody>{(d.trades as { id: string; side: string; trader: string; sol_amount: string; token_amount: string; fee_lamports: string; is_protocol: string; created_at: string }[]).slice(0, 12).map((x) => (
                  <tr key={x.id} className="border-t border-line"><td className={`py-1.5 ${x.side === "BUY" ? "text-orbit" : "text-phoenix"}`}>{x.side.toLowerCase()}</td>
                    <td>{Number(x.is_protocol) ? <span style={{ color: "var(--accent)" }}>{d.meta.title} vault</span> : shortAddr(x.trader)}</td>
                    <td>{fmtSol(x.sol_amount, 4)}</td><td>{fmtTok(x.token_amount)}</td><td>{fmtSol(x.fee_lamports, 5)}</td><td className="text-ivory-3">{ago(x.created_at)}</td></tr>))}</tbody></table>)}
          </section>

          <section className="small text-ivory-2">
            <h2 className="display text-[22px] text-ivory">Authorities after launch</h2>
            <dl className="mt-3 grid gap-1 sm:grid-cols-[10rem_1fr]">
              {Object.entries(JSON.parse(d.launch.authorities_json) as Record<string, string>).map(([k, v]) => <div key={k} className="contents"><dt className="text-ivory-3 capitalize">{k}</dt><dd>{v}</dd></div>)}
            </dl>
            <p className="mt-3 small text-ivory-3">Config hash {cfg.config_hash.slice(0, 16)}… · fee {bpsPct(Number(cfg.trade_fee_bps))} · {Number(cfg.destiny_share_bps) / 100}% to vault · max slippage {bpsPct(Number(cfg.max_slippage_bps))} · cooldown {Number(cfg.cooldown_ms) / 1000}s</p>
          </section>
        </div>

        <div className="grid gap-6 content-start lg:sticky lg:top-20">
          <TradePanel tokenId={id} ticker={t.ticker} status={t.status} onTraded={reload} onChain={Boolean(t.chain && t.chain !== "SIMNET")} />
          <LiveActivity initial={initialActivity} tokenId={id} compact />
          <p className="small text-ivory-3"><Link href={`/destinies/${destiny.toLowerCase()}`} className="link">How {d.meta.title} works</Link> · mint {shortAddr(id, 6)}</p>
        </div>
      </div>
    </div>
  );
}


const EXPLORER = (kind: "tx" | "address", v: string, chain: string) => `https://explorer.solana.com/${kind}/${v}${chain === "MAINNET" ? "" : "?cluster=devnet"}`;
const PURPOSE: Record<string, string> = {
  launch: "Launch", collect_fees: "Collect creator fees", phoenix_buy_burn: "Buyback + burn", phoenix_pool_buy_burn: "Buyback + burn (PumpSwap)",
  gravity_escrow_buy: "Escrow buy", gravity_pool_buy: "Pool buy", gravity_pool_deposit: "Liquidity deposit", echo_payout: "Echo payout",
  orbit_swap_usdc: "Treasury swap → USDC", orbit_swap_lst: "Treasury swap → JitoSOL", protocol_share: "Protocol share", trade: "Trade",
};

/** On-chain agent status for devnet / mainnet coins: verified transactions only, with explorer links and the trust model stated plainly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AgentPanel({ agent }: { agent: any }) {
  const txs = agent.recentTx as { purpose: string; status: string; signature: string | null; error: string | null; updated_at: string }[];
  const tone = agent.state === "FAILED" ? "text-phoenix" : agent.state === "EXECUTING" ? "text-mint" : "text-ivory";
  return (
    <section className="card card-metal px-6 py-5" data-testid="agent-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="display text-[22px]">On-chain agent</h2>
        <span className="chip mono">{agent.chain}</span>
      </div>
      <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-1.5 small">
        <dt className="text-ivory-2">State</dt><dd className={tone}>{agent.state}{Number(agent.pendingTx) > 0 ? ` · ${agent.pendingTx} tx pending` : ""}</dd>
        {agent.lastError && <><dt className="text-ivory-2">Last error</dt><dd className="text-phoenix break-words">{agent.lastError}</dd></>}
        {agent.nextRetryAt && <><dt className="text-ivory-2">Next retry</dt><dd>{countdown(Number(agent.nextRetryAt))}</dd></>}
        <dt className="text-ivory-2">Mint</dt><dd className="mono truncate"><a className="link" href={EXPLORER("address", agent.mint, agent.chain)} target="_blank" rel="noreferrer">{shortAddr(agent.mint, 6)}</a></dd>
        <dt className="text-ivory-2">Vault authority</dt><dd className="mono truncate"><a className="link" href={EXPLORER("address", agent.vaultAuthority, agent.chain)} target="_blank" rel="noreferrer">{shortAddr(agent.vaultAuthority, 6)}</a></dd>
      </dl>
      <div className="mt-5">
        <div className="eyebrow">Recent agent transactions</div>
        {txs.length === 0 ? <p className="mt-2 small text-ivory-3">None yet. The agent acts once the vault reaches its threshold.</p> : (
          <ul className="mt-2 grid gap-1.5 small">
            {txs.map((t, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3">
                <span className={t.status === "CONFIRMED" ? "text-mint" : t.status === "FAILED" || t.status === "EXPIRED" ? "text-phoenix" : "text-ivory-2"}>{t.status.toLowerCase()}</span>
                <span>{PURPOSE[t.purpose] ?? t.purpose}</span>
                {t.signature && <a className="link mono" href={EXPLORER("tx", t.signature, agent.chain)} target="_blank" rel="noreferrer">{shortAddr(t.signature, 6)}</a>}
                <span className="text-ivory-3 ml-auto">{ago(Number(t.updated_at))}</span>
                {t.error && <span className="basis-full text-phoenix break-words">{t.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-5 small text-ivory-3">Trust model: this coin&apos;s creator fees go to a vault key held by the FATE server. The destiny is enforced by server policy, and every spend is a signed, public transaction you can audit above. It is not a trustless on-chain program.</p>
    </section>
  );
}
