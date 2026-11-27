import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { Box } from '@riftwarden/rules/world/layout';
import { smoothLatheData } from './sculpt';

/**
 * A power transformer bay built like the real thing, filling a `block` collision box: concrete plinth with a
 * kerb, ribbed main tank, radiator fin banks with header pipes on both long sides, porcelain bushings (HV on
 * top, LV on one flank), a conservator tank on brackets, a cable box and an access ladder. Everything stays
 * inside the box footprint and height, so collision, line of sight and placement are unchanged.
 */
export interface SubstationHost {
  readonly scene: Scene;
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, surface: string | null): Mesh;
  add(mesh: Mesh, mat: Material, surface: string | null): void;
}

export interface SubstationMaterials {
  concrete: Material;
  tank: Material;
  fins: Material;
  steel: Material;
  porcelain: Material;
  hazard: Material;
}

export function buildSubstation(h: SubstationHost, b: Box, M: SubstationMaterials): void {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const wide = x1 - x0 >= z1 - z0;
  const run = wide ? x1 - x0 : z1 - z0;
  const depth = wide ? z1 - z0 : x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const H = y1 - y0;
  // Local frame: a = along the run, c = across, y up. `put` maps a local box to world.
  const put = (pa: number, ya: number, pc: number, qa: number, yb: number, qc: number, mat: Material, surface: string | null = 'wall') => {
    const [a0, a1] = pa < qa ? [pa, qa] : [qa, pa];
    const [c0, c1] = pc < qc ? [pc, qc] : [qc, pc];
    return wide ? h.box(cx + a0, y0 + ya, cz + c0, cx + a1, y0 + yb, cz + c1, mat, surface) : h.box(cx + c0, y0 + ya, cz + a0, cx + c1, y0 + yb, cz + a1, mat, surface);
  };
  const place = (m: Mesh, a: number, y: number, c: number, mat: Material, surface: string | null = 'wall', alongRun = false) => {
    m.position.set(wide ? cx + a : cx + c, y0 + y, wide ? cz + c : cz + a);
    if (alongRun) m.rotation.z = Math.PI / 2;
    if (alongRun && !wide) {
      m.rotation.z = 0;
      m.rotation.x = Math.PI / 2;
    }
    h.add(m, mat, surface);
  };
  const ha = run / 2;
  const hc = depth / 2;

  // Plinth with a kerb and an oil bund lip.
  put(-ha, 0, -hc, ha, 0.28, hc, M.concrete);
  put(-ha + 0.25, 0.28, -hc + 0.25, ha - 0.25, 0.4, -hc + 0.4, M.concrete);
  put(-ha + 0.25, 0.28, hc - 0.4, ha - 0.25, 0.4, hc - 0.25, M.concrete);

  // Main tank: leaves room for the radiators on both sides.
  const finDepth = Math.min(0.9, depth * 0.18);
  const tankC = hc - finDepth - 0.35;
  const tankA = ha - 0.9;
  const tankTop = Math.min(H * 0.62, 3.4);
  put(-tankA, 0.4, -tankC, tankA, tankTop, tankC, M.tank);
  // Cover plate (slightly proud) and vertical stiffeners on all faces.
  put(-tankA - 0.06, tankTop, -tankC - 0.06, tankA + 0.06, tankTop + 0.12, tankC + 0.06, M.tank);
  for (let a = -tankA + 0.5; a < tankA - 0.2; a += 0.75) for (const s of [-1, 1]) put(a - 0.05, 0.5, s * tankC - 0.04, a + 0.05, tankTop - 0.08, s * tankC + 0.04, M.tank);
  for (let c = -tankC + 0.45; c < tankC - 0.2; c += 0.75) for (const s of [-1, 1]) put(s * tankA - 0.04, 0.5, c - 0.05, s * tankA + 0.04, tankTop - 0.08, c + 0.05, M.tank);

  // Radiator banks: groups of thin fins between a top and bottom header pipe.
  const banks = Math.max(1, Math.floor((tankA * 2 - 0.4) / 1.6));
  const bankLen = 1.25;
  for (const s of [-1, 1]) {
    const cIn = s * (tankC + 0.08);
    const cOut = s * (tankC + 0.08 + finDepth);
    for (let k = 0; k < banks; k++) {
      const a = -tankA + 0.35 + (k + 0.5) * ((tankA * 2 - 0.7) / banks);
      for (let f = 0; f < 14; f++) {
        const fa = a - bankLen / 2 + (f / 13) * bankLen;
        put(fa - 0.012, 0.75, Math.min(cIn, cOut), fa + 0.012, tankTop - 0.45, Math.max(cIn, cOut), M.fins);
      }
      for (const y of [0.68, tankTop - 0.38]) {
        const pipe = MeshBuilder.CreateCylinder('radiatorHeader', { height: bankLen + 0.1, diameter: 0.12, tessellation: 10 }, h.scene);
        place(pipe, a, y, (cIn + cOut) / 2, M.steel, 'wall', true);
        // Header to tank connection.
        put(a - 0.06, y - 0.06, Math.min(cIn, s * tankC), a + 0.06, y + 0.06, Math.max(cIn, s * tankC), M.steel);
      }
    }
  }

  // HV bushings: tall porcelain stacks (shed profile) in a row on the cover.
  const shed: [number, number][] = [[0.12, 0]];
  const stackH = Math.min(1.25, H - tankTop - 0.45);
  for (let i = 0; i < 9; i++) {
    const y = 0.08 + (i / 9) * (stackH - 0.16);
    shed.push([0.07, y], [0.16, y + 0.03], [0.07, y + 0.07]);
  }
  shed.push([0.05, stackH - 0.04], [0.04, stackH], [0, stackH + 0.01]);
  const bushing = smoothLatheData(shed, 16);
  for (const c of [-tankC * 0.55, 0, tankC * 0.55]) {
    const m = new Mesh('bushingHV', h.scene);
    bushing.applyToMesh(m);
    place(m, tankA * 0.35, tankTop + 0.12, c, M.porcelain);
    const cap = MeshBuilder.CreateCylinder('bushingCap', { height: 0.12, diameter: 0.16, tessellation: 10 }, h.scene);
    place(cap, tankA * 0.35, tankTop + 0.12 + stackH + 0.04, c, M.steel, null);
    // Turret at the base.
    put(tankA * 0.35 - 0.16, tankTop + 0.12, c - 0.16, tankA * 0.35 + 0.16, tankTop + 0.3, c + 0.16, M.tank);
  }
  // LV bushings, short, on the cover's other end.
  const lv = smoothLatheData([[0.08, 0], [0.05, 0.05], [0.1, 0.08], [0.05, 0.12], [0.1, 0.15], [0.05, 0.19], [0.03, 0.28], [0, 0.29]], 12);
  for (let i = 0; i < 4; i++) {
    const m = new Mesh('bushingLV', h.scene);
    lv.applyToMesh(m);
    place(m, -tankA * 0.55, tankTop + 0.12, (i - 1.5) * tankC * 0.35, M.porcelain, null);
  }

  // Conservator: horizontal cylinder on two brackets above the cover, piped down to the tank.
  const consLen = Math.min(tankA * 1.2, 3.2);
  const consY = Math.min(tankTop + 1.1, H - 0.35);
  const cons = MeshBuilder.CreateCylinder('conservator', { height: consLen, diameter: 0.62, tessellation: 20 }, h.scene);
  place(cons, -tankA * 0.15, consY, -tankC * 0.6, M.tank, 'wall', true);
  for (const a of [-tankA * 0.15 - consLen * 0.35, -tankA * 0.15 + consLen * 0.35]) put(a - 0.05, tankTop + 0.12, -tankC * 0.6 - 0.05, a + 0.05, consY - 0.28, -tankC * 0.6 + 0.05, M.steel);
  put(-tankA * 0.15 - 0.04, tankTop + 0.12, -tankC * 0.25 - 0.04, -tankA * 0.15 + 0.04, consY, -tankC * 0.25 + 0.04, M.steel);

  // Cable box on one end, ladder on the other, hazard-banded kerb corners.
  put(tankA, 0.6, -tankC * 0.5, tankA + 0.55, 1.9, tankC * 0.5, M.tank);
  put(tankA + 0.55, 0.4, -0.25, tankA + 0.75, 0.6, 0.25, M.steel);
  for (const c of [-0.22, 0.22]) put(-tankA - 0.08, 0.4, c - 0.025, -tankA - 0.03, tankTop + 0.1, c + 0.025, M.steel, null);
  for (let y = 0.7; y < tankTop; y += 0.3) put(-tankA - 0.08, y, -0.22, -tankA - 0.05, y + 0.03, 0.22, M.steel, null);
  for (const sa of [-1, 1]) for (const sc of [-1, 1]) put(sa * ha, 0.28, sc * hc, sa * (ha - 0.3), 0.42, sc * (hc - 0.3), M.hazard, null);
}
