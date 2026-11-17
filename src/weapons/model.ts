import { Color3, type Material, Matrix, Mesh, type PBRMaterial, Quaternion, type Scene, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import type { WeaponFamily } from '../data/defs';
import type { ItemInstance } from '../loot/types';
import { FAMILIES, type SocketKind, type WeaponBuild } from './build';
import { boxData, cylProfile, latheData, type P2, prismData, tubeProfile } from './geometry';
import { heatMetal, weaponGlow, type WeaponMaterials, weaponMaterials } from './materials';
import { moduleTypeDef, type ModuleVisual } from './modules';

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
  charge: { node: TransformNode; travel: number }[];
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
}

type V3 = [number, number, number];

// ------------------------------------------------------------------ assembler

function copyVd(vd: VertexData): VertexData {
  const o = new VertexData();
  o.positions = Array.from(vd.positions as ArrayLike<number>);
  o.normals = Array.from(vd.normals as ArrayLike<number>);
  o.uvs = Array.from(vd.uvs as ArrayLike<number>);
  o.indices = Array.from(vd.indices as ArrayLike<number>);
  return o;
}

/** Lathe (+Y axis) -> +Z axis (proper rotation). */
function alongZ(vd: VertexData): VertexData {
  const sw = (a: number[]) => {
    for (let i = 0; i < a.length; i += 3) {
      const y = a[i + 1];
      const z = a[i + 2];
      a[i + 1] = -z;
      a[i + 2] = y;
    }
  };
  sw(vd.positions as number[]);
  sw(vd.normals as number[]);
  return vd;
}

/** Lathe (+Y axis) -> +X axis (proper rotation). */
function alongX(vd: VertexData): VertexData {
  const sw = (a: number[]) => {
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i];
      const y = a[i + 1];
      a[i] = y;
      a[i + 1] = -x;
    }
  };
  sw(vd.positions as number[]);
  sw(vd.normals as number[]);
  return vd;
}

class Assembler {
  private buckets = new Map<string, { node: TransformNode; mat: Material; parts: VertexData[] }>();
  readonly nodes: TransformNode[] = [];
  readonly meshes: Mesh[] = [];
  constructor(readonly scene: Scene, readonly root: TransformNode, private opts: ModelOpts) {}

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
    mesh.doNotSyncBoundingInfo = true;
    if (this.opts.renderingGroupId !== undefined) mesh.renderingGroupId = this.opts.renderingGroupId;
    if (this.opts.layerMask !== undefined) mesh.layerMask = this.opts.layerMask;
    this.meshes.push(mesh);
  }

  finalize(): void {
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

const lathe = (p: P2[], tess = 24) => latheData(p, tess);
const cylZ = (r: number, z0: number, z1: number, ch = 0.002, tess = 24) => alongZ(latheData(cylProfile(r, z0, z1, ch), tess));
const tubeZ = (ro: number, ri: number, z0: number, z1: number, tess = 28) => alongZ(latheData(tubeProfile(ro, ri, z0, z1), tess));
const cylX = (r: number, x0: number, x1: number, ch = 0.002, tess = 20) => alongX(latheData(cylProfile(r, x0, x1, ch), tess));

interface Ctx {
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
interface Mounts {
  /** Barrel axis: y height and z where the barrel starts. */
  axisY: number;
  barrelZ: number;
  /** Core bay on the visible (-x) flank: centre + available length along z. */
  core: { pos: V3; len: number };
  /** Top surface y and z-range available for fins/sight. */
  top: { y: number; z0: number; z1: number };
  /** Lower flank for heat sinks / capacitors. */
  flank: { y: number; z0: number; z1: number; x: number };
  rear: number;
}

// ------------------------------------------------------------------ chassis: plasma repeater

function plasmaChassis(c: Ctx): Mounts {
  const { a, M } = c;
  const root = a.root;
  const heavy = c.b.chassis === 'heavy_repeater';
  const light = c.b.chassis === 'light_repeater';
  const L = heavy ? 1.08 : light ? 0.86 : 1; // length scale
  const H = (heavy ? 1.14 : light ? 0.9 : 1) * (0.96 + 0.08 * c.b.params.bulk);
  const W = heavy ? 0.078 : light ? 0.064 : 0.07;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;
  // Upper shell: angular receiver with a raked nose and a stepped rear.
  a.add(prismData([[z(-0.2), y(0.004)], [z(0.215), y(0.004)], [z(0.25), y(0.03)], [z(0.235), y(0.074)], [z(0.13), y(0.094)], [z(-0.1), y(0.094)], [z(-0.165), y(0.084)], [z(-0.205), y(0.05)]], W, 0.007), c.shell, root);
  // Lower frame (graphite): carries the mount and the core bay.
  a.add(prismData([[z(-0.19), y(-0.048)], [z(0.15), y(-0.048)], [z(0.2), y(-0.022)], [z(0.205), y(0.006)], [z(-0.215), y(0.006)], [z(-0.225), y(-0.02)]], W - 0.008, 0.005), M.graphite, root);
  // Tail: energy pack housing with a polymer pad.
  a.add(prismData([[z(-0.31), y(-0.03)], [z(-0.2), y(-0.04)], [z(-0.2), y(0.072)], [z(-0.255), y(0.07)], [z(-0.315), y(0.035)]], W - 0.014, 0.006), M.graphite, root);
  a.add(boxData(W - 0.02, y(0.085), 0.016, 0.004), M.polymer, root, [0, y(0.016), z(-0.318)]);
  // Side inset panels and seams (visible flank and the far side).
  for (const s of [-1, 1]) {
    a.add(prismData([[z(-0.12), y(0.026)], [z(0.1), y(0.026)], [z(0.125), y(0.05)], [z(0.1), y(0.074)], [z(-0.1), y(0.074)]], 0.004, 0.0012), M.dark, root, [s * (W / 2 + 0.0015), 0, 0]);
    a.add(boxData(0.003, 0.004, z(0.3), 0.001), c.trim, root, [s * (W / 2 + 0.001), y(0.006), z(0.0)]);
    // Rear grip ribs.
    for (let i = 0; i < 4; i++) a.add(boxData(0.003, y(0.05), 0.007, 0.001), M.dark, root, [s * ((W - 0.014) / 2 + 0.001), y(0.018), z(-0.29 + i * 0.018)]);
  }
  // Top rail with teeth.
  a.add(boxData(0.026, 0.008, z(0.2), 0.002), M.dark, root, [0, y(0.098), z(-0.02)]);
  for (let i = 0; i < 8; i++) a.add(boxData(0.03, 0.005, 0.009, 0.0015), M.dark, root, [0, y(0.104), z(-0.105 + i * 0.024)]);
  // Mount yoke: pivot drum and the drone hardpoint arm (runs off-screen to the hull).
  a.add(cylX(0.026, -0.04, 0.04, 0.004), M.satin, root, [0, y(-0.058), z(-0.02)]);
  a.add(prismData([[-0.05, -0.03], [0.03, -0.03], [0.02, 0.02], [-0.06, 0.02]], 0.05, 0.005), M.graphite, root, [0.03, y(-0.07), z(-0.02)]);
  a.add(boxData(0.04, 0.045, 0.34, 0.006), M.graphite, root, [0.1, y(-0.13), -0.12], [0.35, -0.55, 0.15]);
  a.add(boxData(0.044, 0.012, 0.3, 0.003), c.trim, root, [0.1, y(-0.105), -0.13], [0.35, -0.55, 0.15]);
  // Status window on the top rear (heat LEDs sit here).
  a.add(boxData(0.03, 0.006, 0.07, 0.002), M.dark, root, [0, y(0.097), z(-0.15)]);
  return {
    axisY: y(0.042),
    barrelZ: z(0.235),
    core: { pos: [-(W / 2) - 0.002, y(0.0), z(-0.03)], len: z(0.2) },
    top: { y: y(0.094), z0: z(0.0), z1: z(0.12) },
    flank: { y: y(-0.025), z0: z(-0.15), z1: z(0.1), x: (W - 0.008) / 2 },
    rear: z(-0.32),
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
  const W = siege ? 0.08 : 0.072;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;
  // Long spine (graphite) and a raised power housing at the rear (shell).
  a.add(prismData([[z(-0.3), y(-0.035)], [z(0.22), y(-0.035)], [z(0.25), y(-0.01)], [z(0.25), y(0.03)], [z(-0.3), y(0.03)]], W - 0.016, 0.005), M.graphite, root);
  a.add(prismData([[z(-0.34), y(0.0)], [z(-0.02), y(0.0)], [z(0.03), y(0.05)], [z(0.0), y(0.105)], [z(-0.22), y(0.115)], [z(-0.32), y(0.09)], [z(-0.36), y(0.04)]], W, 0.008), c.shell, root);
  // Forward upper shroud bridging housing and rails.
  a.add(prismData([[z(0.0), y(0.03)], [z(0.22), y(0.03)], [z(0.26), y(0.05)], [z(0.24), y(0.07)], [z(0.02), y(0.075)]], W - 0.024, 0.005), c.shell, root);
  // Visible-flank capacitor bank: three cans in a cage.
  const bank = a.node('railBank', root, [-(W / 2) - 0.012, y(0.055), z(-0.2)]);
  for (let i = 0; i < 3; i++) {
    const n = a.node('railCap', bank, [0, 0, i * 0.052]);
    a.add(cylZ(0.016, -0.022, 0.022, 0.003), M.satin, n);
    a.add(tubeZ(0.0172, 0.014, -0.006, 0.006), c.chargeGlow, n);
    c.rig.charge.push({ node: n, travel: 0.006 });
  }
  a.add(boxData(0.006, 0.042, z(0.17), 0.002), M.dark, root, [-(W / 2) - 0.004, y(0.055), z(-0.15)]);
  for (const s of [-1, 1]) a.add(boxData(0.028, 0.004, z(0.17), 0.001), M.dark, root, [-(W / 2) - 0.012, y(0.055) + s * 0.019, z(-0.15)]);
  // Seams and trim.
  for (const s of [-1, 1]) {
    a.add(boxData(0.003, 0.004, z(0.28), 0.001), c.trim, root, [s * (W / 2 + 0.001), y(0.02), z(-0.18)]);
    a.add(prismData([[z(-0.26), y(0.03)], [z(-0.05), y(0.03)], [z(-0.03), y(0.06)], [z(-0.24), y(0.08)]], 0.004, 0.001), M.dark, root, [s * (W / 2 + 0.0015), 0, 0]);
  }
  // Mount yoke and hardpoint arm.
  a.add(cylX(0.028, -0.042, 0.042, 0.004), M.satin, root, [0, y(-0.05), z(-0.08)]);
  a.add(boxData(0.04, 0.045, 0.34, 0.006), M.graphite, root, [0.1, y(-0.12), -0.18], [0.35, -0.55, 0.15]);
  a.add(boxData(0.044, 0.012, 0.3, 0.003), c.trim, root, [0.1, y(-0.095), -0.19], [0.35, -0.55, 0.15]);
  a.add(boxData(0.03, 0.006, 0.07, 0.002), M.dark, root, [0, y(0.118), z(-0.2)]);
  return {
    axisY: y(0.0),
    barrelZ: z(0.25),
    core: { pos: [-(W / 2) - 0.002, y(0.0), z(0.1)], len: z(0.14) },
    top: { y: y(0.115), z0: z(-0.2), z1: z(-0.04) },
    flank: { y: y(-0.02), z0: z(-0.25), z1: z(0.05), x: (W - 0.016) / 2 },
    rear: z(-0.36),
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
  const W = lattice ? 0.096 : 0.086;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;
  // Bulky body: lower frame + a stepped upper shell around the central focus chamber.
  a.add(prismData([[z(-0.22), y(-0.045)], [z(0.14), y(-0.045)], [z(0.2), y(-0.015)], [z(0.2), y(0.02)], [z(-0.24), y(0.02)]], W - 0.01, 0.006), M.graphite, root);
  a.add(prismData([[z(-0.25), y(0.015)], [z(0.18), y(0.015)], [z(0.215), y(0.045)], [z(0.17), y(0.085)], [z(0.07), y(0.09)], [z(0.05), y(0.07)], [z(-0.07), y(0.07)], [z(-0.09), y(0.09)], [z(-0.2), y(0.09)], [z(-0.26), y(0.05)]], W, 0.009), c.shell, root);
  // Central focus chamber: large glass sphere in a ring cradle (the family's signature).
  const chamber = a.node('beamChamber', root, [0, y(0.088), z(-0.01)]);
  a.add(lathe([[0, -0.042], [0.03, -0.03], [0.042, 0], [0.03, 0.03], [0, 0.042]], 28), M.glass, chamber);
  const coreSpin = a.node('beamCoreSpin', chamber);
  a.add(lathe([[0, -0.026], [0.02, -0.008], [0.02, 0.008], [0, 0.026]], 8), c.energy, coreSpin);
  c.rig.spin.push({ node: coreSpin, axis: 'y', rate: 1.6 });
  a.add(tubeZ(0.05, 0.042, -0.008, 0.008, 32), c.trim, chamber, [0, 0, 0], [0, 0, 0]);
  a.add(alongX(latheData(tubeProfile(0.05, 0.043, -0.006, 0.006), 32)), M.dark, chamber);
  // Side radiator grilles on both flanks (heat-reactive edges).
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const f = a.node('beamFin', root, [s * (W / 2 + 0.004), y(0.04), z(-0.18 + i * 0.026)]);
      a.add(boxData(0.008, y(0.05), 0.006, 0.0015), M.dark, f);
      a.add(boxData(0.0085, y(0.006), 0.0062, 0.001), c.heat, f, [0, y(0.026), 0]);
      if (s < 0) c.rig.fins.push({ node: f, max: 0.35 });
    }
    a.add(boxData(0.003, 0.004, z(0.3), 0.001), c.trim, root, [s * (W / 2 + 0.001), y(0.005), z(0.0)]);
  }
  a.add(boxData(W - 0.03, y(0.07), 0.016, 0.004), M.polymer, root, [0, y(0.02), z(-0.26)]);
  // Mount yoke and hardpoint arm.
  a.add(cylX(0.03, -0.046, 0.046, 0.004), M.satin, root, [0, y(-0.058), z(-0.04)]);
  a.add(boxData(0.04, 0.045, 0.34, 0.006), M.graphite, root, [0.1, y(-0.13), -0.15], [0.35, -0.55, 0.15]);
  a.add(boxData(0.044, 0.012, 0.3, 0.003), c.trim, root, [0.1, y(-0.105), -0.16], [0.35, -0.55, 0.15]);
  a.add(boxData(0.03, 0.006, 0.07, 0.002), M.dark, root, [0, y(0.093), z(-0.15)]);
  return {
    axisY: y(0.025),
    barrelZ: z(0.205),
    core: { pos: [-(W / 2) - 0.002, y(-0.01), z(0.08)], len: z(0.11) },
    top: { y: y(0.09), z0: z(0.075), z1: z(0.17) },
    flank: { y: y(-0.02), z0: z(-0.2), z1: z(0.1), x: (W - 0.01) / 2 },
    rear: z(-0.27),
  };
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
      // Shroud: angular prism with a raked front, vent slots on top.
      a.add(prismData([[z0 - 0.01, ay - sh], [z0 + L * 0.72, ay - sh * 0.86], [z0 + L * 0.78, ay - sh * 0.55], [z0 + L * 0.78, ay + sh * 0.7], [z0 + L * 0.66, ay + sh], [z0 - 0.01, ay + sh * 1.05]], twin ? 0.052 : 0.046, 0.006), c.shell, slide);
      const slots = long ? 5 : 3;
      for (let i = 0; i < slots; i++) a.add(boxData(0.03, 0.006, 0.014, 0.002), M.dark, slide, [0, ay + sh * 1.0, z0 + 0.03 + i * (L * 0.55 / slots)]);
      for (const s of [-1, 1]) a.add(boxData(0.003, sh * 0.6, L * 0.5, 0.001), M.dark, slide, [s * ((twin ? 0.052 : 0.046) / 2 + 0.001), ay, z0 + L * 0.32]);
      const bores = twin ? [ay + 0.016, ay - 0.016] : [ay];
      const coils = a.node('coils', slide, [0, 0, 0]);
      for (const by of bores) {
        a.add(cylZ(twin ? 0.0095 : 0.012, z0 + L * 0.5, z0 + L + 0.045, 0.002), M.satin, slide, [0, by, 0]);
        // Accelerator coils (energy) between shroud and tip.
        const coilSpin = a.node('coilSpin', coils, [0, by, 0]);
        for (let i = 0; i < 3; i++) a.add(tubeZ(twin ? 0.0165 : 0.021, twin ? 0.011 : 0.0135, 0, 0.006), c.chargeGlow, coilSpin, [0, 0, z0 + L * 0.8 + i * 0.016]);
        for (let i = 0; i < 2; i++) a.add(tubeZ(twin ? 0.015 : 0.019, twin ? 0.0105 : 0.013, 0, 0.004), M.dark, coilSpin, [0, 0, z0 + L * 0.8 + 0.009 + i * 0.016]);
        c.rig.spin.push({ node: coilSpin, axis: 'z', rate: 3 });
        // Muzzle crown (heat-reactive tip).
        a.add(alongZ(lathe([[0.008, 0], [0.017, 0], [0.019, 0.008], [0.017, 0.024], [0.011, 0.028], [0.008, 0.028]], 20)), c.heat, slide, [0, by, z0 + L + 0.03]);
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
        const n = a.node('rail', slide, [rx, ay + ry, 0], [0, 0, rz]);
        const outer = ry > 0 ? 1 : -1;
        // Rail bar: tapered front, inner face lit by charge.
        a.add(prismData([[z0, -0.011], [z0 + L, -0.008], [z0 + L + 0.025, 0.0], [z0 + L, 0.008], [z0, 0.011]], quad ? 0.012 : 0.02, 0.003), c.trim, n);
        a.add(boxData(quad ? 0.006 : 0.012, 0.002, L * 0.92, 0.0005), c.chargeGlow, n, [0, -outer * 0.0115, z0 + L * 0.48]);
        a.add(boxData(quad ? 0.014 : 0.024, 0.006, L * 0.9, 0.002), M.dark, n, [0, outer * 0.012, z0 + L * 0.47]);
      }
      // Brackets clamping the rails.
      const nb = 3 + Math.round(lenK);
      for (let i = 0; i < nb; i++) {
        const zz = z0 + 0.04 + (i * (L - 0.08)) / Math.max(1, nb - 1);
        a.add(prismData([[-0.009, -0.05], [0.009, -0.05], [0.009, 0.05], [-0.009, 0.05]], quad ? 0.075 : 0.05, 0.004), M.graphite, slide, [0, ay, zz]);
        a.add(boxData(quad ? 0.078 : 0.053, 0.008, 0.004, 0.001), c.trim, slide, [0, ay + 0.044, zz]);
      }
      // Accelerator rings that pulse forward with charge.
      for (let i = 0; i < 3; i++) {
        const n = a.node('railRing', slide, [0, ay, z0 + 0.1 + i * 0.08]);
        a.add(tubeZ(0.052, 0.045, -0.004, 0.004, 32), c.chargeGlow, n);
        c.rig.charge.push({ node: n, travel: 0.02 });
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
          const n = a.node('prong', slide, [0, ay, 0], [0, 0, ang]);
          a.add(prismData([[z0 + L * 0.3, 0.02], [z0 + L + 0.03, 0.038], [z0 + L + 0.06, 0.032], [z0 + L + 0.04, 0.022], [z0 + L * 0.6, 0.014]], 0.012, 0.003), c.shell, n);
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
      // be_lens: flared horn + crystal lens.
      a.add(alongZ(lathe([[0.024, 0], [0.03, 0], [0.05, L * 0.3], [0.052, L * 0.36], [0.046, L * 0.36], [0.026, 0.004]], 32)), c.shell, slide, [0, ay, z0 + L * 0.55]);
      a.add(alongZ(lathe([[0, 0], [0.04, 0], [0.043, 0.004], [0.04, 0.008], [0, 0.012]], 32)), M.glass, slide, [0, ay, z0 + L * 0.55 + L * 0.3]);
      a.add(alongZ(lathe([[0, 0], [0.022, 0], [0, 0.006]], 24)), c.chargeGlow, slide, [0, ay, z0 + L * 0.55 + L * 0.3]);
      a.add(tubeZ(0.054, 0.049, 0, 0.006, 32), c.heat, slide, [0, ay, z0 + L * 0.55 + L * 0.34]);
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
      const n = a.node('coreDense', root, [0, m.top.y + 0.004, Math.min(m.top.z0, -0.08) - 0.04]);
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
      const n = a.node('coreCell', root, [cx - 0.014, cy + 0.03, cz]);
      a.add(cylZ(0.019, -len / 2, -len / 2 + 0.016, 0.003), M.satin, n);
      a.add(cylZ(0.019, len / 2 - 0.016, len / 2, 0.003), M.satin, n);
      a.add(alongZ(latheData([[0.0175, -len / 2 + 0.016], [0.0175, len / 2 - 0.016]], 24)), M.glass, n);
      a.add(cylZ(0.009, -len / 2 + 0.014, len / 2 - 0.014, 0.002, 16), c.energy, n);
      for (let k = 0; k < 2; k++) a.add(tubeZ(0.021, 0.0178, -0.004, 0.004), M.dark, n, [0, 0, -len / 6 + (k * len) / 3]);
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
      const n = a.node('jacket', c.rig.slide!, [0, m.axisY, m.barrelZ]);
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
      // cl_fins: fin stack on top that flares open with heat.
      const t = m.top;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const node = a.node('fin', root, [0, t.y + 0.002, t.z0 + 0.012 + (i * (t.z1 - t.z0 - 0.02)) / (n - 1)]);
        a.add(prismData([[-0.004, 0], [0.004, 0], [0.003, 0.02], [-0.002, 0.022]], 0.05, 0.0012), M.dark, node);
        a.add(boxData(0.051, 0.003, 0.0045, 0.0006), c.heat, node, [0, 0.021, -0.0005]);
        c.rig.fins.push({ node, max: -0.55 });
      }
      a.add(boxData(0.056, 0.004, t.z1 - t.z0, 0.001), M.graphite, root, [0, t.y, (t.z0 + t.z1) / 2]);
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
        const n = a.node('sight', root, [0, ys, zs]);
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
          const n = a.node('auxCap', root, [-f.x - 0.014, f.y - 0.012, f.z1 - 0.02 - k * 0.04]);
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
    const n = a.node(`socket${i}`, parent, mt.pos);
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

export function energyColor(b: WeaponBuild): [number, number, number] {
  const e = FAMILIES[b.family].energy;
  // Core type shifts the tone a little; the hue parameter adds a subtle per-weapon drift.
  const k = b.core === 'co_dense' ? 1.25 : b.core === 'co_prism' ? 1.15 : 1;
  const h = (b.params.hue - 0.5) * 0.35;
  return [Math.max(0.05, e[0] * k * (1 + h)), e[1] * k * (1 - h * 0.3), Math.max(0.05, e[2] * k * (1 - h))];
}

export function buildWeaponModel(scene: Scene, build: WeaponBuild, installed: (ItemInstance | null)[] = [], opts: ModelOpts = {}, rarityIndex = 0): WeaponRig {
  const root = new TransformNode(`${opts.name ?? 'wpn'}Root`, scene);
  const a = new Assembler(scene, root, opts);
  const M = weaponMaterials(scene);
  const ec = energyColor(build);
  const energy = weaponGlow(scene, 'wpnEnergy', ec);
  const chargeGlow = weaponGlow(scene, 'wpnCharge', [ec[0] * 0.35, ec[1] * 0.35, ec[2] * 0.35]);
  const heat = heatMetal(scene, 'wpnHeat');
  const ledOn = weaponGlow(scene, 'wpnLedOn', [ec[0] * 0.8, ec[1] * 0.8, ec[2] * 0.8]);
  const ledHot = weaponGlow(scene, 'wpnLedHot', [3, 0.5, 0.08]);
  const ledOff = weaponGlow(scene, 'wpnLedOff', [0.02, 0.025, 0.03]);
  const owned = [energy, chargeGlow, heat, ledOn, ledHot, ledOff];
  const rig: Ctx['rig'] = { spin: [], fins: [], charge: [], muzzles: [] };
  const c: Ctx = { a, M, shell: M.shell(build.finish), trim: rarityIndex >= 2 ? M.trim(build.finish) : M.satin, energy, chargeGlow, heat, b: build, rarity: rarityIndex, rig };
  rig.slide = a.node('slide', root);

  const mounts = build.family === 'rail' ? railChassis(c) : build.family === 'beam' ? beamChassis(c) : plasmaChassis(c);
  const front = barrel(c, mounts);
  core(c, mounts);
  cooling(c, mounts);
  attachments(c, mounts, front);
  moduleHardware(c, mounts, front, installed);
  // Epic and above: machined accent inlays along the shell.
  if (rarityIndex >= 3) for (const s of [-1, 1]) a.add(boxData(0.0025, 0.0025, 0.12, 0.0006), M.trim(build.finish), root, [s * (mounts.flank.x + 0.006), mounts.top.y - 0.012, mounts.top.z0 - 0.05]);
  // Heat LEDs: 5 segments on the top-rear status window.
  const leds: Mesh[] = [];
  const ledZ = (build.family === 'rail' ? -0.2 : -0.15) * 1;
  const ledY = build.family === 'rail' ? mounts.top.y + 0.004 : build.family === 'beam' ? mounts.top.y + 0.004 : mounts.top.y + 0.0065;
  for (let i = 0; i < 5; i++) leds.push(a.single(boxData(0.02, 0.003, 0.009, 0.0008), ledOff, root, [0, ledY, ledZ - 0.026 + i * 0.013]));
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
