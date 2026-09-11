'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { simplex3d } from '../shaders/noise.glsl';
import { useScene } from '../state/sceneState';
import { BAPPA_CENTER } from './GanpatiModel';
import type { PerfProfile } from '../systems/perf';

/**
 * Incense haze as a small stack of camera-facing billboards drawn in one
 * instanced call. Each layer scrolls the same noise field at a different
 * rate and scale, which is what produces parallax within the smoke
 * instead of a flat animated texture.
 */
const vertexShader = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aScale;
  attribute float aSeed;
  attribute float aSpeed;

  uniform float uTime;

  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;

  void main() {
    vUv = uv;
    vSeed = aSeed;

    // Each billboard rises, then wraps back to the base -- a continuous
    // column with no visible reset because opacity is zero at both ends.
    float travel = fract(aSeed + uTime * aSpeed * 0.014);
    vec3 world = aOffset;
    world.y += travel * 3.4;
    world.x += sin(travel * 3.1 + aSeed * 6.28) * 0.42 * travel;
    world.z += cos(travel * 2.3 + aSeed * 4.71) * 0.34 * travel;

    // Fades in off the ground and out at the top of its climb.
    vFade = smoothstep(0.0, 0.22, travel) * (1.0 - smoothstep(0.55, 1.0, travel));

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    // Screen-aligned: widen as it climbs, the way real smoke expands.
    float s = aScale * (0.5 + travel * 2.6);
    mv.xy += position.xy * s;

    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;

  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;

  ${simplex3d}

  void main() {
    vec2 p = vUv - 0.5;
    // Streak mask: tight across the ribbon, generous along it. A circular
    // mask made every quad read as a discrete puff; incense is a ribbon.
    float mx = 1.0 - smoothstep(0.02, 0.5, abs(p.x));
    float my = 1.0 - smoothstep(0.22, 0.5, abs(p.y));
    float mask = mx * my;
    if (mask <= 0.001) discard;

    // Stretched along the direction of travel, so the grain smears
    // vertically the way rising smoke actually does.
    float n = fbm(vec3(p.x * 11.0, p.y * 2.6, uTime * 0.09 + vSeed * 12.0));
    n = n * 0.5 + 0.5;

    // Thin the smoke aggressively: the density curve is what keeps this
    // reading as atmosphere rather than as fog geometry.
    float density = pow(n * mask, 3.4) * vFade;

    gl_FragColor = vec4(uColor, density * uOpacity);
  }
`;

export function SmokeSystem({ perf }: { perf: PerfProfile }) {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0.05 },
      // Smoke is lit by the key light, so it is warm, not grey.
      uColor: { value: new THREE.Color('#8a5a38') },
    }),
    []
  );

  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 2.8);

    geo.index = plane.index;
    geo.attributes.position = plane.attributes.position;
    geo.attributes.uv = plane.attributes.uv;

    const n = perf.smokeLayers;
    const offset = new Float32Array(n * 3);
    const scale = new Float32Array(n);
    const seed = new Float32Array(n);
    const speed = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      // Two thin sources set back and to the sides, the way agarbatti
      // would actually be placed -- never centred in front of the face.
      const side = i % 2 === 0 ? -1 : 1;
      offset[i * 3] = side * (0.95 + Math.random() * 0.35);
      offset[i * 3 + 1] = BAPPA_CENTER.y - 0.85;
      offset[i * 3 + 2] = -0.45 + Math.random() * 0.35;

      scale[i] = 0.22 + Math.random() * 0.2;
      seed[i] = i / n + Math.random() * 0.05;
      speed[i] = 0.7 + Math.random() * 0.6;
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed, 1));
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(BAPPA_CENTER.clone(), 8);

    plane.dispose();
    return geo;
  }, [perf.smokeLayers]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const { state, elapsed } = useScene.getState();
    uniforms.uTime.value = performance.now() * 0.001;

    // The haze thickens slightly as the visitor comes closer, and thins
    // to nothing once Bappa is gone -- the room empties of him and of it.
    let target = 0.05;
    if (state === 'CONTRIBUTING' || state === 'UNDERSTANDING') target = 0.075;
    if (state === 'TRANSFORMING') target = 0.065;
    // The room empties of him and of his incense.
    //
    // Driven straight off elapsed rather than eased toward a target: an
    // easing only reaches zero if enough frames happen to be drawn, and
    // "nothing remains" has to be a guarantee rather than a tendency.
    if (state === 'VISARJAN') {
      uniforms.uOpacity.value = Math.max(0, 0.05 * (1 - elapsed / 34));
      return;
    }

    uniforms.uOpacity.value += (target - uniforms.uOpacity.value) * 0.01;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, perf.smokeLayers]}
      frustumCulled={false}
      renderOrder={2}
    >
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}
