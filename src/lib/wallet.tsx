"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import nacl from "tweetnacl";
import bs58 from "bs58";

export type Provider = "phantom" | "fate-local";

export interface Portfolio { lamports: string; holdings: { token_id: string; amount: string; name: string; ticker: string; destiny: string }[] }

interface WalletCtx {
  address: string | null;
  provider: Provider | null;
  portfolio: Portfolio | null;
  busy: boolean;
  error: string | null;
  hasPhantom: boolean;
  connect: (p: Provider) => Promise<void>;
  disconnect: () => Promise<void>;
  signIntent: (intent: Record<string, unknown>) => Promise<{ message: string; signature: string }>;
  refresh: () => Promise<void>;
  faucet: () => Promise<void>;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);
const LOCAL_KEY = "fate.localWallet";

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signMessage(msg: Uint8Array, enc: "utf8"): Promise<{ signature: Uint8Array }>;
};
const phantom = (): PhantomProvider | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const p = w.phantom?.solana ?? w.solana;
  return p?.isPhantom ? p : null;
};

function localKeypair(): nacl.SignKeyPair {
  let secret: Uint8Array | null = null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) secret = bs58.decode(raw);
  } catch { /* storage unavailable */ }
  if (!secret) {
    const kp = nacl.sign.keyPair();
    try { localStorage.setItem(LOCAL_KEY, bs58.encode(kp.secretKey)); } catch { /* ignore */ }
    return kp;
  }
  return nacl.sign.keyPair.fromSecretKey(secret);
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "request failed");
  return j as T;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPhantom, setHasPhantom] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/auth/me", { cache: "no-store" });
    const j = await r.json();
    if (j.session) { setAddress(j.session.address); setProvider(j.session.provider); setPortfolio(j.portfolio); }
    else { setAddress(null); setProvider(null); setPortfolio(null); }
  }, []);

  useEffect(() => { refresh().catch(() => {}); setHasPhantom(Boolean(phantom())); }, [refresh]);

  const sign = useCallback(async (p: Provider, addr: string, message: string) => {
    const bytes = new TextEncoder().encode(message);
    if (p === "phantom") {
      const ph = phantom();
      if (!ph) throw new Error("Phantom not found");
      const { signature } = await ph.signMessage(bytes, "utf8");
      return bs58.encode(signature);
    }
    const kp = localKeypair();
    if (bs58.encode(kp.publicKey) !== addr) throw new Error("local wallet changed");
    return bs58.encode(nacl.sign.detached(bytes, kp.secretKey));
  }, []);

  const connect = useCallback(async (p: Provider) => {
    setBusy(true); setError(null);
    try {
      let addr: string;
      if (p === "phantom") {
        const ph = phantom();
        if (!ph) throw new Error("Phantom is not installed in this browser");
        const r = await ph.connect();
        addr = r.publicKey.toBase58();
      } else {
        addr = bs58.encode(localKeypair().publicKey);
      }
      const { message } = await post<{ message: string }>("/api/auth/nonce", { address: addr });
      const signature = await sign(p, addr, message);
      await post("/api/auth/verify", { address: addr, message, signature, provider: p });
      await refresh();
      setModalOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally { setBusy(false); }
  }, [refresh, sign]);

  const disconnect = useCallback(async () => {
    await post("/api/auth/logout", {});
    if (provider === "phantom") { try { await phantom()?.disconnect(); } catch { /* ignore */ } }
    await refresh();
  }, [provider, refresh]);

  const signIntent = useCallback(async (intent: Record<string, unknown>) => {
    if (!address || !provider) throw new Error("connect a wallet first");
    const message = JSON.stringify({ ...intent, address, issuedAt: Date.now() });
    const signature = await sign(provider, address, message);
    return { message, signature };
  }, [address, provider, sign]);

  const faucet = useCallback(async () => {
    setBusy(true);
    try { await post("/api/faucet", {}); await refresh(); } finally { setBusy(false); }
  }, [refresh]);

  const value = useMemo<WalletCtx>(() => ({
    address, provider, portfolio, busy, error, hasPhantom, connect, disconnect, signIntent, refresh, faucet,
    modalOpen, openModal: () => setModalOpen(true), closeModal: () => setModalOpen(false),
  }), [address, provider, portfolio, busy, error, hasPhantom, connect, disconnect, signIntent, refresh, faucet, modalOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}

export const short = (a: string | null | undefined) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
