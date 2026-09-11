import { NextResponse, type NextRequest } from 'next/server';

/**
 * The shared tally.
 *
 * One number, held for everyone: how many offerings have been left with
 * Bappa. It is the only thing that decides how much of him exists, and
 * the only thing that ever crosses from a visitor's browser to the
 * server. No text, no type, no identity -- which is exactly what makes a
 * shared counter safe to run at all.
 *
 * Spoken to over Upstash's REST protocol with plain `fetch`, so this
 * works with a Vercel KV store or a standalone Upstash one and pulls in
 * no dependency for it.
 */

const KEY = 'bappa:offerings';

/**
 * Offerings one address can leave per window. Bappa is built by a crowd;
 * without this, one person with a loop could finish him in a minute and
 * take that from everyone else.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 3600;

/** Counter reads must never be cached -- the whole point is that it moves. */
export const dynamic = 'force-dynamic';

interface Store {
  url: string;
  token: string;
}

/**
 * Vercel KV and the Upstash integration expose the same store under
 * different variable names depending on how it was provisioned.
 */
function getStore(): Store | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redis(store: Store, ...command: string[]): Promise<unknown> {
  const path = command.map(encodeURIComponent).join('/');
  const res = await fetch(`${store.url}/${path}`, {
    headers: { Authorization: `Bearer ${store.token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const body = (await res.json()) as { result?: unknown };
  return body.result;
}

const toCount = (v: unknown) => Number(v ?? 0) || 0;

/**
 * `shared: false` is an honest signal, not an error: it tells the client
 * no store is configured, so it should fall back to counting locally
 * rather than silently reporting zero offerings forever.
 */
export async function GET() {
  const store = getStore();
  if (!store) return NextResponse.json({ count: 0, shared: false });

  try {
    return NextResponse.json({ count: toCount(await redis(store, 'get', KEY)), shared: true });
  } catch {
    return NextResponse.json({ count: 0, shared: false });
  }
}

export async function POST(req: NextRequest) {
  const store = getStore();
  if (!store) return NextResponse.json({ count: 0, shared: false });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  try {
    const rateKey = `bappa:rate:${ip}`;
    const used = toCount(await redis(store, 'incr', rateKey));
    // Set the expiry on first use, so the window slides from the first
    // offering rather than being refreshed by every one after it.
    if (used === 1) await redis(store, 'expire', rateKey, String(RATE_WINDOW_SECONDS));

    if (used > RATE_LIMIT) {
      // Still return the true count: a throttled visitor should see Bappa
      // exactly as everyone else does, just without having added to him.
      return NextResponse.json(
        { count: toCount(await redis(store, 'get', KEY)), shared: true, throttled: true },
        { status: 429 }
      );
    }

    return NextResponse.json({ count: toCount(await redis(store, 'incr', KEY)), shared: true });
  } catch {
    return NextResponse.json({ count: 0, shared: false });
  }
}
