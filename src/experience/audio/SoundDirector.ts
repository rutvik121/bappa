'use client';

import { ARRIVAL_DISTANCE, type ParticleTelemetry } from '../systems/ParticleSystem';
import type { ContributionType, SceneStateName } from '../state/sceneState';
import {
  DARKNESS_HOLD,
  VISARJAN_DURATION,
  VISARJAN_MARKS,
} from '../components/DissolveController';
import type { EventPayload, ExperienceEvent, OfferingMotion } from './events';

/**
 * Watches the scene and says what is happening in it.
 *
 * The only thing in the codebase that emits experience events. It reads
 * the state machine, the particle simulation's telemetry and the dissolve
 * value every frame and turns them into moments -- the words have let go,
 * the first grain has entered the clay, the last light has gone -- so that
 * sound is in step with what the material is actually doing rather than
 * with a clock that assumes it.
 *
 * Plain logic with no React and no WebAudio, so the same director runs
 * inside the render loop and inside the offline sound lab.
 */

export interface SceneFrame {
  state: SceneStateName;
  elapsed: number;
  type: ContributionType;
  telemetry: ParticleTelemetry | null;
  dissolve: number;
  /** 0..1, how built the collective Bappa is. */
  build: number;
}

type Send = (event: ExperienceEvent, payload?: EventPayload) => void;

/** How far the camera travels on entering a state, relative to the push-in. */
const CAMERA_MOVE: Partial<Record<SceneStateName, number>> = {
  CONTRIBUTING: 1,
  IDLE: 0.55,
};

/** Share of the offering that must have let go before it counts as transformed. */
const TRANSFORM_SHARE = 0.08;
/** Share still travelling below which the offering counts as taken in. */
const ABSORBED_SHARE = 0.06;
/** The resonance never lands on top of the contact tone. */
const CONTACT_TO_ABSORB = 1.6;
/**
 * Share of fragments cracked before the break is heard: the first visible
 * cracks. Waiting for more put the break on the same frame as the contact,
 * because a broken fragment is the fastest thing in the piece.
 */
const BREAK_SHARE = 0.02;
/** A promise stops growing this long after it lets go (its reach in the simulation). */
const GROWTH_SECONDS = 5.5;
/** Half the frame's width in world units near Bappa, for placing sound. */
const PAN_WIDTH = 1.4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const panOf = (x: number) => Math.max(-1, Math.min(1, x / PAN_WIDTH));

interface OfferingWatch {
  type: ContributionType;
  t: number;
  spawned: number;
  gathered: boolean;
  transformed: boolean;
  travelling: boolean;
  contacted: boolean;
  broke: boolean;
  releasedAt: number;
  contactAt: number;
  startDist: number;
  peakJourney: number;
  arrived0: number;
  cracked0: number;
  prevArrived: number;
  prevCracked: number;
  prevGap: number;
  prevForming: number;
  gather: number;
  arrivalRate: number;
  crackRate: number;
  pan: number;
}

interface VisarjanWatch {
  /** Entered already over: a visitor arriving after the ending. */
  late: boolean;
  material: boolean;
  particles: boolean;
  complete: boolean;
  final: boolean;
}

export class SoundDirector {
  private last: SceneStateName | null = null;
  private offering: OfferingWatch | null = null;
  private visarjan: VisarjanWatch | null = null;

  /** Reused every frame: this is emitted sixty times a second. */
  private readonly motion: OfferingMotion = {
    forming: 0,
    gather: 0,
    speed: 0,
    proximity: 0,
    density: 0,
    rise: 0,
    arrivalRate: 0,
    broken: 0,
    crackRate: 0,
    growth: 0,
    pan: 0,
  };
  private readonly motionPayload: EventPayload = { motion: this.motion };

  constructor(private readonly send: Send) {}

  step(dt: number, f: SceneFrame): void {
    if (dt <= 0) return;
    if (f.state !== this.last) {
      const prev = this.last;
      this.last = f.state;
      this.enter(f, prev);
    }
    if (this.offering) this.watchOffering(dt, f);
    if (this.visarjan && f.state === 'VISARJAN') this.watchVisarjan(f);
  }

  private enter(f: SceneFrame, prev: SceneStateName | null) {
    if (prev === null) {
      if (f.state === 'VISARJAN') this.beginVisarjan(f);
      return;
    }

    const move = CAMERA_MOVE[f.state];
    if (move && prev !== 'VISARJAN') this.send('SPACE_SHIFT', { amount: move });

    // An offering that is interrupted still has to let go of its sound.
    if (this.offering && f.state !== 'UNDERSTANDING' && f.state !== 'TRANSFORMING') {
      if (f.state === 'VISARJAN') this.offering = null;
      else this.resolve(f);
    }

    if (f.state === 'UNDERSTANDING') {
      if (this.offering) this.resolve(f);
      this.offering = {
        type: f.type,
        t: 0,
        spawned: 0,
        gathered: false,
        transformed: false,
        travelling: false,
        contacted: false,
        broke: false,
        releasedAt: 0,
        contactAt: 0,
        startDist: 2,
        peakJourney: 0,
        arrived0: -1,
        cracked0: 0,
        prevArrived: 0,
        prevCracked: 0,
        prevGap: 0,
        prevForming: 0,
        gather: 0,
        arrivalRate: 0,
        crackRate: 0,
        pan: 0,
      };
      // Randomness, not the text: nothing about what was written reaches sound.
      this.send('OFFERING_STARTED', { type: f.type, seed: Math.random() });
    }

    if (prev === 'VISARJAN') {
      this.visarjan = null;
      this.send('ROOM_RESTORED');
    }
    if (f.state === 'VISARJAN') this.beginVisarjan(f);
  }

  /* ---------------- offerings ---------------- */

  private watchOffering(dt: number, f: SceneFrame) {
    const o = this.offering!;
    const tel = f.telemetry;
    o.t += dt;
    if (!tel) return;

    if (o.arrived0 < 0) {
      o.arrived0 = tel.arrived;
      o.cracked0 = tel.cracked;
    }

    if (!o.gathered) {
      if (tel.forming === 0) return;
      o.gathered = true;
      o.spawned = tel.forming;
      o.prevGap = tel.formingGap;
      o.prevForming = tel.forming;
      this.send('OFFERING_GATHERING', { type: o.type });
    }

    const total = Math.max(1, o.spawned);
    const k = Math.min(1, dt * 6);

    // How fast the words are closing onto their glyph points.
    const closing =
      tel.forming > 0 && o.prevForming > 0 ? Math.max(0, (o.prevGap - tel.formingGap) / dt) : 0;
    o.gather += (closing - o.gather) * Math.min(1, dt * 10);
    o.prevGap = tel.formingGap;
    o.prevForming = tel.forming;

    if (!o.transformed && tel.journey >= total * TRANSFORM_SHARE) {
      o.transformed = true;
      o.releasedAt = o.t;
      this.send('OFFERING_TRANSFORMED', { type: o.type });
    }
    if (o.transformed && !o.travelling && tel.forming === 0) {
      o.travelling = true;
      o.startDist = Math.max(ARRIVAL_DISTANCE + 0.3, tel.journeyDist);
      this.send('OFFERING_TRAVELLING', { type: o.type });
    }
    o.peakJourney = Math.max(o.peakJourney, tel.journey);

    const arrived = tel.arrived - o.arrived0;
    o.arrivalRate += ((arrived - o.prevArrived) / total / dt - o.arrivalRate) * k;
    o.prevArrived = arrived;

    // The first grain to reach the clay, on the frame the simulation moved
    // it there -- which is the frame its light is lit.
    if (!o.contacted && arrived > 0) {
      o.contacted = true;
      o.contactAt = o.t;
      o.pan = panOf(tel.lastArrivalX);
      this.send('OFFERING_CONTACT', { type: o.type, pan: o.pan, amount: f.build });
    }

    const cracked = (tel.cracked - o.cracked0) / total;
    o.crackRate += ((cracked - o.prevCracked) / dt - o.crackRate) * k;
    o.prevCracked = cracked;
    if (o.type === 'VIGHNA' && !o.broke && cracked >= BREAK_SHARE) {
      o.broke = true;
      this.send('OFFERING_BREAK', { type: o.type, pan: panOf(tel.meanX) });
    }

    const m = this.motion;
    m.forming = tel.forming / total;
    m.gather = o.gather;
    m.speed = tel.journeySpeed;
    m.proximity = o.travelling
      ? clamp01(1 - (tel.journeyDist - ARRIVAL_DISTANCE) / Math.max(0.2, o.startDist - ARRIVAL_DISTANCE))
      : 0;
    m.density = tel.journey / total;
    m.rise = tel.journeyRise;
    m.arrivalRate = Math.max(0, o.arrivalRate);
    m.broken = clamp01(cracked);
    m.crackRate = Math.max(0, o.crackRate);
    m.growth =
      o.type === 'PROMISE' && o.transformed ? clamp01(1 - (o.t - o.releasedAt) / GROWTH_SECONDS) : 0;
    m.pan = panOf(tel.meanX);
    this.send('OFFERING_MOTION', this.motionPayload);

    const settled = tel.journey <= o.peakJourney * ABSORBED_SHARE;
    if ((o.contacted && o.t - o.contactAt > CONTACT_TO_ABSORB && settled) || o.t > 40) {
      this.resolve(f);
    }
  }

  private resolve(f: SceneFrame) {
    const o = this.offering;
    if (!o) return;
    this.offering = null;
    this.send('OFFERING_ABSORBED', { type: o.type, amount: f.build, pan: o.pan });
  }

  /* ---------------- Visarjan ---------------- */

  private beginVisarjan(f: SceneFrame) {
    const late = f.elapsed > 1;
    this.visarjan = { late, material: false, particles: false, complete: false, final: false };
    if (!late) this.send('VISARJAN_STARTED');
  }

  private watchVisarjan(f: SceneFrame) {
    const v = this.visarjan!;
    const d = f.dissolve;

    if (!v.late && !v.complete) {
      if (!v.material && d > 0.001) {
        v.material = true;
        this.send('VISARJAN_MATERIAL_RELEASE');
      }
      this.send('VISARJAN_DISSOLVE', { amount: d });
      if (!v.particles && f.elapsed >= VISARJAN_MARKS.release) {
        v.particles = true;
        this.send('VISARJAN_PARTICLE_RELEASE');
      }
    }

    // The instant the last light is gone, not a moment later.
    if (!v.complete && (d >= VISARJAN_MARKS.empty || f.elapsed >= VISARJAN_DURATION)) {
      v.complete = true;
      this.send('VISARJAN_COMPLETE');
    }

    if (!v.final && f.elapsed >= VISARJAN_DURATION + DARKNESS_HOLD) {
      v.final = true;
      this.send('FINAL_MESSAGE');
    }
  }
}
