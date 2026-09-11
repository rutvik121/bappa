'use client';

/**
 * The festival window.
 *
 * Bappa is here for ten days and then he goes. That is not a feature
 * flag -- it is the premise, so the deadline is computed from a single
 * configured instant rather than tracked in any kind of session state.
 * Every visitor, on every device, sees the same clock.
 */

/**
 * Ganesh Chaturthi. Override in the environment with the exact muhurat
 * for the year you are running -- this default is a placeholder, not an
 * authority on the date.
 *
 *   NEXT_PUBLIC_BAPPA_START=2026-09-14T06:00:00+05:30
 */
const DEFAULT_START = '2026-09-14T06:00:00+05:30';

export const FESTIVAL_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export const FESTIVAL_START = new Date(
  process.env.NEXT_PUBLIC_BAPPA_START ?? DEFAULT_START
);

export const FESTIVAL_END = new Date(FESTIVAL_START.getTime() + FESTIVAL_DAYS * DAY_MS);

/**
 * The moment he goes. Identical to the end of the window by definition --
 * named separately because that is what it *means*, and because every
 * countdown in the interface should point at this rather than re-deriving
 * a date of its own.
 */
export const VISARJAN_TIME = FESTIVAL_END;

export type FestivalPhase =
  /** Before the first day: Bappa has not arrived. */
  | 'BEFORE'
  /** The ten days. Offerings are open and Bappa is being built. */
  | 'ACTIVE'
  /** The window has closed. He goes. */
  | 'ENDED';

export interface FestivalStatus {
  phase: FestivalPhase;
  /** 1-based day of the festival, clamped to the window. */
  day: number;
  /** Milliseconds until visarjan begins; 0 once it has. */
  msRemaining: number;
  /** 0..1 through the whole window. */
  progress: number;
}

/**
 * Development clock shift, in milliseconds. Lets the panel stand at any
 * point in the ten days -- including past the end -- without waiting or
 * touching the system clock. Always zero in production.
 */
let clockOffset = 0;

export function setClockOffset(ms: number) {
  clockOffset = ms;
}

export function getClockOffset() {
  return clockOffset;
}

export function getFestivalStatus(now = Date.now() + clockOffset): FestivalStatus {
  const start = FESTIVAL_START.getTime();
  const end = FESTIVAL_END.getTime();

  if (now < start) {
    return { phase: 'BEFORE', day: 0, msRemaining: end - now, progress: 0 };
  }
  if (now >= end) {
    return { phase: 'ENDED', day: FESTIVAL_DAYS, msRemaining: 0, progress: 1 };
  }

  const elapsed = now - start;
  return {
    phase: 'ACTIVE',
    day: Math.min(FESTIVAL_DAYS, Math.floor(elapsed / DAY_MS) + 1),
    msRemaining: end - now,
    progress: elapsed / (end - start),
  };
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  /** True once the window has closed. */
  over: boolean;
}

/**
 * Time left to build him, broken down for display.
 *
 * Reads the same shifted clock as everything else, so the development day
 * controls move the countdown and the sculpture together rather than
 * letting them disagree.
 */
export function getCountdown(now = Date.now() + clockOffset): Countdown {
  const remaining = VISARJAN_TIME.getTime() - now;
  if (remaining <= 0) return { days: 0, hours: 0, minutes: 0, over: true };

  return {
    days: Math.floor(remaining / DAY_MS),
    hours: Math.floor((remaining % DAY_MS) / (60 * 60 * 1000)),
    minutes: Math.floor((remaining % (60 * 60 * 1000)) / 60000),
    over: false,
  };
}

/**
 * The line under the countdown.
 *
 * It carries the stakes, not the arithmetic: what the number means is
 * that there is a limited amount of time in which anyone can still add
 * to him, and then there is not.
 */
export function describeDeadline(status: FestivalStatus, countdown: Countdown): string {
  if (status.phase === 'BEFORE') return 'until bappa arrives';
  if (status.phase === 'ENDED' || countdown.over) return 'today, we let him go';

  // The last day stops being about counting. Whatever he is by now is
  // what he will be, and the thing that matters today is that he goes.
  if (countdown.days === 0) return 'today, we let him go';
  if (countdown.days === 1) return '1 day left to build him';
  return `${countdown.days} days left to build him`;
}

/**
 * The countdown, in the voice of the piece: plain words for most of the
 * window, and only sharpening to hours once it is genuinely close. A
 * running seconds display would turn a farewell into a launch timer.
 */
export function describeRemaining(status: FestivalStatus): string {
  if (status.phase === 'BEFORE') return 'bappa arrives soon';
  if (status.phase === 'ENDED') return 'visarjan';

  const hours = status.msRemaining / (60 * 60 * 1000);

  if (hours <= 1) {
    const mins = Math.max(1, Math.round(status.msRemaining / 60000));
    return `visarjan in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  }
  if (hours < 24) {
    const h = Math.round(hours);
    return `visarjan in ${h} ${h === 1 ? 'hour' : 'hours'}`;
  }

  const days = Math.ceil(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} with bappa`;
}
