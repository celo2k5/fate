"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet, short } from "@/lib/wallet";
import { fmtSol } from "@/lib/format";
import { Logo } from "./Logo";

const links = [
    { href: "/destinies", label: "Destinies" },
  { href: "/launch", label: "Launch" },
  { href: "/coins", label: "Coins" },
  { href: "/leaderboards", label: "Board" },
];

/** Floating glass pill with the sigil inside it; wallet cluster on the right. Shrinks after the first scroll. */
export function Nav({ network = "simnet" }: { network?: string }) {
  const path = usePathname();
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const f = () => setScrolled(scrollY > 24); f(); addEventListener("scroll", f, { passive: true }); return () => removeEventListener("scroll", f); }, []);
  useEffect(() => setOpen(false), [path]);
  if (path.startsWith("/admin")) return null;
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <header className="fixed inset-x-0 top-0 z-50 pointer-events-none">
      <div className={`mx-auto max-w-[1440px] px-4 sm:px-6 transition-all duration-500 ${scrolled ? "pt-2" : "pt-4"}`}>
        <div className="relative flex items-start">
          <Link href="/" className="pointer-events-auto absolute left-0 top-0 flex items-center h-12 pl-1" aria-label="Fate home"><Logo size={30} /></Link>
          <nav className={`glass pointer-events-auto rounded-full mx-auto hidden md:flex items-center gap-1 transition-all duration-500 ${scrolled ? "px-2 py-1.5" : "px-3 py-2.5"}`} aria-label="Primary">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={`tab !h-10 flex items-center ${active(l.href) ? "text-mint" : "text-ivory"}`}>{l.label}</Link>
            ))}
          </nav>
          <div className="pointer-events-auto absolute right-0 top-0 flex items-center gap-2">
            <span className="btn btn-sm btn-glass !hidden sm:!inline-flex !cursor-default"><span className="text-mint">Net</span><span className="text-ivory/70">{network}</span></span>
            {w.address ? (
              <Link href="/wallet" className="btn btn-sm btn-glass" data-testid="wallet-chip"><span className="num text-ivory/70">{fmtSol(w.portfolio?.lamports ?? 0, 2)} SOL</span><span>{short(w.address)}</span></Link>
            ) : (
              <button className="btn btn-sm btn-glass" onClick={w.openModal} data-testid="connect">Connect</button>
            )}
            <button className="btn btn-sm btn-glass icon-btn md:!hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
            </button>
          </div>
        </div>
        {open && (
          <nav className="pointer-events-auto md:hidden mt-2 card p-3 flex flex-col" aria-label="Mobile">
            {links.map((l) => <Link key={l.href} href={l.href} className={`tab !h-11 flex items-center ${active(l.href) ? "text-mint" : ""}`}>{l.label}</Link>)}
          </nav>
        )}
      </div>
    </header>
  );
}
