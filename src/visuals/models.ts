import {
  type AbstractMesh,
  type Material,
  Color3,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  TransformNode,
} from '@babylonjs/core';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';
import { createBeveledBox } from './bevel';
import { canvas, fbm, flareSprite, toTexture } from './textures';
import { segmentedRing } from './rings';

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
  mk(MeshBuilder.CreateCylinder('rBase', { diameter: 9.5, height: 0.6, tessellation: 8 }, scene), P.graphite).position.y = 0.3;
  mk(MeshBuilder.CreateCylinder('rBase2', { diameter: 7.6, height: 0.5, tessellation: 8 }, scene), P.white).position.y = 0.85;
  mk(MeshBuilder.CreateTorus('rBaseGlow', { diameter: 8.6, thickness: 0.1, tessellation: 8 }, scene), P.cyanGlow, false).position.y = 0.62;

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
    const p1 = mk(createBeveledBox('py1', 0.6, 5.5, 0.9, 0.06, scene), P.white);
    p1.parent = pyl;
    p1.position.set(0, 3.4, 3.1);
    p1.rotation.x = -0.18;
    const p2 = mk(createBeveledBox('py2', 0.5, 0.5, 2.4, 0.05, scene), P.graphite);
    p2.parent = pyl;
    p2.position.set(0, 6.3, 2.0);
    const strip = mk(MeshBuilder.CreateBox('pyS', { width: 0.12, height: 4.5, depth: 0.05 }, scene), P.cyanGlow, false);
    strip.parent = pyl;
    strip.position.set(0, 3.3, 2.62);
    strip.rotation.x = -0.18;
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
