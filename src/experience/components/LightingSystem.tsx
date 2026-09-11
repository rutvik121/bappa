'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene, type ContributionType } from '../state/sceneState';
import { BAPPA_CENTER } from './GanpatiModel';
import type { PerfProfile } from '../systems/perf';

/**
 * How the room answers the offering a visitor has chosen. Deliberately
 * small: a warmer key for gratitude, a lifted rim for a wish, a heavier,
 * darker room for a vighna, a livelier fill for a promise. It should be
 * felt, not noticed.
 */
const MOOD: Record<ContributionType, { key: number; rim: number; fill: number; color: string }> = {
  GRATITUDE: { key: 1.07, rim: 0.95, fill: 1.2, color: '#ffd4ac' },
  WISH: { key: 1.03, rim: 1.2, fill: 1.0, color: '#ffe8d2' },
  VIGHNA: { key: 0.84, rim: 0.8, fill: 0.7, color: '#ffdcc2' },
  PROMISE: { key: 1.0, rim: 1.05, fill: 1.45, color: '#ffe2c0' },
};

const BASE_KEY = new THREE.Color('#ffe0c2');

/**
 * One key, one rim, a whisper of fill. Intensities are in candela with
 * inverse-square decay, so the falloff into the surrounding black is
 * physical rather than art-directed -- that is what produces the deep
 * negative space instead of a grey wash.
 */
export function LightingSystem({ perf }: { perf: PerfProfile }) {
  const { scene } = useThree();
  const key = useRef<THREE.SpotLight>(null);
  const rim = useRef<THREE.SpotLight>(null);
  const fill = useRef<THREE.PointLight>(null);
  const mood = useRef({ key: 1, rim: 1, fill: 1 });
  const moodColor = useRef(new THREE.Color());

  /**
   * A spotlight aims at its `target` object's world position, and that
   * object must itself be in the scene graph. Passing the target as a JSX
   * prop cannot work here: the ref is still null on the first render, so
   * both lights would silently keep their default target at the world
   * origin -- which is Bappa's feet, not his centre.
   */
  useEffect(() => {
    const aim = new THREE.Object3D();
    aim.position.copy(BAPPA_CENTER);
    scene.add(aim);

    if (key.current) key.current.target = aim;
    if (rim.current) rim.current.target = aim;

    return () => {
      scene.remove(aim);
    };
  }, [scene]);

  useFrame(() => {
    const t = performance.now() * 0.001;
    const { state, mood: chosen } = useScene.getState();

    // The key light breathes on a long, irregular cycle -- the visual
    // signature of an oil flame rather than a bulb.
    const flicker =
      1 + Math.sin(t * 1.9) * 0.018 + Math.sin(t * 0.63) * 0.026 + Math.sin(t * 4.1) * 0.008;

    // Eased toward the chosen offering over a couple of seconds, and back.
    const m = chosen ? MOOD[chosen] : null;
    const e = 0.02;
    mood.current.key += ((m?.key ?? 1) - mood.current.key) * e;
    mood.current.rim += ((m?.rim ?? 1) - mood.current.rim) * e;
    mood.current.fill += ((m?.fill ?? 1) - mood.current.fill) * e;
    if (key.current) {
      moodColor.current.set(m?.color ?? BASE_KEY);
      key.current.color.lerp(moodColor.current, e);
    }

    // Visarjan extinguishes the room. The key holds while there is still
    // a body to light, then goes out over the last twenty seconds, which
    // is what leaves absence rather than an empty lit stage.
    let extinction = 1;
    if (state === 'VISARJAN') {
      const { elapsed } = useScene.getState();
      extinction = 1 - Math.min(1, Math.max(0, (elapsed - 30) / 26));
      extinction *= extinction;
    }

    if (key.current) key.current.intensity = 34 * flicker * mood.current.key * extinction;
    if (rim.current) rim.current.intensity = 26 * (2 - flicker) * mood.current.rim * extinction;
    if (fill.current) fill.current.intensity = 0.7 * mood.current.fill * extinction;
  });

  return (
    <>
      {/* Key: high, forward, camera-left. Wide penumbra so the shadow
          terminator across the clay stays soft. */}
      <spotLight
        ref={key}
        position={[-2.9, 3.6, 2.0]}
        angle={0.52}
        penumbra={0.62}
        decay={2}
        distance={16}
        color="#ffe0c2"
        intensity={34}
        castShadow={perf.shadows}
        shadow-mapSize={perf.tier === 'high' ? [2048, 2048] : [1024, 1024]}
        shadow-bias={-0.0012}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={14}
      />

      {/* Rim: behind and camera-right, grazing the silhouette so the
          form separates from the black without lifting the background. */}
      <spotLight
        ref={rim}
        position={[2.9, 2.0, -2.4]}
        angle={0.7}
        penumbra={1}
        decay={2}
        distance={14}
        color="#ffa768"
        intensity={9}
      />

      {/* Fill: a dim warm bounce from below-front, standing in for the
          light a floor would throw back. Never enough to read as a light. */}
      <pointLight ref={fill} position={[0.6, 0.25, 1.9]} color="#ffc79c" intensity={0.7} decay={2} distance={5} />

      {/* Ambient is deliberately near-nothing: just enough that the
          unlit side is not pure black clipping. */}
      <hemisphereLight args={['#3a2a1e', '#050303', 0.05]} />
      <ambientLight color="#2a1e14" intensity={0.035} />
    </>
  );
}
