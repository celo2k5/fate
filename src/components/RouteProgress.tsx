"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Thin gold progress bar on client navigations: starts on internal link click, completes when the pathname changes. */
export function RouteProgress() {
  const path = usePathname();
  const [w, setW] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const start = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      setOn(true); setW(12);
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => setW((x) => Math.min(88, x + (90 - x) * 0.12)), 120);
    };
    document.addEventListener("click", start, true);
    return () => document.removeEventListener("click", start, true);
  }, []);
  useEffect(() => {
    if (!on) return;
    if (timer.current) clearInterval(timer.current);
    setW(100);
    const t = setTimeout(() => { setOn(false); setW(0); }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return <div className="route-bar" style={{ width: `${w}%`, opacity: on ? 1 : 0 }} aria-hidden="true" />;
}
