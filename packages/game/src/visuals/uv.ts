import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

/**
 * Replace a (world-space, frozen) mesh's UVs with box projection: each vertex takes the
 * two world axes perpendicular to its dominant normal, divided by `tile` metres. Vertical
 * faces map world Y to V so streaks and panels stay upright on every wall.
 */
export function boxProjectUVs(mesh: Mesh, tile: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nrm) return;
  const wm = mesh.computeWorldMatrix(true).asArray();
  const n = pos.length / 3;
  const uvs = new Float32Array(n * 2);
  const inv = 1 / tile;
  for (let i = 0; i < n; i++) {
    const lx = pos[i * 3];
    const ly = pos[i * 3 + 1];
    const lz = pos[i * 3 + 2];
    const x = lx * wm[0] + ly * wm[4] + lz * wm[8] + wm[12];
    const y = lx * wm[1] + ly * wm[5] + lz * wm[9] + wm[13];
    const z = lx * wm[2] + ly * wm[6] + lz * wm[10] + wm[14];
    const ax = Math.abs(nrm[i * 3]);
    const ay = Math.abs(nrm[i * 3 + 1]);
    const az = Math.abs(nrm[i * 3 + 2]);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = x;
      v = z;
    } else if (ax >= az) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uvs[i * 2] = u * inv;
    uvs[i * 2 + 1] = v * inv;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs, false);
}

/** Displace a ground grid's vertices by a height field (local y = height(x, z)), then rebuild normals. */
export function sculptGround(mesh: Mesh, relief: { height(x: number, z: number): number }): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const idx = mesh.getIndices();
  if (!pos || !idx) return;
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = relief.height(pos[i] + mesh.position.x, pos[i + 2] + mesh.position.z);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  mesh.setVerticesData(VertexBuffer.PositionKind, pos, false);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals, false);
  mesh.refreshBoundingInfo();
}
