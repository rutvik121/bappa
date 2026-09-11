'use client';

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScene } from '../state/sceneState';
import { useCollective } from '../state/collective';
import { emit } from './events';
import { SoundDirector } from './SoundDirector';
import type { ParticleHandle } from '../components/ParticleField';
import type { GanpatiHandle } from '../components/GanpatiModel';

/**
 * Hands the director one frame of the scene.
 *
 * Mounted after the particle field and the dissolve controller, so it
 * reads this frame's simulation rather than the last one -- which is what
 * puts the contact tone on the same frame as the light.
 */
export function SoundBridge({
  particles,
  ganpati,
}: {
  particles: React.MutableRefObject<ParticleHandle>;
  ganpati: React.MutableRefObject<GanpatiHandle>;
}) {
  const director = useMemo(() => new SoundDirector(emit), []);

  useFrame((_, rawDt) => {
    const s = useScene.getState();
    director.step(Math.min(rawDt, 1 / 20), {
      state: s.state,
      elapsed: s.elapsed,
      type: s.type,
      telemetry: particles.current.system?.telemetry ?? null,
      dissolve: ganpati.current.dissolve,
      build: useCollective.getState().build,
    });
  });

  return null;
}
