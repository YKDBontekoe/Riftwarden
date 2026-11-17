import { type AbstractMesh, Color3, PBRMaterial, type Scene, type TransformNode } from '@babylonjs/core';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';
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
  };
  const tex = wallTexture(scene);
  m.energyWall.emissiveTexture = tex;
  m.energyWallViolet.emissiveTexture = tex;
  cache.set(scene, m);
  return m;
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
  // Track units
  const wheels: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const track = kit.node('track', s, [side * 0.78, 0.42, 0]);
    kit.part('box', P.enemyDark, track, { scale: [0.46, 0.7, 2.1] });
    kit.part('box', P.graphite, track, { pos: [side * 0.05, 0.38, 0], scale: [0.5, 0.08, 1.9] });
    kit.part('box', P.enemyArmor, track, { pos: [side * 0.2, 0.12, 0], scale: [0.12, 0.62, 1.7] });
    kit.part('box', P.orangeDim, track, { pos: [side * 0.27, 0.12, 0.2], scale: [0.02, 0.06, 1.0], shadow: false });
    for (const z of [-0.75, 0, 0.75]) {
      const w = kit.node('wheel', track, [side * -0.05, -0.12, z]);
      kit.part('cyl8', P.metal, w, { rot: [0, 0, Math.PI / 2], scale: [0.5, 0.5, 0.5] });
      kit.part('box', P.graphite, w, { scale: [0.52, 0.12, 0.42] });
      wheels.push(w);
    }
  }
  const hull = kit.node('hull', s, [0, 1.25, 0]);
  kit.part('box', P.enemyDark, hull, { pos: [0, -0.15, 0], scale: [1.5, 0.45, 1.6] });
  kit.part('box', P.enemyArmor, hull, { pos: [0, 0.38, -0.05], scale: [1.75, 0.85, 1.35], rot: [0.06, 0, 0] });
  kit.part('box', P.enemyArmor, hull, { pos: [0, 0.32, 0.72], scale: [1.4, 0.7, 0.3], rot: [-0.42, 0, 0] });
  kit.part('box', P.graphite, hull, { pos: [0, 0.88, 0.02], scale: [1.2, 0.18, 1.1] });
  // Sensor head sunk between the shoulders
  kit.part('box', P.enemyDark, hull, { pos: [0, 0.95, 0.45], scale: [0.62, 0.32, 0.45] });
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
  kit.part('cyl6', P.enemyDark, body, { scale: [2.3, 0.32, 2.3] });
  kit.part('cyl6', P.enemyArmor, body, { pos: [0, 0.24, 0], scale: [1.9, 0.18, 1.9] });
  kit.part('cyl6', P.graphite, body, { pos: [0, -0.26, 0], scale: [1.4, 0.22, 1.4] });
  kit.part('torusThin', P.orangeDim, body, { pos: [0, 0.02, 0], scale: [2.32, 2.32, 2.32], shadow: false });
  const stabilizers: TransformNode[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    const st = kit.node('stab', body, [Math.sin(a) * 1.25, -0.1, Math.cos(a) * 1.25]);
    st.rotation.y = a;
    kit.part('box', P.graphite, st, { pos: [0, 0, 0.25], scale: [0.25, 0.18, 0.8] });
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
  kit.part('cyl', P.enemyArmor, cannon, { pos: [0, 0, 2.3], rot: [Math.PI / 2, 0, 0], scale: [0.44, 0.35, 0.44] });
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
  kit.part('ico', P.enemyDark, body, { scale: [1.15, 1.0, 1.25] });
  kit.part('box', P.enemyArmor, body, { pos: [0, 0.32, 0.05], scale: [0.95, 0.3, 1.05], rot: [0.1, 0, 0] });
  kit.part('box', P.enemyArmor, body, { pos: [0, -0.28, 0], scale: [0.8, 0.22, 0.9] });
  for (const side of [-1, 1]) kit.part('box', P.graphite, body, { pos: [side * 0.55, 0, 0], scale: [0.14, 0.6, 0.8] });
  // Face ring + eye
  kit.part('torus', P.graphite, body, { pos: [0, 0.02, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.55, 0.55, 0.55] });
  kit.part('sphere', M.support, body, { pos: [0, 0.02, 0.58], scale: [0.36, 0.36, 0.14], shadow: false });
  // Mast + dish
  kit.part('cyl8', P.metal, body, { pos: [-0.18, 0.95, -0.25], scale: [0.07, 1.3, 0.07] });
  const dish = kit.node('dish', body, [-0.18, 1.55, -0.25]);
  kit.part('cone', P.white, dish, { rot: [-0.6, 0, 0], scale: [0.75, 0.22, 0.75] });
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
    const elbow = kit.node('gElbow', shoulder, [0, 0, 0.7]);
    kit.part('sphere', P.metal, elbow, { scale: [0.18, 0.18, 0.18] });
    kit.part('box', P.enemyArmor, elbow, { pos: [0, 0, 0.3], scale: [0.12, 0.12, 0.6] });
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
  kit.part('sphere', M.goldDark, body, { scale: [1.9, 1.3, 2.5] });
  const petals: TransformNode[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p = kit.node('petal', body);
    p.rotation.z = a;
    kit.part('box', M.gold, p, { pos: [0, 0.78, 0], scale: [0.95, 0.12, 2.3], rot: [0, 0, 0] });
    kit.part('box', P.graphite, p, { pos: [0, 0.85, -0.9], scale: [0.6, 0.06, 0.35] });
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
