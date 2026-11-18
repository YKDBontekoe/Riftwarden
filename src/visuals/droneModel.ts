import type { AbstractMesh, PBRMaterial, Scene, TransformNode } from '@babylonjs/core';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';

/** Team colours per lobby slot (HUD, name tags, drone accents). */
export const SLOT_COLORS: readonly [number, number, number][] = [
  [0.3, 1.6, 2.2], // cyan
  [2.4, 1.3, 0.3], // amber
  [1.6, 0.6, 2.6], // violet
  [0.5, 2.2, 0.9], // green
];
export const SLOT_CSS = ['#5fe3ff', '#ffb347', '#c38bff', '#6bf08a'];

export interface DroneRig {
  root: TransformNode;
  body: TransformNode;
  ring: AbstractMesh;
  pod: TransformNode;
  muzzle: TransformNode;
  thrusters: AbstractMesh[];
  accent: PBRMaterial;
}

/**
 * Allied Warden drone (co-op teammates): the same ceramic/graphite language as the player's
 * viewmodel and the Sentinel towers — a faceted white hull over a graphite keel, a cyan-style
 * accent band in the player's team colour, a gimballed weapon pod and a hover ring with
 * four vectored thrusters. Instanced kit parts except the accent material (one per slot).
 */
export function buildWardenDrone(scene: Scene, kit: Kit, P: Palette, slot: number): DroneRig {
  const c = SLOT_COLORS[slot % SLOT_COLORS.length];
  const accent = unlit(scene, `droneAccent${slot}`, c);
  const root = kit.node('warden', null);
  const body = kit.node('wBody', root, [0, 0, 0]);
  // Hull: faceted ceramic shell over a graphite keel.
  kit.part('ico', P.white, body, { scale: [0.62, 0.42, 0.78] });
  kit.part('box', P.graphite, body, { pos: [0, -0.2, -0.02], scale: [0.5, 0.16, 0.86] });
  kit.part('box', P.panel, body, { pos: [0, 0.22, -0.12], scale: [0.36, 0.08, 0.5], rot: [0.08, 0, 0] });
  // Sensor visor (team colour) and accent band.
  kit.part('box', accent, body, { pos: [0, 0.06, 0.62], scale: [0.36, 0.08, 0.04], rot: [-0.12, 0, 0], shadow: false });
  kit.part('box', accent, body, { pos: [0, -0.04, 0], scale: [0.64, 0.025, 0.7], shadow: false });
  for (const side of [-1, 1]) {
    kit.part('box', P.graphite, body, { pos: [side * 0.42, 0.02, -0.05], scale: [0.16, 0.22, 0.62] });
    kit.part('box', P.white, body, { pos: [side * 0.5, 0.08, -0.1], scale: [0.06, 0.12, 0.5], rot: [0, 0, side * 0.2] });
  }
  // Hover ring + thrusters.
  const ring = kit.part('torus', accent, body, { pos: [0, -0.32, 0], scale: [1.05, 1.05, 1.05], shadow: false });
  kit.part('torusThin', P.graphite, body, { pos: [0, -0.3, 0], scale: [1.15, 1.15, 1.15] });
  const thrusters: AbstractMesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.sin(a) * 0.52;
    const z = Math.cos(a) * 0.52;
    kit.part('cyl8', P.metal, body, { pos: [x, -0.28, z], scale: [0.16, 0.14, 0.16] });
    thrusters.push(kit.part('cone', accent, body, { pos: [x, -0.46, z], rot: [Math.PI, 0, 0], scale: [0.12, 0.22, 0.12], shadow: false }));
  }
  // Weapon pod on a gimbal under the right flank.
  const pod = kit.node('wPod', body, [0.36, -0.12, 0.18]);
  kit.part('box', P.graphite, pod, { pos: [0, 0, 0.18], scale: [0.14, 0.14, 0.52] });
  kit.part('cyl8', P.metal, pod, { pos: [0, 0, 0.48], rot: [Math.PI / 2, 0, 0], scale: [0.08, 0.2, 0.08] });
  kit.part('box', accent, pod, { pos: [0, 0.08, 0.2], scale: [0.03, 0.02, 0.4], shadow: false });
  const muzzle = kit.node('wMuzzle', pod, [0, 0, 0.62]);
  return { root, body, ring, pod, muzzle, thrusters, accent };
}
