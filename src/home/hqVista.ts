import { type Material, Mesh, MeshBuilder, type PBRMaterial, type Scene } from '@babylonjs/core';
import { type Palette, unlit } from '../visuals/materials';
import { rng } from '../visuals/textures';

/**
 * 3D middle ground outside the HQ observation window (south of z = -11): an exterior landing deck
 * with marker lights and a parked dropship, lit towers and comms masts with blinking beacons. It sits
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
  const cyl = (x: number, y0: number, y1: number, z: number, d: number, mat: Material) => {
    const m = MeshBuilder.CreateCylinder('vista', { height: y1 - y0, diameter: d, tessellation: 12 }, scene);
    m.position.set(x, (y0 + y1) / 2, z);
    add(m, mat);
  };

  const warm = unlit(scene, 'vistaWarm', [2.2, 1.35, 0.55]);
  const cool = unlit(scene, 'vistaCool', [0.5, 1.9, 2.4]);
  const deckLine = unlit(scene, 'vistaDeckLine', [0.2, 1.2, 1.5]);
  const beacon = unlit(scene, 'vistaBeacon', [3, 0.25, 0.12]);
  const r = rng(4242);

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

  // Parked dropship on the pad: hull, cockpit band, engine pods, landing struts.
  const ship = (cx: number, cz: number) => {
    box(cx - 2.2, 0.9, cz - 5.5, cx + 2.2, 2.6, cz + 4.5, P.white);
    box(cx - 1.8, 2.6, cz - 4.5, cx + 1.8, 3.3, cz + 2.5, P.panel);
    box(cx - 1.9, 1.9, cz + 4.5, cx + 1.9, 2.5, cz + 5.6, P.graphite);
    box(cx - 1.6, 2.05, cz + 5.55, cx + 1.6, 2.35, cz + 5.65, cool);
    for (const s of [-1, 1]) {
      box(cx + s * 2.2, 1.4, cz - 1.5, cx + s * 5.6, 1.7, cz + 1.5, P.graphite);
      cyl(cx + s * 5.2, 0.8, 2.6, cz - 0.2, 1.4, P.metal);
      box(cx + s * 5.2 - 0.5, 0.75, cz - 0.7, cx + s * 5.2 + 0.5, 0.85, cz + 0.3, warm);
      for (const z of [-4, 3]) box(cx + s * 1.4 - 0.12, -0.5, cz + z - 0.12, cx + s * 1.4 + 0.12, 0.9, cz + z + 0.12, P.metal);
    }
  };
  ship(-11, -24);

  // Mid-ground towers with lit window bands and roof beacons.
  for (let i = 0; i < 9; i++) {
    const x = -70 + i * 17 + (r() - 0.5) * 6;
    const z = -40 - r() * 16;
    const w = 6 + r() * 6;
    const d = 5 + r() * 4;
    const h = 14 + r() * 26;
    box(x - w / 2, -14, z - d / 2, x + w / 2, h, z + d / 2, P.graphite);
    // Lit windows on the face toward the HQ: small cells on a floor grid, a sparse random subset lit.
    for (let y = -10; y < h - 1.5; y += 1.25) {
      for (let wx = x - w / 2 + 0.5; wx < x + w / 2 - 0.6; wx += 0.9) {
        if (r() > 0.22) continue;
        box(wx, y, z + d / 2, wx + 0.55, y + 0.38, z + d / 2 + 0.05, r() < 0.72 ? warm : cool);
      }
    }
    if (r() < 0.7) {
      cyl(x, h, h + 4 + r() * 6, z, 0.25, P.metal);
      box(x - 0.3, h + 4, z - 0.3, x + 0.3, h + 4.6, z + 0.3, beacon);
    }
  }
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
