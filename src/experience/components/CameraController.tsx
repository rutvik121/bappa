'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene, type SceneStateName } from '../state/sceneState';
import { BAPPA_CENTER } from './GanpatiModel';

/**
 * What the camera aims at. Deliberately not BAPPA_CENTER: that is where
 * offerings are drawn to, roughly his heart, and aiming there drops the
 * sculpture low enough to sit on top of the call to action. His visual
 * centre is a little higher.
 */
const LOOK = new THREE.Vector3(0, 1.14, 0);

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Seconds to cover roughly 90% of the move. Higher = slower. */
  ease: number;
}

/**
 * Every state is a camera position, and the only transition is a critically
 * damped move between them. Nothing cuts, nothing accelerates.
 *
 * Distances are chosen against the frame, not by eye: at a 34 degree fov
 * the visible height at distance d is 0.611*d, so Bappa's 2.3 units fill
 * roughly three quarters of the frame at d = 5. He should be the first
 * thing seen, not something to be found.
 */
const SHOTS: Record<SceneStateName, Shot> = {
  // Wide, but he commands it -- deep black around a large sculpture.
  IDLE: { pos: new THREE.Vector3(0, 1.18, 5.25), look: LOOK, fov: 34, ease: 6.0 },
  // Slow push-in. Closer, more intimate framing.
  CONTRIBUTING: { pos: new THREE.Vector3(0, 1.05, 3.75), look: LOOK, fov: 32, ease: 9.0 },
  // Held. The pause after submitting is a held breath, so the camera stops.
  UNDERSTANDING: { pos: new THREE.Vector3(0, 1.05, 3.65), look: LOOK, fov: 32, ease: 11.0 },
  // Drifts a few degrees around the axis while the offering travels.
  TRANSFORMING: { pos: new THREE.Vector3(0.85, 1.15, 3.6), look: LOOK, fov: 33, ease: 10.0 },
  // Pull back: the offering is gone and so is the closeness.
  COMPLETE: { pos: new THREE.Vector3(0, 1.28, 5.6), look: LOOK, fov: 35, ease: 12.0 },
  // The longest, slowest retreat in the piece.
  VISARJAN: { pos: new THREE.Vector3(0, 1.4, 7.0), look: LOOK, fov: 38, ease: 26.0 },
};

export function CameraController() {
  const { camera } = useThree();
  const pos = useRef(SHOTS.IDLE.pos.clone());
  const look = useRef(SHOTS.IDLE.look.clone());
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((_, rawDt) => {
    // Clamp dt so a backgrounded tab does not snap the camera on return.
    const dt = Math.min(rawDt, 1 / 20);
    const t = performance.now() * 0.001;
    const { state, elapsed } = useScene.getState();
    const shot = SHOTS[state];

    // Exponential smoothing, framerate independent.
    const k = 1 - Math.exp(-dt / (shot.ease * 0.25));

    lookTarget.current.copy(shot.pos);

    // Two slow, mutually prime drifts. Handheld weight without handheld noise.
    const amp = state === 'VISARJAN' ? 0.05 : 0.09;
    lookTarget.current.x += Math.sin(t * 0.11) * amp;
    lookTarget.current.y += Math.sin(t * 0.083) * amp * 0.55;

    // A continuing orbit while the contribution is being absorbed, so the
    // motion reads as ongoing rather than as arriving at a new mark.
    if (state === 'TRANSFORMING') {
      const a = elapsed * 0.055;
      lookTarget.current.x += Math.sin(a) * 0.55;
      lookTarget.current.z += (Math.cos(a) - 1) * 0.28;
    }

    // The Visarjan pull-back keeps easing outward for as long as it runs,
    // so the frame never settles while Bappa is leaving it.
    if (state === 'VISARJAN') {
      lookTarget.current.z += Math.min(elapsed * 0.075, 3.2);
      lookTarget.current.y += Math.min(elapsed * 0.012, 0.5);
    }

    pos.current.lerp(lookTarget.current, k);
    look.current.lerp(shot.look, k);

    camera.position.copy(pos.current);
    camera.lookAt(look.current);

    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - shot.fov) > 0.01) {
      cam.fov += (shot.fov - cam.fov) * k;
      cam.updateProjectionMatrix();
    }
  });

  return null;
}
