/**
 * Seeds a demo ledger: four coins (one per destiny), a handful of traders,
 * fee volume, and a first execution for each. Run: npm run seed
 */
import { openDatabase } from "../src/db";
import { Protocol } from "../src/engine/protocol";
import { newAddress } from "../src/engine/ids";
import { sol, tokens } from "../src/engine/units";
import type { DestinyType } from "../src/engine/config";

const p = new Protocol(openDatabase());
let n = 0; const sig = () => `seed_${Date.now()}_${n++}`;
const names: Record<DestinyType, [string, string]> = { PHOENIX: ["Ember Finch", "EMBER"], GRAVITY: ["Cobalt Mass", "MASS"], ECHO: ["Lavender Choir", "CHOIR"], ORBIT: ["Verdant Core", "CORE"] };
const traders = Array.from({ length: 6 }, () => { const a = newAddress(); p.faucet(a, sol(200)); return a; });

for (const destiny of ["PHOENIX", "GRAVITY", "ECHO", "ORBIT"] as DestinyType[]) {
  const creator = newAddress(); p.faucet(creator, sol(50));
  const t = p.launch({ name: names[destiny][0], ticker: names[destiny][1], description: `A seeded ${destiny.toLowerCase()} coin for the demo ledger.`, destiny, creator,
    executionThreshold: sol(0.25), cooldownMs: 30_000, graduationThreshold: sol(60), params: { minBalance: tokens(1_000), epochMs: 60_000 }, signature: sig(), signedMessage: "seed" });
  for (let i = 0; i < 12; i++) {
    const who = traders[i % traders.length];
    const q = p.quote(t.id, "BUY", sol(3), 300);
    const b = p.buy({ tokenId: t.id, trader: who, amountIn: sol(3), minOut: q.minOut, signature: sig() });
    if (destiny !== "ECHO" && i % 2) {
      const qs = p.quote(t.id, "SELL", (b.token_amount as bigint) / 2n, 300);
      p.sell({ tokenId: t.id, trader: who, amountIn: (b.token_amount as bigint) / 2n, minOut: qs.minOut, signature: sig() });
    }
  }
  if (destiny === "ECHO") p.db.prepare("UPDATE tokens SET created_at = created_at - 120000 WHERE id=?").run(t.id);
  const r = p.crank(t.id);
  console.log(destiny, t.id, "vault", p.vaultBalance(t.id).toString(), "crank", r);
}
console.log("seeded");
