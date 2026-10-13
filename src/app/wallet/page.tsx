"use client";
import Link from "next/link";
import { useWallet, short } from "@/lib/wallet";
import { fmtSol, fmtTok, destinyWord } from "@/lib/format";

export default function WalletPage() {
  const w = useWallet();
  if (!w.address) return (
    <div className="mx-auto max-w-3xl px-5 pt-32 pb-16 text-center">
      <h1 className="display text-[44px]">Your <span className="display-light">wallet</span></h1>
      <p className="lede mt-3">Connect a wallet to see balances, holdings and claimable rewards.</p>
      <button className="btn btn-gold mt-6" onClick={w.openModal}>Connect wallet</button>
    </div>
  );
  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 pt-28 pb-16">
      <h1 className="display text-[44px]">Your <span className="display-light">wallet</span></h1>
      <div className="mt-6 card p-6 grid gap-4 sm:grid-cols-[1fr_auto] items-center">
        <div>
          <div className="small text-ivory-3">{w.provider === "phantom" ? "Phantom" : "Fate simnet wallet"}</div>
          <div className="small break-all " data-testid="address">{w.address}</div>
          <div className="mt-2 display text-[36px] num" data-testid="balance">{fmtSol(w.portfolio?.lamports ?? 0, 4)} <span className="text-ivory-3 text-[20px]">SOL</span></div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-gold" disabled={w.busy} onClick={w.faucet} data-testid="faucet">Get 25 test SOL</button>
          <button className="btn" onClick={w.disconnect}>Disconnect</button>
        </div>
      </div>
      <p className="mt-3 small text-ivory-3">simnet SOL has no value. The faucet mirrors a devnet airdrop. Connected as {short(w.address)}.</p>
      <h2 className="display text-[32px] mt-12">Holdings</h2>
      {!w.portfolio?.holdings.length ? <p className="mt-2 small text-ivory-2">No coins yet. <Link className="link" href="/coins">Find one</Link> or <Link className="link" href="/launch">launch your own</Link>.</p> : (
        <ul className="mt-4 card px-5 divide-y divide-line">
          {w.portfolio.holdings.map((h) => (
            <li key={h.token_id} data-destiny={h.destiny} className="py-3 flex items-center gap-4 small">
              <Link href={`/coin/${h.token_id}`} className="link">{h.name} <span className="text-ivory-3">{h.ticker}</span></Link>
              <span className="small" style={{ color: "var(--accent)" }}>{destinyWord[h.destiny]}</span>
              <span className="ml-auto num">{fmtTok(h.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
