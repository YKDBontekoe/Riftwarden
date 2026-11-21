import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { cylProfile, latheData, type P2, tubeProfile } from './geometry';

/** Vertex-data helpers shared by the weapon model builders (pure geometry, no scene). */
export function copyVd(vd: VertexData): VertexData {
  const o = new VertexData();
  o.positions = Array.from(vd.positions as ArrayLike<number>);
  o.normals = Array.from(vd.normals as ArrayLike<number>);
  o.uvs = Array.from(vd.uvs as ArrayLike<number>);
  o.indices = Array.from(vd.indices as ArrayLike<number>);
  return o;
}

/** Lathe (+Y axis) -> +Z axis (proper rotation). */
export function alongZ(vd: VertexData): VertexData {
  const sw = (a: number[]) => {
    for (let i = 0; i < a.length; i += 3) {
      const y = a[i + 1];
      const z = a[i + 2];
      a[i + 1] = -z;
      a[i + 2] = y;
    }
  };
  sw(vd.positions as number[]);
  sw(vd.normals as number[]);
  return vd;
}

/** Lathe (+Y axis) -> +X axis (proper rotation). */
export function alongX(vd: VertexData): VertexData {
  const sw = (a: number[]) => {
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i];
      const y = a[i + 1];
      a[i] = y;
      a[i + 1] = -x;
    }
  };
  sw(vd.positions as number[]);
  sw(vd.normals as number[]);
  return vd;
}

export const lathe = (p: P2[], tess = 24) => latheData(p, tess);
export const cylZ = (r: number, z0: number, z1: number, ch = 0.002, tess = 24) => alongZ(latheData(cylProfile(r, z0, z1, ch), tess));
export const tubeZ = (ro: number, ri: number, z0: number, z1: number, tess = 28) => alongZ(latheData(tubeProfile(ro, ri, z0, z1), tess));
export const cylX = (r: number, x0: number, x1: number, ch = 0.002, tess = 20) => alongX(latheData(cylProfile(r, x0, x1, ch), tess));

