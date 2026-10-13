import { getProtocol } from "@/engine/keeper";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";

/**
 * Token metadata for the on-chain `uri`. Two real backends:
 *  - Pinata (IPFS) when the admin configured `metadataGateway` = https://api.pinata.cloud and `metadataApiKey` = a Pinata JWT
 *    (pinJSONToIPFS / pinFileToIPFS are Pinata's documented endpoints) → ipfs://<cid>, resolved through the public gateway;
 *  - otherwise FATE serves the JSON itself at <siteUrl>/api/metadata/<mint> (stored in the ledger). Self-hosted metadata is
 *    valid for pump.fun / wallets, but it lives with the deployment: pin it to IPFS before a mainnet launch.
 */
export async function uploadMetadata(m: { name: string; symbol: string; description: string; image: string | null; website: string | null; x: string | null; telegram: string | null; destiny: string; mint: string }): Promise<string> {
  const s = getSettings();
  const p = getProtocol();
  const base = (s.siteUrl || process.env.FATE_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const selfImage = m.image ? `${base}/api/metadata/${m.mint}/image` : null;
  const json = { name: m.name, symbol: m.symbol, description: m.description, image: selfImage, website: m.website ?? undefined, twitter: m.x ?? undefined, telegram: m.telegram ?? undefined, showName: true, createdOn: "FATE", attributes: [{ trait_type: "destiny", value: m.destiny }, { trait_type: "vault", value: "protocol-enforced; creator fees fund the destiny" }] };
  p.db.prepare("INSERT INTO token_metadata(mint,json,image_data_url,created_at) VALUES (?,?,?,?) ON CONFLICT(mint) DO UPDATE SET json=excluded.json, image_data_url=excluded.image_data_url").run(m.mint, JSON.stringify(json), m.image, Date.now());
  if (/pinata\.cloud/.test(s.metadataGateway) && s.metadataApiKey) {
    try {
      let image = selfImage;
      if (m.image?.startsWith("data:")) {
        const [head, b64] = m.image.split(",");
        const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
        const fd = new FormData();
        fd.append("file", new Blob([Buffer.from(b64, "base64")], { type: mime }), `${m.mint}.${mime.split("/")[1] ?? "png"}`);
        const r = await fetch(`${s.metadataGateway.replace(/\/$/, "")}/pinning/pinFileToIPFS`, { method: "POST", headers: { Authorization: `Bearer ${s.metadataApiKey}` }, body: fd });
        if (!r.ok) throw new Error(`pinFileToIPFS ${r.status}`);
        image = `https://gateway.pinata.cloud/ipfs/${(await r.json() as { IpfsHash: string }).IpfsHash}`;
      }
      const r = await fetch(`${s.metadataGateway.replace(/\/$/, "")}/pinning/pinJSONToIPFS`, { method: "POST", headers: { Authorization: `Bearer ${s.metadataApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ pinataContent: { ...json, image }, pinataMetadata: { name: `fate-${m.symbol}-${m.mint.slice(0, 8)}` } }) });
      if (!r.ok) throw new Error(`pinJSONToIPFS ${r.status}`);
      const cid = (await r.json() as { IpfsHash: string }).IpfsHash;
      log.info("metadata.pinned", { mint: m.mint, cid });
      return `https://gateway.pinata.cloud/ipfs/${cid}`;
    } catch (e) {
      log.warn("metadata.pin.failed", { mint: m.mint, error: e });
    }
  }
  return `${base}/api/metadata/${m.mint}`;
}
