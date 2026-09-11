'use client';

import * as THREE from 'three';
import { sampleSurface } from './SurfaceSampler';

/**
 * The material Bappa is made of.
 *
 * Each point carries one piece of his surface. Before its moment it
 * drifts loose in roughly the right place; at its moment it settles onto
 * the surface and fades out, because the clay it was carrying has
 * arrived underneath it. Nothing crossfades and nothing is swapped: the
 * particle *is* the material, and it stops existing by becoming solid.
 *
 * Animated entirely in the vertex shader from two uniforms. Target
 * positions are static in the buffer, so thirty thousand points cost one
 * draw call and no per-frame CPU work at all -- which is what keeps this
 * viable on a phone.
 */

const vertexShader = /* glsl */ `
  attribute float aWeight;   // when this piece of surface becomes clay, 0..1
  attribute float aSeed;

  uniform float uFormation;  // how much of him exists
  uniform float uDissolve;   // visarjan, runs the same axis backwards
  uniform float uTime;
  uniform float uScale;

  varying float vAlpha;
  varying float vGather;
  varying float vRelease;
  varying float vSeed;

  void main() {
    float ahead = aWeight - uFormation;
    float loose = 1.0 - step(aWeight, uFormation);
    float gather = 1.0 - smoothstep(0.0, 0.5, max(ahead, 0.0));

    // --- visarjan ---
    // The same axis, walked backwards: the last thing to form is the
    // first to let go. Everything past that moment is a finite life, not
    // a state -- which is what stops material hanging in the air forever
    // once the sculpture has gone.
    float releasedAt = 1.0 - aWeight;
    float past = max(0.0, uDissolve - releasedAt);
    // Each grain takes its own time to go. A shared duration made the
    // tail end all at once, which reads as a system being switched off;
    // a ragged one lets the final few wink out one by one.
    //
    // The ceiling is not cosmetic. The last grain to let go does so at
    // uDissolve 1.0 and the curve ends at 1.34, so any span longer than
    // 0.34 leaves something still faintly alight after the darkness has
    // begun -- which is the one thing this sequence may not do.
    float span = 0.16 + aSeed * 0.18;
    float rel = clamp(past / span, 0.0, 1.0);   // 0 just let go, 1 gone

    vec3 drift = vec3(
      sin(uTime * 0.31 + aSeed * 6.28),
      sin(uTime * 0.23 + aSeed * 4.13),
      cos(uTime * 0.27 + aSeed * 5.31)
    );

    // Suspension before its moment: hugging the surface it will become.
    float spread = (0.004 + clamp(ahead, 0.0, 1.0) * 0.014) * (0.4 + aSeed * 0.9);
    vec3 p = position + drift * spread;

    // Release: outward from the body and upward, accelerating as it goes.
    // Local space, which the model scales by ~6.6 -- so this carries the
    // material well clear of where he stood.
    vec3 outward = normalize(position + vec3(0.0, 0.04, 0.0));
    float ease = rel * rel;
    p += (outward * 0.30 + vec3(0.0, 0.42, 0.0)) * ease;
    p += drift * ease * 0.10;

    // Loose dust that never became clay still has to go.
    // Dense enough to hold the surface: sparse specks read as absence.
    float looseAlpha = loose * mix(0.55, 1.0, gather) * (1.0 - smoothstep(0.0, 0.35, uDissolve));

    // Released material: bright as it comes away, gone by the end of its
    // own short life.
    float bound = 1.0 - loose;
    float releaseAlpha = bound * step(0.0001, past) * (1.0 - rel);

    vAlpha = max(looseAlpha, releaseAlpha);
    vGather = gather;
    vRelease = rel;
    vSeed = aSeed;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Grain coarsens as it gathers, and shrinks to a point of light as
    // it leaves.
    float grain = (0.35 + aSeed * 0.5) * mix(0.7, 1.25, gather) * mix(1.0, 0.35, rel);
    gl_PointSize = clamp(grain * uScale / max(-mv.z, 0.1), 1.0, 6.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vGather;
  varying float vRelease;
  varying float vSeed;

  void main() {
    if (vAlpha <= 0.002) discard;

    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;

    float core = pow(1.0 - d, 2.2);
    float ang = atan(uv.y, uv.x);
    core *= 0.85 + 0.15 * sin(ang * 3.0 + vSeed * 9.0);

    // Earth, not light. Dark suspension warms toward terracotta as it
    // gathers -- and on the way out, past terracotta into a small warm
    // point of light, which is the last thing seen of him.
    // Warm enough to read as terracotta dust against the black. Darker
    // than this and an unfinished passage of him -- sometimes part of his
    // face -- read as a burnt hole in the sculpture rather than as clay
    // that has not yet settled.
    vec3 dust = vec3(0.5, 0.28, 0.16);
    vec3 clay = vec3(0.74, 0.42, 0.23);
    vec3 light = vec3(1.0, 0.78, 0.48);

    vec3 col = mix(dust, clay, vGather);
    col = mix(col, light, smoothstep(0.35, 1.0, vRelease));

    gl_FragColor = vec4(col, core * vAlpha * 0.62);
  }
`;

export interface FormationCloud {
  points: THREE.Points;
  uniforms: Record<string, THREE.IUniform>;
  dispose: () => void;
}

export function createFormationCloud(
  geometry: THREE.BufferGeometry,
  count: number,
  shared: { uFormation: THREE.IUniform; uDissolve: THREE.IUniform; uTime: THREE.IUniform }
): FormationCloud {
  const samples = sampleSurface(geometry, count);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(samples.positions, 3));
  geo.setAttribute('aWeight', new THREE.BufferAttribute(samples.weights, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(samples.seeds, 1));

  // The cloud never leaves the sculpture's own bounds by more than the
  // drift, so the mesh's bounds with a small margin are exact enough.
  geometry.computeBoundingSphere();
  const src = geometry.boundingSphere!;
  geo.boundingSphere = new THREE.Sphere(src.center.clone(), src.radius * 1.2);

  const uniforms: Record<string, THREE.IUniform> = {
    uFormation: shared.uFormation,
    uDissolve: shared.uDissolve,
    uTime: shared.uTime,
    uScale: { value: 300 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // Normal blending, not additive: additive is what makes particles
    // look like light. This material is meant to look like matter.
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, material);
  points.renderOrder = 2;

  return {
    points,
    uniforms,
    dispose: () => {
      geo.dispose();
      material.dispose();
    },
  };
}
