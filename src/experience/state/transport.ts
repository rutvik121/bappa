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

export const usingRealtime = Boolean(SUPABASE_URL && SUPABASE_ANON);

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

function realtimeTransport(h: TransportHandlers): Transport {
  let closed = false;
  let cleanup: (() => void) | null = null;

  void (async () => {
    // Loaded only on the path that uses it, so a deploy without Supabase
    // never ships the client to a visitor.
    const { createClient } = await import('@supabase/supabase-js');
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
        if (status === 'SUBSCRIBED') {
          h.onStatus('live');
          void catchUp();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          h.onStatus('offline');
        }
      });

    cleanup = () => {
      void db.removeChannel(channel);
    };
  })();

  return {
    close() {
      closed = true;
      cleanup?.();
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
  return usingRealtime ? realtimeTransport(h) : streamTransport(h);
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
