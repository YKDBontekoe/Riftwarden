import { type DynamicTexture, type Material, Matrix, MeshBuilder, type PBRMaterial, type Scene, type TransformNode, VertexBuffer } from '@babylonjs/core';
import { type Kit } from '../visuals/kit';
import { unlit } from '../visuals/materials';
import { canvas, flareSprite, toTexture } from '../visuals/textures';
import { ARENA } from '../world/layout';
import type { HqMaterials } from './HqBuilder';
import type { Station } from './layout';
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

export const SCREEN_FONT = '"Chakra Petch", "Rajdhani", "Segoe UI", sans-serif';
export const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

export function makeScreen(scene: Scene, name: string, w = 512, h = 288, tint: [number, number, number] = [1, 1, 1]): ScreenTex {
  const { c, ctx } = canvas(w, h);
  const tex = toTexture(`scr_${name}`, c, scene, { aniso: 4 });
  tex.wrapU = tex.wrapV = 0; // clamp
  const mat = unlit(scene, `scrMat_${name}`, tint, { tex });
  return { tex, mat, ctx, w, h, base: 1 };
}

/** Standard terminal UI frame: dark glass, grid, header bar, corner ticks. */
export function drawScreenFrame(s: ScreenTex, title: string, accent = '#4fe6f5'): void {
  const { ctx, w, h } = s;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#062029');
  g.addColorStop(1, '#020b10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(79,230,245,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(18, 18, 6, 30);
  ctx.globalAlpha = 1;
  ctx.font = `700 30px ${SCREEN_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8f7fb';
  ctx.fillText(title, 34, 34);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  for (const [x, y] of [[6, 6], [w - 26, 6], [6, h - 8], [w - 26, h - 8]]) ctx.fillRect(x, y, 20, 2);
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

/** Floating sign with large lettering (unlit, transparent background). */
export function makeSign(ctx: PropCtx, text: string, pos: [number, number, number], yaw: number, width: number, color = '#bff6ff'): void {
  const W = 1024;
  const H = 128;
  const { c, ctx: g } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.font = `700 74px ${SCREEN_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 18;
  // Letter spacing by drawing glyphs individually.
  const spacing = 14;
  const glyphs = [...text];
  const widths = glyphs.map((ch) => g.measureText(ch).width + spacing);
  let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2 + spacing / 2;
  for (let i = 0; i < glyphs.length; i++) {
    g.fillText(glyphs[i], x + widths[i] / 2 - spacing / 2, H / 2 + 4);
    x += widths[i];
  }
  const tex = toTexture(`sign_${text}`, c, ctx.scene, { aniso: 4 });
  tex.hasAlpha = true;
  tex.wrapU = tex.wrapV = 0;
  const mat = unlit(ctx.scene, `signMat_${text}`, [1.25, 1.25, 1.25], { tex, opacity: tex });
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
  kit.part('box', M.graphite, root, { pos: [0, 0.45, -0.05], scale: [width * 0.7, 0.9, 0.55] });
  kit.part('box', M.white, root, { pos: [0, 0.92, 0.05], rot: [-0.25, 0, 0], scale: [width, 0.08, 0.75] });
  kit.part('box', M.cyan, root, { pos: [0, 0.9, 0.43], rot: [-0.25, 0, 0], scale: [width * 0.96, 0.025, 0.02] });
  kit.part('box', M.graphite, root, { pos: [0, 0.06, 0.05], scale: [width * 0.9, 0.12, 0.9] });
  // Screen housing + screen
  kit.part('box', M.screenFrame, root, { pos: [0, 1.36, -0.22], rot: [-0.35, 0, 0], scale: [width * 0.92, 0.62, 0.06] });
  const plane = planeBuilder(ctx.scene, `screen_${st.id}`, width * 0.86, 0.54);
  plane.material = screen.mat;
  plane.parent = root;
  plane.position.set(0, 1.36, -0.185);
  plane.rotation.x = -0.35;
  // Status light on the pedestal
  kit.part('box', M.cyan, root, { pos: [0, 0.6, 0.235], scale: [0.4, 0.03, 0.01] });
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
  // Clamps around the ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    kit.part('box', M.white, root, { pos: [Math.cos(a) * 3.75, 4.2 + Math.sin(a) * 3.75, 0], rot: [0, 0, a], scale: [0.7, 0.5, 1.1] });
  }
  // Pylons
  for (const s of [-1, 1]) {
    kit.part('box', M.graphite, root, { pos: [s * 4.6, 3.4, 0], scale: [0.9, 6.8, 1.6] });
    kit.part('box', M.cyan, root, { pos: [s * 4.12, 3.4, -0.4], scale: [0.04, 5.6, 0.08] });
  }
  ctx.collider(-5.3, 0, 18.6, 5.3, 8, 20.6);
  // Membrane: swirling energy disc (additive), slowly rotating.
  const S = 256;
  const { c, ctx: g } = canvas(S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2);
      const dy = (y - S / 2) / (S / 2);
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const swirl = 0.5 + 0.5 * Math.sin(a * 5 + r * 14);
      const v = r > 1 ? 0 : Math.pow(1 - r, 0.6) * (0.25 + 0.75 * swirl) * (0.4 + 0.6 * r);
      const i = (y * S + x) * 4;
      img.data[i] = v * 120;
      img.data[i + 1] = v * 235;
      img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const tex = toTexture('membrane', c, scene, { aniso: 2 });
  tex.wrapU = tex.wrapV = 0;
  const mat = unlit(scene, 'membraneMat', [1.8, 1.8, 1.8], { tex, additive: true, twoSided: true });
  // Dark void behind the membrane so the energy reads against the bright bay.
  const voidMat = unlit(scene, 'launchVoid', [0.004, 0.02, 0.03]);
  const back = MeshBuilder.CreateDisc('launchVoid', { radius: 3.35, tessellation: 48 }, scene);
  back.material = voidMat;
  back.parent = root;
  back.position.set(0, 4.2, 0.25); // CreateDisc faces -z: towards the player
  back.isPickable = false;
  const disc = MeshBuilder.CreateDisc('membrane', { radius: 3.2, tessellation: 48 }, scene);
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
  ctx.animators.push((dt, t) => {
    disc.rotation.z += dt * 0.35;
    mat.emissiveColor.setAll(1.5 + 0.35 * Math.sin(t * 1.7));
  });
  // Launch rails with travelling chevrons towards the ring
  for (const s of [-1, 1]) kit.part('box', M.metal, root, { pos: [s * 1.6, 0.04, -5], scale: [0.25, 0.08, 9] });
  const chevs: TransformNode[] = [];
  for (let i = 0; i < 7; i++) {
    const n = kit.node(`chev${i}`, root, [0, 0.03, -9 + i * 1.3]);
    for (const s of [-1, 1]) kit.part('box', M.cyanDim, n, { pos: [s * 0.32, 0, 0], rot: [0, s * 0.75, 0], scale: [0.12, 0.02, 0.9] });
    chevs.push(n);
  }
  ctx.animators.push((_dt, t) => {
    for (let i = 0; i < chevs.length; i++) chevs[i].position.z = -9 + ((i * 1.3 + t * 1.2) % 9.1);
  });
}

/** Central holo-table with a slowly turning miniature of the arena and orbiting rings. */
export function commandTable(ctx: PropCtx): void {
  const { kit, M, scene } = ctx;
  const root = kit.node('commandTable', null, [0, 0, 0]);
  kit.part('cyl8', M.graphite, root, { pos: [0, 0.45, 0], scale: [4.2, 0.9, 4.2] });
  kit.part('cyl8', M.white, root, { pos: [0, 0.95, 0], scale: [4.6, 0.12, 4.6] });
  kit.part('torusThin', M.cyan, root, { pos: [0, 1.02, 0], scale: [4.3, 1, 4.3] });
  kit.part('cyl', M.screenFrame, root, { pos: [0, 1.0, 0], scale: [3.6, 0.04, 3.6] });
  kit.part('cyl', M.cyanDim, root, { pos: [0, 1.03, 0], scale: [1.2, 0.02, 1.2] });
  ctx.collider(-2.3, 0, -2.3, 2.3, 1.1, 2.3);
  // Hologram: arena blocks as translucent cyan boxes (data from the real arena layout).
  const holoMat = unlit(scene, 'holoMat', [0.05, 0.4, 0.5], { additive: true });
  const holoEdge = unlit(scene, 'holoEdge', [0.3, 1.6, 2.0], { additive: true });
  const holo = kit.node('holo', root, [0, 1.45, 0]);
  const k = 1 / 40;
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
  const ringA = kit.node('ringA', root, [0, 2.1, 0]);
  kit.part('torusThin', holoEdge, ringA, { scale: [2.6, 2.6, 2.6] });
  const ringB = kit.node('ringB', root, [0, 2.1, 0]);
  kit.part('torusThin', holoMat, ringB, { scale: [2.0, 2.0, 2.0] });
  const cone = MeshBuilder.CreateCylinder('holoCone', { diameterTop: 3.6, diameterBottom: 0.6, height: 1.2, tessellation: 32, cap: 0 }, scene);
  const coneTex = flareSprite(scene);
  const coneMat = unlit(scene, 'holoConeMat', [0.03, 0.18, 0.22], { additive: true, twoSided: true, opacity: coneTex });
  cone.material = coneMat;
  cone.parent = root;
  cone.position.y = 1.65;
  cone.isPickable = false;
  ctx.animators.push((dt, t) => {
    holo.rotation.y += dt * 0.12;
    holo.position.y = 1.45 + Math.sin(t * 0.8) * 0.03;
    ringA.rotation.set(0.25 + Math.sin(t * 0.5) * 0.1, t * 0.4, 0);
    ringB.rotation.set(-0.3, -t * 0.55, Math.sin(t * 0.7) * 0.15);
    holoMat.emissiveColor.set(0.05, 0.4 + Math.sin(t * 3.1) * 0.04, 0.5);
  });
}

/** Drone cradle in the configuration bay: the player's drone on display, scanned. */
export function droneCradle(ctx: PropCtx, at: [number, number]): void {
  const { kit, M } = ctx;
  const root = kit.node('cradle', null, [at[0], 0, at[1]]);
  kit.part('cyl8', M.graphite, root, { pos: [0, 0.2, 0], scale: [3.0, 0.4, 3.0] });
  kit.part('cyl8', M.white, root, { pos: [0, 0.45, 0], scale: [2.4, 0.1, 2.4] });
  kit.part('torusThin', M.cyan, root, { pos: [0, 0.52, 0], scale: [2.2, 1, 2.2] });
  ctx.collider(at[0] - 1.5, 0, at[1] - 1.5, at[0] + 1.5, 0.6, at[1] + 1.5);
  // Overhead gantry
  for (const s of [-1, 1]) kit.part('box', M.graphite, root, { pos: [0, 4.4, s * 1.4], scale: [0.3, 0.3, 0.3] });
  kit.part('box', M.white, root, { pos: [0, 4.6, 0], scale: [0.5, 0.25, 3.4] });
  kit.part('box', M.lamp, root, { pos: [0, 4.46, 0], scale: [0.3, 0.02, 2.6] });

  // The drone itself (built from the same kit as everything else).
  const drone = kit.node('displayDrone', root, [0, 1.75, 0]);
  kit.part('ico', M.white, drone, { scale: [0.95, 0.62, 1.15] });
  kit.part('box', M.graphite, drone, { pos: [0, -0.05, 0], scale: [1.05, 0.22, 0.9] });
  kit.part('sphere', M.cyan, drone, { pos: [0, 0.02, 0.56], scale: [0.26, 0.2, 0.12] });
  kit.part('torusThin', M.cyanDim, drone, { pos: [0, 0.02, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.42, 0.42] });
  for (const s of [-1, 1]) {
    const pod = kit.node('pod', drone, [s * 0.78, -0.02, -0.1]);
    kit.part('torus', M.graphite, pod, { scale: [0.62, 0.9, 0.62] });
    kit.part('cyl', M.cyanDim, pod, { scale: [0.5, 0.04, 0.5] });
    kit.part('box', M.graphite, pod, { pos: [-s * 0.22, 0, 0], scale: [0.3, 0.1, 0.16] });
  }
  // Plasma repeater slung under the chassis
  const gun = kit.node('gun', drone, [0.32, -0.32, 0.2]);
  kit.part('box', M.graphite, gun, { scale: [0.2, 0.18, 0.8] });
  kit.part('cyl', M.metal, gun, { pos: [0, 0.01, 0.55], rot: [Math.PI / 2, 0, 0], scale: [0.09, 0.4, 0.09] });
  for (let i = 0; i < 3; i++) kit.part('torusThin', M.cyan, gun, { pos: [0, 0.01, 0.1 + i * 0.14], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.2, 0.2] });
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
  kit.part('box', M.white, j1, { pos: [0, 0.35, 0], scale: [0.12, 0.7, 0.12] });
  const j2 = kit.node('j2', j1, [0, 0.7, 0]);
  kit.part('sphere', M.graphite, j2, { scale: [0.16, 0.16, 0.16] });
  kit.part('box', M.white, j2, { pos: [0, 0.28, 0], scale: [0.1, 0.56, 0.1] });
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
      kit.part('box', M.graphite, root, { pos: [0, 0.3, 0], scale: [1.3, 0.6, 1.3] });
      kit.part('box', M.white, root, { pos: [0, 0.62, 0], scale: [1.4, 0.08, 1.4] });
      kit.part('box', accent, root, { pos: [0, 0.5, 0.66], scale: [1.0, 0.03, 0.01] });
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        const r = i === 0 ? 0 : 0.35;
        kit.part('ico', M.plant, root, { pos: [Math.cos(a) * r, 0.85 + (i % 3) * 0.18, Math.sin(a) * r], rot: [a, a * 0.7, 0], scale: [0.55 - (i % 3) * 0.1, 0.5, 0.55] });
      }
      half = [0.7, 1.2, 0.7];
      break;
    }
    case 'crates': {
      kit.part('box', M.white, root, { pos: [0, 0.4, 0], scale: [1.2, 0.8, 0.9] });
      kit.part('box', M.graphite, root, { pos: [0.1, 1.1, 0.05], rot: [0, 0.25, 0], scale: [0.9, 0.6, 0.7] });
      kit.part('box', M.white, root, { pos: [-1.05, 0.35, 0.1], rot: [0, -0.2, 0], scale: [0.7, 0.7, 0.7] });
      kit.part('box', accent, root, { pos: [0, 0.6, 0.455], scale: [0.9, 0.04, 0.01] });
      half = [1.5, 1.4, 0.7];
      break;
    }
    case 'serverRack': {
      kit.part('box', M.graphite, root, { pos: [0, 1.2, 0], scale: [1.1, 2.4, 0.8] });
      kit.part('box', M.white, root, { pos: [0, 2.44, 0], scale: [1.15, 0.08, 0.85] });
      for (let i = 0; i < 8; i++) kit.part('box', i % 3 === 1 ? accent : M.screenFrame, root, { pos: [0, 0.4 + i * 0.25, 0.405], scale: [0.9, 0.04, 0.01] });
      half = [0.6, 2.5, 0.45];
      break;
    }
    case 'lightPylon': {
      kit.part('box', M.graphite, root, { pos: [0, 0.1, 0], scale: [0.7, 0.2, 0.7] });
      kit.part('cyl', M.white, root, { pos: [0, 1.6, 0], scale: [0.22, 3.0, 0.22] });
      kit.part('cyl', accent, root, { pos: [0, 1.7, 0], scale: [0.12, 2.4, 0.12] });
      kit.part('box', M.graphite, root, { pos: [0, 3.15, 0], scale: [0.4, 0.12, 0.4] });
      half = [0.35, 3.2, 0.35];
      break;
    }
    case 'bench': {
      kit.part('box', M.white, root, { pos: [0, 0.48, 0], scale: [2.4, 0.1, 0.6] });
      for (const s of [-1, 1]) kit.part('box', M.graphite, root, { pos: [s * 0.95, 0.22, 0], scale: [0.12, 0.44, 0.5] });
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
  }
  // Collider from the rotated half-extents (AABB of the rotated footprint).
  const c = Math.abs(Math.cos(p.rotationY));
  const s = Math.abs(Math.sin(p.rotationY));
  const hx = (half[0] * c + half[2] * s) * p.scale;
  const hz = (half[0] * s + half[2] * c) * p.scale;
  ctx.collider(p.position[0] - hx, p.position[1], p.position[2] - hz, p.position[0] + hx, p.position[1] + half[1] * p.scale, p.position[2] + hz);
  return root;
}

