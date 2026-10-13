import { EventEmitter } from "node:events";

export type FateEventType =
  | "token.launched"
  | "trade"
  | "fee.deposited"
  | "destiny.eligible"
  | "destiny.executing"
  | "destiny.executed"
  | "destiny.failed"
  | "graduation"
  | "reward.settled"
  | "reward.claimed"
  | "treasury.acquired"
  | "wallet.funded";

export interface FateEvent {
  id?: number;
  type: FateEventType;
  tokenId: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

class Bus extends EventEmitter {}

/** Process-wide event bus shared by the engine, keeper and SSE route. */
export function getBus(): Bus {
  const g = globalThis as unknown as { __fateBus?: Bus };
  if (!g.__fateBus) {
    g.__fateBus = new Bus();
    g.__fateBus.setMaxListeners(500);
  }
  return g.__fateBus;
}
