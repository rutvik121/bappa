'use client';

import { useState, useEffect } from 'react';
import {
  CANONICAL_STHAPANA,
  CANONICAL_VISARJAN,
  type RitualState,
} from '../../shared/collective';

export type { RitualState };

/**
 * The festival window.
 *
 * Bappa is here for ten days and then he goes. That is not a feature
 * flag -- it is the premise, so the deadline is computed from a single
 * configured instant rather than tracked in any kind of session state.
 * Every visitor, on every device, sees the same clock.
 */

/**
 * Ganesh Chaturthi authoritative Sthapana: September 14, 2026 at 11:16 AM IST
 */
const DEFAULT_START = CANONICAL_STHAPANA;
/**
 * Authoritative Visarjan: September 25, 2026 at 18:00 IST
 */
const DEFAULT_END = CANONICAL_VISARJAN;

export const FESTIVAL_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const FESTIVAL_START = new Date(
  process.env.NEXT_PUBLIC_BAPPA_START ?? DEFAULT_START
);

export const FESTIVAL_END = new Date(
  process.env.NEXT_PUBLIC_BAPPA_END ?? DEFAULT_END
);

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

/**
 * How far this device's clock is from the server's.
 *
 * The countdown has to tick between snapshots, so it is read locally --
 * but a browser clock is a number the person can set, and nothing about
 * the one Bappa may depend on it. Every snapshot carries the server's
 * time; this is the difference, applied to every reading so the local
 * clock only ever supplies the ticking and never the truth.
 *
 * The lifecycle itself is not derived here at all: the server states it.
 */
let serverSkew = 0;

export function setServerTime(serverNow: number) {
  const next = serverNow - Date.now();
  // A second either way is measurement noise on the round trip, not skew.
  if (Math.abs(next - serverSkew) > 1000) serverSkew = next;
}

/** The clock everything in the piece reads. */
export function festivalClock() {
  return Date.now() + serverSkew + clockOffset;
}

/**
 * Authoritative ritual lifecycle calculation.
 * Exactly three states: PRE_STHAPANA, BAPPA_PRESENT, POST_VISARJAN.
 */
export function getRitualState(now = festivalClock()): RitualState {
  const start = FESTIVAL_START.getTime();
  const end = FESTIVAL_END.getTime();

  if (now < start) return 'PRE_STHAPANA';
  if (now < end) return 'BAPPA_PRESENT';
  return 'POST_VISARJAN';
}

/**
 * Sthapana arrival duration: 14 seconds.
 * 0.0 - 2.5s: Anticipation — empty asana, quiet stillness
 * 2.5 - 9.5s: Emergence — Bappa forms toward 0.60
 * 9.5 - 12.5s: Settling — Bappa settles onto the asana
 * 12.5 - 14.0s: Awakening — breathing gradually begins
 * 14.0s+: Complete — normal BAPPA_PRESENT UI & offering interaction
 */
export const STHAPANA_DURATION = 14;

export type SthapanaPhase =
  | 'idle'
  | 'anticipation'
  | 'emergence'
  | 'settling'
  | 'awakening'
  | 'complete';

export interface SthapanaArrival {
  isArriving: boolean;
  isCompleted: boolean;
  elapsed: number;
  progress: number;
  phase: SthapanaPhase;
}

export function getSthapanaArrival(now = festivalClock()): SthapanaArrival {
  const start = FESTIVAL_START.getTime();
  if (now < start) {
    return {
      isArriving: false,
      isCompleted: false,
      elapsed: 0,
      progress: 0,
      phase: 'idle',
    };
  }

  const elapsed = (now - start) / 1000;
  if (elapsed >= STHAPANA_DURATION) {
    return {
      isArriving: false,
      isCompleted: true,
      elapsed: STHAPANA_DURATION,
      progress: 1,
      phase: 'complete',
    };
  }

  let phase: SthapanaPhase = 'anticipation';
  if (elapsed < 2.5) {
    phase = 'anticipation';
  } else if (elapsed < 9.5) {
    phase = 'emergence';
  } else if (elapsed < 12.5) {
    phase = 'settling';
  } else {
    phase = 'awakening';
  }

  return {
    isArriving: true,
    isCompleted: false,
    elapsed,
    progress: Math.min(1, Math.max(0, elapsed / STHAPANA_DURATION)),
    phase,
  };
}

/**
 * React hook providing reactive lifecycle state that automatically
 * updates live as time crosses Sthapana or Visarjan boundaries.
 */
export function useRitualState(): RitualState {
  const [state, setState] = useState<RitualState>(() => getRitualState());

  useEffect(() => {
    const check = () => {
      const current = getRitualState();
      setState((prev) => (prev !== current ? current : prev));
    };
    check();
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, []);

  return state;
}

/**
 * React hook providing reactive Sthapana arrival progress.
 */
export function useSthapanaArrival(): SthapanaArrival {
  const [arrival, setArrival] = useState<SthapanaArrival>(() => getSthapanaArrival());

  useEffect(() => {
    const check = () => {
      setArrival(getSthapanaArrival());
    };
    check();
    const id = setInterval(check, 100);
    return () => clearInterval(id);
  }, []);

  return arrival;
}

export function getFestivalStatus(now = festivalClock()): FestivalStatus {
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

/** Time left to build him. Reads the same shifted clock as everything else. */
export function getCountdown(now = festivalClock()): Countdown {
  const remaining = VISARJAN_TIME.getTime() - now;
  if (remaining <= 0) return { days: 0, hours: 0, minutes: 0, over: true };

  return {
    days: Math.floor(remaining / DAY_MS),
    hours: Math.floor((remaining % DAY_MS) / HOUR_MS),
    minutes: Math.floor((remaining % HOUR_MS) / 60000),
    over: false,
  };
}

export interface TimeCopy {
  /** A short count, set small. Omitted when the words are enough on their own. */
  count: string | null;
  /** Where he is in the ten days, in the voice of the piece. */
  phase: string;
}

/**
 * The time, as part of the ritual rather than as a timer.
 *
 * No hours ticking, no minutes, no urgency: a number of days, and a line
 * that changes as the festival moves -- he is beginning, he is taking
 * shape, and then, plainly, when we let him go.
 */
export function describeTime(
  status: FestivalStatus,
  countdown: Countdown,
  now = Date.now() + clockOffset
): TimeCopy {
  const ritual = getRitualState(now);

  if (ritual === 'PRE_STHAPANA') {
    return { count: null, phase: '' };
  }

  if (ritual === 'POST_VISARJAN' || status.phase === 'ENDED' || countdown.over) {
    return { count: null, phase: '' };
  }

  const daysLeft = Math.ceil(status.msRemaining / DAY_MS);

  if (daysLeft <= 1) {
    const hours = Math.max(1, Math.ceil(status.msRemaining / HOUR_MS));
    return {
      count: hours === 1 ? 'The last hour' : `${hours} hours until Visarjan`,
      phase: 'Today, we let him go.',
    };
  }
  if (daysLeft === 2) return { count: null, phase: 'Tomorrow, we let him go.' };

  // "Remain" alone left a first-time visitor asking: remain until what?
  return {
    count: `${daysLeft} days until Visarjan`,
    phase: 'He is with us.',
  };
}

/** Development readout only. */
export function describeRemaining(status: FestivalStatus): string {
  if (status.phase === 'BEFORE') return 'bappa arrives soon';
  if (status.phase === 'ENDED') return 'visarjan';

  const hours = status.msRemaining / HOUR_MS;

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
