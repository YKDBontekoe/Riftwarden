import { VertexData } from '@babylonjs/core';

/**
 * Procedural sculpting for hard-surface models: smooth lofted shells and lathed parts.
 *
 * loft: a surface through a sequence of superellipse cross-sections placed along an axis. Each
 * section has its own half-width, half-height, centre offset and squareness (n = 2 ellipse, 4..8
 * rounded rectangle), so one call makes a tapered torso, a wedge head, a limb or a hull. The sides
 * get smooth normals (soft, modern silhouette); the two end caps are flat with their own vertices,
 * so the ends keep a crisp machined edge. UVs are planar in metres for the tiled wear textures.
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

export function loftData(sections: Section[], axis: LoftAxis = 'z', segs = 28): VertexData {
  const pos: number[] = [];
  const idx: number[] = [];
  const rings: number[][] = [];
  for (const s of sections) {
    const ring: number[] = [];
    for (let k = 0; k < segs; k++) {
      // Start on a diagonal so the flat-ish sides get whole facets.
      const a = (k / segs) * Math.PI * 2 + Math.PI / segs;
      const [p, q] = superPoint(Math.max(1e-4, s.w), Math.max(1e-4, s.h), s.n ?? 4, a);
      ring.push(pos.length / 3);
      pos.push(...place(axis, p + (s.u ?? 0), q + (s.v ?? 0), s.t));
    }
    rings.push(ring);
  }
  // Winding so normals face outward whichever way the sections run.
  // x/y placements are an odd permutation of (cross1, cross2, along), z an even one.
  const flip = !(sections[sections.length - 1].t < sections[0].t) !== (axis === 'z');
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < segs; k++) {
      const a = rings[r][k];
      const b = rings[r][(k + 1) % segs];
      const c = rings[r + 1][k];
      const d = rings[r + 1][(k + 1) % segs];
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);

  // Flat caps with their own vertices (crisp end edges).
  const cap = (ri: number, dir: number) => {
    const ring = rings[ri];
    const s = sections[ri];
    const base = pos.length / 3;
    const n = place(axis, 0, 0, dir);
    const centre = place(axis, s.u ?? 0, s.v ?? 0, s.t);
    pos.push(...centre);
    normals.push(...n);
    for (const i of ring) {
      pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      normals.push(...n);
    }
    for (let k = 0; k < segs; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % segs);
      const out = (dir > 0) !== flip;
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
