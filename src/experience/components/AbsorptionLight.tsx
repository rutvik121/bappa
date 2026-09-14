'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BAPPA_CENTER } from './GanpatiModel';
import type { ParticleHandle } from './ParticleField';

/**
 * Bappa answering.
 *
 * A warm light held inside the sculpture, driven directly by the rate at
 * which offerings are being absorbed rather than by an authored curve.
 * Nothing arrives, nothing lights; a stream of arrivals makes him glow
 * from within and settle again as it thins.
 *
 * Kept separate from LightingSystem because that rig describes the room,
 * and this one describes a response.
 */
export function AbsorptionLight({
  particles: _particles,
}: {
  particles: React.MutableRefObject<ParticleHandle>;
}) {
  // Deactivated: Bappa is a solid physical clay murti, not a hollow glowing lantern.
  // Offering impacts are naturally rendered on the exterior clay surface via uImpacts in the shader.
  return null;
}
