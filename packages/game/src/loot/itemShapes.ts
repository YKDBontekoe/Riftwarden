import { type Material } from '@babylonjs/core/Materials/material';
import { type TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { CurrencyKey } from '@riftwarden/rules/economy/currencies';
import { boxData, cylProfile, latheData, type P2, prismData, tubeProfile } from '../weapons/geometry';
import type { Assembler, V3 } from '../weapons/model';
import type { WeaponMaterials } from '../weapons/materials';
import { colossusFlankData, overseerGimbalData } from '../visuals/bossParts';

/**
 * Hard-surface sculpts for every non-weapon item base and every currency prop. Items are
 * built from the same chamfered primitives and material library as the procedural weapons,
 * so a dropped shield emitter, a merchant thumbnail and the viewmodel share one look.
 * Units are metres at "real" scale (callers normalise the size); +y up, +z forward.
 */
export interface Sculptor {
  a: Assembler;
  root: TransformNode;
  M: WeaponMaterials;
  /** Painted main shell, darker secondary shell and machined trim. */
  shell: Material;
  dark: Material;
  trim: Material;
  /** The base's accent energy (unlit HDR). */
  glow: Material;
  /** Dim accent for inlays that should not bloom. */
  dim: Material;
}

/** Accent energy colour per base (HDR, > 1 blooms). Rarity reads from the rim and beam instead. */
export const ACCENT: Readonly<Record<string, V3>> = {
  kinetic_plating: [1.6, 0.9, 0.35], composite_armor: [0.4, 1.4, 1.9], bulwark_plating: [2.2, 0.8, 0.2], colossus_plating: [2.6, 0.92, 0.23],
  shield_matrix: [0.35, 1.3, 2.6], barrier_lattice: [0.4, 2.2, 1.6],
  reactor_core: [0.5, 2.2, 2.6], fusion_cell: [2.4, 1.5, 0.4],
  overseer_logic: [2.9, 0.95, 0.24], combat_processor: [2.2, 0.7, 0.3], tactical_processor: [0.4, 1.8, 2.4],
  servo_booster: [0.5, 1.6, 2.6], field_uplink: [0.6, 2.4, 1.0], targeting_lens: [2.6, 0.5, 0.4],
  frag_charge: [2.8, 1.0, 0.25], cryo_charge: [0.6, 1.8, 2.8], arc_pulse: [1.6, 1.8, 2.8], blink_drive: [1.7, 0.6, 2.8],
  aegis_cell: [2.6, 1.9, 0.5], shield_wall: [0.4, 1.5, 2.8], holo_decoy: [0.4, 2.6, 2.0], mini_sentry: [2.4, 1.3, 0.3],
  orbital_lance: [2.8, 0.6, 0.3], overdrive_core: [2.8, 1.2, 0.25],
  siege_module: [2.8, 0.4, 0.25], prism_module: [2.6, 0.3, 0.9], amp_module: [2.6, 0.9, 0.3], cooling_module: [0.4, 1.7, 2.8],
  crit_module: [2.7, 0.5, 0.7], overcharge_module: [2.5, 2.1, 0.4], splitter_module: [0.4, 2.4, 2.4], arc_conductor: [1.4, 1.7, 2.8],
  thermal_module: [2.8, 0.8, 0.25], stabilizer_module: [0.6, 2.4, 1.2], barrel_module: [1.6, 1.6, 1.6], coolant_module: [0.4, 1.7, 2.8],
  capacitor_module: [2.5, 2.1, 0.4], arc_module: [1.4, 1.7, 2.8],
};

export const CURRENCY_ACCENT: Readonly<Record<CurrencyKey, V3>> = {
  credits: [0.4, 1.8, 2.6], salvage: [2.2, 1.0, 0.35], components: [1.6, 0.6, 2.6], shards: [0.35, 2.6, 1.9],
  xp: [2.4, 2.0, 0.6], cores: [0.4, 2.2, 2.6], tactical: [1.4, 1.0, 2.6],
};

// ---------------------------------------------------------------- primitives

const add = (s: Sculptor, vd: ReturnType<typeof boxData>, m: Material, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) => s.a.add(vd, m, s.root, pos, rot, scale);
const box = (s: Sculptor, w: number, h: number, d: number, m: Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], ch = 0.006) => add(s, boxData(w, h, d, Math.min(ch, w * 0.3, h * 0.3, d * 0.3)), m, pos, rot);
/** Cylinder along local +y, centred. */
const cyl = (s: Sculptor, r: number, h: number, m: Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], tess = 24, ch = 0.005) => add(s, latheData(cylProfile(r, -h / 2, h / 2, ch), tess), m, pos, rot);
const tube = (s: Sculptor, ro: number, ri: number, h: number, m: Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], tess = 28) => add(s, latheData(tubeProfile(ro, ri, -h / 2, h / 2, 0.003), tess), m, pos, rot);
/**
 * Surface of revolution. latheData faces each segment by its direction (counter-clockwise in
 * the (r, y) plane = outward), so profiles are oriented here: authors can write them either way.
 */
const lathe = (s: Sculptor, p: P2[], m: Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], tess = 24, scale: V3 = [1, 1, 1]) => add(s, latheData(outward(p), tess), m, pos, rot, scale);

export function outward(p: P2[]): P2[] {
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    area += x0 * y1 - x1 * y0;
  }
  return area < 0 ? [...p].reverse() : p;
}
/** Side outline (z, y) extruded across x. */
const prism = (s: Sculptor, p: P2[], width: number, m: Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], ch = 0.006) => add(s, prismData(p, width, ch), m, pos, rot);
/** Torus around local +y: a lathe of a small circle. */
function ring(s: Sculptor, r: number, thick: number, m: Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], tess = 36) {
  const p: P2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = Math.PI * 2 * (i / 8) - Math.PI / 2;
    p.push([r + Math.cos(t) * thick, Math.sin(t) * thick]);
  }
  lathe(s, p, m, pos, rot, tess);
}
/** Sphere / ellipsoid (radius r, then scaled). */
function ball(s: Sculptor, r: number, m: Material, pos: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], tess = 20) {
  const p: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = -Math.PI / 2 + Math.PI * (i / 10);
    p.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  p[0][0] = 0;
  p[10][0] = 0;
  lathe(s, p, m, pos, [0, 0, 0], tess, scale);
}
/** Regular polygon outline in (z, y). */
function ngon(n: number, r: number, turn = 0): P2[] {
  return Array.from({ length: n }, (_, i) => {
    const t = turn + (Math.PI * 2 * i) / n;
    return [Math.cos(t) * r, Math.sin(t) * r] as P2;
  });
}
/** n copies around the y axis. */
function around(n: number, fn: (t: number, i: number) => void, offset = 0) {
  for (let i = 0; i < n; i++) fn(offset + (Math.PI * 2 * i) / n, i);
}
const polar = (r: number, t: number, y: number): V3 => [Math.sin(t) * r, y, Math.cos(t) * r];

/** Small hex bolt heads along a line (decoration). */
function bolts(s: Sculptor, pts: V3[], rot: V3 = [0, 0, 0]) {
  for (const p of pts) cyl(s, 0.011, 0.008, s.trim, p, rot, 6, 0.002);
}

// ---------------------------------------------------------------- armour

function chestplate(s: Sculptor, heavy: number, layers: number) {
  // Breastplate: a tapered, faceted plate seen front-on (outline in z/y on the x = 0 plane, rotated to face +z).
  const w = 0.2 + heavy * 0.05;
  const plate: P2[] = [[-w, 0.19], [-w * 0.55, 0.24], [w * 0.55, 0.24], [w, 0.19], [w * 0.92, -0.05], [w * 0.42, -0.24], [-w * 0.42, -0.24], [-w * 0.92, -0.05]];
  prism(s, plate, 0.05 + heavy * 0.02, s.shell, [0, 0, 0], [0, Math.PI / 2, 0], 0.012);
  prism(s, plate.map(([x, y]) => [x * 0.94, y * 0.92]), 0.045, s.dark, [0, 0, -0.038], [0, Math.PI / 2, 0], 0.01);
  // Raised sternum ridge and abdominal layers.
  prism(s, [[-0.05, 0.2], [0.05, 0.2], [0.07, -0.02], [0, -0.21], [-0.07, -0.02]], 0.04, s.dark, [0, 0, 0.03 + heavy * 0.01], [0, Math.PI / 2, 0], 0.008);
  for (let i = 0; i < layers; i++) {
    const y = -0.08 - i * 0.055;
    box(s, w * (1.5 - i * 0.25), 0.04, 0.035, i % 2 ? s.dark : s.shell, [0, y, 0.035 + heavy * 0.01], [0.12, 0, 0], 0.008);
  }
  // Pauldrons: half-lathed caps on the shoulders.
  for (const side of [-1, 1]) {
    const shoulder = side * (w + 0.025);
    const angle = side * -0.34;
    prism(s, [[-0.095, -0.02], [-0.08, 0.055], [0.048, 0.072], [0.103, 0.018], [0.078, -0.05], [-0.052, -0.06]], 0.15, s.shell, [shoulder, 0.167, 0], [0, 0, angle], 0.014);
    box(s, 0.125, 0.032, 0.16, s.dark, [shoulder, 0.118, 0], [0, 0, angle], 0.01);
    box(s, 0.022, 0.022, 0.105, s.trim, [shoulder + side * 0.04, 0.22, 0], [0, 0, angle]);
    box(s, 0.045, 0.1, 0.035, s.trim, [side * w * 0.82, -0.08, -0.063], [0, 0, side * 0.22]);
  }
  // Collar and the accent visor slit.
  box(s, w * 1.1, 0.035, 0.06, s.dark, [0, 0.23, -0.01]);
  box(s, w * 0.9, 0.014, 0.01, s.glow, [0, 0.12, 0.05 + heavy * 0.012]);
  for (const side of [-1, 1]) box(s, 0.012, 0.11, 0.008, s.glow, [side * w * 0.6, 0.02, 0.04 + heavy * 0.012], [0, 0, side * 0.2]);
  bolts(s, [[-w * 0.8, 0.16, 0.04], [w * 0.8, 0.16, 0.04], [-w * 0.75, -0.06, 0.04], [w * 0.75, -0.06, 0.04]], [Math.PI / 2, 0, 0]);
}

function kineticPlating(s: Sculptor) {
  chestplate(s, 0, 2);
  for (const side of [-1, 1]) box(s, 0.1, 0.026, 0.023, s.trim, [side * 0.107, -0.01, 0.067], [0, 0, side * 0.13]);
}

function compositeArmor(s: Sculptor) {
  chestplate(s, 0.4, 3);
  // Ceramic tiles riveted over the plate.
  for (const [x, y] of [[-0.129, 0.075], [0.129, 0.075], [-0.116, -0.032], [0.116, -0.032]] as P2[]) {
    prism(s, ngon(6, 0.061, Math.PI / 6), 0.025, s.M.equipmentCeramic, [x, y, 0.058], [0, Math.PI / 2, 0], 0.006);
  }
}

function bulwarkPlating(s: Sculptor) {
  // Tower-shield style slab with a viewing slit and heavy rivets.
  const outline: P2[] = [[-0.2, 0.3], [0.2, 0.3], [0.24, 0.18], [0.22, -0.2], [0, -0.32], [-0.22, -0.2], [-0.24, 0.18]];
  prism(s, outline, 0.07, s.shell, [0, 0, 0], [0, Math.PI / 2, 0], 0.016);
  prism(s, outline.map(([z, y]) => [z * 0.8, y * 0.8] as P2), 0.04, s.dark, [0, 0, 0.035], [0, Math.PI / 2, 0], 0.01);
  box(s, 0.28, 0.03, 0.02, s.glow, [0, 0.16, 0.058]);
  box(s, 0.05, 0.36, 0.03, s.trim, [0, -0.04, 0.06]);
  for (const side of [-1, 1]) {
    prism(s, [[-0.08, 0.22], [0.02, 0.2], [0.04, -0.19], [-0.025, -0.23]], 0.045, s.trim, [side * 0.194, -0.012, 0.055], [0, Math.PI / 2, side * -0.07], 0.007);
    box(s, 0.046, 0.09, 0.052, s.dark, [side * 0.17, 0.235, -0.02], [0, 0, side * 0.24]);
  }
  for (const side of [-1, 1]) for (const y of [0.24, 0.05, -0.14]) bolts(s, [[side * 0.17, y, 0.04]], [Math.PI / 2, 0, 0]);
  // Rear grip.
  box(s, 0.2, 0.04, 0.04, s.M.polymer, [0, 0, -0.06]);
}

function colossusPlating(s: Sculptor) {
  // The boss's actual ejectable flank, with the rail and one mount still attached.
  add(s, colossusFlankData(), s.trim, [0, 0.025, 0.014], [0, -Math.PI / 2, 0], [0.29, 0.27, 0.26]);
  const backing: P2[] = [[-0.252, -0.094], [-0.165, -0.188], [0.119, -0.153], [0.243, -0.119], [0.267, 0.078], [0.178, 0.17], [-0.1, 0.169], [-0.24, 0.088]];
  prism(s, backing, 0.071, s.shell, [0, -0.011, -0.064], [0, Math.PI / 2, 0], 0.013);
  box(s, 0.49, 0.069, 0.047, s.dark, [-0.02, -0.038, -0.113], [0, 0, -0.047], 0.012);
  box(s, 0.376, 0.048, 0.055, s.dark, [-0.024, -0.137, 0.101], [0, -0.026, -0.055], 0.009);
  box(s, 0.184, 0.018, 0.013, s.glow, [-0.103, -0.134, 0.13], [0, -0.026, -0.055], 0.004);
  box(s, 0.143, 0.018, 0.013, s.dim, [0.075, -0.144, 0.135], [0, -0.026, -0.055], 0.004);
  for (const x of [-0.173, 0, 0.16]) {
    const y = -0.009 - x * 0.15;
    prism(s, [[-0.089, -0.024], [0.082, -0.023], [0.104, 0.017], [0.081, 0.04], [-0.06, 0.026]], 0.026, s.dark, [x, y, 0.091], [0, 0, 0.24], 0.008);
    cyl(s, 0.016, 0.022, s.shell, [x + 0.024, y + 0.033, 0.109], [Math.PI / 2, 0, 0], 6);
  }
  for (const y of [-0.082, 0.044]) {
    tube(s, 0.043, 0.024, 0.049, s.trim, [-0.177, y, -0.139], [Math.PI / 2, 0, 0], 10);
    cyl(s, 0.019, 0.077, s.M.copper, [-0.177, y, -0.147], [Math.PI / 2, 0, 0], 8);
  }
  // The opposite bracket sheared across the bolt hole, leaving a bent pair of tabs.
  const tornMount: P2[] = [[-0.081, -0.089], [-0.06, -0.067], [-0.074, -0.02], [-0.032, -0.041], [-0.016, 0.018], [0.007, -0.001], [0.087, 0.047], [0.109, -0.031], [0.063, -0.069]];
  prism(s, tornMount, 0.038, s.trim, [0.225, 0.123, -0.106], [0.14, Math.PI / 2, -0.31], 0.003);
  prism(s, tornMount, 0.029, s.dark, [0.248, 0.109, -0.135], [0.24, Math.PI / 2, -0.45], 0.003);
  for (const x of [0.075, 0.113, 0.149]) box(s, 0.018, 0.048, 0.019, s.M.copper, [x, -0.114, -0.123], [0.47, 0, -0.22]);
}

// ---------------------------------------------------------------- shields

function shieldMatrix(s: Sculptor) {
  // Emitter puck projecting a hex barrier dome.
  lathe(s, [[0, -0.1], [0.16, -0.1], [0.19, -0.07], [0.19, -0.03], [0.15, 0], [0, 0]], s.shell, [0, 0, 0], [0, 0, 0], 32);
  tube(s, 0.13, 0.1, 0.03, s.trim, [0, 0.005, 0]);
  cyl(s, 0.1, 0.02, s.glow, [0, 0.005, 0], [0, 0, 0], 24);
  around(3, (t) => {
    prism(s, [[-0.044, -0.088], [0.03, -0.088], [0.03, 0.015], [-0.028, 0.098], [-0.068, 0.098], [-0.039, 0.04]], 0.049, s.shell, polar(0.177, t, 0.075), [0, t, 0], 0.007);
    box(s, 0.043, 0.034, 0.065, s.trim, polar(0.135, t, 0.175), [0, t, 0]);
    box(s, 0.012, 0.05, 0.012, s.glow, polar(0.175, t, 0.08), [0, -t, 0]);
  });
  tube(s, 0.18, 0.158, 0.017, s.dark, [0, -0.074, 0]);
  // Translucent dome + a hex band of glowing facets.
  lathe(s, [[0.21, 0.02], [0.2, 0.1], [0.16, 0.18], [0.09, 0.23], [0, 0.245]], s.M.glass, [0, 0, 0], [0, 0, 0], 6);
  around(6, (t) => box(s, 0.12, 0.008, 0.008, s.glow, polar(0.19, t + Math.PI / 6, 0.1), [0, t + Math.PI / 6 + Math.PI / 2, 0.5]));
}

function barrierLattice(s: Sculptor) {
  // Hexagonal lattice frame with glowing panes and a rear emitter spine.
  around(6, (t) => {
    const at: V3 = [Math.sin(t) * 0.208, Math.cos(t) * 0.208, 0];
    box(s, 0.046, 0.24, 0.062, s.shell, at, [0, 0, -t + Math.PI / 2], 0.01);
    box(s, 0.018, 0.15, 0.016, s.dim, [at[0] * 1.04, at[1] * 1.04, 0.032], [0, 0, -t + Math.PI / 2]);
  }, Math.PI / 6);
  for (let i = 0; i < 6; i++) {
    const t = (Math.PI * 2 * i) / 6;
    box(s, 0.016, 0.24, 0.016, s.dark, [Math.sin(t) * 0.12, Math.cos(t) * 0.12, 0], [0, 0, -t]);
  }
  prism(s, ngon(6, 0.24, Math.PI / 6), 0.008, s.M.glass, [0, 0, 0], [0, Math.PI / 2, 0], 0.002);
  prism(s, ngon(6, 0.07, Math.PI / 6), 0.03, s.glow, [0, 0, 0], [0, Math.PI / 2, 0], 0.004);
  around(6, (t) => cyl(s, 0.022, 0.05, s.trim, [Math.sin(t) * 0.245, Math.cos(t) * 0.245, 0], [Math.PI / 2, 0, 0], 8), 0);
  box(s, 0.06, 0.32, 0.05, s.dark, [0, 0, -0.04]);
  for (const y of [-0.11, 0.11]) box(s, 0.15, 0.048, 0.06, s.trim, [0, y, -0.055]);
}

// ---------------------------------------------------------------- reactors

function reactorCore(s: Sculptor) {
  // Upright canister: caps, a glass window around a glowing rod, cooling fins.
  lathe(s, [[0, 0.16], [0.12, 0.16], [0.13, 0.2], [0.11, 0.23], [0, 0.23]], s.shell, [0, 0, 0], [0, 0, 0], 28);
  lathe(s, [[0, -0.23], [0.11, -0.23], [0.13, -0.2], [0.12, -0.16], [0, -0.16]], s.shell, [0, 0, 0], [0, 0, 0], 28);
  cyl(s, 0.05, 0.36, s.glow, [0, 0, 0], [0, 0, 0], 16);
  lathe(s, cylProfile(0.095, -0.17, 0.17, 0.003, true), s.M.glass, [0, 0, 0], [0, 0, 0], 28);
  around(4, (t) => {
    box(s, 0.033, 0.38, 0.042, s.dark, polar(0.113, t, 0), [0, t, 0]);
    for (const y of [-0.19, 0.19]) box(s, 0.07, 0.072, 0.05, s.shell, polar(0.12, t, y), [0, t, 0], 0.009);
  }, Math.PI / 4);
  around(8, (t) => box(s, 0.014, 0.047, 0.038, s.trim, polar(0.134, t, 0.198), [0, t, 0]));
  ring(s, 0.1, 0.01, s.trim, [0, 0.1, 0]);
  ring(s, 0.1, 0.01, s.trim, [0, -0.1, 0]);
  cyl(s, 0.03, 0.06, s.trim, [0, 0.25, 0], [0, 0, 0], 12);
  tube(s, 0.093, 0.067, 0.018, s.M.copper, [0, -0.235, 0]);
}

function fusionCell(s: Sculptor) {
  // Spherical cell in a cage of rods between two rings.
  ball(s, 0.11, s.glow);
  ball(s, 0.15, s.M.glass, [0, 0, 0], [1, 1, 1], 24);
  ring(s, 0.17, 0.018, s.shell, [0, 0.15, 0]);
  ring(s, 0.17, 0.018, s.shell, [0, -0.15, 0]);
  around(6, (t) => {
    prism(s, [[-0.038, -0.16], [0.023, -0.16], [0.046, -0.058], [0.046, 0.058], [0.023, 0.16], [-0.038, 0.16], [-0.002, 0]], 0.022, s.dark, polar(0.163, t, 0), [0, t, 0], 0.004);
    for (const y of [-0.155, 0.155]) box(s, 0.035, 0.053, 0.06, s.trim, polar(0.16, t, y), [0, t, 0]);
  });
  for (const y of [-0.191, 0.191]) lathe(s, cylProfile(0.092, -0.026, 0.026, 0.006), s.M.copper, [0, y, 0], [0, 0, 0], 8);
  ring(s, 0.155, 0.008, s.glow, [0, 0, 0], [0, 0, Math.PI / 2]);
}

// ---------------------------------------------------------------- processors

function chipBoard(s: Sculptor, w: number) {
  box(s, w, 0.046, w, s.M.polymer, [0, -0.016, 0], [0, 0, 0], 0.011);
  box(s, w * 0.96, 0.027, w * 0.96, s.shell, [0, 0.016, 0]);
  for (const side of [-1, 1]) {
    box(s, 0.043, 0.052, w * 0.73, s.dark, [side * w * 0.44, 0.032, 0], [0, 0, 0], 0.008);
    for (let i = -2; i <= 2; i++) {
      box(s, 0.019, 0.016, 0.041, s.M.equipmentContacts, [i * w * 0.138, -0.016, side * (w / 2 + 0.01)]);
    }
  }
  bolts(s, [[w * 0.43, 0.032, w * 0.4], [-w * 0.43, 0.032, -w * 0.4]]);
}

function combatProcessor(s: Sculptor) {
  chipBoard(s, 0.32);
  box(s, 0.166, 0.067, 0.172, s.dark, [0, 0.059, 0], [0, 0, 0], 0.012);
  box(s, 0.129, 0.024, 0.132, s.trim, [0, 0.1, 0], [0, 0.13, 0], 0.008);
  box(s, 0.076, 0.015, 0.073, s.glow, [0, 0.11, 0], [0, 0.13, 0], 0.007);
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    box(s, 0.01, 0.105 - i * 0.012, 0.174, i % 2 ? s.trim : s.M.equipmentFin, [side * (0.095 + i * 0.015), 0.062, 0], [0.09, 0, 0]);
  }
  // Traces.
  for (const [x, z, w, d] of [[-0.09, -0.1, 0.1, 0.008], [-0.12, 0.05, 0.008, 0.16], [0.03, 0.12, 0.14, 0.008]] as [number, number, number, number][]) box(s, w, 0.006, d, s.dim, [x, 0.03, z]);
  for (const x of [-0.056, 0, 0.056]) box(s, 0.023, 0.017, 0.022, s.dim, [x, 0.038, -0.127]);
}

function tacticalProcessor(s: Sculptor) {
  chipBoard(s, 0.3);
  lathe(s, [[0, 0.02], [0.08, 0.02], [0.09, 0.04], [0.06, 0.07], [0, 0.07]], s.shell, [0, 0.01, 0], [0, 0, 0], 24);
  cyl(s, 0.035, 0.012, s.glow, [0, 0.085, 0], [0, 0, 0], 20);
  // Uplink dish on a short mast.
  cyl(s, 0.021, 0.15, s.trim, [0.093, 0.095, -0.082], [0, 0, -0.22], 8);
  lathe(s, [[0.009, 0], [0.08, 0.026], [0.092, 0.045], [0.081, 0.048], [0.024, 0.017]], s.shell, [0.108, 0.172, -0.082], [0.5, 0, 0.3], 24);
  cyl(s, 0.027, 0.049, s.dark, [-0.104, 0.053, 0.082], [0, 0, 0], 6);
  ball(s, 0.017, s.glow, [0.105, 0.22, -0.068]);
  around(4, (t) => box(s, 0.05, 0.006, 0.01, s.dim, polar(0.11, t, 0.03), [0, t, 0]), Math.PI / 4);
}

function overseerLogic(s: Sculptor) {
  const face: V3 = [Math.PI / 2, 0, 0];
  lathe(s, [[0, -0.157], [0.09, -0.153], [0.124, -0.096], [0.15, 0.014], [0.128, 0.101], [0.089, 0.143], [0, 0.143]], s.dark, [0, 0, 0], face, 24);
  tube(s, 0.134, 0.093, 0.056, s.trim, [0, 0, 0.118], face, 24);
  tube(s, 0.105, 0.075, 0.032, s.shell, [0, 0, 0.144], face, 12);
  ball(s, 0.072, s.glow, [0, 0, 0.148], [1, 1, 0.37]);
  ring(s, 0.084, 0.007, s.dim, [0, 0, 0.16], face);
  ball(s, 0.087, s.M.glass, [0, 0, 0.151], [1, 1, 0.47]);
  ring(s, 0.184, 0.016, s.dark, [0, 0, -0.027], [1.16, 0.38, 0]);
  ring(s, 0.177, 0.008, s.trim, [0, 0, -0.027], [1.16, 0.38, 0]);
  const claw: P2[] = [[-0.132, -0.041], [-0.061, 0.019], [0.041, 0.031], [0.115, -0.001], [0.176, -0.05], [0.152, -0.08], [0.057, -0.029], [-0.073, -0.072]];
  const gimbal = overseerGimbalData();
  around(3, (t) => {
    const x = Math.sin(t);
    const y = Math.cos(t);
    prism(s, claw, 0.051, s.shell, [x * 0.171, y * 0.171, 0], [0, 0, -t], 0.008);
    // Curved armor segments machined from the same gimbal profile as the boss.
    add(s, gimbal, s.shell, [x * 0.215, y * 0.215, -0.054], [0.23, 0, -t], [0.146, 0.134, 0.158]);
    box(s, 0.096, 0.016, 0.024, s.dim, [x * 0.205, y * 0.205, -0.012], [0.23, 0, -t]);
    tube(s, 0.027, 0.014, 0.026, s.trim, [x * 0.156, y * 0.156, -0.119], face, 10);
  }, Math.PI / 3);
  tube(s, 0.079, 0.055, 0.041, s.trim, [0, 0, -0.148], face, 8);
  cyl(s, 0.043, 0.019, s.dim, [0, 0, -0.168], face, 8);
}

// ---------------------------------------------------------------- accessories

function servoBooster(s: Sculptor) {
  // Twin thruster pack: housing, two bell nozzles, glowing throats.
  prism(s, [[-0.086, -0.068], [0.068, -0.068], [0.092, -0.017], [0.063, 0.09], [-0.048, 0.099], [-0.089, 0.041]], 0.29, s.shell, [0, 0.063, 0], [0, 0, 0], 0.017);
  box(s, 0.2, 0.05, 0.16, s.dark, [0, 0.15, 0]);
  for (const side of [-1, 1]) {
    lathe(s, [[0.04, 0], [0.05, -0.03], [0.07, -0.1], [0.075, -0.12], [0.06, -0.12], [0.04, -0.05], [0.03, 0]], s.dark, [side * 0.08, -0.02, 0], [0, 0, 0], 24);
    cyl(s, 0.032, 0.02, s.glow, [side * 0.08, -0.06, 0], [0, 0, 0], 16);
    box(s, 0.01, 0.1, 0.1, s.trim, [side * 0.15, 0.06, 0]);
    tube(s, 0.073, 0.056, 0.022, s.M.copper, [side * 0.08, -0.128, 0]);
    box(s, 0.057, 0.062, 0.025, s.dark, [side * 0.09, 0.056, 0.089], [0, 0, side * 0.16]);
  }
  box(s, 0.16, 0.012, 0.01, s.glow, [0, 0.08, 0.072]);
}

function fieldUplink(s: Sculptor) {
  // Antenna mast with a dish and blinking tip on a small base.
  lathe(s, [[0, -0.2], [0.12, -0.2], [0.13, -0.17], [0.08, -0.13], [0, -0.13]], s.shell, [0, 0, 0], [0, 0, 0], 24);
  cyl(s, 0.018, 0.34, s.trim, [0, 0.04, 0], [0, 0, 0], 12);
  lathe(s, [[0.011, 0], [0.123, 0.029], [0.163, 0.079], [0.164, 0.09], [0.151, 0.092], [0.104, 0.047], [0.01, 0.018]], s.shell, [0, 0.017, 0.035], [0.9, 0, 0], 24);
  cyl(s, 0.01, 0.1, s.dark, [0, 0.06, 0.07], [0.9, 0, 0], 8);
  ball(s, 0.025, s.glow, [0, 0.22, 0]);
  for (const side of [-1, 1]) box(s, 0.035, 0.21, 0.047, s.dark, [side * 0.048, -0.041, -0.031], [0, 0, side * 0.2], 0.009);
  cyl(s, 0.061, 0.044, s.trim, [0, -0.157, 0], [0, 0, 0], 8);
  for (const y of [0.1, 0.15]) box(s, 0.12, 0.01, 0.01, s.dark, [0, y, 0]);
}

function targetingLens(s: Sculptor) {
  // Scope: tube body with a glass objective, rings and a glowing reticle.
  lathe(s, tubeProfile(0.07, 0.055, -0.18, 0.18, 0.004), s.shell, [0, 0, 0], [Math.PI / 2, 0, 0]);
  lathe(s, tubeProfile(0.102, 0.073, 0.132, 0.244, 0.008), s.shell, [0, 0, 0], [Math.PI / 2, 0, 0], 12);
  lathe(s, cylProfile(0.06, -0.25, -0.16, 0.004), s.dark, [0, 0, 0], [Math.PI / 2, 0, 0], 24);
  cyl(s, 0.074, 0.008, s.M.glass, [0, 0, -0.22], [Math.PI / 2, 0, 0], 28);
  ring(s, 0.04, 0.004, s.glow, [0, 0, 0.22], [Math.PI / 2, 0, 0]);
  box(s, 0.08, 0.004, 0.004, s.glow, [0, 0, 0.22]);
  box(s, 0.004, 0.08, 0.004, s.glow, [0, 0, 0.22]);
  for (const z of [-0.08, 0.06]) ring(s, 0.073, 0.008, s.trim, [0, 0, z], [Math.PI / 2, 0, 0]);
  cyl(s, 0.02, 0.05, s.trim, [0, 0.085, 0], [0, 0, 0], 12);
  box(s, 0.05, 0.03, 0.16, s.dark, [0, -0.08, 0]);
  for (const x of [-0.058, 0.058]) {
    box(s, 0.051, 0.042, 0.203, s.shell, [x, -0.072, -0.02], [0, 0, x > 0 ? -0.32 : 0.32], 0.009);
    box(s, 0.029, 0.015, 0.087, s.dim, [x * 1.35, -0.079, -0.026]);
  }
}

// ---------------------------------------------------------------- abilities

function grenade(s: Sculptor, body: Material) {
  lathe(s, [[0, -0.13], [0.07, -0.12], [0.1, -0.06], [0.105, 0.04], [0.08, 0.1], [0.04, 0.12], [0, 0.12]], body, [0, 0, 0], [0, 0, 0], 24);
  for (const y of [-0.06, 0, 0.06]) ring(s, 0.104, 0.007, s.dark, [0, y, 0]);
  cyl(s, 0.035, 0.05, s.trim, [0, 0.14, 0], [0, 0, 0], 12);
  ring(s, 0.03, 0.006, s.trim, [0.04, 0.17, 0], [0, 0, Math.PI / 2]);
  box(s, 0.03, 0.12, 0.02, s.dark, [0.06, 0.08, 0], [0, 0, -0.25]);
}

function fragCharge(s: Sculptor) {
  grenade(s, s.shell);
  around(6, (t) => {
    prism(s, [[-0.018, -0.08], [0.013, -0.068], [0.021, 0.026], [-0.005, 0.069], [-0.029, 0.023]], 0.052, s.shell, polar(0.097, t, -0.016), [0, t, 0], 0.008);
    box(s, 0.029, 0.014, 0.012, s.dim, polar(0.12, t, 0.014), [0, t, 0]);
  });
  box(s, 0.05, 0.04, 0.074, s.trim, [0.051, 0.134, 0.013], [0, 0, -0.32], 0.008);
}

function cryoCharge(s: Sculptor) {
  // Canister with frost-ceramic shell and a window.
  lathe(s, cylProfile(0.08, -0.15, 0.13, 0.012), s.M.equipmentCeramic, [0, 0, 0], [0, 0, 0], 24);
  cyl(s, 0.05, 0.16, s.glow, [0, -0.01, 0], [0, 0, 0], 16);
  around(3, (t) => {
    box(s, 0.05, 0.204, 0.036, s.dark, polar(0.075, t, -0.01), [0, t, 0], 0.007);
    prism(s, [[-0.019, -0.065], [0.015, -0.045], [0.021, 0.062], [-0.02, 0.071]], 0.041, s.shell, polar(0.1, t, -0.045), [0, t, 0], 0.006);
  });
  for (const y of [-0.13, 0.11]) cyl(s, 0.098, 0.046, s.shell, [0, y, 0], [0, 0, 0], 10);
  cyl(s, 0.03, 0.04, s.trim, [0, 0.15, 0], [0, 0, 0], 12);
  around(6, (t) => prism(s, [[0, 0], [0.012, 0.03], [0, 0.06], [-0.012, 0.03]], 0.01, s.glow, polar(0.03, t, 0.17), [0, t, 0]));
}

function arcPulse(s: Sculptor) {
  // Disc emitter with stacked coil rings and a pylon.
  lathe(s, [[0, -0.06], [0.16, -0.06], [0.18, -0.03], [0.14, 0], [0, 0]], s.shell, [0, 0, 0], [0, 0, 0], 32);
  cyl(s, 0.025, 0.22, s.trim, [0, 0.1, 0], [0, 0, 0], 12);
  for (let i = 0; i < 4; i++) ring(s, 0.09 - i * 0.015, 0.012, i % 2 ? s.M.copper : s.glow, [0, 0.04 + i * 0.045, 0]);
  ball(s, 0.035, s.glow, [0, 0.23, 0]);
  around(4, (t) => {
    prism(s, [[-0.044, -0.044], [0.049, -0.044], [0.044, 0.029], [0.002, 0.083], [-0.03, 0.052]], 0.059, s.shell, polar(0.146, t, -0.009), [0, t, 0], 0.01);
    box(s, 0.035, 0.025, 0.027, s.dim, polar(0.174, t, 0.017), [0, t, 0]);
  });
}

function blinkDrive(s: Sculptor) {
  // Wrist ring with a violet phase core and fins.
  lathe(s, tubeProfile(0.15, 0.11, -0.05, 0.05, 0.006), s.shell, [0, 0, 0], [Math.PI / 2, 0, 0], 36);
  ring(s, 0.13, 0.008, s.glow, [0, 0, 0.052], [Math.PI / 2, 0, 0]);
  box(s, 0.1, 0.06, 0.12, s.dark, [0, 0.16, 0]);
  ball(s, 0.035, s.glow, [0, 0.2, 0]);
  for (const side of [-1, 1]) {
    prism(s, [[-0.072, -0.021], [0.051, -0.021], [0.024, 0.079], [-0.045, 0.082]], 0.043, s.shell, [side * 0.111, 0.108, 0], [0, 0, side * 0.63], 0.008);
    tube(s, 0.026, 0.016, 0.034, s.trim, [side * 0.156, 0.005, 0], [Math.PI / 2, 0, 0], 10);
  }
}

function aegisCell(s: Sculptor) {
  // Hexagonal battery cell with a golden core band.
  lathe(s, cylProfile(0.11, -0.16, 0.16, 0.014), s.shell, [0, 0, 0], [0, 0, 0], 6);
  lathe(s, cylProfile(0.115, -0.04, 0.04, 0.004), s.glow, [0, 0, 0], [0, 0, 0], 6);
  for (const y of [-0.161, 0.161]) lathe(s, cylProfile(0.116, -0.027, 0.027, 0.008), s.trim, [0, y, 0], [0, 0, 0], 6);
  around(3, (t) => {
    box(s, 0.037, 0.238, 0.033, s.dark, polar(0.102, t, 0), [0, t, 0], 0.007);
    box(s, 0.024, 0.09, 0.018, s.M.copper, polar(0.122, t, 0), [0, t, 0]);
  }, Math.PI / 6);
  cyl(s, 0.03, 0.04, s.dark, [0, 0.2, 0], [0, 0, 0], 12);
}

function shieldWall(s: Sculptor) {
  // Folded emitter bar: two rails, hinge and a projector strip.
  for (const side of [-1, 1]) {
    prism(s, [[-0.234, -0.026], [-0.16, -0.052], [0.172, -0.052], [0.227, -0.02], [0.162, 0.042], [-0.162, 0.042]], 0.065, s.shell, [side * 0.064, 0, 0], [0, 0, 0], 0.012);
    box(s, 0.018, 0.016, 0.31, s.dim, [side * 0.065, 0.045, 0]);
    for (const z of [-0.15, 0.15]) box(s, 0.086, 0.043, 0.068, s.trim, [side * 0.065, -0.025, z], [0, 0, 0], 0.009);
  }
  cyl(s, 0.03, 0.16, s.dark, [0, -0.02, 0.2], [0, 0, Math.PI / 2], 16);
  cyl(s, 0.03, 0.16, s.dark, [0, -0.02, -0.2], [0, 0, Math.PI / 2], 16);
  for (const z of [-0.1, 0.1]) box(s, 0.14, 0.02, 0.03, s.trim, [0, -0.02, z]);
  prism(s, [[-0.18, 0], [0.18, 0], [0.16, 0.12], [-0.16, 0.12]], 0.004, s.M.glass, [0, 0.03, 0], [0, 0, 0], 0.001);
}

function holoDecoy(s: Sculptor) {
  // Puck drone with a projector lens and a hovering holo ghost.
  lathe(s, [[0, -0.05], [0.14, -0.05], [0.16, -0.02], [0.14, 0.03], [0.05, 0.05], [0, 0.05]], s.shell, [0, 0, 0], [0, 0, 0], 32);
  around(3, (t) => {
    box(s, 0.12, 0.02, 0.04, s.dark, polar(0.18, t, 0), [0, t + Math.PI / 2, 0]);
    tube(s, 0.061, 0.033, 0.046, s.shell, polar(0.231, t, 0.008), [0, 0, 0], 12);
    ring(s, 0.037, 0.006, s.dim, polar(0.231, t, 0.033));
  });
  cyl(s, 0.03, 0.03, s.glow, [0, 0.06, 0], [0, 0, 0], 16);
  lathe(s, [[0.03, 0.08], [0.11, 0.25], [0, 0.25]], s.M.glass, [0, 0, 0], [0, 0, 0], 16);
  lathe(s, [[0, 0.14], [0.05, 0.16], [0.04, 0.2], [0, 0.21]], s.glow, [0, 0, 0], [0, 0, 0], 8);
}

function miniSentry(s: Sculptor) {
  // Folded turret: tripod legs, swivel and a short twin barrel.
  around(3, (t) => {
    box(s, 0.042, 0.2, 0.053, s.dark, polar(0.09, t, -0.12), [Math.cos(t) * 0.5, 0, -Math.sin(t) * 0.5]);
    box(s, 0.059, 0.026, 0.072, s.trim, polar(0.139, t, -0.205), [0, t, 0]);
  });
  cyl(s, 0.06, 0.05, s.trim, [0, -0.01, 0], [0, 0, 0], 16);
  box(s, 0.16, 0.1, 0.18, s.shell, [0, 0.06, 0], [0, 0, 0], 0.016);
  for (const side of [-1, 1]) {
    cyl(s, 0.022, 0.2, s.dark, [side * 0.045, 0.07, 0.17], [Math.PI / 2, 0, 0], 12);
    tube(s, 0.028, 0.015, 0.067, s.trim, [side * 0.045, 0.07, 0.24], [Math.PI / 2, 0, 0], 10);
    box(s, 0.047, 0.071, 0.152, s.shell, [side * 0.082, 0.074, 0.005], [0, 0, side * 0.16], 0.01);
  }
  box(s, 0.1, 0.012, 0.01, s.glow, [0, 0.08, 0.092]);
  box(s, 0.05, 0.04, 0.05, s.dark, [0, 0.13, -0.03]);
}

// ---------------------------------------------------------------- ultimates

function orbitalLance(s: Sculptor) {
  // Targeting beacon: tall spike with uplink fins and a glowing tip.
  lathe(s, [[0, -0.285], [0.05, -0.242], [0.076, -0.124], [0.053, -0.074], [0.049, 0.143], [0.066, 0.182], [0.025, 0.296], [0, 0.312]], s.dark, [0, 0, 0], [0, 0, 0], 8);
  around(3, (t) => {
    prism(s, [[-0.039, -0.17], [0.085, -0.17], [0.121, -0.093], [0.088, 0.016], [0.012, 0.112], [-0.042, 0.086]], 0.048, s.shell, polar(0.074, t, -0.021), [0, t, 0], 0.009);
    box(s, 0.026, 0.11, 0.026, s.dim, polar(0.066, t, 0.147), [0.1, t, 0]);
  });
  tube(s, 0.09, 0.062, 0.042, s.trim, [0, 0.195, 0], [0, 0, 0], 12);
  lathe(s, [[0, 0.198], [0.038, 0.24], [0.024, 0.303], [0, 0.329]], s.glow, [0, 0, 0], [0, 0, 0], 6);
  ring(s, 0.088, 0.009, s.dim, [0, -0.126, 0]);
}

function overdriveCore(s: Sculptor) {
  // Heavy glowing core in a cradle frame with exhaust stacks.
  ball(s, 0.13, s.glow, [0, 0, 0], [1, 1.15, 1]);
  around(4, (t) => {
    prism(s, [[-0.057, -0.21], [0.032, -0.185], [0.063, -0.097], [0.056, 0.129], [0.022, 0.205], [-0.049, 0.208], [-0.023, 0.105], [-0.025, -0.11]], 0.064, s.shell, polar(0.169, t, 0), [0, t, 0], 0.012);
    box(s, 0.045, 0.14, 0.021, s.trim, polar(0.209, t, 0), [0, t, 0]);
  }, Math.PI / 4);
  for (const y of [-0.21, 0.21]) lathe(s, cylProfile(0.2, -0.025, 0.025, 0.008), s.dark, [0, y, 0], [0, 0, 0], 4);
  for (const y of [-0.08, 0.08]) ring(s, 0.14, 0.012, s.trim, [0, y, 0]);
  for (const side of [-1, 1]) {
    cyl(s, 0.025, 0.14, s.dark, [side * 0.08, 0.3, 0], [0, 0, 0], 12);
    tube(s, 0.036, 0.021, 0.058, s.M.copper, [side * 0.08, 0.342, 0]);
    cyl(s, 0.021, 0.012, s.dim, [side * 0.08, 0.365, 0], [0, 0, 0], 12);
  }
}

// ---------------------------------------------------------------- modules

/** Shared socket cartridge (the slot the module plugs into), then a type-specific top. */
function cartridge(s: Sculptor, accentBand = true) {
  prism(s, [[-0.143, -0.039], [-0.095, -0.061], [0.088, -0.061], [0.133, -0.03], [0.115, 0.052], [-0.113, 0.052]], 0.208, s.shell, [0, 0, 0], [0, 0, 0], 0.013);
  box(s, 0.16, 0.038, 0.117, s.M.polymer, [0, -0.069, -0.066]);
  for (let i = -2; i <= 2; i++) box(s, 0.019, 0.014, 0.044, s.M.equipmentContacts, [i * 0.03, -0.09, -0.092]);
  if (accentBand) box(s, 0.123, 0.023, 0.022, s.dim, [0, -0.004, 0.127]);
  box(s, 0.173, 0.02, 0.2, s.dark, [0, 0.054, 0]);
  for (const x of [-0.089, 0.089]) box(s, 0.025, 0.043, 0.138, s.trim, [x, -0.014, 0.028], [0, 0, x > 0 ? -0.24 : 0.24]);
}

const MODULE_TOP: Record<string, (s: Sculptor) => void> = {
  collar: (s) => {
    for (let i = 0; i < 3; i++) tube(s, 0.081, 0.049, 0.037, i === 1 ? s.dim : s.trim, [0, 0.083 + i * 0.035, 0], [0, 0, 0], 12);
    for (const side of [-1, 1]) box(s, 0.023, 0.116, 0.058, s.shell, [side * 0.076, 0.119, 0], [0, 0, side * 0.16]);
  },
  fins: (s) => {
    for (let i = -3; i <= 3; i++) box(s, 0.01, 0.125 - Math.abs(i) * 0.012, 0.18, s.M.equipmentFin, [i * 0.024, 0.104, 0], [0.13, 0, 0]);
    box(s, 0.172, 0.029, 0.036, s.shell, [0, 0.118, 0.094]);
    box(s, 0.115, 0.01, 0.018, s.dim, [0, 0.133, 0.102]);
  },
  chip: (s) => {
    box(s, 0.139, 0.039, 0.139, s.trim, [0, 0.078, 0], [0, Math.PI / 4, 0], 0.012);
    prism(s, ngon(6, 0.055), 0.026, s.dim, [0, 0.101, 0], [0, 0, Math.PI / 2], 0.004);
    lathe(s, [[0, 0], [0.053, 0.006], [0.037, 0.044], [0.012, 0.059], [0, 0.059]], s.M.glass, [0, 0.11, 0], [0, 0, 0], 6);
  },
  capacitor: (s) => {
    for (const side of [-1, 1]) {
      cyl(s, 0.047, 0.172, s.shell, [side * 0.058, 0.105, 0], [Math.PI / 2, 0, 0], 10);
      for (const z of [-0.069, 0.069]) tube(s, 0.054, 0.039, 0.027, s.M.copper, [side * 0.058, 0.105, z], [Math.PI / 2, 0, 0], 10);
      ring(s, 0.047, 0.007, s.dim, [side * 0.058, 0.105, 0], [Math.PI / 2, 0, 0]);
    }
  },
  fork: (s) => {
    for (const side of [-1, 0, 1]) cyl(s, 0.023, 0.22, s.trim, [side * 0.052, 0.094, 0.08], [Math.PI / 2 - 0.05, side * 0.21, 0], 10);
    box(s, 0.16, 0.03, 0.05, s.dark, [0, 0.08, -0.02]);
    for (const side of [-1, 0, 1]) tube(s, 0.022, 0.013, 0.025, s.dim, [side * 0.075, 0.094, 0.183], [Math.PI / 2, side * 0.21, 0], 10);
  },
  coil: (s) => {
    cyl(s, 0.025, 0.2, s.dark, [0, 0.12, 0], [0, 0, 0], 12);
    for (let i = 0; i < 4; i++) ring(s, 0.05 - i * 0.006, 0.009, i % 2 ? s.M.copper : s.glow, [0, 0.07 + i * 0.035, 0]);
    ball(s, 0.03, s.glow, [0, 0.24, 0]);
    for (const x of [-0.068, 0.068]) box(s, 0.024, 0.103, 0.057, s.shell, [x, 0.109, 0], [0, 0, x < 0 ? 0.13 : -0.13], 0.007);
  },
  exchanger: (s) => {
    for (let i = 0; i < 5; i++) ring(s, 0.06, 0.012, s.M.copper, [0, 0.08, -0.08 + i * 0.04], [Math.PI / 2, 0, 0]);
    cyl(s, 0.04, 0.2, s.glow, [0, 0.08, 0], [Math.PI / 2, 0, 0], 16);
    for (const x of [-0.069, 0.069]) box(s, 0.036, 0.055, 0.234, s.shell, [x, 0.075, 0], [0, 0, x < 0 ? 0.26 : -0.26], 0.008);
  },
  gyro: (s) => {
    ring(s, 0.085, 0.012, s.trim, [0, 0.12, 0], [Math.PI / 2, 0, 0]);
    ring(s, 0.065, 0.008, s.glow, [0, 0.12, 0], [0, 0, Math.PI / 2]);
    ball(s, 0.03, s.shell, [0, 0.12, 0]);
    cyl(s, 0.012, 0.06, s.dark, [0, 0.07, 0], [0, 0, 0], 8);
    for (const x of [-0.078, 0.078]) cyl(s, 0.018, 0.044, s.M.copper, [x, 0.119, 0], [0, 0, Math.PI / 2], 10);
  },
};

function moduleModel(s: Sculptor, visual: string, heavy: boolean) {
  cartridge(s);
  (MODULE_TOP[visual] ?? MODULE_TOP.chip)(s);
  if (heavy) {
    // Boss modules: armoured side plates and warning stripes.
    for (const side of [-1, 1]) prism(s, [[-0.15, -0.04], [-0.102, 0.065], [0.11, 0.065], [0.156, 0.008], [0.084, -0.06], [-0.085, -0.06]], 0.043, s.shell, [side * 0.112, 0.013, 0], [0, 0, 0], 0.008);
    for (const z of [-0.08, 0, 0.08]) box(s, 0.03, 0.01, 0.02, s.glow, [0.122, 0.04, z]);
  }
}

// ---------------------------------------------------------------- currencies

function credits(s: Sculptor) {
  // Stack of hex credit chips, the top one tilted.
  for (let i = 0; i < 4; i++) lathe(s, cylProfile(0.12, i * 0.03, i * 0.03 + 0.024, 0.006), i === 3 ? s.shell : s.dark, [0.01 * (i % 2), 0, 0], [0, i * 0.3, 0], 6);
  for (let i = 0; i < 4; i++) lathe(s, cylProfile(0.122, i * 0.03 + 0.009, i * 0.03 + 0.015, 0.001, true), s.glow, [0.01 * (i % 2), 0, 0], [0, i * 0.3, 0], 6);
  lathe(s, cylProfile(0.12, -0.012, 0.012, 0.006), s.shell, [0.05, 0.17, 0.02], [0.6, 0.3, 0.3], 6);
  lathe(s, cylProfile(0.06, 0.012, 0.016, 0.002), s.glow, [0.05, 0.17, 0.02], [0.6, 0.3, 0.3], 6);
}

function salvage(s: Sculptor) {
  // Bundle of bent plates, a pipe and bolts strapped together.
  box(s, 0.26, 0.05, 0.18, s.dark, [0, -0.05, 0], [0, 0.2, 0.08]);
  box(s, 0.22, 0.04, 0.16, s.shell, [0.02, 0.01, 0], [0.15, -0.3, -0.1]);
  prism(s, [[-0.1, 0], [0.1, 0], [0.12, 0.04], [0, 0.08], [-0.12, 0.04]], 0.12, s.M.copper, [-0.02, 0.04, 0.02], [0, 0.8, 0.2]);
  cyl(s, 0.03, 0.3, s.trim, [0, 0.06, -0.05], [0, 0.4, Math.PI / 2], 12);
  ring(s, 0.11, 0.008, s.glow, [0, 0, 0], [0, 0, 0]);
  bolts(s, [[0.06, 0.09, 0.06], [-0.06, 0.08, 0.07]]);
}

function components(s: Sculptor) {
  // Sealed component cell: canister with a window and a chip on top.
  lathe(s, cylProfile(0.09, -0.12, 0.1, 0.01), s.shell, [0, 0, 0], [0, 0, 0], 8);
  lathe(s, cylProfile(0.092, -0.06, 0.04, 0.002, true), s.glow, [0, 0, 0], [0, 0, 0], 8);
  around(4, (t) => box(s, 0.02, 0.2, 0.02, s.dark, polar(0.09, t, -0.01), [0, t, 0]), Math.PI / 8);
  box(s, 0.1, 0.02, 0.1, s.M.dark, [0, 0.115, 0]);
  box(s, 0.05, 0.01, 0.05, s.glow, [0, 0.128, 0]);
}

function shards(s: Sculptor) {
  // Crystal cluster growing out of a rock seat.
  lathe(s, [[0, -0.1], [0.12, -0.1], [0.14, -0.06], [0.08, -0.03], [0, -0.03]], s.dark, [0, 0, 0], [0, 0, 0], 7);
  const crystal = (h: number, r: number, pos: V3, rot: V3) => lathe(s, [[0, 0], [r, h * 0.15], [r * 0.9, h * 0.75], [0, h]], s.glow, pos, rot, 5);
  crystal(0.32, 0.05, [0, -0.06, 0], [0, 0, 0]);
  crystal(0.22, 0.04, [0.05, -0.06, 0.02], [0.2, 0, -0.45]);
  crystal(0.2, 0.035, [-0.05, -0.06, -0.02], [-0.25, 0.5, 0.5]);
  crystal(0.15, 0.03, [0.01, -0.06, -0.06], [-0.5, 0, 0.1]);
}

function xp(s: Sculptor) {
  prism(s, [[0, 0.16], [0.14, 0], [0.07, 0], [0.07, -0.14], [-0.07, -0.14], [-0.07, 0], [-0.14, 0]], 0.05, s.shell, [0, 0, 0], [0, Math.PI / 2, 0], 0.01);
  prism(s, [[0, 0.1], [0.07, 0.03], [-0.07, 0.03]], 0.056, s.glow, [0, 0, 0], [0, Math.PI / 2, 0], 0.004);
}

function cores(s: Sculptor) {
  // Hexagonal energy core: bipyramid crystal in a ring.
  lathe(s, [[0, -0.16], [0.1, 0], [0, 0.16]], s.glow, [0, 0, 0], [0, 0, 0], 6);
  ring(s, 0.13, 0.014, s.shell, [0, 0, 0]);
  around(3, (t) => box(s, 0.02, 0.05, 0.03, s.dark, polar(0.13, t, 0), [0, t, 0]));
}

function tactical(s: Sculptor) {
  ring(s, 0.13, 0.016, s.shell, [0, 0, 0], [Math.PI / 2, 0, 0]);
  prism(s, [[-0.02, 0.12], [0.05, 0.12], [0.01, 0.02], [0.06, 0.02], [-0.04, -0.12], [0, -0.02], [-0.05, -0.02]], 0.03, s.glow, [0, 0, 0], [0, Math.PI / 2, 0], 0.004);
}

// ---------------------------------------------------------------- registry

export const ITEM_SCULPTS: Readonly<Record<string, (s: Sculptor) => void>> = {
  kinetic_plating: kineticPlating, composite_armor: compositeArmor, bulwark_plating: bulwarkPlating, colossus_plating: colossusPlating,
  shield_matrix: shieldMatrix, barrier_lattice: barrierLattice,
  reactor_core: reactorCore, fusion_cell: fusionCell,
  overseer_logic: overseerLogic, combat_processor: combatProcessor, tactical_processor: tacticalProcessor,
  servo_booster: servoBooster, field_uplink: fieldUplink, targeting_lens: targetingLens,
  frag_charge: fragCharge, cryo_charge: cryoCharge, arc_pulse: arcPulse, blink_drive: blinkDrive, aegis_cell: aegisCell,
  shield_wall: shieldWall, holo_decoy: holoDecoy, mini_sentry: miniSentry,
  orbital_lance: orbitalLance, overdrive_core: overdriveCore,
};

export const CURRENCY_SCULPTS: Readonly<Record<CurrencyKey, (s: Sculptor) => void>> = { credits, salvage, components, shards, xp, cores, tactical };

/** Builder for a module base by its module visual (boss modules get armour plating). */
export function moduleSculpt(visual: string, heavy: boolean): (s: Sculptor) => void {
  return (s) => moduleModel(s, visual, heavy);
}

/** Fallback for unknown bases: a generic sealed crate. */
export function crateSculpt(s: Sculptor): void {
  box(s, 0.3, 0.22, 0.24, s.shell, [0, 0, 0], [0, 0, 0], 0.02);
  for (const side of [-1, 1]) box(s, 0.32, 0.03, 0.03, s.dark, [0, side * 0.08, 0.12]);
  box(s, 0.12, 0.02, 0.01, s.glow, [0, 0, 0.122]);
}
