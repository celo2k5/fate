"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { fmtSol, fmtTok, bpsPct, fmtPrice } from "@/lib/format";

interface Quote { side: string; amountIn: string; amountOut: string; fee: string; destinyFee: string; priceImpactBps: number; minOut: string; spotAfter: number; venue: string }

export function TradePanel({ tokenId, ticker, status, onTraded, onChain = false }: { tokenId: string; ticker: string; status: string; onTraded: () => void; onChain?: boolean }) {
  const w = useWallet();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holding = w.portfolio?.holdings.find((h) => h.token_id === tokenId)?.amount ?? "0";
  const lamports = w.portfolio?.lamports ?? "0";

  const units = (): bigint | null => {
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return null;
    return side === "BUY" ? BigInt(Math.round(n * 1e9)) : BigInt(Math.round(n * 1e6));
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const u = units();
    if (!u) { setQuote(null); setQErr(null); return; }
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/tokens/${tokenId}/quote?side=${side}&amount=${u}&slippageBps=${slippage}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) { setQuote(j); setQErr(null); } else { setQuote(null); setQErr(j.error); }
    }, 180);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, slippage, tokenId]);

  async function submit() {
    if (!quote) return;
    setBusy(true); setResult(null);
    try {
      const signed = await w.signIntent({ kind: "trade", tokenId, side, amountIn: quote.amountIn, minOut: quote.minOut, slippageBps: slippage });
      let j: { trade: { token_amount: string; sol_amount: string; fee_lamports: string } | null; error?: string; signature?: string };
      if (onChain) {
        // 1) the server builds the real pump.fun transaction, 2) the wallet signs it, 3) the server sends, confirms and indexes it
        const prep = await fetch("/api/chain/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signed) });
        const pj = await prep.json();
        if (!prep.ok) throw new Error(pj.error);
        setResult({ ok: true, text: "Approve the transaction in your wallet…" });
        const signedTx = await w.signTransaction(pj.tx);
        setResult({ ok: true, text: "Sent. Waiting for confirmation…" });
        const sub = await fetch("/api/chain/trade", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepareId: pj.prepareId, signedTx }) });
        j = await sub.json();
        if (!sub.ok) throw new Error(j.error);
        if (!j.trade) { setResult({ ok: true, text: `Confirmed ${j.signature?.slice(0, 12)}…; indexing.` }); await w.refresh(); onTraded(); return; }
      } else {
        const r = await fetch(`/api/tokens/${tokenId}/trade`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signed) });
        j = await r.json();
        if (!r.ok) throw new Error(j.error);
      }
      if (!j.trade) throw new Error("no trade recorded");
      setResult({ ok: true, text: side === "BUY" ? `Bought ${fmtTok(j.trade.token_amount)} ${ticker} for ${fmtSol(j.trade.sol_amount, 4)} SOL` : `Sold ${fmtTok(j.trade.token_amount)} ${ticker} for ${fmtSol(BigInt(j.trade.sol_amount) - BigInt(j.trade.fee_lamports), 4)} SOL` });
      setAmount("");
      await w.refresh();
      onTraded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, text: /reject|denied|cancel/i.test(msg) ? "Signature rejected in the wallet — nothing was sent." : msg });
    } finally { setBusy(false); }
  }

  if (status === "GRADUATING") return <div className="card px-5 py-4 small text-ivory-2">Trading is paused while the coin graduates.</div>;

  return (
    <div className="card p-4" data-testid="trade-panel">
      <div className="grid grid-cols-2 gap-1 rounded-[12px] card-sm p-1">
        {(["BUY", "SELL"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); setAmount(""); setResult(null); }} data-testid={`side-${s}`}
            className={`py-3 rounded-[12px] text-[14px] font-medium transition-colors ${side === s ? "bg-ivory text-obsidian" : "text-ivory-2"}`}>{s === "BUY" ? "Buy" : "Sell"}</button>
        ))}
      </div>
      <label className="block mt-4 small text-ivory-2">
        {side === "BUY" ? "You pay (SOL)" : `You sell (${ticker})`}
        <div className="mt-1 flex gap-2">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className="field num" data-testid="amount" />
          <button type="button" className="btn !px-3 small" onClick={() => setAmount(side === "BUY" ? (Math.max(0, Number(lamports) / 1e9 - 0.01)).toFixed(3) : (Number(holding) / 1e6).toString())}>Max</button>
        </div>
      </label>
      <div className="mt-2 flex justify-between small text-ivory-3 num">
        <span>Balance: {side === "BUY" ? `${fmtSol(lamports, 3)} SOL` : `${fmtTok(holding)} ${ticker}`}</span>
        <label className="flex items-center gap-1">Slippage
          <select value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} className="bg-obsidian rounded px-1 py-0.5 text-ivory">
            {[50, 100, 300, 500, 1000].map((b) => <option key={b} value={b}>{b / 100}%</option>)}
          </select>
        </label>
      </div>

      {qErr && <p className="mt-3 small text-phoenix" role="alert">{qErr}</p>}
      {quote && (
        <dl className="mt-4 grid grid-cols-2 gap-y-1.5 small num" data-testid="quote">
          <dt className="text-ivory-2">You receive</dt><dd className="text-right">{side === "BUY" ? `${fmtTok(quote.amountOut)} ${ticker}` : `${fmtSol(quote.amountOut, 4)} SOL`}</dd>
          <dt className="text-ivory-2">Minimum</dt><dd className="text-right">{side === "BUY" ? `${fmtTok(quote.minOut)} ${ticker}` : `${fmtSol(quote.minOut, 4)} SOL`}</dd>
          <dt className="text-ivory-2">Fee (1%)</dt><dd className="text-right">{fmtSol(quote.fee, 4)} SOL <span className="text-ivory-3">· {fmtSol(quote.destinyFee, 4)} to vault</span></dd>
          <dt className="text-ivory-2">Price impact</dt><dd className={`text-right ${Math.abs(quote.priceImpactBps) > 500 ? "text-phoenix" : ""}`}>{bpsPct(quote.priceImpactBps)}</dd>
          <dt className="text-ivory-2">Price after</dt><dd className="text-right">{fmtPrice(quote.spotAfter)} SOL</dd>
          <dt className="text-ivory-2">Venue</dt><dd className="text-right">{quote.venue === "AMM" ? "AMM pool" : "Bonding curve"}</dd>
        </dl>
      )}

      {!w.address ? (
        <button className="btn btn-gold w-full justify-center mt-5" onClick={w.openModal}>Connect wallet to trade</button>
      ) : (
        <button className="btn btn-accent w-full justify-center mt-5" disabled={!quote || busy} onClick={submit} data-testid="submit-trade">
          {busy ? "Waiting for signature…" : side === "BUY" ? `Buy ${ticker}` : `Sell ${ticker}`}
        </button>
      )}
      {result && <p className={`mt-3 small ${result.ok ? "text-orbit" : "text-phoenix"}`} role="status" data-testid="trade-result">{result.text}</p>}
    </div>
  );
}
