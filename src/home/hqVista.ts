import { type Material, Mesh, MeshBuilder, type PBRMaterial, type Scene } from '@babylonjs/core';
import { type Palette, unlit } from '../visuals/materials';
import { loftData, type LoftAxis, type Section, smoothLatheData } from '../visuals/sculpt';
import { boxProjectUVs } from '../visuals/uv';

/**
 * 3D middle ground outside the HQ observation window (south of z = -11): an exterior landing deck
 * with marker lights, a parked dropship, and comms masts with blinking beacons. It sits
 * between the window and the painted backdrop so the view has parallax. Meshes are merged per
 * material (a handful of draw calls); glows are unlit (no real lights, the HQ light budget is full).
 */
export interface HqVista {
  update(time: number): void;
}

export function buildHqVista(scene: Scene, P: Palette): HqVista {
  const groups = new Map<Material, Mesh[]>();
  const add = (m: Mesh, mat: Material) => {
    let g = groups.get(mat);
    if (!g) groups.set(mat, (g = []));
    g.push(m);
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material) => {
    const m = MeshBuilder.CreateBox('vista', { width: x1 - x0, height: y1 - y0, depth: z1 - z0 }, scene);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    add(m, mat);
    return m;
  };
  const sculpt = (data: ReturnType<typeof loftData>, mat: Material, x: number, y: number, z: number) => {
    const m = new Mesh('dropship', scene);
    data.applyToMesh(m);
    m.position.set(x, y, z);
    add(m, mat);
    return m;
  };
  const cyl = (x: number, y0: number, y1: number, z: number, d: number, mat: Material) => {
    const m = MeshBuilder.CreateCylinder('vista', { height: y1 - y0, diameter: d, tessellation: 12 }, scene);
    m.position.set(x, (y0 + y1) / 2, z);
    add(m, mat);
  };

  const warm = unlit(scene, 'vistaWarm', [2.2, 1.35, 0.55]);
  const cool = unlit(scene, 'vistaCool', [0.5, 1.9, 2.4]);
  const deckLine = unlit(scene, 'vistaDeckLine', [0.2, 1.2, 1.5]);
  const beacon = unlit(scene, 'vistaBeacon', [3, 0.25, 0.12]);

  // Exterior landing deck just below the window line, on pylons.
  box(-26, -1.2, -34, 26, -0.5, -12.5, P.graphite);
  for (const x of [-22, -8, 8, 22]) box(x - 0.8, -14, -30, x + 0.8, -1.2, -28.4, P.metal);
  // Deck markings: landing circle (segmented) + edge light strip.
  for (let i = 0; i < 24; i++) {
    if (i % 2) continue;
    const a = (i / 24) * Math.PI * 2;
    const m = MeshBuilder.CreateBox('vista', { width: 1.1, height: 0.04, depth: 0.22 }, scene);
    m.position.set(Math.sin(a) * 6, -0.47, -22 + Math.cos(a) * 6);
    m.rotation.y = a + Math.PI / 2;
    add(m, deckLine);
  }
  box(-26, -0.52, -34.15, 26, -0.42, -33.95, deckLine);
  for (let x = -24; x <= 24; x += 4) box(x - 0.12, -0.49, -12.8, x + 0.12, -0.4, -12.6, warm);

  // Parked utility dropship: a raked flight deck over a cargo hull, with swept outboard nacelles.
  const ship = (cx: number, cz: number) => {
    const shell = (sections: Section[], mat: Material, x: number, y: number, z: number, axis: LoftAxis = 'z') =>
      sculpt(loftData(sections, axis, 24), mat, cx + x, y, cz + z);
    shell([
      { t: -5.4, w: 1.46, h: 0.56, n: 5 },
      { t: -4.3, w: 2.05, h: 0.89, n: 5 },
      { t: 1.7, w: 2.22, h: 0.96, n: 5 },
      { t: 3.75, w: 1.58, h: 0.68, v: -0.15, n: 5 },
      { t: 5.27, w: 0.71, h: 0.28, v: -0.29, n: 4 },
    ], P.white, 0, 1.94, 0);
    shell([
      { t: -5.08, w: 1.27, h: 0.22, n: 5 },
      { t: -3.4, w: 1.66, h: 0.30, n: 5 },
      { t: 0.9, w: 1.85, h: 0.31, n: 6 },
      { t: 4.42, w: 0.87, h: 0.16, v: 0.08, n: 5 },
    ], P.graphite, 0, 1.01, 0);
    shell([
      { t: -0.15, w: 1.39, h: 0.21, v: 0.1, n: 6 },
      { t: 1.25, w: 1.42, h: 0.37, v: 0.18, n: 5 },
      { t: 2.5, w: 1.15, h: 0.31, v: 0.11, n: 5 },
      { t: 3.43, w: 0.81, h: 0.12, v: -0.15, n: 4 },
    ], P.enemyDark, 0, 2.69, 0);
    shell([
      { t: 1.44, w: 1.4, h: 0.04, v: 0.24 },
      { t: 2.42, w: 1.14, h: 0.04, v: 0.17 },
      { t: 3.40, w: 0.83, h: 0.03, v: -0.09 },
    ], deckLine, 0, 2.69, 0);
    for (const s of [-1, 1]) {
      shell([
        { t: s * 1.7, w: 1.95, h: 0.24, n: 6 },
        { t: s * 4.65, w: 0.86, h: 0.14, u: -1.23, v: 0.26, n: 6 },
      ], P.graphite, 0, 1.85, -0.55, 'x');
      shell([
        { t: -3.7, w: 0.55, h: 0.54, n: 4 },
        { t: -3.06, w: 0.87, h: 0.74, n: 4 },
        { t: -1.03, w: 0.79, h: 0.7, n: 4 },
        { t: 0.6, w: 0.46, h: 0.39, n: 4 },
      ], P.metal, s * 4.35, 2.02, 0);
      shell([
        { t: -2.56, w: 0.85, h: 0.63, n: 4 },
        { t: -2.27, w: 0.86, h: 0.66, n: 4 },
      ], P.enamel, s * 4.35, 2.08, 0);
      const nozzle = sculpt(smoothLatheData([[0.52, 0], [0.49, 0.36], [0.4, 0.44]], 20), P.graphite, cx + s * 4.35, 2.02, cz - 3.64);
      nozzle.rotation.x = -Math.PI / 2;
      const light = sculpt(smoothLatheData([[0.31, 0], [0.29, 0.04]], 20), cool, cx + s * 4.35, 2.02, cz - 4.09);
      light.rotation.x = -Math.PI / 2;
      for (const z of [-3, 2.15]) {
        const x = cx + s * 1.47;
        box(x - 0.12, -0.37, cz + z - 0.12, x + 0.12, 1.12, cz + z + 0.12, P.metal);
        box(x - 0.37, -0.5, cz + z - 0.59, x + 0.37, -0.34, cz + z + 0.59, P.graphite);
      }
      box(cx + s * 4.35 - 0.23, 2.43, cz - 1.09, cx + s * 4.35 + 0.23, 2.49, cz - 0.95, s > 0 ? warm : cool);
    }
  };
  ship(-9, -25);
  // Comms masts on the deck corners.
  for (const x of [-24, 24]) {
    cyl(x, -0.5, 12, -32.5, 0.3, P.metal);
    box(x - 1.6, 9, -32.6, x + 1.6, 9.15, -32.4, P.metal);
    box(x - 0.25, 12, -32.75, x + 0.25, 12.5, -32.25, beacon);
  }

  for (const [mat, list] of groups) {
    const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = 'hqVista';
    merged.material = mat;
    if (mat === P.graphite || mat === P.metal || mat === P.white) boxProjectUVs(merged, 3);
    merged.isPickable = false;
    merged.freezeWorldMatrix();
  }

  const beaconMat = beacon as PBRMaterial;
  return {
    update(time: number) {
      // Slow double blink, like aviation obstruction lights.
      const t = time % 2.4;
      const on = t < 0.12 || (t > 0.35 && t < 0.47) ? 1 : 0.08;
      beaconMat.emissiveColor.set(3 * on, 0.25 * on, 0.12 * on);
    },
  };
}
