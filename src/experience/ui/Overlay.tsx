'use client';

import { useEffect, useRef, useState } from 'react';
import { useScene, type ContributionType } from '../state/sceneState';
import { audio, type SoundStatus } from '../audio/AudioManager';
import { VISARJAN_DURATION, DARKNESS_HOLD } from '../components/DissolveController';
import { useCollective } from '../state/collective';
import {
  getFestivalStatus,
  getCountdown,
  describeDeadline,
  FESTIVAL_DAYS,
  type Countdown,
} from '../state/festival';
import { currentFormation } from '../state/formation';
import { FAREWELL_LINES } from './farewell';

/**
 * The entire interface.
 *
 * There is no chrome, no navigation and no persistent controls. Each
 * state shows the smallest amount of language that lets the next thing
 * happen, and nothing else. During UNDERSTANDING and TRANSFORMING the
 * interface is completely absent, because those moments are not the
 * visitor's to act on.
 *
 * Nothing here makes a sound. Gestures wake the AudioContext -- browsers
 * require that to happen inside one -- and everything after that is the
 * SoundDirector's.
 */

const OFFERINGS: Array<{ id: ContributionType; label: string; prompt: string }> = [
  {
    id: 'GRATITUDE',
    label: 'gratitude',
    prompt: 'What are you thankful for?',
  },
  {
    id: 'WISH',
    label: 'a wish',
    prompt: 'What do you hope for?',
  },
  {
    id: 'VIGHNA',
    label: 'an obstacle',
    prompt: 'What is in your way?',
  },
  {
    id: 'PROMISE',
    label: 'a promise',
    prompt: 'What will you begin?',
  },
];

export function Overlay({ ready }: { ready: boolean }) {
  const state = useScene((s) => s.state);
  const type = useScene((s) => s.type);
  const draft = useScene((s) => s.draft);
  const setState = useScene((s) => s.setState);
  const setType = useScene((s) => s.setType);
  const setDraft = useScene((s) => s.setDraft);

  const count = useCollective((s) => s.count);
  const collectiveReady = useCollective((s) => s.ready);
  const [festival, setFestival] = useState(() => getFestivalStatus());
  const [formation, setFormation] = useState(0);
  const [countdown, setCountdown] = useState<Countdown>(() => getCountdown());
  /**
   * The explanation steps back once it has been read.
   *
   * A first-time visitor needs the mechanism in the first few seconds;
   * after that the copy is in the way of the thing it was explaining. It
   * dims rather than disappears, so it can still be read on return, and
   * any pointer movement brings it back.
   */
  const [settled, setSettled] = useState(false);
  /** Seconds into Visarjan; drives the closing words and nothing else. */
  const [farewell, setFarewell] = useState(-1);
  /**
   * Once he starts to leave, the interface goes and does not come back.
   *
   * Unmounted rather than left to a CSS fade: the layers hide themselves
   * with a delayed `visibility` transition, and a transition that stalls
   * leaves the wordmark sitting over the darkness. From here the piece is
   * a film, so this has to be a certainty rather than an animation.
   */
  const [uiGone, setUiGone] = useState(false);
  /** Whether this is the visitor's first read of the festival clock. */
  const firstRead = useRef(true);

  const [chosen, setChosen] = useState(false);
  const [sound, setSound] = useState<SoundStatus>('off');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Read the tally once on arrival, so a visitor sees Bappa exactly as
  // built as everyone before them left him.
  useEffect(() => {
    void useCollective.getState().init();

    const room = audio();
    const unsubscribe = room.onStatus(setSound);
    // Sound wakes on the first meaningful gesture anywhere, not only on
    // the call to action -- but never before one.
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
   * triggers -- it arrives. Polled on a slow interval rather than per
   * frame; the clock does not need frame precision, and this keeps
   * working in a tab that is getting no frames at all.
   */
  useEffect(() => {
    const tick = () => {
      const next = getFestivalStatus();
      setFestival(next);
      setFormation(currentFormation());
      setCountdown(getCountdown());

      const s = useScene.getState().state;

      if (next.phase === 'ENDED' && (s === 'IDLE' || s === 'COMPLETE')) {
        if (firstRead.current) {
          /**
           * Arriving after it is over.
           *
           * Nothing is permanent is the promise the piece makes, so a
           * visitor who comes late does not get to watch it happen --
           * that would make the ending a recording. He is already gone,
           * and all that is here is what was said afterwards.
           */
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

  // The closing words arrive after the darkness has been allowed to sit.
  useEffect(() => {
    if (state !== 'VISARJAN') {
      setFarewell(-1);
      setUiGone(false);
      return undefined;
    }

    // Long enough for the fade to play when the clock is healthy, short
    // enough that nothing is still on screen once he is going.
    const clear = setTimeout(() => setUiGone(true), 1500);
    const id = setInterval(() => setFarewell(useScene.getState().elapsed), 400);
    return () => {
      clearInterval(id);
      clearTimeout(clear);
    };
  }, [state]);

  useEffect(() => {
    if (state !== 'IDLE') {
      setSettled(false);
      return undefined;
    }

    let timer = window.setTimeout(() => setSettled(true), 5500);
    const wake = () => {
      setSettled(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSettled(true), 5500);
    };

    window.addEventListener('pointermove', wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
    };
  }, [state]);

  useEffect(() => {
    if (state === 'CONTRIBUTING' && chosen) {
      // A beat before focus, so the keyboard does not race the push-in.
      const t = setTimeout(() => inputRef.current?.focus(), 420);
      return () => clearTimeout(t);
    }
    if (state === 'IDLE') setChosen(false);
    return undefined;
  }, [state, chosen]);

  const begin = () => {
    audio().init();
    setState('CONTRIBUTING');
  };

  const offer = () => {
    if (!draft.trim()) return;
    setState('UNDERSTANDING');
  };

  const beginVisarjan = () => {
    audio().init();
    setState('VISARJAN');
  };

  const active = OFFERINGS.find((o) => o.id === type)!;
  // On the last day the tally stops being the point: he is one Bappa.
  const whole = festival.day >= FESTIVAL_DAYS && formation >= 0.999;

  return (
    <div className={`overlay ${ready ? 'is-ready' : ''}`}>
      {!uiGone && (
        <>
      {/* ---------------- IDLE ---------------- */}
      {/* The first five seconds have to answer "what is this?". The
          wordmark alone never did -- it named the thing without saying
          what it does, so the mechanism is stated plainly underneath and
          the old tagline drops to a secondary descriptor. */}
      <div
        className={`layer layer--masthead ${state === 'IDLE' ? 'in' : ''} ${
          settled ? 'is-settled' : ''
        }`}
      >
        <h1 className="wordmark">
          BAPPA <span>2026</span>
        </h1>

        <p className="lede-primary">
          A Ganpati built by everyone
          <br />
          on the Internet.
        </p>

        <p className="lede-secondary">
          Leave a wish, gratitude, an obstacle or a promise.
          <br />
          It becomes part of him.
        </p>
      </div>

      <div
        className={`layer layer--foot ${state === 'IDLE' ? 'in' : ''} ${
          settled ? 'is-settled' : ''
        }`}
      >
        <button className="quiet" onClick={begin}>
          Leave something with Bappa
        </button>

        {collectiveReady && (
          <p className="collective">
            {whole
              ? `${FESTIVAL_DAYS} days. One Bappa.`
              : count === 0
                ? 'Be the first to leave something.'
                : `${count.toLocaleString()} ${
                    count === 1 ? 'offering has' : 'offerings have'
                  } become part of him.`}
          </p>
        )}

        <button className="whisper" onClick={beginVisarjan}>
          visarjan
        </button>
      </div>

      {/* The countdown. Set in the corner and kept quiet: it carries the
          stakes -- there is a limited time in which anyone can still add
          to him -- without ever reading as a promotional timer. */}
      <div
        className={`layer layer--countdown ${state === 'IDLE' ? 'in' : ''} ${
          settled ? 'is-settled' : ''
        }`}
      >
        {festival.phase !== 'ENDED' && !countdown.over && (
          <div className="clock">
            <span>
              <em>{String(countdown.days).padStart(2, '0')}</em> days
            </span>
            <span>
              <em>{String(countdown.hours).padStart(2, '0')}</em> hours
            </span>
            <span>
              <em>{String(countdown.minutes).padStart(2, '0')}</em> minutes
            </span>
          </div>
        )}
        <p className="clock-label">{describeDeadline(festival, countdown)}</p>
      </div>

      {/* ------------- CONTRIBUTING ------------- */}
      <div className={`layer layer--compose ${state === 'CONTRIBUTING' ? 'in' : ''}`}>
        {!chosen ? (
          <div className="choices">
            <p className="lede">What are you bringing?</p>
            <div className="choice-row">
              {OFFERINGS.map((o) => (
                <button
                  key={o.id}
                  className={`choice ${type === o.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setType(o.id);
                    setChosen(true);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="compose">
            <p className="lede">{active.prompt}</p>
            <textarea
              ref={inputRef}
              className="input"
              value={draft}
              maxLength={400}
              rows={3}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) offer();
              }}
            />
            <div className="compose-foot">
              <span className="note">Only you will ever read this.</span>
              <button className="quiet" onClick={offer} disabled={!draft.trim()}>
                Offer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* UNDERSTANDING and TRANSFORMING render nothing at all. */}

          {/* ---------------- COMPLETE ---------------- */}
          <div className={`layer layer--closing ${state === 'COMPLETE' ? 'in' : ''}`}>
            <p className="closing closing--first">You left something with Bappa.</p>
            <p className="closing closing--second">
              It&rsquo;s no longer yours to carry alone.
            </p>
          </div>
        </>
      )}

      {/* ---------------- VISARJAN ---------------- */}
      {/* Nothing is shown while he is going. The words wait for the dark
          to have been empty for a moment first -- the silence is doing
          most of the work, and language arriving early would spend it.
          Each line's delay comes from the same schedule the bell reads. */}
      <div
        className={`layer layer--farewell ${
          farewell >= VISARJAN_DURATION + DARKNESS_HOLD ? 'in' : ''
        }`}
      >
        {FAREWELL_LINES.map((line, i) => (
          <p
            key={line.text}
            className={`farewell farewell--${i + 1}`}
            style={{ transitionDelay: `${line.at}ms` }}
          >
            {line.text}
          </p>
        ))}
      </div>

      {/* Sound is the only persistent control, and it is nearly invisible.
          It goes too once he starts to leave: from that point on this is
          a film, and there is nothing left to operate. */}
      <button
        className={`sound ${state === 'VISARJAN' ? 'gone' : ''} ${sound === 'on' ? 'is-on' : ''}`}
        onClick={() => audio().toggle()}
        aria-pressed={sound === 'on'}
      >
        {sound === 'on' ? 'sound off' : 'sound on'}
      </button>
    </div>
  );
}
