import { Color3, type DynamicTexture, type Material, Matrix, MeshBuilder, type PBRMaterial, type Scene, type TransformNode, VertexBuffer } from '@babylonjs/core';
import { createRiftMaterial } from '../visuals/atmosphere';
import { buildWardenDrone } from '../visuals/droneModel';
import { type Kit } from '../visuals/kit';
import { type Palette, unlit } from '../visuals/materials';
import { createPathLight } from '../visuals/pathLighting';
import { segmentedRing } from '../visuals/rings';
import { placeScan } from '../visuals/scannedProps';
import { loftData, smoothLatheData } from '../visuals/sculpt';
import { canvas, flareSprite, toTexture } from '../visuals/textures';
import { ARENA } from '../world/layout';
import type { HqMaterials } from './HqBuilder';
import { buildLaunchCollar } from './launchCollar';
import { SURVEY_DESK, type Station } from './layout';
import type { Placeable } from './placeables';

export type Animator = (dt: number, t: number) => void;

/** Shared context for building HQ props. */
export interface PropCtx {
  scene: Scene;
  kit: Kit;
  M: HqMaterials & { plant: Material; screenFrame: Material };
  /** Add a static collider box (world-space corners). */
  collider: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void;
  animators: Animator[];
}

const ACCENT_GLOW: Record<string, [number, number, number]> = {
  cyan: [0.25, 1.9, 2.2],
  teal: [0.15, 1.6, 1.15],
  white: [2.0, 2.15, 2.3],
  amber: [2.4, 1.1, 0.15],
};

const accentCache = new WeakMap<Scene, Map<string, PBRMaterial>>();
function accentMat(scene: Scene, accent: unknown): PBRMaterial {
  const key = typeof accent === 'string' && ACCENT_GLOW[accent] ? accent : 'cyan';
  let m = accentCache.get(scene);
  if (!m) accentCache.set(scene, (m = new Map()));
  let mat = m.get(key);
  if (!mat) m.set(key, (mat = unlit(scene, `accent_${key}`, ACCENT_GLOW[key])));
  return mat;
}

// ------------------------------------------------------------------ screens

export interface ScreenTex {
  tex: DynamicTexture;
  mat: PBRMaterial;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** 1 = idle; raised while the station is targeted. */
  base: number;
}

export const SCREEN_FONT = '"Helvetica Neue", Arial, sans-serif';
export const MONO_FONT = '"SFMono-Regular", Consolas, monospace';

export function makeScreen(scene: Scene, name: string, w = 512, h = 288, tint: [number, number, number] = [1, 1, 1]): ScreenTex {
  const { c, ctx } = canvas(w, h);
  const tex = toTexture(`scr_${name}`, c, scene, { aniso: 4 });
  tex.wrapU = tex.wrapV = 0; // clamp
  const mat = unlit(scene, `scrMat_${name}`, tint, { tex });
  return { tex, mat, ctx, w, h, base: 1 };
}

/** The header and divider align with the live readouts drawn by each station. */
export function drawScreenFrame(s: ScreenTex, title: string, accent = '#a9ddd1'): void {
  const { ctx, w, h } = s;
  ctx.fillStyle = '#19221f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e5e8d8';
  ctx.fillRect(0, 0, w, 57);
  ctx.fillStyle = '#18211e';
  ctx.font = `700 28px ${SCREEN_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, 30, 30, w - 92);
  ctx.fillStyle = '#bf603e';
  ctx.fillRect(w - 51, 19, 22, 18);
  ctx.fillStyle = accent;
  ctx.fillRect(29, h - 13, 32, 2);
}

export function screenLine(s: ScreenTex, y: number, label: string, value: string, color = '#9ef7ff'): void {
  const { ctx, w } = s;
  ctx.font = `500 18px ${MONO_FONT}`;
  ctx.fillStyle = 'rgba(205,225,235,0.7)';
  ctx.textAlign = 'left';
  ctx.fillText(label, 34, y);
  ctx.fillStyle = color;
  ctx.font = `700 22px ${SCREEN_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(value, w - 34, y);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(79,230,245,0.15)';
  ctx.fillRect(34, y + 16, w - 68, 1);
}

/** Backed wayfinding sign with a high-contrast face under the room lighting. */
export function makeSign(ctx: PropCtx, text: string, pos: [number, number, number], yaw: number, width: number, color = '#bff6ff'): void {
  const W = 1024;
  const H = 128;
  const { c, ctx: g } = canvas(W, H);
  // Matte enamel wayfinding with a station-color index at the leading edge.
  g.fillStyle = '#e4e8d7';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#283832';
  g.fillRect(0, 0, 74, H);
  g.fillStyle = color;
  g.fillRect(17, 26, 9, H - 52);
  g.fillRect(35, 26, 19, H - 52);
  g.fillStyle = '#202a25';
  g.font = `700 72px ${SCREEN_FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, 108, H / 2 + 4, W - 152);
  const tex = toTexture(`sign_${text}`, c, ctx.scene, { aniso: 4 });
  tex.hasAlpha = true;
  tex.wrapU = tex.wrapV = 0;
  const mat = unlit(ctx.scene, `signMat_${text}`, [1.0, 1.0, 1.0], { tex, opacity: tex });
  mat.useAlphaFromAlbedoTexture = false;
  const plane = planeBuilder(ctx.scene, `sign_${text}`, width, (width * H) / W);
  plane.material = mat;
  plane.position.set(...pos);
  plane.rotation.y = yaw;
}

/**
 * Textured display plane whose visible side faces local +z (so `rotation.y = yaw` turns
 * it towards yaw) with canvas-texture orientation corrected (DynamicTexture uploads are
 * vertically inverted relative to CreatePlane's UVs).
 */
export function planeBuilder(scene: Scene, name: string, w: number, h: number) {
  const p = MeshBuilder.CreatePlane(name, { width: w, height: h, sideOrientation: 0 }, scene);
  p.isPickable = false;
  p.bakeTransformIntoVertices(PLANE_FLIP);
  const uv = p.getVerticesData(VertexBuffer.UVKind)!;
  for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
  p.setVerticesData(VertexBuffer.UVKind, uv, false);
  return p;
}
const PLANE_FLIP = Matrix.RotationY(Math.PI);

// ------------------------------------------------------------------ stations

/**
 * Console desk: pedestal, angled work surface and a tilted screen facing local +z.
 * Returns the root (already positioned) so callers can add station-specific parts.
 */
export function consoleDesk(ctx: PropCtx, st: Station, screen: ScreenTex, width = 1.5): TransformNode {
  const { kit, M } = ctx;
  const root = kit.node(`station_${st.id}`, null, [st.pos[0], 0, st.pos[1]]);
  root.rotation.y = st.yaw;
  const pedestal = kit.sculpt('consolePedestal', () => loftData([
    { t: 0.07, w: 0.31, h: 0.35, n: 6 }, { t: 0.25, w: 0.27, h: 0.24, v: -0.045, n: 6 },
    { t: 0.68, w: 0.30, h: 0.24, v: -0.07, n: 6 }, { t: 0.92, w: 0.42, h: 0.35, n: 6 },
  ], 'y', 20));
  kit.part(pedestal, M.graphite, root, { scale: [width, 1, 1] });
  kit.part('box', M.white, root, { pos: [0, 0.92, 0.05], rot: [-0.25, 0, 0], scale: [width, 0.12, 0.75] });
  kit.part('box', M.cyan, root, { pos: [0, 0.9, 0.43], rot: [-0.25, 0, 0], scale: [width * 0.96, 0.025, 0.02] });
  kit.part('box', M.graphite, root, { pos: [0, 0.06, 0.05], scale: [width * 0.9, 0.12, 0.9] });
  kit.part('box', M.metal, root, { pos: [0, 0.39, 0.197], rot: [0.07, 0, 0], scale: [width * 0.43, 0.50, 0.12] });
  for (let i = 0; i < 5; i++) kit.part('box', M.graphite, root, { pos: [0, 0.23 + i * 0.076, 0.264 - i * 0.005], scale: [width * 0.34, 0.032, 0.019] });
  for (const side of [-1, 1]) {
    kit.part('box', M.metal, root, { pos: [side * width * 0.33, 1.08, -0.315], rot: [-0.22, 0, 0], scale: [0.105, 0.46, 0.13] });
    kit.part('cyl6', M.graphite, root, { pos: [side * width * 0.33, 1.23, -0.27], rot: [0, 0, Math.PI / 2], scale: [0.13, 0.155, 0.13] });
    kit.part('box', M.screenFrame, root, { pos: [side * width * 0.39, 0.976, 0.23], rot: [-0.25, 0, 0], scale: [width * 0.12, 0.018, 0.19] });
  }
  // Screen housing + screen
  kit.part('box', M.screenFrame, root, { pos: [0, 1.36, -0.22], rot: [-0.35, 0, 0], scale: [width * 0.92, 0.62, 0.06] });
  const plane = planeBuilder(ctx.scene, `screen_${st.id}`, width * 0.86, 0.54);
  plane.material = screen.mat;
  plane.parent = root;
  plane.position.set(0, 1.36, -0.185);
  plane.rotation.x = -0.35;
  // Status light on the pedestal
  for (let i = -1; i <= 1; i++) kit.part('box', i === 0 ? M.teal : M.cyan, root, { pos: [i * 0.077, 0.589, 0.248], scale: [0.044, 0.024, 0.012], shadow: false });
  // Collider (rotated footprint approximated by its AABB)
  const r = width / 2 + 0.1;
  const along = Math.abs(Math.sin(st.yaw)) > 0.5;
  const hx = along ? 0.5 : r;
  const hz = along ? r : 0.5;
  ctx.collider(st.pos[0] - hx, 0, st.pos[1] - hz, st.pos[0] + hx, 1.7, st.pos[1] + hz);
  return root;
}

/** Launch ring at the end of the launch bay with an animated energy membrane. */
export function launchRing(ctx: PropCtx): void {
  const { kit, M, scene } = ctx;
  const root = kit.node('launchRing', null, [0, 0, 19.6]);
  kit.part('torus', M.graphite, root, { pos: [0, 4.2, 0], rot: [Math.PI / 2, 0, 0], scale: [7.4, 7.4, 7.4] });
  kit.part('torusThin', M.cyan, root, { pos: [0, 4.2, -0.3], rot: [Math.PI / 2, 0, 0], scale: [6.6, 6.6, 6.6] });
  kit.part('torusThin', M.white, root, { pos: [0, 4.2, 0.3], rot: [Math.PI / 2, 0, 0], scale: [8.1, 8.1, 8.1] });
  buildLaunchCollar(scene, root);
  const shoe = kit.sculpt('launchClamp', () => loftData([
    { t: -0.75, w: 0.28, h: 0.33, n: 5 }, { t: -0.51, w: 0.49, h: 0.41, n: 6 },
    { t: 0.35, w: 0.43, h: 0.37, n: 6 }, { t: 0.62, w: 0.25, h: 0.26, n: 5 },
  ], 'z', 20));
  // Clamps around the ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const clamp = kit.node('launchClamp', root, [Math.cos(a) * 3.75, 4.2 + Math.sin(a) * 3.75, 0]);
    clamp.rotation.z = a;
    kit.part(shoe, M.white, clamp);
    kit.part('box', M.graphite, clamp, { pos: [0, 0, -0.64], scale: [0.59, 0.50, 0.22] });
    kit.part('box', M.cyanDim, clamp, { pos: [0, 0, -0.761], scale: [0.32, 0.071, 0.025], shadow: false });
  }
  // Pylons
  for (const s of [-1, 1]) {
    kit.part('box', M.graphite, root, { pos: [s * 4.6, 3.4, 0], scale: [0.9, 6.8, 1.6] });
    kit.part('box', M.cyan, root, { pos: [s * 4.12, 3.4, -0.4], scale: [0.04, 5.6, 0.08] });
    kit.part('box', M.metal, root, { pos: [s * 4.6, 0.26, 0], scale: [1.2, 0.52, 1.82] });
    kit.part('box', M.white, root, { pos: [s * 4.66, 3.0, -0.75], scale: [0.67, 4.7, 0.25] });
    for (let i = 0; i < 6; i++) kit.part('box', M.graphite, root, { pos: [s * 4.66, 1.17 + 0.25 * i, -0.886], scale: [0.51, 0.075, 0.05] });
  }
  ctx.collider(-5.3, 0, 18.6, 5.3, 8, 20.6);
  const mat = createRiftMaterial(scene, 'launchMembrane', new Color3(0.11, 1.25, 1.9), 5.1);
  const disc = MeshBuilder.CreateDisc('membrane', { radius: 3.32, tessellation: 64 }, scene);
  disc.material = mat;
  disc.parent = root;
  disc.position.set(0, 4.2, 0);
  disc.isPickable = false;
  const glowTex = flareSprite(scene);
  const glowMat = unlit(scene, 'launchFloorGlow', [0.08, 0.5, 0.6], { tex: glowTex, opacity: glowTex, additive: true, zOffset: -2 });
  const pool = MeshBuilder.CreateGround('launchPool', { width: 10, height: 6 }, scene);
  pool.material = glowMat;
  pool.position.set(0, 0.02, 18.2);
  pool.isPickable = false;
  const gimbal = kit.node('launchGimbal', root, [0, 4.2, -0.54]);
  gimbal.rotation.x = -Math.PI / 2;
  const sweep = segmentedRing(scene, 'launchGimbalArc', 3.57, 0.11, 6, 0.48);
  sweep.parent = gimbal;
  sweep.material = M.cyan;
  const ticks = segmentedRing(scene, 'launchGimbalTicks', 3.78, 0.045, 24, 0.28);
  ticks.parent = gimbal;
  ticks.material = M.teal;

  // Travelling floor guides and counter-rotating rings along the launch approach.
  for (const s of [-1, 1]) kit.part('box', M.metal, root, { pos: [s * 1.6, 0.04, -5], scale: [0.25, 0.08, 9] });
  const approach = createPathLight(scene, 'launchApproach', [{ x: 0, z: 8.8 }, { x: 0, z: 19.1 }], 1.22, new Color3(0.22, 1.65, 2.15));
  ctx.animators.push((dt, t) => {
    const power = 0.78 + 0.18 * Math.sin(t * 1.5);
    mat.setFloat('time', t);
    approach.update(dt, power);
    sweep.rotation.y += dt * 0.39;
    ticks.rotation.y -= dt * 0.31;
  });

}

/** Color-coded traffic guides on the actual portal approaches. */
export function stationWayfinding(ctx: PropCtx): void {
  const routes = [
    { name: 'droneBayGuide', color: new Color3(0.16, 1.63, 1.22), ends: [[-3.25, -4.15], [-6, -2.8], [-9.9, -0.85], [-13.75, -0.85]] },
    { name: 'workshopGuide', color: new Color3(1.72, 0.83, 0.25), ends: [[3.25, -4.15], [6, -2.8], [9.8, -0.85], [13.9, -0.85], [16.1, -3.0]] },
  ];
  for (const { name, color, ends } of routes) {
    const guide = createPathLight(ctx.scene, name, ends.map(([x, z]) => ({ x, z })), 0.45, color);
    ctx.animators.push((dt) => guide.update(dt * 0.72, 0.57));
  }
}

/** Cantilevered survey table on the west side of the launch approach. */
export function commandTable(ctx: PropCtx, station: Station): void {
  const { kit, M, scene } = ctx;
  const [x, z] = station.pos;
  const root = kit.node('commandTable', null, [x, 0, z]);
  const fin = kit.sculpt('surveyTableSpine', () => loftData([
    { t: 0.04, w: 0.44, h: 0.71, n: 3.5 }, { t: 0.12, w: 0.45, h: 0.73, n: 4 },
    { t: 0.22, w: 0.31, h: 0.58, n: 4 }, { t: 0.65, w: 0.20, h: 0.56, u: -0.32, n: 3 },
    { t: 0.88, w: 0.28, h: 0.71, u: -0.43, n: 3 }, { t: 1.02, w: 0.67, h: 0.8, u: -0.25, n: 4 },
  ], 'y', 36));
  for (const end of [-1, 1]) kit.part(fin, M.bronze, root, { pos: [0.15, 0, end * 1.01] });
  const worktop = kit.sculpt('surveyTableTop', () => loftData([
    { t: 0.89, w: 1.11, h: 1.87, n: 3 }, { t: 0.97, w: 1.40, h: 2.03, n: 3.5 },
    { t: 1.03, w: 1.46, h: 2.09, n: 3.5 }, { t: 1.08, w: 1.44, h: 2.07, n: 3.5 },
  ], 'y', 52));
  kit.part(worktop, M.white, root);
  kit.part(worktop, M.screenFrame, root, { pos: [0, 0.041, 0], scale: [0.962, 1, 0.974] });
  ctx.collider(x - SURVEY_DESK.halfX, 0, z - SURVEY_DESK.halfZ, x + SURVEY_DESK.halfX, 1.12, z + SURVEY_DESK.halfZ);
  // Hologram: arena blocks as translucent cyan boxes (data from the real arena layout).
  const holoMat = unlit(scene, 'holoMat', [0.05, 0.4, 0.5], { additive: true });
  const holoEdge = unlit(scene, 'holoEdge', [0.3, 1.6, 2.0], { additive: true });
  holoMat.alpha = 0.37;
  holoEdge.alpha = 0.68;
  const holo = kit.node('holo', root, [0, 1.25, 0]);
  const k = 1 / 55;
  for (const b of ARENA.boxes) {
    const w = (b.max[0] - b.min[0]) * k;
    const h = Math.max(0.02, (b.max[1] - b.min[1]) * k);
    const d = (b.max[2] - b.min[2]) * k;
    kit.part('box', b.kind === 'reactor' ? holoEdge : holoMat, holo, { pos: [((b.min[0] + b.max[0]) / 2) * k, h / 2, ((b.min[2] + b.max[2]) / 2) * k], scale: [w, h, d] });
  }
  kit.part('cyl', holoEdge, holo, { pos: [0, 0.12, 0], scale: [0.08, 0.24, 0.08] });
  for (const route of Object.values(ARENA.routes)) {
    const pts = route.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z) * k;
      kit.part('box', M.amber, holo, { pos: [((a.x + b.x) / 2) * k, 0.005, ((a.z + b.z) / 2) * k], rot: [0, Math.atan2(b.x - a.x, b.z - a.z), 0], scale: [0.025, 0.008, len] });
    }
  }
  // Segmented emitter around the table and a scan plane that climbs through the map.
  const emitter = segmentedRing(scene, 'tableEmitter', 1.23, 0.020, 4, 0.83);
  emitter.parent = root;
  emitter.position.y = 1.126;
  emitter.material = holoEdge;
  const scanDisc = segmentedRing(scene, 'tableScan', 1.37, 0.034, 24, 0.38);
  scanDisc.parent = root;
  const scanLight = unlit(scene, 'tableScanLight', [0.08, 0.55, 0.67], { additive: true, twoSided: true });
  scanDisc.material = scanLight;
  const ringA = segmentedRing(scene, 'tableOrbit', 1.21, 0.022, 12, 0.6);
  ringA.parent = root;
  ringA.position.y = 1.49;
  ringA.material = scanLight;
  const ringB = segmentedRing(scene, 'tableOrbitInner', 0.96, 0.017, 8, 0.49);
  ringB.parent = root;
  ringB.position.y = 1.59;
  ringB.material = scanLight;
  const cone = MeshBuilder.CreateCylinder('holoCone', { diameterTop: 3, diameterBottom: 0.6, height: 0.61, tessellation: 32, cap: 0 }, scene);
  const coneTex = flareSprite(scene);
  const coneMat = unlit(scene, 'holoConeMat', [0.03, 0.18, 0.22], { additive: true, twoSided: true, opacity: coneTex });
  cone.material = coneMat;
  cone.parent = root;
  cone.position.y = 1.395;
  cone.isPickable = false;
  const footprint = MeshBuilder.CreateGround('tableContactShadow', { width: 6.1, height: 6.1 }, scene);
  const shadow = unlit(scene, 'tableContactShadow', [0.008, 0.012, 0.017], { opacity: coneTex });
  shadow.alpha = 0.68;
  shadow.disableDepthWrite = true;
  footprint.material = shadow;
  footprint.position.set(x, 0.009, z);
  footprint.scaling.set(0.62, 1, 0.87);
  footprint.isPickable = false;
  footprint.freezeWorldMatrix();
  ctx.animators.push((dt, t) => {
    holo.rotation.y += dt * 0.12;
    holo.position.y = 1.25 + Math.sin(t * 0.8) * 0.023;
    ringA.rotation.set(0.25 + Math.sin(t * 0.5) * 0.1, t * 0.4, 0);
    ringB.rotation.set(-0.3, -t * 0.55, Math.sin(t * 0.7) * 0.15);
    holoMat.emissiveColor.set(0.05, 0.4 + Math.sin(t * 3.1) * 0.04, 0.5);
    emitter.rotation.y -= dt * 0.25;
    const pass = (t * 0.32) % 1;
    scanDisc.position.y = 1.24 + pass * 0.33;
    scanDisc.rotation.y = t * 0.21;
    scanLight.alpha = Math.sin(pass * Math.PI) * 0.75;
  });
}

/** Drone cradle in the configuration bay: the player's drone on display, scanned. */
export function droneCradle(ctx: PropCtx, pal: Palette, at: [number, number]): void {
  const { kit, M } = ctx;
  const root = kit.node('cradle', null, [at[0], 0, at[1]]);
  kit.part('cyl8', M.graphite, root, { pos: [0, 0.2, 0], scale: [3.0, 0.4, 3.0] });
  kit.part('cyl8', M.white, root, { pos: [0, 0.45, 0], scale: [2.4, 0.1, 2.4] });
  kit.part('torusThin', M.cyan, root, { pos: [0, 0.52, 0], scale: [2.2, 1, 2.2] });
  for (let i = 0; i < 4; i++) {
    const angle = (i + 0.5) * Math.PI / 2;
    const clamp = kit.node('cradleClamp', root, [1.12 * Math.sin(angle), 0.39, 1.12 * Math.cos(angle)]);
    clamp.rotation.y = angle;
    kit.part('box', M.metal, clamp, { scale: [0.45, 0.31, 0.56] });
    kit.part('box', M.graphite, clamp, { pos: [0, 0.16, 0.03], rot: [-0.24, 0, 0], scale: [0.38, 0.13, 0.39] });
    kit.part('box', M.cyanDim, clamp, { pos: [0, 0.12, 0.28], scale: [0.19, 0.025, 0.02], shadow: false });
  }
  ctx.collider(at[0] - 1.5, 0, at[1] - 1.5, at[0] + 1.5, 0.6, at[1] + 1.5);
  // Overhead gantry
  for (const s of [-1, 1]) kit.part('box', M.graphite, root, { pos: [0, 4.4, s * 1.4], scale: [0.3, 0.3, 0.3] });
  kit.part('box', M.white, root, { pos: [0, 4.6, 0], scale: [0.5, 0.25, 3.4] });
  kit.part('box', M.lamp, root, { pos: [0, 4.46, 0], scale: [0.3, 0.02, 2.6] });

  const { root: drone } = buildWardenDrone(ctx.scene, kit, pal, 0);
  drone.parent = root;
  drone.position.y = 1.75;
  drone.scaling.setAll(1.42);
  // Scanner ring
  const scan = kit.node('scan', root, [0, 1.75, 0]);
  const scanMat = unlit(ctx.scene, 'scanMat', [0.2, 1.4, 1.7], { additive: true });
  kit.part('torusThin', scanMat, scan, { scale: [2.1, 2.1, 2.1] });
  ctx.animators.push((_dt, t) => {
    drone.rotation.y = t * 0.35;
    drone.position.y = 1.75 + Math.sin(t * 1.3) * 0.06;
    drone.rotation.z = Math.sin(t * 0.9) * 0.04;
    scan.position.y = 1.75 + Math.sin(t * 0.9) * 0.7;
    scanMat.emissiveColor.set(0.2, 1.1 + 0.4 * Math.sin(t * 6), 1.4);
  });
}

/** Locker racks along the storage wall; occupied bays light up (real storage count). */
export function storageRacks(ctx: PropCtx, stored: number, capacity: number): void {
  const { kit, M } = ctx;
  const racks = 6;
  const perRack = Math.ceil(capacity / racks);
  const rows = 4;
  const cols = Math.ceil(perRack / rows);
  let idx = 0;
  const z = 8.35;
  for (let r = 0; r < racks; r++) {
    const x = 12.6 + r * 1.75;
    const root = kit.node(`rack${r}`, null, [x, 0, z]);
    kit.part('box', M.graphite, root, { pos: [0, 1.5, 0], scale: [1.6, 3.0, 0.9] });
    kit.part('box', M.white, root, { pos: [0, 3.05, -0.02], scale: [1.66, 0.1, 0.94] });
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        if (idx >= capacity) continue;
        const px = -0.4 + (col * 0.8) / Math.max(1, cols - 1);
        const py = 0.45 + row * 0.66;
        const occupied = idx < stored;
        kit.part('box', M.white, root, { pos: [cols > 1 ? px : 0, py, -0.42], scale: [cols > 1 ? 0.72 : 1.4, 0.56, 0.06] });
        kit.part('box', occupied ? M.cyan : M.graphite, root, { pos: [cols > 1 ? px : 0, py - 0.2, -0.46], scale: [0.22, 0.03, 0.01] });
        idx++;
      }
  }
  ctx.collider(11.7, 0, z - 0.5, 12.6 + (racks - 1) * 1.75 + 0.9, 3.1, z + 0.5);
}

/** Workshop: bench with screen, articulated arm, offline fabricator, tool wall. */
export function workshop(ctx: PropCtx, st: Station, screen: ScreenTex): void {
  const { kit, M, scene } = ctx;
  const root = kit.node('workshop', null, [st.pos[0], 0, st.pos[1] - 1.0]);
  kit.part('box', M.white, root, { pos: [0, 0.92, 0], scale: [4.2, 0.1, 1.2] });
  kit.part('box', M.graphite, root, { pos: [0, 0.45, -0.1], scale: [4.0, 0.85, 0.9] });
  for (const x of [-1.43, -0.48, 0.48, 1.43]) {
    for (const y of [0.31, 0.68]) {
      kit.part('box', M.metal, root, { pos: [x, y, 0.352], scale: [0.87, 0.33, 0.065] });
      kit.part('box', M.graphite, root, { pos: [x, y + 0.07, 0.398], scale: [0.39, 0.07, 0.045] });
    }
  }
  kit.part('box', M.cyan, root, { pos: [0, 0.88, 0.6], scale: [4.1, 0.02, 0.02] });
  ctx.collider(st.pos[0] - 2.1, 0, st.pos[1] - 1.6, st.pos[0] + 2.1, 1.0, st.pos[1] - 0.4);
  // Screen on an arm above the bench
  kit.part('box', M.graphite, root, { pos: [0, 1.25, -0.45], scale: [0.12, 0.6, 0.12] });
  kit.part('box', M.screenFrame, root, { pos: [0, 1.55, -0.3], rot: [-0.2, 0, 0], scale: [1.35, 0.68, 0.06] });
  const plane = planeBuilder(scene, 'screen_workshop', 1.24, 0.6);
  plane.material = screen.mat;
  plane.parent = root;
  plane.position.set(0, 1.55, -0.265);
  plane.rotation.x = -0.2;
  // Parts on the bench
  kit.part('cyl', M.metal, root, { pos: [-1.4, 1.03, 0.1], rot: [0, 0, Math.PI / 2], scale: [0.14, 0.5, 0.14] });
  kit.part('box', M.graphite, root, { pos: [-1.0, 1.02, 0.25], rot: [0, 0.4, 0], scale: [0.3, 0.1, 0.2] });
  kit.part('torusThin', M.amber, root, { pos: [1.2, 0.99, 0.15], scale: [0.3, 0.3, 0.3] });
  // Articulated arm (idle motion)
  const base = kit.node('armBase', root, [1.7, 0.97, -0.2]);
  kit.part('cyl', M.graphite, base, { pos: [0, 0.08, 0], scale: [0.36, 0.16, 0.36] });
  const j1 = kit.node('j1', base, [0, 0.16, 0]);
  const arm = kit.sculpt('workshopLink', () => loftData([
    { t: 0.02, w: 0.11, h: 0.092, n: 4 }, { t: 0.14, w: 0.092, h: 0.077, n: 5 },
    { t: 0.52, w: 0.072, h: 0.058, n: 4 }, { t: 0.67, w: 0.084, h: 0.099, n: 4 },
  ], 'y', 16));
  kit.part(arm, M.white, j1);
  kit.part('cyl8', M.metal, j1, { pos: [0.09, 0.31, 0], scale: [0.079, 0.47, 0.079] });
  const j2 = kit.node('j2', j1, [0, 0.7, 0]);
  kit.part('sphere', M.graphite, j2, { scale: [0.16, 0.16, 0.16] });
  kit.part(arm, M.white, j2, { scale: [0.85, 0.81, 0.85] });
  kit.part('cyl8', M.metal, j2, { rot: [0, 0, Math.PI / 2], scale: [0.18, 0.24, 0.18] });
  const tip = kit.node('tip', j2, [0, 0.56, 0]);
  kit.part('cone', M.graphite, tip, { pos: [0, 0.06, 0], rot: [Math.PI, 0, 0], scale: [0.12, 0.14, 0.12] });
  kit.part('sphere', M.amber, tip, { pos: [0, -0.04, 0], scale: [0.04, 0.04, 0.04] });
  ctx.animators.push((_dt, t) => {
    j1.rotation.set(0.35 + Math.sin(t * 0.4) * 0.15, Math.sin(t * 0.25) * 0.6, 0);
    j2.rotation.x = 1.2 + Math.sin(t * 0.55 + 1) * 0.25;
  });
  // Tool wall
  const tw = kit.node('toolWall', null, [17, 0, -8.72]);
  kit.part('box', M.graphite, tw, { pos: [0, 2.2, 0], scale: [4.6, 1.8, 0.06] });
  for (let i = 0; i < 9; i++) {
    const x = -2 + i * 0.5;
    kit.part('box', i % 3 === 0 ? M.metal : M.white, tw, { pos: [x, 2.2 + (i % 2 ? 0.25 : -0.2), 0.08], scale: [0.08, 0.5 + (i % 3) * 0.15, 0.06] });
  }
  kit.part('box', M.cyanDim, tw, { pos: [0, 3.14, 0.05], scale: [4.6, 0.04, 0.02] });
}

// ------------------------------------------------------------------ placeables

/** Build one persistent placeable from its saved definition. */
export function buildPlaceable(ctx: PropCtx, p: Placeable): TransformNode {
  const { kit, M, scene } = ctx;
  const root = kit.node(`pl_${p.uid}`, null, p.position);
  root.rotation.y = p.rotationY;
  root.scaling.setAll(p.scale);
  const accent = accentMat(scene, p.props.accent);
  let half: [number, number, number] = [0.5, 1, 0.5];
  switch (p.type) {
    case 'planter': {
      const bowl = kit.sculpt('planterBowl', () => smoothLatheData([
        [0.39, 0.01], [0.43, 0.07], [0.48, 0.18], [0.55, 0.53], [0.56, 0.61],
        [0.55, 0.64], [0.51, 0.64], [0.49, 0.56],
      ], 40));
      kit.part(bowl, M.white, root);
      kit.part('cyl', M.graphite, root, { pos: [0, 0.56, 0], scale: [0.99, 0.025, 0.99] });
      placeScan(root, 'fern', [0, 0.55, 0], p.rotationY + 0.4, [1.55, 1.65, 1.55]);
      half = [0.7, 1.2, 0.7];
      break;
    }
    case 'crates': {
      kit.part('box', M.white, root, { pos: [0, 0.4, 0], scale: [1.2, 0.8, 0.9] });
      kit.part('box', M.graphite, root, { pos: [0.1, 1.1, 0.05], rot: [0, 0.25, 0], scale: [0.9, 0.6, 0.7] });
      kit.part('box', M.white, root, { pos: [-1.05, 0.35, 0.1], rot: [0, -0.2, 0], scale: [0.7, 0.7, 0.7] });
      kit.part('box', accent, root, { pos: [0, 0.6, 0.455], scale: [0.9, 0.04, 0.01] });
      for (const s of [-1, 1]) {
        kit.part('box', M.metal, root, { pos: [s * 0.48, 0.41, 0], scale: [0.12, 0.76, 0.95] });
        kit.part('box', M.graphite, root, { pos: [s * 0.38, 0.46, 0.474], scale: [0.16, 0.18, 0.05] });
      }
      half = [1.5, 1.4, 0.7];
      break;
    }
    case 'serverRack': {
      kit.part('box', M.graphite, root, { pos: [0, 1.2, 0], scale: [1.1, 2.4, 0.8] });
      kit.part('box', M.white, root, { pos: [0, 2.44, 0], scale: [1.15, 0.08, 0.85] });
      for (let i = 0; i < 8; i++) kit.part('box', i % 3 === 1 ? accent : M.screenFrame, root, { pos: [0, 0.4 + i * 0.25, 0.405], scale: [0.9, 0.04, 0.01] });
      for (const s of [-1, 1]) kit.part('box', M.metal, root, { pos: [s * 0.49, 1.22, 0.397], scale: [0.12, 2.26, 0.105] });
      half = [0.6, 2.5, 0.45];
      break;
    }
    case 'lightPylon': {
      kit.part('box', M.graphite, root, { pos: [0, 0.1, 0], scale: [0.7, 0.2, 0.7] });
      const column = kit.sculpt('lampColumn', () => smoothLatheData([[0.28, 0.18], [0.24, 0.29], [0.115, 0.5], [0.095, 2.64], [0.16, 2.88], [0.16, 3.10]], 16));
      kit.part(column, M.white, root);
      for (const s of [-1, 1]) kit.part('box', accent, root, { pos: [0, 1.57, s * 0.102], scale: [0.068, 2.02, 0.019], shadow: false });
      kit.part('box', M.graphite, root, { pos: [0, 3.15, 0], scale: [0.4, 0.12, 0.4] });
      half = [0.35, 3.2, 0.35];
      break;
    }
    case 'bench': {
      kit.part('box', M.white, root, { pos: [0, 0.48, 0], scale: [2.4, 0.1, 0.6] });
      kit.part('box', M.metal, root, { pos: [0, 0.35, 0], scale: [2.05, 0.10, 0.42] });
      for (const s of [-1, 1]) kit.part('box', M.graphite, root, { pos: [s * 0.95, 0.22, 0], rot: [0, 0, s * 0.27], scale: [0.16, 0.44, 0.5] });
      half = [1.2, 0.55, 0.3];
      break;
    }
    case 'holoPanel': {
      kit.part('box', M.graphite, root, { pos: [0, 0.08, 0], scale: [1.2, 0.16, 0.5] });
      for (const s of [-1, 1]) kit.part('box', M.white, root, { pos: [s * 0.55, 1.2, 0], scale: [0.08, 2.2, 0.08] });
      const panel = kit.node('hp', root, [0, 1.45, 0]);
      const mat = unlit(scene, `holoPanel_${p.uid}`, [0.15, 0.9, 1.1], { additive: true, twoSided: true });
      kit.part('box', mat, panel, { scale: [1.0, 0.7, 0.01] });
      for (let i = 0; i < 4; i++) kit.part('box', accent, panel, { pos: [-0.3 + i * 0.2, -0.2 + i * 0.08, 0.01], scale: [0.08, 0.1 + i * 0.12, 0.005] });
      ctx.animators.push((_dt, t) => {
        panel.position.y = 1.45 + Math.sin(t * 1.1 + p.position[0]) * 0.03;
        mat.alpha = 1;
        mat.emissiveColor.set(0.1, 0.55 + 0.1 * Math.sin(t * 2.3), 0.7);
      });
      half = [0.6, 2.3, 0.3];
      break;
    }
    // ---- M7 construction catalogue
    case 'table': {
      kit.part('box', M.graphite, root, { pos: [0, 0.4, 0], scale: [0.5, 0.8, 0.5] });
      kit.part('box', M.white, root, { pos: [0, 0.82, 0], scale: [2.2, 0.08, 1.2] });
      kit.part('box', accent, root, { pos: [0, 0.865, 0], scale: [1.8, 0.01, 0.8] });
      const holo = unlit(scene, `tableHolo_${p.uid}`, [0.1, 0.6, 0.8], { additive: true, twoSided: true });
      const h = kit.part('cyl', holo, root, { pos: [0, 1.2, 0], scale: [0.7, 0.5, 0.7], shadow: false });
      ctx.animators.push((_dt, t) => {
        if (root.isDisposed()) return;
        h.rotation.y = t * 0.6;
        h.scaling.y = 0.5 + Math.sin(t * 1.7) * 0.08;
      });
      half = [1.1, 0.9, 0.6];
      break;
    }
    case 'sofa': {
      kit.part('box', M.graphite, root, { pos: [0, 0.22, 0], scale: [2.6, 0.44, 0.9] });
      for (const x of [-0.81, 0, 0.81]) {
        kit.part('box', M.white, root, { pos: [x, 0.5, 0.05], scale: [0.79, 0.16, 0.8] });
        kit.part('box', M.white, root, { pos: [x, 0.85, -0.36], rot: [-0.16, 0, 0], scale: [0.79, 0.6, 0.19] });
      }
      for (const sd of [-1, 1]) kit.part('box', M.graphite, root, { pos: [sd * 1.25, 0.6, 0], scale: [0.14, 0.5, 0.9] });
      kit.part('box', accent, root, { pos: [0, 0.12, 0.46], scale: [2.4, 0.03, 0.01] });
      half = [1.35, 1.2, 0.5];
      break;
    }
    case 'machinery': {
      kit.part('cyl6', M.graphite, root, { pos: [0, 0.3, 0], scale: [1.8, 0.6, 1.8] });
      kit.part('cyl6', M.white, root, { pos: [0, 0.65, 0], scale: [1.3, 0.12, 1.3] });
      const turn = kit.node('armTurn', root, [0, 0.72, 0]);
      kit.part('box', M.white, turn, { pos: [0, 0.4, 0], scale: [0.5, 0.8, 0.5] });
      const up = kit.node('armUpper', turn, [0, 0.8, 0]);
      kit.part('box', M.graphite, up, { pos: [0, 0.6, 0.15], rot: [0.4, 0, 0], scale: [0.28, 1.3, 0.28] });
      const fore = kit.node('armFore', up, [0, 1.15, 0.45]);
      kit.part('box', M.white, fore, { pos: [0, 0, 0.45], scale: [0.22, 0.22, 1.0] });
      kit.part('box', accent, fore, { pos: [0, 0, 0.98], scale: [0.18, 0.06, 0.12] });
      ctx.animators.push((_dt, t) => {
        if (root.isDisposed()) return;
        turn.rotation.y = Math.sin(t * 0.5 + p.position[0]) * 1.1;
        up.rotation.x = -0.3 + Math.sin(t * 0.9) * 0.25;
        fore.rotation.x = 0.4 + Math.sin(t * 1.3 + 1) * 0.35;
      });
      half = [0.9, 2.4, 0.9];
      break;
    }
    case 'reactorModel': {
      kit.part('cyl8', M.graphite, root, { pos: [0, 0.3, 0], scale: [1.6, 0.6, 1.6] });
      for (let i = 0; i < 3; i++) kit.part('box', M.white, root, { pos: [Math.sin((i / 3) * Math.PI * 2) * 0.6, 1.25, Math.cos((i / 3) * Math.PI * 2) * 0.6], rot: [0, (i / 3) * Math.PI * 2, 0], scale: [0.14, 1.3, 0.3] });
      const core = unlit(scene, `modelCore_${p.uid}`, [0.4, 2.2, 2.8]);
      const c = kit.part('sphere', core, root, { pos: [0, 1.3, 0], scale: [0.6, 0.9, 0.6], shadow: false });
      const ring = kit.part('torusThin', accent, root, { pos: [0, 1.3, 0], scale: [1.0, 1.0, 1.0], shadow: false });
      ctx.animators.push((_dt, t) => {
        if (root.isDisposed()) return;
        ring.rotation.x = t * 0.9;
        ring.rotation.z = t * 0.6;
        c.scaling.y = 0.9 + Math.sin(t * 3) * 0.06;
      });
      half = [0.8, 2.0, 0.8];
      break;
    }
    case 'trophyColossus': {
      kit.part('box', M.graphite, root, { pos: [0, 0.35, 0], scale: [1.6, 0.7, 1.0] });
      kit.part('box', M.white, root, { pos: [0, 0.74, 0], scale: [1.7, 0.08, 1.1] });
      const lance = kit.node('lance', root, [0, 1.6, 0]);
      lance.rotation.z = 0.35;
      kit.part('cyl8', M.metal, lance, { scale: [0.3, 2.2, 0.3] });
      kit.part('cone', M.graphite, lance, { pos: [0, 1.4, 0], scale: [0.4, 0.7, 0.4] });
      kit.part('box', M.amber, lance, { pos: [0, 0.2, 0.17], scale: [0.08, 1.4, 0.02], shadow: false });
      half = [0.85, 2.8, 0.55];
      break;
    }
    case 'trophyOverseer': {
      kit.part('cyl6', M.graphite, root, { pos: [0, 0.4, 0], scale: [1.2, 0.8, 1.2] });
      const prism = unlit(scene, `prism_${p.uid}`, [1.4, 0.7, 2.8]);
      const pr = kit.part('ico', prism, root, { pos: [0, 1.6, 0], scale: [0.6, 0.9, 0.6], shadow: false });
      ctx.animators.push((_dt, t) => {
        if (root.isDisposed()) return;
        pr.rotation.y = t * 0.8;
        pr.position.y = 1.6 + Math.sin(t * 1.4) * 0.08;
      });
      half = [0.6, 2.2, 0.6];
      break;
    }
    case 'vaultDisplay': {
      kit.part('box', M.graphite, root, { pos: [0, 0.45, 0], scale: [1.2, 0.9, 0.8] });
      kit.part('box', M.metal, root, { pos: [0, 0.91, 0], scale: [1.09, 0.19, 0.72] });
      kit.part('box', M.white, root, { pos: [0, 1.15, 0], scale: [0.9, 0.5, 0.6] });
      for (const x of [-0.37, 0.37]) kit.part('box', M.graphite, root, { pos: [x, 1.15, 0.30], scale: [0.09, 0.37, 0.07] });
      kit.part('box', M.amber, root, { pos: [0, 1.15, 0.31], scale: [0.6, 0.08, 0.01], shadow: false });
      half = [0.6, 1.4, 0.4];
      break;
    }
    case 'floorLamp': {
      kit.part('cyl', M.graphite, root, { pos: [0, 0.05, 0], scale: [0.5, 0.1, 0.5] });
      kit.part('cyl', M.metal, root, { pos: [0, 0.85, 0], scale: [0.06, 1.6, 0.06] });
      kit.part('cone', M.white, root, { pos: [0, 1.75, 0], rot: [Math.PI, 0, 0], scale: [0.5, 0.3, 0.5] });
      half = [0.25, 1.9, 0.25];
      break;
    }
    case 'ceilingLamp': {
      kit.part('cyl', M.graphite, root, { pos: [0, 0.05, 0], scale: [0.6, 0.1, 0.6] });
      kit.part('cyl', M.metal, root, { pos: [0, 2.0, 0], scale: [0.04, 3.9, 0.04] });
      kit.part('cone', M.white, root, { pos: [0, 3.8, 0], rot: [Math.PI, 0, 0], scale: [0.7, 0.35, 0.7] });
      half = [0.3, 0.2, 0.3];
      break;
    }
    case 'lightStrip': {
      kit.part('box', M.graphite, root, { pos: [0, 0.02, 0], scale: [2.4, 0.04, 0.22] });
      half = [1.2, 0.05, 0.12];
      break;
    }
    case 'storageAnnex': {
      kit.part('box', M.graphite, root, { pos: [0, 1.1, 0], scale: [2.4, 2.2, 1.0] });
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) kit.part('box', M.white, root, { pos: [-0.85 + c * 0.57, 0.45 + r * 0.6, 0.51], scale: [0.5, 0.5, 0.02] });
      kit.part('box', M.cyan, root, { pos: [0, 2.15, 0.51], scale: [2.2, 0.05, 0.02], shadow: false });
      half = [1.2, 2.2, 0.5];
      break;
    }
    case 'marketUplink': {
      kit.part('cyl6', M.graphite, root, { pos: [0, 0.4, 0], scale: [1.4, 0.8, 1.4] });
      kit.part('cyl', M.metal, root, { pos: [0, 1.4, 0], scale: [0.18, 1.4, 0.18] });
      const dish = kit.node('dish', root, [0, 2.2, 0]);
      kit.part('cone', M.white, dish, { rot: [-0.9, 0, 0], scale: [1.4, 0.4, 1.4] });
      kit.part('sphere', accent, dish, { pos: [0, 0.35, 0.3], scale: [0.14, 0.14, 0.14], shadow: false });
      ctx.animators.push((_dt, t) => {
        if (!root.isDisposed()) dish.rotation.y = t * 0.3;
      });
      half = [0.7, 2.8, 0.7];
      break;
    }
    case 'calibrator': {
      kit.part('box', M.graphite, root, { pos: [0, 0.3, 0], scale: [1.8, 0.6, 1.4] });
      const ringN = kit.node('calRing', root, [0, 1.5, 0]);
      kit.part('torus', M.white, ringN, { scale: [1.4, 1.4, 1.4] });
      kit.part('torusThin', accent, ringN, { scale: [1.2, 1.2, 1.2], shadow: false });
      ctx.animators.push((_dt, t) => {
        if (!root.isDisposed()) ringN.rotation.x = t * 0.7;
      });
      half = [0.9, 2.3, 0.7];
      break;
    }
  }
  // Collider from the rotated half-extents (AABB of the rotated footprint).
  const c = Math.abs(Math.cos(p.rotationY));
  const s = Math.abs(Math.sin(p.rotationY));
  const hx = (half[0] * c + half[2] * s) * p.scale;
  const hz = (half[0] * s + half[2] * c) * p.scale;
  ctx.collider(p.position[0] - hx, p.position[1], p.position[2] - hz, p.position[0] + hx, p.position[1] + half[1] * p.scale, p.position[2] + hz);
  return root;
}

