'use client';

import { useRitualState, useSthapanaArrival, type RitualState } from '../state/festival';

/**
 * The opening words. Responsive to the authoritative ritual state:
 * - PRE_STHAPANA (and during Sthapana arrival 0-14s): "His place is ready."
 * - BAPPA_PRESENT (14s+): "Leave something with Bappa."
 * - POST_VISARJAN: "He returns."
 */
export function Masthead({ state: overrideState }: { state?: RitualState }) {
  const liveState = useRitualState();
  const sthapana = useSthapanaArrival();
  const ritualState = overrideState ?? liveState;

  if (ritualState === 'PRE_STHAPANA' || (ritualState === 'BAPPA_PRESENT' && sthapana.isArriving)) {
    return (
      <>
        <p className="brand">Bappa 2026</p>
        <h1 className="headline">
          His place
          <br />
          is ready.
        </h1>
        <p className="litany">STHAPANA · 14 SEPTEMBER</p>
        <p className="support">He comes at 11:16 AM.</p>
      </>
    );
  }

  if (ritualState === 'POST_VISARJAN') {
    return (
      <>
        <p className="brand">Bappa 2026</p>
        <h1 className="headline">
          He
          <br />
          returns.
        </h1>
        <p className="litany">The place remains.</p>
        <p className="support">GANPATI BAPPA MORYA</p>
      </>
    );
  }

  return (
    <>
      <p className="brand">Bappa 2026</p>
      <h1 className="headline">
        Leave something
        <br />
        with Bappa.
      </h1>
      <p className="litany">A wish. A gratitude. A weight. A promise.</p>
      <p className="support">He becomes what we leave behind.</p>
    </>
  );
}
