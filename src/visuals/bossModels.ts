import type { AbstractMesh, TransformNode } from '@babylonjs/core';
import { enemyMats } from './enemyModels';
import type { Kit } from './kit';
import type { Palette } from './materials';

// ============================================================================ Siege Colossus

export interface ColossusLeg {
  hip: TransformNode;
  knee: TransformNode;
  side: number;
  front: number;
}

export interface ColossusRig {
  root: TransformNode;
  hull: TransformNode;
  head: TransformNode;
  legs: ColossusLeg[];
  cannons: { mount: TransformNode; barrel: TransformNode; muzzle: TransformNode }[];
  pods: { cover: TransformNode; glow: AbstractMesh[]; muzzle: TransformNode }[];
  doors: TransformNode[];
  core: AbstractMesh;
  lance: TransformNode;
  lanceTip: AbstractMesh;
  plates: AbstractMesh[];
  vents: AbstractMesh[];
  hatch: TransformNode;
}

export const COLOSSUS_HULL_Y = 5.0;

/**
 * Four-legged siege platform (~9 m long, 7 m tall): armoured hull with layered plating, sensor head,
 * twin shoulder cannons, missile pods with hinged covers, an under-slung siege lance, and an armoured
 * rear reactor compartment whose doors open to expose the core. Phase-2 ejects the flank plates.
 */
export function buildColossus(kit: Kit, P: Palette): ColossusRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('colossus', null);
  const hull = kit.node('cHull', root, [0, COLOSSUS_HULL_Y, 0]);
  // Hull layers
  kit.part('box', P.enemyDark, hull, { pos: [0, -1.25, 0], scale: [3.6, 0.9, 5.4] });
  kit.part('box', P.enemyArmor, hull, { scale: [4.4, 2.0, 5.8] });
  kit.part('box', P.graphite, hull, { pos: [0, 1.1, -0.2], scale: [3.6, 0.3, 4.8] });
  kit.part('box', P.enemyArmor, hull, { pos: [0, 1.38, -0.4], scale: [2.2, 0.35, 3.6] });
  kit.part('box', P.enemyArmor, hull, { pos: [0, 0.5, 3.05], scale: [3.8, 1.3, 0.5], rot: [-0.35, 0, 0] });
  for (const side of [-1, 1]) {
    kit.part('box', P.enemyArmor, hull, { pos: [side * 2.3, -0.35, 0], scale: [0.35, 1.3, 5.0], rot: [0, 0, side * 0.18] });
    kit.part('box', P.orangeDim, hull, { pos: [side * 2.48, -0.35, 0.4], scale: [0.04, 0.12, 3.6], rot: [0, 0, side * 0.18], shadow: false });
    // Spine ribs
    for (let i = 0; i < 4; i++) kit.part('box', P.graphite, hull, { pos: [side * 1.25, 1.45, -1.9 + i * 1.1], scale: [0.25, 0.35, 0.5] });
  }
  // Ejectable flank plates (phase 2 strips them)
  const plates: AbstractMesh[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.4, 1.2]) plates.push(kit.part('box', M.plate, hull, { pos: [side * 2.62, 0.3, z], scale: [0.28, 1.3, 2.2], rot: [0, 0, side * 0.12] }));
  }
  // Heat vents along the flanks (glow when exposed)
  const vents: AbstractMesh[] = [];
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) vents.push(kit.part('box', M.bossCore, hull, { pos: [side * 2.25, 0.3, -1.8 + i * 1.5], scale: [0.05, 0.5, 0.9], shadow: false }));
  for (const v of vents) v.setEnabled(false);
  // Head
  const head = kit.node('cHead', hull, [0, 0.25, 3.2]);
  kit.part('box', P.enemyDark, head, { scale: [2.2, 1.2, 1.4] });
  kit.part('box', P.enemyArmor, head, { pos: [0, 0.65, -0.1], scale: [2.0, 0.25, 1.4], rot: [0.15, 0, 0] });
  kit.part('box', P.graphite, head, { pos: [0, 0, 0.66], scale: [2.0, 0.55, 0.1] });
  kit.part('box', P.orangeGlow, head, { pos: [0, 0.05, 0.72], scale: [1.7, 0.14, 0.04], shadow: false });
  for (const x of [-0.6, 0, 0.6]) kit.part('cyl', P.metal, head, { pos: [x, -0.35, 0.68], rot: [Math.PI / 2, 0, 0], scale: [0.26, 0.12, 0.26] });
  kit.part('sphere', M.chargeRed, head, { pos: [0, -0.35, 0.76], scale: [0.18, 0.18, 0.08], shadow: false });
  // Rear core compartment with sliding doors
  const comp = kit.node('cComp', hull, [0, 0.15, -3.0]);
  kit.part('box', P.graphite, comp, { scale: [2.7, 1.9, 0.6] });
  const core = kit.part('cyl', M.bossCore, comp, { pos: [0, 0, -0.25], rot: [Math.PI / 2, 0, 0], scale: [1.15, 0.5, 1.15], shadow: false });
  kit.part('torus', P.metal, comp, { pos: [0, 0, -0.34], rot: [Math.PI / 2, 0, 0], scale: [1.4, 1.4, 1.4] });
  const doors: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const d = kit.node('cDoor', comp, [side * 0.7, 0, -0.42]);
    kit.part('box', P.enemyArmor, d, { scale: [1.4, 1.95, 0.22] });
    kit.part('box', P.orangeDim, d, { pos: [-side * 0.66, 0, -0.12], scale: [0.04, 1.6, 0.04], shadow: false });
    doors.push(d);
  }
  // Rear deployment hatch (summons)
  const hatch = kit.node('cHatch', hull, [0, -1.5, -2.2]);
  kit.part('box', P.graphite, hatch, { scale: [1.6, 0.15, 1.4] });
  // Shoulder cannons
  const cannons: ColossusRig['cannons'] = [];
  for (const side of [-1, 1]) {
    const mount = kit.node('cMount', hull, [side * 2.55, 1.15, 1.2]);
    kit.part('sphere', P.enemyArmor, mount, { scale: [1.2, 1.1, 1.2] });
    kit.part('box', P.graphite, mount, { pos: [side * 0.2, 0.5, 0], scale: [0.6, 0.3, 1.3] });
    const barrel = kit.node('cBarrel', mount, [side * 0.15, 0.05, 0.4]);
    kit.part('box', P.enemyDark, barrel, { pos: [0, 0, 0.6], scale: [0.85, 0.75, 1.6] });
    kit.part('cyl', P.metal, barrel, { pos: [0, 0.1, 1.9], rot: [Math.PI / 2, 0, 0], scale: [0.42, 1.8, 0.42] });
    kit.part('cyl', P.enemyArmor, barrel, { pos: [0, 0.1, 2.85], rot: [Math.PI / 2, 0, 0], scale: [0.6, 0.35, 0.6] });
    kit.part('torus', P.orangeGlow, barrel, { pos: [0, 0.1, 3.05], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.5, 0.5], shadow: false });
    for (let i = 0; i < 3; i++) kit.part('box', P.graphite, barrel, { pos: [0, 0.48, 1.1 + i * 0.5], scale: [0.3, 0.12, 0.3] });
    const muzzle = kit.node('cMuzzle', barrel, [0, 0.1, 3.2]);
    cannons.push({ mount, barrel, muzzle });
  }
  // Missile pods
  const pods: ColossusRig['pods'] = [];
  for (const side of [-1, 1]) {
    const pod = kit.node('cPod', hull, [side * 1.35, 1.75, -1.1]);
    kit.part('box', P.enemyDark, pod, { scale: [1.1, 0.7, 1.5] });
    const glow: AbstractMesh[] = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      kit.part('cyl', P.graphite, pod, { pos: [(c - 1) * 0.32, 0.36, (r - 0.5) * 0.5], scale: [0.22, 0.05, 0.22] });
      glow.push(kit.part('cyl', M.chargeRed, pod, { pos: [(c - 1) * 0.32, 0.39, (r - 0.5) * 0.5], scale: [0.14, 0.02, 0.14], shadow: false }));
    }
    for (const g of glow) g.setEnabled(false);
    const cover = kit.node('cCover', pod, [0, 0.38, 0.75]);
    kit.part('box', P.enemyArmor, cover, { pos: [0, 0.04, -0.75], scale: [1.15, 0.1, 1.55] });
    const muzzle = kit.node('cPodMuzzle', pod, [0, 0.6, 0]);
    pods.push({ cover, glow, muzzle });
  }
  // Siege lance
  const lance = kit.node('cLance', hull, [0, -1.55, 2.4]);
  kit.part('box', P.graphite, lance, { pos: [0, 0.15, -0.5], scale: [1.1, 0.5, 1.4] });
  kit.part('cyl', P.metal, lance, { pos: [0, 0, 0.9], rot: [Math.PI / 2, 0, 0], scale: [0.5, 2.0, 0.5] });
  for (let i = 0; i < 3; i++) kit.part('torus', P.enemyArmor, lance, { pos: [0, 0, 0.4 + i * 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.72, 0.72, 0.72] });
  const lanceTip = kit.part('sphere', M.chargeRed, lance, { pos: [0, 0, 1.95], scale: [0.36, 0.36, 0.36], shadow: false });
  // Legs: hip (swing) -> splayed thigh -> knee -> vertical shin -> foot pad
  const legs: ColossusLeg[] = [];
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const hip = kit.node('cHip', hull, [side * 1.9, -0.6, front * 2.1]);
    kit.part('sphere', P.enemyArmor, hip, { scale: [1.1, 1.1, 1.1] });
    const thigh = kit.node('cThigh', hip);
    thigh.rotation.z = side * 0.95;
    kit.part('box', P.enemyDark, thigh, { pos: [0, -1.1, 0], scale: [0.8, 2.3, 0.85] });
    kit.part('box', P.enemyArmor, thigh, { pos: [side * -0.1, -1.0, 0.05], scale: [0.5, 1.9, 0.95] });
    kit.part('cyl', P.metal, thigh, { pos: [side * 0.45, -1.2, 0], scale: [0.18, 1.6, 0.18] });
    const knee = kit.node('cKnee', thigh, [0, -2.3, 0]);
    knee.rotation.z = -side * 0.95;
    kit.part('sphere', P.metal, knee, { scale: [0.75, 0.75, 0.75] });
    kit.part('box', P.enemyArmor, knee, { pos: [0, -1.4, 0], scale: [0.7, 2.6, 0.7] });
    kit.part('box', P.graphite, knee, { pos: [0, -1.0, front * 0.38], scale: [0.5, 1.6, 0.12] });
    kit.part('box', P.orangeDim, knee, { pos: [0, -0.9, front * 0.45], scale: [0.08, 1.0, 0.02], shadow: false });
    kit.part('cyl6', P.graphite, knee, { pos: [0, -2.75, 0], scale: [1.5, 0.3, 1.7] });
    kit.part('cyl6', P.enemyDark, knee, { pos: [0, -2.55, 0], scale: [1.1, 0.3, 1.2] });
    legs.push({ hip, knee, side, front });
  }
  return { root, hull, head, legs, cannons, pods, doors, core, lance, lanceTip, plates, vents, hatch };
}

// ============================================================================ Overseer Core

export interface OverseerRig {
  root: TransformNode;
  body: TransformNode;
  rings: { node: TransformNode; plates: TransformNode[]; axis: 'x' | 'y' | 'z'; speed: number }[];
  eye: AbstractMesh;
  inner: AbstractMesh;
  shield: AbstractMesh;
  arms: { node: TransformNode; muzzle: TransformNode }[];
  crown: TransformNode;
  thrusters: AbstractMesh[];
}

/**
 * Floating command machine: a dark armoured sphere with a violet inner core and a single lens, three
 * counter-rotating rings of armour plates (they spread apart when the core opens), two articulated
 * weapon arms, a crown of fins and violet lift thrusters. A barrier bubble shows while emitters live.
 */
export function buildOverseer(kit: Kit, P: Palette): OverseerRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('overseer', null);
  const body = kit.node('oBody', root);
  kit.part('sphere', P.enemyDark, body, { scale: [2.5, 2.5, 2.5] });
  const inner = kit.part('sphere', M.violet, body, { scale: [1.7, 1.7, 1.7], shadow: false });
  // Equator band + lens
  kit.part('torus', P.graphite, body, { scale: [2.7, 2.7, 2.7] });
  kit.part('cyl', P.enemyArmor, body, { pos: [0, 0, 1.1], rot: [Math.PI / 2, 0, 0], scale: [1.2, 0.4, 1.2] });
  kit.part('torus', P.metal, body, { pos: [0, 0, 1.32], rot: [Math.PI / 2, 0, 0], scale: [1.15, 1.15, 1.15] });
  const eye = kit.part('sphere', M.bossCore, body, { pos: [0, 0, 1.32], scale: [0.7, 0.7, 0.25], shadow: false });
  // Plate rings
  const rings: OverseerRig['rings'] = [];
  const specs: [('x' | 'y' | 'z'), number, number][] = [['y', 0.35, 2.15], ['x', -0.25, 2.55], ['z', 0.18, 2.95]];
  for (const [axis, speed, r] of specs) {
    const node = kit.node('oRing', body);
    if (axis === 'x') node.rotation.z = Math.PI / 2;
    if (axis === 'z') node.rotation.x = Math.PI / 2;
    const plates: TransformNode[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const holder = kit.node('oPlateH', node);
      holder.rotation.y = a;
      const plate = kit.node('oPlate', holder, [0, 0, r]);
      kit.part('box', P.enemyArmor, plate, { scale: [1.5, 0.55, 0.22] });
      kit.part('box', P.graphite, plate, { pos: [0, 0, 0.12], scale: [1.1, 0.25, 0.08] });
      kit.part('box', M.violetDim, plate, { pos: [0, 0.18, 0.13], scale: [0.9, 0.04, 0.02], shadow: false });
      plates.push(plate);
    }
    rings.push({ node, plates, axis, speed });
  }
  // Weapon arms
  const arms: OverseerRig['arms'] = [];
  for (const side of [-1, 1]) {
    const node = kit.node('oArm', body, [side * 2.1, -0.5, 0.3]);
    kit.part('sphere', P.enemyArmor, node, { scale: [0.8, 0.8, 0.8] });
    kit.part('box', P.graphite, node, { pos: [side * 0.6, -0.1, 0.4], scale: [0.4, 0.4, 1.4] });
    kit.part('cyl', P.metal, node, { pos: [side * 0.6, -0.1, 1.4], rot: [Math.PI / 2, 0, 0], scale: [0.36, 1.0, 0.36] });
    kit.part('torus', M.violet, node, { pos: [side * 0.6, -0.1, 1.92], rot: [Math.PI / 2, 0, 0], scale: [0.4, 0.4, 0.4], shadow: false });
    arms.push({ node, muzzle: kit.node('oMuzzle', node, [side * 0.6, -0.1, 2.0]) });
  }
  // Crown fins
  const crown = kit.node('oCrown', body, [0, 1.25, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    kit.part('cone4', P.graphite, crown, { pos: [Math.sin(a) * 0.7, 0.5, Math.cos(a) * 0.7], rot: [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4], scale: [0.35, 1.4, 0.35] });
  }
  kit.part('sphere', M.violet, crown, { pos: [0, 0.35, 0], scale: [0.3, 0.3, 0.3], shadow: false });
  // Lift thrusters
  const thrusters: AbstractMesh[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    kit.part('cyl', P.graphite, body, { pos: [Math.sin(a) * 0.9, -1.25, Math.cos(a) * 0.9], scale: [0.5, 0.4, 0.5] });
    thrusters.push(kit.part('cone', M.energyWallViolet, body, { pos: [Math.sin(a) * 0.9, -2.0, Math.cos(a) * 0.9], rot: [Math.PI, 0, 0], scale: [0.45, 1.2, 0.45], shadow: false }));
  }
  const shield = kit.part('sphere', M.energyWallViolet, body, { scale: [7.4, 7.4, 7.4], shadow: false });
  return { root, body, rings, eye, inner, shield, arms, crown, thrusters };
}

export interface PylonRig {
  root: TransformNode;
  body: TransformNode;
  ring: AbstractMesh;
}

/** Overseer shield emitter: armoured octahedron with a violet core and a spinning ring. */
export function buildPylon(kit: Kit, P: Palette): PylonRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('pylon', null);
  const body = kit.node('pBody', root);
  kit.part('ico', P.enemyDark, body, { scale: [1.2, 1.6, 1.2] });
  kit.part('sphere', M.violet, body, { scale: [0.6, 0.6, 0.6], shadow: false });
  for (const s of [-1, 1]) kit.part('cone4', P.enemyArmor, body, { pos: [0, s * 0.95, 0], rot: [s < 0 ? Math.PI : 0, 0, 0], scale: [0.6, 0.6, 0.6] });
  const ring = kit.part('torusThin', M.violet, body, { scale: [1.9, 1.9, 1.9], shadow: false });
  return { root, body, ring };
}
