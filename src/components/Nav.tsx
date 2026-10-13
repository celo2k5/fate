"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet, short } from "@/lib/wallet";
import { fmtSol } from "@/lib/format";
import { Sigil } from "./Sigil";

const links = [
  { href: "/destinies", label: "Destinies" },
  { href: "/coins", label: "Coins" },
  { href: "/leaderboards", label: "Board" },
  { href: "/launch", label: "Launch" },
];

/** Left-aligned bar: sigil + wordmark, links, wallet. Becomes a compact glass bar after the first scroll. */
export function Nav({ network = "simnet" }: { network?: string }) {
  const path = usePathname();
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(scrollY > 24);
    f(); addEventListener("scroll", f, { passive: true });
    return () => removeEventListener("scroll", f);
  }, []);
  useEffect(() => setOpen(false), [path]);
  if (path.startsWith("/admin")) return null;
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${scrolled ? "py-2" : "py-4"}`}>
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8">
        <div className={`flex items-center gap-6 rounded-full px-3 sm:px-4 transition-all duration-500 ${scrolled ? "glass h-14" : "h-16"}`}>
          <Link href="/" className="flex items-center gap-2.5 pl-1" aria-label="Fate home">
            <Sigil size={26} className="text-gold" />
            <span className="display text-[20px] tracking-tight">Fate</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 ml-2" aria-label="Primary">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={`tab ${path.startsWith(l.href) ? "text-ivory bg-ivory/10" : ""} !h-9 flex items-center`}>{l.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="chip hidden sm:inline-flex" title="Network"><i className="h-1.5 w-1.5 rounded-full bg-current" />{network}</span>
            {w.address ? (
              <Link href="/wallet" className="btn btn-sm" data-testid="wallet-chip">
                <span className="num text-dim">{fmtSol(w.portfolio?.lamports ?? 0, 2)} SOL</span><span>{short(w.address)}</span>
              </Link>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={w.openModal} data-testid="connect">Connect wallet</button>
            )}
            <button className="btn btn-sm icon-btn md:!hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
            </button>
          </div>
        </div>
        {open && (
          <nav className="md:hidden mt-2 card p-3 flex flex-col" aria-label="Mobile">
            {links.map((l) => <Link key={l.href} href={l.href} className={`tab !h-11 flex items-center ${path.startsWith(l.href) ? "text-ivory" : ""}`}>{l.label}</Link>)}
          </nav>
        )}
      </div>
    </header>
  );
}
