'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ParticleSystem } from '../systems/ParticleSystem';
import { useScene } from '../state/sceneState';
import { BAPPA_CENTER, type GanpatiHandle } from './GanpatiModel';
import type { PerfProfile } from '../systems/perf';

/**
 * Procedural point sprite. No texture atlas: the falloff, the grain and
 * the flicker are all computed per fragment, which keeps the look of
 * *material* (ash, clay dust, ember) rather than a bloom-lit dot.
 */
const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aWarmth;
  attribute float aSeed;

  uniform float uScale;
  uniform float uTime;

  varying float vAlpha;
  varying float vWarmth;
  varying float vSeed;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    // Per-particle flicker on two detuned frequencies -- an ember never
    // pulses on a single clean sine.
    float flick = 0.82
      + sin(uTime * 2.3 + aSeed * 6.28) * 0.11
      + sin(uTime * 0.9 + aSeed * 2.71) * 0.07;

    vAlpha = aAlpha * flick;
    vWarmth = aWarmth;
    vSeed = aSeed;

    gl_Position = projectionMatrix * mv;
    // Perspective size attenuation, clamped so near particles never
    // blow out into screen-filling quads on a phone.
    gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 6.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vWarmth;
  varying float vSeed;

  uniform float uTime;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;

    // Soft core with a long tail; the exponent is what separates
    // "glowing speck of matter" from "glitter".
    float core = pow(1.0 - d, 2.6);

    // Slight angular irregularity so grains are not perfect circles.
    float ang = atan(uv.y, uv.x);
    float grain = 0.88 + 0.12 * sin(ang * 3.0 + vSeed * 9.0);
    core *= grain;

    // Warmth ramp: cold ash -> fired clay -> ember -> warm gold. It stops
    // at gold on purpose: a white point on black is a star, and an
    // offering on its way to a clay murti must never read as space.
    vec3 ash   = vec3(0.055, 0.032, 0.026);
    vec3 clay  = vec3(0.56, 0.25, 0.11);
    vec3 ember = vec3(0.92, 0.50, 0.22);
    vec3 light = vec3(1.00, 0.70, 0.40);

    vec3 col = mix(ash, clay, smoothstep(0.0, 0.42, vWarmth));
    col = mix(col, ember, smoothstep(0.38, 0.75, vWarmth));
    col = mix(col, light, smoothstep(0.78, 1.0, vWarmth));

    // Dark fragments must still occlude-read as matter, so they keep a
    // faint rim even at near-zero warmth.
    float rim = smoothstep(0.75, 1.0, d) * (1.0 - vWarmth) * 0.35;
    col += vec3(0.18, 0.08, 0.04) * rim;

    // Additive, and brighter than the formation material on purpose.
    // The three materials must never merge: clay is matte and heavy,
    // atmosphere is almost absent, and this -- the thing a person just
    // gave -- is the only luminous element in the frame.
    gl_FragColor = vec4(col, core * vAlpha);
  }
`;

export interface ParticleHandle {
  system: ParticleSystem | null;
}

interface Props {
  perf: PerfProfile;
  handle: React.MutableRefObject<ParticleHandle>;
  /** Read so offerings in flight leave with him when Visarjan begins. */
  ganpati: React.MutableRefObject<GanpatiHandle>;
}

export function ParticleField({ perf, handle, ganpati }: Props) {
  const { size } = useThree();
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const system = useMemo(() => {
    // Offerings only. Visarjan no longer spawns anything into this pool
    // -- it runs the formation material backwards instead -- so it no
    // longer carries headroom for fragments it will never hold.
    //
    // No ambient shell either: how many offerings there have been is
    // expressed by how much of Bappa exists, not by a halo around him.
    return new ParticleSystem(perf.offeringParticles, BAPPA_CENTER);
  }, [perf.offeringParticles]);

  useEffect(() => {
    handle.current.system = system;
    return () => {
      handle.current.system = null;
      system.dispose();
    };
  }, [system, handle]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScale: { value: 12 },
    }),
    []
  );

  // Point size must track viewport height, or particles change physical
  // size when the window resizes / a phone rotates.
  useEffect(() => {
    // Tuned so a size-1.0 grain is a few pixels across at conversation
    // distance. Anything larger stops reading as suspended material.
    uniforms.uScale.value = size.height * 0.030;
  }, [size.height, uniforms]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = performance.now() * 0.001;
    // Offerings in flight go with him when he goes.
    system.update(dt, t, ganpati.current.dissolve);
    uniforms.uTime.value = t;
  });

  return (
    <points geometry={system.geometry} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        depthTest
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
