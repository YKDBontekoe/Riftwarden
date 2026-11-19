import { type AbstractMesh, Color3, PBRMaterial, type Scene, type TransformNode } from '@babylonjs/core';
import { latheData } from '../weapons/geometry';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';
import { loftData, smoothLatheData } from './sculpt';
import { canvas, toTexture } from './textures';

/**
 * M6 enemy rigs. Built from the instanced kit (one template per shape x material), so pooled enemies cost
 * draw calls per part type, not per enemy. Each rig exposes the nodes its behaviour animates.
 * Visual language: rust/graphite hostile chassis (shared with the Strider), with a role colour:
 *   enforcer = orange energy shield + amber generator, artillery = red charge rings and targeting optics,
 *   engineer = teal support glow, courier = gold vault plating.
 */
export interface EnemyMats {
  support: PBRMaterial;
  supportDim: PBRMaterial;
  amber: PBRMaterial;
  blue: PBRMaterial;
  red: PBRMaterial;
  flame: PBRMaterial;
  gold: PBRMaterial;
  goldDark: PBRMaterial;
  chargeRed: PBRMaterial;
  violet: PBRMaterial;
  violetDim: PBRMaterial;
  plate: PBRMaterial;
  bossCore: PBRMaterial;
  /** Additive energy-wall material (enforcer shield, overseer barriers). */
  energyWall: PBRMaterial;
  energyWallViolet: PBRMaterial;
  /** Boss hull materials: heavier, darker and rougher than regular machines (silhouette + menace). */
  bossArmor: PBRMaterial;
  bossDark: PBRMaterial;
  /** Additive lattice barrier shell (see-through, reads as an energy dome). */
  bossShield: PBRMaterial;
}

/** Scanline energy panel: bright rims, hex-ish cells, transparent (black) body for additive blending. */
function wallTexture(scene: Scene) {
  const W = 128;
  const H = 128;
  const { c, ctx } = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = y / (H - 1);
      const rim = Math.max(Math.pow(1 - Math.min(v, 1 - v) * 2, 10), 0);
      const cell = ((Math.floor(x / 16) + Math.floor(y / 14)) % 2) * 0.06;
      const edge = (x % 16 < 1 || y % 14 < 1) ? 0.32 : 0;
      const scan = (y % 4 === 0 ? 0.08 : 0) + 0.12;
      const k = Math.min(1, rim * 0.9 + cell + edge + scan);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture('energyWall', c, scene, { aniso: 2 });
}

const cache = new WeakMap<Scene, EnemyMats>();

function metal(scene: Scene, name: string, albedo: [number, number, number], metallic: number, roughness: number, P: Palette): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = new Color3(...albedo);
  m.metallic = metallic;
  m.roughness = roughness;
  m.maxSimultaneousLights = 8;
  m.usePhysicalLightFalloff = false;
  m.bumpTexture = P.wear.normal;
  m.metallicTexture = P.wear.orm;
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.environmentIntensity = 1.45;
  return m;
}

export function enemyMats(scene: Scene, P: Palette): EnemyMats {
  let m = cache.get(scene);
  if (m) return m;
  m = {
    support: unlit(scene, 'supportGlow', [0.25, 2.6, 1.35]),
    supportDim: unlit(scene, 'supportDim', [0.04, 0.55, 0.3]),
    amber: unlit(scene, 'amberGlow', [3.0, 1.75, 0.22]),
    blue: unlit(scene, 'eliteBlue', [0.55, 1.5, 3.8]),
    red: unlit(scene, 'eliteRed', [3.6, 0.32, 0.14]),
    flame: unlit(scene, 'eliteFlame', [3.4, 2.0, 0.7], { additive: true }),
    gold: metal(scene, 'courierGold', [0.92, 0.66, 0.26], 1, 0.26, P),
    goldDark: metal(scene, 'courierGoldDark', [0.32, 0.22, 0.1], 0.9, 0.4, P),
    chargeRed: unlit(scene, 'chargeRed', [3.4, 0.5, 0.1]),
    violet: unlit(scene, 'bossViolet', [1.7, 0.5, 3.6]),
    violetDim: unlit(scene, 'bossVioletDim', [0.35, 0.1, 0.75]),
    plate: metal(scene, 'elitePlate', [0.62, 0.64, 0.66], 0.95, 0.3, P),
    bossCore: unlit(scene, 'bossCore', [3.6, 1.1, 0.25]),
    energyWall: unlit(scene, 'energyWall', [3.4, 1.15, 0.2], { additive: true, twoSided: true }),
    energyWallViolet: unlit(scene, 'energyWallViolet', [1.2, 0.45, 2.6], { additive: true, twoSided: true }),
    bossArmor: metal(scene, 'bossArmor', [0.36, 0.12, 0.06], 0.3, 0.72, P),
    bossDark: metal(scene, 'bossDark', [0.045, 0.045, 0.05], 0.45, 0.62, P),
    bossShield: unlit(scene, 'bossShield', [0.55, 0.24, 1.3], { additive: true }),
  };
  const tex = wallTexture(scene);
  m.energyWall.emissiveTexture = tex;
  m.bossShield.emissiveTexture = tex;
  m.energyWallViolet.emissiveTexture = tex;
  m.bossArmor.environmentIntensity = 0.85;
  m.bossDark.environmentIntensity = 0.7;
  cache.set(scene, m);
  return m;
}

/** A reflector with a recessed face and a folded metal lip. Local +Y faces the feed. */
function reflector(kit: Kit) {
  return kit.sculpt('hostileReflector', () => latheData([
    [0.022, -0.13], [0.18, -0.115], [0.36, -0.058], [0.48, 0.029],
    [0.49, 0.058], [0.465, 0.065], [0.35, -0.018], [0.17, -0.077], [0.022, -0.092], [0.022, -0.13],
  ], 24));
}

// ------------------------------------------------------------------ Shielded Enforcer

export interface EnforcerRig {
  root: TransformNode;
  hull: TransformNode;
  wheels: TransformNode[];
  shieldArm: TransformNode;
  shield: AbstractMesh;
  shieldFrame: TransformNode;
  hammer: TransformNode;
  generator: TransformNode;
  vent: AbstractMesh;
  sensor: AbstractMesh;
}

/** Tracked heavy chassis, curved frontal energy shield on the left arm, piston hammer on the right, generator pack on the back. */
export function buildEnforcer(kit: Kit, P: Palette): EnforcerRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('enforcer', null);
  const s = kit.node('eScale', root);
  s.scaling.setAll(1.2);
  const casemate = kit.sculpt('enforcerCasemate', () => loftData([
    { t: -0.81, w: 0.63, h: 0.28, n: 5 },
    { t: -0.54, w: 0.88, h: 0.43, v: 0.06, n: 6 },
    { t: 0.36, w: 0.87, h: 0.42, v: 0.07, n: 6 },
    { t: 0.82, w: 0.67, h: 0.29, v: -0.03, n: 6 },
  ], 'z', 20));
  const trackBelt = kit.sculpt('enforcerBelt', () => loftData([
    { t: -0.25, w: 0.94, h: 0.29, n: 3 },
    { t: -0.19, w: 1.08, h: 0.38, n: 3.5 },
    { t: 0.19, w: 1.08, h: 0.38, n: 3.5 },
    { t: 0.25, w: 0.94, h: 0.29, n: 3 },
  ], 'x', 20));
  // Track units
  const wheels: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const track = kit.node('track', s, [side * 0.78, 0.42, 0]);
    kit.part(trackBelt, P.enemyDark, track);
    kit.part('box', P.graphite, track, { pos: [side * 0.05, 0.38, 0], scale: [0.5, 0.08, 1.9] });
    kit.part('box', P.enemyArmor, track, { pos: [side * 0.22, 0.21, 0], scale: [0.12, 0.26, 1.7] });
    kit.part('box', P.orangeDim, track, { pos: [side * 0.27, 0.12, 0.2], scale: [0.02, 0.06, 1.0], shadow: false });
    for (const z of [-0.75, 0, 0.75]) {
      const w = kit.node('wheel', track, [side * -0.05, -0.12, z]);
      kit.part('cyl8', P.metal, w, { rot: [0, 0, Math.PI / 2], scale: [0.39, 0.62, 0.39] });
      kit.part('cyl6', P.graphite, w, { pos: [side * 0.32, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.23, 0.065, 0.23] });
      kit.part('box', P.enemyArmor, w, { pos: [side * 0.36, 0, 0], scale: [0.03, 0.075, 0.21] });
      wheels.push(w);
    }
  }
  const hull = kit.node('hull', s, [0, 1.25, 0]);
  kit.part('box', P.enemyDark, hull, { pos: [0, -0.15, 0], scale: [1.5, 0.45, 1.6] });
  kit.part(casemate, P.enemyArmor, hull, { pos: [0, 0.38, 0] });
  kit.part('box', P.graphite, hull, { pos: [0, 0.88, 0.02], scale: [1.2, 0.18, 1.1] });
  // Sensor head sunk between the shoulders
  kit.part('box', P.enemyDark, hull, { pos: [0, 0.95, 0.45], scale: [0.62, 0.32, 0.45] });
  kit.part('box', P.enemyArmor, hull, { pos: [0, 1.12, 0.49], scale: [0.76, 0.095, 0.48] });
  const sensor = kit.part('box', P.orangeGlow, hull, { pos: [0, 0.97, 0.69], scale: [0.48, 0.07, 0.03], shadow: false });
  // Chest vent: glows when the shield drops (exposed component)
  const vent = kit.part('box', P.orangeDim, hull, { pos: [0, 0.2, 0.89], scale: [0.7, 0.26, 0.04], shadow: false });
  for (let i = 0; i < 3; i++) kit.part('box', P.graphite, hull, { pos: [0, 0.1 + i * 0.1, 0.9], scale: [0.74, 0.03, 0.05] });
  // Generator pack (rear weakpoint)
  const generator = kit.node('generator', hull, [0, 0.55, -0.82]);
  kit.part('box', P.graphite, generator, { scale: [0.9, 0.9, 0.45] });
  kit.part('cyl', P.metal, generator, { pos: [0, 0, -0.22], rot: [Math.PI / 2, 0, 0], scale: [0.6, 0.16, 0.6] });
  kit.part('sphere', M.amber, generator, { pos: [0, 0, -0.33], scale: [0.38, 0.38, 0.2], shadow: false });
  kit.part('torus', P.metal, generator, { pos: [0, 0, -0.32], rot: [Math.PI / 2, 0, 0], scale: [0.55, 0.55, 0.55] });
  for (const side of [-1, 1]) kit.part('cyl8', P.metal, generator, { pos: [side * 0.32, 0.5, 0], scale: [0.08, 0.5, 0.08] });
  // Shield arm (left) with emitter + curved energy wall
  const shieldArm = kit.node('shieldArm', hull, [-1.05, 0.45, 0.15]);
  kit.part('sphere', P.enemyArmor, shieldArm, { scale: [0.55, 0.55, 0.55] });
  kit.part('box', P.enemyDark, shieldArm, { pos: [-0.05, -0.2, 0.35], scale: [0.32, 0.36, 0.8] });
  const shieldFrame = kit.node('shieldFrame', shieldArm, [0.6, -0.05, 0.95]);
  kit.part('box', P.graphite, shieldFrame, { scale: [1.8, 0.14, 0.18] });
  kit.part('box', P.graphite, shieldFrame, { pos: [0, -0.9, 0], scale: [1.4, 0.1, 0.14] });
  for (const x of [-0.8, 0.8]) kit.part('cyl8', P.metal, shieldFrame, { pos: [x, -0.4, 0], scale: [0.14, 1.0, 0.14] });
  kit.part('box', P.orangeGlow, shieldFrame, { pos: [0, 0.09, 0.08], scale: [1.4, 0.04, 0.03], shadow: false });
  const shield = kit.part('arc', M.energyWall, shieldArm, { pos: [1.05, 0.15, -0.55], scale: [3.2, 2.5, 3.2], shadow: false });
  // Hammer arm (right)
  const hammer = kit.node('hammerArm', hull, [1.05, 0.55, 0.05]);
  kit.part('sphere', P.enemyArmor, hammer, { scale: [0.6, 0.6, 0.6] });
  kit.part('box', P.enemyDark, hammer, { pos: [0.08, -0.45, 0.15], scale: [0.36, 0.8, 0.4] });
  kit.part('cyl', P.metal, hammer, { pos: [0.08, -0.6, 0.38], scale: [0.14, 0.7, 0.14] });
  kit.part('box', P.enemyArmor, hammer, { pos: [0.08, -1.05, 0.25], scale: [0.62, 0.48, 0.66] });
  kit.part('box', P.graphite, hammer, { pos: [0.08, -1.32, 0.25], scale: [0.7, 0.1, 0.72] });
  for (const x of [-0.19, 0.35]) kit.part('cyl6', P.metal, hammer, { pos: [x, -1.29, 0.74], rot: [Math.PI / 2, 0, 0], scale: [0.095, 0.10, 0.095] });
  kit.part('box', P.orangeDim, hammer, { pos: [0.08, -1.05, 0.59], scale: [0.4, 0.06, 0.02], shadow: false });
  return { root, hull, wheels, shieldArm, shield, shieldFrame, hammer, generator, vent, sensor };
}

// ------------------------------------------------------------------ Artillery Drone

export interface ArtilleryRig {
  root: TransformNode;
  body: TransformNode;
  turret: TransformNode;
  cannon: TransformNode;
  muzzle: TransformNode;
  rings: AbstractMesh[];
  stabilizers: TransformNode[];
  optic: AbstractMesh;
}

/** Hover mortar: hex deck on three stabilizer pods, turret with a long cannon and charge rings. */
export function buildArtillery(kit: Kit, P: Palette): ArtilleryRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('artillery', null);
  const body = kit.node('aBody', root, [0, 3.0, 0]);
  const deck = kit.sculpt('mortarDeck', () => smoothLatheData([[0.68, -0.24], [1.02, -0.17], [1.16, -0.04], [1.16, 0.08], [0.93, 0.3], [0.65, 0.33]], 24));
  const brake = kit.sculpt('mortarBrake', () => latheData([[0.16, -0.17], [0.25, -0.13], [0.25, 0.07], [0.3, 0.13], [0.3, 0.23], [0.245, 0.25], [0.17, 0.23], [0.153, -0.17], [0.16, -0.17]], 16));
  kit.part(deck, P.enemyArmor, body);
  kit.part('cyl6', P.graphite, body, { pos: [0, -0.26, 0], scale: [1.4, 0.22, 1.4] });
  kit.part('torusThin', P.orangeDim, body, { pos: [0, 0.02, 0], scale: [2.32, 2.32, 2.32], shadow: false });
  const stabilizers: TransformNode[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    const st = kit.node('stab', body, [Math.sin(a) * 1.25, -0.1, Math.cos(a) * 1.25]);
    st.rotation.y = a;
    kit.part('box', P.graphite, st, { pos: [0, 0, 0.12], scale: [0.31, 0.21, 1.25] });
    kit.part('box', P.enemyArmor, st, { pos: [0, -0.06, 0.51], rot: [0.35, 0, 0], scale: [0.52, 0.22, 0.57] });
    kit.part('cyl6', P.metal, st, { pos: [0, 0.1, 0.24], scale: [0.23, 0.1, 0.23] });
    kit.part('cyl', P.enemyDark, st, { pos: [0, -0.25, 0.65], scale: [0.42, 0.5, 0.42] });
    kit.part('cyl', P.metal, st, { pos: [0, -0.52, 0.65], scale: [0.3, 0.08, 0.3] });
    kit.part('torus', P.orangeGlow, st, { pos: [0, -0.56, 0.65], scale: [0.3, 0.3, 0.3], shadow: false });
    kit.part('cone', M.flame, st, { pos: [0, -0.95, 0.65], rot: [Math.PI, 0, 0], scale: [0.26, 0.7, 0.26], shadow: false });
    stabilizers.push(st);
  }
  // Optic dome (weakpoint, front-low)
  kit.part('sphere', P.graphite, body, { pos: [0, -0.2, 0.78], scale: [0.6, 0.48, 0.6] });
  const optic = kit.part('sphere', M.chargeRed, body, { pos: [0, -0.22, 1.02], scale: [0.3, 0.22, 0.14], shadow: false });
  const turret = kit.node('aTurret', body, [0, 0.42, -0.1]);
  kit.part('box', P.enemyArmor, turret, { scale: [1.0, 0.42, 1.2] });
  kit.part('box', P.graphite, turret, { pos: [0, 0.25, -0.2], scale: [0.8, 0.12, 0.7] });
  for (const side of [-1, 1]) kit.part('box', P.enemyDark, turret, { pos: [side * 0.56, 0.12, 0], scale: [0.14, 0.5, 0.9] });
  const cannon = kit.node('aCannon', turret, [0, 0.25, 0.1]);
  cannon.rotation.x = -0.75;
  kit.part('cyl', P.enemyDark, cannon, { pos: [0, 0, 0.2], rot: [Math.PI / 2, 0, 0], scale: [0.55, 0.7, 0.55] });
  kit.part('cyl', P.metal, cannon, { pos: [0, 0, 1.25], rot: [Math.PI / 2, 0, 0], scale: [0.3, 2.2, 0.3] });
  kit.part(brake, P.enemyArmor, cannon, { pos: [0, 0, 2.3], rot: [Math.PI / 2, 0, 0] });
  kit.part('cyl8', P.graphite, cannon, { pos: [0, 0, 1.84], rot: [Math.PI / 2, 0, 0], scale: [0.44, 0.22, 0.44] });
  kit.part('box', P.graphite, cannon, { pos: [0, 0.24, 1.0], scale: [0.12, 0.14, 1.4] });
  const rings: AbstractMesh[] = [];
  for (let i = 0; i < 3; i++) {
    kit.part('torus', P.graphite, cannon, { pos: [0, 0, 0.75 + i * 0.45], rot: [Math.PI / 2, 0, 0], scale: [0.46, 0.46, 0.46] });
    const g = kit.part('torus', M.chargeRed, cannon, { pos: [0, 0, 0.75 + i * 0.45], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.5, 0.5], shadow: false });
    g.setEnabled(false);
    rings.push(g);
  }
  const muzzle = kit.node('aMuzzle', cannon, [0, 0, 2.55]);
  return { root, body, turret, cannon, muzzle, rings, stabilizers, optic };
}

// ------------------------------------------------------------------ Support Engineer

export interface EngineerRig {
  root: TransformNode;
  body: TransformNode;
  arms: { shoulder: TransformNode; elbow: TransformNode; tip: TransformNode }[];
  dish: TransformNode;
  beacon: AbstractMesh;
  ring: AbstractMesh;
}

/** Hovering support unit: armoured pod, antenna mast + dish, two articulated repair arms, teal emitters. */
export function buildEngineer(kit: Kit, P: Palette): EngineerRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('engineer', null);
  const body = kit.node('gBody', root, [0, 1.65, 0]);
  const shell = kit.sculpt('engineerShell', () => loftData([
    { t: -0.7, w: 0.36, h: 0.29, n: 5 }, { t: -0.44, w: 0.57, h: 0.44, n: 5 },
    { t: 0.21, w: 0.59, h: 0.39, n: 5 }, { t: 0.57, w: 0.42, h: 0.29, n: 4 },
  ], 'z', 20));
  kit.part(shell, P.enemyArmor, body);
  kit.part('box', P.enemyArmor, body, { pos: [0, -0.28, 0], scale: [0.8, 0.22, 0.9] });
  for (const side of [-1, 1]) kit.part('box', P.graphite, body, { pos: [side * 0.55, 0, 0], scale: [0.14, 0.6, 0.8] });
  // Face ring + eye
  kit.part('torus', P.graphite, body, { pos: [0, 0.02, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.55, 0.55, 0.55] });
  kit.part('sphere', M.support, body, { pos: [0, 0.02, 0.58], scale: [0.36, 0.36, 0.14], shadow: false });
  // Mast + dish
  kit.part('cyl8', P.metal, body, { pos: [-0.18, 0.95, -0.25], scale: [0.07, 1.3, 0.07] });
  const dish = kit.node('dish', body, [-0.18, 1.55, -0.25]);
  kit.part(reflector(kit), P.metal, dish, { rot: [-0.6, 0, 0], scale: [0.82, 0.92, 0.82] });
  kit.part('cyl8', P.metal, dish, { pos: [0, 0.08, 0.05], rot: [-0.6, 0, 0], scale: [0.04, 0.4, 0.04] });
  const beacon = kit.part('sphere', M.support, body, { pos: [-0.18, 1.72, -0.25], scale: [0.16, 0.16, 0.16], shadow: false });
  // Backpack capacitor cells
  for (const side of [-1, 1]) {
    kit.part('cyl', P.graphite, body, { pos: [side * 0.28, 0.05, -0.62], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.5, 0.3] });
    kit.part('torusThin', M.supportDim, body, { pos: [side * 0.28, 0.05, -0.86], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.3, 0.3], shadow: false });
  }
  // Hover ring
  kit.part('torus', P.metal, body, { pos: [0, -0.62, 0], scale: [1.2, 1.4, 1.2] });
  const ring = kit.part('torusThin', M.support, body, { pos: [0, -0.68, 0], scale: [1.05, 1.05, 1.05], shadow: false });
  kit.part('cone', M.flame, body, { pos: [0, -0.92, 0], rot: [Math.PI, 0, 0], scale: [0.26, 0.38, 0.26], shadow: false });
  const arms: EngineerRig['arms'] = [];
  for (const side of [-1, 1]) {
    const shoulder = kit.node('gShoulder', body, [side * 0.68, 0.15, 0.2]);
    kit.part('sphere', P.enemyArmor, shoulder, { scale: [0.3, 0.3, 0.3] });
    kit.part('box', P.graphite, shoulder, { pos: [0, 0, 0.35], scale: [0.14, 0.16, 0.7] });
    kit.part('cyl8', P.metal, shoulder, { pos: [side * 0.075, 0.04, 0.33], rot: [Math.PI / 2, 0, 0], scale: [0.075, 0.46, 0.075] });
    const elbow = kit.node('gElbow', shoulder, [0, 0, 0.7]);
    kit.part('sphere', P.metal, elbow, { scale: [0.18, 0.18, 0.18] });
    kit.part('box', P.enemyArmor, elbow, { pos: [0, 0, 0.3], scale: [0.12, 0.12, 0.6] });
    kit.part('cyl6', P.graphite, elbow, { pos: [0, 0, 0.55], rot: [Math.PI / 2, 0, 0], scale: [0.19, 0.12, 0.19] });
    for (const f of [-1, 1]) kit.part('box', P.metal, elbow, { pos: [f * 0.07, 0, 0.66], rot: [0, f * 0.35, 0], scale: [0.04, 0.05, 0.25] });
    const tip = kit.node('gTip', elbow, [0, 0, 0.72]);
    kit.part('sphere', M.support, tip, { scale: [0.13, 0.13, 0.13], shadow: false });
    shoulder.rotation.x = 0.6;
    elbow.rotation.x = -0.9;
    arms.push({ shoulder, elbow, tip });
  }
  return { root, body, arms, dish, beacon, ring };
}

// ------------------------------------------------------------------ Vault Courier (HVT)

export interface CourierRig {
  root: TransformNode;
  body: TransformNode;
  ring: TransformNode;
  petals: TransformNode[];
  vault: AbstractMesh;
  phase: AbstractMesh;
}

/** Gold-plated vault drone: ovoid hull, petal armour, slow orbit ring, glowing vault core underneath. */
export function buildCourier(kit: Kit, P: Palette): CourierRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('courier', null);
  const body = kit.node('cBody', root, [0, 6.8, 0]);
  const vaultShell = kit.sculpt('vaultChassis', () => loftData([
    { t: -1.35, w: 0.55, h: 0.38 }, { t: -0.88, w: 0.82, h: 0.57, n: 4 },
    { t: 0.40, w: 0.85, h: 0.56, n: 5 }, { t: 1.28, w: 0.49, h: 0.32, n: 4 },
  ], 'z', 24));
  const armor = kit.sculpt('vaultPetal', () => loftData([
    { t: -1.22, w: 0.21, h: 0.048, v: 0.63 }, { t: -0.74, w: 0.45, h: 0.12, v: 0.72, n: 4 },
    { t: 0.35, w: 0.44, h: 0.1, v: 0.77, n: 5 }, { t: 1.10, w: 0.25, h: 0.064, v: 0.60 },
  ], 'z', 16));
  kit.part(vaultShell, M.goldDark, body);
  const petals: TransformNode[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p = kit.node('petal', body);
    p.rotation.z = a;
    kit.part(armor, M.gold, p);
    kit.part('box', P.graphite, p, { pos: [0, 0.85, -0.9], scale: [0.6, 0.06, 0.35] });
    kit.part('box', M.amber, p, { pos: [0, 0.874, 0.05], scale: [0.052, 0.02, 0.7], shadow: false });
    petals.push(p);
  }
  kit.part('box', M.gold, body, { pos: [0, 0, 1.15], scale: [0.85, 0.6, 0.4] });
  kit.part('box', P.orangeGlow, body, { pos: [0, 0.05, 1.36], scale: [0.6, 0.1, 0.03], shadow: false });
  for (const side of [-1, 1]) {
    kit.part('cyl', P.graphite, body, { pos: [side * 0.75, 0, -1.3], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.7, 0.5] });
    kit.part('torus', P.orangeGlow, body, { pos: [side * 0.75, 0, -1.68], rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.42, 0.42], shadow: false });
    kit.part('cone', M.flame, body, { pos: [side * 0.75, 0, -2.1], rot: [-Math.PI / 2, 0, 0], scale: [0.32, 0.8, 0.32], shadow: false });
  }
  const vault = kit.part('sphere', P.whiteGlow, body, { pos: [0, -0.95, 0], scale: [0.7, 0.7, 0.7], shadow: false });
  for (let i = 0; i < 2; i++) kit.part('torus', M.gold, body, { pos: [0, -0.95, 0], rot: [i * Math.PI / 2, 0, Math.PI / 2], scale: [0.95, 0.95, 0.95] });
  const ring = kit.node('cRing', body);
  kit.part('torus', M.gold, ring, { scale: [4.0, 4.0, 4.0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    kit.part('box', P.graphite, ring, { pos: [Math.sin(a) * 2, 0, Math.cos(a) * 2], rot: [0, a, 0], scale: [0.25, 0.35, 0.5] });
  }
  // Phase shield shell (enabled during the phase-shift)
  const phase = kit.part('sphere', M.energyWallViolet, body, { scale: [3.3, 2.6, 3.8], shadow: false });
  phase.setEnabled(false);
  return { root, body, ring, petals, vault, phase };
}

// ------------------------------------------------------------------ M7: Jammer Drone

export interface JammerRig {
  root: TransformNode;
  body: TransformNode;
  dish: TransformNode;
  emitter: AbstractMesh;
  muzzle: TransformNode;
  fins: TransformNode[];
  rotor: AbstractMesh;
}

/** Electronic-warfare drone: flat armoured disc, gimballed jamming dish with a violet emitter, tail fins. */
export function buildJammer(kit: Kit, P: Palette): JammerRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('jammer', null);
  const body = kit.node('jBody', root, [0, 4.4, 0]);
  const shell = kit.sculpt('jammerShell', () => loftData([
    { t: -0.22, w: 0.52, h: 0.47, n: 4 }, { t: -0.045, w: 0.88, h: 0.76, n: 4 },
    { t: 0.11, w: 0.84, h: 0.76, n: 4 }, { t: 0.28, w: 0.59, h: 0.6, n: 4 },
  ], 'y', 24));
  const fin = kit.sculpt('jammerFin', () => loftData([
    { t: -0.4, w: 0.025, h: 0.17, v: 0.09 }, { t: -0.22, w: 0.049, h: 0.24, v: 0.08, n: 4 },
    { t: 0.29, w: 0.041, h: 0.10 },
  ], 'z', 12));
  kit.part(shell, P.enemyArmor, body);
  kit.part('torusThin', M.violetDim, body, { pos: [0, -0.02, 0], scale: [1.72, 1.72, 1.72], shadow: false });
  const rotor = kit.part('torus', M.violet, body, { pos: [0, -0.22, 0], scale: [1.1, 1.1, 1.1], shadow: false });
  kit.part('cone', P.graphite, body, { pos: [0, -0.4, 0], rot: [Math.PI, 0, 0], scale: [0.5, 0.35, 0.5] });
  const fins: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const f = kit.node('jFin', body, [side * 0.7, 0.05, -0.55]);
    f.rotation.set(0, side * 0.5, side * 0.25);
    kit.part(fin, P.enemyDark, f);
    kit.part('box', M.violetDim, f, { pos: [0, 0.21, -0.14], rot: [0.41, 0, 0], scale: [0.09, 0.041, 0.31], shadow: false });
    fins.push(f);
  }
  // Jamming dish on a gimbal at the front (weakpoint).
  const dish = kit.node('jDish', body, [0, 0.35, 0.55]);
  kit.part('cyl', P.metal, dish, { pos: [0, -0.15, 0], scale: [0.1, 0.3, 0.1] });
  kit.part(reflector(kit), P.enemyArmor, dish, { pos: [0, 0.05, 0.18], rot: [Math.PI / 2, 0, 0], scale: [0.9, 0.95, 0.9] });
  const emitter = kit.part('sphere', M.violet, dish, { pos: [0, 0.05, 0.42], scale: [0.2, 0.2, 0.2], shadow: false });
  kit.part('cyl', P.graphite, dish, { pos: [0, 0.05, 0.28], rot: [Math.PI / 2, 0, 0], scale: [0.05, 0.4, 0.05] });
  for (const side of [-1, 1]) kit.part('box', P.metal, dish, { pos: [side * 0.22, 0.05, 0.29], rot: [0, -side * 0.42, 0], scale: [0.035, 0.035, 0.34] });
  const muzzle = kit.node('jMuzzle', dish, [0, 0.05, 0.5]);
  return { root, body, dish, emitter, muzzle, fins, rotor };
}

// ------------------------------------------------------------------ M7: Siege Crawler

export interface CrawlerRig {
  root: TransformNode;
  body: TransformNode;
  legs: { hip: TransformNode; knee: TransformNode; side: number; phase: number }[];
  drill: TransformNode;
  pods: AbstractMesh[];
  glow: AbstractMesh;
}

/** Six-legged siege crawler: low wedge hull with a frontal armour prow, rear carrier pods and a reactor drill. */
export function buildCrawler(kit: Kit, P: Palette): CrawlerRig {
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('crawler', null);
  const body = kit.node('cBody', root, [0, 1.25, 0]);
  const hull = kit.sculpt('crawlerHull', () => loftData([
    { t: -1.59, w: 0.76, h: 0.29, n: 5 }, { t: -1.19, w: 1.13, h: 0.47, v: 0.14, n: 6 },
    { t: 0.99, w: 1.13, h: 0.36, v: 0.06, n: 7 }, { t: 1.61, w: 0.92, h: 0.21, v: -0.04, n: 7 },
  ], 'z', 24));
  const drillBit = kit.sculpt('crawlerBit', () => smoothLatheData([
    [0.23, 0], [0.29, 0.09], [0.28, 0.24], [0.20, 0.49], [0.10, 0.72], [0.023, 0.84],
  ], 12));
  kit.part(hull, P.enemyDark, body);
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    kit.part('box', P.enemyArmor, body, { pos: [side * 0.61, 0.46 - i * 0.073, -0.62 + i * 0.78], rot: [0.15, 0, -side * 0.17], scale: [0.78, 0.19, 0.72] });
  }
  // Frontal prow (the armour that blunts frontal fire).
  kit.part('box', M.plate, body, { pos: [0, 0.15, 1.75], rot: [-0.45, 0, 0], scale: [2.3, 0.95, 0.35] });
  for (const side of [-1, 1]) kit.part('box', M.plate, body, { pos: [side * 1.0, 0.1, 1.55], rot: [-0.3, side * 0.5, 0], scale: [0.6, 0.8, 0.3] });
  const glow = kit.part('box', P.orangeGlow, body, { pos: [0, 0.32, 1.92], rot: [-0.45, 0, 0], scale: [1.4, 0.06, 0.02], shadow: false });
  // Rear carrier pods (weakpoint cluster).
  const pods: AbstractMesh[] = [];
  for (let i = 0; i < 3; i++) {
    kit.part('cyl8', P.graphite, body, { pos: [(i - 1) * 0.62, 0.65, -1.15], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.9, 0.5] });
    pods.push(kit.part('cyl8', M.amber, body, { pos: [(i - 1) * 0.62, 0.65, -1.62], rot: [Math.PI / 2, 0, 0], scale: [0.36, 0.05, 0.36], shadow: false }));
  }
  // Drill under the prow.
  const drill = kit.node('cDrill', body, [0, -0.25, 1.75]);
  kit.part(drillBit, P.metal, drill, { rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    kit.part('box', P.graphite, drill, { pos: [Math.sin(angle) * 0.17, Math.cos(angle) * 0.17, 0.41], rot: [0.32, 0, -angle], scale: [0.12, 0.12, 0.59] });
  }
  kit.part('torusThin', P.orangeGlow, drill, { pos: [0, 0, 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.6, 0.6, 0.6], shadow: false });
  const legs: CrawlerRig['legs'] = [];
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const hip = kit.node('cHip', body, [side * 1.05, -0.05, 0.95 - i * 0.95]);
      hip.rotation.z = side * -0.5;
      kit.part('cyl8', P.metal, hip, { rot: [Math.PI / 2, 0, 0], scale: [0.34, 0.34, 0.34] });
      kit.part('box', P.enemyArmor, hip, { pos: [side * 0.45, 0, 0], scale: [0.95, 0.22, 0.26] });
      kit.part('cyl8', P.metal, hip, { pos: [side * 0.51, -0.12, 0], rot: [0, 0, Math.PI / 2], scale: [0.12, 0.67, 0.12] });
      const knee = kit.node('cKnee', hip, [side * 0.9, 0, 0]);
      kit.part('box', P.enemyDark, knee, { pos: [0, -0.55, 0], rot: [0, 0, side * 0.25], scale: [0.18, 1.2, 0.2] });
      kit.part('cone', P.metal, knee, { pos: [side * 0.15, -1.15, 0], rot: [Math.PI, 0, 0], scale: [0.18, 0.3, 0.18] });
      legs.push({ hip, knee, side, phase: i * 2.1 + (side > 0 ? Math.PI : 0) });
    }
  }
  return { root, body, legs, drill, pods, glow };
}
