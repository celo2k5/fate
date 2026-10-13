/**
 * FATE protocol engine.
 *
 * Authoritative, server-side implementation of the launchpad: launch, bonding
 * curve trading, fee routing into isolated per-token vaults, the four destiny
 * engines, graduation to an AMM pool, and the permissionless crank.
 *
 * Every state transition runs inside a single SQLite transaction and uses
 * checked bigint arithmetic. The instruction set mirrors programs/fate so the
 * same invariants hold on-chain.
 */
import type { DB } from "@/db";
import { PROTOCOL, DESTINY_META, clamp, type DestinyType, type LaunchInput, type OrbitAsset } from "./config";
import { applyBuy, applySell, marketCapLamports, quoteBuy, quoteSell, spotPrice, type Reserves } from "./curve";
import { getBus, type FateEvent, type FateEventType } from "./events";
import { newAddress, newId, sha256 } from "./ids";
import { quoteSwap, valueInLamports } from "./oracle";
import { EngineError, bps, checkedAdd, checkedSub, LAMPORTS_PER_SOL, TOKEN_UNIT } from "./units";

type Row = Record<string, unknown>;

export type ExecState = "IDLE" | "ACCUMULATING" | "ELIGIBLE" | "EXECUTING" | "COMPLETED" | "FAILED";

export interface TokenRow {
  id: string; name: string; ticker: string; description: string; image: string | null;
  website: string | null; x: string | null; telegram: string | null;
  destiny: DestinyType; creator: string; decimals: bigint; total_supply: bigint; circulating: bigint;
  burned: bigint; status: "CURVE" | "GRADUATING" | "AMM"; created_at: bigint;
  chain?: "SIMNET" | "DEVNET" | "MAINNET"; mint?: string | null; bonding_curve?: string | null; vault_authority?: string | null; metadata_uri?: string | null;
}
export interface ConfigRow {
  token_id: string; destiny: DestinyType; trade_fee_bps: bigint; destiny_share_bps: bigint;
  execution_threshold: bigint; cooldown_ms: bigint; max_slippage_bps: bigint; graduation_threshold: bigint;
  params_json: string; config_hash: string;
}
export interface StateRow {
  token_id: string; vault_address: string; state: ExecState; executions: bigint; last_execution_at: bigint | null;
  last_error: string | null; lifetime_fees: bigint; total_burned: bigint; total_liquidity_added: bigint;
  total_rewards_distributed: bigint; total_treasury_deployed: bigint; updated_at: bigint;
  failure_count?: bigint; next_retry_at?: bigint | null;
}
export interface CurveRow {
  token_id: string; curve_address: string; virtual_sol: bigint; virtual_tokens: bigint; real_sol: bigint;
  real_tokens: bigint; reserved_tokens: bigint; complete: bigint;
}
export interface PoolRow {
  token_id: string; pool_address: string; sol_reserve: bigint; token_reserve: bigint; lp_supply: bigint; lp_locked: bigint; created_at: bigint;
}

export interface TradeInput {
  tokenId: string; trader: string; amountIn: bigint; minOut: bigint; signature: string; slippageBps?: number;
}

const now = () => Date.now();

function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new EngineError("UNDERFLOW", "sqrt of negative");
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

export class Protocol {
  constructor(public db: DB) {
    this.ensureWallet(PROTOCOL.protocolTreasury, "protocol");
    this.ensureWallet(PROTOCOL.burnAddress, "burn");
    this.ensureWallet("venue:swap", "protocol");
  }

  // ───────────────────────── wallets ─────────────────────────

  ensureWallet(address: string, kind = "user") {
    this.db.prepare("INSERT OR IGNORE INTO wallets(address, lamports, kind, created_at) VALUES (?, 0, ?, ?)").run(address, kind, now());
  }
  getWallet(address: string): { address: string; lamports: bigint; kind: string } | undefined {
    return this.db.prepare("SELECT address, lamports, kind FROM wallets WHERE address = ?").get(address) as never;
  }
  private credit(address: string, lamports: bigint) {
    if (lamports < 0n) throw new EngineError("UNDERFLOW", "negative credit");
    const r = this.db.prepare("UPDATE wallets SET lamports = lamports + ? WHERE address = ?").run(lamports, address);
    if (r.changes !== 1) throw new EngineError("NO_WALLET", `wallet ${address} missing`);
  }
  private debit(address: string, lamports: bigint) {
    if (lamports < 0n) throw new EngineError("UNDERFLOW", "negative debit");
    const w = this.getWallet(address);
    if (!w) throw new EngineError("NO_WALLET", `wallet ${address} missing`);
    if (w.lamports < lamports) throw new EngineError("INSUFFICIENT_FUNDS", `insufficient SOL in ${address.slice(0, 6)}…`);
    this.db.prepare("UPDATE wallets SET lamports = lamports - ? WHERE address = ?").run(lamports, address);
  }
  /** simnet faucet (mirrors `solana airdrop` on devnet). */
  faucet(address: string, lamports = PROTOCOL.faucet) {
    this.ensureWallet(address, "user");
    this.credit(address, lamports);
    this.emit("wallet.funded", null, { address, lamports });
    return this.getWallet(address)!;
  }
  holding(tokenId: string, address: string): bigint {
    const r = this.db.prepare("SELECT amount FROM holdings WHERE token_id = ? AND address = ?").get(tokenId, address) as { amount: bigint } | undefined;
    return r?.amount ?? 0n;
  }
  private addHolding(tokenId: string, address: string, delta: bigint) {
    this.ensureWallet(address);
    const cur = this.holding(tokenId, address);
    const next = cur + delta;
    if (next < 0n) throw new EngineError("INSUFFICIENT_TOKENS", "insufficient token balance");
    this.db.prepare(
      "INSERT INTO holdings(token_id, address, amount) VALUES (?, ?, ?) ON CONFLICT(token_id, address) DO UPDATE SET amount = excluded.amount",
    ).run(tokenId, address, next);
  }

  // ───────────────────────── events ─────────────────────────

  private emit(type: FateEventType, tokenId: string | null, payload: Record<string, unknown>) {
    const createdAt = now();
    const r = this.db.prepare("INSERT INTO events(type, token_id, payload_json, created_at) VALUES (?, ?, ?, ?)").run(
      type, tokenId, JSON.stringify(payload, (_, v) => (typeof v === "bigint" ? v.toString() : v)), createdAt,
    );
    const ev: FateEvent = { id: Number(r.lastInsertRowid), type, tokenId, payload, createdAt };
    // emit after the surrounding transaction commits (listeners may read)
    queueMicrotask(() => getBus().emit("event", ev));
    return ev;
  }

  // ───────────────────────── launch ─────────────────────────

  launch(input: LaunchInput) {
    if (this.isPaused()) throw new EngineError("PAUSED", "launches are paused by the operator");
    const B = PROTOCOL.bounds;
    const executionThreshold = clamp(input.executionThreshold ?? B.executionThreshold.default, B.executionThreshold.min, B.executionThreshold.max);
    const cooldownMs = clamp(input.cooldownMs ?? B.cooldownMs.default, B.cooldownMs.min, B.cooldownMs.max);
    const maxSlippageBps = clamp(input.maxSlippageBps ?? B.maxSlippageBps.default, B.maxSlippageBps.min, B.maxSlippageBps.max);
    const graduationThreshold = clamp(input.graduationThreshold ?? B.graduationThreshold.default, B.graduationThreshold.min, B.graduationThreshold.max);
    const params: Record<string, unknown> = {};
    if (input.destiny === "ECHO") {
      params.minBalance = clamp(input.params?.minBalance ?? PROTOCOL.echo.minBalance.default, PROTOCOL.echo.minBalance.min, PROTOCOL.echo.minBalance.max).toString();
      params.epochMs = clamp(input.params?.epochMs ?? PROTOCOL.echo.epochMs.default, PROTOCOL.echo.epochMs.min, PROTOCOL.echo.epochMs.max);
    }
    if (input.destiny === "ORBIT") {
      const a = input.params?.allocationBps ?? PROTOCOL.orbit.allocationBps;
      const sum = Object.values(a).reduce((x, y) => x + y, 0);
      if (sum !== 10_000) throw new EngineError("BAD_PARAMS", "orbit allocation must sum to 10000 bps");
      for (const k of Object.keys(a)) if (!(PROTOCOL.orbit.approvedAssets as readonly string[]).includes(k)) throw new EngineError("BAD_PARAMS", `asset ${k} not approved`);
      params.allocationBps = a;
    }
    if (input.destiny === "PHOENIX") params.buybackShareBps = clamp(input.params?.buybackShareBps ?? 10_000, 1_000, 10_000);

    const id = input.chain?.mint ?? newAddress();
    const vault = `vault:${id}`;
    const curve = `curve:${id}`;
    const t = now();
    const supply = input.chain?.totalSupply ?? PROTOCOL.totalSupply;
    const curveTokens = input.chain?.realTokens ?? PROTOCOL.curveTokens;
    const reservedTokens = input.chain ? supply - curveTokens : PROTOCOL.reservedTokens;
    const configHash = sha256(JSON.stringify({ destiny: input.destiny, executionThreshold: executionThreshold.toString(), cooldownMs, maxSlippageBps, graduationThreshold: graduationThreshold.toString(), params }));
    const authorities = {
      destiny: "none — immutable at launch",
      vault: "program PDA — only destiny instructions can move funds",
      mint: "revoked after supply mint",
      freeze: "revoked",
      metadata: "creator may update off-chain metadata (name/description/links) only",
      protocol: "fee bps and bounds are protocol-governed; they cannot change a launched token's destiny",
    };

    const tx = this.db.transaction(() => {
      this.ensureWallet(input.creator, "user");
      this.ensureWallet(vault, "vault");
      this.ensureWallet(curve, "curve");
      if (input.chain) this.ensureWallet(input.chain.bondingCurve, "curve");
      this.db.prepare(`INSERT INTO tokens(id,name,ticker,description,image,website,x,telegram,destiny,creator,decimals,total_supply,circulating,burned,status,created_at,chain,mint,bonding_curve,vault_authority,metadata_uri)
        VALUES (?,?,?,?,?,?,?,?,?,?,6,?,?,0,'CURVE',?,?,?,?,?,?)`).run(
        id, input.name, input.ticker.toUpperCase(), input.description, input.image ?? null, input.website ?? null, input.x ?? null, input.telegram ?? null,
        input.destiny, input.creator, supply, supply, t,
        input.chain?.chain ?? "SIMNET", input.chain?.mint ?? null, input.chain?.bondingCurve ?? null, input.chain?.vaultAuthority ?? null, input.chain?.metadataUri ?? null,
      );
      this.db.prepare("INSERT INTO launches(token_id, signature, signed_message, authorities_json, created_at) VALUES (?,?,?,?,?)").run(id, input.signature, input.signedMessage, JSON.stringify(authorities), t);
      this.db.prepare(`INSERT INTO destiny_configs(token_id,destiny,trade_fee_bps,destiny_share_bps,execution_threshold,cooldown_ms,max_slippage_bps,graduation_threshold,params_json,config_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, input.destiny, PROTOCOL.tradeFeeBps, PROTOCOL.destinyShareBps, executionThreshold, cooldownMs, maxSlippageBps, graduationThreshold, JSON.stringify(params), configHash);
      this.db.prepare("INSERT INTO destiny_states(token_id, vault_address, state, updated_at) VALUES (?,?,'IDLE',?)").run(id, vault, t);
      this.db.prepare(`INSERT INTO curves(token_id,curve_address,virtual_sol,virtual_tokens,real_sol,real_tokens,reserved_tokens,complete)
        VALUES (?,?,?,?,0,?,?,0)`).run(id, input.chain?.bondingCurve ?? curve, input.chain?.virtualSol ?? PROTOCOL.initialVirtualSol, input.chain?.virtualTokens ?? PROTOCOL.initialVirtualTokens, curveTokens, reservedTokens);
      this.addHolding(id, input.chain?.bondingCurve ?? curve, curveTokens);
      this.addHolding(id, `reserve:${id}`, reservedTokens);
      this.db.prepare("UPDATE wallets SET kind='escrow' WHERE address = ?").run(`reserve:${id}`);
      if (input.destiny === "ORBIT") {
        this.ensureWallet(`treasury:${id}`, "escrow");
        for (const a of PROTOCOL.orbit.approvedAssets) this.db.prepare("INSERT INTO treasury_assets(token_id, asset, amount, cost_basis_lamports) VALUES (?,?,0,0)").run(id, a);
      }
      if (input.destiny === "ECHO") this.ensureWallet(`rewards:${id}`, "escrow");
      if (input.destiny === "GRAVITY") this.ensureWallet(`escrow:${id}`, "escrow");
      this.snapshotVault(id);
      this.snapshotMarket(id);
      this.emit("token.launched", id, { name: input.name, ticker: input.ticker.toUpperCase(), destiny: input.destiny, creator: input.creator, signature: input.signature });
    });
    tx();
    return this.getToken(id)!;
  }

  // ───────────────────────── reads ─────────────────────────

  getToken(id: string): TokenRow | undefined {
    return this.db.prepare("SELECT * FROM tokens WHERE id = ?").get(id) as never;
  }
  getConfig(id: string): ConfigRow {
    const c = this.db.prepare("SELECT * FROM destiny_configs WHERE token_id = ?").get(id) as ConfigRow | undefined;
    if (!c) throw new EngineError("NOT_FOUND", "token not found");
    return c;
  }
  getState(id: string): StateRow {
    return this.db.prepare("SELECT * FROM destiny_states WHERE token_id = ?").get(id) as StateRow;
  }
  getCurve(id: string): CurveRow {
    return this.db.prepare("SELECT * FROM curves WHERE token_id = ?").get(id) as CurveRow;
  }
  getPool(id: string): PoolRow | undefined {
    return this.db.prepare("SELECT * FROM pools WHERE token_id = ?").get(id) as never;
  }
  vaultBalance(id: string): bigint {
    return this.getWallet(`vault:${id}`)?.lamports ?? 0n;
  }
  holderCount(id: string): number {
    const r = this.db.prepare(
      "SELECT COUNT(*) c FROM holdings h JOIN wallets w ON w.address = h.address WHERE h.token_id = ? AND h.amount > 0 AND w.kind = 'user'",
    ).get(id) as { c: bigint };
    return Number(r.c);
  }
  volume(id: string, sinceMs: number): bigint {
    const r = this.db.prepare("SELECT COALESCE(SUM(sol_amount),0) v FROM trades WHERE token_id = ? AND created_at >= ?").get(id, now() - sinceMs) as { v: bigint };
    return r.v;
  }

  /** The active trading venue as constant-product reserves. */
  venue(id: string): { kind: "CURVE" | "AMM"; reserves: Reserves; address: string } {
    const t = this.getToken(id);
    if (!t) throw new EngineError("NOT_FOUND", "token not found");
    if (t.status === "AMM") {
      const p = this.getPool(id)!;
      return { kind: "AMM", address: p.pool_address, reserves: { virtualSol: p.sol_reserve, virtualTokens: p.token_reserve, realSol: p.sol_reserve, realTokens: p.token_reserve } };
    }
    if (t.status === "GRADUATING") throw new EngineError("GRADUATING", "trading paused during graduation");
    const c = this.getCurve(id);
    return { kind: "CURVE", address: c.curve_address, reserves: { virtualSol: c.virtual_sol, virtualTokens: c.virtual_tokens, realSol: c.real_sol, realTokens: c.real_tokens } };
  }
  private writeVenue(id: string, kind: "CURVE" | "AMM", r: Reserves) {
    if (kind === "CURVE") {
      this.db.prepare("UPDATE curves SET virtual_sol=?, virtual_tokens=?, real_sol=?, real_tokens=? WHERE token_id=?").run(r.virtualSol, r.virtualTokens, r.realSol, r.realTokens, id);
    } else {
      this.db.prepare("UPDATE pools SET sol_reserve=?, token_reserve=? WHERE token_id=?").run(r.realSol, r.realTokens, id);
    }
  }

  quote(id: string, side: "BUY" | "SELL", amountIn: bigint, slippageBps: number = PROTOCOL.bounds.slippageBps.default) {
    const cfg = this.getConfig(id);
    const v = this.venue(id);
    const s = clamp(slippageBps, PROTOCOL.bounds.slippageBps.min as number, PROTOCOL.bounds.slippageBps.max as number);
    const q = side === "BUY"
      ? quoteBuy(v.reserves, amountIn, Number(cfg.trade_fee_bps), Number(cfg.destiny_share_bps), s)
      : quoteSell(v.reserves, amountIn, Number(cfg.trade_fee_bps), Number(cfg.destiny_share_bps), s);
    return { ...q, venue: v.kind };
  }

  // ───────────────────────── trading ─────────────────────────

  buy(input: TradeInput) {
    return this.executeTrade("BUY", input, false);
  }
  sell(input: TradeInput) {
    return this.executeTrade("SELL", input, false);
  }

  private executeTrade(side: "BUY" | "SELL", input: TradeInput, isProtocol: boolean) {
    const dup = this.db.prepare("SELECT id FROM trades WHERE signature = ?").get(input.signature) as { id: string } | undefined;
    if (dup) return this.getTrade(dup.id)!; // idempotent replay
    const chainOf = (this.db.prepare("SELECT chain FROM tokens WHERE id=?").get(input.tokenId) as { chain?: string } | undefined)?.chain ?? "SIMNET";
    if (chainOf !== "SIMNET") throw new EngineError("ON_CHAIN", "this coin trades on-chain: sign the transaction from your wallet (POST /api/chain/trade)");
    const tx = this.db.transaction(() => {
      const token = this.getToken(input.tokenId);
      if (!token) throw new EngineError("NOT_FOUND", "token not found");
      const cfg = this.getConfig(input.tokenId);
      const v = this.venue(input.tokenId);
      if (side === "SELL" && this.holding(input.tokenId, input.trader) < input.amountIn) throw new EngineError("INSUFFICIENT_TOKENS", "insufficient token balance");
      if (side === "BUY" && (this.getWallet(input.trader)?.lamports ?? 0n) < input.amountIn) throw new EngineError("INSUFFICIENT_FUNDS", "insufficient SOL balance");
      const q = side === "BUY"
        ? quoteBuy(v.reserves, input.amountIn, Number(cfg.trade_fee_bps), Number(cfg.destiny_share_bps), input.slippageBps ?? 0)
        : quoteSell(v.reserves, input.amountIn, Number(cfg.trade_fee_bps), Number(cfg.destiny_share_bps), input.slippageBps ?? 0);
      if (q.amountOut < input.minOut) throw new EngineError("SLIPPAGE", `output ${q.amountOut} below minimum ${input.minOut} — quote is stale`);

      const vault = `vault:${input.tokenId}`;
      this.ensureWallet(input.trader, isProtocol ? "vault" : "user");
      if (side === "BUY") {
        this.debit(input.trader, q.amountIn);
        this.credit(v.address, q.amountIn - q.fee);
        this.addHolding(input.tokenId, v.address, -q.amountOut);
        this.addHolding(input.tokenId, input.trader, q.amountOut);
        this.writeVenue(input.tokenId, v.kind, applyBuy(v.reserves, q));
      } else {
        const gross = q.amountOut + q.fee;
        this.addHolding(input.tokenId, input.trader, -q.amountIn);
        this.addHolding(input.tokenId, v.address, q.amountIn);
        this.debit(v.address, gross);
        this.credit(input.trader, q.amountOut);
        this.writeVenue(input.tokenId, v.kind, applySell(v.reserves, q));
        if (token.destiny === "ECHO" && !isProtocol) {
          const epoch = Number(this.getState(input.tokenId).executions) + 1;
          this.db.prepare("UPDATE holdings SET last_sell_epoch = ? WHERE token_id = ? AND address = ?").run(epoch, input.tokenId, input.trader);
        }
      }
      // fee routing — isolated per-token vault + protocol treasury, settled exactly once per trade
      this.credit(vault, q.destinyFee);
      this.credit(PROTOCOL.protocolTreasury, q.protocolFee);

      const tradeId = newId("trade");
      const t = now();
      const price = side === "BUY" ? Number(q.amountIn - q.fee) / Number(q.amountOut) * 1e6 : Number(q.amountOut + q.fee) / Number(q.amountIn) * 1e6;
      this.db.prepare(`INSERT INTO trades(id,token_id,trader,side,venue,sol_amount,token_amount,fee_lamports,price_lamports_per_token,signature,is_protocol,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        tradeId, input.tokenId, input.trader, side, v.kind,
        side === "BUY" ? q.amountIn : q.amountOut + q.fee, side === "BUY" ? q.amountOut : q.amountIn,
        q.fee, price, input.signature, isProtocol ? 1 : 0, t,
      );
      this.db.prepare("INSERT INTO fee_events(id,token_id,trade_id,total_fee,destiny_fee,protocol_fee,created_at) VALUES (?,?,?,?,?,?,?)").run(newId("fee"), input.tokenId, tradeId, q.fee, q.destinyFee, q.protocolFee, t);
      this.db.prepare("UPDATE destiny_states SET lifetime_fees = lifetime_fees + ?, state = CASE WHEN state='IDLE' THEN 'ACCUMULATING' ELSE state END, updated_at = ? WHERE token_id = ?").run(q.destinyFee, t, input.tokenId);
      this.snapshotVault(input.tokenId);
      this.emit("trade", input.tokenId, { tradeId, side, trader: input.trader, venue: v.kind, solAmount: side === "BUY" ? q.amountIn : q.amountOut, tokenAmount: side === "BUY" ? q.amountOut : q.amountIn, fee: q.fee, isProtocol, ticker: token.ticker, destiny: token.destiny });
      this.emit("fee.deposited", input.tokenId, { tradeId, destinyFee: q.destinyFee, protocolFee: q.protocolFee, vault: this.vaultBalance(input.tokenId), ticker: token.ticker, destiny: token.destiny });
      return tradeId;
    });
    const tradeId = tx();
    this.snapshotMarket(input.tokenId);
    if (!isProtocol) this.maybeGraduate(input.tokenId);
    return this.getTrade(tradeId)!;
  }

  /**
   * Mirror of an on-chain TradeEvent (devnet / mainnet). Nothing is simulated: amounts, fees and reserves come from the
   * event the program emitted. The creator fee is FATE's whole take; it is split by the governed share into the coin's
   * vault (destiny_fee) and the protocol treasury (protocol_fee). Idempotent by `signature#index`.
   */
  recordChainTrade(input: { tokenId: string; signature: string; slot: number; blockTime: number | null; trader: string; side: "BUY" | "SELL"; solAmount: bigint; tokenAmount: bigint; creatorFee: bigint; totalFee: bigint; virtualSol: bigint; virtualTokens: bigint; realSol: bigint; realTokens: bigint; isProtocol: boolean; venue?: "CURVE" | "AMM"; poolAddress?: string }) {
    const dup = this.db.prepare("SELECT id FROM trades WHERE signature = ?").get(input.signature) as { id: string } | undefined;
    if (dup) return { tradeId: dup.id, duplicate: true };
    const tx = this.db.transaction(() => {
      const token = this.getToken(input.tokenId);
      if (!token) throw new EngineError("NOT_FOUND", "token not found");
      const cfg = this.getConfig(input.tokenId);
      const venue = input.venue ?? "CURVE";
      // tokens move against the venue the trade hit: the bonding curve, or (graduated) the PumpSwap pool
      const curveAddr = venue === "AMM" ? (input.poolAddress ?? `pool:${input.tokenId}`) : (token.bonding_curve ?? `curve:${input.tokenId}`);
      if (venue === "AMM") this.ensureWallet(curveAddr, "pool");
      const vault = `vault:${input.tokenId}`;
      this.ensureWallet(input.trader, input.isProtocol ? "vault" : "user");
      const destinyFee = bps(input.creatorFee, Number(cfg.destiny_share_bps));
      const protocolFee = input.creatorFee - destinyFee;
      if (input.side === "BUY") { this.addHolding(input.tokenId, curveAddr, -input.tokenAmount); this.addHolding(input.tokenId, input.trader, input.tokenAmount); }
      else {
        this.addHolding(input.tokenId, input.trader, -input.tokenAmount); this.addHolding(input.tokenId, curveAddr, input.tokenAmount);
        if (token.destiny === "ECHO" && !input.isProtocol) this.db.prepare("UPDATE holdings SET last_sell_epoch = ? WHERE token_id = ? AND address = ?").run(Number(this.getState(input.tokenId).executions) + 1, input.tokenId, input.trader);
      }
      // reserves as the program reported them after this trade
      if (venue === "AMM") this.db.prepare("UPDATE pools SET sol_reserve=?, token_reserve=? WHERE token_id=?").run(input.realSol, input.realTokens, input.tokenId);
      else this.db.prepare("UPDATE curves SET virtual_sol=?, virtual_tokens=?, real_sol=?, real_tokens=? WHERE token_id=?").run(input.virtualSol, input.virtualTokens, input.realSol, input.realTokens, input.tokenId);
      this.credit(vault, destinyFee);
      this.credit(PROTOCOL.protocolTreasury, protocolFee);
      const tradeId = newId("trade");
      const t = input.blockTime ? input.blockTime * 1000 : now();
      const price = Number(input.solAmount) / Math.max(1, Number(input.tokenAmount)) * 1e6;
      this.db.prepare(`INSERT INTO trades(id,token_id,trader,side,venue,sol_amount,token_amount,fee_lamports,price_lamports_per_token,signature,is_protocol,created_at,slot)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tradeId, input.tokenId, input.trader, input.side, venue, input.solAmount, input.tokenAmount, input.totalFee, price, input.signature, input.isProtocol ? 1 : 0, t, input.slot);
      this.db.prepare("INSERT INTO fee_events(id,token_id,trade_id,total_fee,destiny_fee,protocol_fee,created_at) VALUES (?,?,?,?,?,?,?)").run(newId("fee"), input.tokenId, tradeId, input.creatorFee, destinyFee, protocolFee, t);
      this.db.prepare("UPDATE destiny_states SET lifetime_fees = lifetime_fees + ?, state = CASE WHEN state='IDLE' THEN 'ACCUMULATING' ELSE state END, updated_at = ? WHERE token_id = ?").run(destinyFee, now(), input.tokenId);
      this.snapshotVault(input.tokenId);
      this.emit("trade", input.tokenId, { tradeId, side: input.side, trader: input.trader, venue, solAmount: input.solAmount, tokenAmount: input.tokenAmount, fee: input.totalFee, isProtocol: input.isProtocol, ticker: token.ticker, destiny: token.destiny, signature: input.signature.split("#")[0] });
      this.emit("fee.deposited", input.tokenId, { tradeId, destinyFee, protocolFee, vault: this.vaultBalance(input.tokenId), ticker: token.ticker, destiny: token.destiny });
      return tradeId;
    });
    const tradeId = tx();
    this.snapshotMarket(input.tokenId);
    return { tradeId, duplicate: false };
  }

  /** Chain-side execution bookkeeping: open an execution row (same UNIQUE(token_id, seq) guard as the simnet). */
  beginChainExecution(id: string): { execId: string; seq: number; vault: bigint } {
    const token = this.getToken(id)!;
    if (this.getState(id).state === "EXECUTING") throw new EngineError("IN_PROGRESS", "an execution is already in progress");
    const el = this.eligibility(id);
    if (!el.eligible) throw new EngineError("NOT_ELIGIBLE", el.reason);
    const t = now();
    const seq = Number((this.db.prepare("SELECT COALESCE(MAX(seq),0) m FROM destiny_executions WHERE token_id=?").get(id) as { m: bigint }).m) + 1;
    const execId = newId("exec");
    const tx = this.db.transaction(() => {
      // atomic claim: two keepers racing for the same coin cannot both get here (compare-and-set on the state row,
      // backed by UNIQUE(token_id, seq) on the execution row)
      const claimed = this.db.prepare("UPDATE destiny_states SET state='EXECUTING', updated_at=? WHERE token_id=? AND state <> 'EXECUTING'").run(t, id);
      if (claimed.changes !== 1) throw new EngineError("IN_PROGRESS", "an execution is already in progress");
      this.emit("destiny.eligible", id, { ticker: token.ticker, destiny: token.destiny, vault: el.vault, threshold: el.threshold });
      this.db.prepare("INSERT INTO destiny_executions(id,token_id,destiny,seq,status,vault_before,venue,created_at) VALUES (?,?,?,?,'EXECUTING',?,?,?)").run(execId, id, token.destiny, seq, el.vault, token.status === "AMM" ? "AMM" : "CURVE", t);
      this.emit("destiny.executing", id, { ticker: token.ticker, destiny: token.destiny, executionId: execId, seq });
    });
    tx();
    return { execId, seq, vault: el.vault };
  }
  completeChainExecution(id: string, execId: string, seq: number, signature: string, amountUsed: bigint, result: Record<string, unknown>, apply: () => void) {
    const token = this.getToken(id)!;
    const run = this.db.transaction(() => {
      apply();
      const done = now();
      this.db.prepare("UPDATE destiny_executions SET status='COMPLETED', amount_used=?, result_json=?, signature=?, completed_at=? WHERE id=?").run(amountUsed, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)), signature, done, execId);
      this.db.prepare("UPDATE destiny_states SET state='COMPLETED', executions = executions + 1, last_execution_at=?, last_error=NULL, failure_count=0, next_retry_at=NULL, updated_at=? WHERE token_id=?").run(done, done, id);
      this.snapshotVault(id);
      this.emit("destiny.executed", id, { ticker: token.ticker, destiny: token.destiny, executionId: execId, seq, signature, amountUsed, ...result });
    });
    run();
    this.snapshotMarket(id);
  }
  failChainExecution(id: string, execId: string, seq: number, error: string) {
    const token = this.getToken(id)!;
    const st = this.getState(id);
    const cfg = this.getConfig(id);
    const done = now();
    const failures = Number(st.failure_count ?? 0n) + 1;
    const backoff = Math.min(Number(cfg.cooldown_ms) * 2 ** Math.min(failures, 10), 3_600_000);
    this.db.prepare("UPDATE destiny_executions SET status='FAILED', error=?, completed_at=? WHERE id=? AND status='EXECUTING'").run(error.slice(0, 500), done, execId);
    this.db.prepare("UPDATE destiny_states SET state='FAILED', last_error=?, last_execution_at=?, failure_count=?, next_retry_at=?, updated_at=? WHERE token_id=?").run(error.slice(0, 500), done, failures, done + backoff, done, id);
    this.emit("destiny.failed", id, { ticker: token.ticker, destiny: token.destiny, executionId: execId, seq, error: error.slice(0, 200) });
  }
  /** Spend from the vault mirror (after the on-chain spend confirmed). */
  spendVault(id: string, lamports: bigint) { this.debit(`vault:${id}`, lamports); }
  burnMirror(id: string, authority: string, tokens: bigint) {
    this.addHolding(id, authority, -tokens);
    this.addHolding(id, PROTOCOL.burnAddress, tokens);
    this.db.prepare("UPDATE tokens SET burned = burned + ?, circulating = circulating - ? WHERE id=?").run(tokens, tokens, id);
    this.db.prepare("UPDATE destiny_states SET total_burned = total_burned + ? WHERE token_id=?").run(tokens, id);
  }
  creditHolding(id: string, address: string, tokens: bigint) { this.ensureWallet(address, "escrow"); this.addHolding(id, address, tokens); }
  chainTokens(): TokenRow[] { return this.db.prepare("SELECT * FROM tokens WHERE chain <> 'SIMNET' AND status <> 'GRADUATING'").all() as TokenRow[]; }

  getTrade(id: string) {
    return this.db.prepare("SELECT * FROM trades WHERE id = ?").get(id) as Row | undefined;
  }

  // ───────────────────────── snapshots ─────────────────────────

  snapshotVault(id: string) {
    this.db.prepare("INSERT INTO vault_snapshots(token_id, balance, created_at) VALUES (?,?,?)").run(id, this.vaultBalance(id), now());
  }
  snapshotMarket(id: string) {
    const token = this.getToken(id);
    if (!token || token.status === "GRADUATING") return;
    const v = this.venue(id);
    const price = spotPrice(v.reserves);
    this.db.prepare("INSERT INTO market_snapshots(token_id, price, market_cap, volume_24h, holders, created_at) VALUES (?,?,?,?,?,?)").run(
      id, price, marketCapLamports(price, token.circulating), this.volume(id, 86_400_000), this.holderCount(id), now(),
    );
  }

  // ───────────────────────── graduation ─────────────────────────

  maybeGraduate(id: string) {
    const token = this.getToken(id);
    if (!token || token.status !== "CURVE") return null;
    // on-chain coins graduate on pump.fun's terms, observed from the chain (recordChainGraduation), never simulated here
    if (token.chain && token.chain !== "SIMNET") return null;
    const cfg = this.getConfig(id);
    const curve = this.getCurve(id);
    if (curve.real_sol < cfg.graduation_threshold) return null;
    return this.graduate(id);
  }

  graduate(id: string) {
    const tx = this.db.transaction(() => {
      const token = this.getToken(id)!;
      if (token.status !== "CURVE") throw new EngineError("ALREADY_GRADUATED", "token already graduated");
      const cfg = this.getConfig(id);
      const curve = this.getCurve(id);
      if (curve.real_sol < cfg.graduation_threshold) throw new EngineError("NOT_ELIGIBLE", "graduation threshold not reached");
      this.db.prepare("UPDATE tokens SET status='GRADUATING' WHERE id=?").run(id);

      const curveAddr = curve.curve_address;
      const poolAddr = `pool:${id}`;
      this.ensureWallet(poolAddr, "pool");

      // 1. migration fee to protocol treasury, remainder of real SOL to the pool
      const migrationFee = bps(curve.real_sol, PROTOCOL.graduation.migrationFeeBps);
      const solForPool = checkedSub(curve.real_sol, migrationFee);
      this.debit(curveAddr, curve.real_sol);
      this.credit(PROTOCOL.protocolTreasury, migrationFee);
      this.credit(poolAddr, solForPool);

      // 2. tokens for the pool at the curve's final price (price continuity); surplus reserve is burned
      const wanted = (solForPool * curve.virtual_tokens) / curve.virtual_sol;
      const reserveAddr = `reserve:${id}`;
      const tokensForPool = wanted < curve.reserved_tokens ? wanted : curve.reserved_tokens;
      this.addHolding(id, reserveAddr, -curve.reserved_tokens);
      this.addHolding(id, poolAddr, tokensForPool);
      let burned = curve.reserved_tokens - tokensForPool;
      // unsold curve inventory is burned too
      if (curve.real_tokens > 0n) {
        this.addHolding(id, curveAddr, -curve.real_tokens);
        burned += curve.real_tokens;
      }
      let poolSol = solForPool;
      let poolTok = tokensForPool;

      // 3. Gravity escrow (pre-graduation locked liquidity) joins the pool at pool ratio
      const escrow = this.db.prepare("SELECT * FROM locked_liquidity WHERE token_id=? AND stage='ESCROW'").all(id) as { id: string; sol_amount: bigint; token_amount: bigint }[];
      let escrowSol = 0n, escrowTok = 0n;
      for (const e of escrow) { escrowSol += e.sol_amount; escrowTok += e.token_amount; }
      let lpForEscrow = 0n;
      const lpInitial = bigintSqrt(poolSol * poolTok);
      if (escrowSol > 0n && escrowTok > 0n) {
        const tokNeeded = (escrowSol * poolTok) / poolSol;
        let addSol = escrowSol, addTok = tokNeeded;
        if (tokNeeded > escrowTok) { addTok = escrowTok; addSol = (escrowTok * poolSol) / poolTok; }
        lpForEscrow = (lpInitial * addSol) / poolSol;
        this.debit(`escrow:${id}`, escrowSol);
        this.credit(poolAddr, addSol);
        this.credit(`vault:${id}`, escrowSol - addSol); // leftover SOL returns to the (non-withdrawable) vault
        this.addHolding(id, `escrow:${id}`, -escrowTok);
        this.addHolding(id, poolAddr, addTok);
        burned += escrowTok - addTok;
        poolSol += addSol; poolTok += addTok;
        this.db.prepare("UPDATE locked_liquidity SET stage='POOL', lp_amount = ? WHERE token_id=? AND stage='ESCROW'").run(lpForEscrow / BigInt(Math.max(1, escrow.length)), id);
      }
      if (burned > 0n) {
        this.addHolding(id, PROTOCOL.burnAddress, burned);
        this.db.prepare("UPDATE tokens SET burned = burned + ?, circulating = circulating - ? WHERE id=?").run(burned, burned, id);
      }
      const lpSupply = lpInitial + lpForEscrow;
      const t = now();
      this.db.prepare("INSERT INTO pools(token_id,pool_address,sol_reserve,token_reserve,lp_supply,lp_locked,created_at) VALUES (?,?,?,?,?,?,?)").run(id, poolAddr, poolSol, poolTok, lpSupply, lpSupply, t);
      this.db.prepare("UPDATE curves SET real_sol=0, real_tokens=0, complete=1 WHERE token_id=?").run(id);
      this.db.prepare("UPDATE tokens SET status='AMM' WHERE id=?").run(id);
      const signature = `grad:${sha256(id + t)}`;
      this.db.prepare("INSERT INTO graduations(token_id,sol_migrated,tokens_migrated,lp_locked,signature,created_at) VALUES (?,?,?,?,?,?)").run(id, poolSol, poolTok, lpSupply, signature, t);
      this.emit("graduation", id, { ticker: token.ticker, destiny: token.destiny, solMigrated: poolSol, tokensMigrated: poolTok, lpLocked: lpSupply, burned, signature });
      return signature;
    });
    const sig = tx();
    this.snapshotMarket(id);
    return sig;
  }

  /**
   * An on-chain coin's curve completed and pump.fun migrated it to its canonical PumpSwap pool. Recorded from what the
   * chain shows (pool account + reserves); pump.fun's own migration LP is not FATE's, so lp_locked starts at 0 and only
   * Gravity deposits add to it. Idempotent.
   */
  recordChainGraduation(id: string, pool: { poolKey: string; baseReserve: bigint; quoteReserve: bigint; lpSupply: bigint }) {
    const token = this.getToken(id);
    if (!token || token.status === "AMM") return false;
    const t = now();
    this.db.transaction(() => {
      this.ensureWallet(pool.poolKey, "pool");
      // the migration moves the curve's remaining inventory into the pool: mirror it so pool-side trades settle against it
      const curveAddr = token.bonding_curve ?? `curve:${id}`;
      const left = (this.db.prepare("SELECT COALESCE(amount,0) a FROM holdings WHERE token_id=? AND address=?").get(id, curveAddr) as { a: bigint } | undefined)?.a ?? 0n;
      if (left > 0n) { this.addHolding(id, curveAddr, -left); this.addHolding(id, pool.poolKey, left); }
      this.db.prepare("UPDATE tokens SET status='AMM' WHERE id=?").run(id);
      this.db.prepare("UPDATE curves SET complete=1 WHERE token_id=?").run(id);
      this.db.prepare("INSERT OR IGNORE INTO pools(token_id,pool_address,sol_reserve,token_reserve,lp_supply,lp_locked,created_at) VALUES (?,?,?,?,?,0,?)").run(id, pool.poolKey, pool.quoteReserve, pool.baseReserve, pool.lpSupply, t);
      this.db.prepare("INSERT OR IGNORE INTO graduations(token_id,sol_migrated,tokens_migrated,lp_locked,signature,created_at) VALUES (?,?,?,0,?,?)").run(id, pool.quoteReserve, pool.baseReserve, `pumpswap:${pool.poolKey}`, t);
      this.emit("graduation", id, { ticker: token.ticker, destiny: token.destiny, solMigrated: pool.quoteReserve, tokensMigrated: pool.baseReserve, lpLocked: 0n, burned: 0n, signature: `pumpswap:${pool.poolKey}`, venue: "PumpSwap" });
    })();
    return true;
  }

  // ───────────────────────── destiny engine ─────────────────────────

  /** Why a token is or isn't eligible right now. Pure read. */
  eligibility(id: string): { eligible: boolean; reason: string; progress: number; nextAt: number | null; threshold: bigint; vault: bigint } {
    const token = this.getToken(id);
    if (!token) throw new EngineError("NOT_FOUND", "token not found");
    const cfg = this.getConfig(id);
    const st = this.getState(id);
    const vault = this.vaultBalance(id);
    const threshold = cfg.execution_threshold;
    const progress = Math.min(1, Number(vault) / Number(threshold));
    const cooldownUntil = st.last_execution_at ? Number(st.last_execution_at) + Number(cfg.cooldown_ms) : 0;
    const t = now();
    if (token.status === "GRADUATING") return { eligible: false, reason: "graduating", progress, nextAt: null, threshold, vault };
    if (token.destiny === "ECHO") {
      const p = JSON.parse(cfg.params_json) as { epochMs: number };
      const epochStart = st.last_execution_at ? Number(st.last_execution_at) : Number(token.created_at);
      const epochEnd = epochStart + p.epochMs;
      if (vault < threshold) return { eligible: false, reason: "vault below threshold", progress, nextAt: epochEnd, threshold, vault };
      if (t < epochEnd) return { eligible: false, reason: "epoch in progress", progress, nextAt: epochEnd, threshold, vault };
      return { eligible: true, reason: "epoch complete", progress, nextAt: epochEnd, threshold, vault };
    }
    if (vault < threshold) return { eligible: false, reason: "vault below threshold", progress, nextAt: cooldownUntil > t ? cooldownUntil : null, threshold, vault };
    if (t < cooldownUntil) return { eligible: false, reason: "cooldown", progress, nextAt: cooldownUntil, threshold, vault };
    const retryAt = st.next_retry_at ? Number(st.next_retry_at) : 0;
    if (t < retryAt) return { eligible: false, reason: `backoff after ${Number(st.failure_count ?? 0n)} failure(s)`, progress, nextAt: retryAt, threshold, vault };
    return { eligible: true, reason: "threshold reached", progress, nextAt: null, threshold, vault };
  }

  /**
   * Permissionless crank. Anyone (keeper, user, test) may call it; the engine
   * re-validates every condition itself. Idempotent: a token in EXECUTING is
   * skipped, a stale EXECUTING (crash) is failed and becomes retryable after the cooldown.
   */
  crank(id: string): { executed: boolean; state: ExecState; executionId?: string; reason?: string } {
    const token = this.getToken(id);
    if (!token) throw new EngineError("NOT_FOUND", "token not found");
    const st = this.getState(id);
    const t = now();
    if (this.isPaused()) return { executed: false, state: st.state, reason: "executions paused by operator" };
    if (token.chain && token.chain !== "SIMNET") return { executed: false, state: st.state, reason: "on-chain coin: executed by the chain keeper" };
    if (st.state === "EXECUTING") {
      if (Number(st.updated_at) + 60_000 > t) return { executed: false, state: "EXECUTING", reason: "execution in progress" };
      this.db.prepare("UPDATE destiny_states SET state='FAILED', last_error='stale execution recovered', last_execution_at=?, updated_at=? WHERE token_id=?").run(t, t, id);
      this.db.prepare("UPDATE destiny_executions SET status='FAILED', error='stale execution recovered', completed_at=? WHERE token_id=? AND status='EXECUTING'").run(t, id);
    }
    const el = this.eligibility(id);
    if (!el.eligible) {
      const next: ExecState = el.vault === 0n && st.lifetime_fees === 0n ? "IDLE" : st.state === "FAILED" && el.reason === "cooldown" ? "FAILED" : "ACCUMULATING";
      if (next !== st.state) this.db.prepare("UPDATE destiny_states SET state=?, updated_at=? WHERE token_id=?").run(next, t, id);
      return { executed: false, state: next, reason: el.reason };
    }
    // ELIGIBLE -> EXECUTING (the execution row's UNIQUE(token_id, seq) forbids duplicates)
    // seq counts attempts (completed or failed) so a retry after a failure never collides
    const seq = Number((this.db.prepare("SELECT COALESCE(MAX(seq),0) m FROM destiny_executions WHERE token_id=?").get(id) as { m: bigint }).m) + 1;
    const execId = newId("exec");
    const begin = this.db.transaction(() => {
      this.db.prepare("UPDATE destiny_states SET state='ELIGIBLE', updated_at=? WHERE token_id=?").run(t, id);
      this.emit("destiny.eligible", id, { ticker: token.ticker, destiny: token.destiny, vault: el.vault, threshold: el.threshold });
      this.db.prepare("INSERT INTO destiny_executions(id,token_id,destiny,seq,status,vault_before,venue,created_at) VALUES (?,?,?,?,'EXECUTING',?,?,?)").run(execId, id, token.destiny, seq, el.vault, token.status === "AMM" ? "AMM" : "CURVE", t);
      this.db.prepare("UPDATE destiny_states SET state='EXECUTING', updated_at=? WHERE token_id=?").run(t, id);
      this.emit("destiny.executing", id, { ticker: token.ticker, destiny: token.destiny, executionId: execId, seq });
    });
    begin();
    try {
      const run = this.db.transaction(() => {
        const result =
          token.destiny === "PHOENIX" ? this.executePhoenix(id, execId) :
          token.destiny === "GRAVITY" ? this.executeGravity(id, execId) :
          token.destiny === "ECHO" ? this.executeEcho(id) :
          this.executeOrbit(id, execId);
        const done = now();
        this.db.prepare("UPDATE destiny_executions SET status='COMPLETED', amount_used=?, result_json=?, completed_at=? WHERE id=?").run(
          result.amountUsed, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)), done, execId,
        );
        this.db.prepare("UPDATE destiny_states SET state='COMPLETED', executions = executions + 1, last_execution_at=?, last_error=NULL, failure_count=0, next_retry_at=NULL, updated_at=? WHERE token_id=?").run(done, done, id);
        this.snapshotVault(id);
        this.emit("destiny.executed", id, { ticker: token.ticker, destiny: token.destiny, executionId: execId, seq, ...result });
      });
      run();
      this.snapshotMarket(id);
      return { executed: true, state: "COMPLETED", executionId: execId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const done = now();
      this.db.prepare("UPDATE destiny_executions SET status='FAILED', error=?, completed_at=? WHERE id=?").run(msg, done, execId);
      // exponential backoff: cooldown × 2^failures, capped at 1 h, so a persistently failing coin cannot spin the keeper
      const failures = Number(st.failure_count ?? 0n) + 1;
      const cfg = this.getConfig(id);
      const backoff = Math.min(Number(cfg.cooldown_ms) * 2 ** Math.min(failures, 10), 3_600_000);
      this.db.prepare("UPDATE destiny_states SET state='FAILED', last_error=?, last_execution_at=?, failure_count=?, next_retry_at=?, updated_at=? WHERE token_id=?").run(msg, done, failures, done + backoff, done, id);
      this.emit("destiny.failed", id, { ticker: token.ticker, destiny: token.destiny, executionId: execId, seq, error: msg });
      return { executed: false, state: "FAILED", executionId: execId, reason: msg };
    }
  }

  // ───────────────────────── operations: breaker, integrity, heartbeat ─────────────────────────

  /** Operator circuit breaker: when set, no destiny execution and no launch proceeds; reads and claims still work. */
  isPaused(): boolean {
    const row = this.db.prepare("SELECT value FROM protocol WHERE key='paused'").get() as { value: string } | undefined;
    return row?.value === "1";
  }
  setPaused(paused: boolean, by = "admin") {
    this.db.prepare("INSERT INTO protocol(key,value) VALUES ('paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(paused ? "1" : "0");
    this.emit(paused ? "protocol.paused" : "protocol.resumed", null, { by });
  }
  /** Keeper liveness, written by whichever keeper is running (in-process or the external worker). */
  heartbeat(source: string, extra: Record<string, unknown> = {}) {
    this.db.prepare("INSERT INTO protocol(key,value) VALUES ('keeper.heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({ source, at: now(), pid: process.pid, ...extra }));
  }
  keeperHeartbeat(): { source: string; at: number; pid?: number; ageMs: number } | null {
    const row = this.db.prepare("SELECT value FROM protocol WHERE key='keeper.heartbeat'").get() as { value: string } | undefined;
    if (!row) return null;
    const v = JSON.parse(row.value) as { source: string; at: number; pid?: number };
    return { ...v, ageMs: now() - v.at };
  }
  /**
   * Reconciliation. Recomputes what must hold if the ledger is consistent and reports every violation:
   * - every destiny config still hashes to the value recorded at launch (tamper check),
   * - every vault's balance equals routed destiny fees minus what completed executions spent,
   * - burned supply equals the sum of completed Phoenix burns, and circulating = total − burned,
   * - no execution is stuck in EXECUTING for more than a minute, no claim epoch is over-claimed.
   */
  verifyIntegrity(): { ok: boolean; checked: number; problems: string[] } {
    const problems: string[] = [];
    const cfgs = this.db.prepare("SELECT * FROM destiny_configs").all() as ConfigRow[];
    for (const c of cfgs) {
      const expect = sha256(JSON.stringify({ destiny: c.destiny, executionThreshold: c.execution_threshold.toString(), cooldownMs: Number(c.cooldown_ms), maxSlippageBps: Number(c.max_slippage_bps), graduationThreshold: c.graduation_threshold.toString(), params: JSON.parse(c.params_json) }));
      if (expect !== c.config_hash) problems.push(`config hash mismatch for ${c.token_id}`);
    }
    const tokens = this.db.prepare("SELECT id, burned, circulating, total_supply, destiny FROM tokens").all() as { id: string; burned: bigint; circulating: bigint; total_supply: bigint; destiny: string }[];
    for (const t of tokens) {
      const fees = (this.db.prepare("SELECT COALESCE(SUM(destiny_fee),0) s FROM fee_events WHERE token_id=?").get(t.id) as { s: bigint }).s;
      const spent = (this.db.prepare("SELECT COALESCE(SUM(amount_used),0) s FROM destiny_executions WHERE token_id=? AND status='COMPLETED'").get(t.id) as { s: bigint }).s;
      const vault = this.vaultBalance(t.id);
      if (vault !== fees - spent) problems.push(`vault drift for ${t.id}: balance ${vault} ≠ fees ${fees} − spent ${spent}`);
      if (t.circulating !== t.total_supply - t.burned) problems.push(`supply drift for ${t.id}`);
      if (t.destiny === "PHOENIX") {
        const burnedByExec = (this.db.prepare("SELECT result_json FROM destiny_executions WHERE token_id=? AND status='COMPLETED'").all(t.id) as { result_json: string }[])
          .reduce((a, r) => a + BigInt((JSON.parse(r.result_json) as { tokensBurned?: string }).tokensBurned ?? "0"), 0n);
        if (burnedByExec !== t.burned) problems.push(`burn drift for ${t.id}: executions ${burnedByExec} ≠ token.burned ${t.burned}`);
      }
    }
    const stuck = this.db.prepare("SELECT id FROM destiny_executions WHERE status='EXECUTING' AND created_at < ?").all(now() - 60_000) as { id: string }[];
    for (const s of stuck) problems.push(`execution ${s.id} stuck in EXECUTING`);
    const over = this.db.prepare("SELECT e.id FROM reward_epochs e WHERE e.claimed > e.funded").all() as { id: string }[];
    for (const o of over) problems.push(`epoch ${o.id} over-claimed`);
    return { ok: problems.length === 0, checked: cfgs.length + tokens.length, problems };
  }

  crankAll() {
    const ids = this.db.prepare("SELECT id FROM tokens WHERE status <> 'GRADUATING' AND chain = 'SIMNET'").all() as { id: string }[];
    return ids.map((r) => ({ id: r.id, ...this.crank(r.id) }));
  }

  /** Largest protocol buy ≤ `budget` whose price impact stays inside the slippage bound. */
  private boundedBuy(id: string, budget: bigint, maxSlippageBps: number, feeBps: number, shareBps: number) {
    const v = this.venue(id);
    let amount = budget;
    for (let i = 0; i < 12; i++) {
      try {
        const q = quoteBuy(v.reserves, amount, feeBps, shareBps, 0);
        if (q.priceImpactBps <= maxSlippageBps) return { amount, quote: q, venue: v };
      } catch (e) {
        if (!(e instanceof EngineError) || e.code !== "INSUFFICIENT_INVENTORY") throw e;
      }
      amount = amount / 2n;
      if (amount < LAMPORTS_PER_SOL / 100n) break;
    }
    throw new EngineError("SLIPPAGE", `no buy size within ${maxSlippageBps} bps slippage bound`);
  }

  private executePhoenix(id: string, execId: string) {
    const cfg = this.getConfig(id);
    const p = JSON.parse(cfg.params_json) as { buybackShareBps: number };
    const vault = `vault:${id}`;
    const budget = bps(this.vaultBalance(id), p.buybackShareBps ?? 10_000);
    const { amount, quote } = this.boundedBuy(id, budget, Number(cfg.max_slippage_bps), Number(cfg.trade_fee_bps), Number(cfg.destiny_share_bps));
    const trade = this.executeTrade("BUY", { tokenId: id, trader: vault, amountIn: amount, minOut: quote.minOut, signature: `exec:${execId}` }, true);
    const bought = trade.token_amount as bigint;
    // burn: vault's tokens -> burn address, supply accounting updated
    this.addHolding(id, vault, -bought);
    this.addHolding(id, PROTOCOL.burnAddress, bought);
    this.db.prepare("UPDATE tokens SET burned = burned + ?, circulating = circulating - ? WHERE id=?").run(bought, bought, id);
    this.db.prepare("UPDATE destiny_states SET total_burned = total_burned + ? WHERE token_id=?").run(bought, id);
    return { amountUsed: amount, tokensBought: bought, tokensBurned: bought, priceImpactBps: quote.priceImpactBps, tradeId: trade.id };
  }

  private executeGravity(id: string, execId: string) {
    const cfg = this.getConfig(id);
    const token = this.getToken(id)!;
    const vault = `vault:${id}`;
    const total = this.vaultBalance(id);
    const half = bps(total, PROTOCOL.gravity.pairingShareBps);
    const { amount, quote } = this.boundedBuy(id, half, Number(cfg.max_slippage_bps), Number(cfg.trade_fee_bps), Number(cfg.destiny_share_bps));
    const trade = this.executeTrade("BUY", { tokenId: id, trader: vault, amountIn: amount, minOut: quote.minOut, signature: `exec:${execId}` }, true);
    const bought = trade.token_amount as bigint;
    const pairSol = amount; // pair the same SOL amount we spent (bounded by what remains in the vault)
    const remaining = this.vaultBalance(id);
    const solToPair = pairSol < remaining ? pairSol : remaining;
    const t = now();
    if (token.status !== "AMM") {
      // escrow: locked position that migrates with the pool at graduation
      this.debit(vault, solToPair);
      this.credit(`escrow:${id}`, solToPair);
      this.addHolding(id, vault, -bought);
      this.addHolding(id, `escrow:${id}`, bought);
      this.db.prepare("INSERT INTO locked_liquidity(id,token_id,sol_amount,token_amount,lp_amount,stage,execution_id,created_at) VALUES (?,?,?,?,0,'ESCROW',?,?)").run(newId("lp"), id, solToPair, bought, execId, t);
      this.db.prepare("UPDATE destiny_states SET total_liquidity_added = total_liquidity_added + ? WHERE token_id=?").run(solToPair, id);
      return { amountUsed: amount + solToPair, stage: "ESCROW", solLocked: solToPair, tokensLocked: bought, priceImpactBps: quote.priceImpactBps, tradeId: trade.id };
    }
    // post-graduation: add to the AMM at pool ratio; LP is minted to protocol custody and never leaves
    const pool = this.getPool(id)!;
    const tokNeeded = (solToPair * pool.token_reserve) / pool.sol_reserve;
    let addSol = solToPair, addTok = tokNeeded;
    if (tokNeeded > bought) { addTok = bought; addSol = (bought * pool.sol_reserve) / pool.token_reserve; }
    const lp = (pool.lp_supply * addSol) / pool.sol_reserve;
    this.debit(vault, addSol);
    this.credit(pool.pool_address, addSol);
    this.addHolding(id, vault, -addTok);
    this.addHolding(id, pool.pool_address, addTok);
    this.db.prepare("UPDATE pools SET sol_reserve = sol_reserve + ?, token_reserve = token_reserve + ?, lp_supply = lp_supply + ?, lp_locked = lp_locked + ? WHERE token_id=?").run(addSol, addTok, lp, lp, id);
    // leftover tokens from an imperfect pairing are burned rather than kept
    const leftover = bought - addTok;
    if (leftover > 0n) {
      this.addHolding(id, vault, -leftover);
      this.addHolding(id, PROTOCOL.burnAddress, leftover);
      this.db.prepare("UPDATE tokens SET burned = burned + ?, circulating = circulating - ? WHERE id=?").run(leftover, leftover, id);
    }
    this.db.prepare("INSERT INTO locked_liquidity(id,token_id,sol_amount,token_amount,lp_amount,stage,execution_id,created_at) VALUES (?,?,?,?,?,'POOL',?,?)").run(newId("lp"), id, addSol, addTok, lp, execId, t);
    this.db.prepare("UPDATE destiny_states SET total_liquidity_added = total_liquidity_added + ? WHERE token_id=?").run(addSol, id);
    return { amountUsed: amount + addSol, stage: "POOL", solLocked: addSol, tokensLocked: addTok, lpMinted: lp, leftoverBurned: leftover, priceImpactBps: quote.priceImpactBps, tradeId: trade.id };
  }

  private executeEcho(id: string) {
    const cfg = this.getConfig(id);
    const st = this.getState(id);
    const p = JSON.parse(cfg.params_json) as { minBalance: string; epochMs: number };
    const minBalance = BigInt(p.minBalance);
    const epoch = Number(st.executions) + 1;
    const vault = `vault:${id}`;
    const funded = this.vaultBalance(id);
    // Eligibility snapshot taken on the ledger: user wallets only, >= min balance, no sells this epoch.
    const holders = this.db.prepare(
      `SELECT h.address, h.amount FROM holdings h JOIN wallets w ON w.address = h.address
       WHERE h.token_id = ? AND w.kind = 'user' AND h.amount >= ? AND (h.last_sell_epoch IS NULL OR h.last_sell_epoch < ?)
       ORDER BY h.amount DESC`,
    ).all(id, minBalance, epoch) as { address: string; amount: bigint }[];
    const eligibleSupply = holders.reduce((a, h) => a + h.amount, 0n);
    if (holders.length === 0 || eligibleSupply === 0n) throw new EngineError("NO_ELIGIBLE_HOLDERS", "no eligible holders at snapshot");
    let allocated = 0n;
    const snapshot = holders.map((h) => {
      const alloc = (funded * h.amount) / eligibleSupply;
      allocated += alloc;
      return [h.address, h.amount.toString(), alloc.toString()];
    });
    const t = now();
    const epochId = newId("epoch");
    this.debit(vault, allocated);
    this.credit(`rewards:${id}`, allocated);
    this.db.prepare("INSERT INTO reward_epochs(id,token_id,epoch,funded,eligible_wallets,eligible_supply,min_balance,claimed,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,0,?,?)").run(
      epochId, id, epoch, allocated, holders.length, eligibleSupply, minBalance, JSON.stringify(snapshot), t,
    );
    this.db.prepare("UPDATE destiny_states SET total_rewards_distributed = total_rewards_distributed + ? WHERE token_id=?").run(allocated, id);
    this.emit("reward.settled", id, { ticker: this.getToken(id)!.ticker, destiny: "ECHO", epoch, funded: allocated, eligibleWallets: holders.length, epochId });
    return { amountUsed: allocated, epoch, epochId, eligibleWallets: holders.length, eligibleSupply, funded: allocated };
  }

  private executeOrbit(id: string, _execId: string) {
    const cfg = this.getConfig(id);
    const p = JSON.parse(cfg.params_json) as { allocationBps: Record<OrbitAsset, number> };
    const vault = `vault:${id}`;
    const treasury = `treasury:${id}`;
    const total = this.vaultBalance(id);
    const acquisitions: Record<string, unknown>[] = [];
    let used = 0n;
    const t = now();
    for (const asset of PROTOCOL.orbit.approvedAssets) {
      const slice = bps(total, p.allocationBps[asset] ?? 0);
      if (slice === 0n) continue;
      if (asset === "SOL" || asset === "RESERVE") {
        this.debit(vault, slice);
        this.credit(treasury, slice);
        this.db.prepare("UPDATE treasury_assets SET amount = amount + ?, cost_basis_lamports = cost_basis_lamports + ? WHERE token_id=? AND asset=?").run(slice, slice, id, asset);
        acquisitions.push({ asset, lamportsIn: slice, amountOut: slice });
      } else {
        const q = quoteSwap(asset, slice, t);
        if (q.slippageBps > Number(cfg.max_slippage_bps)) throw new EngineError("SLIPPAGE", `${asset} swap slippage ${q.slippageBps} bps exceeds bound`);
        this.debit(vault, slice);
        this.credit("venue:swap", slice);
        this.db.prepare("UPDATE treasury_assets SET amount = amount + ?, cost_basis_lamports = cost_basis_lamports + ? WHERE token_id=? AND asset=?").run(q.amountOut, slice, id, asset);
        acquisitions.push({ asset, lamportsIn: slice, amountOut: q.amountOut, oraclePrice: q.oraclePrice, executionPrice: q.executionPrice, slippageBps: q.slippageBps });
      }
      used += slice;
    }
    this.db.prepare("UPDATE destiny_states SET total_treasury_deployed = total_treasury_deployed + ? WHERE token_id=?").run(used, id);
    this.emit("treasury.acquired", id, { ticker: this.getToken(id)!.ticker, destiny: "ORBIT", executionId: _execId, lamports: used, acquisitions });
    return { amountUsed: used, acquisitions };
  }

  // ───────────────────────── echo claims ─────────────────────────

  claimable(id: string, address: string) {
    const epochs = this.db.prepare("SELECT id, epoch, snapshot_json, created_at FROM reward_epochs WHERE token_id=? ORDER BY epoch DESC").all(id) as { id: string; epoch: bigint; snapshot_json: string; created_at: bigint }[];
    const claimed = new Set((this.db.prepare("SELECT epoch_id FROM reward_claims WHERE address=?").all(address) as { epoch_id: string }[]).map((r) => r.epoch_id));
    const out: { epochId: string; epoch: number; amount: bigint; claimed: boolean }[] = [];
    for (const e of epochs) {
      const snap = JSON.parse(e.snapshot_json) as [string, string, string][];
      const row = snap.find((s) => s[0] === address);
      if (row) out.push({ epochId: e.id, epoch: Number(e.epoch), amount: BigInt(row[2]), claimed: claimed.has(e.id) });
    }
    return out;
  }

  claim(epochId: string, address: string, signature: string) {
    const dup = this.db.prepare("SELECT id FROM reward_claims WHERE signature=?").get(signature);
    if (dup) throw new EngineError("DUPLICATE", "claim already submitted");
    const tx = this.db.transaction(() => {
      const e = this.db.prepare("SELECT * FROM reward_epochs WHERE id=?").get(epochId) as { id: string; token_id: string; epoch: bigint; funded: bigint; claimed: bigint; snapshot_json: string } | undefined;
      if (!e) throw new EngineError("NOT_FOUND", "epoch not found");
      const already = this.db.prepare("SELECT id FROM reward_claims WHERE epoch_id=? AND address=?").get(epochId, address);
      if (already) throw new EngineError("ALREADY_CLAIMED", "rewards for this epoch were already claimed");
      const snap = JSON.parse(e.snapshot_json) as [string, string, string][];
      const row = snap.find((s) => s[0] === address);
      if (!row) throw new EngineError("NOT_ELIGIBLE", "wallet not in the epoch snapshot");
      const amount = BigInt(row[2]);
      if (e.claimed + amount > e.funded) throw new EngineError("OVERCLAIM", "claims would exceed funded rewards");
      this.debit(`rewards:${e.token_id}`, amount);
      this.credit(address, amount);
      const t = now();
      const claimId = newId("claim");
      this.db.prepare("INSERT INTO reward_claims(id,epoch_id,address,amount,signature,created_at) VALUES (?,?,?,?,?,?)").run(claimId, epochId, address, amount, signature, t);
      this.db.prepare("UPDATE reward_epochs SET claimed = claimed + ? WHERE id=?").run(amount, epochId);
      this.emit("reward.claimed", e.token_id, { address, amount, epoch: Number(e.epoch), ticker: this.getToken(e.token_id)!.ticker, destiny: "ECHO" });
      return { claimId, amount, epoch: Number(e.epoch) };
    });
    return tx();
  }

  // ───────────────────────── views ─────────────────────────

  /** Everything the token page needs, serialisable. */
  detail(id: string) {
    const token = this.getToken(id);
    if (!token) return null;
    const cfg = this.getConfig(id);
    const st = this.getState(id);
    const curve = this.getCurve(id);
    const pool = this.getPool(id);
    const venueInfo = token.status === "GRADUATING" ? null : this.venue(id);
    const price = venueInfo ? spotPrice(venueInfo.reserves) : 0;
    const el = this.eligibility(id);
    const executions = this.db.prepare("SELECT * FROM destiny_executions WHERE token_id=? ORDER BY seq DESC LIMIT 50").all(id) as Row[];
    const trades = this.db.prepare("SELECT * FROM trades WHERE token_id=? ORDER BY created_at DESC LIMIT 40").all(id) as Row[];
    const launch = this.db.prepare("SELECT * FROM launches WHERE token_id=?").get(id) as Row;
    const graduation = this.db.prepare("SELECT * FROM graduations WHERE token_id=?").get(id) as Row | undefined;
    const vaultHistory = this.db.prepare("SELECT balance, created_at FROM vault_snapshots WHERE token_id=? ORDER BY id DESC LIMIT 120").all(id) as Row[];
    const marketHistory = this.db.prepare("SELECT price, market_cap, created_at FROM market_snapshots WHERE token_id=? ORDER BY id DESC LIMIT 200").all(id) as Row[];
    const destinyExtras: Record<string, unknown> = {};
    if (token.destiny === "ECHO") {
      destinyExtras.epochs = this.db.prepare("SELECT id, epoch, funded, eligible_wallets, claimed, created_at FROM reward_epochs WHERE token_id=? ORDER BY epoch DESC LIMIT 20").all(id);
      destinyExtras.rewardsEscrow = this.getWallet(`rewards:${id}`)?.lamports ?? 0n;
      destinyExtras.params = JSON.parse(cfg.params_json);
      destinyExtras.currentEpoch = Number(st.executions) + 1;
    }
    if (token.destiny === "ORBIT") {
      const assets = this.db.prepare("SELECT asset, amount, cost_basis_lamports FROM treasury_assets WHERE token_id=?").all(id) as { asset: string; amount: bigint; cost_basis_lamports: bigint }[];
      const onChain = Boolean(token.chain && token.chain !== "SIMNET");
      // on-chain coins: only SOL-denominated legs have a known lamport value here; USDC / JitoSOL are shown as amounts, never priced by the simnet oracle
      destinyExtras.assets = assets.map((a) => ({ ...a, valueLamports: onChain ? (a.asset === "SOL" || a.asset === "RESERVE" ? a.amount : null) : valueInLamports(a.asset as never, a.amount) }));
      destinyExtras.treasuryValue = (destinyExtras.assets as { valueLamports: bigint | null }[]).reduce((s, a) => s + (a.valueLamports ?? 0n), 0n);
      destinyExtras.treasuryValuePartial = onChain;
      destinyExtras.params = JSON.parse(cfg.params_json);
    }
    if (token.destiny === "GRAVITY") {
      destinyExtras.positions = this.db.prepare("SELECT * FROM locked_liquidity WHERE token_id=? ORDER BY created_at DESC").all(id);
      const pos = this.db.prepare("SELECT COALESCE(SUM(sol_amount),0) s, COALESCE(SUM(token_amount),0) t, COALESCE(SUM(lp_amount),0) lp FROM locked_liquidity WHERE token_id=?").get(id) as { s: bigint; t: bigint; lp: bigint };
      destinyExtras.position = pos;
    }
    if (token.destiny === "PHOENIX") {
      destinyExtras.lastBuyback = executions.find((e) => e.status === "COMPLETED") ?? null;
    }
    const realSol = token.status === "AMM" ? cfg.graduation_threshold : curve.real_sol;
    const agent = token.chain && token.chain !== "SIMNET" ? {
      chain: token.chain, mint: token.mint, vaultAuthority: token.vault_authority, bondingCurve: token.bonding_curve, metadataUri: token.metadata_uri,
      state: st.state, lastError: st.last_error ?? null, failureCount: st.failure_count ?? 0n, nextRetryAt: st.next_retry_at ?? null,
      pendingTx: Number((this.db.prepare("SELECT COUNT(*) c FROM chain_txs WHERE token_id=? AND status IN ('BUILT','SENT')").get(id) as { c: bigint }).c),
      recentTx: this.db.prepare("SELECT purpose, status, signature, error, lamports, slot, updated_at FROM chain_txs WHERE token_id=? ORDER BY updated_at DESC LIMIT 8").all(id),
      custodial: true,
    } : null;
    return {
      agent,
      token, config: cfg, state: st, curve, pool, launch, graduation,
      price, marketCap: marketCapLamports(price, token.circulating),
      volume24h: this.volume(id, 86_400_000), holders: this.holderCount(id),
      vault: this.vaultBalance(id), eligibility: el,
      graduationProgress: Math.min(1, Number(realSol) / Number(cfg.graduation_threshold)),
      venue: venueInfo?.kind ?? "GRADUATING",
      executions, trades, vaultHistory, marketHistory, meta: DESTINY_META[token.destiny], ...destinyExtras,
    };
  }

  list(opts: { destiny?: DestinyType; graduated?: boolean; sort?: "new" | "trending"; q?: string; limit?: number } = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.destiny) { where.push("t.destiny = ?"); args.push(opts.destiny); }
    if (opts.graduated) where.push("t.status = 'AMM'");
    if (opts.q) { where.push("(t.name LIKE ? OR t.ticker LIKE ? OR t.id = ?)"); args.push(`%${opts.q}%`, `%${opts.q}%`, opts.q); }
    const order = opts.sort === "trending" ? "vol DESC, t.created_at DESC" : "t.created_at DESC";
    const rows = this.db.prepare(`
      SELECT t.*, s.state, s.executions, s.total_burned, s.total_liquidity_added, s.total_rewards_distributed, s.total_treasury_deployed,
             c.execution_threshold, c.graduation_threshold,
             (SELECT lamports FROM wallets WHERE address = 'vault:' || t.id) AS vault,
             (SELECT COALESCE(SUM(sol_amount),0) FROM trades tr WHERE tr.token_id = t.id AND tr.created_at >= ?) AS vol,
             (SELECT COUNT(*) FROM holdings h JOIN wallets w ON w.address=h.address WHERE h.token_id=t.id AND h.amount>0 AND w.kind='user') AS holders
      FROM tokens t JOIN destiny_states s ON s.token_id = t.id JOIN destiny_configs c ON c.token_id = t.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${order} LIMIT ?`).all(now() - 86_400_000, ...args, opts.limit ?? 60) as (TokenRow & Row)[];
    return rows.map((r) => {
      const venue = r.status === "GRADUATING" ? null : this.venue(r.id);
      const price = venue ? spotPrice(venue.reserves) : 0;
      const curve = this.getCurve(r.id);
      const realSol = r.status === "AMM" ? (r.graduation_threshold as bigint) : curve.real_sol;
      return {
        ...r, price, marketCap: marketCapLamports(price, r.circulating),
        graduationProgress: Math.min(1, Number(realSol) / Number(r.graduation_threshold as bigint)),
        vaultProgress: Math.min(1, Number(r.vault as bigint) / Number(r.execution_threshold as bigint)),
      };
    });
  }

  leaderboards() {
    const q = (sql: string) => this.db.prepare(sql).all() as Row[];
    const base = "SELECT t.id, t.name, t.ticker, t.destiny, s.executions, s.total_burned, s.total_liquidity_added, s.total_rewards_distributed, s.total_treasury_deployed FROM tokens t JOIN destiny_states s ON s.token_id=t.id";
    return {
      PHOENIX: {
        mostBurned: q(`${base} WHERE t.destiny='PHOENIX' AND s.total_burned>0 ORDER BY s.total_burned DESC LIMIT 10`),
        mostBuybacks: q(`${base} WHERE t.destiny='PHOENIX' AND s.executions>0 ORDER BY s.executions DESC LIMIT 10`),
      },
      GRAVITY: {
        mostLiquidity: q(`${base} WHERE t.destiny='GRAVITY' AND s.total_liquidity_added>0 ORDER BY s.total_liquidity_added DESC LIMIT 10`),
        largestPosition: q(`SELECT t.id, t.name, t.ticker, t.destiny, COALESCE(SUM(l.sol_amount),0) AS position FROM tokens t JOIN locked_liquidity l ON l.token_id=t.id WHERE t.destiny='GRAVITY' GROUP BY t.id ORDER BY position DESC LIMIT 10`),
      },
      ECHO: {
        mostRewards: q(`${base} WHERE t.destiny='ECHO' AND s.total_rewards_distributed>0 ORDER BY s.total_rewards_distributed DESC LIMIT 10`),
        mostClaimants: q(`SELECT t.id, t.name, t.ticker, t.destiny, MAX(e.eligible_wallets) AS claimants FROM tokens t JOIN reward_epochs e ON e.token_id=t.id GROUP BY t.id ORDER BY claimants DESC LIMIT 10`),
      },
      ORBIT: {
        largestTreasury: q(`${base} WHERE t.destiny='ORBIT' AND s.total_treasury_deployed>0 ORDER BY s.total_treasury_deployed DESC LIMIT 10`),
        mostCycles: q(`${base} WHERE t.destiny='ORBIT' AND s.executions>0 ORDER BY s.executions DESC LIMIT 10`),
      },
    };
  }

  activity(limit = 30, types?: FateEventType[]) {
    const rows = types?.length
      ? this.db.prepare(`SELECT * FROM events WHERE type IN (${types.map(() => "?").join(",")}) ORDER BY id DESC LIMIT ?`).all(...types, limit)
      : this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit);
    return (rows as { id: bigint; type: FateEventType; token_id: string | null; payload_json: string; created_at: bigint }[]).map((r) => ({
      id: Number(r.id), type: r.type, tokenId: r.token_id, payload: JSON.parse(r.payload_json), createdAt: Number(r.created_at),
    }));
  }

  stats() {
    const n = (sql: string) => Number((this.db.prepare(sql).get() as { v: bigint | null }).v ?? 0n);
    const b = (sql: string) => (this.db.prepare(sql).get() as { v: bigint | null }).v ?? 0n;
    return {
      tokens: n("SELECT COUNT(*) v FROM tokens"),
      executions: n("SELECT COUNT(*) v FROM destiny_executions WHERE status='COMPLETED'"),
      feesRouted: b("SELECT SUM(destiny_fee) v FROM fee_events"),
      volume: b("SELECT SUM(sol_amount) v FROM trades"),
      burned: b("SELECT SUM(total_burned) v FROM destiny_states"),
      liquidity: b("SELECT SUM(total_liquidity_added) v FROM destiny_states"),
      rewards: b("SELECT SUM(total_rewards_distributed) v FROM destiny_states"),
      treasury: b("SELECT SUM(total_treasury_deployed) v FROM destiny_states"),
      graduated: n("SELECT COUNT(*) v FROM graduations"),
    };
  }

  portfolio(address: string) {
    const w = this.getWallet(address);
    const holdings = this.db.prepare(
      "SELECT h.token_id, h.amount, t.name, t.ticker, t.destiny FROM holdings h JOIN tokens t ON t.id=h.token_id WHERE h.address=? AND h.amount>0 ORDER BY h.amount DESC",
    ).all(address) as Row[];
    return { lamports: w?.lamports ?? 0n, holdings };
  }
}

export const TOKEN_UNIT_EXPORT = TOKEN_UNIT;
export const checked = { add: checkedAdd, sub: checkedSub };
