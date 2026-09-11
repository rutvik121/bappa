'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BAPPA_CENTER } from './GanpatiModel';
import type { ParticleHandle } from './ParticleField';

/**
 * Bappa answering.
 *
 * A warm light held inside the sculpture, driven directly by the rate at
 * which offerings are being absorbed rather than by an authored curve.
 * Nothing arrives, nothing lights; a stream of arrivals makes him glow
 * from within and settle again as it thins.
 *
 * Kept separate from LightingSystem because that rig describes the room,
 * and this one describes a response.
 */
export function AbsorptionLight({
  particles,
}: {
  particles: React.MutableRefObject<ParticleHandle>;
}) {
  const light = useRef<THREE.PointLight>(null);
  const smoothed = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (!light.current) return;

    const glow = particles.current.system?.glow ?? 0;

    // Smoothed on the way up and down so a single particle cannot make
    // the room flicker; the light swells rather than blinks.
    smoothed.current += (glow - smoothed.current) * Math.min(1, dt * 3.2);

    const t = performance.now() * 0.001;
    const breath = 1 + Math.sin(t * 2.4) * 0.05;

    // The clay itself now lights up where an offering lands, so this is
    // only a supporting fill -- and it goes out with him.
    // Kept low: any more and the clay reads as lit from inside by fire --
    // an orange glow across his whole body rather than something received.
    light.current.intensity = smoothed.current * 0.45 * breath;
  });

  return (
    <pointLight
      ref={light}
      // Just inside the body, low, so the glow reads as coming from
      // within the clay rather than from a lamp placed in front of it.
      position={[0, BAPPA_CENTER.y - 0.25, 0.1]}
      color="#ffb877"
      intensity={0}
      distance={3.4}
      decay={2}
    />
  );
}
