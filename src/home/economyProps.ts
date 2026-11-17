import { type AbstractMesh, MeshBuilder, type PBRMaterial, type Scene, type TransformNode } from '@babylonjs/core';
import type { MarketEntry } from '../economy/market';
import { rarity } from '../loot/rarity';
import type { Category } from '../loot/types';
import type { Shape } from '../visuals/kit';
import { unlit } from '../visuals/materials';
import { flareSprite } from '../visuals/textures';
import type { Station } from './layout';
import { consoleDesk, planeBuilder, type PropCtx, type ScreenTex } from './props';

/**
 * M4 station rigs: equipment exchange, module broker, reclamation press and the
 * fabricator. Built from the same instanced kit as the rest of the HQ. Displays that
 * mirror live data (merchant stock, exchange stock, material reserves) expose an
 * `update` that rebuilds only their few instances when the save changes; `pulse(id)`
 * (0..1, decaying) drives short transaction feedback animations.
 */
export interface EconCtx extends PropCtx {
  pulse: (station: string) => number;
}

const rarityCache = new WeakMap<Scene, Map<string, PBRMaterial>>();
/** HDR glow material per rarity (shared per scene). */
export function rarityMat(scene: Scene, id: string): PBRMaterial {
  let m = rarityCache.get(scene);
  if (!m) rarityCache.set(scene, (m = new Map()));
  let mat = m.get(id);
  if (!mat) {
    const g = rarity(id).glow;
    m.set(id, (mat = unlit(scene, `rarity_${id}`, [g[0] * 0.55, g[1] * 0.55, g[2] * 0.55])));
  }
  return mat;
}

const GLYPH: Record<Category, { shape: Shape; scale: [number, number, number]; rot?: [number, number, number] }> = {
  weapon: { shape: 'box', scale: [0.62, 0.12, 0.16] },
  armor: { shape: 'cyl6', scale: [0.36, 0.1, 0.36], rot: [Math.PI / 2, 0, 0] },
  shield: { shape: 'torusThin', scale: [0.42, 0.42, 0.42], rot: [Math.PI / 2, 0, 0] },
  reactor: { shape: 'cyl', scale: [0.18, 0.42, 0.18] },
  processor: { shape: 'box', scale: [0.3, 0.3, 0.06] },
  accessory: { shape: 'ico', scale: [0.26, 0.34, 0.26] },
  module: { shape: 'box', scale: [0.22, 0.22, 0.22], rot: [0.6, 0.6, 0] },
};

/** Equipment exchange: console + a lit wall of display bays mirroring the real stock. */
export function equipmentExchange(ctx: EconCtx, st: Station, screen: ScreenTex): { update(entries: readonly MarketEntry[]): void } {
  const { kit, M, scene } = ctx;
  consoleDesk(ctx, st, screen, 1.8);
  const wallZ = 7.62;
  const root = kit.node('exchangeWall', null, [st.pos[0], 0, wallZ]);
  // Back board, trims and header strip
  kit.part('box', M.graphite, root, { pos: [0, 2.6, 0.2], scale: [8.6, 3.6, 0.3] });
  kit.part('box', M.white, root, { pos: [0, 4.5, 0.12], scale: [8.9, 0.22, 0.5] });
  kit.part('box', M.white, root, { pos: [0, 0.72, 0.12], scale: [8.9, 0.14, 0.5] });
  kit.part('box', M.cyan, root, { pos: [0, 4.36, -0.13], scale: [8.6, 0.03, 0.02] });
  ctx.collider(st.pos[0] - 4.5, 0, wallZ - 0.2, st.pos[0] + 4.5, 4.7, 8);
  const bays: { node: TransformNode; glyph: TransformNode; parts: AbstractMesh[]; x: number; y: number }[] = [];
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 4; col++) {
      const x = (col - 1.5) * 2.0;
      const y = row === 0 ? 3.35 : 1.85;
      const bay = kit.node('bay', root, [x, y, 0]);
      kit.part('box', M.screenFrame, bay, { pos: [0, 0, 0.02], scale: [1.7, 1.2, 0.08] });
      for (const s of [-1, 1]) kit.part('box', M.white, bay, { pos: [s * 0.88, 0, -0.08], scale: [0.06, 1.28, 0.26] });
      kit.part('box', M.white, bay, { pos: [0, -0.62, -0.1], scale: [1.82, 0.06, 0.32] });
      const glyph = kit.node('bayGlyph', bay, [0, 0.05, -0.22]);
      bays.push({ node: bay, glyph, parts: [], x, y });
    }
  // Side racks (visual): uprights with mounted rifle silhouettes.
  for (const s of [-1, 1]) {
    const rack = kit.node('sideRack', null, [st.pos[0] + s * 5.6, 0, 7.3]);
    kit.part('box', M.graphite, rack, { pos: [0, 1.7, 0.2], scale: [1.4, 3.4, 0.4] });
    for (let i = 0; i < 4; i++) {
      kit.part('box', M.white, rack, { pos: [0, 0.8 + i * 0.75, -0.05], scale: [1.1, 0.1, 0.1] });
      kit.part('box', M.metal, rack, { pos: [0.05, 0.95 + i * 0.75, -0.06], scale: [0.9, 0.12, 0.08] });
    }
    kit.part('box', M.cyanDim, rack, { pos: [0, 3.45, -0.02], scale: [1.3, 0.03, 0.02] });
    ctx.collider(st.pos[0] + s * 5.6 - 0.75, 0, 6.9, st.pos[0] + s * 5.6 + 0.75, 3.5, 8);
  }
  // Floor glow under the wall
  const glowTex = flareSprite(scene);
  const glowMat = unlit(scene, 'exchangeFloor', [0.06, 0.32, 0.4], { tex: glowTex, opacity: glowTex, additive: true, zOffset: -2 });
  const pool = MeshBuilder.CreateGround('exchangePool', { width: 9, height: 2.4 }, scene);
  pool.material = glowMat;
  pool.position.set(st.pos[0], 0.02, 7.0);
  pool.isPickable = false;
  ctx.animators.push((dt, t) => {
    const p = ctx.pulse('merchant');
    for (let i = 0; i < bays.length; i++) {
      const b = bays[i];
      b.glyph.rotation.y += dt * (0.6 + p * 4);
      b.glyph.position.y = 0.05 + Math.sin(t * 1.4 + i) * 0.04;
    }
    glowMat.emissiveColor.set(0.06 + p * 0.2, 0.32 + p * 0.5, 0.4 + p * 0.5);
  });
  return {
    update(entries) {
      bays.forEach((b, i) => {
        for (const m of b.parts) m.dispose();
        b.parts = [];
        const e = entries[i];
        if (!e) return;
        const mat = rarityMat(scene, e.item.rarity);
        // Rarity light strip (dim graphite when sold)
        b.parts.push(kit.part('box', e.sold ? M.graphite : mat, b.node, { pos: [0, -0.55, -0.27], scale: [1.4, 0.03, 0.02] }));
        if (e.sold) {
          b.parts.push(kit.part('box', M.amberDim, b.node, { pos: [0, 0.05, -0.12], scale: [0.6, 0.06, 0.02] }));
          return;
        }
        const g = GLYPH[e.item.category] ?? GLYPH.module;
        b.parts.push(kit.part(g.shape, mat, b.glyph, { rot: g.rot, scale: g.scale }));
        if (e.featured) b.parts.push(kit.part('torusThin', rarityMat(scene, e.item.rarity), b.glyph, { rot: [Math.PI / 2, 0, 0], scale: [0.9, 0.9, 0.9] }));
      });
    },
  };
}

/** Module broker: console, rotating module vault and the material exchange tanks. */
export function moduleBroker(ctx: EconCtx, st: Station, screen: ScreenTex): { update(entries: readonly MarketEntry[], exchange: { id: string; left: number }[]): void } {
  const { kit, M, scene } = ctx;
  consoleDesk(ctx, st, screen, 1.6);
  // Vault: glass column with module cores orbiting inside (live stock).
  const vx = st.pos[0] - 3.1;
  const vz = st.pos[1] - 0.3;
  const vault = kit.node('moduleVault', null, [vx, 0, vz]);
  kit.part('cyl8', M.graphite, vault, { pos: [0, 0.35, 0], scale: [1.5, 0.7, 1.5] });
  kit.part('cyl8', M.white, vault, { pos: [0, 0.74, 0], scale: [1.6, 0.08, 1.6] });
  kit.part('cyl8', M.white, vault, { pos: [0, 3.25, 0], scale: [1.6, 0.16, 1.6] });
  kit.part('cyl8', M.graphite, vault, { pos: [0, 3.5, 0], scale: [1.2, 0.36, 1.2] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    kit.part('box', M.metal, vault, { pos: [Math.cos(a) * 0.72, 2.0, Math.sin(a) * 0.72], scale: [0.06, 2.5, 0.06] });
  }
  kit.part('torusThin', M.cyan, vault, { pos: [0, 0.8, 0], scale: [1.45, 1, 1.45] });
  const glass = MeshBuilder.CreateCylinder('vaultGlass', { diameter: 1.4, height: 2.4, tessellation: 24, cap: 0 }, scene);
  glass.material = M.glass;
  glass.parent = vault;
  glass.position.y = 2.0;
  glass.isPickable = false;
  ctx.collider(vx - 0.8, 0, vz - 0.8, vx + 0.8, 3.7, vz + 0.8);
  const orbit = kit.node('vaultOrbit', vault, [0, 2.0, 0]);
  let cores: AbstractMesh[] = [];
  // Exchange tanks: salvage crates and component cells (count = packs left this rotation).
  const ex = kit.node('exchangeTanks', null, [st.pos[0] + 3.2, 0, st.pos[1] - 0.4]);
  kit.part('box', M.graphite, ex, { pos: [0, 0.2, 0], scale: [2.0, 0.4, 1.2] });
  kit.part('box', M.white, ex, { pos: [0, 0.42, 0], scale: [2.1, 0.06, 1.3] });
  for (const s of [-1, 1]) kit.part('box', M.white, ex, { pos: [s * 1.0, 1.6, -0.45], scale: [0.1, 2.4, 0.1] });
  kit.part('box', M.white, ex, { pos: [0, 2.8, -0.45], scale: [2.1, 0.1, 0.14] });
  kit.part('box', M.amber, ex, { pos: [-0.5, 2.72, -0.37], scale: [0.6, 0.03, 0.02] });
  kit.part('box', M.cyan, ex, { pos: [0.5, 2.72, -0.37], scale: [0.6, 0.03, 0.02] });
  ctx.collider(st.pos[0] + 2.1, 0, st.pos[1] - 1.1, st.pos[0] + 4.3, 2.9, st.pos[1] + 0.3);
  let exParts: AbstractMesh[] = [];
  // Precision gantry along the back wall (moving manipulator head).
  const gz = -7.75;
  const gantry = kit.node('brokerGantry', null, [st.pos[0], 0, gz]);
  kit.part('box', M.graphite, gantry, { pos: [0, 3.9, 0], scale: [9, 0.18, 0.3] });
  kit.part('box', M.cyanDim, gantry, { pos: [0, 3.8, 0.16], scale: [9, 0.02, 0.02] });
  const head = kit.node('gantryHead', gantry, [0, 3.7, 0.15]);
  kit.part('box', M.white, head, { pos: [0, 0, 0], scale: [0.4, 0.3, 0.3] });
  kit.part('cyl', M.metal, head, { pos: [0, -0.4, 0], scale: [0.06, 0.6, 0.06] });
  kit.part('sphere', M.cyan, head, { pos: [0, -0.72, 0], scale: [0.08, 0.08, 0.08] });
  ctx.animators.push((dt, t) => {
    const p = ctx.pulse('modules');
    orbit.rotation.y += dt * (0.5 + p * 3);
    for (let i = 0; i < cores.length; i++) cores[i].position.y = -0.8 + i * 0.32 + Math.sin(t * 1.2 + i) * 0.04;
    head.position.x = Math.sin(t * 0.35) * 3.8;
  });
  return {
    update(entries, exchange) {
      for (const m of cores) m.dispose();
      cores = [];
      entries.forEach((e, i) => {
        if (e.sold) return;
        const a = (i / Math.max(1, entries.length)) * Math.PI * 2;
        const m = kit.part('box', rarityMat(scene, e.item.rarity), orbit, { pos: [Math.cos(a) * 0.38, -0.8 + i * 0.32, Math.sin(a) * 0.38], rot: [0.6, a, 0.6], scale: [0.16, 0.16, 0.16] });
        cores.push(m);
      });
      for (const m of exParts) m.dispose();
      exParts = [];
      const crates = exchange.find((o) => o.id === 'salvage_crate')?.left ?? 0;
      const cells = exchange.find((o) => o.id === 'component_cell')?.left ?? 0;
      for (let i = 0; i < crates; i++) exParts.push(kit.part('box', i % 2 ? M.white : M.metal, ex, { pos: [-0.5, 0.65 + i * 0.42, 0], scale: [0.8, 0.36, 0.7] }));
      for (let i = 0; i < cells; i++) {
        exParts.push(kit.part('cyl', M.graphite, ex, { pos: [0.5, 0.75 + i * 0.6, 0], scale: [0.3, 0.5, 0.3] }));
        exParts.push(kit.part('cyl', M.cyan, ex, { pos: [0.5, 0.75 + i * 0.6, 0], scale: [0.2, 0.52, 0.2] }));
      }
    },
  };
}

/** Reclamation press: heavy hydraulic press, feed conveyor and live material bins. */
export function reclamation(ctx: EconCtx, st: Station, screen: ScreenTex): { update(salvage: number, components: number): void } {
  const { kit, M, scene } = ctx;
  consoleDesk(ctx, st, screen, 1.6);
  const px = -30.4;
  const press = kit.node('press', null, [px, 0, 0]);
  kit.part('box', M.graphite, press, { pos: [0, 0.3, 0], scale: [3.6, 0.6, 3.4] });
  kit.part('box', M.metal, press, { pos: [0, 0.68, 0], scale: [2.4, 0.16, 2.2] });
  for (const s of [-1, 1]) {
    kit.part('box', M.white, press, { pos: [0, 2.6, s * 1.45], scale: [2.6, 4.6, 0.42] });
    kit.part('box', M.graphite, press, { pos: [0.9, 2.6, s * 1.45], scale: [0.5, 4.2, 0.46] });
    for (let i = 0; i < 5; i++) kit.part('box', i % 2 ? M.graphite : M.amberDim, press, { pos: [1.31, 0.9 + i * 0.22, s * 1.45], scale: [0.02, 0.2, 0.42] });
  }
  kit.part('box', M.white, press, { pos: [0, 5.05, 0], scale: [2.8, 0.7, 3.4] });
  kit.part('box', M.amber, press, { pos: [1.42, 5.05, 0], scale: [0.02, 0.06, 2.4] });
  const ram = kit.node('pressRam', press, [0, 3.4, 0]);
  kit.part('cyl', M.metal, ram, { pos: [0, 0.9, 0], scale: [0.5, 1.8, 0.5] });
  kit.part('box', M.graphite, ram, { pos: [0, 0, 0], scale: [2.0, 0.5, 2.0] });
  kit.part('box', M.amber, ram, { pos: [0, -0.27, 0], scale: [1.8, 0.03, 1.8] });
  const hot = unlit(scene, 'pressHot', [0.5, 0.15, 0.02]);
  kit.part('box', hot, press, { pos: [0, 0.77, 0], scale: [1.8, 0.02, 1.6] });
  ctx.collider(px - 1.8, 0, -1.7, px + 1.8, 5.4, 1.7);
  // Feed conveyor from the north (moving slats).
  const conv = kit.node('conveyor', null, [px, 0, 4.0]);
  kit.part('box', M.graphite, conv, { pos: [0, 0.45, 0], scale: [1.4, 0.9, 4.2] });
  kit.part('box', M.metal, conv, { pos: [0, 0.92, 0], scale: [1.2, 0.04, 4.2] });
  const slats: TransformNode[] = [];
  for (let i = 0; i < 8; i++) {
    const n = kit.node('slat', conv, [0, 0.95, -2 + i * 0.5]);
    kit.part('box', M.graphite, n, { scale: [1.1, 0.03, 0.12] });
    slats.push(n);
  }
  ctx.collider(px - 0.7, 0, 1.8, px + 0.7, 1.0, 6.2);
  // Material bins along the south wall: salvage hopper (fill level) and a component locker (lit cells).
  const hop = kit.node('salvageHopper', null, [-29.6, 0, -5.9]);
  kit.part('box', M.graphite, hop, { pos: [0, 0.1, 0], scale: [2.4, 0.2, 1.6] });
  for (const s of [-1, 1]) {
    kit.part('box', M.white, hop, { pos: [s * 1.15, 0.85, 0], scale: [0.1, 1.5, 1.6] });
    kit.part('box', M.white, hop, { pos: [0, 0.85, s * 0.75], scale: [2.4, 1.5, 0.1] });
  }
  kit.part('box', M.amber, hop, { pos: [0, 1.62, 0.81], scale: [2.0, 0.03, 0.02] });
  const fill = kit.node('hopperFill', hop, [0, 0.2, 0]);
  kit.part('box', M.metal, fill, { pos: [0, 0.5, 0], scale: [2.1, 1, 1.3] });
  ctx.collider(-30.9, 0, -6.8, -28.3, 1.7, -5.0);
  const lock = kit.node('componentLocker', null, [-25.6, 0, -6.55]);
  kit.part('box', M.graphite, lock, { pos: [0, 1.4, 0], scale: [2.2, 2.8, 0.8] });
  kit.part('box', M.white, lock, { pos: [0, 2.86, 0], scale: [2.3, 0.1, 0.9] });
  kit.part('box', M.cyanDim, lock, { pos: [0, 2.76, 0.41], scale: [2.0, 0.03, 0.02] });
  ctx.collider(-26.8, 0, -7, -24.4, 2.9, -6.1);
  let cells: AbstractMesh[] = [];
  // Hazard floor markings around the press
  for (let i = 0; i < 6; i++) kit.part('box', i % 2 ? M.graphite : M.amberDim, press, { pos: [2.1, 0.012, -1.5 + i * 0.6], scale: [0.18, 0.01, 0.55] });
  // Sparks flash: a light card under the ram during a press stroke.
  const sparkTex = flareSprite(scene);
  const sparkMat = unlit(scene, 'pressSpark', [0, 0, 0], { tex: sparkTex, opacity: sparkTex, additive: true, twoSided: true });
  const spark = planeBuilder(scene, 'pressSparkCard', 3.2, 1.2);
  spark.material = sparkMat;
  spark.position.set(px + 0.6, 1.1, 0);
  spark.rotation.y = -Math.PI / 2;
  let fillTarget = 0.1;
  ctx.animators.push((dt, t) => {
    const p = ctx.pulse('salvage');
    // A transaction triggers a full stroke: down fast, back up slowly.
    const stroke = p > 0 ? Math.sin(Math.min(1, (1 - p) * 1.6) * Math.PI) : 0;
    ram.position.y = 3.4 - stroke * 2.25 + Math.sin(t * 0.8) * 0.03;
    const s = stroke > 0.85 ? (stroke - 0.85) / 0.15 : 0;
    sparkMat.emissiveColor.set(2.6 * s, 1.2 * s, 0.25 * s);
    hot.emissiveColor.set(0.5 + 2.5 * s, 0.15 + 0.8 * s, 0.02);
    for (let i = 0; i < slats.length; i++) slats[i].position.z = -2 + ((i * 0.5 + t * (0.25 + p * 1.5)) % 4);
    fill.scaling.y += (fillTarget - fill.scaling.y) * Math.min(1, dt * 2);
  });
  return {
    update(salvage, components) {
      // Log scale: 1 salvage barely registers, ~5000 fills the hopper.
      fillTarget = Math.max(0.05, Math.min(1.35, Math.log10(1 + salvage) / 2.8));
      for (const c of cells) c.dispose();
      cells = [];
      const n = Math.min(12, components);
      for (let i = 0; i < 12; i++) {
        const col = i % 6;
        const row = Math.floor(i / 6);
        cells.push(kit.part('box', i < n ? M.cyan : M.screenFrame, lock, { pos: [-0.8 + col * 0.32, 1.0 + row * 0.9, 0.41], scale: [0.22, 0.6, 0.02] }));
      }
    },
  };
}

/** Fabricator: manufacturing chamber with a gantry print head; glows while fabricating. */
export function fabricator(ctx: EconCtx, st: Station, screen: ScreenTex): void {
  const { kit, M, scene } = ctx;
  const fab = kit.node('fabricator', null, [st.pos[0], 0, st.pos[1]]);
  fab.rotation.y = st.yaw;
  kit.part('box', M.white, fab, { pos: [0, 1.45, -0.05], scale: [2.8, 2.9, 1.7] });
  kit.part('box', M.graphite, fab, { pos: [0, 0.15, 0.15], scale: [2.9, 0.3, 2.0] });
  // Chamber: dark interior box seen through a glass window
  kit.part('box', M.graphite, fab, { pos: [0, 1.3, 0.28], scale: [1.9, 1.5, 0.06] });
  for (const sx of [-1, 1]) kit.part('box', M.graphite, fab, { pos: [sx * 0.93, 1.3, 0.56], scale: [0.04, 1.5, 0.56] });
  const chamberGlow = unlit(scene, 'fabChamber', [0.4, 0.2, 0.05]);
  kit.part('box', chamberGlow, fab, { pos: [0, 0.6, 0.6], scale: [1.7, 0.03, 0.5] });
  kit.part('box', chamberGlow, fab, { pos: [0, 2.02, 0.6], scale: [1.7, 0.03, 0.5] });
  const bed = kit.node('fabBed', fab, [0, 0.72, 0.62]);
  kit.part('cyl8', M.metal, bed, { scale: [0.8, 0.06, 0.4] });
  const part = kit.node('fabPart', bed, [0, 0.25, 0]);
  kit.part('ico', unlit(scene, 'fabPartGlow', [1.6, 0.8, 0.15]), part, { scale: [0.36, 0.36, 0.36] });
  const headRail = kit.node('fabRail', fab, [0, 1.85, 0.62]);
  kit.part('box', M.metal, headRail, { scale: [1.7, 0.05, 0.05] });
  const head = kit.node('fabHead', headRail, [0, -0.12, 0]);
  kit.part('box', M.white, head, { scale: [0.2, 0.16, 0.2] });
  const beamMat = unlit(scene, 'fabBeam', [2.2, 1.0, 0.15], { additive: true });
  const beam = kit.node('fabBeamNode', head, [0, -0.45, 0]);
  kit.part('cyl', beamMat, beam, { scale: [0.02, 0.75, 0.02] });
  const glass = MeshBuilder.CreatePlane('fabGlass', { width: 1.9, height: 1.5 }, scene);
  glass.material = M.glass;
  glass.parent = fab;
  glass.position.set(0, 1.3, 0.86);
  glass.rotation.y = Math.PI;
  glass.isPickable = false;
  for (const s of [-1, 1]) kit.part('box', M.graphite, fab, { pos: [s * 1.02, 1.3, 0.85], scale: [0.12, 1.66, 0.08] });
  kit.part('box', M.graphite, fab, { pos: [0, 2.12, 0.85], scale: [2.16, 0.1, 0.08] });
  kit.part('box', M.graphite, fab, { pos: [0, 0.48, 0.85], scale: [2.16, 0.1, 0.08] });
  // Status screen above the chamber
  kit.part('box', M.screenFrame, fab, { pos: [0, 2.55, 0.8], rot: [-0.15, 0, 0], scale: [1.3, 0.62, 0.05] });
  const plane = planeBuilder(scene, 'screen_fabricate', 1.2, 0.54);
  plane.material = screen.mat;
  plane.parent = fab;
  plane.position.set(0, 2.55, 0.83);
  plane.rotation.x = -0.15;
  kit.part('box', M.amber, fab, { pos: [0, 2.94, 0.81], scale: [1.0, 0.03, 0.02] });
  // Footprint collider (rotated AABB)
  const along = Math.abs(Math.sin(st.yaw)) > 0.5;
  const hx = along ? 1.05 : 1.45;
  const hz = along ? 1.45 : 1.05;
  ctx.collider(st.pos[0] - hx, 0, st.pos[1] - hz, st.pos[0] + hx, 3.0, st.pos[1] + hz);
  ctx.animators.push((dt, t) => {
    const p = ctx.pulse('fabricate');
    head.position.x = Math.sin(t * (0.9 + p * 5)) * 0.7;
    bed.rotation.y += dt * (0.3 + p * 4);
    const k = 0.35 + 0.65 * p;
    part.scaling.setAll(p > 0 ? 0.4 + 0.6 * (1 - p) : 0.65 + Math.sin(t * 2) * 0.03);
    beam.setEnabled(p > 0.02 || Math.sin(t * 1.3) > 0.6);
    beamMat.emissiveColor.set(2.2 * k + 0.4, 1.0 * k + 0.2, 0.15);
    chamberGlow.emissiveColor.set(0.4 + 2.2 * p, 0.2 + 1.0 * p, 0.05 + 0.2 * p);
  });
}

/** Weapon calibration ring over the engineering bench (pulses on engineering actions). */
export function calibrationRing(ctx: EconCtx, at: [number, number, number]): void {
  const { kit, scene } = ctx;
  const ringMat = unlit(scene, 'calibRing', [0.25, 1.4, 1.7], { additive: true });
  const root = kit.node('calibration', null, at);
  const a = kit.node('calA', root);
  kit.part('torusThin', ringMat, a, { scale: [0.9, 0.9, 0.9] });
  const b = kit.node('calB', root);
  kit.part('torusThin', ringMat, b, { scale: [0.65, 0.65, 0.65] });
  ctx.animators.push((_dt, t) => {
    const p = ctx.pulse('workshop');
    a.rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.2, t * (0.6 + p * 4), 0);
    b.rotation.set(Math.PI / 2, -t * (0.9 + p * 5), Math.sin(t) * 0.3);
    ringMat.emissiveColor.set(0.25 + p * 2, 1.4 + p * 1.2, 1.7 + p);
  });
}
