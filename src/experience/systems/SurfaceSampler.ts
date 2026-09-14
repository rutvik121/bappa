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
 * He is built the way a murti is actually built: from the base upward.
 * The base and the lap settle first, then the torso, then the arms and
 * the head, and the outermost passages of every level -- the outer hands,
 * the tips of the ears, the crown -- last. Visarjan walks the same axis
 * backwards, so the crown is the first thing to let go and the base the
 * last thing standing.
 *
 * Height dominates deliberately. A murti under construction has a
 * *frontier*: a level the material has reached, below which it is clay
 * and above which it is still being brought. That is what makes an
 * offering legible as having helped -- it goes somewhere specific and
 * that place becomes solid. The earlier centre-out ordering spread the
 * unfinished passages evenly over the whole body, which is what made it
 * read as speckles on a finished sculpture instead.
 *
 * The noise is what keeps it from reading as a progress bar: the frontier
 * is ragged and clay climbs in tongues, the way wet material actually
 * builds up, never as a level line sweeping up him.
 */
export function formationWeight(x: number, y: number, z: number, b: FormBounds): number {
  const heightNorm = (y - b.minY) * b.invHeight;
  const radial = Math.min(1, Math.hypot((x - b.cx) * b.invHalfX, (z - b.cz) * b.invHalfZ));
  // Two octaves: the broad one breaks the frontier into tongues, the fine
  // one gives its edge a grain so it crumbles rather than cuts.
  const n = smoothNoise(x * 3.1, y * 2.2, z * 3.1) * 0.72 + smoothNoise(x * 9.4, y * 9.4, z * 9.4) * 0.28;
  const baseWeight = heightNorm * 0.62 + radial * 0.17 + n * 0.21;

  // Identity-first regional hierarchy calibrated to ganpati.glb geometry:
  // Head dome, face, trunk, and ears resolve early so Bappa is immediately recognizable.
  // Crown (mukut) begins above the head dome (heightNorm > 0.76) and emerges across Days 1-10.
  const absZ = Math.abs(z - b.cz);
  const isCrown = heightNorm > 0.76;
  const isTrunk = heightNorm >= 0.36 && heightNorm <= 0.60 && x > 0.04 && absZ < 0.08;
  const isHeadFace = heightNorm >= 0.50 && heightNorm <= 0.76 && absZ < 0.17;
  const isEar = heightNorm >= 0.48 && heightNorm <= 0.76 && absZ >= 0.17;
  const isTorso = heightNorm >= 0.28 && heightNorm < 0.50;
  const isBase = heightNorm < 0.28;

  if (isTrunk) {
    // Trunk resolves ~100% on Day 1
    return Math.min(baseWeight * 0.45, 0.40);
  }
  if (isHeadFace) {
    // Head dome, forehead, and face resolve ~100% on Day 1
    return Math.min(baseWeight * 0.52, 0.45);
  }
  if (isEar) {
    // Ears resolve ~100% on Day 1
    const earRadial = Math.min(1, Math.max(0, (absZ - 0.17) / (0.345 - 0.17)));
    return Math.min(baseWeight * 0.65, 0.42 + earRadial * 0.08);
  }
  if (isCrown) {
    // Crown forms progressively: base rim at Day 1 (0.54) climbing to peak at Day 10 (1.00)
    const crownHeight = Math.min(1.0, Math.max(0, (heightNorm - 0.76) / (1.0 - 0.76)));
    return Math.min(1.0, 0.54 + crownHeight * 0.43 + n * 0.03);
  }
  if (isTorso) {
    // Torso resolves smoothly (~95-100% on Day 1)
    return Math.min(1, Math.max(0, baseWeight * 0.90));
  }
  if (isBase) {
    // Base & folded legs resolve (~75-85% on Day 1)
    return Math.min(1, Math.max(0, baseWeight * 0.88));
  }

  return Math.min(1, Math.max(0, baseWeight));
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
