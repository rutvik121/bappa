/**
 * The festival, as the server understands it.
 *
 * This is the only clock that counts. The browser has one too -- it needs
 * it to tick a countdown between snapshots -- but a browser's clock is a
 * user-editable number, so nothing that decides what Bappa *is* may be
 * derived from it. Lifecycle, day, and therefore formation are computed
 * here and handed down.
 *
 * Configured in one place so the dates can be corrected for the year
 * without hunting through the client.
 */

import {
  CANONICAL_STHAPANA,
  CANONICAL_VISARJAN,
  type RitualState,
} from '../../shared/collective';

/** Ganesh Chaturthi authoritative Sthapana: September 14, 2026 at 11:16 AM IST */
const DEFAULT_START = CANONICAL_STHAPANA;
/** Authoritative Visarjan: September 25, 2026 at 18:00 IST */
const DEFAULT_END = CANONICAL_VISARJAN;

export const FESTIVAL_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long he is going for. After this the window is over and he is
 * simply gone -- a visitor arriving later finds the darkness, not a
 * replay. Long enough that anyone present for the ending sees all of it.
 */
const VISARJAN_WINDOW_MS = 5 * 60 * 1000;

/**
 * `BAPPA_START` is the server-side name and wins. The NEXT_PUBLIC_ one is
 * read as a fallback so a single value in .env.local configures both
 * halves during development -- but it is the server's reading of it that
 * is authoritative, never the copy compiled into the bundle.
 */
export const FESTIVAL_START = new Date(
  process.env.BAPPA_START ?? process.env.NEXT_PUBLIC_BAPPA_START ?? DEFAULT_START
);

export const FESTIVAL_END = new Date(
  process.env.BAPPA_END ?? process.env.NEXT_PUBLIC_BAPPA_END ?? DEFAULT_END
);

/** Offerings that would complete him on their own, with no days passing. */
export const TARGET_OFFERINGS = Number(
  process.env.BAPPA_TARGET ?? process.env.NEXT_PUBLIC_BAPPA_TARGET ?? 1008
);

/**
 * Where the whole thing is in its life. `DAY_n` is spelled out rather than
 * carried as a number so a client can switch on it without re-deriving the
 * calendar, which is the mistake this module exists to prevent.
 */
export type Lifecycle =
  | 'PRE_LAUNCH'
  | `DAY_${number}`
  | 'VISARJAN'
  | 'COMPLETED';

export interface FestivalNow {
  lifecycle: Lifecycle;
  ritualState: RitualState;
  /** 1..FESTIVAL_DAYS while he is here; 0 before; FESTIVAL_DAYS after. */
  day: number;
  /** Server time, so a client can anchor its own ticking to it. */
  now: number;
  startsAt: number;
  endsAt: number;
  /** Whether an offering may be accepted at all. */
  accepting: boolean;
}

export function festivalNow(at: number = Date.now()): FestivalNow {
  const startsAt = FESTIVAL_START.getTime();
  const endsAt = FESTIVAL_END.getTime();

  const base = { now: at, startsAt, endsAt };

  if (at < startsAt) {
    return {
      ...base,
      lifecycle: 'PRE_LAUNCH',
      ritualState: 'PRE_STHAPANA',
      day: 0,
      accepting: false,
    };
  }

  if (at < endsAt) {
    const day = Math.min(FESTIVAL_DAYS, Math.floor((at - startsAt) / DAY_MS) + 1);
    return {
      ...base,
      lifecycle: `DAY_${day}` as Lifecycle,
      ritualState: 'BAPPA_PRESENT',
      day,
      accepting: true,
    };
  }

  // He is going, or gone. Either way nothing further may be left with him:
  // an offering accepted now could never become part of him.
  if (at < endsAt + VISARJAN_WINDOW_MS) {
    return {
      ...base,
      lifecycle: 'VISARJAN',
      ritualState: 'POST_VISARJAN',
      day: FESTIVAL_DAYS,
      accepting: false,
    };
  }

  return {
    ...base,
    lifecycle: 'COMPLETED',
    ritualState: 'POST_VISARJAN',
    day: FESTIVAL_DAYS,
    accepting: false,
  };
}
