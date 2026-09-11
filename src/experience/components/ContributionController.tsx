'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene } from '../state/sceneState';
import { useCollective } from '../state/collective';
import { devTimeScale } from '../dev/devtools';
import { sampleTextPoints } from '../systems/TextSampler';
import { BAPPA_CENTER } from './GanpatiModel';
import type { ParticleHandle } from './ParticleField';
import type { PerfProfile } from '../systems/perf';

/**
 * Drives the ritual's clock and turns a submitted contribution into matter.
 *
 * This is the only component that owns state transitions on a timer; the
 * UI owns the two transitions a person makes deliberately (beginning, and
 * submitting). Everything after submission happens to them, not by them.
 *
 * It makes no sound and announces nothing: the SoundDirector watches the
 * simulation this sets in motion and reports what actually happens.
 */

/** Seconds each automatic state holds before advancing. */
export const DURATION = {
  /**
   * The words assemble as particles, hold long enough to be recognised as
   * the thing that was just written, and then come apart.
   */
  UNDERSTANDING: 5.4,
  /** Long enough for the slowest offering type to reach Bappa. */
  TRANSFORMING: 16,
  /** The two closing lines, then the room returns to rest. */
  COMPLETE: 17,
} as const;

/** How long the particles hold the shape of the text before letting go. */
export const FORM_HOLD = 2.1;

/**
 * Nothing happens for this long after submitting.
 *
 * The offering is a ritual, and a ritual has a breath before it. Spawning
 * on the same frame as the click made the whole thing read as a UI
 * response; this pause is what turns it into something that was received.
 */
export const STILLNESS_BEFORE = 1.2;

/** Used only if there is nothing legible to sample. */
const FALLBACK_ORIGIN = new THREE.Vector3(0, 0.55, 1.35);

/**
 * Places sampled glyph points in the world so they land exactly where the
 * written words were sitting on screen.
 *
 * The text block's screen rectangle is converted to NDC and cast onto a
 * plane a fixed distance in front of the camera. Going through the camera
 * rather than using fixed world coordinates means the particles register
 * with the fading DOM text at any viewport size or focal length -- which
 * is the whole illusion.
 */
export function glyphsToWorld(
  points: Float32Array,
  rect: { left: number; top: number; width: number; height: number },
  camera: THREE.Camera,
  size: { width: number; height: number }
): Float32Array {
  const count = points.length / 2;
  const out = new Float32Array(count * 3);

  // A fixed, close plane rather than one derived from Bappa's distance.
  // Derived depth put the words almost on top of him -- no room to
  // travel -- and pushed the grains so far from the camera that point
  // attenuation collapsed them to the 1px floor, which is illegible.
  // Clamped so the text is always comfortably in front of the sculpture.
  const depth = Math.min(2.3, camera.position.distanceTo(BAPPA_CENTER) - 1.2);
  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const sx = rect.left + points[i * 2] * rect.width;
    const sy = rect.top + points[i * 2 + 1] * rect.height;

    v.set((sx / size.width) * 2 - 1, -((sy / size.height) * 2 - 1), 0.5);
    v.unproject(camera).sub(camera.position).normalize();

    out[i * 3] = camera.position.x + v.x * depth;
    out[i * 3 + 1] = camera.position.y + v.y * depth;
    out[i * 3 + 2] = camera.position.z + v.z * depth;
  }

  return out;
}

interface Props {
  perf: PerfProfile;
  particles: React.MutableRefObject<ParticleHandle>;
}

export function ContributionController({ perf, particles }: Props) {
  const { camera, size } = useThree();
  const emitted = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const store = useScene.getState();
    // Only the sequencing scales. Particle physics stay real-time, which
    // is what keeps a 4x visarjan looking like a visarjan rather than a
    // fast-forward.
    store.tick(dt * devTimeScale());

    const { state, elapsed, type, setState, consumeDraft } = useScene.getState();

    switch (state) {
      case 'UNDERSTANDING': {
        // Held first, then sampled -- so the words fade, nothing happens
        // for a beat, and only then does the material appear.
        if (!emitted.current && elapsed >= STILLNESS_BEFORE) {
          emitted.current = true;

          const system = particles.current.system;
          const budget = Math.floor(perf.offeringParticles * 0.85);

          // The one place the text is read. It is sampled to coordinates
          // and wiped in the same breath: nothing downstream of here can
          // recover a word of it, and the shape it made lasts seconds.
          const sampled = system
            ? sampleTextPoints(useScene.getState().draft, budget)
            : null;

          const { seed, weight } = consumeDraft();

          if (system) {
            let anchors: Float32Array;

            if (sampled) {
              // Register with the input's own box while it is still on
              // screen; otherwise centre a block of the same proportions.
              const el = document.querySelector('.input') as HTMLElement | null;
              const r = el?.getBoundingClientRect();
              const width = r?.width ?? Math.min(520, size.width - 48);
              const height = width / sampled.aspect;

              anchors = glyphsToWorld(
                sampled.points,
                {
                  left: r ? r.left : (size.width - width) / 2,
                  top: r ? r.top + 8 : size.height * 0.62,
                  width,
                  height,
                },
                camera,
                size
              );
            } else {
              const n = Math.floor(budget * 0.3);
              anchors = new Float32Array(n * 3);
              for (let i = 0; i < n; i++) {
                anchors[i * 3] = FALLBACK_ORIGIN.x + (Math.random() - 0.5) * 0.9;
                anchors[i * 3 + 1] = FALLBACK_ORIGIN.y + (Math.random() - 0.5) * 0.4;
                anchors[i * 3 + 2] = FALLBACK_ORIGIN.z + (Math.random() - 0.5) * 0.3;
              }
            }

            system.spawnFormation(anchors, type, seed, weight, FORM_HOLD);
          }

          // One more offering in the tally. This is the only thing that
          // makes Bappa more built -- and the only thing that leaves this
          // browser, if a shared source is configured. A number, nothing
          // else: no text, no type, no identity.
          void useCollective.getState().record();
        }

        if (elapsed >= DURATION.UNDERSTANDING) {
          // Anything still holding the shape lets go now, so the state
          // change and the visual release are the same moment.
          particles.current.system?.releaseFormation();
          setState('TRANSFORMING');
        }
        break;
      }

      case 'TRANSFORMING': {
        if (elapsed >= DURATION.TRANSFORMING) {
          emitted.current = false;
          setState('COMPLETE');
        }
        break;
      }

      case 'COMPLETE': {
        if (elapsed >= DURATION.COMPLETE) setState('IDLE');
        break;
      }

      default:
        emitted.current = false;
    }
  });

  return null;
}
