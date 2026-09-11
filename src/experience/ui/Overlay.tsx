'use client';

import { useEffect, useRef, useState } from 'react';
import { useScene, type ContributionType } from '../state/sceneState';
import { audio, type SoundStatus } from '../audio/AudioManager';
import { VISARJAN_DURATION, DARKNESS_HOLD } from '../components/DissolveController';
import { useCollective } from '../state/collective';
import {
  getFestivalStatus,
  getCountdown,
  describeTime,
  type Countdown,
} from '../state/festival';
import { FAREWELL_LINES, FAREWELL_OUT_MS } from './farewell';
import { OFFERINGS, OfferingMark, offeringFor } from './offerings';

/**
 * The entire interface.
 *
 * ORIENTATION → CHOICE → PERSONAL OFFERING → TRANSFORMATION → ABSORPTION
 * → EMOTIONAL RESPONSE → STILLNESS.
 *
 * Each step shows the least language that lets the next thing happen.
 * During the transformation the interface is absent, because that moment
 * is not the visitor's to operate. Nothing here makes a sound: gestures
 * wake the AudioContext, and everything after that is the SoundDirector's.
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

  const count = useCollective((s) => s.count);
  const collectiveReady = useCollective((s) => s.ready);
  const [festival, setFestival] = useState(() => getFestivalStatus());
  const [countdown, setCountdown] = useState<Countdown>(() => getCountdown());

  /**
   * Once read, the supporting lines step back so Bappa is what is left.
   * They dim rather than disappear, and any movement brings them back.
   */
  const [settled, setSettled] = useState(false);

  const [farewellIn, setFarewellIn] = useState(false);
  const [farewellOut, setFarewellOut] = useState(false);
  /**
   * Once he starts to leave, the interface goes and does not come back.
   * Unmounted rather than faded, so it is a certainty and not an animation.
   */
  const [uiGone, setUiGone] = useState(false);
  /** Whether this is the visitor's first read of the festival clock. */
  const firstRead = useRef(true);

  const [step, setStep] = useState<Step>('choose');
  const [picked, setPicked] = useState<ContributionType | null>(null);
  const [sound, setSound] = useState<SoundStatus>('off');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Read the tally once on arrival, so a visitor sees Bappa exactly as
  // built as everyone before them left him.
  useEffect(() => {
    void useCollective.getState().init();

    const room = audio();
    const unsubscribe = room.onStatus(setSound);
    // Sound wakes on the first meaningful gesture anywhere, never before.
    const disarm = room.armGesture();
    // Bytes only, and after the sculpture has had the network to itself.
    const fetchLater = window.setTimeout(() => room.prefetch(), 1500);

    return () => {
      unsubscribe();
      disarm();
      window.clearTimeout(fetchLater);
    };
  }, []);

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

  useEffect(() => {
    if (state !== 'IDLE') {
      setSettled(false);
      return undefined;
    }

    let timer = window.setTimeout(() => setSettled(true), 6000);
    const wake = () => {
      setSettled(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSettled(true), 6000);
    };

    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [state]);

  // Back at rest: nothing is chosen, nothing half-written survives.
  useEffect(() => {
    if (state === 'IDLE') {
      setStep('choose');
      setPicked(null);
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
      if (step === 'write') setStep('choose');
      else leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const begin = () => {
    audio().init();
    setPicked(null);
    setMood(null);
    setStep('choose');
    setState('CONTRIBUTING');
  };

  const leave = () => setState('IDLE');

  const pick = (id: ContributionType) => {
    setPicked(id);
    setType(id);
    setMood(id);
  };

  const offer = () => {
    if (!draft.trim()) return;
    setState('UNDERSTANDING');
  };

  const active = offeringFor(picked ?? type);

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

  return (
    <div className={`overlay ${ready ? 'is-ready' : ''}`} data-scene={scene}>
      {/* Readability without boxes: soft darkness where the words sit, and
          none while the offering is the only thing in the frame. */}
      <div className="scrim scrim--top" aria-hidden="true" />
      <div className="scrim scrim--bottom" aria-hidden="true" />

      {!uiGone && (
        <>
          {/* ---------------- ORIENTATION ---------------- */}
          <header
            className={`layer layer--masthead ${scene === 'idle' ? 'in' : ''} ${
              settled ? 'is-settled' : ''
            }`}
          >
            <p className="brand">Bappa 2026</p>
            <h1 className="headline">
              Leave something
              <br />
              with Bappa.
            </h1>
            <p className="litany">A wish. A gratitude. A burden. A promise.</p>
            <p className="support">He becomes what we leave behind.</p>
          </header>

          <div
            className={`layer layer--foot ${scene === 'idle' ? 'in' : ''} ${
              settled ? 'is-settled' : ''
            }`}
          >
            <p className="time">
              {time.count && <span className="time-count">{time.count}</span>}
              <span className="time-phase">{time.phase}</span>
            </p>

            <button className="rite" onClick={begin}>
              Make an offering
            </button>

            {collectiveReady && count > 0 && (
              <p className="tally">
                {count.toLocaleString('en-IN')}{' '}
                {count === 1 ? 'offering has' : 'offerings have'} become part of Bappa.
              </p>
            )}
          </div>

          {/* ---------------- CHOICE ---------------- */}
          <section
            className={`layer layer--choose ${scene === 'choose' ? 'in' : ''}`}
            aria-label="Choose an offering"
          >
            <h2 className="ask">What will you leave with him?</h2>

            <div className={`invites ${picked ? 'has-choice' : ''}`} role="group">
              {OFFERINGS.map((o) => (
                <button
                  key={o.id}
                  className={`invite invite--${o.id.toLowerCase()}`}
                  aria-pressed={picked === o.id}
                  onClick={() => pick(o.id)}
                >
                  <span className="invite-top">
                    <OfferingMark id={o.id} />
                    <span className="invite-name">{o.name}</span>
                  </span>
                  <span className="invite-line">{o.line}</span>
                </button>
              ))}
            </div>

            <div className="choose-foot">
              <button className="aside" onClick={leave}>
                Not now
              </button>
              <button
                className={`rite ${picked ? '' : 'is-waiting'}`}
                onClick={() => picked && setStep('write')}
                tabIndex={picked ? 0 : -1}
                aria-hidden={!picked}
              >
                {picked ? offeringFor(picked).choose : 'Choose one'}
              </button>
            </div>
          </section>

          {/* ---------------- PERSONAL OFFERING ---------------- */}
          <section
            className={`layer layer--write layer--${active.id.toLowerCase()} ${
              scene === 'write' ? 'in' : ''
            }`}
          >
            <button className="aside aside--back" onClick={() => setStep('choose')}>
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
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) offer();
              }}
            />

            <div className="write-foot">
              <span className="note">Only you will ever read this.</span>
              <button className="rite" onClick={offer} disabled={!draft.trim()}>
                {active.offer}
              </button>
            </div>
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
        {FAREWELL_LINES.map((line) => (
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

      {/* The only persistent control. It goes when he starts to leave. */}
      <button
        className={`sound ${state === 'VISARJAN' ? 'gone' : ''} ${sound === 'on' ? 'is-on' : ''}`}
        onClick={() => audio().toggle()}
        aria-pressed={sound === 'on'}
      >
        {sound === 'on' ? 'Sound off' : 'Sound on'}
      </button>
    </div>
  );
}
