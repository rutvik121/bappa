'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScene, type ContributionType } from '../state/sceneState';
import { useBoot } from '../state/boot';
import { audio, type SoundStatus } from '../audio/AudioManager';
import { VISARJAN_DURATION, DARKNESS_HOLD } from '../components/DissolveController';
import { useCollective, hasLeftSomething } from '../state/collective';
import {
  getFestivalStatus,
  getCountdown,
  describeTime,
  type Countdown,
} from '../state/festival';
import { FAREWELL_LINES, FAREWELL_OUT_MS } from './farewell';
import { OFFERINGS, OfferingMark, offeringFor } from './offerings';
import { Masthead } from './Masthead';

/**
 * The entire interface.
 *
 * ARRIVAL → ORIENTATION → CHOICE → PERSONAL OFFERING → TRANSFORMATION →
 * ABSORPTION → EMOTIONAL RESPONSE → STILLNESS.
 *
 * Each step shows the least language that lets the next thing happen.
 * Nothing is asked of the visitor until he can be seen; during the
 * transformation the interface is absent, because that moment is not the
 * visitor's to operate. Nothing here makes a sound: gestures wake the
 * AudioContext, and everything after that is the SoundDirector's.
 */

type Step = 'choose' | 'write';

/** Which composition the overlay is in; drives the readability scrims. */
type Scene = 'idle' | Step | 'offering' | 'complete' | 'visarjan';

export function Overlay({ ready }: { ready: boolean }) {
  const state = useScene((s) => s.state);
  const type = useScene((s) => s.type);
  const draft = useScene((s) => s.draft);
  const setState = useScene((s) => s.setState);
  const setType = useScene((s) => s.setType);
  const setMood = useScene((s) => s.setMood);
  const setDraft = useScene((s) => s.setDraft);

  const modelAt = useBoot((s) => s.modelAt);
  const failed = useBoot((s) => s.failed);

  const count = useCollective((s) => s.count);
  const collectiveReady = useCollective((s) => s.ready);
  const [festival, setFestival] = useState(() => getFestivalStatus());
  const [countdown, setCountdown] = useState<Countdown>(() => getCountdown());

  /** The ritual is offered only once the light has found him. */
  const [arrived, setArrived] = useState(false);
  /** Still loading after a while: say so, once, quietly. */
  const [slow, setSlow] = useState(false);

  const [farewellIn, setFarewellIn] = useState(false);
  const [farewellOut, setFarewellOut] = useState(false);
  /** Whether this device left something with him; read when he goes. */
  const [left, setLeft] = useState(false);
  /**
   * Once he starts to leave, the interface goes and does not come back.
   * Unmounted rather than faded, so it is a certainty and not an animation.
   */
  const [uiGone, setUiGone] = useState(false);
  /** Whether this is the visitor's first read of the festival clock. */
  const firstRead = useRef(true);

  const [step, setStep] = useState<Step>('choose');
  const [sound, setSound] = useState<SoundStatus>('off');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The server-rendered prelude hands over in the same frame the live
  // interface becomes visible, in the same place, so nothing blinks.
  useLayoutEffect(() => {
    if (ready) document.documentElement.dataset.live = '1';
  }, [ready]);

  // Read the tally once on arrival, so a visitor sees Bappa exactly as
  // built as everyone before them left him.
  useEffect(() => {
    void useCollective.getState().init();

    const room = audio();
    const unsubscribe = room.onStatus(setSound);
    // Sound wakes on the first meaningful gesture anywhere, never before.
    const disarm = room.armGesture();
    // Bytes only, and after the sculpture has had the network to itself.
    const fetchLater = window.setTimeout(() => room.prefetchEarly(), 2500);

    return () => {
      unsubscribe();
      disarm();
      window.clearTimeout(fetchLater);
    };
  }, []);

  useEffect(() => {
    if (modelAt === null) {
      const t = window.setTimeout(() => setSlow(true), 4500);
      return () => window.clearTimeout(t);
    }
    // Let the light find him before anything asks anything of the visitor.
    const t = window.setTimeout(() => setArrived(true), 1500);
    return () => window.clearTimeout(t);
  }, [modelAt]);

  /**
   * The ten days are the premise, so the ending is not something anyone
   * triggers -- it arrives. Polled slowly; the clock needs no frame
   * precision, and this keeps working in a tab that gets no frames.
   */
  useEffect(() => {
    const tick = () => {
      const next = getFestivalStatus();
      setFestival(next);
      setCountdown(getCountdown());

      const s = useScene.getState().state;

      if (next.phase === 'ENDED' && (s === 'IDLE' || s === 'COMPLETE')) {
        if (firstRead.current) {
          // Arriving after it is over: he is already gone, and there is no
          // replay. Only the darkness and the last words.
          useScene.getState().setState('VISARJAN');
          useScene.getState().setElapsed(VISARJAN_DURATION + DARKNESS_HOLD);
        } else {
          // It ended while they were here. They see it, and hear it.
          audio().init();
          useScene.getState().setState('VISARJAN');
        }
      }

      firstRead.current = false;
    };

    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  // The words wait for the darkness to have been empty for a moment.
  useEffect(() => {
    if (state !== 'VISARJAN') {
      setFarewellIn(false);
      setUiGone(false);
      return undefined;
    }

    setLeft(hasLeftSomething());
    const clear = setTimeout(() => setUiGone(true), 1500);
    const id = setInterval(() => {
      if (useScene.getState().elapsed >= VISARJAN_DURATION + DARKNESS_HOLD) setFarewellIn(true);
    }, 300);
    return () => {
      clearInterval(id);
      clearTimeout(clear);
    };
  }, [state]);

  // ...and then leave too. A wall-clock timer, because the render loop has
  // stopped by now and the scene clock no longer advances.
  useEffect(() => {
    if (!farewellIn) {
      setFarewellOut(false);
      return undefined;
    }
    const t = setTimeout(() => setFarewellOut(true), FAREWELL_OUT_MS);
    return () => clearTimeout(t);
  }, [farewellIn]);

  // Back at rest: nothing is chosen, nothing half-written survives.
  useEffect(() => {
    if (state === 'IDLE') {
      setStep('choose');
      if (useScene.getState().draft) setDraft('');
    }
  }, [state, setDraft]);

  // A beat before focus, so the keyboard does not race the push-in.
  useEffect(() => {
    if (state !== 'CONTRIBUTING' || step !== 'write') return undefined;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 420);
    return () => clearTimeout(t);
  }, [state, step]);

  // Escape steps back one gesture at a time.
  useEffect(() => {
    if (state !== 'CONTRIBUTING') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (step === 'write') back();
      else leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const begin = () => {
    if (!arrived) return;
    audio().init();
    setMood(null);
    setStep('choose');
    setState('CONTRIBUTING');
  };

  const leave = () => setState('IDLE');

  /** Each offering is a doorway: choosing it is walking through. */
  const open = (id: ContributionType) => {
    setType(id);
    setMood(id);
    setStep('write');
  };

  const back = () => {
    setMood(null);
    setStep('choose');
  };

  const offer = () => {
    if (!draft.trim()) return;
    setState('UNDERSTANDING');
  };

  const active = offeringFor(type);

  const scene: Scene =
    state === 'IDLE'
      ? 'idle'
      : state === 'CONTRIBUTING'
        ? step
        : state === 'COMPLETE'
          ? 'complete'
          : state === 'VISARJAN'
            ? 'visarjan'
            : 'offering';

  const time = describeTime(festival, countdown);
  const farewell = FAREWELL_LINES.filter((l) => !('onlyIfLeft' in l) || left);

  return (
    <div className={`overlay ${ready ? 'is-ready' : ''}`} data-scene={scene}>
      {/* Readability without boxes: soft darkness where the words sit, and
          none while the offering is the only thing in the frame. */}
      <div className="scrim scrim--top" aria-hidden="true" />
      <div className="scrim scrim--bottom" aria-hidden="true" />

      {!uiGone && (
        <>
          {/* ---------------- ARRIVAL ---------------- */}
          <div className={`ember ${modelAt === null && !failed ? 'in' : ''}`} aria-hidden="true">
            <span />
          </div>
          <p className={`ember-note ${slow && modelAt === null && !failed ? 'in' : ''}`} aria-live="polite">
            {slow && modelAt === null && !failed ? 'He is on his way.' : ''}
          </p>

          {/* ---------------- ORIENTATION ---------------- */}
          {/* He is the centre of the room. These two blocks are the
              information standing around him -- the invitation on one
              side, the clock and the way in on the other -- and the
              composition is the viewport itself, not the space left
              over once they have been placed. */}
          <div className="hero">
          <header className={`layer layer--masthead ${scene === 'idle' ? 'in' : ''}`}>
            <Masthead />
          </header>

          {/* The one control that belongs in the middle. It opens the
              ritual, and the ritual happens in the centre -- so it stands
              under him rather than out at an edge with the information. */}
          {!failed && (
            <div className={`layer layer--enter ${scene === 'idle' ? 'in' : ''}`}>
              <button
                className={`rite ${arrived ? '' : 'is-waiting'}`}
                onClick={begin}
                tabIndex={arrived ? 0 : -1}
                aria-hidden={!arrived}
              >
                Make an offering
              </button>
            </div>
          )}

          <div className={`layer layer--foot ${scene === 'idle' ? 'in' : ''}`}>
            {failed === 'webgl' && (
              <p className="fallback">
                <span className="fallback-line">This device can’t show him.</span>
                <span className="fallback-help">Open this page in Chrome or Safari to see Bappa.</span>
              </p>
            )}

            {failed === 'load' && (
              <>
                <p className="fallback">
                  <span className="fallback-line">He couldn’t reach you.</span>
                  <span className="fallback-help">The connection may have dropped.</span>
                </p>
                <button className="rite" onClick={() => window.location.reload()}>
                  Try again
                </button>
              </>
            )}

            {!failed && (
              <>
                <p className="time">
                  {time.count && <span className="time-count">{time.count}</span>}
                  <span className="time-phase">{time.phase}</span>
                </p>

                {collectiveReady && count > 0 && (
                  <p className="tally">
                    {count.toLocaleString('en-IN')}{' '}
                    {count === 1 ? 'offering has' : 'offerings have'} become part of Bappa.
                  </p>
                )}
              </>
            )}
          </div>
          </div>

          {/* ---------------- CHOICE ---------------- */}
          <section
            className={`layer layer--choose ${scene === 'choose' ? 'in' : ''}`}
            aria-label="Choose an offering"
          >
            <h2 className="ask">What will you leave with him?</h2>

            <ul className="doors">
              {OFFERINGS.map((o) => (
                <li key={o.id}>
                  <button className={`door door--${o.id.toLowerCase()}`} onClick={() => open(o.id)}>
                    <OfferingMark id={o.id} />
                    <span className="door-name">{o.name}</span>
                    <span className="door-line">{o.line}</span>
                  </button>
                </li>
              ))}
            </ul>

            <button className="aside aside--leave" onClick={leave}>
              Not now
            </button>
          </section>

          {/* ---------------- PERSONAL OFFERING ---------------- */}
          <section
            className={`layer layer--write door--${active.id.toLowerCase()} ${
              scene === 'write' ? 'in' : ''
            }`}
          >
            <button className="aside aside--back" onClick={back}>
              <span aria-hidden="true">←</span> {active.name}
            </button>

            <label className="prompt" htmlFor="offering-text">
              {active.prompt}
            </label>

            <textarea
              id="offering-text"
              ref={inputRef}
              className="input"
              value={draft}
              placeholder={active.placeholder}
              maxLength={400}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) offer();
              }}
            />

            {/* What happens to the words, in one breath: no one reads
                them, nothing keeps them, and they become part of him. */}
            <p className="note">No one else will ever read this. It becomes part of him.</p>

            <button className="rite rite--offer" onClick={offer} disabled={!draft.trim()}>
              {active.offer}
            </button>
          </section>

          {/* ---------------- EMOTIONAL RESPONSE ---------------- */}
          <div className={`layer layer--closing ${scene === 'complete' ? 'in' : ''}`} aria-live="polite">
            {scene === 'complete' && (
              <p className="closing-line" key={type}>
                {offeringFor(type).closing}
              </p>
            )}
          </div>
        </>
      )}

      {/* ---------------- VISARJAN ---------------- */}
      {/* Nothing is shown while he is going. The words wait for the dark to
          have been silent for a moment, stay briefly, and go. */}
      <div
        className={`layer layer--farewell ${farewellIn ? 'in' : ''} ${farewellOut ? 'out' : ''}`}
        aria-live="polite"
      >
        {farewell.map((line) => (
          <p
            key={line.kind}
            className={`farewell-line farewell-line--${line.kind}`}
            style={{ transitionDelay: farewellOut ? '0ms' : `${line.at}ms` }}
          >
            {line.lines.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </p>
        ))}
      </div>

      {/* The only persistent control. It says what the sound is doing, and
          goes when he starts to leave. */}
      <button
        className={`sound ${state === 'VISARJAN' ? 'gone' : ''} ${sound === 'on' ? 'is-on' : ''}`}
        onClick={() => audio().toggle()}
        aria-pressed={sound === 'on'}
      >
        Sound <span className="sound-state">{sound === 'on' ? 'on' : 'off'}</span>
      </button>
    </div>
  );
}
