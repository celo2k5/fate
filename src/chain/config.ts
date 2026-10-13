import { Keypair, PublicKey } from "@solana/web3.js";
import { createHmac } from "node:crypto";
import bs58 from "bs58";
import { getSettings } from "@/lib/settings";

/**
 * Chain configuration. The active chain is chosen by FATE_CHAIN (simnet | devnet | mainnet); the admin console's
 * settings supply the RPC endpoint, treasury and keeper wallet. Secrets come ONLY from the environment:
 *   FATE_KEEPER_SECRET      base58 or JSON secret key of the keeper wallet (pays fees, signs keeper-side txs)
 *   FATE_VAULT_MASTER_SEED  32+ byte secret; every coin's vault authority is derived from it (HMAC-SHA512 per mint)
 * Nothing here is ever sent to the client.
 */
export type Cluster = "devnet" | "mainnet-beta" | "localnet";

export function activeChain(): "simnet" | "devnet" | "mainnet" {
  const v = (process.env.FATE_CHAIN ?? "simnet").toLowerCase();
  return v === "devnet" || v === "mainnet" ? v : "simnet";
}

export function chainLabel(): "SIMNET" | "DEVNET" | "MAINNET" {
  return activeChain().toUpperCase() as "SIMNET" | "DEVNET" | "MAINNET";
}

export function cluster(): Cluster {
  return activeChain() === "mainnet" ? "mainnet-beta" : "devnet";
}

export function rpcUrl(): string {
  const s = getSettings();
  if (process.env.FATE_RPC_URL) return process.env.FATE_RPC_URL;
  if (s.rpcUrl) return s.rpcUrl;
  return activeChain() === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}

export function protocolTreasury(): PublicKey | null {
  const s = getSettings();
  return s.protocolTreasury ? new PublicKey(s.protocolTreasury) : null;
}

function keypairFromSecret(raw: string): Keypair {
  const t = raw.trim();
  if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t) as number[]));
  return Keypair.fromSecretKey(bs58.decode(t));
}

/** The keeper wallet: pays transaction fees for keeper-side work. Never holds user funds. */
export function keeperKeypair(): Keypair | null {
  const raw = process.env.FATE_KEEPER_SECRET;
  if (!raw) return null;
  try { return keypairFromSecret(raw); } catch { return null; }
}

/**
 * Per-coin vault authority. On pump.fun the only cut a launchpad can take is the coin's *creator fee*, which accrues
 * to `creator_vault(creator)`. FATE sets `creator` to a key derived for that mint, so every coin's fees are isolated
 * on-chain and the destiny agent can spend them. This key is CUSTODIAL (held by the server) — see README "Trust model":
 * it is server-side policy enforcement, not an on-chain program. Derivation is deterministic, so a restored server
 * recovers every vault from the master seed; the seed never leaves the environment.
 */
export function vaultAuthority(mint: string): Keypair {
  const master = process.env.FATE_VAULT_MASTER_SEED;
  if (!master || master.length < 32) throw new Error("FATE_VAULT_MASTER_SEED (≥ 32 chars) is required for on-chain vaults");
  const seed = createHmac("sha512", master).update(`fate-vault:v1:${mint}`).digest().subarray(0, 32);
  return Keypair.fromSeed(seed);
}

export function hasChainSecrets(): { keeper: boolean; vaultSeed: boolean } {
  return { keeper: Boolean(keeperKeypair()), vaultSeed: Boolean(process.env.FATE_VAULT_MASTER_SEED && process.env.FATE_VAULT_MASTER_SEED.length >= 32) };
}

/**
 * Mainnet circuit breaker. Real-money operation needs ALL of these, checked on every launch and every agent spend:
 *   FATE_MAINNET_ENABLED=1      explicit operator opt-in (default off: nothing on mainnet moves without it)
 *   FATE_DB_PERSISTENT=1        the operator attests the ledger lives on durable storage (Render disk / backed-up volume);
 *                               an ephemeral ledger loses Echo allocations and the transaction audit trail on every deploy
 *   IPFS pinning configured     coin metadata URIs are immutable on-chain, so they must not point at this server's ledger
 * Returns the reasons it is NOT ready (empty = ready). Devnet is never gated beyond the vault seed.
 */
export function mainnetBlockers(): string[] {
  if (activeChain() !== "mainnet") return [];
  const out: string[] = [];
  if (process.env.FATE_MAINNET_ENABLED !== "1") out.push("FATE_MAINNET_ENABLED is not 1");
  if (process.env.FATE_DB_PERSISTENT !== "1") out.push("FATE_DB_PERSISTENT is not 1 (ledger must be on durable storage)");
  const st = getSettings();
  if (!(/pinata\.cloud/.test(st.metadataGateway) && st.metadataApiKey)) out.push("IPFS pinning (Pinata) is not configured in the admin console");
  if (!hasChainSecrets().vaultSeed) out.push("FATE_VAULT_MASTER_SEED is not configured");
  return out;
}
