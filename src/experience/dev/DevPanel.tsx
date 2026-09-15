'use client';

import { useEffect, useState } from 'react';
import { useScene, type SceneStateName, type ContributionType } from '../state/sceneState';
import { useCollective, TARGET_OFFERINGS } from '../state/collective';
import {
  getFestivalStatus,
  describeRemaining,
  setClockOffset,
  getClockOffset,
  FESTIVAL_START,
  FESTIVAL_END,
  FESTIVAL_DAYS,
} from '../state/festival';
import { VISARJAN_DURATION, DARKNESS_HOLD } from '../components/DissolveController';
import {
  currentFormation,
  formationFrom,
  setFormationOverride,
  getFormationOverride,
  describeFormation,
} from '../state/formation';
import { useDev, devStats } from './devtools';
import { audio } from '../audio/AudioManager';

/**
 * The development panel.
 *
 * Deliberately plain -- monospace, boxy, high contrast. It should never
 * be mistaken for part of the piece, and it should be obvious in a
 * screenshot that what you are looking at is instrumented.
 *
 * Hidden behind the backtick key so it stays out of the way while
 * actually looking at the scene.
 */

const STATES: SceneStateName[] = [
  'IDLE',
  'CONTRIBUTING',
  'UNDERSTANDING',
  'TRANSFORMING',
  'COMPLETE',
  'VISARJAN',
];

/** How long each state runs, for the scrub slider's range. */
const SPAN: Record<SceneStateName, number> = {
  IDLE: 20,
  CONTRIBUTING: 20,
  UNDERSTANDING: 3.4,
  TRANSFORMING: 16,
  COMPLETE: 11,
  // Past the darkness and through the closing words, or the scrub can
  // never reach them -- the slider clamps to its max, and the farewell
  // begins after the dissolve has already finished.
  VISARJAN: VISARJAN_DURATION + DARKNESS_HOLD + 32,
};

const TYPES: ContributionType[] = ['GRATITUDE', 'WISH', 'VIGHNA', 'PROMISE'];

/** Stand-in text for a one-click offering, so the real path gets exercised. */
const SAMPLE = 'a small thing I have been carrying for a while now';

const DAYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const DAY_MS = 24 * 60 * 60 * 1000;

export function DevPanel() {
  const open = useDev((s) => s.open);
  const toggle = useDev((s) => s.toggle);
  const timeScale = useDev((s) => s.timeScale);
  const setTimeScale = useDev((s) => s.setTimeScale);

  const count = useCollective((s) => s.count);

  // Polled rather than subscribed: `elapsed` changes every frame, and a
  // reactive read here would re-render the panel with it.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal the key while someone is writing an offering.
      const el = document.activeElement;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return;
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);

    // Expose helpers for visual and automation testing
    (window as unknown as { __BAPPA_DEV__?: unknown }).__BAPPA_DEV__ = {
      standAtDay,
      setClockOffset,
      getClockOffset,
      setFormationOverride,
      getFormationOverride,
      currentFormation,
      describeFormation,
      getFestivalStatus,
      setCount: (n: number) => useCollective.getState().setCount(n),
      getCount: () => useCollective.getState().count,
      useScene,
      useCollective,
      useDev,
    };

    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [toggle]);

  const scene = useScene.getState();
  const festival = getFestivalStatus();
  const formation = currentFormation();
  const overridden = getFormationOverride() !== null;

  /** Jumps the festival clock so a given day is "now". */
  const standAtDay = (day: number) => {
    const wantedNow = FESTIVAL_START.getTime() + (day - 0.5) * DAY_MS;
    setClockOffset(wantedNow - Date.now());
    force((n) => n + 1);
  };

  const currentModel = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('model') || 'optimized')
    : 'optimized';

  const switchModel = (m: string) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('model', m);
    window.location.href = url.toString();
  };

  if (!open) {
    return (
      <button className="dev-tab" onClick={toggle} title="Development controls (`)">
        dev
      </button>
    );
  }

  const offer = (type: ContributionType) => {
    const s = useScene.getState();
    s.setType(type);
    s.setDraft(SAMPLE);
    // The same door a real submission uses: the director hears the state
    // change and the simulation, so this auditions exactly what a visitor
    // would hear.
    audio().init();
    s.setState('UNDERSTANDING');
  };

  return (
    <div className="dev-panel">
      <div className="dev-head">
        <strong>dev</strong>
        <span>
          {devStats.fps.toFixed(0)} fps · {devStats.particles.toLocaleString()} particles ·{' '}
          {devStats.tier}
        </span>
        <button onClick={toggle}>×</button>
      </div>

      {/* ---- state machine ---- */}
      <div className="dev-row">
        <label>state</label>
        <div className="dev-btns">
          {STATES.map((s) => (
            <button
              key={s}
              className={scene.state === s ? 'on' : ''}
              onClick={() => useScene.getState().setState(s)}
            >
              {s.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ---- scrub within the current state ---- */}
      <div className="dev-row">
        <label>
          t <em>{scene.elapsed.toFixed(1)}s</em>
        </label>
        <input
          type="range"
          min={0}
          max={SPAN[scene.state]}
          step={0.1}
          value={Math.min(scene.elapsed, SPAN[scene.state])}
          onChange={(e) => useScene.getState().setElapsed(Number(e.target.value))}
        />
      </div>

      <div className="dev-row">
        <label>
          speed <em>{timeScale}×</em>
        </label>
        <div className="dev-btns">
          {[0, 0.5, 1, 2, 4, 8].map((v) => (
            <button key={v} className={timeScale === v ? 'on' : ''} onClick={() => setTimeScale(v)}>
              {v === 0 ? 'pause' : `${v}×`}
            </button>
          ))}
        </div>
      </div>

      {/* ---- the ten-day formation ---- */}
      {/* The control that matters most: step through day one to day ten
          without waiting ten days, or touching the system clock. */}
      <div className="dev-row">
        <label>
          day <em>{overridden ? 'manual' : festival.day || festival.phase.toLowerCase()}</em>
        </label>
        <div className="dev-btns">
          {DAYS.map((d) => (
            <button
              key={d}
              onClick={() => {
                // Shift the clock rather than override formation, so the
                // real day -> formation -> copy pipeline is exercised.
                standAtDay(d);
                setFormationOverride(null);
              }}
              title={`Stand at day ${d} with the current tally`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="dev-row">
        <label>
          formation <em>{(formation * 100).toFixed(0)}%</em>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={formation}
          onChange={(e) => {
            setFormationOverride(Number(e.target.value));
            force((n) => n + 1);
          }}
        />
        <button
          className={!overridden ? 'on' : ''}
          onClick={() => {
            setFormationOverride(null);
            force((n) => n + 1);
          }}
          title="Stop overriding; follow the real day and tally again"
        >
          auto
        </button>
      </div>

      <div className="dev-row">
        <label>
          offerings <em>{count.toLocaleString()}</em>
        </label>
        <div className="dev-btns">
          {[0, 1, 10, 60, 300, TARGET_OFFERINGS].map((n) => (
            <button
              key={n}
              onClick={() => {
                setFormationOverride(null);
                void useCollective.getState().setCount(n);
              }}
            >
              {n}
            </button>
          ))}
          <button onClick={() => void useCollective.getState().record()}>+1</button>
        </div>
      </div>

      {/* ---- run a real offering end to end ---- */}
      <div className="dev-row">
        <label>offer</label>
        <div className="dev-btns">
          {TYPES.map((t) => (
            <button key={t} onClick={() => offer(t)}>
              {t.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ---- 3D model selection (local debugging) ---- */}
      <div className="dev-row">
        <label>model</label>
        <div className="dev-btns">
          <button
            className={currentModel === 'old' || currentModel === 'backup' ? 'on' : ''}
            onClick={() => switchModel('old')}
            title="Old model (~19k triangles, 1.01 MB)"
          >
            old (19k)
          </button>
          <button
            className={currentModel === 'new' || currentModel === 'raw' ? 'on' : ''}
            onClick={() => switchModel('new')}
            title="New uncompressed model (~946k triangles, 28.38 MB)"
          >
            new (946k)
          </button>
          <button
            className={currentModel === 'optimized' ? 'on' : ''}
            onClick={() => switchModel('optimized')}
            title="New optimized model (~150k triangles, 5.13 MB)"
          >
            opt (150k)
          </button>
        </div>
      </div>

      {/* ---- the ten days ---- */}
      <div className="dev-row">
        <label>
          day <em>{festival.phase === 'ACTIVE' ? festival.day : festival.phase.toLowerCase()}</em>
        </label>
        <div className="dev-btns">
          <button onClick={() => (setClockOffset(0), force((n) => n + 1))}>real</button>
          <button
            onClick={() => {
              // 5 seconds before Sthapana: watch the live transition occur
              setClockOffset(FESTIVAL_START.getTime() - 5000 - Date.now());
              force((n) => n + 1);
            }}
            title="5s before Sthapana"
          >
            pre
          </button>
          <button
            onClick={() => {
              // Start of Sthapana arrival sequence
              setClockOffset(FESTIVAL_START.getTime() - Date.now());
              force((n) => n + 1);
            }}
            title="Exact Sthapana moment"
          >
            sthapana
          </button>
          {[1, 5, 10].map((d) => (
            <button key={d} onClick={() => standAtDay(d)}>
              d{d}
            </button>
          ))}
          <button
            onClick={() => {
              // Visarjan start
              const end = FESTIVAL_END.getTime();
              setClockOffset(end - Date.now());
              force((n) => n + 1);
            }}
            title="Exact Visarjan moment"
          >
            visarjan
          </button>
          <button
            onClick={() => {
              // Long after Visarjan has settled
              const end = FESTIVAL_END.getTime();
              setClockOffset(end + 120_000 - Date.now());
              force((n) => n + 1);
            }}
            title="Settled post-Visarjan"
          >
            post
          </button>
        </div>
      </div>

      <div className="dev-note">
        {describeFormation(formation, festival.day)} · {describeRemaining(festival)}
        {getClockOffset() !== 0 && <span className="dev-warn"> · clock shifted</span>}
      </div>
    </div>
  );
}
