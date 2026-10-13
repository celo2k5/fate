import { getBus, type FateEvent } from "@/engine/events";
import { getProtocol } from "@/engine/keeper";
import { serialize } from "@/engine/units";

export const dynamic = "force-dynamic";

/** Server-sent events. `?tokenId=` narrows to one token; `Last-Event-ID` replays missed events. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const tokenId = u.searchParams.get("tokenId");
  const lastId = Number(req.headers.get("last-event-id") ?? u.searchParams.get("since") ?? 0);
  const enc = new TextEncoder();
  const bus = getBus();
  let listener: ((e: FateEvent) => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: FateEvent) => {
        if (tokenId && e.tokenId !== tokenId) return;
        controller.enqueue(enc.encode(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(serialize(e))}\n\n`));
      };
      // replay anything missed since the client's last event id (reconcile on reconnect)
      if (lastId > 0) {
        const p = getProtocol();
        const rows = p.db.prepare("SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT 200").all(lastId) as { id: bigint; type: FateEvent["type"]; token_id: string | null; payload_json: string; created_at: bigint }[];
        for (const r of rows) send({ id: Number(r.id), type: r.type, tokenId: r.token_id, payload: JSON.parse(r.payload_json), createdAt: Number(r.created_at) });
      }
      controller.enqueue(enc.encode(`event: hello\ndata: {"ok":true}\n\n`));
      listener = send;
      bus.on("event", listener);
      timer = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 15_000);
    },
    cancel() {
      if (listener) bus.off("event", listener);
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
