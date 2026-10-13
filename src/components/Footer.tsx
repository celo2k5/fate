"use client";
import { usePathname } from "next/navigation";
import { Logo, Mark } from "./Logo";

export function Footer({ network }: { network: string }) {
  const path = usePathname();
  if (path.startsWith("/admin")) return null;
  return (
    <footer className="hairline mt-24">
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8 py-12 grid gap-8 sm:grid-cols-[1.2fr_1fr_1fr] text-sm text-dim">
        <div>
          <div className="text-ivory"><Logo size={24} /></div>
          <p className="mt-3 max-w-xs">Every coin has a destiny. Chosen once, enforced by the protocol, funded by trading fees.</p>
        </div>
        <p>This build runs on <span className="text-mint">{network}</span>: a server-side ledger that mirrors the on-chain program. No real funds move.</p>
        <p>Not audited. Nothing here is financial advice. Buybacks, liquidity, rewards and treasuries do not guarantee price.</p>
      </div>
    </footer>
  );
}
