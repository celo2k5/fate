import { randomBytes, createHash } from "node:crypto";
import bs58 from "bs58";

export const newAddress = () => bs58.encode(randomBytes(32));
export const newId = (prefix: string) => `${prefix}_${bs58.encode(randomBytes(12))}`;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const isBase58Address = (s: string) => {
  try {
    const b = bs58.decode(s);
    return b.length === 32;
  } catch {
    return false;
  }
};
