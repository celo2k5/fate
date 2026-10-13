import { ok, fail } from "@/lib/api";
import { activeChain, hasChainSecrets } from "@/chain/config";
export const dynamic = "force-dynamic";
/** Public: which chain this deployment is on and whether the on-chain path is configured (no secrets are returned). */
export async function GET() {
  try {
    const chain = activeChain();
    if (chain === "simnet") return ok({ chain, onChain: false, rpc: null });
    const { chainHealth } = await import("@/chain/agents");
    const h = await chainHealth();
    return ok({ chain, onChain: true, rpc: h.ok ? { slot: h.slot, blockHeight: h.blockHeight } : { error: h.error }, configured: hasChainSecrets() });
  } catch (e) { return fail(e); }
}
