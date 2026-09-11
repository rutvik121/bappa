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
import { ParticleSystem } from '../systems/ParticleSystem';
import type { ParticleHandle } from './ParticleField';

export const GANPATI_URL = '/models/ganpati.glb';

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
 * Only Visarjan removes clay. What has not formed yet is still there, as
 * raw clay: cutting it away left black holes that every first-time visitor
 * read as a broken model. When he goes, he goes grain by grain rather
 * than along a clean cut.
 */
const carveChunk = /* glsl */ `
  if (uDissolve > 0.0001) {
    float behind = vFormWeight - (1.0 - uDissolve);
    if (behind > 0.0 && bappaGrain(vLocalPos) > 1.0 - clamp(behind / 0.07, 0.0, 1.0)) discard;
  }
`;

export function GanpatiModel({ perf, handle, particles, onGeometry }: Props) {
  const { size } = useThree();
  const { scene } = useGLTF(GANPATI_URL);
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

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;

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

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute float aFormWeight;\nvarying float vFormWeight;\nvarying vec3 vLocalPos;'
          )
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvFormWeight = aFormWeight;\nvLocalPos = position;'
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

             // --- what is still being made ---
             // Unfinished passages are raw clay: greyer, drier, darker and
             // granular, the way a murti looks in the workshop before it is
             // smoothed. Never a hole. Where raw meets finished, the seam is
             // a little darker, like clay that has just been pressed on.
             float ahead = vFormWeight - uFormation;
             float raw = smoothstep(0.0, 0.06, ahead);
             float speck = bappaGrain(vLocalPos) - 0.5;
             float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
             vec3 rawClay = mix(gl_FragColor.rgb, vec3(luma) * vec3(1.0, 0.92, 0.84), 0.5)
               * (0.68 + speck * 0.32);
             gl_FragColor.rgb = mix(gl_FragColor.rgb, rawClay, raw);
             float seam = smoothstep(-0.03, 0.0, ahead) * (1.0 - smoothstep(0.0, 0.03, ahead));
             gl_FragColor.rgb *= 1.0 - seam * 0.14;

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

    });

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
    if (!onGeometry) return;
    let sent = false;
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (sent || !mesh.isMesh) return;
      onGeometry(mesh.geometry, mesh.matrixWorld.clone());
      sent = true;
    });
  }, [model, onGeometry]);

  useEffect(() => {
    const current = cloud.current;
    return () => {
      current?.dispose();
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.material) (mesh.material as THREE.Material).dispose();
        mesh.customDepthMaterial?.dispose();
      });
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

    const target = currentFormation();
    // A jump this large cannot come from offerings arriving -- one is
    // worth a fraction of a percent -- so it is either the first frame or
    // the development day control. Both should land immediately; only
    // genuine accumulation is worth easing.
    const jumped = Math.abs(target - formation.current) > 0.15;
    if (!settled.current || jumped) {
      // A visitor arriving on day six finds him as built as day six left
      // him -- he does not form from nothing while they watch. Only what
      // happens during their own visit animates.
      settled.current = true;
      formation.current = target;
    } else {
      formation.current += (target - formation.current) * Math.min(1, dt * 0.5);
    }
    uniforms.current.uFormation.value = formation.current;


    if (!group.current) return;

    // "Breathing" is environmental, not anatomical -- Bappa is stone-still
    // and it is the world that moves fractionally around him.
    const state = useScene.getState().state;
    // The stillness is the first phase, and it has to be real: from the
    // moment Visarjan begins he does not move at all. Letting the breath
    // run through the hold made it read as a pause in an animation
    // rather than as the room going quiet to look at him.
    const alive = state === 'VISARJAN' ? 0 : 1;
    const breath = Math.sin(t * 0.42) * 0.0045 + Math.sin(t * 0.17) * 0.0025;
    group.current.position.y = BAPPA_CENTER.y - TARGET_HEIGHT * 0.5 + breath * alive;
    group.current.rotation.y = Math.sin(t * 0.08) * 0.012 * alive;
  });

  return (
    <group ref={group} position={[0, BAPPA_CENTER.y - TARGET_HEIGHT * 0.5, 0]}>
      {/* The asset is authored facing +X. This inner group turns it to
          face the camera and is kept separate from the outer group so the
          breathing rotation composes with it instead of fighting it. */}
      <group rotation-y={MODEL_FACING}>
        <primitive object={model} />
      </group>
    </group>
  );
}

useGLTF.preload(GANPATI_URL);
