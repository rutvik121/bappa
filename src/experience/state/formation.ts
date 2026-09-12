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
 * Offerings are therefore never decorative, but no one arriving on day ten
 * finds him unfinished because turnout was low. The festival is a promise;
 * the crowd decides how richly it is kept.
 */

/**
 * Where he starts: begun, not finished.
 *
 * Low on purpose. He is not a finished murti that offerings decorate --
 * he is the thing the offerings are making, so on the first morning most
 * of him is still loose material holding his shape, and only the base and
 * the lower body have settled into clay. Everything the days and the
 * offerings add is built above this.
 *
 * Not lower than this, though: the silhouette has to be unmistakably him
 * from the first frame. Below roughly a quarter there is not enough
 * settled clay to read as terracotta at all, and he becomes a cloud in
 * the shape of a murti rather than a murti being made.
 */
const FLOOR = 0.3;

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

  // Front-loaded: against a target in the thousands a linear map would make
  // one offering invisible, which would tell every early visitor they did
  // not matter.
  const byOfferings = Math.min(1, Math.pow(Math.max(0, offerings) / TARGET_OFFERINGS, 0.6));

  // max() rather than a sum: the calendar is a floor the crowd can beat,
  // not a quota they have to meet.
  const progress = Math.min(1, Math.max(byDay, DAY_WEIGHT * byDay + OFFERING_WEIGHT * byOfferings));

  return FLOOR + (1 - FLOOR) * progress;
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

  // Before he arrives he is as he will be on the first morning; once the
  // window closes he is whole, and the visarjan takes him from there.
  if (status.phase === 'BEFORE') return FLOOR;
  if (status.phase === 'ENDED') return 1;

  return formationFrom({ day: status.day, offerings });
}

/** Development readout only. */
export function describeFormation(formation: number, day: number): string {
  if (day >= FESTIVAL_DAYS && formation >= 0.999) return 'one bappa';
  if (formation >= 0.92) return 'bappa is almost complete';
  if (formation >= 0.75) return 'bappa is becoming';
  return 'bappa is taking shape';
}
