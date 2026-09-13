'use client';

/**
 * Experience events.
 *
 * Sound is triggered by these and by nothing else. The alternative --
 * `setTimeout` calls scattered through the components that happen to know
 * when something looks finished -- drifts out of sync the moment any
 * visual timing is retuned, and there is no single place to read what the
 * piece is supposed to sound like.
 *
 * Exactly one thing emits them: the SoundDirector, which watches the scene
 * and the particle simulation every frame. What an event sounds like is
 * decided in AudioManager, and every level and timing lives in score.ts.
 */

export type ContributionKind = 'GRATITUDE' | 'WISH' | 'VIGHNA' | 'PROMISE';

export type ExperienceEvent =
  /** The camera has moved somewhere new in the room. */
  | 'SPACE_SHIFT'
  /** The visitor submitted. Nothing has moved yet. */
  | 'OFFERING_STARTED'
  /** Material has appeared and is condensing into the shape of the words. */
  | 'OFFERING_GATHERING'
  /** The words have begun to let go. */
  | 'OFFERING_TRANSFORMED'
  /** Every grain has let go of the text and is on its way. */
  | 'OFFERING_TRAVELLING'
  /** Every frame an offering is alive: how its material is moving. */
  | 'OFFERING_MOTION'
  /** Vighna only: the knot has cracked. */
  | 'OFFERING_BREAK'
  /** The first grain has entered the clay -- the frame the light blooms. */
  | 'OFFERING_CONTACT'
  /** He has taken it in. */
  | 'OFFERING_ABSORBED'
  /** Sthapana arrival transition begins. */
  | 'STHAPANA_STARTED'
  /** Sthapana arrival completes at 14s. */
  | 'STHAPANA_COMPLETE'
  /** Dev/testing: returned to PRE_STHAPANA before Sthapana. */
  | 'PRE_STHAPANA_RESTORED'
  | 'VISARJAN_STARTED'
  /** The first material has come away from him. */
  | 'VISARJAN_MATERIAL_RELEASE'
  /** Every frame while he comes apart; dissolve 0..1.34 in `amount`. */
  | 'VISARJAN_DISSOLVE'
  /** The particle Bappa stops holding his shape. */
  | 'VISARJAN_PARTICLE_RELEASE'
  /** The last point of light has gone. Silence from here. */
  | 'VISARJAN_COMPLETE'
  /** The closing words have begun. */
  | 'FINAL_MESSAGE'
  /** Development only: Visarjan was left and the room is back. */
  | 'ROOM_RESTORED';

/**
 * How an offering's material is moving, measured from the simulation.
 * Sound follows these rather than a timeline, so if the choreography is
 * retuned the sound is already in step with it.
 */
export interface OfferingMotion {
  /** 0..1 of the offering still holding the shape of the words. */
  forming: number;
  /** How fast the words are condensing, world units per second. */
  gather: number;
  /** Mean speed of the travelling material, world units per second. */
  speed: number;
  /** 0 when it lets go of the words, 1 at his surface. */
  proximity: number;
  /** 0..1 of the offering still travelling. */
  density: number;
  /** Mean vertical velocity of the travelling material. */
  rise: number;
  /** Share of the offering entering him, per second. */
  arrivalRate: number;
  /** Vighna: 0..1 of its fragments that have cracked. */
  broken: number;
  /** Vighna: share of fragments cracking, per second. */
  crackRate: number;
  /** Promise: 1 as it lets go, falling to 0 as it stops growing. */
  growth: number;
  /** -1..1, where the material is across the frame. */
  pan: number;
}

export interface EventPayload {
  /** Magnitude where an event has one: dissolve, collective build, camera travel. */
  amount?: number;
  /** Stable per-offering randomness, so repeats are never identical. */
  seed?: number;
  /** Which offering this concerns. */
  type?: ContributionKind;
  /** -1..1, where on him (or across the frame) this happened. */
  pan?: number;
  motion?: OfferingMotion;
}

type Listener = (event: ExperienceEvent, payload: EventPayload) => void;

const listeners = new Set<Listener>();

export function onExperienceEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announce that something happened. Deliberately fire-and-forget and
 * never throws: a failure in a listener must never be able to interrupt
 * the render loop or a state transition.
 */
export function emit(event: ExperienceEvent, payload: EventPayload = {}): void {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch {
      /* sound is never allowed to break the experience */
    }
  }
}
