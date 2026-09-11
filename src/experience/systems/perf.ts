'use client';

/**
 * Device tiering. Decided once at boot from cheap signals, then every
 * system scales itself off the returned profile. The Ganpati's own
 * material and lighting are deliberately excluded from downgrades --
 * only atmosphere and particle budgets flex.
 */
export type Tier = 'low' | 'mid' | 'high';

export interface PerfProfile {
  tier: Tier;
  dpr: [number, number];
  /** Points sampled from Bappa's surface -- the material he forms from. */
  formationParticles: number;
  offeringParticles: number;
  dustParticles: number;
  /**
   * Landing points sampled off his surface, for arriving offerings to
   * sink into. Not a particle budget -- it costs one Float32Array.
   */
  surfaceTargets: number;
  smokeLayers: number;
  shadows: boolean;
  postprocessing: boolean;
  depthOfField: boolean;
}

function detectTier(): Tier {
  if (typeof window === 'undefined') return 'mid';

  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) < 480;

  // A WebGL probe catches software renderers and old mobile GPUs that
  // otherwise report healthy core counts.
  let weakGpu = false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return 'low';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : '';
    weakGpu = /swiftshader|llvmpipe|software|mali-4|adreno \(tm\) [123]/i.test(renderer);
  } catch {
    weakGpu = true;
  }

  if (weakGpu || cores <= 2 || mem <= 2) return 'low';
  if (coarse || smallViewport || cores <= 6 || mem <= 4) return 'mid';
  return 'high';
}

const PROFILES: Record<Tier, Omit<PerfProfile, 'tier'>> = {
  low: {
    dpr: [1, 1.25],
    formationParticles: 7000,
    offeringParticles: 1400,
    dustParticles: 40,
    surfaceTargets: 3000,
    smokeLayers: 5,
    shadows: false,
    postprocessing: false,
    depthOfField: false,
  },
  mid: {
    dpr: [1, 1.75],
    formationParticles: 16000,
    offeringParticles: 3200,
    dustParticles: 80,
    surfaceTargets: 7000,
    smokeLayers: 9,
    shadows: true,
    postprocessing: true,
    depthOfField: false,
  },
  high: {
    dpr: [1, 2],
    formationParticles: 34000,
    offeringParticles: 6000,
    dustParticles: 170,
    surfaceTargets: 14000,
    smokeLayers: 14,
    shadows: true,
    postprocessing: true,
    depthOfField: true,
  },
};

let cached: PerfProfile | null = null;

export function getPerfProfile(): PerfProfile {
  if (cached) return cached;
  const tier = detectTier();
  cached = { tier, ...PROFILES[tier] };
  return cached;
}

/** Drops a tier at runtime if the frame budget is persistently blown. */
export function degrade(): PerfProfile {
  const current = getPerfProfile();
  if (current.tier === 'low') return current;
  const next: Tier = current.tier === 'high' ? 'mid' : 'low';
  cached = { tier: next, ...PROFILES[next] };
  return cached;
}
