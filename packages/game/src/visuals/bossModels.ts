import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { enemyMats } from './enemyModels';
import type { Kit } from './kit';
import type { Palette } from './materials';
import { loftData, smoothLatheData } from './sculpt';

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
export const COLOSSUS_HIP_Y = -0.6;
/** Whole-rig scale (hitboxes live inside the rig, so they scale with it). */
export const COLOSSUS_SCALE = 1.22;
export const OVERSEER_SCALE = 1.45;

/**
 * Four-legged siege platform (~9 m long, 7 m tall): armoured hull with layered plating, sensor head,
 * twin shoulder cannons, missile pods with hinged covers, an under-slung siege lance, and an armoured
 * rear reactor compartment whose doors open to expose the core. Phase-2 ejects the flank plates.
 */
export function buildColossus(kit: Kit, P: Palette): ColossusRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('colossus', null);
  root.scaling.setAll(COLOSSUS_SCALE);
  const hull = kit.node('cHull', root, [0, COLOSSUS_HULL_Y, 0]);
  const citadel = kit.sculpt('colossusCitadel', () => loftData([
    { t: -3.02, w: 1.47, h: 0.82, n: 6 }, { t: -2.42, w: 2.16, h: 1.1, v: -0.06, n: 7 },
    { t: 1.65, w: 2.24, h: 1.04, n: 7 }, { t: 2.48, w: 2.0, h: 0.96, v: 0.06, n: 6 },
    { t: 3.12, w: 1.39, h: 0.65, v: 0.17, n: 5 },
  ], 'z', 32));
  const flankPlate = kit.sculpt('colossusFlank', () => loftData([
    { t: -1.24, w: 0.10, h: 0.38, v: 0.13, n: 5 }, { t: -0.86, w: 0.29, h: 0.73, n: 6 },
    { t: 0.68, w: 0.28, h: 0.68, n: 7 }, { t: 1.16, w: 0.12, h: 0.4, v: -0.13, n: 5 },
  ], 'z', 16));
  const shin = kit.sculpt('colossusShin', () => loftData([
    { t: -2.68, w: 0.40, h: 0.47, n: 5 }, { t: -2.27, w: 0.57, h: 0.52, n: 6 },
    { t: -0.82, w: 0.42, h: 0.47, n: 5 }, { t: -0.28, w: 0.32, h: 0.34, n: 4 },
  ], 'y', 20));
  // Hull layers
  kit.part('box', M.bossDark, hull, { pos: [0, -1.25, 0], scale: [3.6, 0.9, 5.4] });
  kit.part(citadel, M.bossArmor, hull);
  kit.part('box', P.graphite, hull, { pos: [0, 1.1, -0.2], scale: [3.6, 0.3, 4.8] });
  kit.part('box', M.bossArmor, hull, { pos: [0, 1.38, -0.4], scale: [2.2, 0.35, 3.6] });
  kit.part('box', M.bossArmor, hull, { pos: [0, 0.5, 3.05], scale: [3.8, 1.3, 0.5], rot: [-0.35, 0, 0] });
  for (const side of [-1, 1]) {
    kit.part('box', M.bossArmor, hull, { pos: [side * 2.3, -0.35, 0], scale: [0.35, 1.3, 5.0], rot: [0, 0, side * 0.18] });
    kit.part('box', P.orangeDim, hull, { pos: [side * 2.48, -0.35, 0.4], scale: [0.04, 0.12, 3.6], rot: [0, 0, side * 0.18], shadow: false });
    // Spine ribs
    for (let i = 0; i < 4; i++) kit.part('box', P.graphite, hull, { pos: [side * 1.25, 1.45, -1.9 + i * 1.1], scale: [0.25, 0.35, 0.5] });
  }
  // Ejectable flank plates (phase 2 strips them)
  const plates: AbstractMesh[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.4, 1.2]) plates.push(kit.part(flankPlate, M.plate, hull, { pos: [side * 2.60, 0.3, z], rot: [0, 0, side * 0.12] }));
  }
  // Heat vents along the flanks (glow when exposed)
  const vents: AbstractMesh[] = [];
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) vents.push(kit.part('box', M.bossCore, hull, { pos: [side * 2.25, 0.3, -1.8 + i * 1.5], scale: [0.05, 0.5, 0.9], shadow: false }));
  for (const v of vents) v.setEnabled(false);
  // Head
  const head = kit.node('cHead', hull, [0, 0.25, 3.2]);
  kit.part('box', M.bossDark, head, { scale: [2.2, 1.2, 1.4] });
  kit.part('box', M.bossArmor, head, { pos: [0, 0.65, -0.1], scale: [2.0, 0.25, 1.4], rot: [0.15, 0, 0] });
  kit.part('box', P.graphite, head, { pos: [0, 0, 0.66], scale: [2.0, 0.55, 0.1] });
  kit.part('box', P.orangeGlow, head, { pos: [0, 0.05, 0.72], scale: [1.7, 0.14, 0.04], shadow: false });
  for (const s of [-1, 1]) {
    kit.part('box', P.whiteGlow, head, { pos: [s * 0.53, 0.27, 0.71], scale: [0.24, 0.075, 0.045], rot: [0, 0, -s * 0.44], shadow: false });
    kit.part('box', P.orangeDim, head, { pos: [s * 0.8, 0.34, 0.71], scale: [0.15, 0.075, 0.045], shadow: false });
  }
  for (const x of [-0.6, 0, 0.6]) kit.part('cyl', P.metal, head, { pos: [x, -0.35, 0.68], rot: [Math.PI / 2, 0, 0], scale: [0.26, 0.12, 0.26] });
  kit.part('sphere', M.chargeRed, head, { pos: [0, -0.35, 0.76], scale: [0.18, 0.18, 0.08], shadow: false });
  // Rear core compartment with sliding doors
  const comp = kit.node('cComp', hull, [0, 0.15, -3.0]);
  kit.part('box', P.graphite, comp, { scale: [2.7, 1.9, 0.6] });
  const core = kit.part('cyl', M.bossCore, comp, { pos: [0, 0, -0.25], rot: [Math.PI / 2, 0, 0], scale: [1.15, 0.5, 1.15], shadow: false });
  kit.part('torus', P.metal, comp, { pos: [0, 0, -0.34], rot: [Math.PI / 2, 0, 0], scale: [1.4, 1.4, 1.4] });
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    kit.part('box', P.whiteGlow, comp, { pos: [x * 0.55, y * 0.55, -0.49], scale: [0.23, 0.07, 0.04], rot: [0, 0, -x * y * 0.45], shadow: false });
  }
  const doors: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const d = kit.node('cDoor', comp, [side * 0.7, 0, -0.42]);
    kit.part('box', M.bossArmor, d, { scale: [1.4, 1.95, 0.22] });
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
    kit.part('sphere', M.bossArmor, mount, { scale: [1.2, 1.1, 1.2] });
    kit.part('box', P.graphite, mount, { pos: [side * 0.2, 0.5, 0], scale: [0.6, 0.3, 1.3] });
    const barrel = kit.node('cBarrel', mount, [side * 0.15, 0.05, 0.4]);
    kit.part('box', M.bossDark, barrel, { pos: [0, 0, 0.6], scale: [0.85, 0.75, 1.6] });
    kit.part('cyl', P.metal, barrel, { pos: [0, 0.1, 1.9], rot: [Math.PI / 2, 0, 0], scale: [0.42, 1.8, 0.42] });
    kit.part('cyl', M.bossArmor, barrel, { pos: [0, 0.1, 2.85], rot: [Math.PI / 2, 0, 0], scale: [0.6, 0.35, 0.6] });
    kit.part('torus', P.orangeGlow, barrel, { pos: [0, 0.1, 3.05], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.5, 0.5], shadow: false });
    for (let i = 0; i < 3; i++) kit.part('box', P.graphite, barrel, { pos: [0, 0.48, 1.1 + i * 0.5], scale: [0.3, 0.12, 0.3] });
    const muzzle = kit.node('cMuzzle', barrel, [0, 0.1, 3.2]);
    cannons.push({ mount, barrel, muzzle });
  }
  // Missile pods
  const pods: ColossusRig['pods'] = [];
  for (const side of [-1, 1]) {
    const pod = kit.node('cPod', hull, [side * 1.35, 1.75, -1.1]);
    kit.part('box', M.bossDark, pod, { scale: [1.1, 0.7, 1.5] });
    const glow: AbstractMesh[] = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      kit.part('cyl', P.graphite, pod, { pos: [(c - 1) * 0.32, 0.36, (r - 0.5) * 0.5], scale: [0.22, 0.05, 0.22] });
      glow.push(kit.part('cyl', M.chargeRed, pod, { pos: [(c - 1) * 0.32, 0.39, (r - 0.5) * 0.5], scale: [0.14, 0.02, 0.14], shadow: false }));
    }
    for (const g of glow) g.setEnabled(false);
    const cover = kit.node('cCover', pod, [0, 0.38, 0.75]);
    kit.part('box', M.bossArmor, cover, { pos: [0, 0.04, -0.75], scale: [1.15, 0.1, 1.55] });
    const muzzle = kit.node('cPodMuzzle', pod, [0, 0.6, 0]);
    pods.push({ cover, glow, muzzle });
  }
  // Siege lance
  const lance = kit.node('cLance', hull, [0, -1.55, 2.4]);
  kit.part('box', P.graphite, lance, { pos: [0, 0.15, -0.5], scale: [1.1, 0.5, 1.4] });
  kit.part('cyl', P.metal, lance, { pos: [0, 0, 0.9], rot: [Math.PI / 2, 0, 0], scale: [0.5, 2.0, 0.5] });
  for (let i = 0; i < 3; i++) kit.part('torus', M.bossArmor, lance, { pos: [0, 0, 0.4 + i * 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.72, 0.72, 0.72] });
  const lanceTip = kit.part('sphere', M.chargeRed, lance, { pos: [0, 0, 1.95], scale: [0.36, 0.36, 0.36], shadow: false });
  // Legs: hip (swing) -> splayed thigh -> knee -> vertical shin -> foot pad
  const legs: ColossusLeg[] = [];
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const hip = kit.node('cHip', hull, [side * 1.9, COLOSSUS_HIP_Y, front * 2.1]);
    kit.part('sphere', M.bossArmor, hip, { scale: [1.1, 1.1, 1.1] });
    const thigh = kit.node('cThigh', hip);
    thigh.rotation.z = side * 0.95;
    kit.part('box', M.bossDark, thigh, { pos: [0, -1.1, 0], scale: [1.0, 2.3, 1.05] });
    kit.part('box', M.bossArmor, thigh, { pos: [side * -0.1, -1.0, 0.05], scale: [0.5, 1.9, 0.95] });
    kit.part('cyl', P.metal, thigh, { pos: [side * 0.45, -1.2, 0], scale: [0.18, 1.6, 0.18] });
    const knee = kit.node('cKnee', thigh, [0, -2.3, 0]);
    knee.rotation.z = -side * 0.95;
    kit.part('sphere', P.metal, knee, { scale: [0.75, 0.75, 0.75] });
    kit.part(shin, M.bossArmor, knee);
    kit.part('cyl', P.metal, knee, { pos: [side * 0.44, -1.35, -front * 0.13], scale: [0.16, 1.9, 0.16] });
    kit.part('cyl8', P.graphite, knee, { pos: [side * 0.43, -1.93, -front * 0.13], scale: [0.23, 0.83, 0.23] });
    kit.part('box', P.graphite, knee, { pos: [0, -1.0, front * 0.38], scale: [0.5, 1.6, 0.12] });
    kit.part('box', P.orangeDim, knee, { pos: [0, -0.9, front * 0.45], scale: [0.08, 1.0, 0.02], shadow: false });
    kit.part('cyl6', P.graphite, knee, { pos: [0, -2.75, 0], scale: [1.5, 0.3, 1.7] });
    kit.part('cyl6', M.bossDark, knee, { pos: [0, -2.55, 0], scale: [1.1, 0.3, 1.2] });
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
  root.scaling.setAll(OVERSEER_SCALE);
  const body = kit.node('oBody', root);
  const housing = kit.sculpt('overseerHousing', () => smoothLatheData([
    [0.42, -1.19], [0.92, -0.96], [1.15, -0.48], [1.19, -0.18],
    [1.19, 0.18], [1.15, 0.48], [0.91, 0.98], [0.41, 1.24],
  ], 32));
  const gimbalPlate = kit.sculpt('overseerGimbalPlate', () => loftData([
    { t: -0.75, w: 0.09, h: 0.16, u: -0.16, n: 4 },
    { t: -0.55, w: 0.16, h: 0.28, u: -0.065, n: 6 },
    { t: 0, w: 0.19, h: 0.35, n: 6 },
    { t: 0.55, w: 0.16, h: 0.28, u: -0.065, n: 6 },
    { t: 0.75, w: 0.09, h: 0.16, u: -0.16, n: 4 },
  ], 'x', 16));
  kit.part(housing, M.bossDark, body);
  const inner = kit.part('sphere', M.violet, body, { scale: [1.7, 1.7, 1.7], shadow: false });
  // Equator band + lens
  kit.part('torus', P.graphite, body, { scale: [2.7, 2.7, 2.7] });
  kit.part('cyl', M.bossArmor, body, { pos: [0, 0, 1.1], rot: [Math.PI / 2, 0, 0], scale: [1.2, 0.4, 1.2] });
  kit.part('torus', P.metal, body, { pos: [0, 0, 1.32], rot: [Math.PI / 2, 0, 0], scale: [1.15, 1.15, 1.15] });
  const eye = kit.part('sphere', M.bossCore, body, { pos: [0, 0, 1.32], scale: [0.7, 0.7, 0.25], shadow: false });
  kit.part('torus', P.whiteGlow, body, { pos: [0, 0, 1.43], rot: [Math.PI / 2, 0, 0], scale: [0.64, 0.64, 0.64], shadow: false });
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    kit.part('box', M.bossArmor, body, { pos: [Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, 1.32], rot: [0, 0, angle], scale: [0.33, 0.12, 0.28] });
  }
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
      kit.part(gimbalPlate, M.bossArmor, plate);
      kit.part('box', P.graphite, plate, { pos: [0, 0, 0.171], scale: [0.92, 0.28, 0.09] });
      kit.part('box', M.violetDim, plate, { pos: [0, 0.02, 0.222], scale: [0.69, 0.043, 0.02], shadow: false });
      plates.push(plate);
    }
    rings.push({ node, plates, axis, speed });
  }
  // Weapon arms
  const arms: OverseerRig['arms'] = [];
  for (const side of [-1, 1]) {
    const node = kit.node('oArm', body, [side * 2.1, -0.5, 0.3]);
    kit.part('sphere', M.bossArmor, node, { scale: [0.8, 0.8, 0.8] });
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
  const shield = kit.part('sphere', M.bossShield, body, { scale: [7.4, 7.4, 7.4], shadow: false });
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
  const spindle = kit.sculpt('pylonSpindle', () => smoothLatheData([[0.19, -0.93], [0.37, -0.83], [0.57, -0.47], [0.55, -0.27], [0.24, -0.13], [0.24, 0.16], [0.54, 0.32], [0.52, 0.49], [0.33, 0.83], [0.13, 0.96]], 12));
  kit.part(spindle, P.enemyDark, body);
  kit.part('sphere', M.violet, body, { scale: [0.6, 0.6, 0.6], shadow: false });
  kit.part('torus', M.violetDim, body, { scale: [1.03, 1.75, 1.03], shadow: false });
  for (const s of [-1, 1]) kit.part('cone4', P.enemyArmor, body, { pos: [0, s * 0.95, 0], rot: [s < 0 ? Math.PI : 0, 0, 0], scale: [0.6, 0.6, 0.6] });
  const ring = kit.part('torusThin', M.violet, body, { scale: [1.9, 1.9, 1.9], shadow: false });
  return { root, body, ring };
}
