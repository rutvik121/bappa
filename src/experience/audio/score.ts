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
 * The sound world is a Ganeshotsav one: tanpura and bansuri in the room,
 * a pandal at night outside it, marigold petals and akshata, ghanti and
 * ghanta, dhol and tasha, a shankh. Every offering is heard as something a
 * person would recognise from a puja; all of them resolve into the same
 * temple bell; and Visarjan is a dhol-tasha procession that recedes into
 * the distance as he goes.
 *
 * Levels are dB relative to each asset's normalisation -- loops sit at RMS
 * -20 dBFS, one-shots peak at -1 -- so the music's -16 puts it near
 * -32 dBFS in the mix. Measured from offline renders (/dev/sound): offering
 * sounds peak around -12 to -15, the ghanta around -14, the procession
 * around -11, the final shankh around -15.
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
  /** Keeps the dhol's low end out of the reverb, where it turns to mud. */
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
  duckDb: -7,
  /** How far the pandal ambience wanders, so it never sits still. */
  wanderDb: 2.5,
  wanderGap: [8, 15] as const,
  /** The pandal breathes in as the camera moves. */
  shiftDb: 3,
} as const;

/* ------------------------------------------------------------------ */
/* offerings                                                           */
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
  /** The moment it enters him. */
  contact: AssetName;
  contactDb: number;
  /** How far the contact blooms into the hall. */
  contactWet: number;
  /** Travelling speed at which the offering is at its most present. */
  speedRef: number;
  wet: number;
}

export const OFFERING: Record<ContributionKind, OfferingSound> = {
  // Warm and intimate: marigold petals on a thali, a small ghanti.
  GRATITUDE: {
    gather: ['marigold-petals'],
    gatherDb: -15,
    release: null,
    releaseDb: -80,
    carrier: null,
    carrierDb: { transform: -80, travel: -80 },
    contact: 'ghanti',
    contactDb: -10,
    contactWet: 0.3,
    speedRef: 0.6,
    wet: 0.22,
  },
  // Hope: ghungroo, a bansuri phrase rising with the particles, a high bell.
  // The bansuri is dense and sustained, so it sits well under its bell.
  WISH: {
    gather: ['ghungroo'],
    gatherDb: -16,
    release: 'bansuri-rise',
    releaseDb: -19,
    carrier: null,
    carrierDb: { transform: -80, travel: -80 },
    contact: 'bell-high',
    contactDb: -12,
    contactWet: 0.36,
    speedRef: 0.8,
    wet: 0.32,
  },
  // Resistance: heavy dhol, a coconut broken as an offering, a dhol boom.
  // The break and the boom land within a fifth of a second of each other,
  // so each is kept a little lower than it would be alone.
  VIGHNA: {
    gather: ['dhol-knock-1', 'dhol-knock-2', 'dhol-knock-3'],
    gatherDb: -15,
    release: null,
    releaseDb: -80,
    carrier: 'dhol-roll',
    carrierDb: { transform: -20, travel: -17 },
    contact: 'dhol-boom',
    contactDb: -13,
    contactWet: 0.2,
    speedRef: 1.1,
    wet: 0.18,
  },
  // Something begun: a diya lit, a tabla heartbeat, a short shankh.
  PROMISE: {
    gather: ['diya-light'],
    gatherDb: -17,
    release: null,
    releaseDb: -80,
    carrier: 'tabla-pulse',
    carrierDb: { transform: -22, travel: -18 },
    contact: 'shankh-short',
    contactDb: -17,
    contactWet: 0.3,
    speedRef: 0.6,
    wet: 0.24,
  },
};

/** Vighna only. */
export const BREAK = {
  coconutDb: -14,
  /** Knocks per second while the obstacle is still heavy and moving. */
  knockRate: 3,
} as const;

/** Akshata falling on the thali: the sound of material entering him. */
export const ABSORB = {
  riceDb: -18,
  /** Arrival rate (share of the offering per second) heard at full level. */
  fullShare: 0.9,
  wet: 0.3,
} as const;

/* ------------------------------------------------------------------ */
/* Bappa                                                               */
/* ------------------------------------------------------------------ */

export const BAPPA = {
  /** The temple ghanta every offering resolves into. */
  ghantaDb: -14,
  ghantaWet: 0.34,
  /** The ghanta grows this much fuller, and rings further, as he is built. */
  richnessDb: 3,
  richnessWet: 0.12,
  /** A ghanta still ringing is let go this fast when the next one comes. */
  stealTau: 0.35,
} as const;

/* ------------------------------------------------------------------ */
/* Visarjan                                                            */
/* ------------------------------------------------------------------ */

/**
 * Curves over dissolve (0 whole, 1 the last clay gone, 1.34 the last grain
 * of light gone), so the procession moves exactly as he does.
 */
export const VISARJAN = {
  /** Stage 1: the music stops for the stillness. */
  musicTau: 0.8,
  /** The pandal stays, low, until he has gone. */
  pandalTrim: [[0, -12], [0.86, -14], [1.2, -24], [1.3, -34], [1.335, -80]] as Curve,

  /** The dhol-tasha pathak arrives with the first release and carries him. */
  dholDb: [
    [0, -80], [0.005, -34], [0.15, -14], [0.5, -13], [0.86, -13], [1.0, -18], [1.16, -25], [1.3, -40], [1.335, -80],
  ] as Curve,
  /** ...and recedes into the distance as the particles drift away. */
  dholCutoff: [[0, 16000], [0.86, 14000], [1.05, 5000], [1.2, 2200], [1.33, 900]] as Curve,
  dholWet: [[0, 0.08], [0.86, 0.12], [1.2, 0.45], [1.33, 0.7]] as Curve,

  /** Clay coming away from the murti through the breakdown. */
  crumbleDb: [[0, -80], [0.06, -30], [0.35, -22], [0.7, -26], [0.86, -80]] as Curve,

  /** Gulal thrown as the particle Bappa lets go. */
  gulalDb: -14,
} as const;

/* ------------------------------------------------------------------ */
/* the end                                                             */
/* ------------------------------------------------------------------ */

export const FINAL = {
  /** One shankh, far away across the water. */
  shankhDb: -16,
  /** Seconds after the words begin: as GANPATI BAPPA MORYA starts to appear. */
  shankhAt: (FAREWELL_LINES[BELL_LINE].at + 700) / 1000,
  /** How long it is allowed to ring before the context is released. */
  tail: 13,
} as const;
