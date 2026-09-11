'use client';

import { create } from 'zustand';

/**
 * Development controls.
 *
 * The piece runs on timescales that are deliberately hostile to
 * iteration: a sixteen-second transformation, a sixty-six-second
 * visarjan, and a ten-day clock. Without a way to jump around inside
 * those, every change costs minutes to see.
 *
 * None of this is part of the experience. It is gated out of production
 * builds entirely, and the panel that uses it is dynamically imported so
 * its code is never fetched by a visitor.
 */

export function devToolsEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  // Opt-in for staging or a live demo, off by default.
  return process.env.NEXT_PUBLIC_BAPPA_DEV === '1';
}

/**
 * Frame stats live outside the store on purpose: they update every frame,
 * and pushing them through React state would re-render the panel sixty
 * times a second to display them. The panel polls this instead.
 */
export const devStats = {
  fps: 0,
  particles: 0,
  tier: '',
};

interface DevStore {
  open: boolean;
  /**
   * Multiplies the delta fed to the ritual clock. Particle physics stay
   * real-time -- only the sequencing is sped up, which is what makes a
   * 4x visarjan still look like a visarjan rather than a fast-forward.
   */
  timeScale: number;
  toggle: () => void;
  setTimeScale: (v: number) => void;
}

export const useDev = create<DevStore>((set) => ({
  open: false,
  timeScale: 1,
  toggle: () => set((s) => ({ open: !s.open })),
  setTimeScale: (timeScale) => set({ timeScale }),
}));

/** Non-reactive read for the render loop. */
export const devTimeScale = () => (devToolsEnabled() ? useDev.getState().timeScale : 1);
