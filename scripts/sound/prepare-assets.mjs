#!/usr/bin/env node
/**
 * Prepares the sound of BAPPA from its sources.
 *
 *   npm run sound:prepare          (needs ffmpeg on PATH)
 *
 * The sources in scripts/sound/source are generated recordings (Magnific:
 * ElevenLabs music and sound effects) -- tanpura and bansuri, a pandal at
 * night, ghanti and ghanta, dhol and tasha, a shankh. They arrive at
 * whatever level and length the generator chose, often with a breath of
 * silence at the front. This script makes them behave like instruments:
 *
 *   loop     leading silence trimmed, made seamless with an equal-power
 *            crossfade, RMS normalised to -20 dBFS, and followed by a short
 *            wrapped tail so decoder padding never lands in the loop points.
 *   oneshot  onset moved to sample zero, trailing silence trimmed with a
 *            fade, peak normalised to -1 dBFS.
 *
 * It writes public/audio/*.mp3 and src/experience/audio/assets.ts, the
 * manifest the engine reads. Levels between assets are then set in
 * src/experience/audio/score.ts, not here.
 *
 * To replace a sound: drop a new file into scripts/sound/source under the
 * same name and run this again.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(ROOT, 'scripts', 'sound', 'source');
const OUT = join(ROOT, 'public', 'audio');
const MANIFEST = join(ROOT, 'src', 'experience', 'audio', 'assets.ts');
const WORK = join(tmpdir(), 'bappa-sound-prepare');

/**
 * Every asset. `xfade` is the loop crossfade in seconds (long for music, so
 * the seam is a phrase dissolving into another rather than a cut). `rate`
 * is the storage sample rate for sounds with nothing near the top.
 */
const ASSETS = [
  // --- the space ---
  { name: 'bhakti-ambience', kind: 'loop', channels: 2, xfade: 5 },
  { name: 'pandal-night', kind: 'loop', channels: 2, xfade: 1.5, rate: 32000 },

  // --- gratitude: the approach ---
  { name: 'marigold-petals', kind: 'oneshot', channels: 1 },

  // --- wish: the approach ---
  { name: 'ghungroo', kind: 'oneshot', channels: 1 },
  { name: 'bansuri-rise', kind: 'oneshot', channels: 1 },

  // --- vighna: the approach ---
  { name: 'dhol-knock-1', kind: 'oneshot', channels: 1, rate: 32000 },
  { name: 'dhol-knock-2', kind: 'oneshot', channels: 1, rate: 32000 },
  { name: 'dhol-knock-3', kind: 'oneshot', channels: 1, rate: 32000 },
  { name: 'dhol-roll', kind: 'loop', channels: 1, xfade: 0.8, rate: 32000 },
  { name: 'coconut-break', kind: 'oneshot', channels: 1 },

  // --- promise: the approach ---
  { name: 'diya-light', kind: 'oneshot', channels: 1 },
  { name: 'tabla-pulse', kind: 'loop', channels: 1, xfade: 0.6 },

  // --- Bappa received it: one sound for all four ---
  // A fingertip on dry clay, then the clay body answering.
  { name: 'clay-touch-1', kind: 'oneshot', channels: 1 },
  { name: 'clay-touch-2', kind: 'oneshot', channels: 1 },
  { name: 'clay-touch-3', kind: 'oneshot', channels: 1 },
  { name: 'ghatam-1', kind: 'oneshot', channels: 1 },
  { name: 'ghatam-2', kind: 'oneshot', channels: 1 },
  { name: 'ghatam-3', kind: 'oneshot', channels: 1 },

  // --- arriving ---
  { name: 'temple-ghanta', kind: 'oneshot', channels: 1 },

  // --- Visarjan ---
  { name: 'dhol-tasha', kind: 'loop', channels: 2, xfade: 3 },
  { name: 'clay-crumble', kind: 'loop', channels: 1, xfade: 0.8 },
  { name: 'gulal-dust', kind: 'oneshot', channels: 1 },
  { name: 'shankh-final', kind: 'oneshot', channels: 2 },
];

const db = (v) => Math.pow(10, v / 20);
const toDb = (v) => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);

function decode(file, channels) {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-ar', String(SR), '-'],
    { maxBuffer: 1024 * 1024 * 512 }
  );
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = all.length / channels;
  return Array.from({ length: channels }, (_, c) => {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = all[i * channels + c];
    return ch;
  });
}

const peakOf = (chs) => chs.reduce((m, c) => c.reduce((p, v) => Math.max(p, Math.abs(v)), m), 0);
const rmsOf = (chs) => {
  let s = 0;
  let n = 0;
  for (const c of chs) for (const v of c) (s += v * v), n++;
  return Math.sqrt(s / Math.max(1, n));
};

/** First and last sample above a threshold relative to the file's own peak. */
function bounds(chs, relDb) {
  const limit = peakOf(chs) * db(relDb);
  const n = chs[0].length;
  let first = 0;
  let last = n - 1;
  outer: for (; first < n; first++) for (const c of chs) if (Math.abs(c[first]) > limit) break outer;
  outer2: for (; last > first; last--) for (const c of chs) if (Math.abs(c[last]) > limit) break outer2;
  return [first, last];
}

function slice(chs, from, to) {
  return chs.map((c) => c.slice(Math.max(0, from), Math.min(c.length, to)));
}

function fadeOut(chs, sec) {
  const n = Math.round(sec * SR);
  for (const c of chs) for (let i = 0; i < n && i < c.length; i++) c[c.length - 1 - i] *= i / n;
  return chs;
}

function fadeIn(chs, sec) {
  const n = Math.round(sec * SR);
  for (const c of chs) for (let i = 0; i < n && i < c.length; i++) c[i] *= i / n;
  return chs;
}

/** Seamless loop by equal-power crossfade of the end into the start, plus a wrapped tail. */
function loopify(chs, xfadeSec, tailSec = 0.35) {
  const X = Math.round(xfadeSec * SR);
  const L = chs[0].length - X;
  return chs.map((c) => {
    const y = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      if (i < X) {
        const k = i / X;
        y[i] = c[i] * Math.sin((k * Math.PI) / 2) + c[L + i] * Math.cos((k * Math.PI) / 2);
      } else {
        y[i] = c[i];
      }
    }
    const T = Math.round(tailSec * SR);
    const out = new Float32Array(L + T);
    out.set(y);
    for (let i = 0; i < T; i++) out[L + i] = y[i % L];
    return out;
  });
}

function wav(path, chs) {
  const n = chs[0].length;
  const c = chs.length;
  const out = Buffer.alloc(44 + n * c * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + n * c * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(c, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * c * 2, 28);
  out.writeUInt16LE(c * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(n * c * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < c; k++) {
      const v = Math.max(-1, Math.min(1, chs[k][i]));
      out.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  writeFileSync(path, out);
}

mkdirSync(OUT, { recursive: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// Anything in public/audio that is no longer in the list is removed, so a
// retired sound never ships as dead weight.
const keep = new Set(ASSETS.map((a) => `${a.name}.mp3`));
for (const f of readdirSync(OUT)) {
  if (f.endsWith('.mp3') && !keep.has(f)) rmSync(join(OUT, f));
}

const manifest = {};
const report = [];
const missing = [];

for (const a of ASSETS) {
  manifest[a.name] =
    a.kind === 'loop' ? { kind: 'loop', loop: 0, channels: a.channels } : { kind: 'oneshot', channels: a.channels };

  const src = join(SOURCE, `${a.name}.mp3`);
  if (!existsSync(src)) {
    missing.push(a.name);
    delete manifest[a.name];
    continue;
  }

  let chs = decode(src, a.channels);

  if (a.kind === 'oneshot') {
    // Onset at sample zero: the engine fires these on the exact frame
    // something happens, so a generator's breath of silence at the front
    // would put the sound behind the picture.
    const [first, last] = bounds(chs, -45);
    chs = slice(chs, first - Math.round(0.004 * SR), last + Math.round(0.25 * SR));
    fadeIn(chs, 0.004);
    fadeOut(chs, 0.2);
    const g = db(-1) / (peakOf(chs) || 1);
    chs = chs.map((c) => c.map((v) => v * g));
  } else {
    const [first, last] = bounds(chs, -40);
    chs = slice(chs, first, last + 1);
    chs = loopify(chs, a.xfade);
    const L = chs[0].length - Math.round(0.35 * SR);
    manifest[a.name].loop = Number((L / SR).toFixed(4));
    let g = db(-20) / (rmsOf(chs.map((c) => c.subarray(0, L))) || 1);
    const peak = peakOf(chs) * g;
    if (peak > db(-1)) g *= db(-1) / peak;
    chs = chs.map((c) => c.map((v) => v * g));
  }

  const tmp = join(WORK, `${a.name}.wav`);
  wav(tmp, chs);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', tmp,
    ...(a.rate ? ['-ar', String(a.rate)] : []),
    '-codec:a', 'libmp3lame', '-q:a', a.channels === 2 ? '6' : '5',
    join(OUT, `${a.name}.mp3`),
  ]);

  report.push(
    `${a.name.padEnd(18)} ${a.kind.padEnd(8)} ${(chs[0].length / SR).toFixed(2).padStart(6)}s  ` +
      `peak ${toDb(peakOf(chs)).padStart(6)}  rms ${toDb(rmsOf(chs)).padStart(6)}`
  );
}

writeFileSync(
  MANIFEST,
  `/**
 * GENERATED by scripts/sound/prepare-assets.mjs -- do not edit by hand.
 *
 * loop     RMS -20 dBFS; the first \`loop\` seconds are the seamless cycle.
 * oneshot  peak -1 dBFS; onset at sample zero.
 */

export const ASSETS = ${JSON.stringify(manifest, null, 2)} as const;

export type AssetName = keyof typeof ASSETS;
`
);

console.log(report.join('\n'));
if (missing.length) console.log(`\nmissing sources (skipped): ${missing.join(', ')}`);
