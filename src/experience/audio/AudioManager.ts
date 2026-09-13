'use client';

import { ASSETS, type AssetName } from './assets';
import {
  onExperienceEvent,
  type ContributionKind,
  type EventPayload,
  type ExperienceEvent,
  type OfferingMotion,
} from './events';
import {
  BREAK,
  FINAL,
  MASTER,
  OFFERING,
  RECEIVE,
  SPACE,
  STHAPANA,
  VISARJAN,
  dB,
  sample,
  type OfferingSound,
} from './score';
import { getRitualState, getSthapanaArrival } from '../state/festival';

/**
 * The room, and every sound made in it.
 *
 *   SPACE           tanpura and bansuri in the hall; the pandal outside at night
 *   OFFERING        each offering approaches in its own way
 *   TRANSFORMATION  the moment a thing stops being what it was (the coconut, the bansuri)
 *   BAPPA           received: a touch on clay, and the clay body answering -- the same for all
 *   VISARJAN        the sound being taken away as he goes
 *   SILENCE         a state: every bus cut, every source stopped, context released
 *
 * Sound follows the simulation, not a timeline. The director reports what
 * the material is doing each frame and the layers here are steered by it;
 * which sound, how loud and how it moves all live in score.ts.
 *
 * The same graph renders offline (OfflineAudioContext + an injected clock),
 * which is how the piece is auditioned and measured without a browser tab.
 */

export type SoundStatus = 'off' | 'on' | 'muted';

interface Clip {
  buffer: AudioBuffer;
  /** Where the audio actually starts: decoders may pad the front of an mp3. */
  offset: number;
}

interface Voice {
  stop(at: number, tau: number): void;
}

type BusName = 'room' | 'offering' | 'bappa' | 'visarjan' | 'final';

const ORDER = Object.keys(ASSETS) as AssetName[];
/** Heard only at the very end. */
const FAREWELL_ASSETS: readonly AssetName[] = ['dhol-tasha', 'clay-crumble', 'gulal-dust', 'shankh-final'];
/** Scattered hits are scheduled this far ahead of the clock. */
const LOOKAHEAD = 0.12;
/** Simultaneous scattered hits. Past this, a hit is dropped rather than a frame. */
const MAX_HITS = 12;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampPan = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
const between = (a: number, b: number) => a + (b - a) * Math.random();

function onsetOf(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, Math.floor(buffer.sampleRate * 0.25));
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i]) > 2e-4) return Math.max(0, i - 1) / buffer.sampleRate;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* voices                                                              */
/* ------------------------------------------------------------------ */

interface LayerOptions {
  cutoff: number;
  wet: number;
  rate?: number;
  /** Start somewhere random in the cycle (textures), or at the top (music). */
  randomStart?: boolean;
}

/** A looping layer: source → lowpass → pan → level, with a reverb send. */
class Layer implements Voice {
  private readonly src: AudioBufferSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly panner: StereoPannerNode | null;
  private readonly out: GainNode;
  private readonly send: GainNode;
  private stopped = false;

  constructor(m: AudioManager, clip: Clip, loop: number, bus: AudioNode, at: number, o: LayerOptions) {
    const ctx = m.context!;
    this.src = ctx.createBufferSource();
    this.src.buffer = clip.buffer;
    this.src.loop = true;
    this.src.loopStart = clip.offset;
    this.src.loopEnd = clip.offset + loop;
    this.src.playbackRate.value = o.rate ?? 1;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    this.filter.frequency.value = o.cutoff;

    this.panner = m.createPanner(0);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.send = ctx.createGain();
    this.send.gain.value = o.wet;

    this.src.connect(this.filter);
    if (this.panner) {
      this.filter.connect(this.panner);
      this.panner.connect(this.out);
    } else {
      this.filter.connect(this.out);
    }
    this.out.connect(bus);
    this.out.connect(this.send);
    this.send.connect(m.reverbInput!);

    this.src.start(at, clip.offset + (o.randomStart === false ? 0 : Math.random() * loop));
    this.src.onended = () => {
      for (const n of [this.src, this.filter, this.panner, this.out, this.send]) n?.disconnect();
    };
  }

  gain(v: number, at: number, tau: number) {
    if (!this.stopped) this.out.gain.setTargetAtTime(v, at, tau);
  }
  cutoff(hz: number, at: number, tau: number) {
    this.filter.frequency.setTargetAtTime(hz, at, tau);
  }
  rate(r: number, at: number, tau: number) {
    this.src.playbackRate.setTargetAtTime(r, at, tau);
  }
  pan(p: number, at: number, tau: number) {
    this.panner?.pan.setTargetAtTime(clampPan(p), at, tau);
  }
  wet(w: number, at: number, tau: number) {
    this.send.gain.setTargetAtTime(w, at, tau);
  }
  stop(at: number, tau: number) {
    if (this.stopped) return;
    this.out.gain.setTargetAtTime(0, at, tau);
    this.stopped = true;
    try {
      this.src.stop(at + tau * 10);
    } catch {
      /* already stopped */
    }
  }
}

interface ScatterOptions {
  db: number;
  wet: number;
  pitch: readonly [number, number];
  spread: number;
}

/**
 * Hits drawn from a few takes of the same sound, at a rate that can change
 * every frame. Poisson-timed so it reads as material moving, not as a
 * rhythm; never the same take twice running.
 */
class Scatter implements Voice {
  rate = 0;
  center = 0;
  private readonly out: GainNode;
  private readonly send: GainNode;
  private next = -1;
  private drawn = 0;
  private last = -1;

  constructor(
    private readonly m: AudioManager,
    private readonly names: readonly AssetName[],
    bus: AudioNode,
    private readonly o: ScatterOptions
  ) {
    const ctx = m.context!;
    this.out = ctx.createGain();
    this.send = ctx.createGain();
    this.send.gain.value = o.wet;
    this.out.connect(bus);
    this.out.connect(this.send);
    this.send.connect(m.reverbInput!);
  }

  pump(now: number) {
    if (this.rate <= 0.01) {
      this.next = -1;
      return;
    }
    const gap = () => -Math.log(1 - Math.random()) / this.rate;
    if (this.next < 0) this.next = now + gap() * Math.random();
    else if (this.next < now - 0.25 || this.rate > this.drawn * 1.6) this.next = now + gap();
    this.drawn = this.rate;

    let guard = 0;
    while (this.next < now + LOOKAHEAD && guard++ < 8) {
      this.single(Math.max(now, this.next));
      this.next += gap();
    }
  }

  single(at: number, level = 1, db?: number) {
    const ctx = this.m.context;
    if (!ctx || this.names.length === 0) return;
    let index = Math.floor(Math.random() * this.names.length);
    if (this.names.length > 1 && index === this.last) index = (index + 1) % this.names.length;
    this.last = index;
    const clip = this.m.clipFor(this.names[index]);
    if (!clip) return;
    const rate = between(this.o.pitch[0], this.o.pitch[1]);
    if (!this.m.claimHit(at, clip.buffer.duration / rate)) return;

    try {
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = dB(db ?? this.o.db) * level * between(0.55, 1);
      const p = this.m.createPanner(this.center + (Math.random() * 2 - 1) * this.o.spread);
      src.connect(g);
      if (p) {
        g.connect(p);
        p.connect(this.out);
      } else {
        g.connect(this.out);
      }
      src.start(at, clip.offset);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
        p?.disconnect();
      };
    } catch {
      /* a dropped hit is inaudible; a thrown one is not */
    }
  }

  stop(at: number, tau: number) {
    this.rate = 0;
    this.out.gain.setTargetAtTime(0, at, tau);
  }
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

interface Offering {
  type: ContributionKind;
  spec: OfferingSound;
  seed: number;
  stage: 'start' | 'gather' | 'transform' | 'travel';
  gather: Scatter;
  /** Tiny touches on clay as the rest of the offering enters him. */
  touches: Scatter;
  carrier: Layer | null;
  contacted: boolean;
  /** Carrier trim after contact: the offering has gone inside him. */
  duck: number;
  last: number;
  pan: number;
}

interface VisarjanVoices {
  dhol: Layer | null;
  crumble: Layer | null;
  touches: Scatter;
  last: number;
}

interface ShotOptions {
  db: number;
  bus: BusName;
  rate?: number;
  pan?: number;
  cutoff?: number;
  wet?: number;
  wetTo?: number;
  wetTau?: number;
}

/* ------------------------------------------------------------------ */
/* the manager                                                         */
/* ------------------------------------------------------------------ */

export class AudioManager {
  private ctx: BaseAudioContext | null = null;
  private live: AudioContext | null = null;
  /** Injected by offline renders; live playback reads the context clock. */
  private clock: (() => number) | null = null;
  private lowPower = false;

  private readonly bytes = new Map<AssetName, Promise<ArrayBuffer | null>>();
  private readonly decoding = new Map<AssetName, Promise<void>>();
  private readonly clips = new Map<AssetName, Clip>();

  private master: GainNode | null = null;
  private muteGain: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private reverbOut: GainNode | null = null;
  private buses: Record<BusName, GainNode> | null = null;

  /**
   * Tracked even before there is a context, so a tap that arrives after
   * he has gone can never bring the room back.
   */
  private phase: 'room' | 'visarjan' | 'gone' = 'room';
  private muted = false;
  private unlockedAt = -1e9;
  private finished = false;
  private lastTick = -1;
  private readonly hitEnds: number[] = [];
  private readonly listeners = new Set<(s: SoundStatus) => void>();

  private music: Layer | null = null;
  private pandal: Layer | null = null;
  private sthapanaVoice: Voice | null = null;
  private nextWander = 0;

  private offering: Offering | null = null;
  private resonance: Voice | null = null;
  private lastResonance = -1;
  private visarjan: VisarjanVoices | null = null;

  /* ---------------- plumbing used by voices ---------------- */

  get context() {
    return this.ctx;
  }
  get reverbInput() {
    return this.reverbIn;
  }
  clipFor(name: AssetName) {
    return this.clips.get(name) ?? null;
  }
  createPanner(pan = 0): StereoPannerNode | null {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.createStereoPanner !== 'function') return null;
    const p = ctx.createStereoPanner();
    p.pan.value = clampPan(pan);
    return p;
  }
  /** Voice limiting by schedule, so it works offline where nothing has ended yet. */
  claimHit(at: number, length: number): boolean {
    const ends = this.hitEnds;
    let w = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > at) ends[w++] = ends[i];
    ends.length = w;
    if (w >= MAX_HITS) return false;
    ends.push(at + length);
    return true;
  }

  private now() {
    return this.clock ? this.clock() : (this.ctx?.currentTime ?? 0);
  }
  private bus(name: BusName) {
    return this.buses![name];
  }

  /* ---------------- lifecycle ---------------- */

  /**
   * Fetch the assets before they are needed. Bytes only -- no context, which
   * browsers refuse before a gesture. The room first, the procession last.
   */
  prefetch(names: readonly AssetName[] = ORDER): void {
    if (typeof fetch === 'undefined') return;
    for (const name of names) {
      if (this.bytes.has(name) || this.clips.has(name)) continue;
      this.bytes.set(
        name,
        fetch(`/audio/${name}.mp3`, { cache: 'force-cache' })
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null)
      );
    }
  }

  /**
   * Before any gesture: only what the room and an offering need. The
   * procession and the farewell -- a megabyte and more -- wait until sound
   * is actually wanted, and a phone on a data saver fetches nothing early.
   */
  prefetchEarly(): void {
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } })
      .connection;
    if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return;
    this.prefetch(ORDER.filter((n) => !FAREWELL_ASSETS.includes(n)));
  }

  /**
   * Wakes sound on the first meaningful gesture anywhere on the page.
   * Capture phase, so it runs before whatever the gesture was aimed at.
   */
  armGesture(): () => void {
    const kinds = ['pointerup', 'touchend', 'keydown', 'click'] as const;
    const off = () => kinds.forEach((k) => window.removeEventListener(k, fire, true));
    const fire = () => {
      this.init();
      off();
    };
    kinds.forEach((k) => window.addEventListener(k, fire, { capture: true, passive: true }));
    return off;
  }

  /** Must run inside a user gesture. Everything audible starts here. */
  init(): void {
    if (typeof window === 'undefined') return;
    // Nothing of his is heard after he has gone -- not even the room.
    if (this.phase === 'gone') return;
    if (this.live) {
      if (this.live.state !== 'running') void this.live.resume().catch(() => {});
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new Ctor();
      } catch {
        return;
      }
    }

    this.ctx = ctx;
    this.live = ctx;
    this.unlockedAt = performance.now();
    this.lowPower = (navigator.hardwareConcurrency ?? 4) <= 4;

    // iOS only releases the output once something has actually been played
    // inside the gesture. One silent sample does it.
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* not needed on this browser */
    }
    void ctx.resume().catch(() => {});
    ctx.onstatechange = () => this.notify();

    this.build();
    this.prefetch();
    // The room first -- arriving should never wait on a procession.
    void this.decode(['bhakti-ambience', 'pandal-night', 'temple-ghanta', 'sthapana-music']).then(() => {
      if (this.phase === 'room') this.playAmbient();
      return this.decode(ORDER);
    });

    window.setInterval(() => this.tick(), 90);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.notify();
  }

  /** Offline audition: the same graph, driven by a simulated clock. */
  async renderInto(ctx: OfflineAudioContext, clock: () => number): Promise<void> {
    this.ctx = ctx;
    this.clock = clock;
    this.build();
    this.prefetch();
    await this.decode(ORDER);
  }

  private decode(names: AssetName[]): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    this.prefetch();
    return Promise.all(
      names.map((name) => {
        let p = this.decoding.get(name);
        if (!p) {
          p = (this.bytes.get(name) ?? Promise.resolve(null))
            .then(async (data) => {
              if (!data) return;
              // decodeAudioData detaches its input, so it gets a copy.
              const buffer = await ctx.decodeAudioData(data.slice(0));
              this.clips.set(name, { buffer, offset: onsetOf(buffer) });
            })
            .catch(() => {
              /* this one sound will simply not exist */
            });
          this.decoding.set(name, p);
        }
        return p;
      })
    ).then(() => undefined);
  }

  private build(): void {
    const ctx = this.ctx!;

    const master = ctx.createGain();
    master.gain.value = dB(MASTER.gainDb);
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = MASTER.highpass;
    hpf.Q.value = 0.6;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 9000;
    shelf.gain.value = MASTER.airShelfDb;
    // A safety, not a sound: nothing in the score should reach it.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    const mute = ctx.createGain();
    mute.gain.value = this.muted ? 0 : 1;

    master.connect(hpf);
    hpf.connect(shelf);
    shelf.connect(limiter);
    limiter.connect(mute);
    mute.connect(ctx.destination);

    const reverbIn = ctx.createGain();
    const reverbHp = ctx.createBiquadFilter();
    reverbHp.type = 'highpass';
    reverbHp.frequency.value = MASTER.reverbHighpass;
    const convolver = ctx.createConvolver();
    convolver.buffer = this.impulse();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = dB(MASTER.reverbDb);
    reverbIn.connect(reverbHp);
    reverbHp.connect(convolver);
    convolver.connect(reverbOut);
    reverbOut.connect(master);

    const bus = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };

    this.master = master;
    this.muteGain = mute;
    this.reverbIn = reverbIn;
    this.reverbOut = reverbOut;
    this.buses = { room: bus(), offering: bus(), bappa: bus(), visarjan: bus(), final: bus() };
  }

  /**
   * The hall itself, generated rather than downloaded: diffuse noise whose
   * highs die first and whose lows hang, with a few early reflections off
   * stone -- the space the clay and the shankh ring in.
   */
  private impulse(): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const seconds = this.lowPower ? MASTER.reverbSecondsLow : MASTER.reverbSeconds;
    const n = Math.floor(seconds * sr);
    const ir = ctx.createBuffer(2, n, sr);
    const pre = Math.floor(MASTER.preDelay * sr);
    const aLow = 1 - Math.exp((-2 * Math.PI * 450) / sr);
    const aMid = 1 - Math.exp((-2 * Math.PI * 3200) / sr);
    const kLow = 6.91 / MASTER.decay.low;
    const kMid = 6.91 / MASTER.decay.mid;
    const kHigh = 6.91 / MASTER.decay.high;

    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let l1 = 0;
      let l2 = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const w = Math.random() * 2 - 1;
        l1 += (w - l1) * aLow;
        l2 += (w - l2) * aMid;
        const onset = Math.min(1, t / 0.03);
        d[i] =
          (l1 * 3.2 * Math.exp(-t * kLow) +
            (l2 - l1) * 1.2 * Math.exp(-t * kMid) +
            (w - l2) * 0.5 * Math.exp(-t * kHigh)) *
          onset;
      }
      for (let k = 0; k < 7; k++) {
        const at = pre + Math.floor((0.008 + Math.random() * 0.07) * sr);
        if (at < n) d[at] += (Math.random() < 0.5 ? -1 : 1) * between(0.25, 0.6);
      }
    }
    return ir;
  }

  private onVisibility = () => {
    const live = this.live;
    if (!live) return;
    if (document.hidden) void live.suspend().catch(() => {});
    else if (this.phase !== 'gone') {
      void live.resume().catch(() => {});
      if (this.phase === 'room') {
        const ritual = this.clock ? 'BAPPA_PRESENT' : getRitualState();
        if (ritual === 'BAPPA_PRESENT' && !this.music && !this.sthapanaVoice) {
          this.playAmbient(true);
        } else if (ritual === 'PRE_STHAPANA' && this.music) {
          this.music.stop(this.now(), 0.4);
          this.music = null;
        }
      }
    }
  };

  /* ---------------- status and controls ---------------- */

  onStatus(listener: (s: SoundStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private status(): SoundStatus {
    if (!this.live || this.live.state !== 'running') return 'off';
    return this.muted ? 'muted' : 'on';
  }

  private notify() {
    const s = this.status();
    this.listeners.forEach((l) => l(s));
  }

  /** The one control. Wakes sound if it is asleep, otherwise mutes and unmutes. */
  toggle(): void {
    if (!this.live || this.live.state !== 'running') {
      this.muted = false;
      this.applyMute(0.2);
      this.init();
      return;
    }
    // The same tap that just woke the room must not immediately silence it.
    if (performance.now() - this.unlockedAt < 500) return;
    this.setMuted(!this.muted);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute(0.15);
    this.notify();
  }

  private applyMute(tau: number) {
    if (!this.muteGain || !this.ctx) return;
    this.muteGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.now(), tau);
  }

  setMasterVolume(v: number): void {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(dB(MASTER.gainDb) * clamp01(v), this.now(), 0.1);
  }

  /* ---------------- the clock ---------------- */

  /** Schedules scattered hits and lets the pandal breathe. Cheap; safe to call often. */
  tick(): void {
    if (!this.ctx || !this.buses) return;
    const now = this.now();
    if (now - this.lastTick < 0.025) return;
    this.lastTick = now;

    // Safety: ensure daily music never plays during PRE_STHAPANA or POST_VISARJAN
    if (!this.clock) {
      const ritual = getRitualState();
      if ((ritual === 'PRE_STHAPANA' || ritual === 'POST_VISARJAN') && this.music) {
        this.music.stop(now, 0.4);
        this.music = null;
      }
    }

    if (this.phase === 'room' && this.pandal && now >= this.nextWander) {
      this.pandal.gain(dB(SPACE.pandalDb + between(-SPACE.wanderDb, SPACE.wanderDb * 0.5)), now, 3);
      this.nextWander = now + between(SPACE.wanderGap[0], SPACE.wanderGap[1]);
    }

    const o = this.offering;
    if (o) {
      o.gather.pump(now);
      o.touches.pump(now);
    }
    this.visarjan?.touches.pump(now);
  }

  /* ---------------- events ---------------- */

  handle(event: ExperienceEvent, p: EventPayload = {}): void {
    if (event === 'VISARJAN_STARTED') this.phase = 'visarjan';
    if (event === 'VISARJAN_COMPLETE') this.phase = 'gone';
    if (event === 'ROOM_RESTORED') this.phase = 'room';
    if (!this.ctx || !this.buses) return;

    switch (event) {
      case 'STHAPANA_STARTED':
        return this.playSthapanaStart();
      case 'STHAPANA_COMPLETE':
        return this.playSthapanaComplete();
      case 'PRE_STHAPANA_RESTORED':
        return this.playPreSthapana();
      case 'SPACE_SHIFT':
        return this.spaceShift(p.amount ?? 1);
      case 'OFFERING_STARTED':
        return this.playOfferingStart(p.type ?? 'GRATITUDE', p.seed);
      case 'OFFERING_GATHERING':
        return this.playOfferingGather();
      case 'OFFERING_TRANSFORMED':
        return this.playOfferingTransform();
      case 'OFFERING_TRAVELLING':
        return this.playOfferingTravel();
      case 'OFFERING_MOTION':
        if (p.motion) this.offeringMotion(p.motion);
        return;
      case 'OFFERING_BREAK':
        return this.playOfferingBreak(p.pan ?? 0);
      case 'OFFERING_CONTACT':
        return this.playOfferingContact(p.pan ?? 0, p.amount ?? 0);
      case 'OFFERING_ABSORBED':
        return this.playOfferingAbsorbed();
      case 'VISARJAN_STARTED':
        return this.playVisarjanStart();
      case 'VISARJAN_MATERIAL_RELEASE':
        return this.playVisarjanMaterial();
      case 'VISARJAN_DISSOLVE':
        return this.visarjanDissolve(p.amount ?? 0);
      case 'VISARJAN_PARTICLE_RELEASE':
        return this.playVisarjanRelease();
      case 'VISARJAN_COMPLETE':
        return this.stopAll();
      case 'FINAL_MESSAGE':
        return this.playFinalBell();
      case 'ROOM_RESTORED':
        return this.restoreRoom();
    }
  }

  /* ---------------- SPACE ---------------- */

  /**
   * The room. From silence: the pandal outside first, the tanpura and
   * bansuri a moment later, and then one distant ghanta.
   *
   * In PRE_STHAPANA: ONLY the quiet pandal-night pre-arrival atmosphere.
   * Daily BAPPA_PRESENT music (bhakti-ambience) and temple-ghanta welcome
   * bell must NOT play until Bappa arrives.
   */
  playAmbient(settled = false): void {
    if (!this.ctx || !this.buses || this.phase !== 'room') return;
    const now = this.now();
    const ritual = this.clock ? 'BAPPA_PRESENT' : getRitualState();

    if (ritual === 'POST_VISARJAN') return;

    // If Sthapana arrival is currently happening, play Sthapana music instead of bhakti-ambience
    const arrival = getSthapanaArrival();
    if (arrival.isArriving) {
      this.playSthapanaStart();
      return;
    }

    // Pandal night atmosphere: always present in the room (quiet pre-arrival in PRE_STHAPANA,
    // and subtle pandal ambience in BAPPA_PRESENT).
    if (!this.pandal) {
      this.pandal = this.layer('pandal-night', 'room', now, { cutoff: 12000, wet: 0.05 });
      this.pandal?.gain(dB(SPACE.pandalDb), now + (settled ? 0 : SPACE.pandalDelay), settled ? 0.01 : SPACE.pandalTau);
      this.nextWander = now + 8;
    }

    // PRE_STHAPANA: ONLY the quiet pre-arrival atmosphere.
    // The daily BAPPA_PRESENT background music must NOT play.
    // No bansuri / bhakti ambience / daily Bappa music.
    // No temple-ghanta welcome bell.
    if (ritual === 'PRE_STHAPANA') {
      if (this.music) {
        this.music.stop(now, 0.4);
        this.music = null;
      }
      return;
    }

    // BAPPA_PRESENT: Start daily bhakti ambience (flute/tanpura) and welcome ghanta
    if (!this.music && !this.sthapanaVoice) {
      this.music = this.layer('bhakti-ambience', 'room', now, { cutoff: 16000, wet: 0.12, randomStart: false });
      this.music?.gain(dB(SPACE.musicDb), now + (settled ? 0 : SPACE.musicDelay), settled ? 0.01 : SPACE.musicTau);

      if (!settled) {
        this.shot('temple-ghanta', now + SPACE.welcomeAt, {
          db: SPACE.welcomeDb,
          bus: 'room',
          cutoff: 2500,
          wet: 0.5,
          pan: 0.1,
        });
      }
    }
  }

  /* ---------------- STHAPANA: the arrival ---------------- */

  /**
   * Sthapana arrival music: plays dedicated 14-second arrival track once.
   * Stops any normal bhakti-ambience so Sthapana music plays unaccompanied by flute/tanpura.
   * Pandal night ambience remains subtle in the background without duplicate layers.
   */
  playSthapanaStart(): void {
    if (!this.ctx || !this.buses || this.phase !== 'room') return;
    if (this.sthapanaVoice) return;
    const now = this.now();

    // 1. Stop normal bhakti ambience if it was playing
    if (this.music) {
      this.music.stop(now, 0.4);
      this.music = null;
    }

    // 2. Ensure pandal night room atmosphere is present (transitions pre-existing or starts fresh)
    if (!this.pandal) {
      this.pandal = this.layer('pandal-night', 'room', now, { cutoff: 12000, wet: 0.05 });
      this.pandal?.gain(dB(SPACE.pandalDb), now, 0.5);
    }

    // 3. Play sthapana track once on the room bus (routed through master + muteGain)
    this.sthapanaVoice = this.shot('sthapana-music', now, {
      db: STHAPANA.musicDb,
      bus: 'room',
      wet: 0.12,
    });
  }

  /**
   * Transition cleanly from Sthapana music into normal BAPPA_PRESENT bhakti ambience at 14s.
   */
  playSthapanaComplete(): void {
    if (!this.ctx || !this.buses || this.phase !== 'room') return;
    const now = this.now();
    const ritual = this.clock ? 'BAPPA_PRESENT' : getRitualState();

    // 1. Crossfade out sthapana voice over crossfadeTau
    if (this.sthapanaVoice) {
      this.sthapanaVoice.stop(now, STHAPANA.crossfadeTau);
      this.sthapanaVoice = null;
    }

    // 2. Crossfade in bhakti-ambience only if we are in BAPPA_PRESENT
    if (ritual === 'BAPPA_PRESENT' && !this.music) {
      this.music = this.layer('bhakti-ambience', 'room', now, { cutoff: 16000, wet: 0.12, randomStart: false });
      this.music?.gain(dB(SPACE.musicDb), now, STHAPANA.crossfadeTau);
    }
  }

  /**
   * PRE_STHAPANA: Restores quiet pre-arrival atmosphere and silences any daily Bappa music.
   */
  playPreSthapana(): void {
    if (!this.ctx || !this.buses || this.phase !== 'room') return;
    const now = this.now();

    if (this.music) {
      this.music.stop(now, 0.4);
      this.music = null;
    }
    if (this.sthapanaVoice) {
      this.sthapanaVoice.stop(now, 0.2);
      this.sthapanaVoice = null;
    }
    if (!this.pandal) {
      this.pandal = this.layer('pandal-night', 'room', now, { cutoff: 12000, wet: 0.05 });
      this.pandal?.gain(dB(SPACE.pandalDb), now, 0.5);
      this.nextWander = now + 8;
    }
  }

  /** The pandal breathes in as the camera moves through the space. */
  private spaceShift(amount: number) {
    if (this.phase !== 'room' || !this.pandal) return;
    const now = this.now();
    this.pandal.gain(dB(SPACE.pandalDb + SPACE.shiftDb * amount), now, 0.4);
    this.pandal.gain(dB(SPACE.pandalDb), now + 1.6, 1.8);
    this.nextWander = now + 6;
  }

  /* ---------------- OFFERING: the approach ---------------- */

  /** START: nothing yet but the room stepping back. A breath before the ritual. */
  playOfferingStart(type: ContributionKind, seed = Math.random()): void {
    if (!this.ctx || !this.buses || this.phase !== 'room') return;
    const now = this.now();
    this.releaseOffering(now, 0.5);

    const spec = OFFERING[type];
    this.offering = {
      type,
      spec,
      seed,
      stage: 'start',
      gather: new Scatter(this, spec.gather, this.bus('offering'), {
        db: spec.gatherDb,
        wet: spec.wet,
        pitch: [0.94, 1.04],
        spread: 0.3,
      }),
      touches: new Scatter(this, RECEIVE.touch, this.bus('bappa'), {
        db: RECEIVE.arrivalDb,
        wet: 0.35,
        pitch: [0.85, 1.1],
        spread: 0.3,
      }),
      carrier: null,
      contacted: false,
      duck: 1,
      last: -1,
      pan: 0,
    };

    this.music?.gain(dB(SPACE.musicDb + SPACE.duckDb), now, 1.2);
  }

  /** GATHER: marigold petals, ghungroo, a dhol knock, a diya being lit. */
  playOfferingGather(): void {
    const o = this.offering;
    if (!o) return;
    o.stage = 'gather';
    o.gather.single(this.now() + 0.02);
  }

  /** TRANSFORM: the words let go -- the bansuri rises; the dhol and tabla begin. */
  playOfferingTransform(): void {
    const o = this.offering;
    if (!o) return;
    const now = this.now();
    o.stage = 'transform';
    const s = o.spec;

    if (s.release) {
      this.shot(s.release, now, { db: s.releaseDb, bus: 'offering', wet: s.wet + 0.1, rate: 1 + (o.seed - 0.5) * 0.02 });
    }
    if (s.carrier) {
      o.carrier = this.layer(s.carrier, 'offering', now, { cutoff: 9000, wet: s.wet });
      o.carrier?.gain(dB(s.carrierDb.transform), now, 0.6);
    }
  }

  /** TRAVEL: from here the layers are steered by the material's own motion. */
  playOfferingTravel(): void {
    const o = this.offering;
    if (!o) return;
    o.stage = 'travel';
  }

  private offeringMotion(m: OfferingMotion) {
    const o = this.offering;
    if (!o) return;
    const now = this.now();
    if (now - o.last < 0.045) return;
    o.last = now;
    const s = o.spec;

    if (o.stage !== 'travel') {
      // A vighna gathers with a few heavy knocks as the words condense.
      if (o.type === 'VIGHNA') o.gather.rate = Math.min(4, m.gather * 3);
    } else {
      const speed = clamp01(m.speed / s.speedRef);
      const presence = clamp01(m.density * 1.4);
      o.duck += (0.8 - o.duck) * 0.04;

      if (o.carrier) {
        let level = dB(s.carrierDb.travel) * (0.3 + 0.7 * presence);
        let rate = 1;
        if (o.type === 'VIGHNA') {
          // Heaviness is literally the share of fragments not yet broken:
          // the roll fades and lifts in pitch as the obstacle comes apart.
          const heavy = 1 - clamp01(m.broken);
          level *= 0.3 + 0.7 * heavy;
          rate = 0.92 + 0.12 * (1 - heavy);
          o.gather.rate = BREAK.knockRate * heavy * (0.3 + 0.7 * speed) * presence;
        } else if (o.type === 'PROMISE') {
          level *= 0.4 + 0.6 * m.growth;
          rate = 0.97 + 0.05 * speed;
        }
        o.carrier.gain(level * o.duck, now, 0.15);
        o.carrier.rate(rate, now, 0.4);
        o.carrier.pan(m.pan * 0.35, now, 0.5);
      }

      o.gather.center = m.pan * 0.5;
      // The rest of it entering him: tiny touches, as many as are arriving.
      if (o.contacted) {
        o.touches.rate = Math.min(RECEIVE.arrivalMax, m.arrivalRate * RECEIVE.arrivalRate);
        o.touches.center = m.pan * 0.3;
      }
    }

    this.tick();
  }

  /** Vighna's turn: a coconut broken as an offering. */
  private playOfferingBreak(pan: number) {
    if (!this.offering) return;
    this.shot('coconut-break', this.now(), { db: BREAK.coconutDb, bus: 'offering', pan: pan * 0.4, wet: 0.2 });
  }

  /**
   * CONTACT. Emitted from the frame the first grain entered the clay, and
   * the same for every offering: a tiny touch on dry clay exactly then, and
   * the clay body answering a breath later. Bappa received it.
   */
  playOfferingContact(pan = 0, build = 0): void {
    const o = this.offering;
    if (!o || o.contacted) return;
    const now = this.now();
    o.contacted = true;
    o.pan = pan;
    o.duck = 0.45;

    o.touches.center = pan * 0.4;
    o.touches.single(now, 1, RECEIVE.touchDb);
    this.playBappaResonance(build, pan, now + RECEIVE.resonanceDelay);
  }

  /** Taken in. The approach lets go; the music returns once the clay has rung out. */
  private playOfferingAbsorbed() {
    const o = this.offering;
    if (!o) return;
    const now = this.now();
    this.releaseOffering(now, o.contacted ? 0.8 : 1.5);
    // Back only after the closing line has had its silence.
    this.music?.gain(dB(SPACE.musicDb), now + 5.5, 4);
  }

  private releaseOffering(at: number, tau: number) {
    const o = this.offering;
    if (!o) return;
    o.carrier?.stop(at, tau);
    o.gather.stop(at, 0.6);
    o.touches.stop(at, 0.8);
    this.offering = null;
  }

  /* ---------------- BAPPA: received ---------------- */

  /**
   * The clay answering. One of a few takes of the same terracotta body, so
   * repeats are never identical; one still ringing is let go rather than
   * stacked; a little fuller and further as he is built.
   */
  playBappaResonance(build = 0, pan = 0, at = this.now()): void {
    if (!this.ctx || !this.buses) return;
    this.resonance?.stop(at, RECEIVE.stealTau);

    const names = RECEIVE.resonance;
    let index = Math.floor(Math.random() * names.length);
    if (names.length > 1 && index === this.lastResonance) index = (index + 1) % names.length;
    this.lastResonance = index;

    const richness = Math.pow(clamp01(build), 0.8);
    this.resonance = this.shot(names[index], at, {
      db: RECEIVE.resonanceDb + RECEIVE.richnessDb * richness,
      bus: 'bappa',
      rate: 1 + (Math.random() - 0.5) * 0.01,
      pan: pan * 0.25,
      wet: RECEIVE.wetFrom,
      wetTo: RECEIVE.wetTo + 0.08 * richness,
      wetTau: 0.4,
    });
  }

  /* ---------------- VISARJAN: the sound taken away ---------------- */

  /** Stage 1. The music stops. Only the pandal, very low, remains. */
  playVisarjanStart(): void {
    if (!this.ctx || !this.buses) return;
    const now = this.now();
    this.releaseOffering(now, 0.8);
    this.music?.stop(now, VISARJAN.musicTau);
    this.music = null;
    this.pandal?.gain(dB(SPACE.pandalDb + sample(VISARJAN.pandalTrim, 0)), now, 1);
    this.visarjan = {
      dhol: null,
      crumble: null,
      touches: new Scatter(this, RECEIVE.touch, this.bus('visarjan'), {
        db: VISARJAN.touchDb,
        wet: 0.6,
        pitch: [1.0, 1.25],
        spread: 0.8,
      }),
      last: -1,
    };
  }

  /** Stage 2. The layers that will carry him away, still silent here. */
  playVisarjanMaterial(): void {
    this.ensureVisarjanLayers(this.now());
  }

  private ensureVisarjanLayers(now: number) {
    const v = this.visarjan;
    if (!v) return;
    v.dhol ??= this.layer('dhol-tasha', 'visarjan', now, { cutoff: 2400, wet: 0.45 });
    v.crumble ??= this.layer('clay-crumble', 'visarjan', now, { cutoff: 9000, wet: 0.25 });
  }

  /**
   * Stages 2-5 as curves over dissolve: material moving, clay coming away,
   * a procession very far off that only recedes, and then tiny touches
   * further and further apart as the last of him drifts off. Every level
   * falls as he goes.
   */
  private visarjanDissolve(d: number) {
    const v = this.visarjan;
    if (!v || this.phase !== 'visarjan') return;
    const now = this.now();
    if (now - v.last < 0.05) return;
    v.last = now;
    this.ensureVisarjanLayers(now);

    const V = VISARJAN;
    v.dhol?.gain(dB(sample(V.dholDb, d)), now, 0.8);
    v.dhol?.cutoff(sample(V.dholCutoff, d), now, 1);
    v.dhol?.wet(sample(V.dholWet, d), now, 1);
    v.crumble?.gain(dB(sample(V.crumbleDb, d)), now, 0.5);
    v.touches.rate = sample(V.touchRate, d);
    this.pandal?.gain(dB(SPACE.pandalDb + sample(V.pandalTrim, d)), now, 0.8);

    this.tick();
  }

  /** Stage 5 begins: gulal on the air as he lets go of his shape. */
  playVisarjanRelease(): void {
    if (!this.visarjan) return;
    this.shot('gulal-dust', this.now(), { db: VISARJAN.gulalDb, bus: 'visarjan', wet: 0.5 });
  }

  /**
   * Stage 6. Nothing. Not a fade -- the fade has already happened. Every
   * bus and the reverb tail are cut in a few milliseconds and every source
   * is stopped.
   */
  stopAll(): void {
    if (!this.ctx || !this.buses) return;
    const now = this.now();
    for (const name of ['room', 'offering', 'bappa', 'visarjan'] as const) {
      const g = this.buses[name].gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, 0.012);
    }
    if (this.reverbOut) {
      this.reverbOut.gain.cancelScheduledValues(now);
      this.reverbOut.gain.setTargetAtTime(0, now, 0.012);
    }

    const end = now + 0.15;
    this.releaseOffering(end, 0.01);
    this.resonance?.stop(end, 0.01);
    this.resonance = null;
    this.music?.stop(end, 0.01);
    this.pandal?.stop(end, 0.01);
    this.sthapanaVoice?.stop(end, 0.01);
    this.music = null;
    this.pandal = null;
    this.sthapanaVoice = null;
    const v = this.visarjan;
    v?.dhol?.stop(end, 0.01);
    v?.crumble?.stop(end, 0.01);
    v?.touches.stop(end, 0.01);
    this.visarjan = null;
  }

  /**
   * One shankh, impossibly far away, under the chant. The only sound after
   * the silence, once. When it has rung out the context is suspended: from
   * then on the piece costs nothing at all.
   */
  playFinalBell(): void {
    if (!this.ctx || !this.buses || this.finished) return;
    this.finished = true;
    const now = this.now();
    this.bus('final').gain.setTargetAtTime(1, now, 0.01);
    this.shot('shankh-final', now + FINAL.shankhAt, { db: FINAL.shankhDb, bus: 'final' });

    const live = this.live;
    if (live) {
      window.setTimeout(() => {
        if (this.phase === 'gone') void live.suspend().catch(() => {});
      }, (FINAL.shankhAt + FINAL.tail) * 1000);
    }
  }

  /** Development only: back to the room after a Visarjan. */
  private restoreRoom() {
    if (!this.ctx || !this.buses) return;
    const now = this.now();
    for (const g of Object.values(this.buses)) {
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(1, now, 0.4);
    }
    this.reverbOut?.gain.setTargetAtTime(dB(MASTER.reverbDb), now, 0.4);
    this.finished = false;
    this.visarjan?.dhol?.stop(now, 0.5);
    this.visarjan?.crumble?.stop(now, 0.5);
    this.visarjan?.touches.stop(now, 0.5);
    this.visarjan = null;
    this.pandal?.stop(now, 0.5);
    this.pandal = null;
    this.sthapanaVoice?.stop(now, 0.2);
    this.sthapanaVoice = null;
    if (this.live && this.live.state !== 'running') void this.live.resume().catch(() => {});
    this.playAmbient();
  }

  /* ---------------- helpers ---------------- */

  private layer(name: AssetName, bus: BusName, at: number, o: LayerOptions): Layer | null {
    const clip = this.clips.get(name);
    const meta = ASSETS[name];
    if (!clip || !this.buses || meta.kind !== 'loop') return null;
    try {
      return new Layer(this, clip, meta.loop, this.bus(bus), at, o);
    } catch {
      return null;
    }
  }

  private shot(name: AssetName, at: number, o: ShotOptions): Voice | null {
    const clip = this.clips.get(name);
    const ctx = this.ctx;
    if (!clip || !ctx || !this.buses || !this.reverbIn) return null;

    try {
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.playbackRate.value = o.rate ?? 1;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      filter.frequency.value = o.cutoff ?? 18000;

      const panner = this.createPanner(o.pan ?? 0);
      const gain = ctx.createGain();
      gain.gain.value = dB(o.db);
      const send = ctx.createGain();
      send.gain.value = o.wet ?? 0;
      if (o.wetTo !== undefined) send.gain.setTargetAtTime(o.wetTo, at, o.wetTau ?? 0.3);

      src.connect(filter);
      if (panner) {
        filter.connect(panner);
        panner.connect(gain);
      } else {
        filter.connect(gain);
      }
      gain.connect(this.bus(o.bus));
      gain.connect(send);
      send.connect(this.reverbIn);

      src.start(at, clip.offset);
      src.onended = () => {
        for (const n of [src, filter, panner, gain, send]) n?.disconnect();
      };

      return {
        stop: (when: number, tau: number) => {
          gain.gain.setTargetAtTime(0, when, tau);
          try {
            src.stop(when + tau * 10);
          } catch {
            /* already stopped */
          }
        },
      };
    } catch {
      return null;
    }
  }
}

let instance: AudioManager | null = null;

/** The one room. Created lazily so nothing touches WebAudio during SSR. */
export function audio(): AudioManager {
  if (!instance) {
    const manager = new AudioManager();
    onExperienceEvent((event, payload) => manager.handle(event, payload));
    instance = manager;
  }
  return instance;
}
