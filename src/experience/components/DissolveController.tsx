'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene } from '../state/sceneState';
import { formationWeight } from '../systems/SurfaceSampler';
import type { GanpatiHandle } from './GanpatiModel';

/**
 * Visarjan.
 *
 * Not a separate effect. It is the formation system run backwards: the
 * same material that became Bappa comes away from him, and the same
 * weight that decided when a piece arrived decides when it lets go. That
 * symmetry is the concept, so there is deliberately no second particle
 * system here -- this file only moves one number.
 *
 * The sequence is an authored timeline rather than physics, because the
 * pacing *is* the content: it takes longer than you expect, nothing about
 * it is violent, and it ends in absence rather than destruction.
 */

/** Seconds from the start of Visarjan to complete darkness: the curve's last key. */
export const VISARJAN_DURATION = 58;

/**
 * Seconds of darkness before the closing words begin.
 *
 * Counted from the end of the curve, and the sound is cut a little
 * earlier still -- the moment the last light has actually gone -- so what
 * is felt is roughly three seconds of total silence before the first word.
 */
export const DARKNESS_HOLD = 2;

/**
 * Keyframes: [seconds, dissolve].
 *
 * Dissolve runs past 1 on purpose. At 1 the last of the clay is gone, but
 * the material that just came away still needs time to drift out and fade
 * -- so the curve keeps climbing to 1.34, which is where the final grain
 * reaches zero. Ending at 1 is what used to leave particles hanging.
 */
const CURVE: Array<[number, number]> = [
  // 1. Stillness. He is whole, and nothing moves. Let him be looked at.
  [0, 0],
  [3, 0],
  // 2. First release: the crown, the ear tips, the edges of the cloth --
  //    the last things to have formed are the first to go.
  [10, 0.15],
  // 3. Material breakdown: solidity starts leaving the body.
  [24, 0.5],
  // 4. Particle Bappa: the silhouette is still his, but it is made of
  //    material again rather than clay. The curve almost stops here --
  //    seven seconds where he barely changes -- because this is the
  //    image the whole piece has been arguing toward, and running
  //    through it at the same rate as everything else threw it away.
  [33, 0.8],
  [40, 0.86],
  // 5. Release: the material stops holding the shape and drifts.
  [50, 1.16],
  // 6. Light, then nothing.
  [58, 1.34],
];

/**
 * Moments in the curve that other systems need to name, so they read them
 * from here rather than restating numbers that would drift.
 */
export const VISARJAN_MARKS = {
  /** Seconds: the particle Bappa stops holding his shape. */
  release: 40,
  /**
   * Dissolve at which nothing is visible any more. The longest-lived grain
   * is at 1.5% opacity and a third of its size here; it is gone.
   */
  empty: 1.335,
} as const;

export function visarjanDissolveAt(t: number): number {
  if (t <= CURVE[0][0]) return CURVE[0][1];
  for (let i = 1; i < CURVE.length; i++) {
    const [t1, v1] = CURVE[i];
    if (t <= t1) {
      const [t0, v0] = CURVE[i - 1];
      const k = (t - t0) / (t1 - t0);
      // Smoothstep between keys so no phase starts or stops abruptly.
      return v0 + (v1 - v0) * (k * k * (3 - 2 * k));
    }
  }
  return CURVE[CURVE.length - 1][1];
}

interface Props {
  ganpati: React.MutableRefObject<GanpatiHandle>;
}

export function DissolveController({ ganpati }: Props) {
  const wasVisarjan = useRef(false);

  useEffect(() => {
    ganpati.current.dissolve = 0;
  }, [ganpati]);

  useFrame(() => {
    const { state, elapsed } = useScene.getState();

    if (state !== 'VISARJAN') {
      if (wasVisarjan.current) {
        ganpati.current.dissolve = 0;
        wasVisarjan.current = false;
      }
      return;
    }

    wasVisarjan.current = true;
    ganpati.current.dissolve = visarjanDissolveAt(elapsed);
  });

  return null;
}

/**
 * World-space points on the sculpture's surface.
 *
 * Used as landing places for arriving offerings, so a contribution sinks
 * into the sculpture itself rather than fading somewhere near it. Sorted
 * by formation weight -- the same value everything else reads -- so a
 * caller can prefer parts of him that already exist.
 */
export function buildSurfaceSamples(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  maxPoints: number
): { points: Float32Array; weights: Float32Array } {
  const src = geometry.getAttribute('position') as THREE.BufferAttribute;
  const total = src.count;
  const stride = Math.max(1, Math.ceil(total / maxPoints));
  const n = Math.floor(total / stride);

  const points = new Float32Array(n * 3);
  const weights = new Float32Array(n);
  const v = new THREE.Vector3();

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const invH = 1 / Math.max(1e-4, bb.max.y - bb.min.y);

  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(src, i * stride);
    weights[i] = formationWeight(v.x, v.y, v.z, (v.y - bb.min.y) * invH);

    v.applyMatrix4(matrix);
    points[i * 3] = v.x;
    points[i * 3 + 1] = v.y;
    points[i * 3 + 2] = v.z;
  }

  return { points, weights };
}
