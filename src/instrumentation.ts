export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startKeeper, getProtocol } = await import("@/engine/keeper");
    // Demo convenience for hosts whose disk resets on every deploy (Render free): with FATE_AUTOSEED=1, a SIMNET ledger
    // that starts empty is seeded with the demo coins. Never runs on devnet/mainnet, never touches a non-empty ledger.
    if (process.env.FATE_AUTOSEED === "1" && (process.env.FATE_CHAIN ?? "simnet") === "simnet") {
      try {
        const p = getProtocol();
        const n = Number((p.db.prepare("SELECT COUNT(*) c FROM tokens").get() as { c: bigint }).c);
        if (n === 0) {
          const { seedDemo } = await import("@/engine/seed");
          seedDemo(p);
          console.log(JSON.stringify({ level: "info", event: "autoseed", tokens: Number((p.db.prepare("SELECT COUNT(*) c FROM tokens").get() as { c: bigint }).c) }));
        }
      } catch (e) {
        console.error(JSON.stringify({ level: "error", event: "autoseed.failed", error: e instanceof Error ? e.message : String(e) }));
      }
    }
    startKeeper();
  }
}
