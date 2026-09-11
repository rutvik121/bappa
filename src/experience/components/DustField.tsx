'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BAPPA_CENTER } from './GanpatiModel';
import { useScene } from '../state/sceneState';
import type { PerfProfile } from '../systems/perf';

/**
 * Ambient motes suspended in the key light.
 *
 * Entirely GPU-animated: positions are static in the buffer and displaced
 * in the vertex shader, so this costs one uniform write per frame no
 * matter how many motes are on screen. It is background texture, not a
 * simulation, and it never needs to be.
 */
const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  attribute float aDrift;

  uniform float uTime;
  uniform float uScale;
  uniform float uOpacity;

  varying float vAlpha;

  void main() {
    vec3 p = position;

    // Three slow, mutually irrational drifts. Nothing loops visibly.
    float t = uTime * aDrift;
    p.x += sin(t * 0.21 + aSeed * 6.28) * 0.30;
    p.y += sin(t * 0.13 + aSeed * 3.14) * 0.22 + sin(t * 0.05) * 0.10;
    p.z += cos(t * 0.17 + aSeed * 4.71) * 0.30;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // Motes are only visible where the key light reaches: brightest in a
    // band above and left of centre, invisible in the deep background.
    float lit = smoothstep(3.2, 0.6, length(p - vec3(-1.0, 2.2, 1.2)));
    float twinkle = 0.55 + sin(uTime * 1.1 + aSeed * 12.0) * 0.45;

    vAlpha = lit * twinkle * uOpacity;

    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 3.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = pow(1.0 - d, 3.0);
    gl_FragColor = vec4(vec3(0.85, 0.6, 0.38), core * vAlpha * 0.22);
  }
`;

export function DustField({ perf }: { perf: PerfProfile }) {
  const { size } = useThree();

  const geometry = useMemo(() => {
    const n = perf.dustParticles;
    const pos = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const seeds = new Float32Array(n);
    const drift = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      // A tall box around Bappa rather than a sphere: dust hangs in the
      // volume of the room, not in a bubble around the sculpture.
      pos[i * 3] = (Math.random() - 0.5) * 8.5;
      pos[i * 3 + 1] = BAPPA_CENTER.y + (Math.random() - 0.35) * 5.0;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 7.0;

      sizes[i] = 0.5 + Math.random() * 1.6;
      seeds[i] = Math.random();
      drift[i] = 0.4 + Math.random() * 0.8;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
    geo.boundingSphere = new THREE.Sphere(BAPPA_CENTER.clone(), 8);
    return geo;
  }, [perf.dustParticles]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uScale: { value: 300 }, uOpacity: { value: 1 } }),
    []
  );

  useEffect(() => {
    uniforms.uScale.value = size.height * 0.022;
  }, [size.height, uniforms]);

  useFrame(() => {
    uniforms.uTime.value = performance.now() * 0.001;

    // Nothing of his outlives him, including the air around him. Set
    // directly from elapsed so reaching zero does not depend on how many
    // frames happened to be drawn.
    const { state, elapsed } = useScene.getState();

    // Unrelated motion quiets while a contribution is happening, so the
    // offering is the only thing moving. Stillness is what makes the one
    // event legible.
    let target = 1;
    if (state === 'UNDERSTANDING' || state === 'TRANSFORMING') target = 0.25;
    else if (state === 'CONTRIBUTING') target = 0.6;
    else if (state === 'VISARJAN') target = Math.max(0, 1 - elapsed / 32);

    uniforms.uOpacity.value += (target - uniforms.uOpacity.value) * 0.03;
    if (state === 'VISARJAN') uniforms.uOpacity.value = target;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
