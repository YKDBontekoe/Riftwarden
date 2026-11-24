// HQ station hardware shared by every desk-style station: the console model (plinth, side fins, control deck,
// deep screen hood, cable spine) in the room's accent colour, and the holographic signature props of the Neural
// Lattice and the Architect console. A station that is still locked (staged unlocks) is built powered off: its
// accent lights are dark (the offline screen is drawn by HomeBase).
import { type Material } from '@babylonjs/core/Materials/material';
import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { type TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { HQ_ROOMS, type Station } from '@riftwarden/rules/home/layout';
import { unlit } from '../visuals/materials';
import { loftData } from '../visuals/sculpt';
import { planeBuilder, type PropCtx, type ScreenTex } from './props';

/** Accent material of the room a station stands in (room identity), or cyan. */
export function stationAccent(ctx: PropCtx, st: Station): Material {
  const room = HQ_ROOMS.find((r) => st.pos[0] >= r.min[0] && st.pos[0] <= r.max[0] && st.pos[1] >= r.min[1] && st.pos[1] <= r.max[1]);
  return (room && ctx.M.accents?.[room.id]) ?? ctx.M.cyan;
}

/** World point of a local (x, z) offset in a station's frame. */
function local(st: Station, x: number, z: number): [number, number] {
  const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
  return [st.pos[0] + x * c + z * s, st.pos[1] - x * s + z * c];
}

/**
 * Console: plinth with a toe light, side fins, a slanted control deck (keys, dial, sliders), a deep screen hood with
 * a visor light and a cable spine to a floor junction. The screen faces local +z (where the warden stands).
 * Returns the root (already positioned) so callers can add station-specific parts.
 */
export function consoleDesk(ctx: PropCtx, st: Station, screen: ScreenTex, width = 1.5): TransformNode {
  const { kit, M } = ctx;
  const off = ctx.stationOff?.(st.id) ?? false;
  const accent = off ? M.graphite : stationAccent(ctx, st);
  const led = off ? M.graphite : M.teal;
  const w = width;
  const root = kit.node(`station_${st.id}`, null, [st.pos[0], 0, st.pos[1]]);
  root.rotation.y = st.yaw;

  // Plinth with a recessed toe kick and its light line.
  kit.part('box', M.graphite, root, { pos: [0, 0.07, 0.02], scale: [w * 0.98, 0.14, 1.02] });
  kit.part('box', M.metal, root, { pos: [0, 0.155, 0.02], scale: [w * 1.02, 0.03, 1.06] });
  kit.part('box', accent, root, { pos: [0, 0.04, 0.535], scale: [w * 0.82, 0.018, 0.012], shadow: false });

  // Body: tapered pedestal, vented front panel.
  const pedestal = kit.sculpt('consolePedestal2', () => loftData([
    { t: 0.17, w: 0.33, h: 0.36, n: 6 }, { t: 0.3, w: 0.28, h: 0.26, v: -0.045, n: 6 },
    { t: 0.66, w: 0.3, h: 0.25, v: -0.07, n: 6 }, { t: 0.88, w: 0.42, h: 0.36, n: 6 },
  ], 'y', 20));
  kit.part(pedestal, M.graphite, root, { scale: [w, 1, 1] });
  kit.part('box', M.metal, root, { pos: [0, 0.43, 0.2], rot: [0.07, 0, 0], scale: [w * 0.46, 0.44, 0.1] });
  for (let i = 0; i < 5; i++) kit.part('box', M.graphite, root, { pos: [0, 0.27 + i * 0.075, 0.258 - i * 0.005], scale: [w * 0.36, 0.03, 0.018] });
  for (let i = -1; i <= 1; i++) kit.part('box', i === 0 ? led : accent, root, { pos: [i * 0.077, 0.665, 0.243], scale: [0.044, 0.024, 0.012], shadow: false });

  // Side fins: floor to deck, an accent slit on the outer face.
  for (const s of [-1, 1]) {
    const fin = kit.node('consoleFin', root, [s * (w * 0.5 + 0.035), 0, 0]);
    kit.part('box', M.white, fin, { pos: [0, 0.55, -0.04], scale: [0.06, 0.8, 0.78] });
    kit.part('box', M.white, fin, { pos: [0, 0.98, 0.03], rot: [-0.25, 0, 0], scale: [0.065, 0.12, 0.8] });
    kit.part('box', M.graphite, fin, { pos: [0, 0.2, -0.04], scale: [0.07, 0.12, 0.82] });
    kit.part('box', accent, fin, { pos: [s * 0.033, 0.58, 0.2], scale: [0.006, 0.5, 0.025], shadow: false });
  }

  // Work surface and control deck (children lie on the slanted slab).
  kit.part('box', M.white, root, { pos: [0, 0.92, 0.05], rot: [-0.25, 0, 0], scale: [w, 0.12, 0.75] });
  kit.part('box', accent, root, { pos: [0, 0.9, 0.43], rot: [-0.25, 0, 0], scale: [w * 0.96, 0.022, 0.018], shadow: false });
  const deck = kit.node('consoleDeck', root, [0, 0.92, 0.05]);
  deck.rotation.x = -0.25;
  kit.part('box', M.graphite, deck, { pos: [0, 0.064, 0.06], scale: [w * 0.82, 0.01, 0.44] });
  const keys = Math.max(6, Math.round(w * 4.4));
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < keys; k++) {
      const x = (k - (keys - 1) / 2) * 0.085 - w * 0.1;
      kit.part('box', r === 0 && k % 4 === 1 ? accent : M.metal, deck, { pos: [x, 0.074, 0.15 + r * 0.075], scale: [0.066, 0.016, 0.058], shadow: false });
    }
  // Dial with a lit ring, two slider tracks.
  kit.part('cyl8', M.metal, deck, { pos: [w * 0.31, 0.085, 0.1], scale: [0.11, 0.03, 0.11], shadow: false });
  kit.part('torusThin', accent, deck, { pos: [w * 0.31, 0.072, 0.1], scale: [0.15, 0.15, 0.15], shadow: false });
  for (const dz of [-0.05, 0.02]) {
    kit.part('box', M.metal, deck, { pos: [w * 0.31, 0.071, 0.2 + dz], scale: [0.2, 0.006, 0.014], shadow: false });
    kit.part('box', M.white, deck, { pos: [w * 0.31 + dz, 0.079, 0.2 + dz], scale: [0.03, 0.018, 0.034], shadow: false });
  }

  // Screen hood: bezel, deep rear housing, visor with its light, side brackets.
  const hood = kit.node('consoleHood', root, [0, 1.36, -0.22]);
  hood.rotation.x = -0.35;
  kit.part('box', M.screenFrame, hood, { scale: [w * 0.92, 0.62, 0.06] });
  kit.part('box', M.graphite, hood, { pos: [0, -0.01, -0.1], scale: [w * 0.82, 0.52, 0.16] });
  kit.part('box', M.white, hood, { pos: [0, 0.335, 0.03], scale: [w * 0.97, 0.05, 0.2] });
  kit.part('box', accent, hood, { pos: [0, 0.305, 0.125], scale: [w * 0.82, 0.012, 0.012], shadow: false });
  for (const s of [-1, 1]) kit.part('box', M.metal, hood, { pos: [s * w * 0.475, 0, 0.02], scale: [0.04, 0.66, 0.11] });
  const plane = planeBuilder(ctx.scene, `screen_${st.id}`, w * 0.86, 0.54);
  plane.material = screen.mat;
  plane.parent = root;
  plane.position.set(0, 1.36, -0.185);
  plane.rotation.x = -0.35;
  for (const side of [-1, 1]) {
    kit.part('box', M.metal, root, { pos: [side * w * 0.33, 1.06, -0.33], rot: [-0.22, 0, 0], scale: [0.1, 0.44, 0.12] });
    kit.part('cyl6', M.graphite, root, { pos: [side * w * 0.33, 1.2, -0.3], rot: [0, 0, Math.PI / 2], scale: [0.13, 0.15, 0.13] });
  }
  // Cable spine from the hood down to a floor junction.
  kit.part('cyl8', M.graphite, root, { pos: [w * 0.18, 0.72, -0.47], scale: [0.08, 1.24, 0.08] });
  kit.part('cyl8', M.metal, root, { pos: [-w * 0.18, 0.66, -0.45], scale: [0.05, 1.1, 0.05] });
  kit.part('box', M.graphite, root, { pos: [0, 0.07, -0.56], scale: [w * 0.5, 0.14, 0.2] });
  kit.part('box', off ? M.graphite : M.amberDim, root, { pos: [0, 0.07, -0.665], scale: [w * 0.3, 0.02, 0.01], shadow: false });

  // Collider (rotated footprint approximated by its AABB)
  const r = width / 2 + 0.12;
  const along = Math.abs(Math.sin(st.yaw)) > 0.5;
  const hx = along ? 0.55 : r;
  const hz = along ? r : 0.55;
  ctx.collider(st.pos[0] - hx, 0, st.pos[1] - hz, st.pos[0] + hx, 1.7, st.pos[1] + hz);
  return root;
}

/** Emitter pedestal beside a console (local +x of the station); returns the hologram anchor at ~1.45 m. */
function emitter(ctx: PropCtx, st: Station, root: TransformNode, x: number, accent: Material): TransformNode {
  const { kit, M } = ctx;
  const ped = kit.node('holoEmitter', root, [x, 0, -0.05]);
  kit.part('cyl8', M.graphite, ped, { pos: [0, 0.06, 0], scale: [0.62, 0.12, 0.62] });
  kit.part('cyl8', M.metal, ped, { pos: [0, 0.135, 0], scale: [0.5, 0.03, 0.5] });
  const column = kit.sculpt('holoColumn', () => loftData([
    { t: 0.14, w: 0.13, h: 0.13, n: 6 }, { t: 0.5, w: 0.09, h: 0.09, n: 6 }, { t: 0.86, w: 0.12, h: 0.12, n: 6 }, { t: 0.95, w: 0.2, h: 0.2, n: 6 },
  ], 'y', 16));
  kit.part(column, M.white, ped);
  kit.part('cyl8', M.graphite, ped, { pos: [0, 0.98, 0], scale: [0.44, 0.06, 0.44] });
  kit.part('cyl', accent, ped, { pos: [0, 1.015, 0], scale: [0.26, 0.012, 0.26], shadow: false });
  kit.part('torusThin', accent, ped, { pos: [0, 0.14, 0], scale: [0.56, 0.56, 0.56], shadow: false });
  if (accent !== M.graphite) {
    // Projection: a faint widening light cone from the lens up into the hologram.
    const beam = unlit(ctx.scene, 'holoBeam', [0.03, 0.22, 0.26], { additive: true });
    kit.part('cone', beam, ped, { pos: [0, 1.27, 0], rot: [Math.PI, 0, 0], scale: [0.62, 0.5, 0.62], shadow: false });
  }
  const [wx, wz] = local(st, x, -0.05);
  ctx.collider(wx - 0.33, 0, wz - 0.33, wx + 0.33, 1.05, wz + 0.33);
  return kit.node('holo', ped, [0, 1.5, 0]);
}

const PHI = (1 + Math.sqrt(5)) / 2;
/** Unit icosahedron vertices (12) and its 30 edges. */
function icosahedron(): { v: [number, number, number][]; e: [number, number][] } {
  const raw: [number, number, number][] = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) raw.push([0, a, b], [a, b, 0], [b, 0, a]);
  const n = Math.hypot(1, PHI);
  const v = raw.map(([x, y, z]) => [x / n, y / n, z / n] as [number, number, number]);
  const e: [number, number][] = [];
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]) < 1.1) e.push([i, j]);
  return { v, e };
}

/** Thin bar from a to b (kit box scaled along its local z). */
function link(ctx: PropCtx, mat: Material, parent: TransformNode, a: [number, number, number], b: [number, number, number], thick: number): void {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  ctx.kit.part('box', mat, parent, {
    pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rot: [-Math.asin(d[1] / len), Math.atan2(d[0], d[2]), 0],
    scale: [thick, thick, len],
    shadow: false,
  });
}

/** Holo material that breathes (HDR additive). */
function holoMat(ctx: PropCtx, name: string, rgb: [number, number, number]): PBRMaterial {
  return unlit(ctx.scene, name, rgb, { additive: true });
}

/** Neural Lattice: a rotating node-and-link lattice (the skill tree) over an emitter beside the console. */
export function latticeHolo(ctx: PropCtx, st: Station, root: TransformNode, width: number): void {
  if (ctx.stationOff?.(st.id)) {
    emitter(ctx, st, root, width / 2 + 0.6, ctx.M.graphite);
    return;
  }
  const accent = stationAccent(ctx, st);
  const anchor = emitter(ctx, st, root, width / 2 + 0.6, accent);
  const nodeMat = holoMat(ctx, 'latticeNode', [0.5, 2.2, 1.4]);
  const linkMat = holoMat(ctx, 'latticeLink', [0.08, 0.55, 0.38]);
  const shell = ctx.kit.node('latticeShell', anchor);
  const core = ctx.kit.node('latticeCore', anchor);
  const { v, e } = icosahedron();
  const R = 0.34;
  const P = v.map(([x, y, z]) => [x * R, y * R, z * R] as [number, number, number]);
  for (const p of P) ctx.kit.part('sphere', nodeMat, shell, { pos: p, scale: [0.05, 0.05, 0.05], shadow: false });
  for (const [i, j] of e) link(ctx, linkMat, shell, P[i], P[j], 0.008);
  // Inner ring of the allocated core: spokes to a bright centre.
  ctx.kit.part('sphere', nodeMat, core, { scale: [0.09, 0.09, 0.09], shadow: false });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p: [number, number, number] = [Math.cos(a) * 0.17, (i % 2 ? 0.05 : -0.05), Math.sin(a) * 0.17];
    ctx.kit.part('sphere', nodeMat, core, { pos: p, scale: [0.035, 0.035, 0.035], shadow: false });
    link(ctx, linkMat, core, [0, 0, 0], p, 0.006);
  }
  const ring = ctx.kit.node('latticeRing', anchor);
  ctx.kit.part('torusThin', linkMat, ring, { scale: [0.82, 0.82, 0.82], shadow: false });
  ctx.animators.push((_dt, t) => {
    shell.rotation.set(Math.sin(t * 0.3) * 0.35, t * 0.32, 0);
    core.rotation.set(0, -t * 0.9, Math.sin(t * 0.5) * 0.3);
    ring.rotation.set(Math.PI / 2 + Math.sin(t * 0.4) * 0.5, 0, t * 0.2);
    anchor.position.y = 1.5 + Math.sin(t * 1.1) * 0.03;
    const k = 0.85 + 0.15 * Math.sin(t * 2.3);
    nodeMat.emissiveColor.set(0.5 * k, 2.2 * k, 1.4 * k);
  });
}

/** Architect console: a blueprint hologram of the HQ whose modules assemble one by one. */
export function blueprintHolo(ctx: PropCtx, st: Station, root: TransformNode, width: number): void {
  if (ctx.stationOff?.(st.id)) {
    emitter(ctx, st, root, width / 2 + 0.6, ctx.M.graphite);
    return;
  }
  const accent = stationAccent(ctx, st);
  const anchor = emitter(ctx, st, root, width / 2 + 0.6, accent);
  const gridMat = holoMat(ctx, 'blueprintGrid', [0.06, 0.4, 0.55]);
  const blockMat = holoMat(ctx, 'blueprintBlock', [0.12, 0.7, 1.0]);
  const newMat = holoMat(ctx, 'blueprintNew', [1.6, 0.9, 0.2]);
  const model = ctx.kit.node('blueprintModel', anchor, [0, -0.25, 0]);
  // Floor plate: grid lines.
  for (let i = -3; i <= 3; i++) {
    ctx.kit.part('box', gridMat, model, { pos: [i * 0.1, 0, 0], scale: [0.004, 0.004, 0.62], shadow: false });
    ctx.kit.part('box', gridMat, model, { pos: [0, 0, i * 0.1], scale: [0.62, 0.004, 0.004], shadow: false });
  }
  // A compact HQ: command deck, wings, a launch bay and a tower.
  const blocks: [number, number, number, number, number, number][] = [
    [0, 0.05, 0, 0.22, 0.1, 0.22], [-0.2, 0.035, 0, 0.14, 0.07, 0.16], [0.2, 0.035, 0, 0.14, 0.07, 0.16],
    [0, 0.04, 0.2, 0.12, 0.08, 0.14], [0, 0.03, -0.19, 0.3, 0.06, 0.1], [0.07, 0.17, -0.04, 0.07, 0.14, 0.07],
  ];
  for (const [x, y, z, sx, sy, sz] of blocks) ctx.kit.part('box', blockMat, model, { pos: [x, y, z], scale: [sx, sy, sz], shadow: false });
  // The module being built drops in, then the cycle repeats.
  const fresh = ctx.kit.node('blueprintFresh', model, [-0.2, 0, -0.19]);
  ctx.kit.part('box', newMat, fresh, { scale: [0.12, 0.06, 0.1], shadow: false });
  const scan = ctx.kit.node('blueprintScan', model, [0, 0, 0]);
  ctx.kit.part('box', gridMat, scan, { scale: [0.64, 0.003, 0.64], shadow: false });
  ctx.animators.push((_dt, t) => {
    model.rotation.y = t * 0.25;
    const c = (t * 0.4) % 1;
    fresh.position.y = 0.03 + Math.max(0, 0.35 * (1 - c * 2.2));
    fresh.scaling.setAll(c < 0.9 ? 1 : (1 - c) * 10);
    scan.position.y = 0.02 + ((t * 0.5) % 1) * 0.26;
  });
}
