import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { requireSession, verifyIntent } from "@/lib/auth";
import { getProtocol } from "@/engine/keeper";
import { sol } from "@/engine/units";

const schema = z.object({
  kind: z.literal("launch"), address: z.string(), issuedAt: z.number(),
  name: z.string().trim().min(2).max(32),
  ticker: z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/, "2–8 letters or digits"),
  description: z.string().trim().max(500).default(""),
  image: z.string().max(200_000).nullable().optional(),
  website: z.string().url().max(200).nullable().optional().or(z.literal("")),
  x: z.string().max(80).nullable().optional(),
  telegram: z.string().max(80).nullable().optional(),
  destiny: z.enum(["PHOENIX", "GRAVITY", "ECHO", "ORBIT"]),
  executionThresholdSol: z.number().min(0.25).max(50).optional(),
  cooldownMs: z.number().int().min(5_000).optional(),
  maxSlippageBps: z.number().int().min(50).max(1500).optional(),
  graduationThresholdSol: z.number().min(5).max(300).optional(),
  echoMinBalance: z.number().int().min(1_000).max(10_000_000).optional(),
  echoEpochMs: z.number().int().min(10_000).optional(),
  orbitAllocation: z.object({ SOL: z.number().int(), USDC: z.number().int(), LST: z.number().int(), RESERVE: z.number().int() }).optional(),
});

export async function POST(req: Request) {
  try {
    const s = await requireSession();
    const { intent, signature, message } = verifyIntent<z.infer<typeof schema>>(await req.json(), "launch", s.address);
    const v = schema.parse(intent);
    const token = getProtocol().launch({
      name: v.name, ticker: v.ticker, description: v.description, image: v.image ?? null,
      website: v.website || null, x: v.x || null, telegram: v.telegram || null,
      destiny: v.destiny, creator: s.address,
      executionThreshold: v.executionThresholdSol !== undefined ? sol(v.executionThresholdSol) : undefined,
      cooldownMs: v.cooldownMs, maxSlippageBps: v.maxSlippageBps,
      graduationThreshold: v.graduationThresholdSol !== undefined ? sol(v.graduationThresholdSol) : undefined,
      params: {
        minBalance: v.echoMinBalance !== undefined ? BigInt(v.echoMinBalance) * 1_000_000n : undefined,
        epochMs: v.echoEpochMs, allocationBps: v.orbitAllocation,
      },
      signature, signedMessage: message,
    });
    return ok({ token, signature });
  } catch (e) {
    if (e instanceof z.ZodError) return ok({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
    return fail(e);
  }
}
