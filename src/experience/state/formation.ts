'use client';

import { getFestivalStatus, FESTIVAL_DAYS } from './festival';
import { useCollective, TARGET_OFFERINGS } from './collective';

/**
 * How completely Bappa has formed, 0 to 1.
 *
 * Two things decide it, and the relationship between them is the whole
 * point of the piece:
 *
 *   the calendar   guarantees he is whole by the tenth day
 *   the offerings  get him there sooner, and fuller in the meantime
 *
 * Offerings are therefore never decorative -- on any day but the last,
 * what the crowd has left is the difference between a sketch and a
 * sculpture -- but no one arriving on day ten finds him unfinished
 * because turnout was low. The festival is a promise; the crowd decides
 * how richly it is kept.
 */

/** Never zero: on the first morning there is already something there. */
const FLOOR = 0.14;

/** Weights for the accelerated term. */
const DAY_WEIGHT = 0.35;
const OFFERING_WEIGHT = 0.75;

export interface FormationInputs {
  /** 1..10 */
  day: number;
  offerings: number;
}

export function formationFrom({ day, offerings }: FormationInputs): number {
  // 0 on day one, 1 on day ten.
  const byDay = Math.min(1, Math.max(0, (day - 1) / (FESTIVAL_DAYS - 1)));

  // The same front-loaded curve the tally has always used: against a
  // target in the thousands a linear map would make one offering
  // invisible, which would tell every early visitor they did not matter.
  const byOfferings = Math.min(1, Math.pow(Math.max(0, offerings) / TARGET_OFFERINGS, 0.6));

  const accelerated = DAY_WEIGHT * byDay + OFFERING_WEIGHT * byOfferings;

  // max() rather than a sum: the calendar is a floor the crowd can beat,
  // not a quota they have to meet.
  return Math.min(1, Math.max(FLOOR, byDay, accelerated));
}

/**
 * Development override. When set, this stands in for the whole
 * computation so any day can be inspected without waiting or faking a
 * tally. Always null in production.
 */
let override: number | null = null;

export function setFormationOverride(v: number | null) {
  override = v;
}

export function getFormationOverride() {
  return override;
}

/** The current value, for the render loop. */
export function currentFormation(): number {
  if (override !== null) return override;

  const status = getFestivalStatus();
  const offerings = useCollective.getState().count;

  // Before he arrives there is nothing; once the window closes he is
  // whole, and the visarjan takes him from there.
  if (status.phase === 'BEFORE') return FLOOR;
  if (status.phase === 'ENDED') return 1;

  return formationFrom({ day: status.day, offerings });
}

/**
 * The one line of copy that tracks formation. Deliberately few states --
 * it should read as an inscription that changes over ten days, not as a
 * status field that updates while you watch.
 */
export function describeFormation(formation: number, day: number): string {
  if (day >= FESTIVAL_DAYS && formation >= 0.999) return 'one bappa';
  if (formation >= 0.92) return 'bappa is almost complete';
  if (formation >= 0.5) return 'bappa is becoming';
  return 'bappa is taking shape';
}
