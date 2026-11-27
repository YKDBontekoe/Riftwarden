import type { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Box } from '@riftwarden/rules/world/layout';
import { scannedMaterial, type SurfaceSetId } from './biomeSurfaces';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Geometry of a real ISO freight container (not a box with ribs): trapezoidal side corrugation at the 278 mm
 * pitch, corrugated rear wall, two door leaves with four locking bars, cams, brackets and hinges, corner posts,
 * top and bottom rails and the eight corner castings. Built in a local frame (length along x, width along z,
 * floor at y = 0, centred), as plain vertex data so the arena merges it per material like every other solid.
 * UVs are metres / 2.5 so detail maps keep their real scale.
 */
export interface ContainerParts {
  /** Painted steel: walls, doors, posts and rails. */
  body: VertexData;
  /** Bare / dark steel: corner castings, locking bars, hinges. */
  hardware: VertexData;
  /** Roof (the buildable top of a stack). */
  roof: VertexData;
}

class Builder {
  pos: number[] = [];
  idx: number[] = [];
  uv: number[] = [];

  /** Quad from four corners (counter-clockwise seen from outside). */
  quad(a: number[], b: number[], c: number[], d: number[]): void {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      // Planar UV from the two axes the quad spans most.
      const ex = Math.abs(c[0] - a[0]) + Math.abs(b[0] - a[0]);
      const ez = Math.abs(c[2] - a[2]) + Math.abs(b[2] - a[2]);
      const ey = Math.abs(c[1] - a[1]) + Math.abs(b[1] - a[1]);
      const u = ex >= ez ? p[0] : p[2];
      const v = ey > 0.001 ? p[1] : ex >= ez ? p[2] : p[0];
      this.uv.push(u / 2.5, v / 2.5);
    }
    // Babylon is left-handed: front faces wind clockwise as seen from outside.
    this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }

  /** Axis-aligned box (all six faces, outward winding). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const q = (a: number[], b: number[], c: number[], d: number[]) => this.quad(a, b, c, d);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }

  /** Vertical cylinder approximated by an 8-sided prism. */
  bar(x: number, z: number, r: number, y0: number, y1: number): void {
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, z + Math.sin(a1) * r];
      this.quad([p1[0], y0, p1[1]], [p0[0], y0, p0[1]], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]]);
    }
  }

  data(): VertexData {
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.indices = this.idx;
    vd.uvs = this.uv;
    const normals: number[] = [];
    VertexData.ComputeNormals(this.pos, this.idx, normals);
    vd.normals = normals;
    return vd;
  }
}

/** Trapezoid corrugation offset (outward, m) at distance t along a wall. Real ISO: 278 mm pitch, ~36 mm deep. */
function corrugation(t: number, pitch = 0.278, depth = 0.036): number {
  const f = ((t % pitch) + pitch) % pitch / pitch;
  // flat out (0.0-0.3), ramp down (0.3-0.5), flat in (0.5-0.8), ramp up (0.8-1.0)
  if (f < 0.3) return depth;
  if (f < 0.5) return depth * (1 - (f - 0.3) / 0.2);
  if (f < 0.8) return 0;
  return depth * ((f - 0.8) / 0.2);
}

/** Corrugated wall in the plane `fixed` (axis 'z' = side wall at z = fixed, 'x' = end wall at x = fixed). */
function corrugatedWall(b: Builder, axis: 'x' | 'z', fixed: number, out: number, a0: number, a1: number, y0: number, y1: number, pitch: number, depth: number): void {
  const steps: number[] = [];
  const f = [0, 0.3, 0.5, 0.8];
  for (let base = Math.floor(a0 / pitch) * pitch; base < a1; base += pitch) for (const k of f) {
    const t = base + k * pitch;
    if (t > a0 && t < a1) steps.push(t);
  }
  const ts = [a0, ...steps, a1];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    const o0 = fixed + out * corrugation(t0 - a0, pitch, depth);
    const o1 = fixed + out * corrugation(t1 - a0, pitch, depth);
    if (axis === 'z') {
      if (out > 0) b.quad([t0, y0, o0], [t1, y0, o1], [t1, y1, o1], [t0, y1, o0]);
      else b.quad([t1, y0, o1], [t0, y0, o0], [t0, y1, o0], [t1, y1, o1]);
    } else if (out > 0) b.quad([o1, y0, t1], [o0, y0, t0], [o0, y1, t0], [o1, y1, t1]);
    else b.quad([o0, y0, t0], [o1, y0, t1], [o1, y1, t1], [o0, y1, t0]);
  }
}

/**
 * One container of length L (x), width W (z), height H (y). `doorEnd` = +1 puts the doors on +x, -1 on -x.
 */
export function containerParts(L: number, W: number, H: number, doorEnd: 1 | -1): ContainerParts {
  const body = new Builder();
  const hw = new Builder();
  const roof = new Builder();
  const hx = L / 2;
  const hz = W / 2;
  const post = 0.16; // corner post / rail section
  const inset = 0.05; // walls sit just inside the frame line
  // Side walls (corrugated), between the corner posts and between the rails.
  for (const s of [-1, 1]) corrugatedWall(body, 'z', s * (hz - inset), s, -hx + post, hx - post, post, H - post, 0.278, 0.036);
  // Rear wall: vertical corrugation too.
  const rear = -doorEnd;
  corrugatedWall(body, 'x', rear * (hx - inset), rear, -hz + post, hz - post, post, H - post, 0.278, 0.03);
  // Door end: two leaves, slightly recessed, with a shallow horizontal stiffener pattern.
  const dx = doorEnd * (hx - 0.03);
  const leaf = (z0: number, z1: number) => {
    const out = doorEnd;
    const p = (z: number, y: number, o = 0) => [dx + out * o, y, z];
    const q = (a: number[], b: number[], c: number[], d: number[]) => (out > 0 ? body.quad(a, b, c, d) : body.quad(b, a, d, c));
    q(p(z1, post), p(z0, post), p(z0, H - post), p(z1, H - post));
    // Four horizontal pressed ribs per leaf.
    for (let k = 1; k <= 4; k++) {
      const y = post + ((H - 2 * post) * k) / 5;
      body.box(Math.min(dx, dx + out * 0.03), y - 0.05, z0 + 0.06, Math.max(dx, dx + out * 0.03), y + 0.05, z1 - 0.06);
    }
  };
  leaf(-hz + post, -0.01);
  leaf(0.01, hz - post);
  // Locking bars: two per leaf, full height, with cams top and bottom, brackets and a handle each.
  for (const z of [-hz * 0.72, -hz * 0.28, hz * 0.28, hz * 0.72]) {
    const x = dx + doorEnd * 0.07;
    hw.bar(x, z, 0.022, post - 0.02, H - post + 0.02);
    for (const y of [post + 0.05, H - post - 0.05]) hw.box(x - 0.05, y - 0.04, z - 0.05, x + 0.05, y + 0.04, z + 0.05); // cam keeper
    for (const y of [H * 0.25, H * 0.5, H * 0.75]) hw.box(x - 0.04, y - 0.03, z - 0.035, x + 0.04, y + 0.03, z + 0.035); // bracket
    hw.box(Math.min(x, x + doorEnd * 0.09), H * 0.42, z - 0.02, Math.max(x, x + doorEnd * 0.09), H * 0.44, z + 0.02); // handle arm
  }
  // Hinges along the outer edges of both leaves.
  for (const z of [-hz + post + 0.04, hz - post - 0.04]) for (const y of [0.45, H * 0.38, H * 0.62, H - 0.45]) {
    const x = dx + doorEnd * 0.05;
    hw.box(x - 0.05, y - 0.07, z - 0.05, x + 0.05, y + 0.07, z + 0.05);
  }
  // Frame: corner posts, bottom and top side rails, end rails (painted like the body).
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (hx - post / 2);
    const z = sz * (hz - post / 2);
    body.box(x - post / 2, 0, z - post / 2, x + post / 2, H, z + post / 2);
  }
  for (const sz of [-1, 1]) {
    const z = sz * (hz - post / 2);
    body.box(-hx + post, 0, z - post / 2, hx - post, post, z + post / 2);
    body.box(-hx + post, H - post, z - post / 2, hx - post, H, z + post / 2);
  }
  for (const sx of [-1, 1]) {
    const x = sx * (hx - post / 2);
    body.box(x - post / 2, 0, -hz + post, x + post / 2, post, hz - post);
    body.box(x - post / 2, H - post, -hz + post, x + post / 2, H, hz - post);
  }
  // Corner castings (dark, slightly proud of the frame).
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, H - 0.12]) {
    const x = sx * (hx - 0.09);
    const z = sz * (hz - 0.09);
    hw.box(x - 0.1, y, z - 0.1, x + 0.1, y + 0.12, z + 0.1);
  }
  // Roof: shallow transverse dents (real roofs are dimpled), inside the top rails.
  const r0 = -hx + post;
  const r1 = hx - post;
  const dents = Math.max(2, Math.round((r1 - r0) / 0.9));
  for (let k = 0; k < dents; k++) {
    const a = r0 + ((r1 - r0) * k) / dents;
    const b2 = r0 + ((r1 - r0) * (k + 1)) / dents;
    const m = (a + b2) / 2;
    const y = H - 0.02;
    roof.quad([a, y, hz - post], [m, y - 0.02, hz - post], [m, y - 0.02, -hz + post], [a, y, -hz + post]);
    roof.quad([m, y - 0.02, hz - post], [b2, y, hz - post], [b2, y, -hz + post], [m, y - 0.02, -hz + post]);
  }
  return { body: body.data(), hardware: hw.data(), roof: roof.data() };
}

/** Bake container parts into world-space meshes (one per part), positioned and rotated. */
export function containerMeshes(scene: Scene, parts: ContainerParts, cx: number, y: number, cz: number, alongX: boolean): Mesh[] {
  return (['body', 'hardware', 'roof'] as const).map((k) => {
    const m = new Mesh(`container:${k}`, scene);
    parts[k].applyToMesh(m);
    m.position.set(cx, y, cz);
    if (!alongX) m.rotation.y = Math.PI / 2;
    return m;
  });
}

/**
 * Weathered liveries from scanned painted-steel sets (generic colours, no operator branding): rust-streaked red,
 * worn green, blue plate, rusted brown, grey plate, cream (grey plate tinted).
 */
const LIVERIES: [SurfaceSetId, [number, number, number]][] = [
  ['outpost-metal', [1, 1, 1]],
  ['outpost-casing', [1, 1, 1]],
  ['cryo-metal', [1, 1, 1]],
  ['foundry-casing', [1, 0.95, 0.9]],
  ['cryo-casing', [1, 1, 1]],
  ['cryo-casing', [1.35, 1.22, 0.98]],
  ['outpost-metal', [0.75, 0.62, 0.5]],
];

export function containerLiveries(scene: Scene, environment: number): PBRMaterial[] {
  return LIVERIES.map(([id, tint], i) => scannedMaterial(scene, `containerLivery${i}`, id, tint, 0.8, environment));
}

export interface ContainerHost {
  readonly scene: Scene;
  add(mesh: Mesh, mat: Material, surface: string | null): void;
}

/**
 * A container stack on a layout box: one real container per ~2.6 m level, each with its own livery and door end
 * (seeded from the box position so a layout always looks the same). The layout box stays the collider.
 */
export function buildContainerStack(h: ContainerHost, b: Box, liveries: readonly Material[], hardware: Material): void {
  const [x0, , z0] = b.min;
  const [x1, y1, z1] = b.max;
  const alongX = x1 - x0 >= z1 - z0;
  const L = alongX ? x1 - x0 : z1 - z0;
  const W = alongX ? z1 - z0 : x1 - x0;
  const levels = Math.max(1, Math.round(y1 / 2.6));
  const lh = y1 / levels;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  let hash = (Math.imul(Math.round(x0 * 13.7) | 0, 73856093) ^ Math.imul(Math.round(z0 * 7.9) | 0, 19349663)) >>> 0;
  for (let l = 0; l < levels; l++) {
    hash = (Math.imul(hash ^ (l + 1), 2654435761) >>> 0);
    const parts = containerParts(L, W, lh, hash & 1 ? 1 : -1);
    const [body, hw, roof] = containerMeshes(h.scene, parts, cx, l * lh, cz, alongX);
    const livery = liveries[(hash >>> 3) % liveries.length];
    h.add(body, livery, 'wall');
    h.add(hw, hardware, 'wall');
    h.add(roof, livery, l === levels - 1 ? 'platform' : 'wall');
  }
}
