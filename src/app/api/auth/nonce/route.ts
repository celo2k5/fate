import { rateLimit } from "@/lib/ratelimit";
import { ok, fail } from "@/lib/api";
import { issueNonce } from "@/lib/auth";
export async function POST(req: Request) {
  try {
    rateLimit("nonce", req);
    const { address } = await req.json();
    return ok(issueNonce(String(address)));
  } catch (e) { return fail(e); }
}
