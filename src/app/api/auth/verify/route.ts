import { ok, fail } from "@/lib/api";
import { createSession } from "@/lib/auth";
export async function POST(req: Request) {
  try {
    const { address, message, signature, provider } = await req.json();
    return ok(await createSession(String(address), String(message), String(signature), String(provider ?? "unknown")));
  } catch (e) { return fail(e); }
}
