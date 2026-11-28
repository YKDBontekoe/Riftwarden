import { type Material } from '@babylonjs/core/Materials/material';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { BiomeId } from '@riftwarden/rules/world/biomes';
import type { Box } from '@riftwarden/rules/world/layout';
import type { YardMast } from '@riftwarden/rules/world/propPlan';
import { type GroundSurface, groundSheets } from './floorDetail';
import { type Palette, unlit } from './materials';
import { flareSprite } from './textures';

/** Lamp colour per biome (same family as the wall fixtures: sodium, cold white, furnace orange). */
const LAMP: Record<BiomeId, { lens: [number, number, number]; pool: [number, number, number] }> = {
  outpost: { lens: [3.4, 2.5, 1.4], pool: [0.2, 0.14, 0.08] },
  cryo: { lens: [2.4, 2.8, 3.3], pool: [0.11, 0.14, 0.19] },
  foundry: { lens: [3.4, 1.7, 0.7], pool: [0.24, 0.11, 0.05] },
};

/**
 * Floodlight masts standing in the open yard (planned by `planPropsDetailed`): concrete plinth, tapered steel
 * pole with a cable conduit, crossbar head with six angled lamp housings, glowing lenses, volumetric beams (the
 * atmosphere's lamp-beam shader) and a soft light pool that follows the sculpted ground. The tall verticals the
 * yard lacked at mid distance. Visual only (thin, no collider), merged per material, frozen, never pickable.
 */
export function buildYardMasts(scene: Scene, P: Palette, masts: readonly YardMast[], biome: BiomeId, ground: GroundSurface, boxes: readonly Box[] = []): void {
  if (!masts.length) return;
  const parts = new Map<Material, Mesh[]>();
  const add = (m: Mesh, mat: Material) => {
    const list = parts.get(mat);
    if (list) list.push(m);
    else parts.set(mat, [m]);
  };
  const lens = unlit(scene, 'mastLens', LAMP[biome].lens, { twoSided: true });
  const beamMat = scene.getMaterialByName('lampBeam');
  const beams: Mesh[] = [];
  const pools: { x: number; z: number; r: number }[] = [];
  for (const m of masts) {
    const g = ground.height(m.x, m.z);
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    const plinth = MeshBuilder.CreateBox('mastPlinth', { width: 1.2, depth: 1.2, height: 0.9 }, scene);
    plinth.position.set(m.x, g + 0.1, m.z);
    plinth.rotation.y = m.yaw;
    add(plinth, P.debris);
    const pole = MeshBuilder.CreateCylinder('mastPole', { diameterBottom: 0.42, diameterTop: 0.22, height: m.h, tessellation: 12 }, scene);
    pole.position.set(m.x, g + 0.5 + m.h / 2, m.z);
    add(pole, P.graphite);
    const conduit = MeshBuilder.CreateCylinder('mastConduit', { diameter: 0.07, height: m.h - 0.6, tessellation: 6 }, scene);
    conduit.position.set(m.x - fx * 0.22, g + 0.5 + (m.h - 0.6) / 2, m.z - fz * 0.22);
    add(conduit, P.graphite);
    const cab = MeshBuilder.CreateBox('mastCabinet', { width: 0.5, height: 0.75, depth: 0.28 }, scene);
    cab.position.set(m.x - fx * 0.38, g + 1.5, m.z - fz * 0.38);
    cab.rotation.y = m.yaw;
    add(cab, P.graphite);
    const top = g + 0.5 + m.h;
    const bar = MeshBuilder.CreateBox('mastBar', { width: 3, height: 0.14, depth: 0.14 }, scene);
    bar.position.set(m.x, top - 0.2, m.z);
    bar.rotation.y = m.yaw;
    add(bar, P.graphite);
    const bar2 = bar.clone('mastBar2');
    bar2.position.y = top - 0.95;
    add(bar2, P.graphite);
    for (const row of [0, 1])
      for (const k of [-1, 0, 1]) {
        const y = top - 0.2 - row * 0.75 + 0.28;
        const side = k * 1.0;
        // Lateral offset along the bar (bar runs along the yaw's x axis).
        const ox = Math.cos(m.yaw) * side, oz = -Math.sin(m.yaw) * side;
        const hx = m.x + ox + fx * 0.22, hz = m.z + oz + fz * 0.22;
        const housing = MeshBuilder.CreateBox('mastLamp', { width: 0.62, height: 0.42, depth: 0.26 }, scene);
        housing.position.set(hx, y, hz);
        housing.rotation.set(0.55, m.yaw, 0);
        add(housing, P.graphite);
        const ln = MeshBuilder.CreatePlane('mastLens', { width: 0.54, height: 0.34 }, scene);
        // Lens on the housing's front face, tilted down with it.
        ln.position.set(hx + fx * 0.14 * Math.cos(0.55), y - 0.14 * Math.sin(0.55), hz + fz * 0.14 * Math.cos(0.55));
        ln.rotation.set(0.55, m.yaw + Math.PI, 0);
        add(ln, lens);
      }
    // Beam: a cone from the head down and out to where the light lands.
    const reach = m.h * 0.55;
    const lx = m.x + fx * reach, lz = m.z + fz * reach;
    const dx = lx - m.x, dy = -(top - 0.6), dz = lz - m.z;
    const len = Math.hypot(dx, dy, dz);
    if (beamMat) {
      const beam = MeshBuilder.CreateCylinder('mastBeam', { diameterTop: 2.6, diameterBottom: 12, height: len, tessellation: 24, cap: Mesh.NO_CAP }, scene);
      beam.position.set(m.x + dx / 2, top - 0.6 + dy / 2, m.z + dz / 2);
      // Cylinder axis is +y: point it from the landing spot up to the head.
      beam.rotation.set(Math.acos(-dy / len), Math.atan2(-dx, -dz), 0);
      beams.push(beam);
    }
    pools.push({ x: lx, z: lz, r: 8 });
  }
  // Overhead cables: each mast is strung to its nearest mast (within 30 m) or, failing that, to the nearest roof
  // edge of a tall solid, sagging under its own weight. Fills the empty band between the deck and the sky.
  const heads = masts.map((m) => ({ x: m.x, z: m.z, y: ground.height(m.x, m.z) + 0.5 + m.h - 1.4 }));
  const cables: Mesh[] = [];
  const sling = (a: Vector3, b: Vector3) => {
    const len = Vector3.Distance(a, b);
    const path: Vector3[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const p = Vector3.Lerp(a, b, t);
      p.y -= 4 * t * (1 - t) * len * 0.05;
      path.push(p);
    }
    for (const off of [0, 0.22]) cables.push(MeshBuilder.CreateTube('mastCable', { path: path.map((q) => q.add(new Vector3(0, -off, 0))), radius: 0.025, tessellation: 5 }, scene));
  };
  const strung = new Set<string>();
  heads.forEach((h, i) => {
    let best = -1, bd = 30;
    heads.forEach((o, j) => {
      const d = Math.hypot(o.x - h.x, o.z - h.z);
      if (j !== i && d < bd) { bd = d; best = j; }
    });
    if (best >= 0) {
      const key = `${Math.min(i, best)}:${Math.max(i, best)}`;
      if (!strung.has(key)) sling(new Vector3(h.x, h.y, h.z), new Vector3(heads[best].x, heads[best].y, heads[best].z));
      strung.add(key);
      return;
    }
    let roof: Vector3 | null = null, rd = 26;
    for (const b of boxes) {
      if (b.max[1] < 4 || b.min[1] > 0.2) continue;
      const cx = Math.max(b.min[0], Math.min(h.x, b.max[0])), cz = Math.max(b.min[2], Math.min(h.z, b.max[2]));
      const d = Math.hypot(cx - h.x, cz - h.z);
      if (d > 4 && d < rd) { rd = d; roof = new Vector3(cx, b.max[1] - 0.3, cz); }
    }
    if (roof) sling(new Vector3(h.x, h.y, h.z), roof);
  });
  if (cables.length) add(Mesh.MergeMeshes(cables, true, true)!, P.graphite);
  for (const [mat, list] of parts) {
    const mesh = Mesh.MergeMeshes(list, true, true);
    if (!mesh) continue;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
  }
  if (beamMat && beams.length) {
    const beam = Mesh.MergeMeshes(beams, true, true);
    if (beam) {
      beam.material = beamMat;
      beam.isPickable = false;
      beam.applyFog = false;
      beam.freezeWorldMatrix();
    }
  }
  const flare = flareSprite(scene);
  groundSheets(scene, 'mastPools', pools, 0.02, ground, unlit(scene, 'mastPool', LAMP[biome].pool, { tex: flare, opacity: flare, additive: true, zOffset: -2 }));
}
