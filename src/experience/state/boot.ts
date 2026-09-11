'use client';

import { create } from 'zustand';

/**
 * Arrival.
 *
 * The page paints its words before any of the 3D has loaded; this store is
 * how the rest of the interface learns when Bappa himself is actually
 * there to be seen -- and when he cannot be, so the words can say so
 * instead of leaving a visitor in front of an empty black screen.
 */

export type BootFailure =
  /** This browser or device cannot draw him at all. */
  | 'webgl'
  /** The sculpture did not arrive: a dropped connection, a failed load. */
  | 'load';

interface BootStore {
  /** performance.now() at the moment the sculpture was ready, or null. */
  modelAt: number | null;
  failed: BootFailure | null;
  setModelReady: () => void;
  fail: (f: BootFailure) => void;
}

export const useBoot = create<BootStore>((set, get) => ({
  modelAt: null,
  failed: null,
  setModelReady: () => {
    if (get().modelAt === null) set({ modelAt: performance.now() });
  },
  fail: (f) => set((s) => (s.failed ? s : { failed: f })),
}));

/** Seconds for the light to find him once he has arrived. */
export const REVEAL_SECONDS = 2.8;

/** 0 before he has loaded, easing to 1 as the light comes up on him. */
export function revealAmount(now = performance.now()): number {
  const at = useBoot.getState().modelAt;
  if (at === null) return 0;
  const k = Math.min(1, Math.max(0, (now - at) / 1000 / REVEAL_SECONDS));
  return k * k * (3 - 2 * k);
}
