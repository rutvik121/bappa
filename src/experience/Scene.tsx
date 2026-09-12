'use client';

import { Suspense, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

import { GanpatiModel, type GanpatiHandle } from './components/GanpatiModel';
import { LightingSystem } from './components/LightingSystem';
import { AbsorptionLight } from './components/AbsorptionLight';
import { CameraController } from './components/CameraController';
import { ParticleField, type ParticleHandle } from './components/ParticleField';
import { SmokeSystem } from './components/SmokeSystem';
import { DustField } from './components/DustField';
import {
  DissolveController,
  buildSurfaceSamples,
} from './components/DissolveController';
import { setSurfaceTargets } from './systems/ParticleSystem';
import { ContributionController } from './components/ContributionController';
import { SoundBridge } from './audio/SoundBridge';
import { DevStats } from './dev/DevStats';
import type { PerfProfile } from './systems/perf';

/**
 * Scene graph assembly. Deliberately flat: each system is independent,
 * reads SceneState, and communicates through narrow imperative handles
 * rather than React state, so nothing here re-renders during the ritual.
 */
export function Scene({ perf, devStats = false }: { perf: PerfProfile; devStats?: boolean }) {
  const ganpati = useRef<GanpatiHandle>({ dissolve: 0 });
  const particles = useRef<ParticleHandle>({ system: null });

  // Sampled once when the GLB resolves; the sort is O(n log n) on ~14k
  // points at most, which is a single frame's hitch during the loader.
  const onGeometry = useCallback(
    (geo: THREE.BufferGeometry, matrix: THREE.Matrix4) => {
      const { points, weights } = buildSurfaceSamples(geo, matrix, perf.surfaceTargets);
      // The same points an arriving offering sinks into, so it joins the
      // sculpture itself rather than fading somewhere near it -- and the
      // weights, so it can pick the part of him that is still being made
      // rather than any part at all.
      setSurfaceTargets(points, weights);
    },
    [perf.surfaceTargets]
  );

  return (
    <>
      {/* Near-black, not black: a trace of warmth so the darkness reads
          as a room with air in it rather than as a void. */}
      <color attach="background" args={['#050403']} />
      <fog attach="fog" args={['#050403', 7, 17]} />

      <CameraController />
      <LightingSystem perf={perf} />
      <AbsorptionLight particles={particles} />

      <Suspense fallback={null}>
        <GanpatiModel
          perf={perf}
          handle={ganpati}
          particles={particles}
          onGeometry={onGeometry}
        />
      </Suspense>

      <ParticleField perf={perf} handle={particles} ganpati={ganpati} />
      <SmokeSystem perf={perf} />
      <DustField perf={perf} />

      {devStats && <DevStats perf={perf} particles={particles} />}

      <ContributionController perf={perf} particles={particles} />
      <DissolveController ganpati={ganpati} />
      {/* Last, so it hears this frame's simulation and dissolve. */}
      <SoundBridge particles={particles} ganpati={ganpati} />

      {perf.postprocessing && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          {/* Bloom is doing the work of a lens, not of a glow filter:
              a high threshold means only the ember highlights blow. */}
          <Bloom
            intensity={0.28}
            luminanceThreshold={0.86}
            luminanceSmoothing={0.2}
            mipmapBlur
            radius={0.72}
          />
          {/* Gentle: Bappa fills the frame on the push-in, so a tight vignette
              darkens the sculpture itself rather than only the surround. */}
          <Vignette offset={0.45} darkness={0.5} blendFunction={BlendFunction.NORMAL} />
          {/* Grain hides banding in the long dark falloffs, which is
              where 8-bit gradients would otherwise be very visible. */}
          <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.18} />
        </EffectComposer>
      )}
    </>
  );
}
