'use client';

import { getFestivalStatus, FESTIVAL_DAYS } from './festival';
import { TARGET_OFFERINGS } from './collective';
import { formationFrom as sharedFormationFrom, FORMATION_FLOOR } from '../../shared/collective';

/**
 * How completely Bappa has formed, 0 to 1.
 *
 * Two things decide it, and the relationship between them is the whole
 * point of the piece:
 *
 *   the calendar   guarantees he is whole by the tenth day
 *   the offerings  get him there sooner, and fuller in the meantime
 *
 * TIME BUILDS HIM. PEOPLE HELP SHAPE HIM.
 */

export interface FormationInputs {
  /** 1..10 */
  day: number;
  offerings: number;
}

export function formationFrom({ day, offerings }: FormationInputs): number {
  return sharedFormationFrom(day, offerings, TARGET_OFFERINGS, FESTIVAL_DAYS);
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

export function getFormationOverride(): number | null {
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

  const status = getFestivalStatus();
  if (status.phase === 'BEFORE') return FORMATION_FLOOR;
  if (status.phase === 'ENDED') return 1;

  // Bappa is visually complete throughout all festival days.
  return 1.0;
}

/** Development readout only. */
export function describeFormation(formation: number, day: number): string {
  if (day >= FESTIVAL_DAYS && formation >= 0.999) return 'one bappa';
  if (formation >= 0.92) return 'bappa is complete';
  return 'bappa is present';
}
