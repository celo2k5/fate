"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Character } from "@/components/Character";
import { CharacterScene } from "@/components/Scene";
import { DESTINIES, DESTINY_META, type DestinyType } from "@/engine/config";
import { useWallet, short } from "@/lib/wallet";

const STEPS = ["Token details", "Choose destiny", "Economics", "Review", "Launch"];

interface Form {
  name: string; ticker: string; description: string; image: string | null; website: string; x: string; telegram: string;
  destiny: DestinyType | null;
  executionThresholdSol: number; cooldownSec: number; maxSlippageBps: number; graduationThresholdSol: number;
  echoMinBalance: number; echoEpochMin: number;
  orbit: { SOL: number; USDC: number; LST: number; RESERVE: number };
}

export function LaunchFlow({ initialDestiny, bounds, onChain = false }: { initialDestiny: DestinyType | null; bounds: Record<string, { min: number; max: number }>; onChain?: boolean }) {
  const w = useWallet();
  const router = useRouter();
  const [step, setStep] = useState(initialDestiny ? 1 : 0);
  const [f, setF] = useState<Form>({
    name: "", ticker: "", description: "", image: null, website: "", x: "", telegram: "",
    destiny: initialDestiny,
    executionThresholdSol: 2, cooldownSec: 60, maxSlippageBps: 500, graduationThresholdSol: 85,
    echoMinBalance: 10_000, echoEpochMin: 2,
    orbit: { SOL: 40, USDC: 30, LST: 20, RESERVE: 10 },
  });
  const [status, setStatus] = useState<{ phase: "idle" | "signing" | "confirming" | "done" | "error"; text?: string; tokenId?: string; signature?: string }>({ phase: "idle" });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2 || f.name.trim().length > 32) e.name = "2–32 characters";
    if (!/^[A-Za-z0-9]{2,8}$/.test(f.ticker)) e.ticker = "2–8 letters or digits";
    if (f.description.length > 500) e.description = "500 characters max";
    if (f.website && !/^https?:\/\/.+\..+/.test(f.website)) e.website = "Must start with http:// or https://";
    if (f.x && !/^@?[A-Za-z0-9_]{1,15}$/.test(f.x)) e.x = "Looks wrong for an X handle";
    if (f.telegram && !/^@?[A-Za-z0-9_]{5,32}$/.test(f.telegram)) e.telegram = "Looks wrong for a Telegram handle";
    const o = f.orbit; if (o.SOL + o.USDC + o.LST + o.RESERVE !== 100) e.orbit = "Allocation must total 100%";
    return e;
  }, [f]);
  const step0ok = !errors.name && !errors.ticker && !errors.description && !errors.website && !errors.x && !errors.telegram;

  function onImage(file: File | null) {
    if (!file) return set("image", null);
    if (file.size > 400_000) return set("image", null);
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = 256; c.height = 256;
        const ctx = c.getContext("2d")!; const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
        set("image", c.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  }

  async function launch() {
    if (!f.destiny) return;
    setStatus({ phase: "signing", text: "Approve the launch in your wallet." });
    try {
      const intent = {
        kind: "launch", name: f.name.trim(), ticker: f.ticker.toUpperCase(), description: f.description.trim(), image: f.image,
        website: f.website || null, x: f.x || null, telegram: f.telegram || null, destiny: f.destiny,
        executionThresholdSol: f.executionThresholdSol, cooldownMs: f.cooldownSec * 1000, maxSlippageBps: f.maxSlippageBps, graduationThresholdSol: f.graduationThresholdSol,
        echoMinBalance: f.echoMinBalance, echoEpochMs: f.echoEpochMin * 60_000,
        orbitAllocation: { SOL: f.orbit.SOL * 100, USDC: f.orbit.USDC * 100, LST: f.orbit.LST * 100, RESERVE: f.orbit.RESERVE * 100 },
      };
      const signed = await w.signIntent(intent);
      let j: { token: { id: string }; signature: string; error?: string; explorer?: string };
      if (onChain) {
        setStatus({ phase: "confirming", text: "Building the create transaction (mint, bonding curve, vault authority)…" });
        const prep = await fetch("/api/chain/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signed) });
        const pj = await prep.json();
        if (!prep.ok) throw new Error(pj.error);
        setStatus({ phase: "signing", text: `Approve the transaction in your wallet. Mint ${pj.mint.slice(0, 8)}…` });
        const signedTx = await w.signTransaction(pj.tx);
        setStatus({ phase: "confirming", text: "Sent. Waiting for on-chain confirmation…" });
        const sub = await fetch("/api/chain/launch", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepareId: pj.prepareId, signedTx }) });
        j = await sub.json();
        if (!sub.ok) throw new Error(j.error);
      } else {
        setStatus({ phase: "confirming", text: "Creating the mint, curve and vault…" });
        const r = await fetch("/api/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signed) });
        j = await r.json();
        if (!r.ok) throw new Error(j.error);
      }
      // only show success once the token's state actually exists
      const check = await fetch(`/api/tokens/${j.token.id}`, { cache: "no-store" });
      if (!check.ok) throw new Error("launch was submitted but the token state could not be read back");
      const d = await check.json();
      if (!d.state || !d.curve || d.config.destiny !== f.destiny) throw new Error("token state is incomplete");
      setStatus({ phase: "done", tokenId: j.token.id, signature: j.signature, text: onChain ? "Launched on-chain. Mint created, bonding curve open, vault authority recorded." : "Launched. Vault initialised, destiny recorded, trading open." });
      setTimeout(() => router.push(`/coin/${j.token.id}`), 1800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ phase: "error", text: /reject|denied|cancel/i.test(msg) ? "Signature rejected in the wallet. Nothing was launched." : msg });
    }
  }

  const meta = f.destiny ? DESTINY_META[f.destiny] : null;

  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8 pt-28 pb-16" data-destiny={f.destiny ?? undefined}>
      <ol className="card-sm px-6 py-4 flex flex-wrap gap-x-6 gap-y-2 pill" aria-label="Launch steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "gold" : i < step ? "text-ivory" : "text-ivory-3"}><span className="num mr-2">{i + 1}</span>{s}</li>)}
      </ol>

      {step === 0 && (
        <section className="mt-8 grid gap-6 md:grid-cols-[1fr_16rem]">
          <div className="grid gap-4">
            <h1 className="display text-[40px] sm:text-[56px]">Name the coin</h1>
            <label className="small text-ivory-2">Name<input className="field mt-1" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={32} data-testid="name" />{f.name && errors.name && <span className="text-phoenix small">{errors.name}</span>}</label>
            <label className="small text-ivory-2">Ticker<input className="field mt-1 " value={f.ticker} onChange={(e) => set("ticker", e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} maxLength={8} data-testid="ticker" />{f.ticker && errors.ticker && <span className="text-phoenix small">{errors.ticker}</span>}</label>
            <label className="small text-ivory-2">Description<textarea className="field mt-1 min-h-24" value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={500} data-testid="description" /><span className="small text-ivory-3 num">{f.description.length}/500</span></label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="small text-ivory-2">Website<input className="field mt-1" placeholder="https://" value={f.website} onChange={(e) => set("website", e.target.value)} />{errors.website && <span className="text-phoenix small">{errors.website}</span>}</label>
              <label className="small text-ivory-2">X<input className="field mt-1" placeholder="@handle" value={f.x} onChange={(e) => set("x", e.target.value)} />{errors.x && <span className="text-phoenix small">{errors.x}</span>}</label>
              <label className="small text-ivory-2">Telegram<input className="field mt-1" placeholder="@group" value={f.telegram} onChange={(e) => set("telegram", e.target.value)} />{errors.telegram && <span className="text-phoenix small">{errors.telegram}</span>}</label>
            </div>
          </div>
          <div>
            <div className="small text-ivory-2">Image</div>
            <label className="mt-1 block aspect-square card overflow-hidden cursor-pointer bg-slate hover:border-neon">
              {f.image ? <img src={f.image} alt="" className="h-full w-full object-cover" /> : <span className="h-full w-full flex items-center justify-center small text-ivory-3 text-center p-4">Drop or choose a square image (under 400 KB)</span>}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => onImage(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="mt-8">
          <h1 className="display text-[40px] sm:text-[56px]">Choose its destiny</h1>
          <p className="mt-2 text-ivory-2">One of four. This cannot be changed after launch.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DESTINIES.map((d) => (
              <button key={d} type="button" onClick={() => set("destiny", d)} data-destiny={d} data-testid={`pick-${d}`} aria-pressed={f.destiny === d}
                className={`text-left card card-metal sweep p-4 transition-transform ${f.destiny === d ? "card-accent scale-[1.01]" : "opacity-80 hover:opacity-100"}`}>
                <CharacterScene name={d.toLowerCase()} />
                <div className="card-sm mt-4 rounded-[12px] px-5 py-4">
                  <div className="display text-[22px]" style={{ color: "var(--accent)" }}>{DESTINY_META[d].title}</div>
                  <div className="small text-ivory-2 mt-1">{DESTINY_META[d].purpose}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && meta && (
        <section className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <h1 className="display text-[40px] sm:text-[56px]">Economics</h1>
            <p className="mt-2 text-ivory-2">Everything here is bounded by the protocol. There is no custom code and no override.</p>
            <dl className="mt-6 grid grid-cols-2 gap-y-2 small num card px-4 py-3">
              <dt className="text-ivory-2">Supply</dt><dd>1,000,000,000</dd>
              <dt className="text-ivory-2">Decimals</dt><dd>6</dd>
              <dt className="text-ivory-2">On the curve</dt><dd>793.1M (206.9M reserved for the AMM)</dd>
              <dt className="text-ivory-2">Bonding curve</dt><dd>constant product, 30 SOL virtual</dd>
              <dt className="text-ivory-2">Trading fee</dt><dd>1.00%</dd>
              <dt className="text-ivory-2">Destiny allocation</dt><dd>80% of fees to the vault, 20% protocol</dd>
            </dl>
          </div>
          <div className="grid gap-4 content-start">
            <Range label="Execution threshold (SOL in vault)" value={f.executionThresholdSol} min={bounds.executionThreshold.min} max={bounds.executionThreshold.max} step={0.25} onChange={(v) => set("executionThresholdSol", v)} />
            <Range label="Cooldown between executions (seconds)" value={f.cooldownSec} min={5} max={86_400} step={5} onChange={(v) => set("cooldownSec", v)} />
            <Range label="Max slippage per execution (%)" value={f.maxSlippageBps / 100} min={0.5} max={15} step={0.5} onChange={(v) => set("maxSlippageBps", Math.round(v * 100))} />
            <Range label="Graduation threshold (real SOL on curve)" value={f.graduationThresholdSol} min={bounds.graduationThreshold.min} max={bounds.graduationThreshold.max} step={5} onChange={(v) => set("graduationThresholdSol", v)} />
            {f.destiny === "ECHO" && <>
              <Range label="Minimum balance to earn (tokens)" value={f.echoMinBalance} min={1_000} max={10_000_000} step={1_000} onChange={(v) => set("echoMinBalance", v)} />
              <Range label="Epoch length (minutes)" value={f.echoEpochMin} min={0.5} max={43_200} step={0.5} onChange={(v) => set("echoEpochMin", v)} />
            </>}
            {f.destiny === "ORBIT" && (
              <div className="card px-4 py-3">
                <div className="small text-ivory-2">Treasury allocation</div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {(["SOL", "USDC", "LST", "RESERVE"] as const).map((k) => (
                    <label key={k} className="small text-ivory-2">{k === "RESERVE" ? "Reserve" : k}<input type="number" min={0} max={100} className="field mt-1 num" value={f.orbit[k]} onChange={(e) => set("orbit", { ...f.orbit, [k]: Number(e.target.value) })} /></label>
                  ))}
                </div>
                {errors.orbit && <p className="mt-2 small text-phoenix">{errors.orbit}</p>}
              </div>
            )}
          </div>
        </section>
      )}

      {step === 3 && meta && f.destiny && (
        <section className="mt-8 grid gap-8 md:grid-cols-[auto_1fr] items-start">
          <Character destiny={f.destiny} progress={0.9} level={2} size={220} />
          <div>
            <h1 className="display text-[40px] sm:text-[56px]">Review</h1>
            <div className="mt-4 card card-accent px-5 py-4">
              <p className="display text-[28px]" style={{ color: "var(--accent)" }}>Your destiny cannot be changed after launch.</p>
              <p className="mt-1 small text-ivory-2">{f.name} will be a {meta.title} coin forever. Fees will go to its vault, and only the {meta.title} instruction can spend them.</p>
            </div>
            <dl className="mt-6 grid grid-cols-[10rem_1fr] gap-y-1.5 small">
              <dt className="text-ivory-2">Name / ticker</dt><dd>{f.name} · {f.ticker}</dd>
              <dt className="text-ivory-2">Destiny</dt><dd>{meta.title} — {meta.purpose}</dd>
              <dt className="text-ivory-2">Execution</dt><dd className="num">at {f.executionThresholdSol} SOL in vault, cooldown {f.cooldownSec}s, max slippage {f.maxSlippageBps / 100}%</dd>
              <dt className="text-ivory-2">Graduation</dt><dd className="num">at {f.graduationThresholdSol} SOL real reserves → AMM, LP locked</dd>
              {f.destiny === "ECHO" && <><dt className="text-ivory-2">Echo</dt><dd className="num">min {f.echoMinBalance.toLocaleString()} tokens, {f.echoEpochMin} min epochs</dd></>}
              {f.destiny === "ORBIT" && <><dt className="text-ivory-2">Orbit</dt><dd className="num">SOL {f.orbit.SOL}% · USDC {f.orbit.USDC}% · LST {f.orbit.LST}% · reserve {f.orbit.RESERVE}%</dd></>}
              <dt className="text-ivory-2">Creator</dt><dd>{w.address ? short(w.address) : "connect a wallet"}</dd>
            </dl>
            <h2 className="mt-6 small text-ivory-2">Authorities that remain</h2>
            <ul className="mt-1 small space-y-1">
              <li>Destiny: none. Immutable at launch.</li>
              <li>Vault: program-controlled. No withdrawal instruction exists.</li>
              <li>Mint and freeze: revoked after supply is minted.</li>
              <li>Metadata: you can edit name, description and links. Nothing economic.</li>
              <li>Protocol: fee bps and bounds are protocol-governed; they cannot alter a launched coin&apos;s destiny.</li>
            </ul>
          </div>
        </section>
      )}

      {step === 4 && meta && f.destiny && (
        <section className="mt-8 text-center max-w-xl mx-auto">
          <Character destiny={f.destiny} progress={status.phase === "done" ? 1 : 0.5} level={2} size={220} className="mx-auto" pulseKey={status.phase === "done" ? 1 : 0} />
          <h1 className="display text-[36px] mt-4">{status.phase === "done" ? "Launched" : `Launch ${f.name}`}</h1>
          {!w.address ? (
            <><p className="mt-3 text-ivory-2">Connect the wallet that will create this coin.</p><button className="btn btn-gold mt-5" onClick={w.openModal}>Connect wallet</button></>
          ) : status.phase === "idle" || status.phase === "error" ? (
            <>
              <p className="mt-3 text-ivory-2">Your wallet will be asked to approve the launch. The token, curve, vault and destiny are created in one step.</p>
              {status.phase === "error" && <p className="mt-3 small text-phoenix" role="alert" data-testid="launch-error">{status.text}</p>}
              <button className="btn btn-accent mt-5" onClick={launch} data-testid="launch">Approve and launch</button>
            </>
          ) : status.phase === "done" ? (
            <div className="mt-3 small">
              <p className="text-orbit" data-testid="launch-success">{status.text}</p>
              <p className="mt-2 text-ivory-3 break-all">Signature {status.signature}</p>
              <p className="mt-1 text-ivory-3 break-all">Mint {status.tokenId}</p>
            </div>
          ) : <p className="mt-3 text-ivory-2" role="status">{status.text}</p>}
        </section>
      )}

      {step < 4 && (
        <div className="mt-10 flex justify-between border-t border-line pt-6">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          <button className="btn btn-gold" data-testid="next"
            disabled={(step === 0 && !step0ok) || (step === 1 && !f.destiny) || (step === 2 && Boolean(errors.orbit) && f.destiny === "ORBIT")}
            onClick={() => setStep(step + 1)}>{step === 3 ? "Go to launch" : "Continue"}</button>
        </div>
      )}
    </div>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="small text-ivory-2 block">
      <div className="flex justify-between"><span>{label}</span><span className="num text-ivory">{value.toLocaleString()}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" />
      <div className="flex justify-between small text-ivory-3 num"><span>{min.toLocaleString()}</span><span>{max.toLocaleString()}</span></div>
    </label>
  );
}
