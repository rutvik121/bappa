'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene, type SceneStateName } from '../state/sceneState';

/**
 * The camera composes the frame; it does not perform.
 *
 * Bappa is the hero, so every shot is built around him with room left
 * above and below for the few words the piece uses -- the headline sits in
 * darkness over his crown, the invitation in darkness under his base, and
 * neither is ever printed across the sculpture.
 *
 * Movement follows the rest of the piece: stillness, one event, stillness.
 * The camera holds while an offering travels -- the offering is the event
 * -- and only moves between states, slowly.
 */

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Seconds to cover roughly 90% of the move. Higher = slower. */
  ease: number;
  /**
   * How much of his full width must stay in frame on a narrow screen.
   * 1 keeps both outer hands in; lower allows an intimate crop.
   */
  fit: number;
}

/**
 * Bappa is 2.3 units tall and centred at y = 0.95. At a 34 degree fov the
 * visible height at distance d is 0.611*d, so from 6.0 he fills a little
 * under two thirds of a landscape frame -- dominant, with dark bands above
 * and below. Looking at 1.06 rather than his centre lowers him slightly,
 * which is where the larger band (the headline) needs the room.
 */
const SHOTS: Record<SceneStateName, Shot> = {
  IDLE: { pos: new THREE.Vector3(0, 1.2, 6.0), look: new THREE.Vector3(0, 1.06, 0), fov: 34, ease: 6, fit: 1 },
  // Closer while choosing and writing, still clear of the words below.
  CONTRIBUTING: { pos: new THREE.Vector3(0, 1.12, 4.5), look: new THREE.Vector3(0, 1.16, 0), fov: 32, ease: 9, fit: 0.82 },
  // Held. The breath after offering is a held camera.
  UNDERSTANDING: { pos: new THREE.Vector3(0, 1.1, 4.3), look: new THREE.Vector3(0, 1.12, 0), fov: 32, ease: 11, fit: 0.82 },
  // Still held while it travels: a few centimetres of drift, no orbit.
  TRANSFORMING: { pos: new THREE.Vector3(0.18, 1.12, 4.3), look: new THREE.Vector3(0, 1.1, 0), fov: 32, ease: 14, fit: 0.82 },
  // Back out, leaving the lower band for the closing line.
  COMPLETE: { pos: new THREE.Vector3(0, 1.22, 6.1), look: new THREE.Vector3(0, 1.02, 0), fov: 34, ease: 12, fit: 1 },
  // The longest, slowest retreat in the piece.
  VISARJAN: { pos: new THREE.Vector3(0, 1.35, 7.0), look: new THREE.Vector3(0, 1.12, 0), fov: 38, ease: 26, fit: 1 },
};

/** His width with the outer hands, plus a little air. */
const FULL_WIDTH = 1.95;

export function CameraController() {
  const { camera, size } = useThree();
  const pos = useRef(SHOTS.IDLE.pos.clone());
  const look = useRef(SHOTS.IDLE.look.clone());
  const target = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  const still = useRef(false);

  // Handheld drift is atmosphere, and atmosphere is optional.
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => (still.current = q.matches);
    apply();
    q.addEventListener('change', apply);
    return () => q.removeEventListener('change', apply);
  }, []);

  useFrame((_, rawDt) => {
    // Clamp dt so a backgrounded tab does not snap the camera on return.
    const dt = Math.min(rawDt, 1 / 20);
    const t = performance.now() * 0.001;
    const { state, elapsed } = useScene.getState();
    const shot = SHOTS[state];

    // Exponential smoothing, framerate independent.
    const k = 1 - Math.exp(-dt / (shot.ease * 0.25));

    // On a narrow screen the width is what limits the frame, not the
    // height: pull back until both outer hands are in, rather than
    // cropping him into orange fragments at the edges of a phone.
    const aspect = size.width / Math.max(1, size.height);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(shot.fov) / 2) * aspect;
    const needed = (FULL_WIDTH / 2 / tanHalf) * shot.fit;
    dir.current.copy(shot.pos).sub(shot.look);
    const distance = Math.max(dir.current.length(), needed);
    target.current.copy(shot.look).addScaledVector(dir.current.normalize(), distance);

    // A barely perceptible drift, so the frame is held by a person rather
    // than bolted down. Never enough to read as movement.
    if (!still.current) {
      const amp = state === 'VISARJAN' ? 0.02 : 0.035;
      target.current.x += Math.sin(t * 0.11) * amp;
      target.current.y += Math.sin(t * 0.083) * amp * 0.55;
    }

    // The Visarjan pull-back keeps easing outward for as long as it runs,
    // so the frame never settles while Bappa is leaving it.
    if (state === 'VISARJAN') {
      target.current.z += Math.min(elapsed * 0.075, 3.2);
      target.current.y += Math.min(elapsed * 0.012, 0.5);
    }

    pos.current.lerp(target.current, k);
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
