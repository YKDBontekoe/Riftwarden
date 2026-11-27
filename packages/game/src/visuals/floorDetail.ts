import { Constants } from '@babylonjs/core/Engines/constants';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { type BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { BiomeId } from '@riftwarden/rules/world/biomes';
import { scannedMaterial, type SurfaceSetId } from './biomeSurfaces';
import type { FloorPlan, FloorRect, FloorSeg } from './floorPlan';
import { canvas, fbm, toTexture, vnoise } from './textures';

/**
 * Builds the floor detail plan (floorPlan.ts) as thin overlays that follow the sculpted ground exactly: the height
 * sampler below reproduces the ground mesh's own triangles (CreateGround lattice and diagonal), so joints, cracks
 * and patches neither float nor sink into the relief. Visual only: not pickable, no collision, one mesh per layer.
 */
export class GroundSurface {
  private readonly step: number;
  constructor(private readonly relief: { height(x: number, z: number): number }, private readonly span: number, private readonly sub: number) {
    this.step = span / sub;
  }

  /** Height of the rendered ground mesh at (x, z), matching its triangulation. */
  height(x: number, z: number): number {
    if (this.sub <= 1) return 0;
    const fc = (x + this.span / 2) / this.step;
    const fr = (this.span / 2 - z) / this.step;
    const c = Math.max(0, Math.min(this.sub - 1, Math.floor(fc)));
    const r = Math.max(0, Math.min(this.sub - 1, Math.floor(fr)));
    const u = fc - c, v = fr - r;
    const at = (cc: number, rr: number) => this.relief.height(-this.span / 2 + cc * this.step, this.span / 2 - rr * this.step);
    const h00 = at(c, r), h11 = at(c + 1, r + 1);
    // CreateGround splits each cell along (c, r) - (c + 1, r + 1).
    if (u >= v) return h00 + (at(c + 1, r) - h00) * (u - v) + (h11 - h00) * v;
    return h00 + (at(c, r + 1) - h00) * (v - u) + (h11 - h00) * u;
  }
}

interface Build { pos: number[]; uv: number[]; idx: number[] }
const fresh = (): Build => ({ pos: [], uv: [], idx: [] });

/** A strip along a segment, `n` cross-section vertices, sampled every ~0.3 m; u runs in metres / uLen. */
function strip(b: Build, s: FloorSeg, width: number, lift: number, uLen: number, g: GroundSurface): void {
  const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
  if (len < 0.05) return;
  const dx = (s.x1 - s.x0) / len, dz = (s.z1 - s.z0) / len;
  const nx = -dz, nz = dx;
  const steps = Math.max(1, Math.ceil(len / 0.3));
  const across = [-0.5, 0, 0.5];
  const base = b.pos.length / 3;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len;
    for (const a of across) {
      const x = s.x0 + dx * t + nx * a * width, z = s.z0 + dz * t + nz * a * width;
      b.pos.push(x, g.height(x, z) + lift, z);
      b.uv.push(t / uLen, a + 0.5);
    }
  }
  for (let i = 0; i < steps; i++)
    for (let k = 0; k < across.length - 1; k++) {
      const p = base + i * across.length + k, q = p + across.length;
      b.idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
}

/** A rotated rectangle as an n x m grid on the ground; `world` = UVs in metres / world (tiling sets), else 0..1. */
function sheet(b: Build, x: number, z: number, w: number, d: number, rot: number, lift: number, g: GroundSurface, world = 0): void {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const nu = Math.max(2, Math.ceil(w / 0.3)), nv = Math.max(2, Math.ceil(d / 0.3));
  const base = b.pos.length / 3;
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const lu = (i / nu - 0.5) * w, lv = (j / nv - 0.5) * d;
      const px = x + lu * c - lv * sn, pz = z + lu * sn + lv * c;
      b.pos.push(px, g.height(px, pz) + lift, pz);
      if (world) b.uv.push(px / world, pz / world);
      else b.uv.push(i / nu, j / nv);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const p = base + j * (nu + 1) + i, q = p + nu + 1;
      b.idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
}

function mesh(scene: Scene, name: string, b: Build, mat: PBRMaterial): Mesh | null {
  if (!b.idx.length) return null;
  const vd = new VertexData();
  vd.positions = b.pos;
  vd.indices = b.idx;
  vd.uvs = b.uv;
  const nrm: number[] = [];
  VertexData.ComputeNormals(b.pos, b.idx, nrm);
  // Winding of the grids above faces down in Babylon's left-handed frame: flip normals to point up.
  for (let i = 1; i < nrm.length; i += 3) if (nrm[i] < 0) { nrm[i - 1] *= -1; nrm[i] *= -1; nrm[i + 1] *= -1; }
  vd.normals = nrm;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m);
  m.material = mat;
  m.isPickable = false;
  m.receiveShadows = true;
  m.freezeWorldMatrix();
  return m;
}

function decal(scene: Scene, name: string, color: [number, number, number], alpha: number, roughness: number, mask: BaseTexture, z: number, shaded = false): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = new Color3(...color);
  m.metallic = 0;
  m.roughness = roughness;
  m.alpha = alpha;
  if (shaded) {
    m.albedoTexture = mask;
    m.useAlphaFromAlbedoTexture = true;
  } else m.opacityTexture = mask;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.alphaMode = Constants.ALPHA_COMBINE;
  m.usePhysicalLightFalloff = false;
  m.maxSimultaneousLights = 8;
  m.zOffset = z;
  m.disableDepthWrite = true;
  m.backFaceCulling = false;
  // Decals sit in a dusk scene: full IBL on their gloss mirrors the sky as blue blobs.
  m.environmentIntensity = 0.45;
  return m;
}

/** Alpha-only mask texture from a per-texel function (v = 0..1 rows). */
function maskTexture(scene: Scene, name: string, w: number, h: number, f: (u: number, v: number) => number, shade?: (u: number, v: number) => number) {
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = shade ? Math.max(0, Math.min(1, shade(x / w, y / h))) * 255 : 255;
      img.data[i + 3] = Math.max(0, Math.min(1, f(x / w, y / h))) * 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(name, c, scene, { aniso: 8 });
  t.hasAlpha = true;
  return t;
}

/** Saw cut: a dark 1 cm core with chipped, dirt-filled shoulders that wander along the joint. */
function jointMask(scene: Scene) {
  const chip = (u: number) => vnoise(u * 64, 0, 64, 3) * 0.55 + vnoise(u * 9, 0, 9, 5) * 0.45;
  const coreW = (u: number) => 0.2 + chip(u) * 0.12;
  // RGB: near-black dirt-filled cut, pale dust and spalled concrete on the shoulders (contrast against any deck).
  return maskTexture(scene, 'floorJoint', 512, 32, (u, v) => {
    const d = Math.abs(v - 0.5) * 2;
    const core = d < coreW(u) ? 1 : 0;
    const shoulder = Math.max(0, 1 - (d - coreW(u)) / (0.25 + chip(u) * 0.55)) * (vnoise(u * 40, v * 3, 40, 17, 3) > 0.5 ? 0.7 : 0.15);
    return Math.max(core, shoulder) * (0.8 + 0.2 * vnoise(u * 32, v * 4, 32, 9, 4));
  }, (u, v) => (Math.abs(v - 0.5) * 2 < coreW(u) ? 0.03 : 0.5 + 0.35 * vnoise(u * 48, v * 8, 48, 13, 8)));
}

/** Branching crack network: a few random walks from the centre, thinner as they go. */
function crackMask(scene: Scene, seed: number) {
  const N = 512;
  const { c, ctx } = canvas(N);
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
  ctx.lineCap = 'round';
  const walk = (x: number, y: number, a: number, len: number, width: number, depth: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < len; i++) {
      a += (rnd() - 0.5) * 0.9;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      if (x < 8 || y < 8 || x > N - 8 || y > N - 8) break;
      ctx.lineTo(x, y);
      if (depth < 3 && rnd() < 0.07) walk(x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd()), len * 0.45, width * 0.6, depth + 1);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(255,255,255,${0.95 - depth * 0.18})`;
    ctx.stroke();
  };
  for (let k = 0; k < 3; k++) walk(N / 2, N / 2, rnd() * Math.PI * 2 + k * 2.1, 38, 5.5, 0);
  // Wider dirt halo so the crack sits in a weathered line, not a pen stroke.
  const img = ctx.getImageData(0, 0, N, N);
  const out = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      let halo = 0;
      for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) {
        const xx = Math.min(N - 1, Math.max(0, x + dx)), yy = Math.min(N - 1, Math.max(0, y + dy));
        halo = Math.max(halo, img.data[(yy * N + xx) * 4 + 3]);
      }
      out.data[i] = out.data[i + 1] = out.data[i + 2] = 255;
      out.data[i + 3] = Math.max(img.data[i + 3], halo * 0.45);
    }
  ctx.putImageData(out, 0, 0);
  const t = toTexture('floorCrack', c, scene, { aniso: 8 });
  t.hasAlpha = true;
  t.wrapU = t.wrapV = 0;
  return t;
}

/** Soft irregular blob (oil spots, snow drift outlines). */
function blobMask(scene: Scene, name: string, seed: number, hard: number) {
  const t = maskTexture(scene, name, 256, 256, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const n = fbm(u, v, 5, 4, seed) - 0.5;
    const a = (1 - d + n * 0.8) * hard;
    return a * (0.7 + 0.3 * vnoise(u * 24, v * 24, 24, seed + 4));
  });
  t.wrapU = t.wrapV = 0;
  return t;
}

/** Worn paint: mostly solid, scuffed through along wheel paths and at random flakes. */
function paintMask(scene: Scene) {
  return maskTexture(scene, 'floorPaint', 512, 32, (u, v) => {
    const edge = Math.min(v, 1 - v) * 2;
    const wear = fbm(u, v * 0.06, 8, 4, 21);
    const flake = vnoise(u * 90, v * 6, 90, 23, 6);
    return (edge > 0.12 ? 1 : edge / 0.12) * (wear > 0.42 ? 0.85 : wear / 0.5) * (flake > 0.22 ? 1 : 0.2);
  });
}

const PATCH: Record<BiomeId, { set: SurfaceSetId; tint: [number, number, number]; tile: number }> = {
  outpost: { set: 'outpost-patch', tint: [0.72, 0.72, 0.74], tile: 3 },
  cryo: { set: 'cryo-patch', tint: [1.02, 1.05, 1.1], tile: 3 },
  foundry: { set: 'foundry-patch', tint: [1.05, 0.95, 0.86], tile: 2.4 },
};

const POOL: Record<BiomeId, { color: [number, number, number]; rough: number }> = {
  outpost: { color: [0.03, 0.03, 0.032], rough: 0.16 },
  cryo: { color: [0.42, 0.52, 0.6], rough: 0.09 },
  foundry: { color: [0.03, 0.022, 0.016], rough: 0.3 },
};

/** Build every floor detail layer for one arena (skipped on the headless engine). */
export function buildFloorDetail(scene: Scene, plan: FloorPlan, biome: BiomeId, ground: GroundSurface, environment: number, seed: number): void {
  if (scene.getEngine() instanceof NullEngine) return;
  // Patches: the second scanned surface of the biome, laid flush (1 cm proud, like an overlay course).
  const pb = fresh();
  const look = PATCH[biome];
  // Cryo drifts use 0..1 UVs for their ragged outline; the snow maps then tile through their own uScale.
  for (const p of plan.patches) sheet(pb, p.x, p.z, p.w, p.d, p.yaw, 0.01, ground, biome === 'cryo' ? 0 : look.tile);
  const patchMat = scannedMaterial(scene, 'floorPatch', look.set, look.tint, 1, environment);
  patchMat.zOffset = -1;
  patchMat.backFaceCulling = false;
  if (biome === 'cryo') {
    for (const t of [patchMat.albedoTexture, patchMat.bumpTexture, patchMat.metallicTexture]) if (t instanceof Texture) t.uScale = t.vScale = 2;
    patchMat.opacityTexture = blobMask(scene, 'floorDrift', seed + 7, 2.4);
    patchMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    patchMat.alphaCutOff = 0.45;
  }
  mesh(scene, 'floorPatches', pb, patchMat);

  // Saw cuts: the slab joints plus the outline of every replaced slab / trench strip.
  const jb = fresh();
  for (const s of plan.joints) strip(jb, s, 0.15, 0.006, 4, ground);
  if (biome !== 'cryo') for (const p of plan.patches) for (const s of outline(p)) strip(jb, s, 0.12, 0.016, 4, ground);
  mesh(scene, 'floorJoints', jb, decal(scene, 'floorJoint', biome === 'foundry' ? [0.62, 0.52, 0.45] : [0.7, 0.7, 0.7], 1, 0.9, jointMask(scene), -3, true));

  const cb = fresh();
  for (const c of plan.cracks) sheet(cb, c.x, c.z, c.r * 2, c.r * 2, c.rot, 0.007, ground);
  mesh(scene, 'floorCracks', cb, decal(scene, 'floorCrack', biome === 'cryo' ? [0.36, 0.42, 0.5] : [0.035, 0.032, 0.03], biome === 'cryo' ? 0.55 : 0.95, 0.9, crackMask(scene, seed), -3));

  // Oil and soot spots: glossier than the concrete, like real drips.
  const sb = fresh();
  for (const s of plan.spots) sheet(sb, s.x, s.z, s.r * 2, s.r * 2, s.rot, 0.008, ground);
  const spotColor: [number, number, number] = biome === 'cryo' ? [0.5, 0.58, 0.66] : [0.03, 0.026, 0.022];
  mesh(scene, 'floorSpots', sb, decal(scene, 'floorSpot', spotColor, biome === 'cryo' ? 0.4 : 0.85, 0.6, blobMask(scene, 'floorSpotMask', seed + 3, 1.6), -3));

  // Worn yellow walkway paint.
  const wb = fresh();
  for (const s of plan.paint) strip(wb, s, 0.14, 0.012, 6, ground);
  const paint = decal(scene, 'floorPaint', biome === 'foundry' ? [0.5, 0.34, 0.05] : [0.62, 0.46, 0.06], 0.8, 0.7, paintMask(scene), -4);
  mesh(scene, 'floorPaint', wb, paint);

  // Standing water / ice: flat discs at the water level; the ground above it forms the shore.
  if (plan.pools.length) {
    const ob: Build = fresh();
    for (const p of plan.pools) {
      const base = ob.pos.length / 3;
      const n = 28;
      ob.pos.push(p.x, p.level, p.z);
      ob.uv.push(0.5, 0.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ob.pos.push(p.x + Math.cos(a) * p.r, p.level, p.z + Math.sin(a) * p.r);
        ob.uv.push(0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2);
      }
      for (let i = 0; i < n; i++) ob.idx.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
    }
    const w = POOL[biome];
    const water = new PBRMaterial('floorWater', scene);
    water.albedoColor = new Color3(...w.color);
    water.metallic = 0;
    water.roughness = w.rough;
    water.environmentIntensity = environment * (biome === 'foundry' ? 0.35 : 0.8);
    water.usePhysicalLightFalloff = false;
    water.maxSimultaneousLights = 8;
    water.backFaceCulling = false;
    mesh(scene, 'floorWater', ob, water);
  }
}

/** The four edges of a rectangle (saw-cut outline of a patch). */
function outline(p: FloorRect): FloorSeg[] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const pt = (u: number, v: number): [number, number] => [p.x + u * c - v * s, p.z + u * s + v * c];
  const k = [pt(-p.w / 2, -p.d / 2), pt(p.w / 2, -p.d / 2), pt(p.w / 2, p.d / 2), pt(-p.w / 2, p.d / 2)];
  return k.map((a, i) => ({ x0: a[0], z0: a[1], x1: k[(i + 1) % 4][0], z1: k[(i + 1) % 4][1] }));
}

