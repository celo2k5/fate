"use client";
import { useWallet } from "@/lib/wallet";

export function WalletModal() {
  const w = useWallet();
  if (!w.modalOpen) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-obsidian/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={w.closeModal}>
      <div className="w-full max-w-md card p-7 reveal-scale in" onClick={(e) => e.stopPropagation()}>
        <h2 id="wallet-title" className="display-md text-[28px]">Connect a wallet</h2>
        <p className="mt-2 text-dim">You sign a short message to prove you own the wallet. Nothing is sent and no fee is paid.</p>
        <div className="mt-6 grid gap-3">
          <button className="btn !h-14 justify-between" disabled={!w.hasPhantom || w.busy} onClick={() => w.connect("phantom").catch(() => {})} data-testid="connect-phantom">
            <span>Phantom</span><span className="label">{w.hasPhantom ? "detected" : "not installed"}</span>
          </button>
          <button className="btn !h-14 justify-between" disabled={w.busy} onClick={() => w.connect("fate-local").catch(() => {})} data-testid="connect-local">
            <span>Fate simnet wallet</span><span className="label">keypair in this browser</span>
          </button>
        </div>
        {w.error && <p className="mt-4 text-sm text-phoenix" role="alert">{w.error}</p>}
        <p className="mt-6 label">simnet is a server-side ledger that mirrors the on-chain program. Use the faucet on your wallet page to get test SOL.</p>
      </div>
    </div>
  );
}
