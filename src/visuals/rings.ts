import { Mesh, type Scene, VertexData } from '@babylonjs/core';

/** Flat machined arcs around +Y, batched into a single mesh. */
export function segmentedRing(scene: Scene, name: string, radius: number, width: number, count: number, coverage: number): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const step = Math.PI * 2 / count;
  const subdivisions = Math.max(2, Math.ceil(48 * coverage / count));
  for (let i = 0; i < count; i++) {
    for (let j = 0; j <= subdivisions; j++) {
      const angle = step * (i + j / subdivisions * coverage);
      const x = Math.sin(angle);
      const z = Math.cos(angle);
      const inside = radius - width / 2;
      const outside = radius + width / 2;
      const k = positions.length / 3;
      positions.push(x * inside, 0, z * inside, x * outside, 0, z * outside);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(x * inside, z * inside, x * outside, z * outside);
      if (j > 0) indices.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}
