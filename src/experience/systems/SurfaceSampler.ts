'use client';

import * as THREE from 'three';

/**
 * Turns the Ganpati mesh into material.
 *
 * Every system that needs to know "when does this part of Bappa exist?"
 * asks this module, and they all get the same answer from the same
 * function. That shared answer is what lets a particle and the clay
 * beneath it hand off to each other exactly: the particle vanishes at the
 * instant the surface it was carrying arrives.
 *
 * The value is called a *formation weight*: 0 exists from the first
 * moment, 1 is the last thing to appear.
 */

/**
 * Smooth, deterministic, cheap. Trigonometric rather than simplex because
 * this runs over ~22k vertices and ~30k samples at load, and because the
 * fragment shader no longer computes noise at all -- it reads the baked
 * attribute instead, which is both exact and considerably cheaper on a
 * phone.
 */
function smoothNoise(x: number, y: number, z: number): number {
  const a =
    Math.sin(x * 2.1 + y * 0.9) * 0.5 +
    Math.sin(y * 1.7 - z * 1.3) * 0.3 +
    Math.sin(z * 2.3 + x * 1.1) * 0.2;
  const b = Math.sin((x + y + z) * 3.7) * 0.18;
  return Math.min(1, Math.max(0, (a + b) * 0.5 + 0.5));
}

/**
 * The shape of the sculpture, for normalising positions against it.
 */
export interface FormBounds {
  minY: number;
  invHeight: number;
  cx: number;
  cz: number;
  invHalfX: number;
  invHalfZ: number;
}

export function formBounds(geometry: THREE.BufferGeometry): FormBounds {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  return {
    minY: bb.min.y,
    invHeight: 1 / Math.max(1e-4, bb.max.y - bb.min.y),
    cx: (bb.min.x + bb.max.x) / 2,
    cz: (bb.min.z + bb.max.z) / 2,
    invHalfX: 2 / Math.max(1e-4, bb.max.x - bb.min.x),
    invHalfZ: 2 / Math.max(1e-4, bb.max.z - bb.min.z),
  };
}

/**
 * When each part of him arrives.
 *
 * He forms from the centre out: the face, the trunk and the body first,
 * the outer hands, the ears and the edges of the base last -- the way a
 * murti is finished, and so that no visitor on any day meets a Bappa whose
 * face is the part still missing. Visarjan walks the same order backwards,
 * so the extremities are the first to let go and the face the last.
 *
 * Noise keeps the unfinished passages irregular, like clay still being
 * worked, rather than a clean radial wipe.
 */
export function formationWeight(x: number, y: number, z: number, b: FormBounds): number {
  const n = smoothNoise(x * 6.5, y * 6.5, z * 6.5);
  const heightNorm = (y - b.minY) * b.invHeight;
  const radial = Math.min(1, Math.hypot((x - b.cx) * b.invHalfX, (z - b.cz) * b.invHalfZ));
  return Math.min(1, Math.max(0, n * 0.38 + radial * 0.5 + heightNorm * 0.12));
}

export interface SurfaceSamples {
  /** xyz triples, in the geometry's own local space. */
  positions: Float32Array;
  /** Formation weight per sample, 0..1. */
  weights: Float32Array;
  /** Stable per-particle randomness: drift phase, size jitter. */
  seeds: Float32Array;
  count: number;
}

/**
 * Area-weighted sampling across the mesh's triangles.
 *
 * Sampling vertices instead would clump material wherever the asset
 * happens to be densely tessellated -- around the face and ornaments --
 * and leave the broad forms bare. Weighting by triangle area distributes
 * material by actual surface, which is what makes the accumulation read
 * as clay rather than as a point cloud.
 */
export function sampleSurface(geometry: THREE.BufferGeometry, count: number): SurfaceSamples {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();

  const triCount = index ? index.count / 3 : pos.count / 3;

  // Cumulative triangle areas, so a uniform random number can be mapped
  // to a triangle in O(log n).
  const cumulative = new Float32Array(triCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    total += ab.cross(ac).length() * 0.5;
    cumulative[t] = total;
  }

  const bounds = formBounds(geometry);

  const positions = new Float32Array(count * 3);
  const weights = new Float32Array(count);
  const seeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Binary search the cumulative areas.
    const target = Math.random() * total;
    let lo = 0;
    let hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }

    const i0 = index ? index.getX(lo * 3) : lo * 3;
    const i1 = index ? index.getX(lo * 3 + 1) : lo * 3 + 1;
    const i2 = index ? index.getX(lo * 3 + 2) : lo * 3 + 2;

    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);

    // Uniform barycentric point in the triangle.
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    const x = a.x * w + b.x * u + c.x * v;
    const y = a.y * w + b.y * u + c.y * v;
    const z = a.z * w + b.z * u + c.z * v;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    weights[i] = formationWeight(x, y, z, bounds);
    seeds[i] = Math.random();
  }

  return { positions, weights, seeds, count };
}

/**
 * Bakes the same weight onto every vertex of the mesh.
 *
 * The material discards fragments whose interpolated weight has not been
 * reached yet, so the clay appears exactly where the particles carrying
 * it have arrived. Baking it also takes the noise out of the fragment
 * shader entirely, which is the cheaper as well as the truer answer.
 */
export function bakeVertexWeights(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('aFormWeight')) return;

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const bounds = formBounds(geometry);

  const out = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    out[i] = formationWeight(pos.getX(i), pos.getY(i), pos.getZ(i), bounds);
  }

  geometry.setAttribute('aFormWeight', new THREE.BufferAttribute(out, 1));
}
