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
const FLOOR = 0.60;

export interface FormationInputs {
  /** 1..10 */
  day: number;
  offerings: number;
}

export function formationFrom({ day, offerings }: FormationInputs): number {
  const dayProgress = Math.min(1, Math.max(0, (day - 1) / (FESTIVAL_DAYS - 1)));
  const offeringProgress = TARGET_OFFERINGS > 0 ? Math.min(1, Math.pow(Math.max(0, offerings) / TARGET_OFFERINGS, 0.55)) : 0;

  const progress = Math.min(1, Math.max(dayProgress, offeringProgress));
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

/**
 * The current value, for the render loop.
 *
 * Read from the collective rather than computed. How built he is is a
 * fact about the one Bappa, not about this browser, so the server decides
 * it and every client is handed the same number -- which is the only way
 * two windows can be looking at the same sculpture.
 *
 * The local computation below it is the fallback for the moment before
 * the first snapshot lands, and for the development panel standing at a
 * day it has invented.
 */
export function currentFormation(): number {
  if (override !== null) return override;

  const { visualBuild, build, ready } = useCollective.getState();
  if (ready) return visualBuild ?? build;

  const status = getFestivalStatus();
  if (status.phase === 'BEFORE') return FLOOR;
  if (status.phase === 'ENDED') return 1;

  return formationFrom({ day: status.day, offerings: 0 });
}

/** Development readout only. */
export function describeFormation(formation: number, day: number): string {
  if (day >= FESTIVAL_DAYS && formation >= 0.999) return 'one bappa';
  if (formation >= 0.92) return 'bappa is almost complete';
  if (formation >= 0.75) return 'bappa is becoming';
  return 'bappa is taking shape';
}
