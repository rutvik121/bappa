'use client';

import { create } from 'zustand';

/**
 * The experience is a linear ritual, not a navigable app.
 * Every visual system reads this one enum and nothing else.
 */
export type SceneStateName =
  | 'IDLE'
  | 'CONTRIBUTING'
  | 'UNDERSTANDING'
  | 'TRANSFORMING'
  | 'COMPLETE'
  | 'VISARJAN';

export type ContributionType = 'GRATITUDE' | 'WISH' | 'VIGHNA' | 'PROMISE';

export interface SceneStore {
  state: SceneStateName;
  /** Seconds spent in the current state. Driven by the render loop. */
  elapsed: number;
  /** Selected offering kind, chosen before the user writes anything. */
  type: ContributionType;
  /**
   * The offering the visitor has chosen, while they are choosing and while
   * it happens -- null otherwise. The room answers it very slightly: warmer
   * for gratitude, lighter for a wish, heavier for a vighna, more alive for
   * a promise.
   */
  mood: ContributionType | null;
  /**
   * The raw text NEVER leaves this store, is never rendered back to the
   * screen after submission, and is never persisted or transmitted.
   * It exists only long enough to derive a particle seed from it.
   */
  draft: string;

  setState: (next: SceneStateName) => void;
  tick: (dt: number) => void;
  /** Scrubs the current state's clock. Development only. */
  setElapsed: (seconds: number) => void;
  setType: (t: ContributionType) => void;
  setMood: (m: ContributionType | null) => void;
  setDraft: (s: string) => void;
  /** Consumes the draft: returns a seed, then wipes the text. */
  consumeDraft: () => { seed: number; weight: number };
  reset: () => void;
}

/**
 * Deterministic 32-bit hash. Turns the private text into a number that
 * shapes the particle burst, so a contribution feels personal without
 * the words themselves ever being recoverable.
 */
function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export const useScene = create<SceneStore>((set, get) => ({
  state: 'IDLE',
  elapsed: 0,
  type: 'GRATITUDE',
  mood: null,
  draft: '',

  // Back at rest, the room lets go of whatever was chosen.
  setState: (next) =>
    set(next === 'IDLE' ? { state: next, elapsed: 0, mood: null } : { state: next, elapsed: 0 }),
  tick: (dt) => set((s) => ({ elapsed: s.elapsed + dt })),
  setElapsed: (elapsed) => set({ elapsed }),
  setType: (t) => set({ type: t }),
  setMood: (m) => set({ mood: m }),
  setDraft: (s) => set({ draft: s }),

  consumeDraft: () => {
    const { draft } = get();
    const seed = hashText(draft);
    // Longer offerings carry slightly more material, within tight bounds.
    const weight = Math.min(1, 0.35 + draft.trim().length / 420);
    set({ draft: '' });
    return { seed, weight };
  },

  reset: () => set({ state: 'IDLE', elapsed: 0, draft: '', mood: null }),
}));

/** Non-reactive read for use inside the render loop (avoids re-renders). */
export const sceneSnapshot = () => useScene.getState();
