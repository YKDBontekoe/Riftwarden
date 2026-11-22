import { elementEnergy } from '@riftwarden/rules/combat/elements';
import { type Material } from '@babylonjs/core/Materials/material';
import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { type Scene } from '@babylonjs/core/scene';
import type { WeaponFamily } from '@riftwarden/rules/data/defs';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { loftData } from '../visuals/sculpt';
import { FAMILIES, type SocketKind, type WeaponBuild } from '@riftwarden/rules/weapons/build';
import { boxData, cylProfile, latheData, prismData, tubeProfile } from './geometry';
import { heatMetal, weaponGlow, type WeaponMaterials, weaponMaterials } from './materials';
import { moduleTypeDef, type ModuleVisual } from '@riftwarden/rules/weapons/modules';
import { alongX, alongZ, copyVd, cylX, cylZ, lathe, tubeZ } from './shapes';
import { swarmBarrel, swarmChassis } from './swarmModel';

/**
 * Procedural weapon model: turns a WeaponBuild (+ installed modules) into a hierarchy of
 * merged meshes with named animation hooks. Weapon space: +z forward (muzzle), +y up,
 * origin at the mount pivot under the receiver. The same builder serves the first-person
 * viewmodel and the HQ inspection preview, so both always show the same weapon.
 *
 * Parts are attached to explicit mount points that each chassis exposes (barrel root,
 * core bay, cooling bay, rail, socket mounts), so components always connect instead of
 * floating. Static parts are merged per (animated node, material): a full weapon is
 * ~15-30 draw calls regardless of detail.
 */
export interface WeaponRig {
  root: TransformNode;
  family: WeaponFamily;
  build: WeaponBuild;
  /** Bolt/beam origins (twin barrels alternate). */
  muzzles: TransformNode[];
  /** Barrel group that slides back on recoil. */
  slide: TransformNode;
  /** Spinning parts: rate in rad/s at idle (animator scales with activity). */
  spin: { node: TransformNode; axis: 'x' | 'y' | 'z'; rate: number }[];
  /** Vent fins: rotate about local x up to `max` radians as heat rises. */
  fins: { node: TransformNode; max: number }[];
  /** Capacitors / rings that slide forward and glow with charge. */
  charge: { node: TransformNode; travel: number; z0: number }[];
  /** Heat indicator LEDs (lit progressively) and their materials. */
  leds: Mesh[];
  ledOn: PBRMaterial;
  ledHot: PBRMaterial;
  ledOff: PBRMaterial;
  /** Animated materials. */
  energy: PBRMaterial;
  energyBase: Color3;
  /** Charge-reactive glow (rail strips, beam emitter, coil rings). */
  chargeGlow: PBRMaterial;
  heat: PBRMaterial;
  /** Front-most z (muzzle) and overall length for framing. */
  front: number;
  rear: number;
  meshes: Mesh[];
  dispose(): void;
}

export interface ModelOpts {
  renderingGroupId?: number;
  layerMask?: number;
  name?: string;
  /** Include the drone hardpoint arm (viewmodel only). Default true. */
  mount?: boolean;
  /** Damage element: non-kinetic elements tint the energy parts. */
  element?: string;
}

export type V3 = [number, number, number];

// ------------------------------------------------------------------ assembler

export class Assembler {
  private buckets = new Map<string, { node: TransformNode; mat: Material; parts: VertexData[] }>();
  readonly nodes: TransformNode[] = [];
  readonly meshes: Mesh[] = [];
  constructor(readonly scene: Scene, readonly root: TransformNode, private opts: ModelOpts) {}

  private statics = new Set<TransformNode>();

  /**
   * A placement frame that never moves on its own: its parts are baked into the parent's
   * merged meshes at finalize (keeps the draw-call count low). Must not get child nodes.
   */
  frame(name: string, parent: TransformNode, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): TransformNode {
    const n = this.node(name, parent, pos, rot);
    this.statics.add(n);
    return n;
  }

  node(name: string, parent: TransformNode, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = parent;
    n.position.set(...pos);
    n.rotation.set(...rot);
    this.nodes.push(n);
    return n;
  }

  add(vd: VertexData, mat: Material, parent: TransformNode, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): void {
    const v = copyVd(vd);
    const m = Matrix.Compose(new Vector3(...scale), Quaternion.FromEulerAngles(...rot), new Vector3(...pos));
    v.transform(m);
    const key = `${parent.uniqueId}|${mat.uniqueId}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { node: parent, mat, parts: [] };
      this.buckets.set(key, b);
    }
    b.parts.push(v);
  }

  /** A separate (unmerged) mesh, e.g. LEDs that swap material. */
  single(vd: VertexData, mat: Material, parent: TransformNode, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): Mesh {
    const mesh = new Mesh(`${this.opts.name ?? 'wpn'}_part`, this.scene);
    copyVd(vd).applyToMesh(mesh);
    mesh.parent = parent;
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    this.prep(mesh, mat);
    return mesh;
  }

  private prep(mesh: Mesh, mat: Material): void {
    mesh.material = mat;
    mesh.isPickable = false;
    if (this.opts.renderingGroupId) mesh.alwaysSelectAsActiveMesh = true;
    if (this.opts.renderingGroupId !== undefined) mesh.renderingGroupId = this.opts.renderingGroupId;
    if (this.opts.layerMask !== undefined) mesh.layerMask = this.opts.layerMask;
    this.meshes.push(mesh);
  }

  finalize(): void {
    // Bake static frames into their parent's buckets.
    for (const [key, b] of [...this.buckets]) {
      if (!this.statics.has(b.node)) continue;
      const n = b.node;
      const parent = n.parent as TransformNode;
      const m = Matrix.Compose(n.scaling, Quaternion.FromEulerAngles(n.rotation.x, n.rotation.y, n.rotation.z), n.position);
      for (const v of b.parts) v.transform(m);
      const pk = `${parent.uniqueId}|${b.mat.uniqueId}`;
      const pb = this.buckets.get(pk);
      if (pb) pb.parts.push(...b.parts);
      else this.buckets.set(pk, { node: parent, mat: b.mat, parts: b.parts });
      this.buckets.delete(key);
    }
    for (const n of this.statics) n.dispose();
    this.statics.clear();
    for (const b of this.buckets.values()) {
      const [first, ...rest] = b.parts;
      if (rest.length) first.merge(rest, true);
      const mesh = new Mesh(`${this.opts.name ?? 'wpn'}_${b.mat.name}`, this.scene);
      first.applyToMesh(mesh);
      mesh.parent = b.node;
      this.prep(mesh, b.mat);
    }
    this.buckets.clear();
  }
}

// ------------------------------------------------------------------ shared shapes

export interface Ctx {
  mount: boolean;
  a: Assembler;
  M: WeaponMaterials;
  shell: Material;
  trim: Material;
  energy: PBRMaterial;
  chargeGlow: PBRMaterial;
  heat: PBRMaterial;
  b: WeaponBuild;
  rarity: number;
  rig: Partial<WeaponRig> & { spin: WeaponRig['spin']; fins: WeaponRig['fins']; charge: WeaponRig['charge']; muzzles: TransformNode[] };
}

/** Mount points a chassis exposes to components. */
export interface Mounts {
  /** Barrel axis: y height and z where the barrel starts. */
  axisY: number;
  barrelZ: number;
  /** Core bay on the visible (-x) flank: centre + available length along z. */
  core: { pos: V3; len: number };
  /** Top surface y and z-range available for fins/sight. */
  top: { y: number; z0: number; z1: number };
  status: { y: number; z: number };
  /** Lower flank for heat sinks / capacitors. */
  flank: { y: number; z0: number; z1: number; x: number };
  rear: number;
}

/** Small printed flank marking. Each family uses one row of the shared atlas. */
export function chassisMark(c: Ctx, row: number, width: number, at: V3): void {
  const height = width / 6;
  const half = width / 2;
  const v0 = row / 3;
  const v1 = (row + 1) / 3;
  const data = new VertexData();
  data.positions = [0, -height / 2, half, 0, height / 2, half, 0, height / 2, -half, 0, -height / 2, -half];
  data.normals = [-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0];
  data.uvs = [0, v1, 0, v0, 1, v0, 1, v1];
  data.indices = [0, 2, 1, 0, 3, 2];
  c.a.add(data, c.M.markings, c.a.root, at);
}

// ------------------------------------------------------------------ chassis: plasma repeater

function plasmaChassis(c: Ctx): Mounts {
  const { a, M } = c;
  const root = a.root;
  const heavy = c.b.chassis === 'heavy_repeater';
  const light = c.b.chassis === 'light_repeater';
  const L = heavy ? 1.08 : light ? 0.86 : 1;
  const H = (heavy ? 1.14 : light ? 0.9 : 1) * (0.96 + 0.08 * c.b.params.bulk);
  const W = heavy ? 0.086 : light ? 0.069 : 0.079;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;

  // Compound tapers keep the shoulder, receiver and front coupler distinct in silhouette.
  a.add(loftData([
    { t: z(-0.331), w: W * 0.34, h: y(0.024), v: y(0.021), n: 6 },
    { t: z(-0.285), w: W * 0.43, h: y(0.04), v: y(0.018), n: 6 },
    { t: z(-0.174), w: W * 0.47, h: y(0.059), v: y(0.02), n: 7 },
    { t: z(0.091), w: W * 0.50, h: y(0.05), v: y(0.022), n: 7 },
    { t: z(0.218), w: W * 0.38, h: y(0.039), v: y(0.033), n: 5 },
    { t: z(0.253), w: W * 0.32, h: y(0.029), v: y(0.04), n: 5 },
  ], 'z', 24), M.graphite, root);
  // The upper shell splits around the cooling spine, standing clear at the waist.
  for (const side of [-1, 1]) {
    a.add(loftData([
      { t: z(-0.307), w: 0.010, h: y(0.009), u: side * W * 0.19, v: y(0.044), n: 3 },
      { t: z(-0.253), w: 0.018, h: y(0.013), u: side * W * 0.34, v: y(0.067), n: 3 },
      { t: z(-0.16), w: 0.015, h: y(0.014), u: side * W * 0.49, v: y(0.082), n: 3.5 },
      { t: z(-0.062), w: 0.012, h: y(0.012), u: side * W * 0.57, v: y(0.086), n: 3 },
      { t: z(0.08), w: 0.013, h: y(0.013), u: side * W * 0.48, v: y(0.073), n: 3 },
      { t: z(0.199), w: 0.013, h: y(0.013), u: side * W * 0.31, v: y(0.059), n: 3 },
      { t: z(0.235), w: 0.006, h: y(0.007), u: side * W * 0.27, v: y(0.052), n: 3 },
    ], 'z', 32), c.shell, root);
  }
  // Replaceable power cartridge and two skids under the receiver.
  a.add(loftData([
    { t: z(-0.227), w: W * 0.27, h: y(0.017), v: y(-0.042), n: 4 },
    { t: z(-0.181), w: W * 0.40, h: y(0.025), v: y(-0.049), n: 6 },
    { t: z(-0.071), w: W * 0.40, h: y(0.023), v: y(-0.056), n: 6 },
    { t: z(-0.024), w: W * 0.31, h: y(0.017), v: y(-0.044), n: 5 },
  ], 'z', 16), M.polymer, root);
  // The rear cap and cartridge catches are visible from the drone's mount.
  a.add(loftData([
    { t: z(-0.330), w: W * 0.35, h: y(0.025), v: y(0.022), n: 6 },
    { t: z(-0.311), w: W * 0.45, h: y(0.042), v: y(0.020), n: 6 },
    { t: z(-0.289), w: W * 0.47, h: y(0.045), v: y(0.019), n: 6 },
    { t: z(-0.278), w: W * 0.43, h: y(0.042), v: y(0.019), n: 6 },
  ], 'z', 16), M.satin, root);
  a.add(boxData(W * 0.48, y(0.016), z(0.004), 0.0015), M.dark, root, [0, y(0.027), z(-0.331)]);
  a.add(boxData(W * 0.34, y(0.0038), z(0.003), 0.0009), c.energy, root, [0, y(0.027), z(-0.334)]);
  for (const side of [-1, 1]) {
    const at = side * W / 2;
    a.add(prismData([[z(-0.19), y(0.021)], [z(0.146), y(0.019)], [z(0.206), y(0.048)], [z(0.13), y(0.071)], [z(-0.148), y(0.064)]], 0.009, 0.0031), M.dark, root, [at - side * 0.001, 0, 0]);
    a.add(prismData([[z(-0.189), y(0.017)], [z(0.122), y(0.014)], [z(0.168), y(0.024)], [z(-0.168), y(0.028)]], 0.0075, 0.0017), c.trim, root, [at + side * 0.002, 0, 0]);
    a.add(prismData([[z(-0.29), y(-0.014)], [z(-0.19), y(-0.035)], [z(-0.13), y(-0.026)], [z(-0.153), y(-0.003)], [z(-0.233), y(0.019)], [z(-0.282), y(0.008)]], 0.009, 0.003), c.shell, root, [side * W * 0.43, 0, 0]);
    for (let i = 0; i < 4; i++) {
      a.add(boxData(0.0065, y(0.018), z(0.009), 0.0015), c.trim, root, [at + side * 0.005, y(0.041), z(0.063 + i * 0.021)], [-0.31, 0, 0]);
    }
    for (const zz of [-0.150, 0.166]) {
      a.add(cylX(0.0046, -0.002, 0.002, 0.001, 12), M.satin, root, [at + side * 0.004, y(0.048), z(zz)]);
    }
    a.add(prismData([[z(-0.287), y(0.054)], [z(-0.193), y(0.073)], [z(-0.1), y(0.092)], [z(-0.127), y(0.099)], [z(-0.249), y(0.077)]], 0.011, 0.0024), M.graphite, root, [side * W * 0.34, 0, 0]);
    for (let i = 0; i < 3; i++) {
      a.add(boxData(0.010, y(0.006), z(0.010), 0.0014), i === 0 ? M.copper : M.dark, root, [side * W * 0.345, y(0.074 + i * 0.0044), z(-0.254 + i * 0.021)], [-0.20, 0, 0]);
    }
  }
  chassisMark(c, 0, z(0.107), [-W / 2 - 0.0044, y(0.049), z(-0.079)]);
  a.add(cylX(0.025, -W * 0.55, W * 0.55, 0.004), M.satin, root, [0, y(-0.051), z(-0.009)]);
  a.add(prismData([[z(-0.203), y(0.091)], [z(-0.098), y(0.091)], [z(-0.123), y(0.104)], [z(-0.181), y(0.104)]], 0.032, 0.003), M.dark, root);
  return {
    axisY: y(0.042),
    barrelZ: z(0.235),
    core: { pos: [-W / 2 - 0.002, y(-0.021), z(-0.023)], len: z(0.2) },
    top: { y: y(0.092), z0: z(0.0), z1: z(0.12) },
    status: { y: y(0.106), z: z(-0.149) },
    flank: { y: y(-0.036), z0: z(-0.15), z1: z(0.1), x: W * 0.48 },
    rear: z(-0.332),
  };
}

// ------------------------------------------------------------------ chassis: railgun

function railChassis(c: Ctx): Mounts {
  const { a, M } = c;
  const root = a.root;
  const siege = c.b.chassis === 'rail_siege';
  const striker = c.b.chassis === 'rail_striker';
  const L = siege ? 1.12 : striker ? 0.86 : 1;
  const H = (siege ? 1.1 : striker ? 0.92 : 1) * (0.96 + 0.08 * c.b.params.bulk);
  const W = siege ? 0.086 : 0.075;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;

  a.add(loftData([
    { t: z(-0.362), w: W * 0.38, h: y(0.031), v: y(0.023), n: 6 },
    { t: z(-0.311), w: W * 0.43, h: y(0.063), v: y(0.038), n: 7 },
    { t: z(-0.131), w: W * 0.50, h: y(0.064), v: y(0.039), n: 7 },
    { t: z(0.035), w: W * 0.47, h: y(0.042), v: y(0.019), n: 6 },
    { t: z(0.245), w: W * 0.33, h: y(0.031), v: y(0.008), n: 5 },
  ], 'z', 24), M.graphite, root);
  // Offset forged spines leave a sightline into the recessed copper power bus.
  a.add(loftData([
    { t: z(-0.341), w: W * 0.24, h: y(0.012), v: y(0.058), n: 4 },
    { t: z(-0.244), w: W * 0.31, h: y(0.012), v: y(0.102), n: 4 },
    { t: z(-0.079), w: W * 0.22, h: y(0.012), v: y(0.092), n: 4 },
    { t: z(0.045), w: W * 0.15, h: y(0.009), v: y(0.052), n: 3 },
  ], 'z', 28), M.copper, root);
  for (const side of [-1, 1]) {
    a.add(loftData([
      { t: z(-0.35), w: 0.010, h: y(0.019), u: side * W * 0.36, v: y(0.051), n: 4 },
      { t: z(-0.277), w: 0.015, h: y(0.022), u: side * W * 0.52, v: y(0.091), n: 4 },
      { t: z(-0.215), w: 0.014, h: y(0.019), u: side * W * 0.54, v: y(side < 0 ? 0.121 : 0.099), n: 4 },
      { t: z(-0.102), w: 0.013, h: y(0.019), u: side * W * 0.51, v: y(side < 0 ? 0.109 : 0.093), n: 4 },
      { t: z(0.012), w: 0.012, h: y(0.013), u: side * W * 0.43, v: y(0.070), n: 3.5 },
      { t: z(0.073), w: 0.006, h: y(0.008), u: side * W * 0.38, v: y(0.049), n: 3 },
    ], 'z', 28), c.shell, root);
    const x = side * W * 0.47;
    // Tapered forward braces carry the exposed rail loads back into the power housing.
    a.add(prismData([[z(-0.135), y(-0.031)], [z(0.17), y(-0.024)], [z(0.253), y(-0.011)], [z(0.251), y(0.022)], [z(0.123), y(0.036)], [z(-0.107), y(0.024)]], 0.013, 0.003), c.trim, root, [x, 0, 0]);
    a.add(prismData([[z(-0.28), y(0.044)], [z(-0.044), y(0.035)], [z(-0.067), y(0.072)], [z(-0.255), y(0.087)]], 0.005, 0.002), M.dark, root, [side * W / 2, 0, 0]);
    a.add(boxData(0.006, 0.008, z(0.134), 0.0013), M.polymer, root, [x + side * 0.006, y(-0.006), z(0.139)]);
    // Ceramic stand-offs hold the bus above the receiver's metal shell.
    a.add(prismData([[z(-0.351), y(0.008)], [z(-0.202), y(0.008)], [z(-0.15), y(0.018)], [z(-0.158), y(0.035)], [z(-0.215), y(0.021)], [z(-0.32), y(0.022)]], 0.007, 0.0015), M.copper, root, [side * W * 0.52, 0, 0]);
    for (const zz of [-0.326, -0.19]) a.add(boxData(0.011, y(0.026), z(0.022), 0.002), M.satin, root, [side * W * 0.50, y(0.017), z(zz)]);
  }
  // Pair of raised shoulders protect the status strip and expose the rear insulator.
  for (const side of [-1, 1]) {
    a.add(prismData([[z(-0.352), y(0.046)], [z(-0.306), y(0.087)], [z(-0.23), y(0.124)], [z(-0.247), y(0.135)], [z(-0.322), y(0.108)], [z(-0.361), y(0.064)]], 0.012, 0.0031), c.trim, root, [side * W * 0.32, 0, 0]);
  }
  for (const [yy, ww] of [[0.015, 0.56], [0.031, 0.58], [0.047, 0.49]]) {
    a.add(boxData(W * ww, y(0.006), z(0.016), 0.0015), M.dark, root, [0, y(yy), z(-0.358)]);
  }
  chassisMark(c, 1, z(0.104), [-W / 2 - 0.0036, y(0.066), z(-0.218)]);
  const bank = a.node('railBank', root, [W * 0.53, y(0.012), z(-0.275)]);
  for (let i = 0; i < 3; i++) {
    const n = a.node('railCap', bank, [0, 0, z(i * 0.054)]);
    a.add(cylZ(0.0125, -0.018, 0.022, 0.003, 16), M.satin, n);
    a.add(tubeZ(0.0135, 0.012, -0.005, 0.002, 16), c.chargeGlow, n);
    c.rig.charge.push({ node: n, travel: 0.006, z0: n.position.z });
  }
  a.add(cylX(0.027, -W * 0.58, W * 0.58, 0.004), M.satin, root, [0, y(-0.051), z(-0.09)]);
  a.add(prismData([[z(-0.256), y(0.109)], [z(-0.129), y(0.104)], [z(-0.162), y(0.125)], [z(-0.242), y(0.127)]], 0.030, 0.0029), M.dark, root);
  return {
    axisY: y(0.0),
    barrelZ: z(0.25),
    core: { pos: [-W / 2 - 0.002, y(-0.017), z(0.051)], len: z(0.14) },
    top: { y: y(0.112), z0: z(-0.2), z1: z(-0.04) },
    status: { y: y(0.129), z: z(-0.219) },
    flank: { y: y(-0.031), z0: z(-0.25), z1: z(0.05), x: W * 0.49 },
    rear: z(-0.363),
  };
}

// ------------------------------------------------------------------ chassis: beam emitter

function beamChassis(c: Ctx): Mounts {
  const { a, M } = c;
  const root = a.root;
  const lattice = c.b.chassis === 'beam_lattice';
  const focus = c.b.chassis === 'beam_focus';
  const L = lattice ? 1.06 : focus ? 0.94 : 1;
  const H = (lattice ? 1.12 : focus ? 0.94 : 1) * (0.96 + 0.08 * c.b.params.bulk);
  const W = lattice ? 0.108 : 0.091;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;

  // Broad, rounded optics housing with a low keel and sweeping side cheeks.
  a.add(loftData([
    { t: z(-0.273), w: W * 0.32, h: y(0.025), v: y(0.013), n: 3 },
    { t: z(-0.217), w: W * 0.49, h: y(0.054), v: y(0.029), n: 4 },
    { t: z(-0.12), w: W * 0.53, h: y(0.061), v: y(0.039), n: 5 },
    { t: z(0.066), w: W * 0.52, h: y(0.047), v: y(0.025), n: 5 },
    { t: z(0.192), w: W * 0.42, h: y(0.041), v: y(0.023), n: 4 },
    { t: z(0.217), w: W * 0.34, h: y(0.034), v: y(0.022), n: 4 },
  ], 'z', 28), M.graphite, root);
  for (const side of [-1, 1]) {
    const x = side * W * 0.47;
    a.add(loftData([
      { t: z(-0.254), w: 0.009, h: y(0.012), u: side * W * 0.38, v: y(0.030), n: 3.4 },
      { t: z(-0.164), w: 0.019, h: y(0.031), u: side * W * 0.55, v: y(0.024), n: 3.4 },
      { t: z(-0.085), w: 0.017, h: y(0.031), u: side * W * 0.67, v: y(0.018), n: 3.4 },
      { t: z(0.013), w: 0.014, h: y(0.025), u: side * W * 0.66, v: y(0.013), n: 3.4 },
      { t: z(0.112), w: 0.016, h: y(0.029), u: side * W * 0.47, v: y(0.020), n: 3.4 },
      { t: z(0.204), w: 0.008, h: y(0.016), u: side * W * 0.34, v: y(0.028), n: 3.4 },
    ], 'z', 36), c.shell, root);
    a.add(prismData([[z(-0.172), y(0.015)], [z(0.05), y(0.016)], [z(0.129), y(0.037)], [z(0.037), y(0.048)], [z(-0.154), y(0.039)]], 0.008, 0.0029), M.dark, root, [x + side * 0.008, 0, 0]);
    a.add(boxData(0.008, 0.006, z(0.108), 0.0012), c.trim, root, [x + side * 0.009, y(-0.014), z(0.009)]);
    // Split crash frame feeds loads around the rear of the optical chamber.
    a.add(prismData([[z(-0.273), y(0.013)], [z(-0.225), y(-0.014)], [z(-0.139), y(-0.021)], [z(-0.151), y(-0.033)], [z(-0.232), y(-0.031)], [z(-0.274), y(-0.004)]], 0.013, 0.003), c.trim, root, [side * W * 0.4, 0, 0]);
    a.add(prismData([[z(-0.27), y(0.027)], [z(-0.206), y(0.047)], [z(-0.14), y(0.066)], [z(-0.14), y(0.08)], [z(-0.229), y(0.066)]], 0.012, 0.0025), M.satin, root, [side * W * 0.35, 0, 0]);
    a.add(boxData(0.005, y(0.006), z(0.052), 0.001), c.chargeGlow, root, [side * W * 0.39, y(0.052), z(-0.205)], [-0.25, 0, 0]);
  }
  chassisMark(c, 2, z(0.091), [-W * 0.47 - 0.0133, y(0.028), z(-0.104)]);

  // The resonator is secured inside a damped cradle. Its internal prism remains animated.
  const chamber = a.node('beamChamber', root, [0, y(0.09), z(-0.042)]);
  a.add(alongZ(lathe([[0.021, -0.054], [0.039, -0.048], [0.042, -0.025], [0.036, 0.026], [0.028, 0.048], [0.021, 0.052]], 28)), M.glass, chamber);
  const coreSpin = a.node('beamCoreSpin', chamber);
  a.add(alongZ(lathe([[0, -0.041], [0.016, -0.025], [0.021, 0.015], [0.013, 0.034], [0, 0.045]], 8)), c.energy, coreSpin);
  c.rig.spin.push({ node: coreSpin, axis: 'z', rate: 1.6 });
  for (const zz of [-0.049, 0.044]) a.add(tubeZ(0.041, 0.028, zz - 0.007, zz + 0.007, 20), c.trim, chamber);
  for (const side of [-1, 1]) {
    a.add(boxData(0.011, 0.012, 0.112, 0.0024), M.graphite, chamber, [side * 0.034, 0.022, -0.003]);
    for (const zz of [-0.047, 0.037]) a.add(cylX(0.006, -0.004, 0.004, 0.0012, 12), M.satin, chamber, [side * 0.039, 0.022, zz]);
  }
  for (const side of [-1, 1]) {
    a.add(prismData([[z(-0.102), y(0.076)], [z(-0.081), y(0.118)], [z(-0.041), y(0.111)], [z(-0.031), y(0.067)]], 0.018, 0.004), M.graphite, root, [side * W * 0.40, 0, 0]);
  }
  a.add(cylX(0.029, -0.046, 0.046, 0.004), M.satin, root, [0, y(-0.055), z(-0.048)]);
  a.add(boxData(0.029, 0.007, z(0.065), 0.0018), M.dark, root, [0, y(0.093), z(-0.156)]);
  return {
    axisY: y(0.025),
    barrelZ: z(0.205),
    core: { pos: [-W * 0.52 - 0.001, y(-0.024), z(0.065)], len: z(0.11) },
    top: { y: y(0.082), z0: z(0.075), z1: z(0.17) },
    status: { y: y(0.098), z: z(-0.156) },
    flank: { y: y(-0.030), z0: z(-0.2), z1: z(0.1), x: W * 0.51 },
    rear: z(-0.274),
  };
}

/** Visible linkage between the drone and the tool receiver. */
function hardpoint(c: Ctx, m: Mounts): void {
  if (!c.mount) return;
  const { a, M } = c;
  const pivot = (m.rear + m.barrelZ) / 2;
  const frame = a.frame('hardpoint', a.root, [0.071, m.flank.y - 0.071, pivot - 0.06], [0.34, -0.46, 0.17]);
  a.add(prismData([[-0.197, -0.016], [0.068, -0.016], [0.116, 0.018], [0.070, 0.039], [-0.173, 0.021]], 0.047, 0.009), M.graphite, frame);
  a.add(prismData([[-0.183, 0.009], [0.067, 0.022], [0.089, 0.029], [0.051, 0.038], [-0.167, 0.024]], 0.038, 0.005), c.trim, frame);
  for (const side of [-1, 1]) {
    a.add(cylX(0.011, -0.005, 0.005, 0.002, 12), M.polymer, frame, [side * 0.024, 0.009, 0.062]);
  }
}

// ------------------------------------------------------------------ barrels / emitters

function barrel(c: Ctx, m: Mounts): number {
  const { a, M, b } = c;
  const slide = c.rig.slide!;
  const ay = m.axisY;
  const z0 = m.barrelZ;
  const lenK = b.params.length;
  const muzzle = (z: number, y = ay, x = 0) => {
    const n = a.node('muzzle', slide, [x, y, z]);
    c.rig.muzzles.push(n);
    return n;
  };
  switch (b.barrel) {
    case 'pb_twin':
    case 'pb_single':
    case 'pb_long': {
      const long = b.barrel === 'pb_long';
      const twin = b.barrel === 'pb_twin';
      const L = (long ? 0.32 : 0.21) + 0.08 * lenK;
      const sh = twin ? 0.036 : 0.03;
      const sw = twin ? 0.058 : 0.055;
      a.add(loftData([
        { t: z0 - 0.019, w: sw * 0.48, h: sh, v: ay, n: 6 },
        { t: z0 + L * 0.13, w: sw * 0.52, h: sh * 0.97, v: ay, n: 6 },
        { t: z0 + L * 0.53, w: sw * 0.47, h: sh * 0.86, v: ay, n: 5 },
        { t: z0 + L * 0.76, w: sw * 0.36, h: sh * 0.67, v: ay, n: 4 },
      ], 'z', 20), M.graphite, slide);
      for (const side of [-1, 1]) {
        a.add(prismData([[z0 - 0.006, ay + sh * 0.38], [z0 + L * 0.38, ay + sh * 0.47], [z0 + L * 0.69, ay + sh * 0.55], [z0 + L * 0.56, ay + sh * 1.06], [z0 - 0.008, ay + sh * 1.12]], 0.012, 0.0038), c.shell, slide, [side * sw * 0.34, 0, 0]);
        a.add(prismData([[z0 + L * 0.09, ay - sh * 0.76], [z0 + L * 0.61, ay - sh * 0.59], [z0 + L * 0.66, ay - sh * 0.79], [z0 + L * 0.25, ay - sh * 1.28]], 0.010, 0.0026), c.trim, slide, [side * sw * 0.36, 0, 0]);
        for (let i = 0; i < (long ? 5 : 4); i++) {
          a.add(boxData(0.006, sh * 0.45, L * 0.034, 0.0012), M.dark, slide, [side * sw * (0.49 - i * 0.012), ay - sh * 0.09, z0 + L * (0.14 + i * 0.102)], [-0.45, 0, 0]);
        }
        a.add(cylZ(0.0035, L * 0.04, L * 0.62, 0.0007, 12), M.copper, slide, [side * sw * 0.49, ay - sh * 0.52, z0]);
        for (const f of [0.09, 0.55]) {
          a.add(boxData(0.011, 0.012, 0.012, 0.002), M.graphite, slide, [side * sw * 0.49, ay - sh * 0.52, z0 + L * f]);
        }
      }
      const bores = twin ? [ay + 0.016, ay - 0.016] : [ay];
      const coils = a.node('coils', slide, [0, 0, 0]);
      for (const by of bores) {
        a.add(cylZ(twin ? 0.011 : 0.0145, z0 + L * 0.5, z0 + L + 0.045, 0.002), M.satin, slide, [0, by, 0]);
        // Accelerator coils (energy) between shroud and tip.
        const coilSpin = a.node('coilSpin', coils, [0, by, 0]);
        for (let i = 0; i < 3; i++) a.add(tubeZ(twin ? 0.016 : 0.0205, twin ? 0.0125 : 0.016, 0, 0.005, 20), c.chargeGlow, coilSpin, [0, 0, z0 + L * 0.8 + i * 0.019]);
        for (let i = 0; i < 4; i++) a.add(tubeZ(twin ? 0.0165 : 0.022, twin ? 0.012 : 0.0155, 0, 0.005), M.dark, coilSpin, [0, 0, z0 + L * 0.8 - 0.006 + i * 0.019]);
        c.rig.spin.push({ node: coilSpin, axis: 'z', rate: 3 });
        // Muzzle crown (heat-reactive tip).
        a.add(alongZ(lathe([[0.009, 0], [0.021, 0], [0.024, 0.006], [0.024, 0.02], [0.018, 0.03], [0.009, 0.03]], 24)), c.heat, slide, [0, by, z0 + L + 0.03]);
        const collar = twin ? 0.017 : 0.0225;
        a.add(tubeZ(collar, collar * 0.77, -0.013, 0.003, 12), c.trim, slide, [0, by, z0 + L + 0.04]);
        muzzle(z0 + L + 0.06, by);
      }
      if (long) {
        // Muzzle brake with side ports.
        a.add(boxData(0.04, 0.03, 0.05, 0.005), M.graphite, slide, [0, ay, z0 + L + 0.01]);
        for (const s of [-1, 1]) for (let i = 0; i < 2; i++) a.add(boxData(0.004, 0.02, 0.009, 0.001), M.dark, slide, [s * 0.0205, ay, z0 + L - 0.004 + i * 0.02]);
      }
      return z0 + L + 0.06;
    }
    case 'rb_open':
    case 'rb_quad':
    case 'rb_shroud': {
      const L = 0.46 + 0.1 * lenK;
      const quad = b.barrel === 'rb_quad';
      const shroud = b.barrel === 'rb_shroud';
      const rails: [number, number, number][] = quad ? [[-0.026, 0.026, 0.785], [0.026, 0.026, -0.785], [-0.026, -0.026, -0.785], [0.026, -0.026, 0.785]] : [[0, 0.03, 0], [0, -0.03, 0]];
      for (const [rx, ry, rz] of rails) {
        const n = a.frame('rail', slide, [rx, ay + ry, 0], [0, 0, rz]);
        const outer = ry > 0 ? 1 : -1;
        // Rail bar: tapered front, inner face lit by charge.
        a.add(prismData([[z0, -0.013], [z0 + L * 0.68, -0.012], [z0 + L, -0.007], [z0 + L + 0.025, 0.001], [z0 + L * 0.925, 0.009], [z0, 0.013]], quad ? 0.015 : 0.025, 0.003), c.trim, n);
        a.add(boxData(quad ? 0.006 : 0.012, 0.002, L * 0.92, 0.0005), c.chargeGlow, n, [0, -outer * 0.0115, z0 + L * 0.48]);
        a.add(prismData([[z0 + L * 0.025, 0], [z0 + L * 0.90, -outer * 0.001], [z0 + L * 0.82, outer * 0.006], [z0 + L * 0.12, outer * 0.012]], quad ? 0.015 : 0.026, 0.002), M.graphite, n, [0, outer * 0.010, 0]);
      }
      // Brackets clamping the rails.
      const nb = 3 + Math.round(lenK);
      for (let i = 0; i < nb; i++) {
        const zz = z0 + 0.04 + (i * (L - 0.08)) / Math.max(1, nb - 1);
        for (const side of [-1, 1]) {
          a.add(prismData([[-0.014, -0.046], [0.012, -0.042], [0.017, 0.039], [-0.012, 0.047]], 0.011, 0.003), M.graphite, slide, [side * (quad ? 0.041 : 0.020), ay, zz]);
        }
        a.add(boxData(quad ? 0.086 : 0.050, 0.009, 0.019, 0.002), c.trim, slide, [0, ay + 0.044, zz]);
        if (!shroud) {
          a.add(boxData(quad ? 0.081 : 0.047, 0.008, 0.015, 0.002), M.graphite, slide, [0, ay - 0.044, zz]);
        }
        for (const side of [-1, 1]) {
          const x = side * (quad ? 0.047 : 0.025);
          a.add(cylX(0.0059, -0.002, 0.002, 0.0009, 10), M.satin, slide, [x, ay + 0.024, zz]);
        }
      }
      // Accelerator rings that pulse forward with charge.
      for (let i = 0; i < 3; i++) {
        const n = a.node('railRing', slide, [0, ay, z0 + 0.1 + i * 0.08]);
        a.add(tubeZ(0.039, 0.036, -0.0028, 0.0028, 24), c.chargeGlow, n);
        c.rig.charge.push({ node: n, travel: 0.02, z0: n.position.z });
      }
      if (shroud) {
        a.add(prismData([[z0, -0.048], [z0 + L * 0.8, -0.045], [z0 + L * 0.85, -0.03], [z0 + L * 0.85, 0.03], [z0 + L * 0.8, 0.045], [z0, 0.048]], 0.066, 0.006), c.shell, slide, [0, ay, 0]);
        for (let i = 0; i < 6; i++) for (const s of [-1, 1]) a.add(boxData(0.004, 0.05, 0.016, 0.001), c.chargeGlow, slide, [s * 0.033, ay, z0 + 0.06 + i * (L * 0.12)]);
      }
      // Firing aperture.
      a.add(alongZ(lathe(tubeProfile(0.012, 0.006, 0, 0.02), 20)), c.heat, slide, [0, ay, z0 + L - 0.01]);
      muzzle(z0 + L + 0.03);
      return z0 + L + 0.03;
    }
    default: {
      // Beam emitters.
      const L = 0.12 + 0.05 * lenK;
      // Emitter neck (satin) out of the body.
      a.add(alongZ(lathe([[0, 0], [0.034, 0], [0.036, 0.004], [0.03, L * 0.6], [0.026, L * 0.65], [0, L * 0.65]], 28)), M.satin, slide, [0, ay, z0 - 0.01]);
      if (b.barrel === 'be_array') {
        // Three prongs around the axis with energy tips.
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI * 2 + Math.PI / 2;
          const n = a.frame('prong', slide, [0, ay, 0], [0, 0, ang]);
          a.add(prismData([[z0 + L * 0.3, 0.02], [z0 + L + 0.03, 0.038], [z0 + L + 0.06, 0.032], [z0 + L + 0.04, 0.022], [z0 + L * 0.6, 0.014]], 0.012, 0.003), c.shell, n);
          a.add(prismData([[z0 + L * 0.42, 0.016], [z0 + L + 0.032, 0.024], [z0 + L + 0.043, 0.02], [z0 + L * 0.65, 0.011]], 0.008, 0.0015), M.satin, n);
          a.add(boxData(0.006, 0.006, 0.02, 0.001), c.chargeGlow, n, [0, 0.03, z0 + L + 0.045]);
        }
        a.add(alongZ(lathe(cylProfile(0.01, 0, 0.03), 16)), c.chargeGlow, slide, [0, ay, z0 + L * 0.65]);
        muzzle(z0 + L + 0.05);
        return z0 + L + 0.06;
      }
      if (b.barrel === 'be_ring') {
        for (let i = 0; i < 3; i++) {
          const n = a.node('resRing', slide, [0, ay, z0 + L * 0.55 + i * 0.035]);
          a.add(tubeZ(0.05 - i * 0.008, 0.042 - i * 0.008, -0.005, 0.005, 32), i === 1 ? c.chargeGlow : c.trim, n);
          for (let k = 0; k < 3; k++) a.add(boxData(0.006, 0.012, 0.012, 0.002), M.dark, n, [Math.cos((k / 3) * Math.PI * 2) * (0.046 - i * 0.008), Math.sin((k / 3) * Math.PI * 2) * (0.046 - i * 0.008), 0]);
          c.rig.spin.push({ node: n, axis: 'z', rate: i % 2 ? -2.2 : 1.6 });
        }
        a.add(alongZ(lathe(cylProfile(0.012, 0, 0.12), 16)), c.chargeGlow, slide, [0, ay, z0 + L * 0.5]);
        muzzle(z0 + L + 0.08);
        return z0 + L + 0.08;
      }
      // Recessed optics with a dark flare hood and three load-bearing ribs.
      a.add(alongZ(lathe([[0.024, 0], [0.035, 0], [0.051, L * 0.27], [0.056, L * 0.37], [0.055, L * 0.47], [0.048, L * 0.47], [0.045, L * 0.30], [0.026, 0.004]], 32)), M.graphite, slide, [0, ay, z0 + L * 0.55]);
      for (let i = 0; i < 3; i++) {
        const rib = a.frame('lensRib', slide, [0, ay, z0], [0, 0, i * Math.PI * 2 / 3]);
        a.add(prismData([[L * 0.23, 0.031], [L * 0.38, 0.043], [L * 0.87, 0.061], [L * 0.97, 0.055], [L * 0.48, 0.032]], 0.021, 0.005), c.shell, rib);
        a.add(boxData(0.008, 0.0036, L * 0.20, 0.0009), c.chargeGlow, rib, [0, 0.055, L * 0.68], [-0.23, 0, 0]);
      }
      a.add(alongZ(lathe([[0, 0], [0.04, 0], [0.043, 0.004], [0.04, 0.008], [0, 0.012]], 32)), M.glass, slide, [0, ay, z0 + L * 0.55 + L * 0.3]);
      a.add(alongZ(lathe([[0, 0], [0.022, 0], [0, 0.006]], 24)), c.chargeGlow, slide, [0, ay, z0 + L * 0.55 + L * 0.3]);
      a.add(tubeZ(0.055, 0.052, 0, 0.008, 28), c.heat, slide, [0, ay, z0 + L * 0.92]);
      muzzle(z0 + L + 0.02);
      return z0 + L + 0.02;
    }
  }
}

// ------------------------------------------------------------------ cores

function core(c: Ctx, m: Mounts): void {
  const { a, M, b } = c;
  const root = a.root;
  const [cx, cy, cz] = m.core.pos;
  switch (b.core) {
    case 'co_ring': {
      // Toroid chamber around the barrel root, clamped to the receiver nose.
      const n = a.node('coreRing', root, [0, m.axisY, m.barrelZ - 0.01]);
      a.add(alongZ(lathe([[0.034, -0.016], [0.044, -0.016], [0.048, -0.01], [0.048, 0.01], [0.044, 0.016], [0.034, 0.016], [0.034, -0.016]], 32)), M.glass, n);
      const spin = a.node('coreRingSpin', n);
      a.add(tubeZ(0.042, 0.037, -0.008, 0.008, 32), c.energy, spin);
      for (let k = 0; k < 4; k++) a.add(boxData(0.012, 0.016, 0.036, 0.003), M.dark, spin, [Math.cos(k * Math.PI / 2 + 0.78) * 0.046, Math.sin(k * Math.PI / 2 + 0.78) * 0.046, 0]);
      c.rig.spin.push({ node: spin, axis: 'z', rate: 0.8 });
      break;
    }
    case 'co_dense': {
      // Vertical canister on the top rear: glass sleeve, energy column, satin caps.
      const n = a.frame('coreDense', root, [0, m.top.y + 0.004, Math.min(m.top.z0, -0.08) - 0.04]);
      a.add(lathe(cylProfile(0.026, 0, 0.012, 0.003)), M.satin, n);
      a.add(lathe([[0.02, 0.012], [0.02, 0.06]], 24), M.glass, n);
      a.add(lathe(cylProfile(0.012, 0.012, 0.06, 0.002), 16), c.energy, n);
      a.add(lathe(cylProfile(0.024, 0.06, 0.072, 0.003)), M.satin, n);
      for (let k = 0; k < 3; k++) a.add(boxData(0.005, 0.05, 0.005, 0.001), M.dark, n, [Math.cos(k * 2.09) * 0.022, 0.036, Math.sin(k * 2.09) * 0.022]);
      break;
    }
    case 'co_prism': {
      // Faceted crystal in an open gimbal on the visible flank.
      const n = a.node('corePrism', root, [cx - 0.022, cy + 0.035, cz]);
      a.add(tubeZ(0.032, 0.027, -0.004, 0.004, 32), c.trim, n, [0, 0, 0], [0, Math.PI / 2, 0]);
      const g = a.node('gimbal', n);
      a.add(alongX(latheData(tubeProfile(0.026, 0.022, -0.003, 0.003), 32)), c.trim, g, [0, 0, 0], [0, 0, Math.PI / 2]);
      const crystal = a.node('crystal', g);
      a.add(lathe([[0, -0.02], [0.013, 0], [0, 0.02]], 6), c.energy, crystal);
      c.rig.spin.push({ node: g, axis: 'y', rate: 1.2 }, { node: crystal, axis: 'x', rate: 2.4 });
      a.add(boxData(0.02, 0.008, 0.05, 0.002), M.dark, root, [cx - 0.006, cy + 0.002, cz]);
      break;
    }
    default: {
      // co_cell: horizontal cell on the visible flank behind a glass window.
      const len = Math.min(0.15, m.core.len);
      const n = a.frame('coreCell', root, [cx - 0.014, cy + 0.03, cz]);
      a.add(cylZ(0.019, -len / 2, -len / 2 + 0.016, 0.003), M.satin, n);
      a.add(cylZ(0.019, len / 2 - 0.016, len / 2, 0.003), M.satin, n);
      a.add(alongZ(latheData([[0.0175, -len / 2 + 0.016], [0.0175, len / 2 - 0.016]], 24)), M.glass, n);
      a.add(cylZ(0.008, -len / 2 + 0.014, len / 2 - 0.014, 0.002, 16), c.energy, n);
      for (let k = 0; k < 2; k++) a.add(tubeZ(0.021, 0.0178, -0.005, 0.005, 16), M.dark, n, [0, 0, -len / 6 + (k * len) / 3]);
      for (const side of [-1, 1]) {
        a.add(boxData(0.007, 0.004, len * 0.87, 0.0013), c.trim, n, [-0.010, side * 0.016, 0]);
      }
      a.add(boxData(0.012, 0.03, len + 0.01, 0.003), M.graphite, root, [cx - 0.002, cy + 0.03, cz]);
    }
  }
}

// ------------------------------------------------------------------ cooling

function cooling(c: Ctx, m: Mounts): void {
  const { a, M, b } = c;
  const root = a.root;
  switch (b.cooling) {
    case 'cl_jacket': {
      // Ribbed jacket around the barrel root with heat bands.
      const n = a.frame('jacket', c.rig.slide!, [0, m.axisY, m.barrelZ]);
      a.add(cylZ(c.b.family === 'rail' ? 0.024 : 0.03, 0, 0.07, 0.003), M.graphite, n);
      for (let i = 0; i < 6; i++) a.add(tubeZ(c.b.family === 'rail' ? 0.028 : 0.035, 0.022, 0.006 + i * 0.011, 0.01 + i * 0.011), i % 2 ? c.heat : M.dark, n);
      break;
    }
    case 'cl_sink': {
      // Heat-sink block on the lower flank with a grille.
      const f = m.flank;
      const len = Math.min(0.13, f.z1 - f.z0);
      const zc = f.z0 + len / 2 + 0.02;
      a.add(boxData(0.018, 0.04, len, 0.004), M.graphite, root, [-f.x - 0.009, f.y, zc]);
      for (let i = 0; i < 9; i++) a.add(boxData(0.008, 0.032, 0.0035, 0.0008), c.heat, root, [-f.x - 0.02, f.y, zc - len / 2 + 0.01 + (i * (len - 0.02)) / 8]);
      break;
    }
    default: {
      // Low-profile radiators on a common saddle, with independently hinged vanes.
      const t = m.top;
      const n = 6;
      const vane = loftData([
        { t: -0.026, w: 0.0017, h: 0.003, v: 0.004, n: 4 },
        { t: -0.018, w: 0.003, h: 0.0075, v: 0.008, n: 5 },
        { t: 0.018, w: 0.003, h: 0.0075, v: 0.008, n: 5 },
        { t: 0.026, w: 0.0017, h: 0.003, v: 0.004, n: 4 },
      ], 'x', 12);
      for (let i = 0; i < n; i++) {
        const node = a.node('fin', root, [0, t.y + 0.002, t.z0 + 0.012 + (i * (t.z1 - t.z0 - 0.02)) / (n - 1)]);
        a.add(vane, c.heat, node, [0, 0, 0], [-0.4, 0, 0]);
        c.rig.fins.push({ node, max: -0.55 });
      }
      a.add(prismData([[t.z0 - 0.012, t.y - 0.019], [t.z1 + 0.017, t.y - 0.02], [t.z1, t.y + 0.003], [t.z0, t.y + 0.003]], 0.056, 0.004), c.trim, root);
    }
  }
}

// ------------------------------------------------------------------ attachments

function attachments(c: Ctx, m: Mounts, front: number): void {
  const { a, M, b } = c;
  const root = a.root;
  for (const id of b.attachments) {
    switch (id) {
      case 'at_sight': {
        const zs = b.family === 'rail' ? -0.05 : b.family === 'beam' ? 0.1 : -0.06;
        const ys = m.top.y + (b.family === 'rail' ? 0.004 : 0.012);
        const n = a.frame('sight', root, [0, ys, zs]);
        a.add(boxData(0.03, 0.01, 0.07, 0.003), M.dark, n);
        a.add(prismData([[-0.03, 0.005], [0.03, 0.005], [0.024, 0.04], [-0.022, 0.04]], 0.006, 0.0015), M.graphite, n, [-0.018, 0, 0]);
        a.add(prismData([[-0.03, 0.005], [0.03, 0.005], [0.024, 0.04], [-0.022, 0.04]], 0.006, 0.0015), M.graphite, n, [0.018, 0, 0]);
        a.add(boxData(0.042, 0.006, 0.05, 0.002), c.shell, n, [0, 0.042, 0]);
        a.add(boxData(0.03, 0.028, 0.002, 0.0005), M.glass, n, [0, 0.024, 0.018]);
        a.add(boxData(0.003, 0.003, 0.001, 0.0003), c.energy, n, [0, 0.026, 0.0185]);
        break;
      }
      case 'at_plating': {
        for (const s of [-1, 1]) {
          a.add(prismData([[-0.06, -0.02], [0.07, -0.02], [0.08, 0.0], [0.06, 0.022], [-0.07, 0.022]], 0.006, 0.0018), c.shell, root, [s * (m.flank.x + 0.012), m.flank.y + 0.035, (m.flank.z0 + m.flank.z1) / 2 + 0.03]);
          for (let k = 0; k < 2; k++) a.add(cylX(0.0035, -0.002, 0.002, 0.0008, 10), c.trim, root, [s * (m.flank.x + 0.016), m.flank.y + 0.035, (m.flank.z0 + m.flank.z1) / 2 - 0.02 + k * 0.1]);
        }
        break;
      }
      case 'at_conduit': {
        // Two lit conduits from the core bay forward along the visible flank.
        const [cx, cy, cz] = m.core.pos;
        const z1 = Math.min(front - 0.08, m.barrelZ + 0.05);
        for (let k = 0; k < 2; k++) {
          const yy = cy + 0.062 + k * 0.012;
          a.add(cylZ(0.0045, cz, z1, 0.001, 12), M.dark, root, [cx - 0.006, yy, 0]);
          a.add(cylZ(0.0025, cz + 0.01, z1 - 0.01, 0.0005, 8), c.energy, root, [cx - 0.0095, yy, 0]);
          for (const zz of [cz, z1]) a.add(boxData(0.012, 0.008, 0.012, 0.002), c.trim, root, [cx - 0.004, yy, zz]);
        }
        break;
      }
      case 'at_capacitor': {
        const f = m.flank;
        for (let k = 0; k < 2; k++) {
          const n = a.frame('auxCap', root, [-f.x - 0.014, f.y - 0.012, f.z1 - 0.02 - k * 0.04]);
          a.add(lathe(cylProfile(0.012, -0.022, 0.022, 0.003), 18), M.satin, n);
          a.add(lathe(tubeProfile(0.0128, 0.011, -0.003, 0.003), 18), c.chargeGlow, n);
        }
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ module hardware

interface SocketMount {
  kind: SocketKind;
  pos: V3;
}

function socketMounts(c: Ctx, m: Mounts, front: number): SocketMount[] {
  const b = c.b;
  const out: SocketMount[] = [];
  const used: Record<SocketKind, number> = { barrel: 0, power: 0, system: 0 };
  const barrelSpan = front - m.barrelZ;
  for (const kind of b.sockets) {
    const i = used[kind]++;
    if (kind === 'barrel') out.push({ kind, pos: [0, m.axisY, m.barrelZ + barrelSpan * (0.28 + i * 0.22)] });
    else if (kind === 'power') out.push({ kind, pos: [-m.flank.x - 0.012, m.flank.y + 0.006, m.flank.z0 + 0.03 + i * 0.07] });
    else out.push({ kind, pos: i === 0 ? [-m.flank.x - 0.012, m.top.y - 0.03, (m.top.z0 + m.top.z1) / 2] : [0.0, m.top.y + 0.005, m.top.z0 - 0.07] });
  }
  return out;
}

function moduleHardware(c: Ctx, m: Mounts, front: number, installed: (ItemInstance | null)[]): void {
  const { a, M } = c;
  const mounts = socketMounts(c, m, front);
  mounts.forEach((mt, i) => {
    const mod = installed[i];
    const parent = mt.kind === 'barrel' ? c.rig.slide! : a.root;
    const vis0: ModuleVisual | null = installed[i] ? (moduleTypeDef(installed[i]!.module?.type)?.visual ?? 'chip') : null;
    const n = vis0 === 'gyro' ? a.node(`socket${i}`, parent, mt.pos) : a.frame(`socket${i}`, parent, mt.pos);
    if (!mod) {
      // Empty socket: a capped port so sockets read as hardware even when unused.
      if (mt.kind !== 'barrel') {
        a.add(boxData(0.01, 0.018, 0.018, 0.003), M.dark, n);
        a.add(boxData(0.004, 0.006, 0.006, 0.001), c.trim, n, [-0.004, 0, 0]);
      }
      return;
    }
    const vis: ModuleVisual = moduleTypeDef(mod.module?.type)?.visual ?? 'chip';
    const r = c.b.family === 'rail' ? 0.06 : c.b.family === 'beam' ? 0.04 : 0.036;
    switch (vis) {
      case 'collar':
        a.add(tubeZ(r + 0.006, r - 0.006, -0.01, 0.01, 32), c.trim, n);
        a.add(tubeZ(r + 0.0065, r + 0.004, -0.003, 0.003, 32), c.energy, n);
        break;
      case 'coil':
        for (let k = 0; k < 4; k++) a.add(tubeZ(r + 0.004, r - 0.003, -0.012 + k * 0.008, -0.008 + k * 0.008, 28), k % 2 ? c.chargeGlow : c.trim, n);
        break;
      case 'gyro': {
        const g = a.node('gyro', n);
        a.add(tubeZ(r + 0.012, r + 0.007, -0.003, 0.003, 32), c.trim, g);
        a.add(alongX(latheData(tubeProfile(r + 0.012, r + 0.007, -0.003, 0.003), 32)), M.satin, g);
        c.rig.spin.push({ node: g, axis: 'z', rate: 2.5 });
        break;
      }
      case 'fork':
        for (const s of [-1, 1]) {
          a.add(prismData([[0, -0.006], [0.07, -0.004], [0.08, 0.004], [0, 0.006]], 0.008, 0.002), c.trim, n, [s * 0.026, 0, front - mt.pos[2] - 0.07]);
          a.add(boxData(0.009, 0.005, 0.01, 0.001), c.energy, n, [s * 0.026, 0, front - mt.pos[2] + 0.01]);
        }
        break;
      case 'capacitor':
        for (let k = 0; k < 2; k++) {
          a.add(cylZ(0.011, -0.025, 0.025, 0.003, 18), M.satin, n, [-0.004, -0.012 + k * 0.024, 0]);
          a.add(tubeZ(0.0118, 0.0102, -0.004, 0.004, 18), c.chargeGlow, n, [-0.004, -0.012 + k * 0.024, 0]);
        }
        break;
      case 'exchanger':
        a.add(boxData(0.016, 0.03, 0.06, 0.003), M.graphite, n);
        for (let k = 0; k < 6; k++) a.add(boxData(0.006, 0.026, 0.004, 0.001), c.heat, n, [-0.01, 0, -0.024 + k * 0.0096]);
        break;
      case 'fins':
        a.add(boxData(0.012, 0.03, 0.05, 0.003), M.graphite, n);
        for (let k = 0; k < 5; k++) a.add(boxData(0.014, 0.034, 0.003, 0.0008), M.satin, n, [-0.004, 0, -0.02 + k * 0.01]);
        break;
      default:
        // chip: processor block with a lit sensor lens.
        a.add(boxData(0.012, 0.022, 0.034, 0.003), M.dark, n);
        a.add(boxData(0.004, 0.016, 0.026, 0.001), c.trim, n, [-0.007, 0, 0]);
        a.add(alongX(latheData(cylProfile(0.004, -0.0025, 0.0025, 0.0008), 12)), c.energy, n, [-0.009, 0, 0.006]);
    }
  });
}

// ------------------------------------------------------------------ entry point

export function energyColor(b: WeaponBuild, element?: string): [number, number, number] {
  const e = elementEnergy(FAMILIES[b.family].energy, element);
  // Core type shifts the tone a little; the hue parameter adds a subtle per-weapon drift.
  const k = b.core === 'co_dense' ? 1.25 : b.core === 'co_prism' ? 1.15 : 1;
  const h = (b.params.hue - 0.5) * 0.35;
  return [Math.max(0.05, e[0] * k * (1 + h)), e[1] * k * (1 - h * 0.3), Math.max(0.05, e[2] * k * (1 - h))];
}

export function buildWeaponModel(scene: Scene, build: WeaponBuild, installed: (ItemInstance | null)[] = [], opts: ModelOpts = {}, rarityIndex = 0): WeaponRig {
  const root = new TransformNode(`${opts.name ?? 'wpn'}Root`, scene);
  const a = new Assembler(scene, root, opts);
  const M = weaponMaterials(scene);
  const ec = energyColor(build, opts.element);
  const energy = weaponGlow(scene, 'wpnEnergy', ec);
  const chargeGlow = weaponGlow(scene, 'wpnCharge', [ec[0] * 0.35, ec[1] * 0.35, ec[2] * 0.35]);
  const heat = heatMetal(scene, 'wpnHeat');
  const ledOn = weaponGlow(scene, 'wpnLedOn', [ec[0] * 0.8, ec[1] * 0.8, ec[2] * 0.8]);
  const ledHot = weaponGlow(scene, 'wpnLedHot', [3, 0.5, 0.08]);
  const ledOff = weaponGlow(scene, 'wpnLedOff', [0.02, 0.025, 0.03]);
  const owned = [energy, chargeGlow, heat, ledOn, ledHot, ledOff];
  const rig: Ctx['rig'] = { spin: [], fins: [], charge: [], muzzles: [] };
  const c: Ctx = { mount: opts.mount !== false, a, M, shell: M.shell(build.finish), trim: rarityIndex >= 2 ? M.trim(build.finish) : M.satin, energy, chargeGlow, heat, b: build, rarity: rarityIndex, rig };
  rig.slide = a.node('slide', root);

  const mounts = build.family === 'rail' ? railChassis(c) : build.family === 'beam' ? beamChassis(c) : build.family === 'swarm' ? swarmChassis(c) : plasmaChassis(c);
  hardpoint(c, mounts);
  const front = build.family === 'swarm' ? swarmBarrel(c, mounts) : barrel(c, mounts);
  core(c, mounts);
  cooling(c, mounts);
  attachments(c, mounts, front);
  moduleHardware(c, mounts, front, installed);
  // Epic and above: machined accent inlays along the shell.
  if (rarityIndex >= 3) for (const s of [-1, 1]) a.add(boxData(0.0025, 0.0025, 0.12, 0.0006), M.trim(build.finish), root, [s * (mounts.flank.x + 0.006), mounts.top.y - 0.012, mounts.top.z0 - 0.05]);
  // Heat LEDs: 5 segments on the top-rear status window.
  const leds: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    leds.push(a.single(boxData(0.015, 0.003, 0.006, 0.0008), ledOff, root, [0, mounts.status.y, mounts.status.z - 0.018 + i * 0.009]));
  }
  a.finalize();

  const meshes = a.meshes;
  return {
    root,
    family: build.family,
    build,
    muzzles: rig.muzzles,
    slide: rig.slide,
    spin: rig.spin,
    fins: rig.fins,
    charge: rig.charge,
    leds,
    ledOn,
    ledHot,
    ledOff,
    energy,
    energyBase: new Color3(...ec),
    chargeGlow,
    heat,
    front,
    rear: mounts.rear,
    meshes,
    dispose() {
      root.dispose(false, false);
      for (const m of owned) m.dispose(true, true);
    },
  };
}
