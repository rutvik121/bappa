'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene } from '../state/sceneState';
import { BAPPA_CENTER } from './GanpatiModel';
import type { PerfProfile } from '../systems/perf';

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
    const { state } = useScene.getState();

    // The key light breathes on a long, irregular cycle -- the visual
    // signature of an oil flame rather than a bulb. Two detuned sines
    // never repeat audibly within a session.
    const flicker =
      1 + Math.sin(t * 1.9) * 0.018 + Math.sin(t * 0.63) * 0.026 + Math.sin(t * 4.1) * 0.008;

    // Intimacy comes from the camera and the thickening haze, not from
    // more light -- raising the key here only flattened the clay.
    const intimacy = state === 'CONTRIBUTING' || state === 'UNDERSTANDING' ? 1.04 : 1.0;

    // Visarjan extinguishes the room. The key holds while there is still
    // a body to light, then goes out over the last twenty seconds, which
    // is what leaves absence rather than an empty lit stage.
    let extinction = 1;
    if (state === 'VISARJAN') {
      const { elapsed } = useScene.getState();
      extinction = 1 - Math.min(1, Math.max(0, (elapsed - 30) / 26));
      extinction *= extinction;
    }

    if (key.current) key.current.intensity = 34 * flicker * intimacy * extinction;
    if (rim.current) rim.current.intensity = 26 * (2 - flicker) * extinction;
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
      <pointLight position={[0.6, 0.25, 1.9]} color="#ffc79c" intensity={0.7} decay={2} distance={5} />

      {/* Ambient is deliberately near-nothing: just enough that the
          unlit side is not pure black clipping. */}
      <hemisphereLight args={['#3a2a1e', '#050303', 0.05]} />
      <ambientLight color="#2a1e14" intensity={0.035} />
    </>
  );
}

