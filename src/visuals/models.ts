import {
  type AbstractMesh,
  Color3,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
} from '@babylonjs/core';
import type { Kit } from './kit';
import type { Palette } from './materials';

export interface WalkerRig {
  root: TransformNode;
  hips: TransformNode;
  torso: TransformNode;
  head: TransformNode;
  thighL: TransformNode;
  thighR: TransformNode;
  kneeL: TransformNode;
  kneeR: TransformNode;
  cannon: TransformNode;
  muzzleGlow: AbstractMesh;
  shield: AbstractMesh | null;
}

/** Strider walker (and the heavier Bulwark variant). Root sits on the ground, faces +Z. */
export function buildWalker(kit: Kit, P: Palette, heavy: boolean): WalkerRig {
  const root = kit.node('walker', null);
  const scaleRoot = kit.node('wScale', root);
  const s = heavy ? 1.32 : 1;
  scaleRoot.scaling.setAll(s);

  const hips = kit.node('hips', scaleRoot, [0, 1.35, 0]);
  kit.part('box', P.enemyDark, hips, { scale: [0.9, 0.34, 0.62] });
  kit.part('cyl8', P.metal, hips, { rot: [0, 0, Math.PI / 2], scale: [0.3, 1.0, 0.3] });

  const torso = kit.node('torso', hips, [0, 0.58, 0]);
  kit.part('box', P.enemyArmor, torso, { scale: [1.25, 0.82, 0.88], rot: [0.08, 0, 0] });
  kit.part('box', P.enemyArmor, torso, { pos: [0, 0.08, 0.46], scale: [0.86, 0.56, 0.16], rot: [-0.18, 0, 0] });
  kit.part('box', P.enemyDark, torso, { pos: [0, -0.2, 0.5], scale: [0.5, 0.16, 0.1] });
  kit.part('box', P.enemyDark, torso, { pos: [0, 0.05, -0.56], scale: [0.85, 0.66, 0.36] });
  kit.part('box', P.orangeGlow, torso, { pos: [-0.2, 0.08, -0.75], scale: [0.1, 0.4, 0.04] });
  kit.part('box', P.orangeGlow, torso, { pos: [0.2, 0.08, -0.75], scale: [0.1, 0.4, 0.04] });
  kit.part('box', P.enemyDark, torso, { pos: [0, 0.5, -0.3], scale: [0.08, 0.5, 0.5], rot: [-0.5, 0, 0] });

  const head = kit.node('head', torso, [0, 0.62, 0.12]);
  kit.part('box', P.enemyDark, head, { scale: [0.56, 0.36, 0.62] });
  kit.part('box', P.enemyArmor, head, { pos: [0, 0.2, -0.05], scale: [0.5, 0.08, 0.56] });
  kit.part('box', P.orangeGlow, head, { pos: [0, 0.0, 0.31], scale: [0.44, 0.11, 0.05] });
  kit.part('cyl8', P.metal, head, { pos: [0.22, 0.32, -0.15], scale: [0.04, 0.35, 0.04] });

  // Right arm: plasma cannon
  const cannon = kit.node('cannon', torso, [0.82, 0.05, 0.1]);
  kit.part('sphere', P.enemyArmor, cannon, { scale: [0.5, 0.5, 0.5] });
  kit.part('cyl', P.enemyDark, cannon, { pos: [0.05, -0.05, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.26, 1.0, 0.26] });
  kit.part('box', P.enemyArmor, cannon, { pos: [0.08, 0.08, 0.3], scale: [0.18, 0.12, 0.7] });
  if (heavy) kit.part('cyl', P.enemyDark, cannon, { pos: [-0.12, -0.18, 0.45], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.9, 0.2] });
  const muzzleGlow = kit.part('torus', P.orangeGlow, cannon, { pos: [0.05, -0.05, 1.0], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.3, 0.3] });

  // Left arm: armored blade plate
  const arm = kit.node('armL', torso, [-0.82, 0.05, 0.05]);
  kit.part('sphere', P.enemyArmor, arm, { scale: [0.46, 0.46, 0.46] });
  kit.part('box', P.enemyArmor, arm, { pos: [-0.1, -0.35, 0.25], scale: [0.14, 0.75, 0.6], rot: [0.3, 0, 0.1] });
  kit.part('box', P.orangeDim, arm, { pos: [-0.18, -0.35, 0.25], scale: [0.02, 0.6, 0.06], rot: [0.3, 0, 0.1] });

  if (heavy) {
    for (const side of [-1, 1]) {
      kit.part('box', P.enemyArmor, torso, { pos: [side * 0.82, 0.42, 0.0], scale: [0.6, 0.18, 0.8], rot: [0, 0, side * -0.35] });
      kit.part('box', P.orangeGlow, torso, { pos: [side * 0.9, 0.52, 0.42], scale: [0.4, 0.05, 0.04], rot: [0, 0, side * -0.35] });
    }
  }

  const legs: TransformNode[] = [];
  const knees: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const thigh = kit.node('thigh', hips, [side * 0.42, -0.05, 0]);
    kit.part('box', P.enemyArmor, thigh, { pos: [0, -0.36, 0.05], scale: [0.3, 0.78, 0.36], rot: [-0.15, 0, 0] });
    kit.part('sphere', P.enemyDark, thigh, { scale: [0.34, 0.34, 0.34] });
    const knee = kit.node('knee', thigh, [0, -0.72, 0.12]);
    kit.part('sphere', P.metal, knee, { scale: [0.24, 0.24, 0.24] });
    kit.part('box', P.enemyDark, knee, { pos: [0, -0.32, -0.12], scale: [0.22, 0.7, 0.24], rot: [0.35, 0, 0] });
    kit.part('box', P.enemyArmor, knee, { pos: [0, -0.62, 0.0], scale: [0.36, 0.1, 0.62] });
    legs.push(thigh);
    knees.push(knee);
  }

  let shield: AbstractMesh | null = null;
  if (heavy) {
    shield = kit.part('sphere', P.shield, root, { pos: [0, 2.05, 0.1], scale: [3.6, 3.9, 3.6] });
  }

  return { root, hips, torso, head, thighL: legs[0], thighR: legs[1], kneeL: knees[0], kneeR: knees[1], cannon, muzzleGlow, shield };
}

export interface DroneRig {
  root: TransformNode;
  body: TransformNode;
  ring: AbstractMesh;
}

/** Rush drone: fast hovering kamikaze machine. Body center at local y=0. */
export function buildRusher(kit: Kit, P: Palette): DroneRig {
  const root = kit.node('rusher', null);
  const body = kit.node('rBody', root, [0, 1.3, 0]);
  kit.part('ico', P.enemyDark, body, { scale: [1.0, 0.82, 1.15] });
  kit.part('box', P.enemyArmor, body, { pos: [0, 0.32, 0.05], scale: [0.7, 0.14, 0.9], rot: [0.12, 0, 0] });
  kit.part('box', P.enemyArmor, body, { pos: [0, -0.3, 0.1], scale: [0.55, 0.1, 0.7], rot: [-0.12, 0, 0] });
  kit.part('sphere', P.orangeGlow, body, { pos: [0, 0, 0.5], scale: [0.36, 0.36, 0.2] });
  kit.part('torusThin', P.enemyArmor, body, { pos: [0, 0, 0.53], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.5, 0.5] });
  for (const side of [-1, 1]) {
    // forward mandible blades
    kit.part('box', P.enemyArmor, body, { pos: [side * 0.38, -0.05, 0.55], scale: [0.08, 0.16, 0.7], rot: [0, -side * 0.35, 0] });
    kit.part('box', P.orangeDim, body, { pos: [side * 0.42, -0.05, 0.62], scale: [0.02, 0.05, 0.6], rot: [0, -side * 0.35, 0] });
    // side fins
    kit.part('box', P.enemyDark, body, { pos: [side * 0.55, 0.05, -0.25], scale: [0.5, 0.05, 0.4], rot: [0, 0, side * 0.3] });
  }
  kit.part('box', P.enemyDark, body, { pos: [0, 0.45, -0.3], scale: [0.05, 0.35, 0.45], rot: [-0.3, 0, 0] });
  const ring = kit.part('torus', P.orangeGlow, body, { pos: [0, 0, -0.5], rot: [Math.PI / 2, 0, 0], scale: [0.62, 0.62, 0.62] });
  kit.part('cyl', P.metal, body, { pos: [0, 0, -0.45], rot: [Math.PI / 2, 0, 0], scale: [0.4, 0.2, 0.4] });
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
export function buildTurret(kit: Kit, P: Palette, unique?: StandardMaterial): TurretRig {
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
  rings: TransformNode[];
  coreMat: StandardMaterial;
  beamMat: StandardMaterial;
}

/** Central energy reactor. Unique meshes; core material color communicates integrity. */
export function buildReactor(scene: Scene, P: Palette): ReactorRig {
  const root = new TransformNode('reactor', scene);
  const mk = <T extends AbstractMesh>(m: T, mat: StandardMaterial, pickable = true): T => {
    m.material = mat;
    m.parent = root;
    m.isPickable = pickable;
    m.metadata = pickable ? { surface: 'reactor' } : null;
    return m;
  };
  mk(MeshBuilder.CreateCylinder('rBase', { diameter: 9.5, height: 0.6, tessellation: 8 }, scene), P.graphite).position.y = 0.3;
  mk(MeshBuilder.CreateCylinder('rBase2', { diameter: 7.6, height: 0.5, tessellation: 8 }, scene), P.white).position.y = 0.85;
  mk(MeshBuilder.CreateTorus('rBaseGlow', { diameter: 8.6, thickness: 0.1, tessellation: 8 }, scene), P.cyanGlow, false).position.y = 0.62;

  const coreMat = new StandardMaterial('reactorCore', scene);
  coreMat.diffuseColor = Color3.Black();
  coreMat.specularColor = Color3.Black();
  coreMat.emissiveColor = new Color3(0.3, 2.0, 2.4);
  coreMat.disableLighting = true;
  const core = mk(MeshBuilder.CreateCylinder('rCore', { diameter: 2.0, height: 6.2, tessellation: 24 }, scene), coreMat);
  core.position.y = 4.2;
  const sleeve = mk(MeshBuilder.CreateCylinder('rSleeve', { diameter: 2.5, height: 1.0, tessellation: 24 }, scene), P.graphite);
  sleeve.position.y = 1.6;
  const cap = mk(MeshBuilder.CreateCylinder('rCap', { diameterBottom: 2.6, diameterTop: 1.4, height: 0.8, tessellation: 24 }, scene), P.white);
  cap.position.y = 7.6;

  // Four arched pylons
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pyl = new TransformNode('pylon', scene);
    pyl.parent = root;
    pyl.rotation.y = a;
    const p1 = mk(MeshBuilder.CreateBox('py1', { width: 0.6, height: 5.5, depth: 0.9 }, scene), P.white);
    p1.parent = pyl;
    p1.position.set(0, 3.4, 3.1);
    p1.rotation.x = -0.18;
    const p2 = mk(MeshBuilder.CreateBox('py2', { width: 0.5, height: 0.5, depth: 2.4 }, scene), P.graphite);
    p2.parent = pyl;
    p2.position.set(0, 6.3, 2.0);
    const strip = mk(MeshBuilder.CreateBox('pyS', { width: 0.12, height: 4.5, depth: 0.05 }, scene), P.cyanGlow, false);
    strip.parent = pyl;
    strip.position.set(0, 3.3, 2.62);
    strip.rotation.x = -0.18;
  }

  const rings: TransformNode[] = [];
  for (let i = 0; i < 3; i++) {
    const r = mk(MeshBuilder.CreateTorus('rRing', { diameter: 3.4 + i * 0.7, thickness: 0.14, tessellation: 48 }, scene), i === 1 ? P.white : P.metal, false);
    r.position.y = 3 + i * 1.6;
    rings.push(r);
  }

  const beamMat = new StandardMaterial('reactorBeam', scene);
  beamMat.diffuseColor = Color3.Black();
  beamMat.specularColor = Color3.Black();
  beamMat.emissiveColor = new Color3(0.15, 0.9, 1.1);
  beamMat.alpha = 0.35;
  beamMat.disableLighting = true;
  const beam = mk(MeshBuilder.CreateCylinder('rBeam', { diameterTop: 0.3, diameterBottom: 0.9, height: 30, tessellation: 16 }, scene), beamMat, false);
  beam.position.y = 23;
  return { root, rings, coreMat, beamMat };
}
