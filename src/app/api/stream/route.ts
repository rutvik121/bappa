import type { NextRequest } from 'next/server';
import { eventsSince, getSnapshot } from '@/server/collective/state';

/**
 * What is happening to Bappa, as it happens.
 *
 * Server-sent events rather than sockets. This runs on serverless: there
 * is no process to hold a socket open, and adding a realtime service to
 * carry four small messages a minute would be infrastructure bought for
 * nothing. SSE is plain HTTP, `EventSource` reconnects by itself, and it
 * hands back `Last-Event-ID` on its own -- which is exactly the cursor
 * this needs to resume without replaying.
 *
 * Instances share nothing but the store, so this polls it rather than
 * listening: the store is what makes an event visible to every instance,
 * and at this pace a second of latency is beneath noticing in a piece
 * built around stillness.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** How often the store is asked for anything new during fallback. */
const POLL_MS = 2500;

/**
 * Kept short so fallback cannot consume significant Vercel CPU or
 * provisioned memory.
 */
const MAX_CONNECTION_MS = 10_000;

/** Comment lines, to keep proxies from buffering the stream shut. */
const KEEPALIVE_MS = 5000;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const version = url.searchParams.get('v');

  if (version !== '2') {
    return new Response(null, {
      status: 204,
    });
  }

  // EventSource replays its own cursor on reconnect; the query parameter
  // is for the first connection and for anything that is not EventSource.
  const lastId = req.headers.get('last-event-id') ?? url.searchParams.get('since') ?? '0';
  let cursor = Number(lastId) || 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (payload: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          open = false;
        }
      };

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(poll);
        clearInterval(keepalive);
        clearTimeout(expiry);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };

      // Tell EventSource to wait 15s before reconnecting when this short stream ends.
      send(`retry: 15000\n\n`);

      // Anyone arriving mid-festival starts from the state, not from the
      // history: they are handed how built he is now, and watch from
      // there. Nothing is replayed.
      const snapshot = await getSnapshot();
      if (cursor <= 0) cursor = snapshot.seq;
      send(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\nid: ${cursor}\n\n`);

      const poll = setInterval(async () => {
        if (!open) return;
        try {
          const { events, seq, gap } = await eventsSince(cursor);

          // Too far behind for the log to help. Rather than replaying a
          // partial history, hand over the current state -- which is the
          // thing that was actually wanted.
          if (gap) {
            const fresh = await getSnapshot();
            cursor = fresh.seq;
            send(`event: snapshot\ndata: ${JSON.stringify(fresh)}\nid: ${cursor}\n\n`);
            return;
          }

          if (!events.length) return;

          cursor = seq;
          for (const e of events) {
            send(`event: collective\ndata: ${JSON.stringify(e)}\nid: ${cursor}\n\n`);
          }
        } catch {
          // A store hiccup is not worth dropping the connection over; the
          // next tick tries again and the client never notices.
        }
      }, POLL_MS);

      const keepalive = setInterval(() => send(`: still here\n\n`), KEEPALIVE_MS);
      const expiry = setTimeout(close, MAX_CONNECTION_MS);

      req.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx and friends will otherwise hold the whole stream in a buffer
      // and deliver it when it ends, which is the opposite of the point.
      'X-Accel-Buffering': 'no',
    },
  });
}
