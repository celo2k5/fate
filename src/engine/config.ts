import { sol, tokens } from "./units";

export type DestinyType = "PHOENIX" | "GRAVITY" | "ECHO" | "ORBIT";
export const DESTINIES: DestinyType[] = ["PHOENIX", "GRAVITY", "ECHO", "ORBIT"];

/**
 * Protocol-governed parameters. These are the only knobs that exist, and every
 * creator-chosen value is clamped into the bounds below at launch. There is no
 * per-token admin authority: once launched, a token's DestinyConfig is immutable.
 */
export const PROTOCOL = {
  network: process.env.FATE_NETWORK ?? "simnet",
  totalSupply: tokens(1_000_000_000),          // 1B tokens, 6 dp
  curveTokens: tokens(793_100_000),            // sold on the curve
  reservedTokens: tokens(206_900_000),         // migrated to the AMM at graduation
  initialVirtualSol: sol(30),
  initialVirtualTokens: tokens(1_073_000_000),
  tradeFeeBps: Number(process.env.FATE_TRADE_FEE_BPS ?? 100),       // 1.00 %
  destinyShareBps: Number(process.env.FATE_DESTINY_SHARE_BPS ?? 8000), // 80 % of fee -> destiny vault
  protocolTreasury: "FATEprotoco1Treasury11111111111111111111111",
  burnAddress: "FATEburn111111111111111111111111111111111111",
  bounds: {
    graduationThreshold: { min: sol(5), max: sol(300), default: sol(85) },
    executionThreshold: { min: sol(0.25), max: sol(50), default: sol(2) },
    cooldownMs: { min: 5_000, max: 7 * 24 * 3_600_000, default: 60_000 },
    maxSlippageBps: { min: 50, max: 1_500, default: 500 },
    slippageBps: { min: 10, max: 2_000, default: 100 },
  },
  phoenix: {
    maxBuybackShareBps: 10_000, // uses up to the full vault per execution
  },
  gravity: {
    // half the vault buys tokens; the other half pairs with them as locked liquidity
    pairingShareBps: 5_000,
  },
  echo: {
    minBalance: { min: tokens(1_000), max: tokens(10_000_000), default: tokens(10_000) },
    epochMs: { min: 10_000, max: 30 * 24 * 3_600_000, default: 120_000 },
  },
  orbit: {
    // illustrative development defaults, bounded
    allocationBps: { SOL: 4000, USDC: 3000, LST: 2000, RESERVE: 1000 },
    approvedAssets: ["SOL", "USDC", "LST", "RESERVE"] as const,
  },
  faucet: sol(25),
  graduation: {
    migrationFeeBps: 150, // 1.5 % of migrated SOL to protocol treasury (covers pool creation)
  },
} as const;

export type OrbitAsset = (typeof PROTOCOL.orbit.approvedAssets)[number];

export interface DestinyParams {
  // PHOENIX
  buybackShareBps?: number;
  // ECHO
  minBalance?: bigint;
  epochMs?: number;
  // ORBIT
  allocationBps?: Record<OrbitAsset, number>;
}

/** Present when the coin exists on-chain (devnet / mainnet): the ledger mirrors the chain instead of simulating it. */
export interface ChainLaunch {
  chain: "DEVNET" | "MAINNET";
  mint: string;                 // the token id
  bondingCurve: string;
  vaultAuthority: string;       // per-coin creator / vault authority (custodial, derived)
  metadataUri: string;
  totalSupply: bigint;
  virtualSol: bigint; virtualTokens: bigint; realTokens: bigint;
}

export interface LaunchInput {
  chain?: ChainLaunch;
  name: string;
  ticker: string;
  description: string;
  image?: string | null;
  website?: string | null;
  x?: string | null;
  telegram?: string | null;
  destiny: DestinyType;
  creator: string;
  executionThreshold?: bigint;
  cooldownMs?: number;
  maxSlippageBps?: number;
  graduationThreshold?: bigint;
  params?: DestinyParams;
  signature: string;
  signedMessage: string;
}

export const clamp = <T extends bigint | number>(v: T, min: T, max: T): T => (v < min ? min : v > max ? max : v);

export const DESTINY_META: Record<DestinyType, {
  title: string; tagline: string; purpose: string; mechanism: string; conditions: string; actions: string; risks: string;
  accent: string; accent2: string;
}> = {
  PHOENIX: {
    title: "Phoenix", tagline: "The coin that rises from its own ashes.",
    purpose: "Buy back and burn. Trading fees are converted into permanently removed supply.",
    mechanism: "80% of every trade fee lands in the Phoenix vault. Nothing leaves it except through a buyback.",
    conditions: "Vault reaches the execution threshold and the cooldown has elapsed.",
    actions: "The protocol buys on the active venue inside the slippage bound and burns everything it bought.",
    risks: "Burns reduce supply, not guarantee price. A thin market can make a buyback expensive.",
    accent: "#FF5A1F", accent2: "#C8102E",
  },
  GRAVITY: {
    title: "Gravity", tagline: "The coin that builds its own foundation.",
    purpose: "Permanent liquidity. Fees become a locked pool position the creator can never withdraw.",
    mechanism: "Half the vault buys tokens, the other half pairs with them. The position is protocol-custodied and non-withdrawable.",
    conditions: "Vault reaches the execution threshold and the cooldown has elapsed.",
    actions: "Pre-graduation the position sits in escrow and migrates with the pool; after, it is added directly to the AMM.",
    risks: "Deep liquidity dampens moves both ways. Locked means locked — there is no exit for that capital.",
    accent: "#2D5BFF", accent2: "#B8C2D6",
  },
  ECHO: {
    title: "Echo", tagline: "The coin that gives back.",
    purpose: "Holder rewards. Fees are returned to wallets that hold through an epoch.",
    mechanism: "When an epoch settles, the vault is split pro-rata across a server-verified snapshot of eligible holders.",
    conditions: "Epoch length elapsed and the vault holds at least the execution threshold.",
    actions: "A snapshot is taken on the ledger, allocations are fixed, and each wallet claims once.",
    risks: "Selling during an epoch forfeits that epoch. Rewards scale with volume, which no one controls.",
    accent: "#8B5CF6", accent2: "#DCD3FF",
  },
  ORBIT: {
    title: "Orbit", tagline: "The coin that builds its own reserves.",
    purpose: "Autonomous treasury. Fees are diversified into an approved basket the token itself owns.",
    mechanism: "At each cycle the vault is swapped into SOL, USDC and a liquid staking token, with a retained reserve.",
    conditions: "Vault reaches the execution threshold and the cooldown has elapsed.",
    actions: "Swaps execute through approved venues only, inside price and slippage limits. No leverage, ever.",
    risks: "A treasury is not a promise of profit. Asset prices move, and the basket moves with them.",
    accent: "#10B981", accent2: "#22D3EE",
  },
};
