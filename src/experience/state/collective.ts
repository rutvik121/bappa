'use client';

import { create } from 'zustand';

/**
 * How much of Bappa exists.
 *
 * He is not delivered whole. He begins as a line -- a drawing of a
 * murti, nothing more -- and the offerings people leave are what give
 * him body. The count below is the only thing that decides how much of
 * the sculpture has materialised.
 *
 * Only the NUMBER of offerings ever crosses this boundary. No text, no
 * type, no identity: the collective is a tally, which is precisely what
 * makes it safe to share.
 */

/** Offerings needed to complete him. Auspicious, and configurable. */
export const TARGET_OFFERINGS = Number(
  process.env.NEXT_PUBLIC_BAPPA_TARGET ?? 1008
);

/**
 * Maps the tally to how built he is.
 *
 * Deliberately not linear. Against a target in the thousands a linear
 * map makes a single offering worth a tenth of a percent -- invisible,
 * which would tell every early visitor that they did not matter. The
 * curve front-loads visible change so the first hundred people watch him
 * take shape, and leaves a long tail so the last ones still have
 * something to complete.
 */
export function buildFromCount(count: number): number {
  if (count <= 0) return 0;
  return Math.min(1, Math.pow(count / TARGET_OFFERINGS, 0.6));
}

/**
 * Where the tally lives.
 *
 * This is the seam for the backend. The local implementation below keeps
 * the count in this browser, which is enough to build and preview the
 * whole experience but is NOT the collaborative product: for that, every
 * visitor has to read and increment one shared number. Swap this for a
 * server-backed source and nothing else in the scene changes.
 */
export interface CollectiveSource {
  load(): Promise<number>;
  add(): Promise<number>;
  /** Optional; used only by the development panel. */
  set?(n: number): Promise<number>;
}

const STORAGE_KEY = 'bappa.offerings';

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

export const localSource: CollectiveSource = {
  async load() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  },
  async set(n: number) {
    try {
      localStorage.setItem(STORAGE_KEY, String(n));
      return n;
    } catch {
      return n;
    }
  },
  async add() {
    try {
      const next = (Number(localStorage.getItem(STORAGE_KEY) ?? 0) || 0) + 1;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    } catch {
      return 0;
    }
  },
};

/**
 * The shared tally, held by /api/offerings. This is the collaborative
 * product: one number that every visitor reads and adds to, so the Bappa
 * you arrive at is the one everyone before you built.
 *
 * A throttled add still returns the true count, so a rate-limited visitor
 * sees Bappa exactly as everyone else does.
 */
export const remoteSource: CollectiveSource = {
  async load() {
    const r = await fetch('/api/offerings', { cache: 'no-store' });
    const d = (await r.json()) as { count: number };
    return d.count;
  },
  async add() {
    const r = await fetch('/api/offerings', { method: 'POST' });
    const d = (await r.json()) as { count: number };
    return d.count;
  },
};

interface CollectiveStore {
  count: number;
  /** 0..1 target; the model eases toward this rather than snapping. */
  build: number;
  ready: boolean;
  init: (source?: CollectiveSource) => Promise<void>;
  record: () => Promise<void>;
  setCount: (n: number) => Promise<void>;
}

let source: CollectiveSource = localSource;

export const useCollective = create<CollectiveStore>((set) => ({
  count: 0,
  build: 0,
  ready: false,

  init: async (s) => {
    if (s) {
      source = s;
      const count = await source.load();
      set({ count, build: buildFromCount(count), ready: true });
      return;
    }

    // Ask the server whether a shared store is actually configured. It
    // answers with the count and with `shared`, so the common case costs
    // one round trip and an unconfigured deploy degrades to counting
    // locally instead of reporting zero offerings forever.
    try {
      const r = await fetch('/api/offerings', { cache: 'no-store' });
      if (r.ok) {
        const d = (await r.json()) as { count: number; shared: boolean };
        if (d.shared) {
          source = remoteSource;
          set({ count: d.count, build: buildFromCount(d.count), ready: true });
          return;
        }
      }
    } catch {
      // Offline, or no route: fall through to the local tally.
    }

    source = localSource;
    const count = await source.load();
    set({ count, build: buildFromCount(count), ready: true });
  },

  record: async () => {
    try {
      localStorage.setItem(LEFT_KEY, '1');
    } catch {
      // Private mode: the ending simply will not mention it.
    }
    try {
      const count = await source.add();
      set({ count, build: buildFromCount(count) });
    } catch {
      // The connection dropped. The offering still happened here, and he
      // still takes it in; the shared tally catches up on the next visit.
      set((s) => ({ count: s.count + 1, build: buildFromCount(s.count + 1) }));
    }
  },

  setCount: async (n) => {
    const count = source.set ? await source.set(n) : n;
    set({ count, build: buildFromCount(count) });
  },

}));

