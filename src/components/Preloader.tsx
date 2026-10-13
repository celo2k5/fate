"use client";
import { useEffect, useState } from "react";
import { Sigil } from "./Sigil";

/** First-visit loading moment: the sigil draws itself, then the curtain lifts. Shown once per session. */
export function Preloader() {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("fate.loaded") === "1"; } catch { /* ignore */ }
    if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShow(true);
    const ready = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1400))]);
    ready.then(() => setTimeout(() => { setDone(true); try { sessionStorage.setItem("fate.loaded", "1"); } catch { /* ignore */ } setTimeout(() => setShow(false), 700); }, 900));
  }, []);
  if (!show) return null;
  return (
    <div aria-hidden="true" className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-obsidian transition-opacity duration-700" style={{ opacity: done ? 0 : 1, pointerEvents: done ? "none" : "auto" }}>
      <Sigil size={72} className="text-mint" draw />
      <div className="mt-6 overflow-hidden">
        <p className="voice text-[28px] rise rise-2">Every coin has a destiny.</p>
      </div>
    </div>
  );
}
