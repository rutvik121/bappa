'use client';

import { create } from 'zustand';
import {
  formationFrom,
  type BappaSnapshot,
  type CollectiveEvent,
  type OfferingEvent,
  type OfferingType,
} from '@/shared/collective';
import { setServerTime } from './festival';

/**
 * One Bappa, many people.
 *
 * This browser holds no opinion about how built he is. It is told -- by
 * /api/offerings when it arrives and whenever it resynchronises, and by
 * /api/stream while it is watching. Everything here is either a copy of
 * what the server said or a decision about how to *present* it, and those
 * two are kept deliberately apart:
 *
 *   offeringsCount    what the server says has been left with him
 *   presentedCount    how many of those this browser has finished showing
 *
 * They are not the same number and are not meant to be. Five offerings
 * arriving together are shown one at a time; the tally is already five
 * ahead while the third is still travelling.
 *
 * Only a type, an intensity and a seed ever leave this browser. The words
 * are sampled into particles here and wiped in the same breath.
 */

export const TARGET_OFFERINGS = Number(process.env.NEXT_PUBLIC_BAPPA_TARGET ?? 1008);

const FESTIVAL_DAYS = 10;

/**
 * Whether this device has ever left something with him. A single flag --
 * never the text, never the kind -- read only to say, at the very end,
 * that what they left went with him.
 */
const LEFT_KEY = 'bappa.left';

export function hasLeftSomething(): boolean {
  try {
    return localStorage.getItem(LEFT_KEY) === '1';
  } catch {
    return false;
  }
}

export type Connection = 'connecting' | 'live' | 'offline';

interface CollectiveStore {
  /** The canonical state, as last told to us. */
  snapshot: BappaSnapshot | null;
  count: number;
  /** 0..1, the server's number. Never computed here. */
  build: number;
  ready: boolean;
  connection: Connection;

  /** Offerings seen but not yet shown, oldest first. */
  queue: OfferingEvent[];
  presentedCount: number;

  init: () => void;
  stop: () => void;
  /** Takes the next offering to present, or null if there is nothing. */
  takeNext: () => OfferingEvent | null;
  /** Development only. */
  setCount: (n: number) => Promise<void>;
  record: () => Promise<void>;
}

/** Offerings this browser submitted, so they are not shown twice. */
const own = new Set<string>();

let stream: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

export const useCollective = create<CollectiveStore>((set, get) => ({
  snapshot: null,
  count: 0,
  build: formationFrom(1, 0, TARGET_OFFERINGS, FESTIVAL_DAYS),
  ready: false,
  connection: 'connecting',

  queue: [],
  presentedCount: 0,

  init: () => {
    if (stream) return;
    connect(set, get);
  },

  stop: () => {
    stream?.close();
    stream = null;
    if (retry) clearTimeout(retry);
    retry = null;
  },

  takeNext: () => {
    const [next, ...rest] = get().queue;
    if (!next) return null;
    set((s) => ({ queue: rest, presentedCount: s.presentedCount + 1 }));
    return next;
  },

  setCount: async (n) => {
    // Development only; the route refuses this in production.
    try {
      await fetch('/api/dev/offerings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: n }),
      });
    } catch {
      // The panel simply will not move the tally.
    }
  },

  record: async () => {
    await submitOffering('GRATITUDE', 0.5, Math.floor(Math.random() * 2 ** 31));
  },
}));

/**
 * A handle on the collective for the development panel and for driving
 * the two-window tests from outside the page. Never present in a
 * production bundle.
 */
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __bappa?: unknown }).__bappa = useCollective;
}

/* ------------------------------------------------------------------ */
/* Talking to the server                                               */
/* ------------------------------------------------------------------ */

type Set = (partial: Partial<CollectiveStore> | ((s: CollectiveStore) => Partial<CollectiveStore>)) => void;
type Get = () => CollectiveStore;

function applySnapshot(set: Set, snapshot: BappaSnapshot) {
  // The countdown ticks locally between snapshots; this is what keeps it
  // ticking from the server's clock rather than from this device's.
  setServerTime(snapshot.now);
  set({
    snapshot,
    count: snapshot.offeringsCount,
    build: snapshot.formationProgress,
    ready: true,
    connection: 'live',
  });
}

function connect(set: Set, get: Get) {
  // The cursor rides on the connection so a reconnect resumes rather than
  // replays; EventSource sends it back as Last-Event-ID by itself, and the
  // query parameter covers the first connection.
  const since = get().snapshot?.seq ?? 0;
  const source = new EventSource(`/api/stream?since=${since}`);
  stream = source;

  source.addEventListener('snapshot', (e) => {
    const snapshot = parse<BappaSnapshot>((e as MessageEvent).data);
    if (!snapshot) return;
    applySnapshot(set, snapshot);
  });

  source.addEventListener('collective', (e) => {
    const event = parse<CollectiveEvent>((e as MessageEvent).data);
    if (!event) return;
    handle(set, get, event);
  });

  source.onopen = () => set({ connection: 'live' });

  source.onerror = () => {
    // EventSource reconnects by itself, but only while the response was a
    // stream. A hard failure needs its own retry, and either way the
    // scene must not change: he simply stops receiving news for a moment.
    set({ connection: get().ready ? 'offline' : 'connecting' });
    if (source.readyState === EventSource.CLOSED) {
      stream = null;
      if (retry) clearTimeout(retry);
      // On the way back, take a fresh snapshot rather than continuing from
      // a local state that may be minutes stale.
      retry = setTimeout(() => void resync(set, get), 4000);
    }
  };
}

async function resync(set: Set, get: Get) {
  try {
    const r = await fetch('/api/offerings', { cache: 'no-store' });
    if (r.ok) applySnapshot(set, (await r.json()) as BappaSnapshot);
  } catch {
    set({ connection: 'offline' });
  }
  if (!stream) connect(set, get);
}

function handle(set: Set, get: Get, event: CollectiveEvent) {
  switch (event.kind) {
    case 'OFFERING_RECEIVED': {
      const { offering } = event;
      // The tally is the server's, and it moves the moment we hear about
      // it -- even though the offering itself may not be shown for a
      // while yet. State and presentation are not the same clock.
      //
      // Set, not incremented: the event carries the count it produced, so
      // a missed or repeated event cannot drift this browser's idea of
      // how many people have been here.
      set({ count: event.offeringsCount, build: event.formationProgress });

      // Ours: already on screen, carrying the words it was made from.
      if (own.has(offering.id)) {
        own.delete(offering.id);
        set((s) => ({ presentedCount: s.presentedCount + 1 }));
        return;
      }

      set((s) => ({ queue: [...s.queue, offering] }));
      return;
    }

    case 'BAPPA_FORMATION_UPDATED':
      set({ count: event.offeringsCount, build: event.formationProgress });
      return;

    case 'VISARJAN_STARTED':
    case 'VISARJAN_COMPLETE':
      // The scene's own festival clock drives the dissolve; this is here
      // so the lifecycle is on the wire for when it stops being local.
      void resync(set, get);
      return;
  }
}

/**
 * Leave something with him.
 *
 * The id is generated here and reused on every retry of the same
 * submission, which is what makes a double click, a refresh mid-send or a
 * network retry land as one offering rather than three.
 */
export async function submitOffering(
  type: OfferingType,
  intensity: number,
  seed: number
): Promise<{ ok: boolean; reason?: string }> {
  const submissionId = newId();
  own.add(submissionId);

  try {
    localStorage.setItem(LEFT_KEY, '1');
  } catch {
    // Private mode: the ending simply will not mention it.
  }

  try {
    const r = await fetch('/api/offerings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, type, intensity, seed }),
    });

    const body = (await r.json()) as
      | { ok: true; offering: OfferingEvent; snapshot: BappaSnapshot }
      | { ok: false; reason: string; snapshot: BappaSnapshot };

    // Even a refusal carries the current state, so a throttled or late
    // visitor still sees Bappa exactly as everyone else does.
    if (body.snapshot) {
      useCollective.setState({
        snapshot: body.snapshot,
        count: body.snapshot.offeringsCount,
        build: body.snapshot.formationProgress,
        ready: true,
      });
    }

    if (!body.ok) {
      // A duplicate is our own first attempt still working: the offering
      // is coming, so it stays claimed and is not shown a second time
      // when it arrives down the stream.
      if (body.reason !== 'duplicate') own.delete(submissionId);
      return { ok: false, reason: body.reason };
    }

    return { ok: true };
  } catch {
    // The connection dropped. His own animation still plays -- it is
    // already underway and it is theirs -- but nothing is invented in the
    // shared tally, which would be a contribution that never existed.
    own.delete(submissionId);
    return { ok: false, reason: 'offline' };
  }
}

function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
