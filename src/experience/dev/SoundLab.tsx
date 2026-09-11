'use client';

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { SoundDirector } from '../audio/SoundDirector';
import type { EventPayload, ExperienceEvent } from '../audio/events';
import { ParticleSystem } from '../systems/ParticleSystem';
import { sampleTextPoints } from '../systems/TextSampler';
import { getPerfProfile } from '../systems/perf';
import {
  DURATION,
  FORM_HOLD,
  STILLNESS_BEFORE,
  glyphsToWorld,
} from '../components/ContributionController';
import { visarjanDissolveAt } from '../components/DissolveController';
import type { ContributionType, SceneStateName } from '../state/sceneState';

/**
 * The sound lab.
 *
 * Renders the piece's sound offline -- the real particle simulation, the
 * real director and the real AudioManager graph, on an OfflineAudioContext
 * with a simulated clock -- so it can be listened to with the picture
 * switched off, and measured. "Close your eyes: can you tell what is
 * happening?" is a question this page exists to answer.
 *
 * ?auto=all&sink=http://127.0.0.1:4599 renders every scenario and posts
 * the WAVs and an event log to a local sink.
 */

const SR = 44100;
const DT = 1 / 60;
const CENTER = new THREE.Vector3(0, 0.95, 0);
const SAMPLE = 'a small thing I have been carrying for a while now';

class Sim {
  state: SceneStateName = 'IDLE';
  elapsed = 0;
  type: ContributionType = 'GRATITUDE';
  dissolve = 0;
  readonly system: ParticleSystem;
  private spawned = false;
  private readonly budget: number;

  constructor() {
    const perf = getPerfProfile();
    this.system = new ParticleSystem(perf.offeringParticles, CENTER);
    this.budget = Math.floor(perf.offeringParticles * 0.85);
  }

  set(state: SceneStateName) {
    this.state = state;
    this.elapsed = 0;
    this.spawned = false;
  }

  offer(type: ContributionType) {
    this.type = type;
    this.set('UNDERSTANDING');
  }

  /** ContributionController and DissolveController, without React. */
  step(dt: number, time: number) {
    this.elapsed += dt;
    switch (this.state) {
      case 'UNDERSTANDING':
        if (!this.spawned && this.elapsed >= STILLNESS_BEFORE) {
          this.spawned = true;
          this.system.spawnFormation(this.anchors(), this.type, 0.5, 0.6, FORM_HOLD);
        }
        if (this.elapsed >= DURATION.UNDERSTANDING) {
          this.system.releaseFormation();
          this.set('TRANSFORMING');
        }
        break;
      case 'TRANSFORMING':
        if (this.elapsed >= DURATION.TRANSFORMING) this.set('COMPLETE');
        break;
      case 'COMPLETE':
        if (this.elapsed >= DURATION.COMPLETE) this.set('IDLE');
        break;
      case 'VISARJAN':
        this.dissolve = visarjanDissolveAt(this.elapsed);
        break;
    }
    this.system.update(dt, time, this.dissolve);
  }

  frame() {
    return {
      state: this.state,
      elapsed: this.elapsed,
      type: this.type,
      telemetry: this.system.telemetry,
      dissolve: this.dissolve,
      build: 0.45,
    };
  }

  /** The words where they would sit on a 1440x900 screen, from the offering camera. */
  private anchors(): Float32Array {
    const sampled = sampleTextPoints(SAMPLE, this.budget);
    if (!sampled) return new Float32Array(0);
    const size = { width: 1440, height: 900 };
    const camera = new THREE.PerspectiveCamera(34, size.width / size.height, 0.1, 40);
    camera.position.set(0, 1.05, 3.65);
    camera.lookAt(0, 1.14, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const width = 520;
    return glyphsToWorld(
      sampled.points,
      { left: (size.width - width) / 2, top: size.height * 0.6, width, height: width / sampled.aspect },
      camera,
      size
    );
  }
}

interface Scenario {
  seconds: number;
  /** Whether the room is already there, or arrives from silence. */
  settled: boolean;
  cues: Array<[number, (s: Sim) => void]>;
}

const single = (type: ContributionType): Scenario => ({
  seconds: 26,
  settled: true,
  cues: [
    [0.2, (s) => s.set('CONTRIBUTING')],
    [1.5, (s) => s.offer(type)],
  ],
});

const SCENARIOS: Record<string, Scenario> = {
  entry: {
    seconds: 40,
    settled: false,
    cues: [
      [14, (s) => s.set('CONTRIBUTING')],
      [30, (s) => s.set('IDLE')],
    ],
  },
  gratitude: single('GRATITUDE'),
  wish: single('WISH'),
  vighna: single('VIGHNA'),
  promise: single('PROMISE'),
  // Four people, one after another: identities must stay distinct and all
  // four must resolve into the same Bappa.
  sequence: {
    seconds: 96,
    settled: true,
    cues: [
      [1, (s) => s.offer('GRATITUDE')],
      [24, (s) => s.offer('WISH')],
      [47, (s) => s.offer('VIGHNA')],
      [70, (s) => s.offer('PROMISE')],
    ],
  },
  visarjan: {
    seconds: 96,
    settled: true,
    cues: [[1, (s) => s.set('VISARJAN')]],
  },
};

type Logged = [number, ExperienceEvent, EventPayload];

interface Result {
  buffer: AudioBuffer;
  events: Logged[];
  trace: number[][];
  ms: number;
}

async function render(name: string): Promise<Result> {
  const started = performance.now();
  const sc = SCENARIOS[name];
  const ctx = new OfflineAudioContext(2, Math.ceil(sc.seconds * SR), SR);
  let now = 0;

  const manager = new AudioManager();
  await manager.renderInto(ctx, () => now);

  const events: Logged[] = [];
  const trace: number[][] = [];
  let lastTrace = -1;
  const director = new SoundDirector((event, payload = {}) => {
    if (event === 'OFFERING_MOTION') {
      const m = payload.motion;
      if (m && now - lastTrace >= 0.1) {
        lastTrace = now;
        trace.push(
          [now, m.forming, m.gather, m.speed, m.proximity, m.density, m.rise, m.arrivalRate, m.broken, m.crackRate, m.growth, m.pan].map(
            (v) => Number(v.toFixed(3))
          )
        );
      }
    } else if (event !== 'VISARJAN_DISSOLVE') {
      const { motion: _omit, ...rest } = payload;
      events.push([Number(now.toFixed(3)), event, rest]);
    }
    manager.handle(event, payload);
  });

  const sim = new Sim();
  manager.playAmbient(sc.settled);
  const cues = [...sc.cues];

  for (let frame = 0; now < sc.seconds; frame++) {
    while (cues.length && cues[0][0] <= now) cues.shift()![1](sim);
    sim.step(DT, now);
    director.step(DT, sim.frame());
    manager.tick();
    now = (frame + 1) * DT;
  }

  const buffer = await ctx.startRendering();
  return { buffer, events, trace, ms: performance.now() - started };
}

function toWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const n = buffer.length;
  const out = new ArrayBuffer(44 + n * channels * 2);
  const v = new DataView(out);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * channels * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return out;
}

let autoStarted = false;

const TRACE_FIELDS = [
  't', 'forming', 'gather', 'speed', 'proximity', 'density', 'rise', 'arrivalRate', 'broken', 'crackRate', 'growth', 'pan',
];

export function SoundLab() {
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState<Record<string, { url: string; events: Logged[]; ms: number }>>({});

  const run = async (name: string, sink?: string | null) => {
    setStatus(`rendering ${name}`);
    const r = await render(name);
    const wav = toWav(r.buffer);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    setResults((prev) => ({ ...prev, [name]: { url, events: r.events, ms: r.ms } }));
    if (sink) {
      await fetch(`${sink}/${name}.wav`, { method: 'POST', body: wav });
      await fetch(`${sink}/${name}.json`, {
        method: 'POST',
        body: JSON.stringify({ events: r.events, fields: TRACE_FIELDS, trace: r.trace }),
      });
    }
  };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const auto = q.get('auto');
    // Strict mode runs effects twice in development; one batch is enough.
    if (!auto || autoStarted) return;
    autoStarted = true;
    const sink = q.get('sink');
    const names = auto === 'all' ? Object.keys(SCENARIOS) : auto.split(',');
    void (async () => {
      try {
        for (const name of names) await run(name, sink);
        setStatus('done');
      } catch (e) {
        setStatus(`error: ${(e as Error).message}`);
      }
    })();
  }, []);

  return (
    <div style={{ font: '12px/1.5 ui-monospace, monospace', color: '#cfd8e3', background: '#0b0f14', minHeight: '100vh', padding: 24 }}>
      <h1 style={{ fontSize: 14, margin: '0 0 4px' }}>sound lab</h1>
      <p style={{ margin: '0 0 16px', color: '#7d8a99' }}>
        Offline renders of the real simulation, director and mix. Headphones.
      </p>
      <p id="lab-status" style={{ margin: '0 0 16px' }}>
        status: {status}
      </p>
      {Object.keys(SCENARIOS).map((name) => (
        <div key={name} style={{ borderTop: '1px solid #1d2733', padding: '10px 0' }}>
          <button onClick={() => void run(name)} style={{ font: 'inherit', marginRight: 12 }}>
            render {name}
          </button>
          {results[name] && (
            <>
              <audio controls src={results[name].url} style={{ verticalAlign: 'middle', height: 28 }} />
              <span style={{ marginLeft: 12, color: '#7d8a99' }}>{Math.round(results[name].ms)} ms</span>
              <div style={{ color: '#7d8a99', marginTop: 6 }}>
                {results[name].events.map(([t, e]) => `${t.toFixed(2)} ${e}`).join('  ·  ')}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
