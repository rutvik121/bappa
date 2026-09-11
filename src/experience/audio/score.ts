'use client';

import type { AssetName } from './assets';
import type { ContributionKind } from './events';
import { BELL_LINE, FAREWELL_LINES } from '../ui/farewell';

/**
 * The score.
 *
 * Every level, curve and timing in the sound of BAPPA, and nothing else.
 * AudioManager decides how a sound is made; this file decides which sound,
 * how loud, when, and how it moves.
 *
 * Tanpura and bansuri in the room and the pandal outside. Each offering
 * approaches in its own way -- marigold petals, a bansuri rising, a heavy
 * dhol and a coconut broken, a diya lit -- and every one of them is
 * received the same way: a touch on dry clay, and the clay body answering.
 * Visarjan gets quieter as he goes, never louder.
 *
 * Levels are dB relative to each asset's normalisation -- loops sit at RMS
 * -20 dBFS, one-shots peak at -1.
 */

/** dB to gain. Anything at or below -80 is silence, not a whisper. */
export const dB = (v: number) => (v <= -80 ? 0 : Math.pow(10, v / 20));

export type Curve = ReadonlyArray<readonly [number, number]>;

/** Piecewise-linear read of a curve, clamped at both ends. */
export function sample(curve: Curve, x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
  }
  return curve[curve.length - 1][1];
}

/* ------------------------------------------------------------------ */
/* the space                                                           */
/* ------------------------------------------------------------------ */

export const MASTER = {
  gainDb: -1,
  /** Nothing below this is useful on any speaker, and it eats headroom. */
  highpass: 32,
  airShelfDb: -1.5,
  reverbDb: -4,
  /** Keeps low end out of the reverb, where it turns to mud. */
  reverbHighpass: 180,
  reverbSeconds: 3.4,
  reverbSecondsLow: 2.2,
  preDelay: 0.024,
  /** RT60 per band, a stone temple hall. */
  decay: { low: 3.2, mid: 2.4, high: 1.2 },
} as const;

export const SPACE = {
  /** Tanpura and bansuri: present, never in front. */
  musicDb: -16,
  /** The pandal outside at night: crickets, a far crowd, a far bell. */
  pandalDb: -24,
  /** Arriving: a moment of silence, then the room. */
  musicDelay: 0.6,
  musicTau: 2.5,
  pandalDelay: 0.2,
  pandalTau: 2,
  /** One distant ghanta a few seconds in: someone is here, and so is he. */
  welcomeAt: 3,
  welcomeDb: -30,
  /** The music steps back while an offering is happening. */
  duckDb: -8,
  /** How far the pandal ambience wanders, so it never sits still. */
  wanderDb: 2.5,
  wanderGap: [8, 15] as const,
  /** The pandal breathes in as the camera moves. */
  shiftDb: 3,
} as const;

/* ------------------------------------------------------------------ */
/* offerings: the approach                                             */
/* ------------------------------------------------------------------ */

type Stages = { transform: number; travel: number };

export interface OfferingSound {
  /** Heard as the words condense out of the dark. */
  gather: readonly AssetName[];
  gatherDb: number;
  /** Heard as the words let go (wish: the bansuri rises with them). */
  release: AssetName | null;
  releaseDb: number;
  /** Sustained layer steered by the material's motion in flight. */
  carrier: AssetName | null;
  carrierDb: Stages;
  /** Travelling speed at which the offering is at its most present. */
  speedRef: number;
  wet: number;
}

export const OFFERING: Record<ContributionKind, OfferingSound> = {
  // Soft, warm, gathering: marigold petals on a thali.
  GRATITUDE: {
    gather: ['marigold-petals'],
    gatherDb: -15,
    release: null,
    releaseDb: -80,
    carrier: null,
    carrierDb: { transform: -80, travel: -80 },
    speedRef: 0.6,
    wet: 0.22,
  },
  // Light and upward: ghungroo, and a bansuri phrase rising with it.
  WISH: {
    gather: ['ghungroo'],
    gatherDb: -17,
    release: 'bansuri-rise',
    releaseDb: -20,
    carrier: null,
    carrierDb: { transform: -80, travel: -80 },
    speedRef: 0.8,
    wet: 0.32,
  },
  // Heavy and resistant: dhol knocks, a low roll, a coconut broken.
  VIGHNA: {
    gather: ['dhol-knock-1', 'dhol-knock-2', 'dhol-knock-3'],
    gatherDb: -16,
    release: null,
    releaseDb: -80,
    carrier: 'dhol-roll',
    carrierDb: { transform: -21, travel: -18 },
    speedRef: 1.1,
    wet: 0.18,
  },
  // Organic and growing: a diya lit, a tabla heartbeat.
  PROMISE: {
    gather: ['diya-light'],
    gatherDb: -17,
    release: null,
    releaseDb: -80,
    carrier: 'tabla-pulse',
    carrierDb: { transform: -23, travel: -19 },
    speedRef: 0.6,
    wet: 0.24,
  },
};

/** Vighna only. */
export const BREAK = {
  coconutDb: -15,
  /** Knocks per second while the obstacle is still heavy and moving. */
  knockRate: 3,
} as const;

/* ------------------------------------------------------------------ */
/* Bappa received it                                                   */
/* ------------------------------------------------------------------ */

/**
 * The same for all four offerings, because what they become is the same.
 *
 * approach → a tiny tactile touch on the frame of contact → the clay body
 * answering, warm and low, from inside the material → decay → silence.
 * Not a bell, not a whoosh, not an impact: terracotta receiving something.
 */
export const RECEIVE = {
  touch: ['clay-touch-1', 'clay-touch-2', 'clay-touch-3'] as const,
  touchDb: -15,
  resonance: ['ghatam-1', 'ghatam-2', 'ghatam-3'] as const,
  resonanceDb: -12,
  /** The body answers a few milliseconds after the skin is touched. */
  resonanceDelay: 0.04,
  /** How far the resonance blooms into the hall. */
  wetFrom: 0.08,
  wetTo: 0.3,
  /** A little fuller, and a little further, as he is built. */
  richnessDb: 2.5,
  /** A resonance still ringing is let go this fast when the next one comes. */
  stealTau: 0.35,
  /** The rest of the offering entering him: sparse, tiny touches. */
  arrivalDb: -27,
  /** Touches per second per share-of-the-offering-per-second arriving. */
  arrivalRate: 5,
  arrivalMax: 4,
} as const;

/* ------------------------------------------------------------------ */
/* Visarjan                                                            */
/* ------------------------------------------------------------------ */

/**
 * Curves over dissolve (0 whole, 1 the last clay gone, 1.34 the last grain
 * of light gone). Every one of them only falls once he starts to go: the
 * sound of Visarjan is the sound being taken away.
 */
export const VISARJAN = {
  /** Stage 1: the music stops for the stillness. */
  musicTau: 0.8,
  /** The pandal, low, leaving with him. */
  pandalTrim: [[0, -14], [0.5, -18], [0.86, -22], [1.2, -30], [1.3, -40], [1.335, -80]] as Curve,

  /**
   * A procession very far away -- dhol and tasha heard across the city --
   * that never comes closer and only recedes.
   */
  dholDb: [[0, -80], [0.004, -44], [0.12, -31], [0.35, -32], [0.86, -37], [1.1, -45], [1.3, -58], [1.335, -80]] as Curve,
  dholCutoff: [[0, 2400], [0.5, 1900], [0.86, 1300], [1.3, 650]] as Curve,
  dholWet: [[0, 0.45], [0.86, 0.6], [1.3, 0.85]] as Curve,

  /** Material movement, then clay coming away: the foreground of the loss. */
  crumbleDb: [[0, -80], [0.04, -32], [0.3, -21], [0.6, -25], [0.86, -34], [1.0, -80]] as Curve,

  /** As particles leave: tiny touches, further and further apart. */
  touchRate: [[0.6, 0], [0.8, 1.6], [1.05, 0.9], [1.25, 0.3], [1.33, 0]] as Curve,
  touchDb: -32,

  /** Gulal on the air as he lets go of his shape. Barely there. */
  gulalDb: -23,
} as const;

/* ------------------------------------------------------------------ */
/* the end                                                             */
/* ------------------------------------------------------------------ */

export const FINAL = {
  /** One shankh, impossibly far away. */
  shankhDb: -22,
  /** Seconds after the words begin: as the chant starts to appear. */
  shankhAt: (FAREWELL_LINES[BELL_LINE].at + 700) / 1000,
  /** How long it is allowed to ring before the context is released. */
  tail: 13,
} as const;
