"use client";
import { useState } from "react";
import { Logo } from "@/components/Logo";

export function LoginForm() {
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    if (r.ok) location.href = "/admin"; else { setErr("That key isn't right."); setBusy(false); }
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm rise">
        <div className="flex items-center gap-2"><Logo size={26} /><span className="chip">Admin</span></div>
        <h1 className="display-md text-[26px] mt-6">Sign in</h1>
        <p className="text-sm text-dim mt-1">Enter the admin key from <span className="mono">FATE_ADMIN_KEY</span>.</p>
        <input type="password" className="field mt-5" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Admin key" autoFocus data-testid="admin-key" />
        {err && <p className="text-sm text-phoenix mt-2" role="alert">{err}</p>}
        <button className="btn btn-primary w-full mt-4" disabled={busy || !key} data-testid="admin-login">Enter console</button>
      </form>
    </div>
  );
}
