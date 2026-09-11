'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { devStats } from './devtools';
import type { ParticleHandle } from '../components/ParticleField';
import type { PerfProfile } from '../systems/perf';

/**
 * Frame stats, sampled inside the render loop.
 *
 * Writes into a plain mutable object rather than a store: these values
 * change every frame, and routing them through React state would
 * re-render the panel sixty times a second just to print them.
 */
export function DevStats({
  perf,
  particles,
}: {
  perf: PerfProfile;
  particles: React.MutableRefObject<ParticleHandle>;
}) {
  const acc = useRef(0);
  const frames = useRef(0);

  useFrame((_, dt) => {
    acc.current += dt;
    frames.current += 1;

    // Averaged over a quarter second; an instantaneous 1/dt readout
    // flickers too much to read.
    if (acc.current >= 0.25) {
      devStats.fps = frames.current / acc.current;
      devStats.particles = particles.current.system?.count ?? 0;
      devStats.tier = perf.tier;
      acc.current = 0;
      frames.current = 0;
    }
  });

  return null;
}
