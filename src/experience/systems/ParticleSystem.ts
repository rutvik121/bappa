'use client';

import * as THREE from 'three';
import type { ContributionType } from '../state/sceneState';

/**
 * Structure-of-arrays particle pool.
 *
 * No per-particle objects, no allocation after construction, one draw call.
 * The simulation runs on the CPU because the behaviours are stateful and
 * narrative (a vighna fragment must *decide* to break apart), which a
 * stateless GPGPU pass models badly; the cost is bounded by the pool
 * capacity that PerfProfile hands us.
 */

export const TYPE_ID: Record<ContributionType, number> = {
  GRATITUDE: 0,
  WISH: 1,
  VIGHNA: 2,
  PROMISE: 3,
};

/** Particle lifecycle stage. */
const DEAD = 0;
const JOURNEY = 1; // still individual, still travelling
const SETTLING = 2; // arrived: sinking onto the surface, becoming him
const FORMING = 3; // holding the shape of the words that made it

/** How close to Bappa's centre a grain must come to be taken in. */
export const ARRIVAL_DISTANCE = 0.95;

/**
 * What the material is doing, summarised once per update.
 *
 * Read by the sound director so that what is heard follows the simulation
 * itself -- how fast the words condense, how close the offering is, how
 * much of it is arriving -- instead of a timeline that assumes it.
 * Aggregates only; nothing here allocates.
 */
export interface ParticleTelemetry {
  forming: number;
  journey: number;
  settling: number;
  /** Mean distance from a forming grain to its glyph point. */
  formingGap: number;
  /** Mean speed of travelling grains, world units per second. */
  journeySpeed: number;
  /** Mean distance of travelling grains from Bappa's centre. */
  journeyDist: number;
  /** Mean vertical velocity of travelling grains. */
  journeyRise: number;
  /** Mean world x of every live grain. */
  meanX: number;
  /** Monotonic: grains that have entered him. */
  arrived: number;
  /** Monotonic: vighna fragments that have begun to crack. */
  cracked: number;
  /** World x of the surface point the latest arrival sank into. */
  lastArrivalX: number;
}

/**
 * Surface points an arriving offering can settle onto, in world space.
 * Set once the model has loaded; until then offerings simply fade at the
 * centre rather than snapping to an origin that is not the sculpture.
 */
let surfaceTargets: Float32Array | null = null;
/** The same points, ordered by when they become clay. */
let targetOrder: Uint32Array | null = null;
let targetWeights: Float32Array | null = null;
/** How much of him exists, mirrored here each frame by GanpatiModel. */
let formationLevel = 0;

export function setSurfaceTargets(points: Float32Array, weights: Float32Array) {
  surfaceTargets = points;
  targetWeights = weights;

  // Sorted once, at load, so choosing where an offering lands is a binary
  // search rather than a scan of fourteen thousand points per arrival.
  const order = new Uint32Array(weights.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  targetOrder = order.sort((a, b) => weights[a] - weights[b]);
}

export function setFormationLevel(v: number) {
  formationLevel = v;
}

/**
 * Where a piece of offered material goes.
 *
 * Not anywhere on him -- to the frontier: the band of surface that is
 * about to become clay. That is the whole difference between material
 * completing a sculpture and particles decorating one. An offering left
 * on day three settles low on the body because that is where he has got
 * to; the same offering on day nine settles around the crown.
 *
 * Returns an index into `surfaceTargets`, already multiplied by three.
 */
function pickFrontierTarget(): number {
  const order = targetOrder;
  const weights = targetWeights;
  if (!order || !weights || order.length === 0) return 0;

  const n = order.length;

  // First point not yet made.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (weights[order[mid]] < formationLevel) lo = mid + 1;
    else hi = mid;
  }

  // A band rather than a point, so a burst of arrivals thickens a whole
  // passage of him instead of stacking on one spot.
  const band = Math.max(1, (n * 0.07) | 0);

  // He is whole: there is no frontier left, so material settles into the
  // last passages to have formed rather than snapping to the base.
  if (lo >= n) return order[n - 1 - ((Math.random() * band) | 0)] * 3;

  const end = Math.min(n, lo + band);
  return order[lo + ((Math.random() * (end - lo)) | 0)] * 3;
}

export interface SpawnOptions {
  type: ContributionType;
  count: number;
  /** 0..1, derived from the private text. Shapes trajectory, not content. */
  seed: number;
  /** 0..1, scales size and spread. */
  weight: number;
  origin: THREE.Vector3;
}

/**
 * Cheap smooth pseudo-curl field. Trigonometric rather than simplex:
 * at these particle counts the visual difference is nil and this is
 * roughly 8x cheaper per sample in JS.
 */
function curl(x: number, y: number, z: number, t: number, out: Float32Array) {
  out[0] = Math.sin(y * 1.7 + t * 0.31) * Math.cos(z * 1.3 - t * 0.21);
  out[1] = Math.sin(z * 1.9 - t * 0.27) * Math.cos(x * 1.1 + t * 0.19);
  out[2] = Math.sin(x * 1.5 + t * 0.23) * Math.cos(y * 1.6 - t * 0.29);
}

export class ParticleSystem {
  readonly capacity: number;
  readonly center: THREE.Vector3;

  // --- simulation state (SoA) ---
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private warmth: Float32Array; // 0 = dark fragment, 1 = warm light
  private intensity: Float32Array;
  private phase: Float32Array;
  private type: Uint8Array;
  private stage: Uint8Array;
  /** Vighna only: seconds until the fragment starts breaking apart. */
  private breakAt: Float32Array;
  /** FORMING only: the glyph position this particle is holding. */
  private ax: Float32Array;
  private ay: Float32Array;
  private az: Float32Array;
  /** FORMING only: seconds to hold the shape before letting go. */
  private hold: Float32Array;

  /**
   * Rises each time an offering is taken in and decays continuously, so a
   * light can be driven straight off the rate of absorption rather than
   * from a separately authored animation.
   */
  private absorbGlow = 0;

  /**
   * Where recent offerings entered the sculpture, in world space, as
   * xyz + the time it landed. The material reads these and lights the
   * clay at those points, so an arrival is felt on the surface itself
   * rather than as a lamp switched on somewhere inside him.
   */
  static readonly IMPACT_SLOTS = 6;
  readonly impacts = new Float32Array(ParticleSystem.IMPACT_SLOTS * 4);
  private impactCursor = 0;

  readonly telemetry: ParticleTelemetry = {
    forming: 0,
    journey: 0,
    settling: 0,
    formingGap: 0,
    journeySpeed: 0,
    journeyDist: 0,
    journeyRise: 0,
    meanX: 0,
    arrived: 0,
    cracked: 0,
    lastArrivalX: 0,
  };

  /** Where a vighna gathers itself before it cracks. */
  private clusterX = 0;
  private clusterY = 0;
  private clusterZ = 0;

  // --- GPU-facing buffers ---
  readonly geometry: THREE.BufferGeometry;
  private aPos: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private aWarmth: THREE.BufferAttribute;
  private aSeed: THREE.BufferAttribute;

  private cursor = 0;
  private liveCount = 0;
  private scratch = new Float32Array(3);

  constructor(capacity: number, center: THREE.Vector3) {
    this.capacity = capacity;
    this.center = center.clone();

    const n = capacity;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.warmth = new Float32Array(n);
    this.intensity = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.type = new Uint8Array(n);
    this.stage = new Uint8Array(n);
    this.breakAt = new Float32Array(n);
    this.ax = new Float32Array(n);
    this.ay = new Float32Array(n);
    this.az = new Float32Array(n);
    this.hold = new Float32Array(n);

    this.geometry = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aWarmth = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(n), 1);

    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aWarmth, this.aSeed]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }

    this.geometry.setAttribute('position', this.aPos);
    this.geometry.setAttribute('aSize', this.aSize);
    this.geometry.setAttribute('aAlpha', this.aAlpha);
    this.geometry.setAttribute('aWarmth', this.aWarmth);
    this.geometry.setAttribute('aSeed', this.aSeed);
    this.geometry.setDrawRange(0, 0);

    // Bappa is always at the centre of the field; a fixed generous sphere
    // avoids recomputing bounds every frame while keeping culling correct.
    this.geometry.boundingSphere = new THREE.Sphere(this.center.clone(), 9);
  }

  /** Monotonic count of offerings that have entered the clay. */
  get arrivals() {
    return this.impactCursor;
  }

  get count() {
    return this.liveCount;
  }

  /** Round-robin allocation; oldest slot is recycled if the pool is full. */
  private allocate(): number {
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.cursor + i) % this.capacity;
      if (this.stage[idx] === DEAD) {
        this.cursor = (idx + 1) % this.capacity;
        return idx;
      }
    }
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    return idx;
  }

  spawn({ type, count, seed, weight, origin }: SpawnOptions) {
    const t = TYPE_ID[type];

    for (let i = 0; i < count; i++) {
      const idx = this.allocate();
      const r = Math.random();
      const a = Math.random() * Math.PI * 2;
      // Seed biases the emission shape so two contributions never look
      // identical, while the text itself remains unrecoverable.
      const spread = (0.35 + seed * 0.5) * (0.4 + weight * 0.9);

      this.px[idx] = origin.x + Math.cos(a) * r * spread;
      this.py[idx] = origin.y + (Math.random() - 0.5) * spread * 0.7;
      this.pz[idx] = origin.z + Math.sin(a) * r * spread;

      this.type[idx] = t;
      this.stage[idx] = JOURNEY;
      this.life[idx] = 0;
      this.phase[idx] = Math.random() * 100;
      this.intensity[idx] = 0.55 + Math.random() * 0.45;
      this.size[idx] = (0.9 + Math.random() * 1.4) * (0.7 + weight * 0.6);
      this.breakAt[idx] = 0;

      switch (t) {
        case 0: // GRATITUDE -- already warm, drifts inward and gathers.
          this.warmth[idx] = 0.75 + Math.random() * 0.25;
          this.maxLife[idx] = 7 + Math.random() * 4;
          this.vx[idx] = (Math.random() - 0.5) * 0.18;
          this.vy[idx] = Math.random() * 0.1;
          this.vz[idx] = (Math.random() - 0.5) * 0.18;
          break;

        case 1: // WISH -- buoyant, rises before it turns toward Bappa.
          this.warmth[idx] = 0.6 + Math.random() * 0.3;
          this.maxLife[idx] = 9 + Math.random() * 5;
          this.vx[idx] = (Math.random() - 0.5) * 0.1;
          this.vy[idx] = 0.22 + Math.random() * 0.3;
          this.vz[idx] = (Math.random() - 0.5) * 0.1;
          this.size[idx] *= 0.8;
          break;

        case 2: // VIGHNA -- dark, heavy, erratic; breaks apart on a timer.
          this.warmth[idx] = 0.02 + Math.random() * 0.06;
          this.maxLife[idx] = 11 + Math.random() * 5;
          this.vx[idx] = (Math.random() - 0.5) * 0.6;
          this.vy[idx] = (Math.random() - 0.5) * 0.35;
          this.vz[idx] = (Math.random() - 0.5) * 0.6;
          this.size[idx] *= 1.5;
          this.breakAt[idx] = 2.6 + Math.random() * 2.8;
          break;

        case 3: // PROMISE -- grows outward first, like something taking root.
          this.warmth[idx] = 0.5 + Math.random() * 0.25;
          this.maxLife[idx] = 10 + Math.random() * 5;
          this.vx[idx] = Math.cos(a) * 0.3;
          this.vy[idx] = 0.06 + Math.random() * 0.12;
          this.vz[idx] = Math.sin(a) * 0.3;
          this.size[idx] *= 0.95;
          break;
      }
    }
  }

  /** 0..1-ish. How brightly Bappa should be answering right now. */
  get glow() {
    return this.absorbGlow;
  }

  /**
   * The contribution becomes matter.
   *
   * Particles appear scattered around each glyph point and converge onto
   * it, so the words assemble out of the dark rather than being stamped
   * there. After `hold` seconds they let go and the type behaviour takes
   * over -- which is the moment the text stops being text.
   *
   * @param anchors world-space xyz triples, one per particle
   */
  spawnFormation(
    anchors: Float32Array,
    type: ContributionType,
    seed: number,
    weight: number,
    hold: number
  ) {
    const t = TYPE_ID[type];
    const count = Math.floor(anchors.length / 3);

    for (let i = 0; i < count; i++) {
      const idx = this.allocate();
      const ax = anchors[i * 3];
      const ay = anchors[i * 3 + 1];
      const az = anchors[i * 3 + 2];

      this.ax[idx] = ax;
      this.ay[idx] = ay;
      this.az[idx] = az;

      // Start just off the mark and drift in: assembly reads as the words
      // condensing, where spawning exactly on the anchor reads as a decal.
      // Close, though -- the plane is near the lens, so a wide scatter here
      // fills the whole screen and the words never read as words.
      this.px[idx] = ax + (Math.random() - 0.5) * 0.12;
      this.py[idx] = ay + (Math.random() - 0.5) * 0.08;
      this.pz[idx] = az + (Math.random() - 0.5) * 0.06;

      this.vx[idx] = 0;
      this.vy[idx] = 0;
      this.vz[idx] = 0;

      this.type[idx] = t;
      this.stage[idx] = FORMING;
      this.life[idx] = 0;
      // Staggered so the text resolves in a wave rather than all at once.
      this.hold[idx] = hold + Math.random() * 0.35;
      this.maxLife[idx] = 9 + Math.random() * 2;
      this.phase[idx] = Math.random() * 100;
      this.intensity[idx] = 0.4 + Math.random() * 0.3;
      // Grain size is set against the text plane, which sits a fixed
      // 2.3 units out: pointSize = size * (viewportHeight * 0.03) / depth,
      // so this lands around 2-4px. That is just under the ~3.7px average
      // spacing of the sampled glyph points, which is what lets the
      // letterforms resolve instead of merging into a smear.
      this.size[idx] = 0.2 + Math.random() * 0.14;
      this.breakAt[idx] = t === 2 ? 2.2 + Math.random() * 2.4 : 0;

      // Legible while it is still language: even a vighna starts as a
      // warm ember here and only darkens once it has let go.
      this.warmth[idx] = 0.72 + Math.random() * 0.28;
    }

    // A vighna gathers slightly below where the words were, so the knot
    // forms in open space rather than inside the text it came from.
    if (count > 0) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < count; i++) {
        cx += anchors[i * 3];
        cy += anchors[i * 3 + 1];
        cz += anchors[i * 3 + 2];
      }
      this.setCluster(cx / count, cy / count - 0.35, cz / count);
    }

    // Wider spread and a touch more size for a longer contribution.
    void seed;
    void weight;
  }

  /** The knot a vighna collects into before it breaks. */
  private setCluster(x: number, y: number, z: number) {
    this.clusterX = x;
    this.clusterY = y;
    this.clusterZ = z;
  }

  /**
   * Releases every particle still holding the text. Called when the state
   * machine moves on, so the authored timing stays in one place even
   * though each particle also releases itself on its own timer.
   */
  releaseFormation() {
    for (let i = 0; i < this.capacity; i++) {
      if (this.stage[i] === FORMING) this.release(i);
    }
  }

  private release(i: number) {
    this.stage[i] = JOURNEY;
    this.life[i] = 0;

    // No longer type: coarsen back to material so the journey reads as
    // clay dust and embers rather than as scattered pixels.
    this.size[i] = 0.9 + Math.random() * 1.1;
    this.intensity[i] = 0.55 + Math.random() * 0.4;

    // A soft outward breath as the shape gives way -- the words come
    // apart before anything starts travelling. Small: the letters are a
    // couple of units from the lens, so anything more scatters the
    // offering across the whole screen like snow.
    this.vx[i] = (Math.random() - 0.5) * 0.18;
    this.vy[i] = (Math.random() - 0.5) * 0.12 + 0.05;
    this.vz[i] = (Math.random() - 0.5) * 0.14 - 0.08;

    // Now the offering takes on the character of its type.
    if (this.type[i] === 2) {
      this.warmth[i] = 0.04 + Math.random() * 0.06;
      // The knot it will gather into before it cracks.
      this.ax[i] = this.clusterX;
      this.ay[i] = this.clusterY;
      this.az[i] = this.clusterZ;
      this.breakAt[i] = 1.7 + Math.random() * 1.0;
      this.size[i] *= 1.4;
    }
    if (this.type[i] === 1) this.vy[i] += 0.22;
    if (this.type[i] === 3) this.size[i] *= 0.5;
  }

  /**
   * @param dt       clamped delta seconds
   * @param time     absolute seconds, for the noise field
   * @param dissolve 0..1+. Once Visarjan begins, every offering still in
   *                 flight goes with him. Nothing of his may outlive him,
   *                 so this is a hard fade rather than a behaviour change.
   */
  update(dt: number, time: number, dissolve = 0) {
    const c = this.center;
    const pos = this.aPos.array as Float32Array;
    const sz = this.aSize.array as Float32Array;
    const al = this.aAlpha.array as Float32Array;
    const wm = this.aWarmth.array as Float32Array;
    const sd = this.aSeed.array as Float32Array;
    const n = this.scratch;
    const tel = this.telemetry;

    // The glow answers arrivals and fades on its own, so a burst of
    // absorption reads as Bappa brightening and settling again.
    this.absorbGlow *= Math.exp(-dt * 1.6);
    if (dissolve > 0) this.absorbGlow = Math.min(this.absorbGlow, 1 - Math.min(1, dissolve));

    // Everything belonging to him is gone by the time he is.
    const survives = Math.max(0, 1 - dissolve * 2.2);

    let write = 0;
    let nForming = 0;
    let nJourney = 0;
    let nSettling = 0;
    let gapSum = 0;
    let speedSum = 0;
    let distSum = 0;
    let riseSum = 0;
    let xSum = 0;

    for (let i = 0; i < this.capacity; i++) {
      const stage = this.stage[i];
      if (stage === DEAD) continue;

      this.life[i] += dt;
      const age = this.life[i];
      const t = this.type[i];

      let x = this.px[i];
      let y = this.py[i];
      let z = this.pz[i];

      const dx = c.x - x;
      const dy = c.y - y;
      const dz = c.z - z;
      const dist = Math.hypot(dx, dy, dz) || 1e-4;

      curl(x * 0.8, y * 0.8, z * 0.8, time + this.phase[i], n);

      if (stage === FORMING) {
        nForming++;
        gapSum += Math.hypot(this.ax[i] - x, this.ay[i] - y, this.az[i] - z);

        // Critically damped pull onto the glyph point, plus a breath of
        // noise so the letters shimmer instead of sitting dead still.
        // The noise is per second, not per frame: per frame, at 60fps it
        // held every grain ~0.1 units off its letter -- a band of static
        // instead of the words the visitor just wrote.
        const k = Math.min(1, dt * 5.5);
        x += (this.ax[i] - x) * k + n[0] * 0.02 * dt;
        y += (this.ay[i] - y) * k + n[1] * 0.02 * dt;
        z += (this.az[i] - z) * k + n[2] * 0.02 * dt;

        if (age > this.hold[i]) {
          this.px[i] = x;
          this.py[i] = y;
          this.pz[i] = z;
          this.release(i);
        }
      } else if (stage === JOURNEY) {
        // --- each offering moves in its own way ---
        // These are four different motion models, not one model with four
        // colours. What a person feels they did is carried almost entirely
        // by how the material behaves on the way in.

        // Where on him this kind of offering goes. A wish rises to the
        // crown; a promise settles low, at the base he is built on.
        let tx = c.x;
        let ty = c.y;
        let tz = c.z;
        if (t === 1) ty += 0.62;
        if (t === 3) ty -= 0.28;

        let pull = 0;
        let drag = 0.6;
        let noiseAmp = 0.25;

        switch (t) {
          case 0: {
            // GRATITUDE -- warmth, tenderness. Calm and unhurried, and it
            // draws itself into a single soft stream rather than arriving
            // as a crowd: velocity perpendicular to the line of travel is
            // bled away, so the grains fall in behind one another.
            pull = 0.7;
            drag = 0.9;
            noiseAmp = 0.1;

            const ux = (tx - x) / dist;
            const uy = (ty - y) / dist;
            const uz = (tz - z) / dist;
            const along = this.vx[i] * ux + this.vy[i] * uy + this.vz[i] * uz;
            const lane = Math.min(1, dt * 1.5);
            this.vx[i] += (along * ux - this.vx[i]) * lane;
            this.vy[i] += (along * uy - this.vy[i]) * lane;
            this.vz[i] += (along * uz - this.vz[i]) * lane;

            this.warmth[i] = Math.min(1, this.warmth[i] + dt * 0.14);
            break;
          }

          case 1: {
            // WISH -- hope, lift. It goes up before it goes anywhere, and
            // only turns toward him once it has risen; the attraction is
            // weak while the buoyancy is strong, so the arc is a climb
            // that bends rather than a line that sags.
            const climbing = 1 - Math.min(1, age / 2.2);
            pull = 0.22 + (1 - climbing) * 1.1;
            drag = 0.5;
            noiseAmp = 0.14;
            this.vy[i] += (0.38 * climbing + 0.04) * dt;
            break;
          }

          case 2: {
            // VIGHNA -- weight, then release. The only offering with a
            // turn in it: it resists, gathers into a knot, cracks, and
            // only then consents to be drawn in. Three phases, not one.
            const crackAt = this.breakAt[i];
            const cracking = age > crackAt && age < crackAt + 0.4;
            const broken = age >= crackAt + 0.4;
            if (age > crackAt && age - dt <= crackAt) tel.cracked++;

            if (!broken && !cracking) {
              // Heavy and reluctant. It is drawn to its own cluster, not
              // to Bappa -- the obstacle collects itself first.
              const kx = this.ax[i] - x;
              const ky = this.ay[i] - y;
              const kz = this.az[i] - z;
              const kd = Math.hypot(kx, ky, kz) || 1e-4;
              const grip = 0.55 / (0.4 + kd);
              this.vx[i] += (kx / kd) * grip * dt;
              this.vy[i] += (ky / kd) * grip * dt;
              this.vz[i] += (kz / kd) * grip * dt;

              pull = 0.05;
              drag = 1.7;
              noiseAmp = 0.35;
              this.vy[i] -= 0.34 * dt; // it has weight
            } else if (cracking) {
              // The knot gives. A short outward break, and the darkness
              // starts turning into something warm.
              const ox = x - this.ax[i];
              const oy = y - this.ay[i];
              const oz = z - this.az[i];
              const od = Math.hypot(ox, oy, oz) || 1e-4;
              this.vx[i] += (ox / od) * 1.9 * dt;
              this.vy[i] += (oy / od) * 1.4 * dt + 0.5 * dt;
              this.vz[i] += (oz / od) * 1.9 * dt;

              pull = 0;
              drag = 0.6;
              noiseAmp = 0.6;
              this.warmth[i] = Math.min(1, this.warmth[i] + dt * 1.6);
              this.size[i] = Math.max(0.45, this.size[i] - dt * 1.5);
            } else {
              // Released, and now the fastest of the four: what was heavy
              // is the thing that travels most freely.
              pull = 1.5;
              drag = 0.5;
              noiseAmp = 0.16;
              this.warmth[i] = Math.min(1, this.warmth[i] + dt * 0.5);
            }
            break;
          }

          case 3: {
            // PROMISE -- growth. It behaves like something rooting: it
            // grows in discrete steps, changing direction at each one, so
            // the path branches instead of curving. Slowest of the four.
            const stepIndex = Math.floor(age / 0.85 + this.phase[i]);
            const h = Math.sin(stepIndex * 12.9898 + this.phase[i] * 78.233) * 43758.5453;
            const a1 = (h - Math.floor(h)) * Math.PI * 2;
            const a2 = ((h * 1.7 - Math.floor(h * 1.7)) - 0.5) * 1.4;

            const reach = 0.45 * (1 - Math.min(1, age / 3.6));
            this.vx[i] += Math.cos(a1) * Math.cos(a2) * reach * dt;
            this.vy[i] += (Math.sin(a2) * 0.6 + 0.22) * reach * dt;
            this.vz[i] += Math.sin(a1) * Math.cos(a2) * reach * dt;

            pull = Math.max(0, (age - 1.3) * 0.34);
            drag = 1.05;
            noiseAmp = 0.07;
            this.size[i] = Math.min(this.size[i] + dt * 0.3, 2.4);
            this.warmth[i] = Math.min(1, this.warmth[i] + dt * 0.1);
            break;
          }
        }

        // A slowly growing closing term. Without it, a grain that wanders
        // wide can run out of life before reaching him and simply fade in
        // open air -- which reads as the offering being dropped rather
        // than received.
        pull += Math.min(1, age / 3.5) * 1.15;

        const tdx = tx - x;
        const tdy = ty - y;
        const tdz = tz - z;
        const tdist = Math.hypot(tdx, tdy, tdz) || 1e-4;

        const acc = pull / (0.6 + tdist * tdist * 0.35);
        this.vx[i] += (tdx / tdist) * acc * dt + n[0] * noiseAmp * dt;
        this.vy[i] += (tdy / tdist) * acc * dt + n[1] * noiseAmp * dt;
        this.vz[i] += (tdz / tdist) * acc * dt + n[2] * noiseAmp * dt;

        const damp = Math.exp(-drag * dt);
        this.vx[i] *= damp;
        this.vy[i] *= damp;
        this.vz[i] *= damp;

        nJourney++;
        speedSum += Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
        riseSum += this.vy[i];
        distSum += dist;

        x += this.vx[i] * dt;
        y += this.vy[i] * dt;
        z += this.vz[i] * dt;

        // Arrival: close enough, and warm enough, to stop being "theirs".
        // The offering does not join a field around Bappa -- it picks a
        // point on his actual surface and sinks into it, because what it
        // is joining is the sculpture, not an aura.
        if (dist < ARRIVAL_DISTANCE && this.warmth[i] > 0.35 && age > 0.8) {
          this.absorbGlow = Math.min(2, this.absorbGlow + 0.5);
          this.stage[i] = SETTLING;
          this.life[i] = 0;
          this.maxLife[i] = 1.6 + Math.random() * 0.9;
          tel.arrived++;

          if (surfaceTargets && surfaceTargets.length >= 3) {
            const pick = pickFrontierTarget();
            this.ax[i] = surfaceTargets[pick];
            this.ay[i] = surfaceTargets[pick + 1];
            this.az[i] = surfaceTargets[pick + 2];

            // Tell the clay where it was touched. Rate-limited by the
            // ring: a burst of arrivals lights a few places well rather
            // than the whole surface faintly.
            const slot = (this.impactCursor % ParticleSystem.IMPACT_SLOTS) * 4;
            this.impacts[slot] = this.ax[i];
            this.impacts[slot + 1] = this.ay[i];
            this.impacts[slot + 2] = this.az[i];
            this.impacts[slot + 3] = time;
            this.impactCursor++;
          } else {
            this.ax[i] = c.x;
            this.ay[i] = c.y;
            this.az[i] = c.z;
          }
          tel.lastArrivalX = this.ax[i];
        }
      } else {
        nSettling++;

        // --- SETTLING: sinking into the surface it chose ---
        // A short, decisive move onto the sculpture. What makes this read
        // as joining rather than arriving is that it does not stop there:
        // it keeps going very slightly past, and fades while doing it.
        const k = Math.min(1, dt * 3.2);
        x += (this.ax[i] - x) * k;
        y += (this.ay[i] - y) * k;
        z += (this.az[i] - z) * k;

        x += n[0] * 0.02 * dt;
        y += n[1] * 0.02 * dt;
        z += n[2] * 0.02 * dt;

        // Warms as it goes in, so the last thing seen of an offering is
        // it turning the colour of the clay it is becoming.
        this.warmth[i] = Math.min(1, this.warmth[i] + dt * 0.6);
        this.size[i] = Math.max(0.35, this.size[i] - dt * 0.5);
      }

      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;

      // --- opacity envelope ---
      let alpha: number;
      if (stage === SETTLING) {
        // Straight fade over its whole short life: it is disappearing
        // into him, not dimming in place.
        alpha = this.intensity[i] * Math.max(0, 1 - age / this.maxLife[i]);
      } else {
        const ml = this.maxLife[i];
        const fadeIn = Math.min(age / 0.7, 1);
        const fadeOut = 1 - Math.max(0, (age - (ml - 2.5)) / 2.5);
        alpha = this.intensity[i] * fadeIn * Math.max(0, fadeOut);
      }

      // Cull on age, or on having faded out -- but never while the
      // particle is still fading IN. A young particle legitimately has a
      // near-zero alpha, and on a fast frame that would kill it on its
      // first update, silently discarding entire spawns.
      const fadedIn = age > 0.7;
      alpha *= survives;

      if (age > this.maxLife[i] || (fadedIn && alpha <= 0.002)) {
        this.stage[i] = DEAD;
        continue;
      }

      // --- pack for the GPU (compacted, so drawRange is exact) ---
      pos[write * 3] = x;
      pos[write * 3 + 1] = y;
      pos[write * 3 + 2] = z;
      sz[write] = this.size[i];
      al[write] = alpha;
      wm[write] = this.warmth[i];
      sd[write] = this.phase[i];
      xSum += x;
      write++;
    }

    this.liveCount = write;
    this.geometry.setDrawRange(0, write);

    tel.forming = nForming;
    tel.journey = nJourney;
    tel.settling = nSettling;
    tel.formingGap = nForming ? gapSum / nForming : 0;
    tel.journeySpeed = nJourney ? speedSum / nJourney : 0;
    tel.journeyDist = nJourney ? distSum / nJourney : 0;
    tel.journeyRise = nJourney ? riseSum / nJourney : 0;
    tel.meanX = write ? xSum / write : 0;

    if (write > 0) {
      this.aPos.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
      this.aWarmth.needsUpdate = true;
      this.aSeed.needsUpdate = true;
    }
  }

  dispose() {
    this.geometry.dispose();
  }
}
