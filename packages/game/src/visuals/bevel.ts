import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { type Scene } from '@babylonjs/core/scene';

/**
 * Chamfered box: 6 inset faces, 12 bevel strips and 8 corner triangles, flat shaded.
 * The narrow bevels catch specular highlights and environment reflections, which is
 * most of what separates "clean hard-surface" from "raw primitive" at a distance.
 */
export function beveledBoxData(w: number, h: number, d: number, bevel: number): VertexData {
  const a = w / 2;
  const b = h / 2;
  const c = d / 2;
  const e = Math.max(0.0001, Math.min(bevel, a * 0.49, b * 0.49, c * 0.49));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Emits a flat polygon (triangle fan) with outward winding and planar UVs.
  const poly = (pts: number[][]) => {
    // Face normal from the first triangle
    const [p0, p1, p2] = pts;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    // Centroid points outward from the box center; flip winding if needed.
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const flip = nx * cx + ny * cy + nz * cz < 0;
    if (flip) {
      pts = [...pts].reverse();
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const base = positions.length / 3;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (const p of pts) {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, ny, nz);
      // Box-style planar UVs in 0..1 over the box extents.
      if (ay >= ax && ay >= az) uvs.push(p[0] / w + 0.5, p[2] / d + 0.5);
      else if (ax >= az) uvs.push(p[2] / d + 0.5, p[1] / h + 0.5);
      else uvs.push(p[0] / w + 0.5, p[1] / h + 0.5);
    }
    // Babylon uses clockwise front faces (left-handed): emit reversed fan.
    for (let i = 1; i < pts.length - 1; i++) indices.push(base, base + i + 1, base + i);
  };

  const A = a - e, B = b - e, C = c - e;
  // Main faces
  for (const s of [-1, 1]) {
    poly([[s * a, -B, -C], [s * a, B, -C], [s * a, B, C], [s * a, -B, C]]);
    poly([[-A, s * b, -C], [A, s * b, -C], [A, s * b, C], [-A, s * b, C]]);
    poly([[-A, -B, s * c], [A, -B, s * c], [A, B, s * c], [-A, B, s * c]]);
  }
  // Edge strips
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      poly([[sx * a, sy * B, -C], [sx * A, sy * b, -C], [sx * A, sy * b, C], [sx * a, sy * B, C]]); // along z
    }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      poly([[sx * a, -B, sz * C], [sx * A, -B, sz * c], [sx * A, B, sz * c], [sx * a, B, sz * C]]); // along y
    }
  for (const sy of [-1, 1])
    for (const sz of [-1, 1]) {
      poly([[-A, sy * b, sz * C], [-A, sy * B, sz * c], [A, sy * B, sz * c], [A, sy * b, sz * C]]); // along x
    }
  // Corners
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) poly([[sx * a, sy * B, sz * C], [sx * A, sy * b, sz * C], [sx * A, sy * B, sz * c]]);

  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  return vd;
}

export function createBeveledBox(name: string, w: number, h: number, d: number, bevel: number, scene: Scene): Mesh {
  const m = new Mesh(name, scene);
  beveledBoxData(w, h, d, bevel).applyToMesh(m);
  return m;
}
