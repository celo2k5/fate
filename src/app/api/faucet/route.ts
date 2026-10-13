import { rateLimit } from "@/lib/ratelimit";
import { ok, fail } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";
import { EngineError } from "@/engine/units";
export async function POST(req: Request) {
  try {
    rateLimit("faucet", req);
    const s = await requireSession();
    if ((process.env.FATE_CHAIN ?? "simnet") !== "simnet") throw new EngineError("SIMNET_ONLY", "the faucet only exists on the simnet ledger");
    return ok(getProtocol().faucet(s.address));
  } catch (e) { return fail(e); }
}
