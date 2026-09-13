'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { PerfProfile } from '../systems/perf';
import { getRitualState, getSthapanaArrival } from '../state/festival';

export interface AsanaHandle {
  visible: boolean;
  opacity: number;
}

interface Props {
  perf: PerfProfile;
  handle?: React.MutableRefObject<AsanaHandle>;
}

/**
 * Procedurally constructs a low-profile, handcrafted clay asana (platform).
 *
 * It is softly rounded (oval-rectangular), slightly chamfered, and textured with
 * subtle earthen variation so it reads as hand-modeled clay rather than a machined disc.
 *
 * Dimensions:
 * - Width: ~1.55m (accommodates Bappa's 1.25m base and 1.29m knee span)
 * - Depth: ~1.34m
 * - Height: ~0.12m
 * - Top surface: sits at y = -0.19m, embedding Bappa (bottom at y = -0.20m) by 10mm
 *   to ensure zero floating gap and rock-solid seated contact.
 */
function createAsanaGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const w = 0.76; // half width (X)
  const d = 0.64; // half depth (Z)
  const r = 0.26; // corner radius

  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r);
  shape.quadraticCurveTo(w, d, w - r, d);
  shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r);
  shape.lineTo(-w, -d + r);
  shape.quadraticCurveTo(-w, -d, -w + r, -d);

  const extrudeSettings = {
    steps: 1,
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.025,
    bevelOffset: 0,
    bevelSegments: 4,
  };

  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // Re-orient so extrusion is vertical along Y
  geo.rotateX(Math.PI * 0.5);
  geo.center();

  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  // Earthen terracotta clay color palette: quiet, warm, and ceremonial
  const baseColor = new THREE.Color('#8a583d');
  const edgeShade = new THREE.Color('#583624');

  for (let i = 0; i < count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Micro-variations on the surface to give hand-formed clay texture (< 2mm)
    const clayBump =
      Math.sin(x * 5.5 + z * 4.2) * 0.0015 +
      Math.cos(z * 6.1 - x * 3.3) * 0.001;
    y += clayBump;
    pos.setY(i, y);

    // Natural surface nuance and subtle rim shading
    const dist = Math.hypot(x / 0.70, z / 0.60);
    const rimShade = Math.min(1, Math.max(0, dist - 0.75) * 3.5);
    const microVariation = (Math.sin(x * 14.0 + z * 11.0) * 0.5 + 0.5) * 0.04;

    const c = baseColor.clone().addScalar(microVariation).lerp(edgeShade, rimShade * 0.28);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a soft, warm radial light pool texture for the ground beneath the asana.
 */
function createPoolTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 205, 155, 0.16)');
    grad.addColorStop(0.35, 'rgba(235, 170, 115, 0.09)');
    grad.addColorStop(0.7, 'rgba(180, 110, 65, 0.03)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function Asana({ perf, handle }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const poolRef = useRef<THREE.MeshBasicMaterial>(null);

  const geometry = useMemo(() => createAsanaGeometry(), []);
  const poolGeometry = useMemo(() => new THREE.PlaneGeometry(3.6, 3.2), []);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02,
      envMapIntensity: 0.35,
      side: THREE.FrontSide,
    });
  }, []);

  const poolTexture = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return createPoolTexture();
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;

    if (handle?.current) {
      meshRef.current.visible = handle.current.visible;
      if (materialRef.current && handle.current.opacity < 1) {
        materialRef.current.transparent = true;
        materialRef.current.opacity = handle.current.opacity;
      }
    }

    // Soft light pool intensity: warm and visible in PRE_STHAPANA,
    // seamlessly remains as subtle ground warmth under Bappa
    if (poolRef.current) {
      const ritualState = getRitualState();
      const sthapana = getSthapanaArrival();
      if (ritualState === 'PRE_STHAPANA') {
        poolRef.current.opacity = 0.95;
      } else if (sthapana.isArriving) {
        poolRef.current.opacity = THREE.MathUtils.lerp(0.95, 0.55, Math.min(1, sthapana.elapsed / 12));
      } else {
        poolRef.current.opacity = 0.55;
      }
    }
  });

  return (
    <group>
      {/* Handcrafted terracotta ceremonial platform */}
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        position={[0, -0.25, 0]}
        castShadow={perf.shadows}
        receiveShadow={perf.shadows}
      />

      {/* Soft warm ceremonial light pool quietly resting on the ground around the asana */}
      {poolTexture && (
        <mesh position={[0, -0.268, 0]} rotation={[-Math.PI * 0.5, 0, 0]}>
          <primitive object={poolGeometry} attach="geometry" />
          <meshBasicMaterial
            ref={poolRef}
            map={poolTexture}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            opacity={0.95}
          />
        </mesh>
      )}
    </group>
  );
}
