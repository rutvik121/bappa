'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

import { useCollective } from '../state/collective';
import { useScene } from '../state/sceneState';
import { BAPPA_CENTER } from './GanpatiModel';
import type { PerfProfile } from '../systems/perf';
import type { ParticleHandle } from './ParticleField';

/**
 * Someone else left something with him.
 *
 * This is the other half of the collective: the offerings a visitor did
 * not make. They arrive from the server as a few numbers -- a type, an
 * intensity, a seed -- and this decides how to show them, which is the
 * whole point of sending semantics instead of animation.
 *
 * They are shown ONE AT A TIME. A hundred people at once is not a hundred
 * bursts; it is a queue, and the tally runs ahead of it. What the server
 * knows and what this browser has got round to showing are different
 * numbers on purpose.
 *
 * What another person left has no words attached -- there were never any
 * to attach, nothing readable ever crossed the wire -- so it does not
 * assemble into text the way your own does. It gathers out of the dark
 * around him and goes in, which is what an offering looks like from the
 * outside.
 */

/** A breath between one offering finishing and the next beginning. */
const BETWEEN = 2.2;

/** How long one arrival is given before the next may start. */
const PRESENT_FOR = 7.5;

/** Material carried by someone else's offering, as a share of the budget. */
const SHARE = 0.34;

export function CollectivePresenter({
  perf,
  particles,
}: {
  perf: PerfProfile;
  particles: React.MutableRefObject<ParticleHandle>;
}) {
  const busy = useRef(0);
  const gap = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);

    if (busy.current > 0) {
      busy.current -= dt;
      return;
    }
    if (gap.current > 0) {
      gap.current -= dt;
      return;
    }

    // Never over the top of the visitor's own ritual. Their offering is
    // theirs alone for the length of it, and someone else's material
    // arriving mid-sentence would take that away.
    const state = useScene.getState().state;
    if (state !== 'IDLE') return;

    const system = particles.current.system;
    if (!system) return;

    const next = useCollective.getState().takeNext();
    if (!next) return;

    const budget = Math.floor(perf.offeringParticles * SHARE);
    system.spawnFormation(
      ringAround(budget, next.seed),
      next.type,
      next.seed,
      // Their intensity, kept well under a first-person offering: this is
      // something noticed happening, not something being done.
      Math.min(0.7, 0.25 + next.intensity * 0.45),
      0.4
    );

    // It never held a shape, so there is nothing to hold it in: it is let
    // go on the same frame and simply travels.
    system.releaseFormation();

    busy.current = PRESENT_FOR;
    gap.current = BETWEEN;
  });

  return null;
}

/**
 * Where someone else's material comes from.
 *
 * Out of the dark around him rather than off the glass in front of the
 * viewer: it is not addressed to them and should not appear to be. A
 * loose band at his height, thrown by the offering's own seed so no two
 * arrive from the same place.
 */
function ringAround(count: number, seed: number): Float32Array {
  const out = new Float32Array(count * 3);
  const rand = mulberry(seed);

  // One arc per offering, so its material reads as a single body of clay
  // coming from one direction rather than a sphere closing in.
  const heading = rand() * Math.PI * 2;
  const spread = 0.9 + rand() * 0.7;

  for (let i = 0; i < count; i++) {
    const a = heading + (rand() - 0.5) * spread;
    const radius = 2.6 + rand() * 1.5;
    const rise = (rand() - 0.35) * 1.4;

    out[i * 3] = Math.cos(a) * radius;
    out[i * 3 + 1] = BAPPA_CENTER.y + rise;
    out[i * 3 + 2] = Math.sin(a) * radius * 0.55 + 0.6;
  }

  return out;
}

/** Small deterministic PRNG, so one offering always arrives the same way. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
