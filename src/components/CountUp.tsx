"use client";
import { useEffect, useRef, useState } from "react";

/** Counts a number up when it scrolls into view. Formats via `format` so bigint-derived values display exactly at the end. */
export function CountUp({ value, suffix = "", decimals = 0, duration = 1200, className = "" }: { value: number; suffix?: string; decimals?: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(value); return; }
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => { const p = Math.min(1, (t - t0) / duration); const e = 1 - Math.pow(1 - p, 3); setN(value * e); if (p < 1) requestAnimationFrame(step); else setN(value); };
      requestAnimationFrame(step);
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);
  return <span ref={ref} className={`num ${className}`}>{decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString()}{suffix}</span>;
}
