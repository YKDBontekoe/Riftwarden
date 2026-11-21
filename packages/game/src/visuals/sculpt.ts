import { VertexData } from '@babylonjs/core';

/**
 * Procedural sculpting for hard-surface models: smooth lofted shells and lathed parts.
 *
 * loft: a surface through a sequence of superellipse cross-sections placed along an axis. Each
 * section has its own half-width, half-height, centre offset and squareness (n = 2 ellipse, 4..8
 * rounded rectangle), so one call makes a tapered torso, a wedge head, a limb or a hull. The sides
 * are hard-surface: rectangular sections (n >= 3) become chamfered octagons with creased facets, round
 * sections (n < 3) stay smooth; the two end caps are flat with their own vertices. UVs are planar in metres for the tiled wear textures.
 */
export interface Section {
  /** Position along the loft axis. */
  t: number;
  /** Half extent across (x for 'z'/'y' lofts, z for 'x' lofts). */
  w: number;
  /** Half extent in the second cross direction (y for 'z'/'x' lofts, z for 'y' lofts). */
  h: number;
  /** Centre offset of the section (along the first and second cross directions). */
  u?: number;
  v?: number;
  /** Superellipse exponent (2 = ellipse, higher = squarer). */
  n?: number;
  /** Rotation of the cross section in its own plane, in radians. */
  roll?: number;
}

export type LoftAxis = 'x' | 'y' | 'z';

const UV = 2;

/** Point on a superellipse of half-sizes (a, b) and exponent n at angle t. */
function superPoint(a: number, b: number, n: number, t: number): [number, number] {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const e = 2 / n;
  return [a * Math.sign(c) * Math.pow(Math.abs(c), e), b * Math.sign(s) * Math.pow(Math.abs(s), e)];
}

/** Map (cross1, cross2, along) to xyz for the axis. */
function place(axis: LoftAxis, p: number, q: number, t: number): [number, number, number] {
  if (axis === 'z') return [p, q, t];
  if (axis === 'x') return [t, q, p];
  return [p, t, q];
}

/**
 * Chamfer of a hard-surface section, as a share of its smaller half-extent. Squarer sections
 * (higher n) get narrower chamfers; n < 3 keeps the round superellipse path.
 */
export function chamferRatio(n: number): number {
  if (n >= 8) return 0.07;
  if (n >= 6) return 0.1;
  if (n >= 5) return 0.13;
  if (n >= 4) return 0.17;
  return 0.24;
}

/** Chamfered rectangle (8 points, counter-clockwise, starting just above +x like the round path). */
function chamferRing(w: number, h: number, n: number): [number, number][] {
  const c = Math.min(w, h) * chamferRatio(n);
  return [
    [w, -h + c], [w, h - c], [w - c, h], [-w + c, h],
    [-w, h - c], [-w, -h + c], [-w + c, -h], [w - c, -h],
  ];
}

const CREASE = Math.cos((22 * Math.PI) / 180);

export function loftData(sections: Section[], axis: LoftAxis = 'z', segs = 28): VertexData {
  // Hard-surface path whenever every section is rectangular-ish (n >= 3): chamfered sections,
  // creased edges. Round sections (n < 3: barrels, joints, lathes) keep the smooth path.
  const hard = sections.every((s) => (s.n ?? 4) >= 3);
  const pts: [number, number, number][][] = sections.map((s) => {
    const c = Math.cos(s.roll ?? 0), sin = Math.sin(s.roll ?? 0);
    const ring2d: [number, number][] = hard
      ? chamferRing(Math.max(1e-4, s.w), Math.max(1e-4, s.h), s.n ?? 4)
      : Array.from({ length: segs }, (_, k) => superPoint(Math.max(1e-4, s.w), Math.max(1e-4, s.h), s.n ?? 4, (k / segs) * Math.PI * 2 + Math.PI / segs));
    return ring2d.map(([p, q]) => place(axis, p * c - q * sin + (s.u ?? 0), p * sin + q * c + (s.v ?? 0), s.t));
  });
  const K = pts[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  const normals: number[] = [];
  // Winding so normals face outward whichever way the sections run.
  // x/y placements are an odd permutation of (cross1, cross2, along), z an even one.
  const flip = !(sections[sections.length - 1].t < sections[0].t) !== (axis === 'z');
  const quad = (a: number, b: number, c: number, d: number) => {
    if (flip) idx.push(a, b, c, b, d, c);
    else idx.push(a, c, b, b, c, d);
  };

  if (!hard) {
    for (const ring of pts) for (const p of ring) pos.push(...p);
    for (let r = 0; r < pts.length - 1; r++)
      for (let k = 0; k < K; k++) quad(r * K + k, r * K + ((k + 1) % K), (r + 1) * K + k, (r + 1) * K + ((k + 1) % K));
    VertexData.ComputeNormals(pos, idx, normals);
  } else {
    // One facet column per section edge: hard creases between columns; along the loft the
    // quads share normals only where the surface bends less than CREASE.
    const centre = (r: number) => place(axis, sections[r].u ?? 0, sections[r].v ?? 0, sections[r].t);
    for (let k = 0; k < K; k++) {
      const k1 = (k + 1) % K;
      const qn: [number, number, number][] = [];
      for (let r = 0; r < pts.length - 1; r++) {
        const A = pts[r][k], B = pts[r][k1], C = pts[r + 1][k], D = pts[r + 1][k1];
        const e1 = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
        const e2 = [C[0] - B[0], C[1] - B[1], C[2] - B[2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        const m = [(A[0] + B[0] + C[0] + D[0]) / 4, (A[1] + B[1] + C[1] + D[1]) / 4, (A[2] + B[2] + C[2] + D[2]) / 4];
        const c0 = centre(r), c1 = centre(r + 1);
        const out = [m[0] - (c0[0] + c1[0]) / 2, m[1] - (c0[1] + c1[1]) / 2, m[2] - (c0[2] + c1[2]) / 2];
        let len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) {
          [nx, ny, nz] = out;
          len = Math.hypot(nx, ny, nz) || 1;
        }
        if (nx * out[0] + ny * out[1] + nz * out[2] < 0) len = -len;
        qn.push([nx / len, ny / len, nz / len]);
      }
      const blend = (r: number, other: number) => {
        const n = qn[r];
        const o = qn[other];
        if (!o || n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < CREASE) return n;
        const x = n[0] + o[0], y = n[1] + o[1], z = n[2] + o[2];
        const l = Math.hypot(x, y, z) || 1;
        return [x / l, y / l, z / l];
      };
      for (let r = 0; r < pts.length - 1; r++) {
        const base = pos.length / 3;
        const lo = blend(r, r - 1);
        const hi = blend(r, r + 1);
        for (const [p, n] of [[pts[r][k], lo], [pts[r][k1], lo], [pts[r + 1][k], hi], [pts[r + 1][k1], hi]] as const) {
          pos.push(...p);
          normals.push(...n);
        }
        quad(base, base + 1, base + 2, base + 3);
      }
    }
  }

  // Flat caps with their own vertices (crisp end edges).
  const cap = (ri: number, dir: number) => {
    const s = sections[ri];
    const base = pos.length / 3;
    const n = place(axis, 0, 0, dir);
    const c = place(axis, s.u ?? 0, s.v ?? 0, s.t);
    pos.push(...c);
    normals.push(...n);
    for (const p of pts[ri]) {
      pos.push(...p);
      normals.push(...n);
    }
    for (let k = 0; k < K; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % K);
      const out = (dir > 0) === (axis === 'z');
      if (out) idx.push(base, b, a);
      else idx.push(base, a, b);
    }
  };
  const first = sections[0].t < sections[sections.length - 1].t ? -1 : 1;
  if (sections[0].w > 1e-3 && sections[0].h > 1e-3) cap(0, first);
  const last = sections.length - 1;
  if (sections[last].w > 1e-3 && sections[last].h > 1e-3) cap(last, -first);

  const uvs: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uvs.push((pos[i] + pos[i + 2]) * UV, pos[i + 1] * UV);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = normals;
  vd.uvs = uvs;
  return vd;
}

/**
 * Lathed part around +Y from a (radius, y) profile with smooth normals along the surface
 * (unlike the weapon lathe, which keeps every profile step crisp). Good for joints, hubs, barrels.
 */
export function smoothLatheData(profile: [number, number][], tess = 24): VertexData {
  const secs: Section[] = profile.map(([r, y]) => ({ t: y, w: r, h: r, n: 2 }));
  return loftData(secs, 'y', tess);
}
