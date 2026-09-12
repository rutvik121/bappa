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
 * Bappa is 2.3 units tall, standing from y = -0.2 to y = 2.1, so his
 * centre is y = 0.95. Every shot looks at that centre from very close to
 * its own height: a level eye-line on the middle of the sculpture, which
 * is how you meet something standing in a room rather than how a product
 * is photographed.
 *
 * At a 34 degree fov the visible height at distance d is 0.611*d. From
 * 6.27 that is 3.83 units, so he fills a little under two thirds of the
 * frame and a fifth of it is left empty above and below him. He is the
 * largest thing in the frame by a long way and still has air.
 */
const SHOTS: Record<SceneStateName, Shot> = {
  IDLE: { pos: new THREE.Vector3(0, 1.0, 6.27), look: new THREE.Vector3(0, 0.95, 0), fov: 34, ease: 6, fit: 1 },
  // Closer while choosing and writing -- the room draws in, but he stays
  // where he is, in the middle of it. The push-in is deliberately gentle:
  // any closer and he spreads into the darkness the writing stands in,
  // and the words end up back across his lap.
  CONTRIBUTING: { pos: new THREE.Vector3(0, 1.0, 6.0), look: new THREE.Vector3(0, 0.97, 0), fov: 33, ease: 9, fit: 0.94 },
  // Held. The breath after offering is a held camera.
  UNDERSTANDING: { pos: new THREE.Vector3(0, 1.0, 5.85), look: new THREE.Vector3(0, 0.96, 0), fov: 33, ease: 11, fit: 0.94 },
  // Still held while it travels: a few centimetres of drift, no orbit.
  TRANSFORMING: { pos: new THREE.Vector3(0.14, 1.0, 5.85), look: new THREE.Vector3(0, 0.95, 0), fov: 33, ease: 14, fit: 0.94 },
  // Back out, to the composition he was found in.
  COMPLETE: { pos: new THREE.Vector3(0, 1.02, 6.4), look: new THREE.Vector3(0, 0.95, 0), fov: 34, ease: 12, fit: 1 },
  // The longest, slowest retreat in the piece.
  VISARJAN: { pos: new THREE.Vector3(0, 1.12, 7.2), look: new THREE.Vector3(0, 1.0, 0), fov: 38, ease: 26, fit: 1 },
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
  /** How far he is raised in the frame, as a share of its height. */
  const lift = useRef(0);
  const first = useRef(true);

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

    // Portrait is the one frame he cannot be centred in: there is no room
    // beside him for a single word, so the composition becomes vertical
    // and he takes the upper part of it with the words stacked beneath.
    // An off-axis frustum rather than a tilted camera, so he is moved up
    // the frame without being looked at from above. He settles back to the
    // centre as he leaves, so the last words sit in the space he was in.
    // Must agree with the portrait composition in globals.css.
    // The wide lift is the optical-centre correction, not a composition:
    // a form this heavy at the base reads as sitting low when its
    // geometric centre is on the centre line, so it goes up a hair.
    //
    // While the offering is being chosen and written he rises further, so
    // the words sit under him and the visitor is writing to him rather
    // than over him. On a phone it is the other way round: the keyboard
    // owns the lower half, so the writing has to be at the top and he
    // settles down out of its way instead.
    const portrait = aspect < 1.2 || size.width < 1000;
    const ritual = state === 'CONTRIBUTING';
    const liftTarget =
      state === 'VISARJAN' ? 0 : portrait ? (ritual ? 0 : 0.15) : ritual ? 0.1 : 0.03;
    lift.current = first.current ? liftTarget : lift.current + (liftTarget - lift.current) * k;
    first.current = false;
    if (Math.abs(lift.current) > 0.0005) {
      cam.setViewOffset(size.width, size.height, 0, lift.current * size.height, size.width, size.height);
    } else if (cam.view?.enabled) {
      cam.clearViewOffset();
    }
  });

  return null;
}
