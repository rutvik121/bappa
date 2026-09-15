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
  useRitualState,
  useSthapanaArrival,
  festivalClock,
  FESTIVAL_END,
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
  /** Where the festival is, according to the one clock that decides it. */
  const lifecycle = useCollective((s) => s.snapshot?.lifecycle);
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
  type ReflectionPhase =
    | 'absorption'
    | 'stillness'
    | 'whisper';
  const [reflectionPhase, setReflectionPhase] = useState<ReflectionPhase>('absorption');

  const [step, setStep] = useState<Step>('choose');
  const [sound, setSound] = useState<SoundStatus>('off');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ritualState = useRitualState();
  const sthapana = useSthapanaArrival();

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
      // The countdown is local because it has to tick between snapshots;
      // it is anchored to the server's clock, and it decides nothing.
      setFestival(getFestivalStatus());
      setCountdown(getCountdown());
    };

    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  /**
   * When he goes.
   *
   * The server says so, and says how far in it is. Not this browser: a
   * device with a wrong clock would otherwise hold its own private
   * Visarjan early or late, and the one thing this ending has to be is
   * the same ending for everybody.
   *
   * Because the position is taken from the server's own clock rather than
   * from when this tab happened to load, two people watching from
   * different cities are at the same moment of the same dissolution --
   * and a refresh halfway through rejoins it where it actually is instead
   * of starting him dissolving again.
   *
   * COMPLETED means it is already over. There is no replay and no
   * archive, so whoever arrives after -- or refreshes, a year later --
   * gets the dark and the last words, never a Bappa who came back.
   */
  useEffect(() => {
    const isVisarjanTime =
      lifecycle === 'VISARJAN' ||
      lifecycle === 'COMPLETED' ||
      ritualState === 'POST_VISARJAN';

    if (!isVisarjanTime) return;

    const scene = useScene.getState();
    if (scene.state === 'VISARJAN') return;
    // Mid-offering is left alone: their own moment finishes, and the next
    // snapshot brings the ending round again a few seconds later.
    if (scene.state !== 'IDLE' && scene.state !== 'COMPLETE') return;

    const snap = useCollective.getState().snapshot;
    const now = festivalClock();
    const end = snap ? snap.endsAt : FESTIVAL_END.getTime();
    const into = (now - end) / 1000;
    const over = VISARJAN_DURATION + DARKNESS_HOLD;

    scene.setState('VISARJAN');

    if (lifecycle === 'COMPLETED' || !Number.isFinite(into) || into >= over) {
      scene.setElapsed(over);
      return;
    }

    if (into > 1) {
      // Joining a dissolution already under way.
      scene.setElapsed(into);
      audio().init();
    } else {
      // It is beginning now. They see it from the first grain, and hear it.
      audio().init();
    }
  }, [lifecycle, ritualState]);

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
      if (useScene.getState().elapsed >= VISARJAN_DURATION) setFarewellIn(true);
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

  // Absorption, quiet stillness, and the gentle whisper.
  useEffect(() => {
    if (state !== 'COMPLETE') {
      setReflectionPhase('absorption');
      return undefined;
    }

    const t1 = setTimeout(() => setReflectionPhase('stillness'), 3800);
    const t2 = setTimeout(() => setReflectionPhase('whisper'), 8000);
    const t3 = setTimeout(() => setState('IDLE'), 12200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [state, setState]);

  // A beat before focus, so the keyboard does not race the push-in.
  useEffect(() => {
    if (state !== 'CONTRIBUTING' || step !== 'write') return undefined;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 420);
    return () => clearTimeout(t);
  }, [state, step]);

  // Escape steps back one gesture at a time, or dismisses contemplation.
  useEffect(() => {
    if (state !== 'CONTRIBUTING' && state !== 'COMPLETE') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (state === 'COMPLETE') setState('IDLE');
      else if (step === 'write') back();
      else leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, step, setState]);

  const begin = () => {
    if (!arrived || ritualState !== 'BAPPA_PRESENT') return;
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
  const farewell = FAREWELL_LINES;

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
          {!failed && ritualState === 'BAPPA_PRESENT' && !sthapana.isArriving && (
            <div className={`layer layer--enter ${scene === 'idle' ? 'in' : ''}`}>
              <button
                className={`rite ${arrived ? '' : 'is-waiting'}`}
                onClick={begin}
                tabIndex={arrived ? 0 : -1}
                aria-hidden={!arrived}
              >
                TALK TO BAPPA
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
                {(time.count || time.phase) && (
                  <p className="time">
                    {time.count && <span className="time-count">{time.count}</span>}
                    {time.phase && <span className="time-phase">{time.phase}</span>}
                  </p>
                )}

                {ritualState === 'BAPPA_PRESENT' && !sthapana.isArriving && collectiveReady && typeof count === 'number' && (
                  <p className="tally">
                    {count.toLocaleString('en-IN')}{' '}
                    {count === 1 ? 'voice has' : 'voices have'} reached him.
                  </p>
                )}
              </>
            )}
          </div>
          </div>

          {/* ---------------- CHOICE ---------------- */}
          <section
            className={`layer layer--choose ${scene === 'choose' ? 'in' : ''}`}
            aria-label="Choose what to leave"
          >
            <h2 className="ask">What do you want to tell Bappa?</h2>

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
              Tell me.
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

            {/* Private reassurance */}
            <p className="note note--privacy">Your words are not saved.</p>
            <p className="note note--privacy-sub">What you tell Bappa stays private. Only an anonymous signal becomes part of the collective experience.</p>

            <button className="rite rite--offer" onClick={offer} disabled={!draft.trim()}>
              {active.offer}
            </button>
          </section>

          {/* ---------------- CONTEMPLATION & ABSORPTION ---------------- */}
          <div
            className={`layer layer--closing ${scene === 'complete' ? 'in' : ''}`}
            aria-live="polite"
            onClick={() => {
              if (scene === 'complete') setState('IDLE');
            }}
          >
            {scene === 'complete' && reflectionPhase === 'absorption' && (
              <p className="closing-line">
                It becomes part of me.
              </p>
            )}

            {scene === 'complete' && reflectionPhase === 'whisper' && (
              <p className="reflection-whisper">
                If someone comes to mind, bring them.
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
