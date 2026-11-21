import { VertexData } from '@babylonjs/core';

/**
 * Hard-surface primitives for procedural weapons (pure vertex generation).
 *
 * - lathe:  surface of revolution from a (radius, height) profile. Each profile segment is
 *           its own ring of vertices, so chamfers and steps keep crisp edges while the
 *           surface stays smooth around the axis (barrels, coils, cores, emitters).
 * - prism:  side-profile polygon (z, y) extruded across x with a chamfer on both outlines
 *           (receivers, rails, plates, fins). Concave outlines are triangulated by ear
 *           clipping; the chamfer catches highlights like a machined edge.
 * UVs are in metres (scaled), so a tileable micro-surface texture keeps one texel density.
 */
const UV_SCALE = 3;

export type P2 = [number, number];

/** Surface of revolution around +Y. `profile` = [radius, y] from bottom to top. */
export function latheData(profile: P2[], tess = 24, arc = Math.PI * 2): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const closed = arc >= Math.PI * 2 - 1e-6;
  const ring = closed ? tess : tess + 1;
  let vAcc = 0;
  for (let s = 0; s < profile.length - 1; s++) {
    const [r0, y0] = profile[s];
    const [r1, y1] = profile[s + 1];
    const dr = r1 - r0;
    const dy = y1 - y0;
    const len = Math.hypot(dr, dy);
    if (len < 1e-7) continue;
    // Outward normal of the segment in the (r, y) plane.
    const nr = dy / len;
    const ny = -dr / len;
    const base = positions.length / 3;
    for (let k = 0; k <= (closed ? tess : tess); k++) {
      if (closed && k === tess) break;
      const a = (k / tess) * arc;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      for (const [r, y, v] of [[r0, y0, vAcc], [r1, y1, vAcc + len]] as const) {
        positions.push(r * c, y, r * sn);
        normals.push(nr * c, ny, nr * sn);
        uvs.push((a * Math.max(r0, r1, 0.01)) * UV_SCALE, v * UV_SCALE);
      }
    }
    for (let k = 0; k < tess; k++) {
      const a0 = base + k * 2;
      const a1 = base + ((k + 1) % ring) * 2;
      // Clockwise front faces (Babylon left-handed).
      indices.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1);
    }
    vAcc += len;
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  return fixWinding(vd);
}

/** Ensure triangles face along their vertex normals (generation-order independent). */
function fixWinding(vd: VertexData): VertexData {
  const p = vd.positions as number[];
  const n = vd.normals as number[];
  const idx = vd.indices as number[];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const nx = n[a] + n[b] + n[c];
    const ny = n[a + 1] + n[b + 1] + n[c + 1];
    const nz = n[a + 2] + n[b + 2] + n[c + 2];
    // Babylon front faces are clockwise: geometric normal must point against the vertex normal.
    if (fx * nx + fy * ny + fz * nz > 0) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
  return vd;
}

function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Ear clipping for a simple polygon (CCW). Returns index triples. */
export function triangulate(pts: P2[]): number[] {
  const n = pts.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (cross(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(pts[j], a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // malformed outline: emit what we have
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/** Offset a CCW polygon inward by d (miter, clamped for sharp corners). */
function inset(pts: P2[], d: number): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const e0x = p1[0] - p0[0], e0y = p1[1] - p0[1];
    const e1x = p2[0] - p1[0], e1y = p2[1] - p1[1];
    const l0 = Math.hypot(e0x, e0y) || 1;
    const l1 = Math.hypot(e1x, e1y) || 1;
    // Inward normals of a CCW polygon: (-ey, ex).
    const n0x = -e0y / l0, n0y = e0x / l0;
    const n1x = -e1y / l1, n1y = e1x / l1;
    let bx = n0x + n1x;
    let by = n0y + n1y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const cosHalf = Math.max(0.35, bx * n0x + by * n0y);
    const k = d / cosHalf;
    out.push([p1[0] + bx * k, p1[1] + by * k]);
  }
  return out;
}

/**
 * Chamfered extrusion: `profile` is the side outline in (z, y) (forward, up), extruded
 * symmetrically to ±width/2 along x. `chamfer` bevels both outline edges.
 */
export function prismData(profile: P2[], width: number, chamfer = 0.004): VertexData {
  let pts = profile.map((p) => [p[0], p[1]] as P2);
  if (signedArea(pts) < 0) pts = pts.reverse();
  const c = Math.max(0, Math.min(chamfer, width * 0.45));
  const hw = width / 2;
  const inner = c > 0 ? inset(pts, c) : pts;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (a: number[], b: number[], cc: number[], d: number[]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = positions.length / 3;
    for (const p of [a, b, cc, d]) {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, ny, nz);
      // Project on the dominant plane.
      const ax = Math.abs(nx), ay = Math.abs(ny);
      if (ay > 0.7) uvs.push(p[0] * UV_SCALE, p[2] * UV_SCALE);
      else if (ax > 0.7) uvs.push(p[2] * UV_SCALE, p[1] * UV_SCALE);
      else uvs.push((p[0] + p[2]) * UV_SCALE, p[1] * UV_SCALE);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Side wall (full outline at x = ±(hw - c)).
  const n = pts.length;
  const xi = hw - c;
  for (let i = 0; i < n; i++) {
    const [z0, y0] = pts[i];
    const [z1, y1] = pts[(i + 1) % n];
    quad([-xi, y0, z0], [xi, y0, z0], [xi, y1, z1], [-xi, y1, z1]);
    if (c > 0) {
      const [iz0, iy0] = inner[i];
      const [iz1, iy1] = inner[(i + 1) % n];
      quad([xi, y0, z0], [hw, iy0, iz0], [hw, iy1, iz1], [xi, y1, z1]);
      quad([-hw, iy0, iz0], [-xi, y0, z0], [-xi, y1, z1], [-hw, iy1, iz1]);
    }
  }
  // Caps.
  const tri = triangulate(inner);
  for (const side of [1, -1]) {
    const base = positions.length / 3;
    for (const [z, y] of inner) {
      positions.push(side * hw, y, z);
      normals.push(side, 0, 0);
      uvs.push(z * UV_SCALE, y * UV_SCALE);
    }
    for (let t = 0; t < tri.length; t += 3) indices.push(base + tri[t], base + tri[t + 1], base + tri[t + 2]);
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  return fixWinding(vd);
}

/** Chamfered box centred on the origin (w along x, h along y, d along z). */
export function boxData(w: number, h: number, d: number, chamfer = 0.004): VertexData {
  const z = d / 2;
  const y = h / 2;
  return prismData([[-z, -y], [z, -y], [z, y], [-z, y]], w, chamfer);
}

/** Lathe helper: a straight chamfered cylinder along +Y from y0 to y1. */
export function cylProfile(r: number, y0: number, y1: number, ch = 0.003, open = false): P2[] {
  const c = Math.min(ch, r * 0.4, (y1 - y0) * 0.3);
  if (open) return [[r, y0], [r, y1]];
  return [[0, y0], [r - c, y0], [r, y0 + c], [r, y1 - c], [r - c, y1], [0, y1]];
}

/** Tube (hollow cylinder with chamfered lips). */
export function tubeProfile(rOut: number, rIn: number, y0: number, y1: number, ch = 0.002): P2[] {
  const c = Math.min(ch, (rOut - rIn) * 0.4);
  return [[rIn, y1], [rIn, y0 + c], [rIn + c, y0], [rOut - c, y0], [rOut, y0 + c], [rOut, y1 - c], [rOut - c, y1], [rIn + c, y1], [rIn, y1 - c]];
}
