import {
  type AbstractMesh,
  type Material,
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  type Scene,
  TransformNode,
} from '@babylonjs/core';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';
import { canvas, fbm, flareSprite, toTexture } from './textures';
import { segmentedRing } from './rings';
import { loftData, type LoftAxis, type Section, smoothLatheData } from './sculpt';

export interface WalkerRig {
  root: TransformNode;
  hips: TransformNode;
  torso: TransformNode;
  head: TransformNode;
  thighL: TransformNode;
  thighR: TransformNode;
  kneeL: TransformNode;
  kneeR: TransformNode;
  ankleL: TransformNode;
  ankleR: TransformNode;
  cannon: TransformNode;
  barrel: TransformNode;
  muzzleGlow: AbstractMesh;
  shield: AbstractMesh | null;
}

export const WALKER_THIGH = 0.69;
export const WALKER_SHIN = 0.65;

/** Sculpted walker parts (registered once per kit, instanced on every rig). */
function walkerShapes(kit: Kit) {
  const L = (name: string, secs: Section[], axis: LoftAxis = 'z', segs = 28) => kit.sculpt(name, () => loftData(secs, axis, segs));
  const lathe = (name: string, prof: [number, number][], tess = 24) => kit.sculpt(name, () => smoothLatheData(prof, tess));
  return {
    pelvis: L('wPelvis', [{ t: -0.46, w: 0.15, h: 0.11 }, { t: -0.38, w: 0.27, h: 0.17, n: 5 }, { t: 0.38, w: 0.27, h: 0.17, n: 5 }, { t: 0.46, w: 0.15, h: 0.11 }], 'x'),
    axle: lathe('wAxle', [[0.1, -0.5], [0.15, -0.47], [0.15, 0.47], [0.1, 0.5]], 16),
    chest: L('wChest', [
      { t: -0.42, w: 0.38, h: 0.3, v: 0.02 },
      { t: -0.3, w: 0.58, h: 0.4, v: 0.04, n: 5 },
      { t: 0.05, w: 0.66, h: 0.43, v: 0.03, n: 5 },
      { t: 0.32, w: 0.58, h: 0.38, v: -0.02, n: 4.5 },
      { t: 0.47, w: 0.42, h: 0.28, v: -0.05 },
      { t: 0.52, w: 0.3, h: 0.19, v: -0.06, n: 3 },
    ], 'z', 32),
    chestPlate: L('wChestPlate', [{ t: -0.3, w: 0.36, h: 0.06, v: 0.0 }, { t: 0.0, w: 0.42, h: 0.08 }, { t: 0.28, w: 0.3, h: 0.05, v: -0.02 }], 'y', 24),
    abdomen: L('wAbdomen', [{ t: -0.45, w: 0.3, h: 0.24 }, { t: -0.2, w: 0.36, h: 0.28, n: 5 }, { t: 0, w: 0.42, h: 0.3, n: 5 }], 'y'),
    pack: L('wPack', [{ t: -0.8, w: 0.28, h: 0.24, v: 0.05 }, { t: -0.72, w: 0.4, h: 0.32, v: 0.05, n: 5 }, { t: -0.46, w: 0.42, h: 0.34, v: 0.05, n: 5 }, { t: -0.38, w: 0.34, h: 0.28, v: 0.04 }]),
    head: L('wHead', [
      { t: -0.32, w: 0.2, h: 0.13, v: 0.03 },
      { t: -0.22, w: 0.28, h: 0.19, v: 0.03, n: 5 },
      { t: 0.12, w: 0.29, h: 0.18, n: 5 },
      { t: 0.28, w: 0.23, h: 0.12, v: -0.02 },
      { t: 0.34, w: 0.16, h: 0.07, v: -0.03, n: 3 },
    ]),
    brow: L('wBrow', [{ t: -0.26, w: 0.24, h: 0.03, v: 0.2 }, { t: 0.05, w: 0.27, h: 0.04, v: 0.21 }, { t: 0.26, w: 0.2, h: 0.03, v: 0.16 }], 'z', 20),
    pod: L('wPod', [{ t: -0.32, w: 0.18, h: 0.18, n: 3 }, { t: -0.18, w: 0.27, h: 0.27, n: 3 }, { t: 0.2, w: 0.27, h: 0.26, n: 3.5 }, { t: 0.34, w: 0.2, h: 0.2, n: 3 }]),
    barrel: lathe('wBarrel', [[0.16, 0.18], [0.19, 0.22], [0.19, 0.42], [0.15, 0.46], [0.12, 0.5], [0.12, 0.93], [0.15, 0.97], [0.17, 1.04], [0.14, 1.08]], 24),
    blade: L('wBlade', [{ t: 0.05, w: 0.07, h: 0.2, v: 0.05 }, { t: -0.35, w: 0.085, h: 0.32, v: 0.15, n: 6 }, { t: -0.78, w: 0.05, h: 0.2, v: 0.27 }, { t: -0.9, w: 0.02, h: 0.07, v: 0.3 }], 'y', 20),
    pauldron: L('wPauldron', [{ t: -0.3, w: 0.24, h: 0.05, v: 0.2 }, { t: 0, w: 0.31, h: 0.09, v: 0.25 }, { t: 0.3, w: 0.24, h: 0.05, v: 0.2 }], 'z', 20),
    thigh: L('wThigh', [{ t: 0.06, w: 0.15, h: 0.16 }, { t: -0.12, w: 0.19, h: 0.22, v: 0.03, n: 5 }, { t: -0.5, w: 0.16, h: 0.19, v: 0.04, n: 5 }, { t: -0.73, w: 0.1, h: 0.13 }], 'y'),
    hub: lathe('wHub', [[0.09, -0.22], [0.18, -0.19], [0.2, -0.12], [0.2, 0.12], [0.18, 0.19], [0.09, 0.22]], 20),
    shin: L('wShin', [{ t: 0.02, w: 0.12, h: 0.14, v: -0.07 }, { t: -0.25, w: 0.14, h: 0.18, v: -0.14, n: 5 }, { t: -0.55, w: 0.11, h: 0.13, v: -0.11 }, { t: -0.68, w: 0.08, h: 0.1, v: -0.05 }], 'y'),
    foot: L('wFoot', [{ t: -0.3, w: 0.13, h: 0.05 }, { t: -0.2, w: 0.19, h: 0.07, n: 5 }, { t: 0.25, w: 0.2, h: 0.065, v: -0.005, n: 5 }, { t: 0.46, w: 0.13, h: 0.035, v: -0.02 }]),
    footPlate: L('wFootPlate', [{ t: -0.16, w: 0.15, h: 0.03, v: 0.07 }, { t: 0.1, w: 0.17, h: 0.035, v: 0.075 }, { t: 0.36, w: 0.13, h: 0.02, v: 0.05 }], 'z', 20),
    exhaust: lathe('wExhaust', [[0.07, 0], [0.09, 0.05], [0.08, 0.55], [0.1, 0.58], [0.09, 0.62]], 14),
    sensor: lathe('wSensor', [[0.06, -0.17], [0.11, -0.12], [0.11, 0.1], [0.08, 0.15]], 14),
    heavyPlate: L('wHeavyPlate', [{ t: -0.4, w: 0.28, h: 0.06 }, { t: 0, w: 0.33, h: 0.1, n: 5 }, { t: 0.4, w: 0.26, h: 0.05 }], 'z', 20),
  };
}

/** Strider walker (and the heavier Bulwark variant). Root sits on the ground, faces +Z. */
export function buildWalker(kit: Kit, P: Palette, heavy: boolean): WalkerRig {
  const S = walkerShapes(kit);
  const root = kit.node('walker', null);
  const scaleRoot = kit.node('wScale', root);
  const s = heavy ? 1.32 : 1;
  scaleRoot.scaling.setAll(s);
  const HALF_PI = Math.PI / 2;

  const hips = kit.node('hips', scaleRoot, [0, 1.35, 0]);
  kit.part(S.pelvis, P.enemyDark, hips);
  kit.part(S.axle, P.metal, hips, { rot: [0, 0, HALF_PI] });

  const torso = kit.node('torso', hips, [0, 0.58, 0]);
  kit.part(S.abdomen, P.enemyDark, torso, { pos: [0, 0.02, -0.05] });
  kit.part(S.chest, P.enemyArmor, torso, { rot: [0.08, 0, 0] });
  kit.part(S.chestPlate, P.enemyArmor, torso, { pos: [0, 0.05, 0.47], rot: [-HALF_PI + 0.2, 0, 0] });
  kit.part(S.pack, P.enemyDark, torso);
  for (let i = 0; i < 3; i++) kit.part('box', P.graphite, torso, { pos: [0, 0.2 - i * 0.09, 0.535], scale: [0.42, 0.03, 0.03], rot: [-0.2, 0, 0] });
  for (const side of [-1, 1]) {
    kit.part('box', P.orangeDim, torso, { pos: [side * 0.3, -0.12, 0.5], scale: [0.09, 0.04, 0.02], shadow: false });
    kit.part('box', P.orangeGlow, torso, { pos: [side * 0.2, 0.1, -0.805], scale: [0.09, 0.34, 0.02], shadow: false });
    kit.part(S.exhaust, P.metal, torso, { pos: [side * 0.27, 0.32, -0.62], rot: [-0.25, 0, 0] });
    kit.part('cyl8', P.orangeDim, torso, { pos: [side * 0.27, 0.93, -0.78], rot: [-0.25, 0, 0], scale: [0.13, 0.03, 0.13], shadow: false });
    kit.part('cyl8', P.enemyDark, torso, { pos: [side * 0.32, -0.32, -0.5], rot: [0.5, 0, 0], scale: [0.07, 0.5, 0.07] });
  }

  const head = kit.node('head', torso, [0, 0.62, 0.12]);
  kit.part(S.head, P.enemyDark, head);
  kit.part(S.brow, P.enemyArmor, head);
  kit.part('box', P.graphite, head, { pos: [0, 0.0, 0.3], scale: [0.4, 0.13, 0.06] });
  kit.part('box', P.orangeGlow, head, { pos: [0, 0.005, 0.335], scale: [0.32, 0.05, 0.02], shadow: false });
  kit.part('cyl8', P.metal, head, { pos: [0.2, 0.3, -0.18], scale: [0.035, 0.38, 0.035] });
  kit.part('cyl8', P.metal, head, { pos: [-0.16, 0.26, -0.22], scale: [0.03, 0.24, 0.03] });
  kit.part('sphere', P.orangeGlow, head, { pos: [0.2, 0.5, -0.18], scale: [0.06, 0.06, 0.06], shadow: false });
  for (const side of [-1, 1]) kit.part(S.sensor, P.graphite, head, { pos: [side * 0.29, -0.02, 0.1], rot: [HALF_PI, 0, 0] });

  // Right arm: plasma cannon on a sculpted shoulder pod.
  const cannon = kit.node('cannon', torso, [0.82, 0.05, 0.1]);
  kit.part(S.pod, P.enemyArmor, cannon);
  const barrel = kit.node('barrelSlide', cannon);
  kit.part(S.barrel, P.enemyDark, barrel, { pos: [0.05, -0.05, 0], rot: [HALF_PI, 0, 0] });
  kit.part('box', P.orangeDim, barrel, { pos: [0.05, 0.1, 0.62], scale: [0.05, 0.02, 0.5], shadow: false });
  for (let i = 0; i < 4; i++) kit.part('cyl', P.graphite, barrel, { pos: [0.05, -0.05, 0.3 + i * 0.05], rot: [HALF_PI, 0, 0], scale: [0.44, 0.018, 0.44] });
  if (heavy) kit.part(S.barrel, P.metal, cannon, { pos: [-0.14, -0.2, 0.05], rot: [HALF_PI, 0, 0], scale: [0.7, 0.85, 0.7] });
  const muzzleGlow = kit.part('torus', P.orangeGlow, barrel, { pos: [0.05, -0.05, 1.07], rot: [HALF_PI, 0, 0], scale: [0.28, 0.28, 0.28] });

  // Left arm: shoulder pod, pauldron and a forward blade.
  const arm = kit.node('armL', torso, [-0.82, 0.05, 0.05]);
  kit.part(S.pod, P.enemyArmor, arm, { scale: [0.92, 0.92, 0.92] });
  kit.part(S.pauldron, P.enemyArmor, arm, { pos: [-0.04, 0.02, 0], rot: [0, 0, 0.35] });
  kit.part(S.blade, P.enemyArmor, arm, { pos: [-0.1, -0.08, 0.02], rot: [0.3, 0, 0.1] });
  kit.part('box', P.orangeDim, arm, { pos: [-0.17, -0.42, 0.3], scale: [0.02, 0.55, 0.04], rot: [0.3, 0, 0.1], shadow: false });

  if (heavy) {
    for (const side of [-1, 1]) {
      kit.part(S.heavyPlate, P.enemyArmor, torso, { pos: [side * 0.8, 0.42, 0], rot: [0, 0, side * -0.35] });
      kit.part('box', P.orangeGlow, torso, { pos: [side * 0.88, 0.5, 0.4], scale: [0.36, 0.04, 0.03], rot: [0, 0, side * -0.35], shadow: false });
    }
  }

  const legs: TransformNode[] = [];
  const knees: TransformNode[] = [];
  const ankles: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const thigh = kit.node('thigh', hips, [side * 0.42, -0.05, 0]);
    kit.part(S.thigh, P.enemyArmor, thigh, { rot: [-0.15, 0, 0] });
    kit.part(S.hub, P.enemyDark, thigh, { rot: [0, 0, HALF_PI] });
    kit.part('cyl8', P.metal, thigh, { pos: [side * 0.13, -0.36, 0.24], rot: [-0.15, 0, 0], scale: [0.06, 0.56, 0.06] });
    kit.part('cyl8', P.graphite, thigh, { pos: [side * 0.13, -0.2, 0.26], rot: [-0.15, 0, 0], scale: [0.1, 0.24, 0.1] });
    const knee = kit.node('knee', thigh, [0, -WALKER_THIGH, 0]);
    kit.part(S.hub, P.metal, knee, { rot: [0, 0, HALF_PI], scale: [0.72, 0.8, 0.72] });
    kit.part(S.shin, P.enemyDark, knee);
    kit.part('cyl', P.metal, knee, { pos: [side * 0.12, -0.28, -0.16], scale: [0.07, 0.4, 0.07] });
    const ankle = kit.node('ankle', knee, [0, -WALKER_SHIN, 0]);
    kit.part(S.foot, P.enemyDark, ankle, { pos: [0, -0.02, 0.02] });
    kit.part(S.footPlate, P.enemyArmor, ankle, { pos: [0, -0.02, 0.02] });
    for (const t of [-1, 0, 1]) kit.part('box', P.metal, ankle, { pos: [t * 0.11, -0.04, 0.5], rot: [0.25, t * 0.25, 0], scale: [0.06, 0.06, 0.16] });
    thigh.rotationQuaternion = Quaternion.Identity();
    knee.rotationQuaternion = Quaternion.Identity();
    ankle.rotationQuaternion = Quaternion.Identity();
    legs.push(thigh);
    knees.push(knee);
    ankles.push(ankle);
  }

  let shield: AbstractMesh | null = null;
  if (heavy) {
    shield = kit.part('sphere', P.shield, root, { pos: [0, 2.05, 0.1], scale: [3.6, 3.9, 3.6] });
  }

  return { root, hips, torso, head, thighL: legs[0], thighR: legs[1], kneeL: knees[0], kneeR: knees[1], ankleL: ankles[0], ankleR: ankles[1], cannon, barrel, muzzleGlow, shield };
}

export interface DroneRig {
  root: TransformNode;
  body: TransformNode;
  ring: AbstractMesh;
}

/** Rush drone: fast hovering kamikaze machine. Body center at local y=0. */
export function buildRusher(kit: Kit, P: Palette): DroneRig {
  const L = (name: string, secs: Section[], axis: LoftAxis = 'z', segs = 28) => kit.sculpt(name, () => loftData(secs, axis, segs));
  const hull = L('rHull', [
    { t: -0.62, w: 0.26, h: 0.2, n: 3 },
    { t: -0.45, w: 0.46, h: 0.32, v: 0.02, n: 4 },
    { t: 0.0, w: 0.52, h: 0.36, v: 0.03, n: 4 },
    { t: 0.38, w: 0.4, h: 0.26, v: -0.01, n: 3.5 },
    { t: 0.6, w: 0.2, h: 0.13, v: -0.03, n: 2.5 },
  ], 'z', 32);
  const carapace = L('rCarapace', [{ t: -0.5, w: 0.3, h: 0.05, v: 0.3 }, { t: -0.05, w: 0.42, h: 0.09, v: 0.36, n: 5 }, { t: 0.4, w: 0.26, h: 0.05, v: 0.24 }], 'z', 24);
  const mandible = L('rMandible', [{ t: 0.0, w: 0.05, h: 0.1 }, { t: 0.35, w: 0.045, h: 0.09, v: -0.02, n: 5 }, { t: 0.72, w: 0.012, h: 0.03, v: -0.06 }], 'z', 16);
  const fin = L('rFin', [{ t: 0, w: 0.22, h: 0.02, u: 0 }, { t: 0.22, w: 0.2, h: 0.03, u: 0.08, n: 5 }, { t: 0.5, w: 0.1, h: 0.015, u: 0.2 }], 'x', 16);
  const nozzle = kit.sculpt('rNozzle', () => smoothLatheData([[0.08, -0.22], [0.12, -0.18], [0.12, 0.08], [0.16, 0.16], [0.14, 0.2]], 16));
  const eye = kit.sculpt('rEye', () => smoothLatheData([[0.0, -0.06], [0.16, -0.04], [0.18, 0.02], [0.12, 0.07]], 20));

  const root = kit.node('rusher', null);
  const body = kit.node('rBody', root, [0, 1.3, 0]);
  kit.part(hull, P.enemyDark, body);
  kit.part(carapace, P.enemyArmor, body);
  kit.part(carapace, P.enemyArmor, body, { rot: [0, 0, Math.PI], scale: [0.8, 0.8, 0.8] });
  // Sensor eye in a ringed socket at the nose.
  kit.part(eye, P.orangeGlow, body, { pos: [0, -0.01, 0.6], rot: [Math.PI / 2, 0, 0], shadow: false });
  kit.part('torusThin', P.metal, body, { pos: [0, -0.01, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.42, 0.42] });
  for (const side of [-1, 1]) {
    kit.part(mandible, P.enemyArmor, body, { pos: [side * 0.34, -0.06, 0.2], rot: [0, -side * 0.3, 0] });
    kit.part('box', P.orangeDim, body, { pos: [side * 0.42, -0.04, 0.5], scale: [0.015, 0.035, 0.42], rot: [0, -side * 0.3, 0], shadow: false });
    kit.part(fin, P.enemyDark, body, { pos: [side * 0.42, 0.04, -0.2], rot: [0, 0, side * 0.3], scale: [side, 1, 1] });
    kit.part(nozzle, P.graphite, body, { pos: [side * 0.34, -0.1, -0.56], rot: [Math.PI / 2, 0, 0] });
    kit.part('cyl8', P.orangeGlow, body, { pos: [side * 0.34, -0.1, -0.77], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.02, 0.2], shadow: false });
  }
  kit.part('cyl8', P.metal, body, { pos: [0, 0.5, -0.1], rot: [-0.3, 0, 0], scale: [0.025, 0.32, 0.025] });
  for (let i = 0; i < 3; i++) kit.part('box', P.graphite, body, { pos: [0, -0.34, -0.12 + i * 0.13], scale: [0.36, 0.025, 0.045] });
  const ring = kit.part('torus', P.orangeGlow, body, { pos: [0, 0, -0.62], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.5, 0.5], shadow: false });
  return { root, body, ring };
}

export interface TurretRig {
  root: TransformNode;
  yaw: TransformNode;
  pitch: TransformNode;
  muzzles: TransformNode[];
  coreGlow: AbstractMesh;
}

/** Sentinel turret. `unique` builds a non-instanced copy with a single material (placement ghost). */
export function buildTurret(kit: Kit, P: Palette, unique?: Material): TurretRig {
  const root = kit.node('turret', null);
  const u = unique;
  kit.part('cyl6', P.graphite, root, { pos: [0, 0.18, 0], scale: [2.1, 0.36, 2.1] }, u);
  kit.part('cyl6', P.white, root, { pos: [0, 0.45, 0], scale: [1.7, 0.22, 1.7] }, u);
  kit.part('torus', P.cyanGlow, root, { pos: [0, 0.37, 0], scale: [1.95, 1.0, 1.95] }, u);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    kit.part('box', P.graphite, root, { pos: [Math.sin(a) * 0.95, 0.25, Math.cos(a) * 0.95], rot: [0, a, 0], scale: [0.3, 0.4, 0.7] }, u);
  }
  kit.part('cyl', P.metal, root, { pos: [0, 0.85, 0], scale: [0.5, 0.7, 0.5] }, u);

  const yaw = kit.node('tYaw', root, [0, 1.25, 0]);
  kit.part('box', P.white, yaw, { pos: [0, 0.12, -0.05], scale: [0.95, 0.55, 1.05] }, u);
  kit.part('box', P.graphite, yaw, { pos: [0, 0.42, -0.15], scale: [0.7, 0.1, 0.7] }, u);
  for (const side of [-1, 1]) kit.part('box', P.graphite, yaw, { pos: [side * 0.52, 0.1, -0.05], scale: [0.12, 0.42, 0.9] }, u);
  kit.part('box', P.cyanGlow, yaw, { pos: [0, 0.22, 0.48], scale: [0.6, 0.07, 0.04] }, u);
  const coreGlow = kit.part('cyl', P.cyanGlow, yaw, { pos: [0, 0.12, -0.6], rot: [Math.PI / 2, 0, 0], scale: [0.35, 0.12, 0.35] }, u);

  const pitch = kit.node('tPitch', yaw, [0, 0.1, 0.3]);
  const muzzles: TransformNode[] = [];
  for (const side of [-1, 1]) {
    kit.part('cyl', P.graphite, pitch, { pos: [side * 0.22, 0, 0.55], rot: [Math.PI / 2, 0, 0], scale: [0.16, 1.15, 0.16] }, u);
    kit.part('cyl', P.metal, pitch, { pos: [side * 0.22, 0, 0.25], rot: [Math.PI / 2, 0, 0], scale: [0.24, 0.4, 0.24] }, u);
    kit.part('torusThin', P.cyanGlow, pitch, { pos: [side * 0.22, 0, 1.12], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.2, 0.2] }, u);
    muzzles.push(kit.node('muzzle', pitch, [side * 0.22, 0, 1.2]));
  }
  return { root, yaw, pitch, muzzles, coreGlow };
}

export interface ReactorRig {
  root: TransformNode;
  coreMat: PBRMaterial;
  beamMat: PBRMaterial;
  /** Animate containment and plasma flow from the integrity and impact signals. */
  update(dt: number, integrity: number, hit: number): void;
}

/** Vertical plasma streaks (tileable) used to animate the reactor core and beam. */
function plasmaCanvas(): HTMLCanvasElement {
  const W = 128;
  const H = 256;
  const { c, ctx } = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = fbm(x / W, y / H, 4, 4, 77);
      const streak = fbm(x / W, (y / H) * 0.25, 12, 2, 13);
      const v = Math.min(1, 0.35 + Math.pow(n, 2) * 1.2 + Math.max(0, streak - 0.55) * 2.5);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

function beamFadeCanvas(): HTMLCanvasElement {
  const { c, ctx } = canvas(4, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.92, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return c;
}

/** Central energy reactor. Unique meshes; core material color communicates integrity. */
export function buildReactor(scene: Scene, P: Palette): ReactorRig {
  const root = new TransformNode('reactor', scene);
  const mk = <T extends AbstractMesh>(m: T, mat: Material, pickable = true): T => {
    m.material = mat;
    m.parent = root;
    m.isPickable = pickable;
    m.metadata = pickable ? { surface: 'reactor' } : null;
    return m;
  };
  const sculpted = (name: string, vd: ReturnType<typeof loftData>) => {
    const m = new Mesh(name, scene);
    vd.applyToMesh(m);
    return m;
  };
  // Stepped plinth with a soft machined profile.
  mk(sculpted('rBase', smoothLatheData([[4.9, 0], [4.9, 0.14], [4.78, 0.3], [4.66, 0.52], [4.3, 0.6], [3.95, 0.66], [3.88, 0.98], [3.62, 1.1], [1.7, 1.12], [1.4, 1.18]], 48)), P.graphite);
  mk(sculpted('rBase2', smoothLatheData([[3.8, 0], [3.8, 0.08], [3.7, 0.3], [3.3, 0.4], [3.25, 0.44]], 48)), P.white).position.y = 0.66;
  mk(MeshBuilder.CreateTorus('rBaseGlow', { diameter: 9.0, thickness: 0.1, tessellation: 64 }, scene), P.cyanGlow, false).position.y = 0.62;

  const plasmaSrc = plasmaCanvas();
  const plasma = toTexture('reactorPlasma', plasmaSrc, scene, { aniso: 2 });
  plasma.uScale = 2;
  const coreMat = unlit(scene, 'reactorCore', [0.3, 2.0, 2.4], { tex: plasma });
  const core = mk(MeshBuilder.CreateCylinder('rCore', { diameter: 2.0, height: 6.2, tessellation: 32 }, scene), coreMat);
  core.position.y = 4.2;
  // Glass containment shell: reflective, slightly tinted, see-through.
  const glass = new PBRMaterial('reactorGlass', scene);
  glass.albedoColor = new Color3(0.05, 0.12, 0.14);
  glass.metallic = 0;
  glass.roughness = 0.04;
  glass.alpha = 0.18;
  glass.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  glass.useRadianceOverAlpha = true;
  glass.useSpecularOverAlpha = true;
  glass.usePhysicalLightFalloff = false;
  glass.backFaceCulling = false;
  const shell = mk(MeshBuilder.CreateCylinder('rShell', { diameter: 2.9, height: 5.6, tessellation: 40 }, scene), glass, false);
  shell.position.y = 4.4;
  // Floor glow pool around the base.
  const flare = flareSprite(scene);
  const poolMat = unlit(scene, 'reactorPool', [0.1, 0.55, 0.65], { tex: flare, opacity: flare, additive: true, zOffset: -2 });
  const pool = mk(MeshBuilder.CreateDisc('rPool', { radius: 13, tessellation: 48 }, scene), poolMat, false);
  pool.rotation.x = Math.PI / 2;
  pool.position.y = 0.04;
  const sleeve = mk(sculpted('rSleeve', smoothLatheData([[1.32, 0], [1.42, 0.1], [1.42, 0.55], [1.5, 0.62], [1.5, 0.82], [1.36, 0.95]], 40)), P.graphite);
  sleeve.position.y = 1.1;
  const cap = mk(sculpted('rCap', smoothLatheData([[1.4, 0], [1.42, 0.12], [1.3, 0.3], [1.02, 0.52], [0.72, 0.7], [0.48, 0.8], [0.34, 0.84]], 40)), P.white);
  cap.position.y = 7.15;

  // Four arched pylons
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pyl = new TransformNode('pylon', scene);
    pyl.parent = root;
    pyl.rotation.y = a;
    // Curved buttress: thick at the plinth, leaning in and thinning toward the crown.
    const p1 = mk(sculpted('py1', loftData([
      { t: 0.6, w: 0.42, h: 0.62, v: 3.55, n: 5 },
      { t: 2.0, w: 0.36, h: 0.5, v: 3.38, n: 5 },
      { t: 4.0, w: 0.3, h: 0.42, v: 3.02, n: 5 },
      { t: 5.6, w: 0.28, h: 0.38, v: 2.5, n: 5 },
      { t: 6.45, w: 0.3, h: 0.36, v: 1.95, n: 4 },
    ], 'y', 28)), P.white);
    p1.parent = pyl;
    const p2 = mk(sculpted('py2', loftData([{ t: 2.5, w: 0.24, h: 0.22, v: 6.3 }, { t: 2.3, w: 0.28, h: 0.26, v: 6.3, n: 5 }, { t: 1.3, w: 0.24, h: 0.22, v: 6.25, n: 5 }, { t: 1.15, w: 0.18, h: 0.16, v: 6.25 }], 'z', 20)), P.graphite);
    p2.parent = pyl;
    const strip = mk(MeshBuilder.CreateBox('pyS', { width: 0.1, height: 3.8, depth: 0.04 }, scene), P.cyanGlow, false);
    strip.parent = pyl;
    strip.position.set(0, 3.2, 2.84);
    strip.rotation.x = -0.15;
  }

  const coilLight = unlit(scene, 'reactorCoilLight', [0.28, 2.0, 2.5], { twoSided: true });
  const coils: { node: TransformNode; restHeight: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const diameter = 3.4 + i * 0.7;
    const r = mk(MeshBuilder.CreateTorus('rRing', { diameter, thickness: 0.14, tessellation: 48 }, scene), i === 1 ? P.white : P.metal, false);
    const restHeight = 2.78 + i * 1.63;
    r.position.y = restHeight;
    r.rotation.y = i * Math.PI / 3;
    const arcs = segmentedRing(scene, 'reactorCoilArcs', diameter / 2 + 0.19, 0.14, i === 1 ? 4 : 3, 0.45);
    arcs.material = coilLight;
    arcs.parent = r;
    arcs.position.y = 0.02;
    coils.push({ node: r, restHeight });
  }

  // Chasing rings tell the player where the power conduits converge.
  const baseSweep = mk(segmentedRing(scene, 'reactorBaseSweep', 4.91, 0.17, 10, 0.52), coilLight, false);
  baseSweep.position.y = 0.055;
  const perimeterSweep = mk(segmentedRing(scene, 'reactorPerimeterSweep', 7.21, 0.10, 7, 0.51), coilLight, false);
  perimeterSweep.position.y = 0.055;

  const fade = toTexture('beamFade', beamFadeCanvas(), scene, { aniso: 1 });
  fade.wrapV = 0; // clamp
  const beamMat = unlit(scene, 'reactorBeam', [0.15, 0.9, 1.1], { tex: toTexture('beamPlasma', plasmaSrc, scene, { aniso: 2 }), opacity: fade, additive: true, twoSided: true });
  beamMat.alpha = 0.35;
  const beam = mk(MeshBuilder.CreateCylinder('rBeam', { diameterTop: 0.5, diameterBottom: 1.2, height: 60, tessellation: 24, cap: 0 }, scene), beamMat, false);
  beam.position.y = 38;
  beam.applyFog = false;
  const beamCore = mk(MeshBuilder.CreateCylinder('rBeamCore', { diameterTop: 0.12, diameterBottom: 0.35, height: 60, tessellation: 12, cap: 0 }, scene), beamMat, false);
  beamCore.position.y = 38;
  beamCore.applyFog = false;

  const coreTex = coreMat.emissiveTexture as unknown as { vOffset: number };
  const beamTex = beamMat.emissiveTexture as unknown as typeof coreTex;
  let t = 0;
  return {
    root,
    coreMat,
    beamMat,
    update(dt: number, integrity: number, hit: number) {
      t += dt;
      coreTex.vOffset = (coreTex.vOffset - dt * (0.25 + 0.35 * integrity)) % 1;
      beamTex.vOffset = (beamTex.vOffset - dt * 0.8) % 1;
      poolMat.emissiveColor.copyFrom(coreMat.emissiveColor).scaleInPlace(0.22 + 0.055 * Math.sin(t * 2));
      coilLight.emissiveColor.copyFrom(coreMat.emissiveColor).scaleInPlace(0.88 + 0.14 * Math.sin(t * 2) + hit * 0.27);
      baseSweep.rotation.y += dt * 0.67;
      perimeterSweep.rotation.y -= dt * 0.24;

      for (let i = 0; i < coils.length; i++) {
        const { node, restHeight } = coils[i];
        const phase = t * (1.2 + (1 - integrity) * 0.8) + i * 1.9;
        node.rotation.y += dt * (0.45 + i * 0.25) * (i % 2 ? -1 : 1);
        node.rotation.x = Math.sin(phase) * (0.088 + hit * 0.041);
        node.rotation.z = Math.cos(phase * 0.78) * 0.064;
        node.position.y = restHeight + Math.sin(phase) * 0.09;
      }
    },
  };
}
