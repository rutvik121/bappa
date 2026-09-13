/**
 * The contract between the server and the browser.
 *
 * Imported by both, so there is exactly one definition of what an offering
 * is and one formation curve. Keep it pure: no React, no three.js, no
 * `server-only`, nothing that cannot be evaluated on either side.
 *
 * The principle the shapes encode: the server says WHAT HAPPENED, never
 * how to draw it. An offering event is a handful of numbers; every pixel
 * of the animation is the client's business.
 */

export type OfferingType = 'GRATITUDE' | 'WISH' | 'VIGHNA' | 'PROMISE';

export const OFFERING_TYPES: readonly OfferingType[] = [
  'GRATITUDE',
  'WISH',
  'VIGHNA',
  'PROMISE',
];

export function isOfferingType(v: unknown): v is OfferingType {
  return typeof v === 'string' && (OFFERING_TYPES as readonly string[]).includes(v);
}

/**
 * One offering, as everyone else ever learns about it.
 *
 * There is no author here and no text. `seed` is a hash of what was
 * written, which is what lets a contribution look like itself without
 * being readable -- the words cannot be recovered from it, and the server
 * never receives them in the first place.
 */
export interface OfferingEvent {
  id: string;
  seq: number;
  type: OfferingType;
  createdAt: number;
  /** 0..1. How much material it carries. */
  intensity: number;
  /** Shapes the burst. Derived from the text; not reversible to it. */
  seed: number;
  /**
   * Where on him it is headed, as a share of the formation axis. The
   * client resolves this to actual surface points, because only the
   * client has the geometry.
   */
  formationTarget: number;
}

export type RitualState = 'PRE_STHAPANA' | 'BAPPA_PRESENT' | 'POST_VISARJAN';

/** Authoritative Sthapana: September 14, 2026 at 11:16 AM IST */
export const CANONICAL_STHAPANA = '2026-09-14T11:16:00+05:30';
/** Authoritative Visarjan: September 25, 2026 at 18:00 (6:00 PM) IST */
export const CANONICAL_VISARJAN = '2026-09-25T18:00:00+05:30';

export type CollectiveEvent =
  | {
      kind: 'OFFERING_RECEIVED';
      offering: OfferingEvent;
      /**
       * The tally and the formation *after* this offering, stated rather
       * than implied. A client that counted events itself would drift the
       * moment one was missed or replayed; given the absolute numbers it
       * cannot.
       */
      offeringsCount: number;
      formationProgress: number;
    }
  | { kind: 'BAPPA_FORMATION_UPDATED'; formationProgress: number; offeringsCount: number }
  | { kind: 'VISARJAN_STARTED' }
  | { kind: 'VISARJAN_COMPLETE' };

/** What a client is handed when it arrives, and whenever it resynchronises. */
export interface BappaSnapshot {
  lifecycle: string;
  ritualState: RitualState;
  festivalDay: number;
  offeringsCount: number;
  /** 0..1, computed by the server. The client never derives this. */
  formationProgress: number;
  accepting: boolean;
  /** The event sequence this snapshot already accounts for. */
  seq: number;
  /** Server clock, so a client can anchor its countdown to it. */
  now: number;
  startsAt: number;
  endsAt: number;
  /** False when no shared store is configured (development). */
  shared: boolean;

  /**
   * The curve's own inputs, so a client resolving a realtime row to a
   * formation gets exactly the number the server would have got. Sent
   * rather than compiled in: a client and a server disagreeing about the
   * target is a client and a server disagreeing about Bappa.
   */
  offeringTarget: number;
  festivalDays: number;
}

/* ------------------------------------------------------------------ */
/* The formation curve                                                */
/* ------------------------------------------------------------------ */

/**
 * Where he starts: begun, not finished. Mirrors the client's own floor --
 * see state/formation.ts for why it is not lower.
 */
export const FORMATION_FLOOR = 0.60;

/**
 * How completely he has formed, 0..1.
 *
 * The calendar guarantees he is whole by the last day; the offerings get
 * him there sooner and fuller in the meantime. Each accepted offering
 * permanently advances formation progress. At target offerings, Bappa
 * reaches full completion.
 *
 * Invariant: formationProgress = max(calendarBaseline, offeringProgress)
 *
 * Pure and shared on purpose: this is the function that has to give every
 * browser the same Bappa from the same tally.
 */
export function formationFrom(
  day: number,
  offerings: number,
  target: number,
  days: number
): number {
  const dayProgress = clamp01((day - 1) / Math.max(1, days - 1));
  const offeringProgress = target > 0 ? clamp01(Math.pow(Math.max(0, offerings) / target, 0.55)) : 0;

  const progress = Math.min(1, Math.max(dayProgress, offeringProgress));
  return FORMATION_FLOOR + (1 - FORMATION_FLOOR) * progress;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
