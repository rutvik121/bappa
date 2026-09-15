'use client';

import {
  formationFrom,
  type BappaSnapshot,
  type CollectiveEvent,
  type OfferingType,
} from '@/shared/collective';

/**
 * How this browser hears that something happened to Bappa.
 *
 * Two ways in, chosen by what is configured, behind one small interface.
 *
 * Supabase realtime is the one that matters. The browser holds a socket
 * to Supabase and is pushed each new offering, so a person watching him
 * quietly costs nothing at all. What it replaced polled a store once a
 * second per viewer through a serverless function -- work that scaled
 * with the number of people looking rather than with the number of
 * offerings, which is the wrong way round for a piece that invites you to
 * sit and watch.
 *
 * The stream is the fallback, and it is what `next dev` uses with no
 * account anywhere. It is the same SSE endpoint as before.
 *
 * Neither knows anything about Bappa. They deliver events; what to do
 * with them is the collective's business.
 */

export interface Transport {
  close(): void;
}

export interface TransportHandlers {
  onSnapshot(s: BappaSnapshot): void;
  onEvent(e: CollectiveEvent): void;
  onStatus(s: 'live' | 'offline'): void;
  /** The sequence this client has already accounted for. */
  cursor(): number;
  /** The last snapshot, for resolving a row to a formation. */
  snapshot(): BappaSnapshot | null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Keys are base64url and dots, and nothing else.
 *
 * A key copied out of the dashboard while it was still masked arrives
 * full of bullet characters, and the only symptom is an opaque websocket
 * handshake failure with the key -- percent-encoded into unreadability --
 * buried in the URL. Caught here so it says what is actually wrong.
 */
const wellFormedKey = (k: string | undefined): boolean =>
  Boolean(k) &&
  /^[A-Za-z0-9._-]+$/.test(k!) &&
  // Either shape Supabase issues: the legacy anon JWT, or a publishable
  // key. The charset above is what actually catches a masked paste.
  (k!.split('.').length === 3 || k!.startsWith('sb_publishable_'));

export const usingRealtime = Boolean(SUPABASE_URL) && wellFormedKey(SUPABASE_ANON);

if (
  process.env.NODE_ENV !== 'production' &&
  SUPABASE_URL &&
  SUPABASE_ANON &&
  !wellFormedKey(SUPABASE_ANON)
) {
  console.error(
    '[bappa] NEXT_PUBLIC_SUPABASE_ANON_KEY is not a valid key. It usually means ' +
      'it was copied from the dashboard while still masked, so it contains bullet ' +
      'characters instead of the key. Reveal it first, then copy. Falling back to ' +
      'the event stream in the meantime.'
  );
}

/** A row as the database publishes it. */
interface Row {
  id: string;
  seq: number | string;
  type: string;
  intensity: number;
  seed: number | string;
  offerings_count: number;
  created_at: string;
}

/**
 * Resolving a published row to an event.
 *
 * Formation is computed rather than carried: it is a function of the
 * tally and the day, and both come from the server -- the tally on the
 * row, the day in the snapshot, along with the curve's own inputs. Same
 * function, same numbers, so every client lands on the same Bappa.
 */
function rowToEvent(row: Row, snap: BappaSnapshot | null): CollectiveEvent {
  const day = snap?.festivalDay ?? 1;
  const target = snap?.offeringTarget ?? 1008;
  const days = snap?.festivalDays ?? 10;
  const count = row.offerings_count;
  const formationProgress = formationFrom(day, count, target, days);

  return {
    kind: 'OFFERING_RECEIVED',
    offering: {
      id: row.id,
      seq: Number(row.seq),
      type: row.type as OfferingType,
      createdAt: new Date(row.created_at).getTime(),
      intensity: Number(row.intensity),
      seed: Number(row.seed),
      formationTarget: formationProgress,
    },
    offeringsCount: count,
    formationProgress,
  };
}

async function snapshotNow(): Promise<BappaSnapshot | null> {
  try {
    const r = await fetch('/api/offerings', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as BappaSnapshot) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Supabase realtime                                                   */
/* ------------------------------------------------------------------ */

const supabaseModulePromise =
  typeof window !== 'undefined' && usingRealtime ? import('@supabase/supabase-js') : null;

/**
 * How long the socket is given to say it is listening before the stream
 * is opened instead. Generous: a slow phone on a bad connection should
 * not be given up on early, but nobody should sit in front of a Bappa
 * that has quietly stopped hearing anything either.
 */
const SUBSCRIBE_GRACE_MS = 20_000;

function realtimeTransport(h: TransportHandlers): Transport {
  let closed = false;
  let cleanup: (() => void) | null = null;
  /** Stands in when the socket cannot be loaded, opened, or kept. */
  let fallback: Transport | null = null;
  let hasSubscribedOnce = false;

  // Fetch the initial snapshot immediately so the UI does not wait on the
  // websocket handshake to display Bappa and the current count.
  void snapshotNow().then((snap) => {
    if (snap && !closed) {
      h.onSnapshot(snap);
    }
  });

  /**
   * Anything that means "this browser is not going to hear about
   * offerings over the socket" ends up here.
   *
   * Realtime is the better transport, not the only one. If it does not
   * come up -- the project has it switched off, a proxy eats websockets,
   * the subscription errors or simply never lands -- the stream still
   * works, because it is the page's own origin over ordinary HTTP.
   */
  const giveUpOnSocket = () => {
    if (closed || fallback || hasSubscribedOnce) return;
    if (process.env.NODE_ENV !== 'production') {
      console.info('[bappa] realtime did not come up after grace period; starting fallback stream');
    }
    h.onStatus('offline');
    fallback = streamTransport(h);
  };

  let grace: ReturnType<typeof setTimeout> | null = setTimeout(giveUpOnSocket, SUBSCRIBE_GRACE_MS);

  void (async () => {
   try {
    // Loaded only on the path that uses it, so a deploy without Supabase
    // never ships the client to a visitor.
    const { createClient } = await (supabaseModulePromise ?? import('@supabase/supabase-js'));
    if (closed) return;

    const db = createClient(SUPABASE_URL!, SUPABASE_ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 4 } },
    });

    /**
     * Anything left with him while this browser was not listening.
     * Bounded: further behind than this and a fresh snapshot is both
     * cheaper and more correct than a replay.
     */
    const catchUp = async () => {
      const snap = await snapshotNow();
      if (!snap || closed) return;

      const from = h.cursor();
      h.onSnapshot(snap);

      if (from > 0 && snap.seq > from && snap.seq - from <= 64) {
        const { data } = await db
          .from('offerings')
          .select('id, seq, type, intensity, seed, offerings_count, created_at')
          .gt('seq', from)
          .order('seq', { ascending: true })
          .limit(64);
        if (closed) return;
        for (const row of (data ?? []) as Row[]) h.onEvent(rowToEvent(row, snap));
      }
    };

    const channel = db
      .channel('bappa-offerings')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'offerings' },
        (payload) => h.onEvent(rowToEvent(payload.new as Row, h.snapshot()))
      )
      .subscribe((status) => {
        if (closed) return;
        if (status === 'SUBSCRIBED') {
          hasSubscribedOnce = true;
          if (grace) {
            clearTimeout(grace);
            grace = null;
          }
          if (fallback) {
            fallback.close();
            fallback = null;
          }
          h.onStatus('live');
          void catchUp();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Recoverable connection states: network glitch, mobile sleep/wake, tab backgrounding.
          // Supabase Realtime client automatically reconnects.
          // DO NOT remove the channel. DO NOT permanently switch to fallback.
          h.onStatus('offline');
        }
      });

    cleanup = () => {
      void db.removeChannel(channel);
    };
   } catch {
    if (grace) {
      clearTimeout(grace);
      grace = null;
    }
    giveUpOnSocket();
   }
  })();

  return {
    close() {
      closed = true;
      if (grace) clearTimeout(grace);
      cleanup?.();
      fallback?.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Server-sent events                                                  */
/* ------------------------------------------------------------------ */

function streamTransport(h: TransportHandlers): Transport {
  let closed = false;
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;

    // The cursor rides on the connection so a reconnect resumes rather
    // than replays; EventSource returns it as Last-Event-ID by itself,
    // and the query parameter covers the first connection.
    const es = new EventSource(`/api/stream?since=${h.cursor()}`);
    source = es;

    es.addEventListener('snapshot', (e) => {
      const s = parse<BappaSnapshot>((e as MessageEvent).data);
      if (s) h.onSnapshot(s);
    });

    es.addEventListener('collective', (e) => {
      const ev = parse<CollectiveEvent>((e as MessageEvent).data);
      if (ev) h.onEvent(ev);
    });

    es.onopen = () => h.onStatus('live');

    es.onerror = () => {
      h.onStatus('offline');
      // EventSource retries by itself while the response was a stream; a
      // hard failure needs its own, and on the way back it takes a fresh
      // snapshot rather than trusting a local state that may be stale.
      if (es.readyState === EventSource.CLOSED) {
        source = null;
        if (retry) clearTimeout(retry);
        retry = setTimeout(async () => {
          const s = await snapshotNow();
          if (s) h.onSnapshot(s);
          open();
        }, 4000);
      }
    };
  };

  open();

  return {
    close() {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
    },
  };
}

/* ------------------------------------------------------------------ */

export function connect(h: TransportHandlers): Transport {
  // Which way this browser is listening is the first thing worth knowing
  // when he stops appearing to hear anything, and it is otherwise
  // invisible. Development only.
  if (process.env.NODE_ENV !== 'production') {
    console.info(
      usingRealtime
        ? '[bappa] listening over supabase realtime'
        : '[bappa] listening over the event stream ' +
            '(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set)'
    );
  }
  return usingRealtime ? realtimeTransport(h) : streamTransport(h);
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
