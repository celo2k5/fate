"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtPrice, fmtSol } from "@/lib/format";

/**
 * Price chart for one coin, built from its own trades (every point is a recorded trade's execution price).
 *  - Candles per interval, or "Ticks" (one point per trade) when the history is too short for time buckets.
 *  - Volume is a separate strip on the same time axis (never a second y-axis).
 *  - Destiny executions are marked on the timeline with a label, so you can see each buyback / cycle land on price.
 * Colours (validated for dark surface #140a26, CVD ΔE 14.2): up #1aa9a0 (hollow), down #e8663c (solid): shape carries direction too.
 */
export interface PricePoint { t: string | number; p: number; s: "BUY" | "SELL"; v: string | number; x: number | string }
export interface ExecMark { t: number; label: string }

const UP = "#1aa9a0", DOWN = "#e8663c";
const INTERVALS: { key: string; label: string; ms: number }[] = [
  { key: "ticks", label: "Ticks", ms: 0 }, { key: "1m", label: "1m", ms: 60_000 }, { key: "5m", label: "5m", ms: 300_000 },
  { key: "15m", label: "15m", ms: 900_000 }, { key: "1h", label: "1h", ms: 3_600_000 },
];
interface Bar { t0: number; t1: number; o: number; h: number; l: number; c: number; vol: number; n: number }

function build(points: { t: number; p: number; v: number }[], ms: number): Bar[] {
  if (!points.length) return [];
  if (!ms) return points.map((q, i) => ({ t0: i, t1: i, o: i ? points[i - 1].p : q.p, h: Math.max(q.p, i ? points[i - 1].p : q.p), l: Math.min(q.p, i ? points[i - 1].p : q.p), c: q.p, vol: q.v, n: 1 }));
  const out: Bar[] = [];
  for (const q of points) {
    const t0 = Math.floor(q.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t0 === t0) { last.h = Math.max(last.h, q.p); last.l = Math.min(last.l, q.p); last.c = q.p; last.vol += q.v; last.n++; }
    else {
      const open = last ? last.c : q.p;
      // fill empty buckets with flat bars so time stays linear
      if (last) for (let f = last.t0 + ms; f < t0 && out.length < 400; f += ms) out.push({ t0: f, t1: f + ms, o: last.c, h: last.c, l: last.c, c: last.c, vol: 0, n: 0 });
      out.push({ t0, t1: t0 + ms, o: open, h: Math.max(open, q.p), l: Math.min(open, q.p), c: q.p, vol: q.v, n: 1 });
    }
  }
  return out.slice(-160);
}

export function PriceChart({ history, marks, ticker }: { history: PricePoint[]; marks: ExecMark[]; ticker: string }) {
  const points = useMemo(() => history.map((h) => ({ t: Number(h.t), p: Number(h.p), v: Number(h.v) })).filter((q) => q.p > 0), [history]);
  const span = points.length > 1 ? points[points.length - 1].t - points[0].t : 0;
  const auto = span < 20 * 60_000 ? (span < 3 * 60_000 ? "ticks" : "1m") : span < 6 * 3_600_000 ? "5m" : span < 24 * 3_600_000 ? "15m" : "1h";
  const [iv, setIv] = useState<string | null>(null);
  const key = iv ?? auto;
  const ms = INTERVALS.find((i) => i.key === key)!.ms;
  const bars = useMemo(() => build(points, ms), [points, ms]);
  const [w, setW] = useState(0); // measured on mount: the server never renders the plot (times are local; no hydration mismatch)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    setW(Math.max(260, Math.round(box.current.clientWidth)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [points.length]);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  if (points.length < 2) return (
    <section className="card px-6 py-5" data-testid="price-chart">
      <h2 className="display text-[22px]">Price</h2>
      <p className="mt-3 small text-ivory-3">The chart appears after the first trades. Every point is a recorded trade.</p>
    </section>
  );

  const H = 260, VH = 64, padL = 8, padR = 76, padT = 14, gap = 14;
  const plotW = w - padL - padR;
  const lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
  const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
  const y = (p: number) => padT + (1 - (p - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - padT - 6);
  const step = plotW / bars.length;
  const x = (i: number) => padL + i * step + step / 2;
  const bw = Math.max(1.5, Math.min(14, step * 0.62));
  const vmax = Math.max(...bars.map((b) => b.vol), 1);
  const ticksY = 4;
  const first = bars[0].o, last = bars[bars.length - 1].c;
  const change = first ? (last - first) / first : 0;
  // execution markers: map each timestamp to the bar that contains it (ticks: the trade at or after it)
  const markAt = marks.map((m) => {
    let i = -1;
    if (!ms) { i = points.findIndex((q) => q.t >= m.t); if (i < 0) i = points.length - 1; }
    else { i = bars.findIndex((b) => m.t >= b.t0 && m.t < b.t1); if (i < 0 && m.t >= bars[bars.length - 1].t0) i = bars.length - 1; }
    return { ...m, i };
  }).filter((m) => m.i >= 0);
  const hb = hover !== null ? bars[hover] : null;
  const timeLabel = (b: Bar) => ms ? new Date(b.t0).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : `trade #${b.t0 + 1} · ${new Date(points[b.t0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

  const shortLabel = (b: Bar) => ms ? new Date(b.t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `#${b.t0 + 1}`;
  return (
    <section className="card px-4 sm:px-6 py-5 min-w-0" data-testid="price-chart">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="display text-[22px]">Price</h2>
        <span className="mono num text-ivory">{fmtPrice(last)} SOL</span>
        <span className="mono num small" style={{ color: change >= 0 ? UP : DOWN }}>{change >= 0 ? "▲" : "▼"} {(Math.abs(change) * 100).toFixed(2)}%</span>
        <div className="ml-auto flex flex-wrap items-center gap-1" role="tablist" aria-label="Chart interval">
          {INTERVALS.map((i) => (
            <button key={i.key} type="button" role="tab" aria-selected={key === i.key} onClick={() => setIv(i.key)}
              className="chip mono !h-8 !px-3" style={key === i.key ? { background: "var(--color-ivory)", color: "var(--color-obsidian)", borderColor: "var(--color-ivory)" } : { color: "rgba(242,238,255,.7)", borderColor: "rgba(242,238,255,.18)", background: "transparent" }}>{i.label}</button>
          ))}
          <button type="button" className="chip mono !h-8 !px-3" style={{ color: "rgba(242,238,255,.7)", borderColor: "rgba(242,238,255,.18)", background: "transparent" }} onClick={() => setTable((v) => !v)} aria-pressed={table}>{table ? "Chart" : "Table"}</button>
        </div>
      </div>

      {table ? (
        <div className="mt-4 max-h-[340px] overflow-auto">
          <table className="table w-full small mono num">
            <thead><tr><th className="text-left">{ms ? "Time" : "Trade"}</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead>
            <tbody>{bars.filter((b) => b.n).slice().reverse().map((b, i) => (
              <tr key={i}><td className="text-left">{timeLabel(b)}</td><td>{fmtPrice(b.o)}</td><td>{fmtPrice(b.h)}</td><td>{fmtPrice(b.l)}</td><td>{fmtPrice(b.c)}</td><td>{fmtSol(BigInt(Math.round(b.vol)), 3)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="mt-4 relative select-none w-full min-w-0 overflow-hidden" style={{ minHeight: H + gap + VH + 22 }} onMouseLeave={() => setHover(null)}>
          {w > 0 && <>
          <svg width={w} height={H + gap + VH + 22} role="img" aria-label={`${ticker} price, ${bars.length} ${ms ? "candles" : "trades"}, last ${fmtPrice(last)} SOL`}
            onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - padL) / step); setHover(i >= 0 && i < bars.length ? i : null); }}>
            {/* recessive grid + price axis on the right */}
            {Array.from({ length: ticksY + 1 }, (_, k) => { const p = lo - pad + ((hi + pad) - (lo - pad)) * (k / ticksY); const yy = y(p); return (
              <g key={k}><line x1={padL} x2={w - padR} y1={yy} y2={yy} stroke="rgba(242,238,255,.07)" />
                <text x={w - padR + 8} y={yy + 4} fontSize="11" fill="rgba(242,238,255,.55)" fontFamily="var(--font-mono)">{fmtPrice(p)}</text></g>); })}
            {/* destiny executions */}
            {markAt.map((m, k) => (
              <g key={k}>
                <line x1={x(m.i)} x2={x(m.i)} y1={padT - 4} y2={H + gap + VH} stroke="rgba(242,238,255,.45)" strokeDasharray="3 4" />
                <rect x={Math.min(x(m.i) + 4, w - padR - 128)} y={padT - 2} width={124} height={20} rx={10} fill="#140a26" stroke="rgba(242,238,255,.35)" />
                <text x={Math.min(x(m.i) + 4, w - padR - 128) + 62} y={padT + 12} textAnchor="middle" fontSize="11" fill="rgba(242,238,255,.9)">{m.label}</text>
              </g>
            ))}
            {/* candles: up hollow, down solid */}
            {bars.map((b, i) => {
              const up = b.c >= b.o, col = up ? UP : DOWN;
              const top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
              return (
                <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
                  <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1.5" />
                  <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1.5, bot - top)} rx={1.5} fill={up ? "#140a26" : col} stroke={col} strokeWidth="1.5" />
                </g>);
            })}
            {/* last price line */}
            <line x1={padL} x2={w - padR} y1={y(last)} y2={y(last)} stroke={change >= 0 ? UP : DOWN} strokeDasharray="2 3" opacity=".7" />
            <rect x={w - padR + 2} y={y(last) - 10} width={padR - 4} height={20} rx={4} fill={change >= 0 ? UP : DOWN} />
            <text x={w - padR + 8} y={y(last) + 4} fontSize="11" fill="#0b0516" fontFamily="var(--font-mono)">{fmtPrice(last)}</text>
            {/* volume strip, same time axis */}
            {bars.map((b, i) => { const hgt = (b.vol / vmax) * VH; return b.vol ? (
              <rect key={i} x={x(i) - bw / 2} y={H + gap + VH - hgt} width={bw} height={Math.max(1, hgt)} rx={1.5} fill={b.c >= b.o ? UP : DOWN} opacity={hover === null || hover === i ? .55 : .3} />) : null; })}
            <text x={w - padR + 8} y={H + gap + 12} fontSize="11" fill="rgba(242,238,255,.55)">Volume</text>
            {/* crosshair */}
            {hb && <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={H + gap + VH} stroke="rgba(242,238,255,.35)" />}
            {/* time labels */}
            <text x={padL} y={H + gap + VH + 16} fontSize="11" fill="rgba(242,238,255,.55)">{w < 520 ? shortLabel(bars[0]) : timeLabel(bars[0])}</text>
            <text x={w - padR} y={H + gap + VH + 16} fontSize="11" textAnchor="end" fill="rgba(242,238,255,.55)">{w < 520 ? shortLabel(bars[bars.length - 1]) : timeLabel(bars[bars.length - 1])}</text>
          </svg>
          {hb && (
            <div className="absolute pointer-events-none card px-3 py-2 small mono num" style={{ left: Math.min(Math.max(0, x(hover!) + 12), w - 220), top: 8, width: 210, background: "#140a26" }}>
              <div className="text-ivory-2">{timeLabel(hb)}</div>
              {ms ? <>
                <div>O {fmtPrice(hb.o)} · C {fmtPrice(hb.c)}</div>
                <div>H {fmtPrice(hb.h)} · L {fmtPrice(hb.l)}</div>
              </> : <div>Price {fmtPrice(hb.c)} SOL</div>}
              <div className="text-ivory-2">{hb.c >= hb.o ? "▲" : "▼"} vol {fmtSol(BigInt(Math.round(hb.vol)), 3)} SOL{hb.n > 1 ? ` · ${hb.n} trades` : ""}</div>
            </div>
          )}
          </>}
        </div>
      )}
      <p className="mt-2 small text-ivory-3">Every point is a recorded trade on this coin{!ms ? " (shown per trade: not enough history yet for time candles)" : ""}. Dashed lines mark destiny executions.</p>
    </section>
  );
}
