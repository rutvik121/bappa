'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene, type ContributionType } from '../state/sceneState';
import { BAPPA_CENTER } from './GanpatiModel';
import { revealAmount } from '../state/boot';
import { getRitualState, getSthapanaArrival } from '../state/festival';
import { VISARJAN_DURATION } from './DissolveController';
import type { PerfProfile } from '../systems/perf';

/**
 * How the room answers the offering a visitor has chosen. Deliberately
 * small: a warmer key for gratitude, a lifted rim for a wish, a heavier,
 * darker room for a vighna, a livelier fill for a promise. It should be
 * felt, not noticed.
 */
const MOOD: Record<ContributionType, { key: number; rim: number; fill: number; color: string }> = {
  GRATITUDE: { key: 1.07, rim: 0.95, fill: 1.2, color: '#ffd4ac' },
  WISH: { key: 1.03, rim: 1.2, fill: 1.0, color: '#ffe8d2' },
  VIGHNA: { key: 0.84, rim: 0.8, fill: 0.7, color: '#ffdcc2' },
  PROMISE: { key: 1.0, rim: 1.05, fill: 1.45, color: '#ffe2c0' },
};

const BASE_KEY = new THREE.Color('#ffe0c2');

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
  const fill = useRef<THREE.PointLight>(null);
  const face = useRef<THREE.PointLight>(null);
  const asanaLight = useRef<THREE.PointLight>(null);
  const mood = useRef({ key: 1, rim: 1, fill: 1 });
  const moodColor = useRef(new THREE.Color());
  const sunWeight = useRef(0);
  const aimObj = useRef<THREE.Object3D | null>(null);

  /**
   * Aim point placed at y = 1.15 for Bappa, or gently lower (y = 0.05) during PRE_STHAPANA
   * so the warm key light cone softly pools on the ceremonial asana.
   */
  useEffect(() => {
    const aim = new THREE.Object3D();
    aim.position.set(0, 1.15, 0);
    scene.add(aim);
    aimObj.current = aim;

    if (key.current) key.current.target = aim;
    if (rim.current) rim.current.target = aim;

    return () => {
      scene.remove(aim);
      aimObj.current = null;
    };
  }, [scene]);

  useFrame(() => {
    const t = performance.now() * 0.001;
    const { state, mood: chosen } = useScene.getState();
    const ritualState = getRitualState();
    const sthapana = getSthapanaArrival();

    // Natural sunlight movement applies ONLY during BAPPA_PRESENT.
    // PRE_STHAPANA, STHAPANA arrival, and VISARJAN/POST_VISARJAN retain their quiet/canonical lighting.
    const isBappaPresent = ritualState === 'BAPPA_PRESENT' && !sthapana.isArriving && state !== 'VISARJAN';
    const targetWeight = isBappaPresent ? 1 : 0;
    sunWeight.current += (targetWeight - sunWeight.current) * 0.03;
    const w = sunWeight.current < 0.0005 ? 0 : sunWeight.current;

    // Natural sunlight evolution: extremely slow, continuous daylight progression across Bappa.
    // Harmonics over ~240s to ~420s simulate sunlight shifting through quiet room openings.
    // Drifts the key angle slightly across the terracotta surface so highlights and shadows along
    // ears, trunk, brow, and belly slowly evolve over minutes rather than feeling static.
    const sunAngle1 = t * 0.026;
    const sunAngle2 = t * 0.015;
    const sunDriftX = (Math.sin(sunAngle1) * 0.22 + Math.sin(sunAngle2) * 0.10) * w;
    const sunDriftY = (Math.cos(sunAngle1 * 0.85) * 0.13 + Math.sin(sunAngle2 * 0.7) * 0.05) * w;
    const sunDriftZ = (Math.cos(sunAngle1 * 0.65) * 0.14) * w;

    if (key.current) {
      key.current.position.set(-2.1 + sunDriftX, 2.7 + sunDriftY, 2.6 + sunDriftZ);
    }
    if (rim.current) {
      rim.current.position.set(2.9 - sunDriftX * 0.4, 2.0 + sunDriftY * 0.3, -2.4 - sunDriftZ * 0.3);
    }
    if (fill.current) {
      fill.current.position.set(0.85 + sunDriftX * 0.2, 1.35 + sunDriftY * 0.15, 2.3);
    }
    if (face.current) {
      face.current.position.set(-0.2 + sunDriftX * 0.25, 1.48 + sunDriftY * 0.15, 2.2 + sunDriftZ * 0.15);
    }

    // Natural sunlight intensity: very gentle, breathing warmth variation (±2.3%) over ~90-180s.
    // Never pulsing or flashing; feels like subtle warm air and sunlight entering a quiet room.
    const naturalSunlight = 1.0 + (Math.sin(t * 0.042) * 0.015 + Math.sin(t * 0.018) * 0.008) * w;

    // Offering resonance: subtle gentle warmth swell while offering settles into Bappa
    const offeringResonance = state === 'TRANSFORMING' ? 1.035 : 1.0;

    // Eased toward the chosen offering over a couple of seconds, and back.
    const m = chosen ? MOOD[chosen] : null;
    const e = 0.02;
    mood.current.key += ((m?.key ?? 1) - mood.current.key) * e;
    mood.current.rim += ((m?.rim ?? 1) - mood.current.rim) * e;
    mood.current.fill += ((m?.fill ?? 1) - mood.current.fill) * e;
    if (key.current) {
      moodColor.current.set(m?.color ?? BASE_KEY);
      key.current.color.lerp(moodColor.current, e);
    }

    // Arrival: he is in the dark first, and the light finds him.
    const reveal = revealAmount();

    // Aim point: in PRE_STHAPANA, aim gently at the asana (y = 0.05),
    // lifting smoothly to Bappa's chest (y = 1.15) as he takes shape.
    if (aimObj.current) {
      let targetAimY = 1.15;
      if (ritualState === 'PRE_STHAPANA') {
        targetAimY = 0.05;
      } else if (sthapana.isArriving) {
        if (sthapana.elapsed <= 2.5) {
          targetAimY = 0.05;
        } else if (sthapana.elapsed < 12.5) {
          const k = (sthapana.elapsed - 2.5) / 10.0;
          const ease = k * k * (3 - 2 * k);
          targetAimY = THREE.MathUtils.lerp(0.05, 1.15, ease);
        } else {
          targetAimY = 1.15;
        }
      } else if (state === 'VISARJAN') {
        // While Bappa dissolves (0-58s), hold light on Bappa's form (1.15); then gently settle to empty asana (0.05)
        const { elapsed } = useScene.getState();
        const settleProgress = Math.min(1, Math.max(0, (elapsed - VISARJAN_DURATION) / 14));
        const ease = settleProgress * settleProgress * (3 - 2 * settleProgress);
        targetAimY = THREE.MathUtils.lerp(1.15, 0.05, ease);
      } else if (ritualState === 'POST_VISARJAN') {
        targetAimY = 0.05;
      }
      aimObj.current.position.y += (targetAimY - aimObj.current.position.y) * 0.06;
    }

    let stateFactorKey = 1;
    let stateFactorRim = 1;
    let stateFactorFill = 1;
    let stateFactorFace = 1;

    if (ritualState === 'PRE_STHAPANA') {
      // Warm, quiet pool of light focused around the waiting asana
      stateFactorKey = 0.50; // ~18 intensity
      stateFactorRim = 0.22;
      stateFactorFill = 0.65;
      stateFactorFace = 0.0;
    } else if (sthapana.isArriving) {
      // Sthapana arrival lighting transition (0 -> 14s):
      // 0 - 2.5s: Hold PRE_STHAPANA pool of light during anticipation
      // 2.5 - 12.5s: Smoothly bloom and open the room light as Bappa takes physical form and settles
      // 12.5 - 14.0s: Fully settled warm room light
      if (sthapana.elapsed <= 2.5) {
        stateFactorKey = 0.50;
        stateFactorRim = 0.22;
        stateFactorFill = 0.65;
        stateFactorFace = 0.0;
      } else if (sthapana.elapsed < 12.5) {
        const k = (sthapana.elapsed - 2.5) / 10.0;
        const ease = k * k * (3 - 2 * k);
        stateFactorKey = THREE.MathUtils.lerp(0.50, 1.0, ease);
        stateFactorRim = THREE.MathUtils.lerp(0.22, 1.0, ease);
        stateFactorFill = THREE.MathUtils.lerp(0.65, 1.0, ease);
        stateFactorFace = THREE.MathUtils.lerp(0.0, 1.0, ease);
      } else {
        stateFactorKey = 1.0;
        stateFactorRim = 1.0;
        stateFactorFill = 1.0;
        stateFactorFace = 1.0;
      }
    } else if (state === 'VISARJAN') {
      // VISARJAN transition: Bappa dissolves until VISARJAN_DURATION (58s).
      // After Bappa disappears, gradually reduce the scene lighting over time.
      // Slowly settles into a darker, quieter version of the existing environment rather than cutting.
      const { elapsed } = useScene.getState();
      const settleProgress = Math.min(1, Math.max(0, (elapsed - VISARJAN_DURATION) / 14));
      // Smoothstep easing so the reduction is gentle, organic and gradual
      const ease = settleProgress * settleProgress * (3 - 2 * settleProgress);

      stateFactorKey = THREE.MathUtils.lerp(1.0, 0.32, ease);
      stateFactorRim = THREE.MathUtils.lerp(1.0, 0.10, ease);
      stateFactorFill = THREE.MathUtils.lerp(1.0, 0.45, ease);
      stateFactorFace = THREE.MathUtils.lerp(1.0, 0.0, ease);
    } else if (ritualState === 'POST_VISARJAN') {
      // Quiet warmth holding the memory on the empty asana
      stateFactorKey = 0.32; // ~12 intensity
      stateFactorRim = 0.10;
      stateFactorFill = 0.45;
      stateFactorFace = 0.0;
    }

    if (key.current) key.current.intensity = 36 * naturalSunlight * mood.current.key * reveal * offeringResonance * stateFactorKey;
    if (rim.current) rim.current.intensity = 26 * mood.current.rim * reveal * offeringResonance * stateFactorRim;
    if (fill.current) fill.current.intensity = 1.8 * mood.current.fill * reveal * offeringResonance * stateFactorFill;
    if (face.current) face.current.intensity = 1.0 * naturalSunlight * mood.current.fill * reveal * offeringResonance * stateFactorFace;

    // Asana pool light: softly bathes the ceremonial platform in warm lamplight
    if (asanaLight.current) {
      let asanaFactor = 0;
      if (ritualState === 'PRE_STHAPANA') {
        asanaFactor = 1.0;
      } else if (sthapana.isArriving) {
        // Fades out completely during anticipation (0 - 2.5s) before Bappa emerges
        asanaFactor = Math.max(0, 1.0 - sthapana.elapsed / 2.5);
      } else if (ritualState === 'POST_VISARJAN') {
        asanaFactor = 0.55;
      }
      asanaLight.current.intensity = 1.2 * asanaFactor * reveal;
    }
  });

  return (
    <>
      {/* Key: warm 35-degree rake angle grazing brow, eye sculpting, ears, and trunk */}
      <spotLight
        ref={key}
        position={[-2.1, 2.7, 2.6]}
        angle={0.58}
        penumbra={0.68}
        decay={2}
        distance={16}
        color="#ffe0c2"
        intensity={36}
        castShadow={perf.shadows}
        shadow-mapSize={perf.tier === 'high' ? [2048, 2048] : [1024, 1024]}
        shadow-bias={-0.0012}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={14}
      />

      {/* Rim: behind and camera-right, grazing the silhouette */}
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

      {/* Fill: warm clay bounce from eye/chest level revealing right eye, cheek, and trunk curve */}
      <pointLight ref={fill} position={[0.85, 1.35, 2.3]} color="#ffd8b8" intensity={1.8} decay={2} distance={6} />

      {/* Facial modeling presence: soft frontal catch light revealing sculpted eyes and brow */}
      <pointLight ref={face} position={[-0.2, 1.48, 2.2]} color="#ffe4cb" intensity={1.0} decay={2} distance={4.5} />

      {/* Ceremonial asana pool light: quiet warm lamplight resting over the waiting seat */}
      <pointLight
        ref={asanaLight}
        position={[0, 0.08, 0.45]}
        color="#ffe2c4"
        intensity={1.2}
        decay={2}
        distance={3.0}
      />

      {/* Ambient holds rich terracotta depth in crevices rather than pitch black */}
      <hemisphereLight args={['#4a3424', '#0a0705', 0.08]} />
      <ambientLight color="#2e2016" intensity={0.055} />
    </>
  );
}
