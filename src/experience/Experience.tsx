'use client';

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import * as THREE from 'three';

import { Scene } from './Scene';
import { Overlay } from './ui/Overlay';
import { getPerfProfile, degrade, type PerfProfile } from './systems/perf';
import { useScene } from './state/sceneState';
import { useBoot } from './state/boot';
import { VISARJAN_DURATION, DARKNESS_HOLD } from './components/DissolveController';
import { devToolsEnabled } from './dev/devtools';

/**
 * Development controls, dynamically imported so a visitor never fetches
 * the panel's code. `devToolsEnabled` is false in a production build
 * unless it is explicitly turned on for a staging deploy.
 */
const DevPanel = dynamic(() => import('./dev/DevPanel').then((m) => m.DevPanel), {
  ssr: false,
});

/**
 * Runtime watchdog. If the frame budget is blown for a sustained stretch
 * -- not a single spike -- the whole scene drops a tier. Bappa's own
 * material and lighting are untouched by this; only atmosphere thins.
 */
function PerfWatchdog({ onDegrade }: { onDegrade: (p: PerfProfile) => void }) {
  const slow = useRef(0);
  const fired = useRef(false);

  useFrame((_, dt) => {
    if (fired.current) return;
    // ~22fps sustained for four seconds is a real problem, not a hitch.
    slow.current = dt > 0.045 ? slow.current + dt : Math.max(0, slow.current - dt * 2);
    if (slow.current > 4) {
      fired.current = true;
      onDegrade(degrade());
    }
  });

  return null;
}

/**
 * Stops the render loop once nothing is left to render.
 *
 * After Visarjan completes every system is at zero and the frame is
 * black, so continuing to redraw it sixty times a second is pure battery
 * cost through the closing words -- which are plain DOM and need no
 * canvas at all.
 *
 * Left running when the development panel is enabled, or scrubbing back
 * through the timeline would find a frozen canvas.
 */
function LoopStopper() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const stopped = useRef(false);

  useFrame(() => {
    if (stopped.current || devToolsEnabled()) return;
    const { state, elapsed } = useScene.getState();
    // A second past the start of the closing words, so the sound director
    // has certainly heard that moment before the frames stop.
    if (state === 'VISARJAN' && elapsed >= VISARJAN_DURATION + DARKNESS_HOLD + 1) {
      stopped.current = true;
      setFrameloop('never');
    }
  });

  return null;
}

/**
 * If the sculpture cannot be loaded or drawn -- a dropped connection, a GPU
 * that gives up -- the canvas goes quietly and the words stay, and say so.
 * Without this a single failed fetch took the whole page to black.
 */
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    useBoot.getState().fail('load');
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Phones drop the GL context under memory pressure, usually while the tab
 * is in the background. At rest, the kindest recovery is a quiet reload;
 * mid-offering it is left alone rather than interrupting the moment.
 */
function watchContext(canvas: HTMLCanvasElement) {
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    if (useScene.getState().state === 'IDLE') window.location.reload();
  });
}

/** Applies renderer settings that R3F does not expose declaratively. */
function RendererSetup() {
  const { gl } = useThree();

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    // Slightly under 1.0: the highlights on the clay should roll off
    // before they clip, which is what keeps it looking photographed.
    gl.toneMappingExposure = 1.4;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
  }, [gl]);

  return null;
}

export function Experience() {
  const [perf, setPerf] = useState<PerfProfile | null>(null);
  const [ready, setReady] = useState(false);
  const failed = useBoot((s) => s.failed);

  // Tier detection touches the DOM and a probe canvas, so it must run
  // after mount -- this also keeps the module SSR-safe.
  useEffect(() => {
    if (!webglAvailable()) {
      useBoot.getState().fail('webgl');
      return;
    }
    setPerf(getPerfProfile());
  }, []);

  const dpr = useMemo<[number, number]>(() => perf?.dpr ?? [1, 1.5], [perf]);

  if (!perf && !failed) return <div className="stage" aria-hidden />;

  return (
    <div className="stage">
      {perf && !failed && (
      <CanvasBoundary>
      <Canvas
        dpr={dpr}
        shadows={perf.shadows}
        gl={{
          // The composer resolves aliasing; MSAA on top of it is wasted
          // bandwidth on mobile. Without post, we pay for MSAA instead.
          antialias: !perf.postprocessing,
          powerPreference: 'high-performance',
          alpha: false,
          stencil: false,
          depth: true,
        }}
        camera={{ position: [0, 1.35, 6.4], fov: 34, near: 0.1, far: 40 }}
        // Deferred off the current task: onCreated fires mid-render, and a
        // setState there is discarded by React with a "cannot update while
        // rendering" warning. A timeout rather than requestAnimationFrame
        // on purpose -- a tab loaded in the background gets no frames, and
        // gating the interface on one would leave it hidden indefinitely.
        onCreated={({ gl }) => {
          watchContext(gl.domElement);
          setTimeout(() => setReady(true), 0);
        }}
      >
        <RendererSetup />
        <LoopStopper />
        <Scene perf={perf} devStats={devToolsEnabled()} />
        <PerfWatchdog onDegrade={setPerf} />
        <AdaptiveDpr pixelated={false} />
        <Preload all />
      </Canvas>
      </CanvasBoundary>
      )}

      <Overlay ready={ready || failed !== null} />
      {devToolsEnabled() && <DevPanel />}
    </div>
  );
}
