'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useScene } from '../state/sceneState';
import { useBoot } from '../state/boot';
import { currentFormation } from '../state/formation';
import { bakeVertexWeights } from '../systems/SurfaceSampler';
import { createFormationCloud, type FormationCloud } from '../systems/FormationCloud';
import type { PerfProfile } from '../systems/perf';
import { ParticleSystem, setFormationLevel } from '../systems/ParticleSystem';
import type { ParticleHandle } from './ParticleField';
import { getRitualState, getSthapanaArrival } from '../state/festival';
import { VISARJAN_DURATION } from './DissolveController';

export function getGanpatiModelUrl(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const m = params.get('model');
    if (m === 'backup' || m === 'old') return '/models/ganpati.backup.glb';
    if (m === 'raw' || m === 'new' || m === 'full') return '/models/ganpati.glb?v=2';
    if (m === 'optimized') return '/models/ganpati.optimized.glb?v=1';
  }
  return '/models/ganpati.optimized.glb?v=1';
}

export const GANPATI_URL = '/models/ganpati.optimized.glb?v=1';

/** Where Bappa sits. Every other system aims at this point. */
export const BAPPA_CENTER = new THREE.Vector3(0, 0.95, 0);
/** Normalised height in world units -- the asset ships at ~0.35. */
const TARGET_HEIGHT = 2.3;
/**
 * Yaw applied to bring the sculpture around to face the viewer.
 * The asset is authored facing +X; a quarter turn clockwise about Y puts
 * the trunk and eyes toward the camera at +Z. (A quarter turn the other
 * way looks plausible at a glance but presents the back of the mukut.)
 */
const MODEL_FACING = -Math.PI * 0.5;

/** How many arrival points the clay can be lit by at once. */
const IMPACT_SLOTS = 6;


export interface GanpatiHandle {
  /** 0 = whole, 1 = fully dissolved. Driven by DissolveController. */
  dissolve: number;
}

interface Props {
  perf: PerfProfile;
  handle: React.MutableRefObject<GanpatiHandle>;
  /** Read for the points where offerings have just entered the clay. */
  particles: React.MutableRefObject<ParticleHandle>;
  /** Receives the normalised surface geometry once loaded. */
  onGeometry?: (geo: THREE.BufferGeometry, matrix: THREE.Matrix4) => void;
}

/**
 * Surface visibility, shared by the visible material and the depth pass.
 *
 * One baked per-vertex weight decides everything: when a piece of Bappa
 * forms, and when it lets go. Formation and visarjan are the same axis
 * run in opposite directions -- the last thing to arrive is the first
 * thing to leave -- which is why there is no second noise field here and
 * no noise in the shader at all. Reading an attribute is also markedly
 * cheaper per fragment than an fbm, which matters on a phone.
 */
const grainFn = /* glsl */ `
  // One value per grain of clay, in the mesh's own space so the grains
  // stay put on the surface as the camera drifts. ~2-3px on screen.
  float bappaGrain(vec3 p) {
    vec3 q = fract(floor(p * 560.0) * 0.1031);
    q += dot(q, q.zyx + 31.32);
    return fract((q.x + q.y) * q.z);
  }
`;

/**
 * Where there is clay, and where there is not yet any.
 *
 * Above the frontier he has not been made: there is no surface there, and
 * what stands in its place is the material still gathering, drawn by the
 * formation cloud. This is the whole concept in four lines -- an offering
 * brings material, the material settles, and the clay under it begins to
 * exist. Painting the unmade passages as duller clay instead (which is
 * what this did before) meant a finished sculpture was always sitting
 * there and the offerings could only ever look like decoration on it.
 *
 * The grain is what keeps it from cutting: the frontier crumbles over a
 * few millimetres of his surface, so clay climbs in tongues and grains
 * rather than along a line. Visarjan runs the same axis backwards.
 */
const carveChunk = /* glsl */ `
  if (uFormation <= 0.0001) discard;
  if (uFormation < 0.999) {
    float ahead = vFormWeight - uFormation;
    if (ahead > 0.0 && bappaGrain(vLocalPos) < clamp(ahead / 0.05, 0.0, 1.0)) discard;
  }

  if (uDissolve > 0.0001) {
    float behind = vFormWeight - (1.0 - uDissolve);
    if (behind > 0.0 && bappaGrain(vLocalPos) > 1.0 - clamp(behind / 0.07, 0.0, 1.0)) discard;
  }
`;

export function GanpatiModel({ perf, handle, particles, onGeometry }: Props) {
  const { size } = useThree();
  const modelUrl = typeof window !== 'undefined' ? getGanpatiModelUrl() : GANPATI_URL;
  const { scene } = useGLTF(modelUrl);
  const group = useRef<THREE.Group>(null);
  const cloud = useRef<FormationCloud | null>(null);
  const surfaceMesh = useRef<THREE.Mesh | null>(null);
  const inverse = useRef(new THREE.Matrix4());
  const local = useRef(new THREE.Vector3());

  const uniforms = useRef({
    uDissolve: { value: 0 },
    uFormation: { value: 0 },
    uTime: { value: 0 },
    uEdge: { value: new THREE.Color('#ffb47c') },
    uImpacts: {
      value: Array.from({ length: IMPACT_SLOTS }, () => new THREE.Vector4(0, 0, 0, -1)),
    },
    uImpactCount: { value: 0 },
    uBreath: { value: 0 },
  });

  /**
   * The GLB arrives as a single Tripo mesh with a baked colour map.
   * We clone it (so HMR and StrictMode double-mounts stay clean),
   * normalise its scale, and push the material toward fired clay.
   */
  const model = useMemo(() => {
    const root = scene.clone(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const s = TARGET_HEIGHT / size.y;
    root.scale.setScalar(s);
    // Centre on X/Z, and rest the base at y=0 before the group lifts it.
    root.position.set(-center.x * s, -box.min.y * s, -center.z * s);

    let foundMesh: THREE.Mesh | null = null;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !foundMesh) {
        foundMesh = m;
      }
    });

    const targetMesh: THREE.Mesh | null = foundMesh;
    if (targetMesh) {
      const mesh: THREE.Mesh = targetMesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;

      surfaceMesh.current = mesh;

      // Every system reads formation from this one baked attribute.
      bakeVertexWeights(mesh.geometry);

      const src = mesh.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        map: src.map ?? null,
        // Warm the baked texture toward terracotta without flattening it.
        color: new THREE.Color('#d9a583'),
        roughness: 0.9,
        metalness: 0.0,
        envMapIntensity: 0.35,
        // The asset is double-sided but it is a closed form; single-sided
        // halves the fragment cost and fixes the carve's inner faces.
        side: THREE.FrontSide,
      });

      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.anisotropy = 4;
        mat.map.generateMipmaps = true;
        mat.map.minFilter = THREE.LinearMipmapLinearFilter;
      }

      const injectCommon = (shader: {
        vertexShader: string;
        fragmentShader: string;
        uniforms: Record<string, THREE.IUniform>;
      }) => {
        shader.uniforms.uDissolve = uniforms.current.uDissolve;
        shader.uniforms.uFormation = uniforms.current.uFormation;
        shader.uniforms.uBreath = uniforms.current.uBreath;

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
             attribute float aFormWeight;
             varying float vFormWeight;
             varying vec3 vLocalPos;
             uniform float uBreath;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vFormWeight = aFormWeight;
             vLocalPos = position;

             // Anatomical breathing: mid-torso, belly, and upper chest.
             // Pedestal/base (hNorm < 0.32) and crown/head/ears (hNorm > 0.67) are 100% stationary.
             float hNorm = clamp((position.y + 0.489743) / 0.979411, 0.0, 1.0);
             float verticalMask = smoothstep(0.32, 0.42, hNorm) * (1.0 - smoothstep(0.56, 0.67, hNorm));
             // Bappa faces +X in authored coordinates; expand belly, chest, and lateral flanks while keeping back stationary
             float anteriorMask = smoothstep(-0.12, 0.04, position.x);
             float breathMask = verticalMask * anteriorMask;

             // Displace along outward surface normal for 3D silhouette contour expansion + gentle anterior lift
             vec3 breathDir = normalize(normal * 0.75 + vec3(0.55, 0.20, 0.0));
             transformed += breathDir * (breathMask * uBreath);`
          );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
           varying float vFormWeight;
           varying vec3 vLocalPos;
           uniform float uDissolve;
           uniform float uFormation;
           ${grainFn}`
        );
      };

      mat.onBeforeCompile = (shader) => {
        injectCommon(shader);
        shader.uniforms.uEdge = uniforms.current.uEdge;
        shader.uniforms.uImpacts = uniforms.current.uImpacts;
        shader.uniforms.uImpactCount = uniforms.current.uImpactCount;

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
             uniform vec3 uEdge;
             // xyz in the mesh's local space, w = seconds since it landed.
             uniform vec4 uImpacts[${IMPACT_SLOTS}];
             uniform int uImpactCount;`
          )
          .replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
             ${carveChunk}

             // --- clay that has only just arrived ---
             // Material that has just settled is still damp: darker and
             // grainier than cured clay, drying back over the last few
             // percent behind the frontier. It is the only mark the
             // frontier leaves on him, because above it there is no
             // surface to mark -- and it is what makes the edge read as
             // clay being added rather than as a cut.
              float justSet = uFormation >= 0.999 ? 0.0 : (1.0 - smoothstep(0.0, 0.055, uFormation - vFormWeight));
              float speck = bappaGrain(vLocalPos) - 0.5;
              gl_FragColor.rgb *= 1.0 - justSet * (0.24 - speck * 0.14);

             // --- an offering arriving ---
             // The clay catches the light where it was touched: a small,
             // soft, short warm bloom on the surface itself. Not a lamp
             // and not an orb -- the sculpture is what brightens, and it
             // falls off over a few centimetres of its own body.
             for (int k = 0; k < ${IMPACT_SLOTS}; k++) {
               if (k >= uImpactCount) break;
               vec4 im = uImpacts[k];
               if (im.w < 0.0) continue;

               // Rises quickly, lets go slowly -- the shape of something
               // being absorbed rather than switched on.
               float life = clamp(im.w / 1.1, 0.0, 1.0);
               float env = sin(life * 3.14159) * (1.0 - life * 0.35);

               // The lit patch spreads a little as it fades, the way heat
               // moves into a body rather than sitting on it.
               // Local units: the model is scaled ~6.6x, so this is a few
               // centimetres of him, not a patch of his body.
               float radius = 0.028 + life * 0.026;
               float near = 1.0 - smoothstep(0.0, radius, distance(vLocalPos, im.xyz));

               gl_FragColor.rgb += uEdge * near * near * env * 0.3;
             }

             // And when he is going, the clay dries and loosens before it
             // comes away: it darkens. No burning edge -- that is what every
             // dissolve effect does, and it read as him being set alight.
             if (uDissolve > 0.0001) {
               float loosening = smoothstep(-0.08, 0.0, vFormWeight - (1.0 - uDissolve));
               gl_FragColor.rgb *= 1.0 - loosening * 0.4;
             }`
          );
      };

      /**
       * The shadow pass uses its own material, which knows nothing about
       * the carve -- so without this an unformed Bappa would still cast
       * and self-shadow as a complete solid, blackening the parts that
       * have actually materialised.
       */
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = (shader) => {
        injectCommon(shader);
        // MeshDepthMaterial has no dithering chunk to hook, so the carve
        // goes at the top of main() where it can still discard.
        shader.fragmentShader = shader.fragmentShader.replace(
          'void main() {',
          `void main() {\n${carveChunk}`
        );
      };
      mat.customProgramCacheKey = () => 'ganpati-material-living-v2';
      depth.customProgramCacheKey = () => 'ganpati-depth-living-v2';
      mesh.customDepthMaterial = depth;

      mesh.material = mat;
      mat.needsUpdate = true;

      // --- the material he is made of ---
      // Parented to the mesh so it inherits the same transform and the
      // sampled points need no matrix maths to line up with the surface.
      const c = createFormationCloud(mesh.geometry, perf.formationParticles, {
        uFormation: uniforms.current.uFormation,
        uDissolve: uniforms.current.uDissolve,
        uTime: uniforms.current.uTime,
      });
      cloud.current = c;
      mesh.add(c.points);
    }

    return root;
  }, [scene, perf.formationParticles]);

  // Point size must track viewport height, or the material changes
  // physical size when the window resizes or a phone rotates.
  useEffect(() => {
    if (cloud.current) cloud.current.uniforms.uScale.value = size.height * 0.05;
  }, [size.height, model]);

  // He is here: the light can come up on him, and the ritual can be offered.
  useEffect(() => {
    useBoot.getState().setModelReady();
  }, [model]);

  // Hand the normalised surface to the dissolve system so its fragments
  // detach from exactly where the sculpture is eroding.
  useEffect(() => {
    if (!onGeometry || !surfaceMesh.current) return;
    model.updateMatrixWorld(true);
    onGeometry(surfaceMesh.current.geometry, surfaceMesh.current.matrixWorld.clone());
  }, [model, onGeometry]);

  useEffect(() => {
    const current = cloud.current;
    const surf = surfaceMesh.current;
    return () => {
      current?.dispose();
      if (surf) {
        if (surf.material) (surf.material as THREE.Material).dispose();
        surf.customDepthMaterial?.dispose();
      }
    };
  }, [model]);

  /** Eased formation, so arrivals swell rather than step. */
  const formation = useRef(0);
  const settled = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = performance.now() * 0.001;

    uniforms.current.uTime.value = t;
    uniforms.current.uDissolve.value = handle.current.dissolve;

    // --- where the clay has just been touched ---
    // Impacts are recorded in world space; the material needs them in the
    // mesh's own space, and the mesh drifts a little every frame, so the
    // inverse is recomputed rather than cached.
    const system = particles.current.system;
    const mesh = surfaceMesh.current;
    if (system && mesh) {
      inverse.current.copy(mesh.matrixWorld).invert();
      let live = 0;
      for (let k = 0; k < ParticleSystem.IMPACT_SLOTS; k++) {
        const landed = system.impacts[k * 4 + 3];
        if (landed <= 0) continue;
        const age = t - landed;
        if (age < 0 || age > 1.1) continue;

        local.current
          .set(system.impacts[k * 4], system.impacts[k * 4 + 1], system.impacts[k * 4 + 2])
          .applyMatrix4(inverse.current);

        uniforms.current.uImpacts.value[live].set(
          local.current.x,
          local.current.y,
          local.current.z,
          age
        );
        live++;
      }
      uniforms.current.uImpactCount.value = live;
    }

    const ritualState = getRitualState();
    const sthapana = getSthapanaArrival();
    const target = currentFormation();

    if (ritualState === 'PRE_STHAPANA') {
      formation.current = 0;
      uniforms.current.uFormation.value = 0;
      setFormationLevel(0);
    } else if (sthapana.isArriving) {
      // Sthapana arrival progression:
      // 0 - 2.5s: Anticipation — empty asana, uFormation = 0
      // 2.5 - 9.5s: Emergence — Bappa emerges fully into form (from 0 to 1.0)
      // 9.5 - 12.5s: Settling — Bappa settles onto the asana (fully formed)
      // 12.5 - 14.0s: Awakening — Bappa is fully formed, sacred breathing awakens
      if (sthapana.elapsed < 2.5) {
        formation.current = 0;
      } else if (sthapana.elapsed < 9.5) {
        const k = (sthapana.elapsed - 2.5) / 7.0;
        const ease = k * k * (3 - 2 * k);
        formation.current = ease;
      } else {
        formation.current = 1.0;
      }
      uniforms.current.uFormation.value = formation.current;
      setFormationLevel(formation.current);
    } else {
      // Normal BAPPA_PRESENT: Bappa is always 100% complete throughout festival days.
      // target respects development overrides if set, otherwise 1.0.
      formation.current = target;
      uniforms.current.uFormation.value = target;
      setFormationLevel(target);
    }

    if (!group.current) return;

    // Pedestal and base remain completely rigid and grounded at the altar center.
    group.current.position.y = BAPPA_CENTER.y - TARGET_HEIGHT * 0.5;
    group.current.rotation.y = 0;

    // Authoritative ritual state: Bappa is visible during BAPPA_PRESENT (emerging from 2.5s onwards during Sthapana),
    // and hides once Visarjan dissolve completes.
    const { state: sceneState, elapsed: sceneElapsed } = useScene.getState();
    const isVisarjanCompleted = sceneState === 'VISARJAN' && sceneElapsed >= VISARJAN_DURATION;
    const isVisarjanDissolving = sceneState === 'VISARJAN' && sceneElapsed < VISARJAN_DURATION;
    const isArrivingEmergence = sthapana.isArriving && sthapana.elapsed >= 2.5;
    const isPresent = ((ritualState === 'BAPPA_PRESENT' && !sthapana.isArriving) || isArrivingEmergence || isVisarjanDissolving) && !isVisarjanCompleted;
    group.current.visible = isPresent;

    const state = useScene.getState().state;
    // Visarjan is complete stillness
    const alive = state === 'VISARJAN' ? 0 : 1;

    // Organic, slow, asymmetric breathing cycle (~7.2s period)
    // Inhale is smooth and deep; exhale is slower and passive
    const breathTime = t * 0.87;
    const wavePrimary = Math.sin(breathTime);
    const waveHarmonic = Math.sin(breathTime * 0.5 + 1.2) * 0.28;
    const rawBreath = (wavePrimary + waveHarmonic) * 0.78;
    const breathNorm = Math.pow(Math.max(0, rawBreath * 0.5 + 0.5), 1.3);

    // Offering response: when material is landing/settling into Bappa,
    // breathing enters a quiet, reverent hold for a moment of resonance
    const hasRecentImpact = uniforms.current.uImpactCount.value > 0;
    const resonanceDamp = hasRecentImpact ? 0.4 : 1.0;

    // Awakening factor during Sthapana:
    // 0 - 12.5s: 0 breathing (still physical clay emerging and settling)
    // 12.5 - 14.0s: breathing gradually begins (eases from 0 to 1 over 1.5s)
    // 14.0s+: full breathing
    let awakenFactor = 1.0;
    if (sthapana.isArriving) {
      if (sthapana.elapsed < 12.5) {
        awakenFactor = 0.0;
      } else {
        const w = Math.min(1, Math.max(0, (sthapana.elapsed - 12.5) / 1.5));
        awakenFactor = w * w * (3 - 2 * w);
      }
    } else if (ritualState === 'PRE_STHAPANA') {
      awakenFactor = 0.0;
    }

    // Peak expansion: ~0.0090 local units * 2.3046 = ~0.0207 world units (~20.7mm on chest/belly/ribs)
    // Conspicuously perceptible when watching quietly for 5-10 seconds, while remaining a physical clay murti
    const BREATH_SCALE = 0.0090;
    uniforms.current.uBreath.value = breathNorm * BREATH_SCALE * alive * resonanceDamp * awakenFactor;
  });

  return (
    <group
      ref={group}
      position={[0, BAPPA_CENTER.y - TARGET_HEIGHT * 0.5, 0]}
    >
      {/* The asset is authored facing +X. This inner group turns it to
          face the camera and is kept separate from the outer group so the
          breathing rotation composes with it instead of fighting it. */}
      <group rotation-y={MODEL_FACING}>
        <primitive object={model} />
      </group>
    </group>
  );
}

useGLTF.preload('/models/ganpati.optimized.glb');
useGLTF.preload('/models/ganpati.glb?v=2');
useGLTF.preload('/models/ganpati.backup.glb');
