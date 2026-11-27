import { Constants } from '@babylonjs/core/Engines/constants';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { canvas, fbm, toTexture, vnoise } from './textures';

/**
 * Where a floor meets a wall, real places collect dirt: a dark contact shadow, a band of grime or drift on the
 * floor and staining creeping up the wall. Without it every seam is a clean CG line. This builds those three
 * layers along a list of wall bases ("faces") as three merged, frozen, unpickable meshes with alpha-blended lit
 * materials (they take the scene's light and shadows like the surfaces under them).
 */
export interface GrimeFace {
  /** Base segment on the floor. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Unit normal pointing away from the solid, into the open floor. */
  nx: number;
  nz: number;
  /** Floor height (0 in the arena). */
  y?: number;
  /** No wall staining strip (the solid's visible wall is recessed from the face, e.g. container walls). */
  floorOnly?: boolean;
}

export interface GrimeLook {
  /** Floor band colour, opacity and width (m). */
  floor: [number, number, number];
  floorAlpha: number;
  floorWidth: number;
  /** Wall staining colour, opacity and height (m). */
  wall: [number, number, number];
  wallAlpha: number;
  wallHeight: number;
  /** Contact shadow strength and width. */
  ao: number;
  aoWidth: number;
  roughness: number;
}

export const GRIME: Record<'outpost' | 'cryo' | 'foundry' | 'hq', GrimeLook> = {
  // Mud, oil and wind-blown grit.
  outpost: { floor: [0.15, 0.125, 0.1], floorAlpha: 0.7, floorWidth: 1.6, wall: [0.08, 0.065, 0.05], wallAlpha: 0.7, wallHeight: 1.3, ao: 0.75, aoWidth: 0.55, roughness: 0.9 },
  // Snow drifts piled against every wall, a little slush staining above them.
  cryo: { floor: [0.82, 0.87, 0.93], floorAlpha: 0.95, floorWidth: 1.9, wall: [0.74, 0.8, 0.88], wallAlpha: 0.5, wallHeight: 0.45, ao: 0.55, aoWidth: 0.4, roughness: 0.75 },
  // Ash (pale, so it reads on the dark deck) over soot staining on the walls.
  foundry: { floor: [0.13, 0.115, 0.105], floorAlpha: 0.7, floorWidth: 1.7, wall: [0.03, 0.026, 0.024], wallAlpha: 0.8, wallHeight: 1.8, ao: 0.8, aoWidth: 0.6, roughness: 0.95 },
  // A maintained interior: just a contact shadow and a little dust at the skirting.
  hq: { floor: [0.16, 0.16, 0.17], floorAlpha: 0.3, floorWidth: 0.7, wall: [0.12, 0.12, 0.13], wallAlpha: 0.22, wallHeight: 0.5, ao: 0.6, aoWidth: 0.32, roughness: 0.8 },
};

/** Ragged falloff mask: opaque at v = 0 (the seam), breaking up into patches toward v = 1. */
function falloffTexture(scene: Scene, name: string, seed: number, ragged: number) {
  const W = 1024;
  const H = 256;
  const { c, ctx } = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      // Periodic in u, so the strip tiles along any wall length.
      const n = fbm(u, v * 0.25, 8, 4, seed) * 0.7 + vnoise(u * 64, v * 16, 64, seed + 7, 16) * 0.3;
      const edge = 1 - v - (n - 0.5) * ragged;
      // Soft, wide falloff: a hard alpha edge stair-steps into visible pixels at a metre-wide strip.
      const a = Math.max(0, Math.min(1, edge * 1.25)) ** 2.2;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(name, c, scene, { aniso: 4 });
  t.hasAlpha = true;
  t.wrapV = 0; // clamp across the strip
  return t;
}

function material(scene: Scene, name: string, color: [number, number, number], alpha: number, roughness: number, mask: ReturnType<typeof falloffTexture>, z: number) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = new Color3(...color);
  m.metallic = 0;
  m.roughness = roughness;
  m.alpha = alpha;
  m.opacityTexture = mask;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.alphaMode = Constants.ALPHA_COMBINE;
  m.usePhysicalLightFalloff = false;
  m.maxSimultaneousLights = 8;
  m.zOffset = z;
  m.disableDepthWrite = true;
  return m;
}

/**
 * Quads along each face. Floor strips: v runs from the seam outward. Wall strips: v runs from the floor up. U runs
 * along the wall in metres / 4, so the masks tile without stretching.
 */
function strips(faces: readonly GrimeFace[], width: number, wall: boolean, lift: number): VertexData {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const f of faces) {
    const y = (f.y ?? 0) + lift;
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    if (len < 0.2) continue;
    const ax = (f.x1 - f.x0) / len;
    const az = (f.z1 - f.z0) / len;
    // Floor strips run past both ends and fade out there (vertex alpha), so they never end in a hard,
    // tile-like edge; wall strips stop at the corner.
    const ext = wall ? 0 : width * 0.7;
    const cols: [number, number][] = wall ? [[0, 1], [len, 1]] : [[-ext, 0], [0, 1], [len, 1], [len + ext, 0]];
    const base = pos.length / 3;
    const off = 0.015; // just off the surface
    for (const [t, a] of cols) {
      const px = f.x0 + ax * t;
      const pz = f.z0 + az * t;
      const u = (t + ext) / 4;
      if (wall) {
        pos.push(px + f.nx * off, y, pz + f.nz * off, px + f.nx * off, y + width, pz + f.nz * off);
        nrm.push(f.nx, 0, f.nz, f.nx, 0, f.nz);
      } else {
        pos.push(px + f.nx * off, y, pz + f.nz * off, px + f.nx * (width + off), y, pz + f.nz * (width + off));
        nrm.push(0, 1, 0, 0, 1, 0);
      }
      uv.push(u, 0, u, 1);
      col.push(1, 1, 1, a, 1, 1, 1, a);
    }
    for (let k = 0; k < cols.length - 1; k++) {
      const b = base + k * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.colors = col;
  return vd;
}

export function buildContactGrime(scene: Scene, faces: readonly GrimeFace[], look: GrimeLook, seed = 11): void {
  if (scene.getEngine() instanceof NullEngine || !faces.length) return;
  const ragged = falloffTexture(scene, 'grimeMask', seed, 1.1);
  // Wall staining fades smoothly: a ragged mask on a vertical strip reads as dithered noise.
  const soft = falloffTexture(scene, 'grimeSoft', seed + 7, 0.45);
  const tight = falloffTexture(scene, 'grimeAo', seed + 3, 0.35);
  const layers: [string, VertexData, PBRMaterial][] = [
    ['grimeAo', strips(faces, look.aoWidth, false, 0.012), material(scene, 'grimeAo', [0, 0, 0], look.ao, 1, tight, -3)],
    ['grimeFloor', strips(faces, look.floorWidth, false, 0.018), material(scene, 'grimeFloor', look.floor, look.floorAlpha, look.roughness, ragged, -4)],
    ['grimeWall', strips(faces.filter((f) => !f.floorOnly), look.wallHeight, true, 0), material(scene, 'grimeWall', look.wall, look.wallAlpha, look.roughness, soft, -2)],
  ];
  for (const [name, data, mat] of layers) {
    if (!data.positions?.length) continue;
    const mesh = new Mesh(name, scene);
    data.applyToMesh(mesh);
    mesh.material = mat;
    mesh.hasVertexAlpha = true;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
  }
}

/** Wall bases of every grounded solid in an arena layout (inner faces only for the perimeter). */
export function arenaGrimeFaces(L: ArenaLayout): GrimeFace[] {
  const H = L.half;
  const out: GrimeFace[] = [];
  for (const b of L.boxes) {
    if (b.min[1] > 0.1 || b.kind === 'reactor' || b.kind === 'gate' || b.kind === 'bridge') continue;
    const [x0, , z0] = b.min;
    const [x1, , z1] = b.max;
    const sides: GrimeFace[] = [
      { x0, z0, x1, z1: z0, nx: 0, nz: -1 },
      { x0, z0: z1, x1, z1, nx: 0, nz: 1 },
      { x0, z0, x1: x0, z1, nx: -1, nz: 0 },
      { x0: x1, z0, x1, z1, nx: 1, nz: 0 },
    ];
    for (const s of sides) {
      // Faces whose open side lies outside the playable square face the void: skip them.
      const mx = (s.x0 + s.x1) / 2 + s.nx * 0.5;
      const mz = (s.z0 + s.z1) / 2 + s.nz * 0.5;
      if (Math.abs(mx) > H || Math.abs(mz) > H) continue;
      out.push({ ...s, floorOnly: b.kind === 'container', x0: Math.max(-H, Math.min(H, s.x0)), x1: Math.max(-H, Math.min(H, s.x1)), z0: Math.max(-H, Math.min(H, s.z0)), z1: Math.max(-H, Math.min(H, s.z1)) });
    }
  }
  return out;
}
