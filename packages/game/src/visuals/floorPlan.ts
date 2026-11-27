import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { distToBoxXZ } from '@riftwarden/rules/world/geometry';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { planPads } from '@riftwarden/rules/world/rubblePlan';
import { SLAB } from './groundRelief';

/**
 * Floor detail plan for the arena yard (pure, no Babylon): what turns one tiled scan into a worked yard. Saw-cut
 * joints on the settled-slab grid, cracks, replaced slabs and trench reinstatements (asphalt in the outpost, tread
 * plate in the foundry, fresh powder in cryo), standing water / ice in the relief's dips, oil spots and worn
 * walkway paint. Presentation only: nothing here is pickable or collides, and it keeps off solids, the reactor
 * plaza, tower pads, hazards, vents, rifts and the wall gutters, where other floor dressing already sits.
 */
export interface FloorSeg { x0: number; z0: number; x1: number; z1: number }
export interface FloorRect { x: number; z: number; w: number; d: number; yaw: number }
export interface FloorSpot { x: number; z: number; r: number; rot: number }
/** Standing water: a flat disc at `level`; the sculpted ground above that level hides its edge (natural shore). */
export interface FloorPool { x: number; z: number; r: number; level: number }
export interface FloorPlan {
  joints: FloorSeg[];
  cracks: FloorSpot[];
  patches: FloorRect[];
  pools: FloorPool[];
  spots: FloorSpot[];
  paint: FloorSeg[];
}

/** Distance from the perimeter wall face that the gutters and wall-foot dressing occupy. */
const WALL_BAND = 1.2;
const STEP = 0.5;
const SEED = 0x5f1a7;

/** Free-floor test shared by every layer: true where floor detail may go (`pad` = extra clearance in m). */
export function floorFree(L: ArenaLayout): (x: number, z: number, pad?: number) => boolean {
  const H = L.half;
  const solids = [...L.boxes.filter((b) => b.min[1] < 0.2), L.southDoor, ...L.barriers];
  const discs = [
    { x: L.reactor.x, z: L.reactor.z, r: 11.6 },
    ...(L.hazards ?? []).map((p) => ({ x: p.x, z: p.z, r: p.r + 0.6 })),
    ...L.vents.map((v) => ({ x: v.x, z: v.z, r: v.r + 0.6 })),
    ...(L.rifts ?? []).map((r) => ({ x: r.x, z: r.z, r: 3.5 })),
    ...planPads(L).map((p) => ({ x: p.x, z: p.z, r: p.half * 1.5 })),
  ];
  return (x, z, pad = 0) => {
    if (Math.max(Math.abs(x), Math.abs(z)) > H - WALL_BAND - pad) return false;
    for (const b of solids) if (distToBoxXZ(x, z, b) < 0.12 + pad) return false;
    for (const d of discs) if (Math.hypot(x - d.x, z - d.z) < d.r + pad) return false;
    for (const r of L.ramps) if (x > r.x0 - 0.3 - pad && x < r.x1 + 0.3 + pad && z > r.z0 - 0.3 - pad && z < r.z1 + 0.3 + pad) return false;
    return true;
  };
}

/** Split a straight line into the runs where `ok` holds, sampled every STEP metres. */
function runs(x0: number, z0: number, x1: number, z1: number, ok: (x: number, z: number) => boolean, out: FloorSeg[]): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / STEP));
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const good = ok(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    if (good && start < 0) start = i;
    if ((!good || i === n) && start >= 0) {
      const end = good ? i : i - 1;
      if (end - start >= 2) {
        const a = start / n, b = end / n;
        out.push({ x0: x0 + (x1 - x0) * a, z0: z0 + (z1 - z0) * a, x1: x0 + (x1 - x0) * b, z1: z0 + (z1 - z0) * b });
      }
      start = -1;
    }
  }
}

/**
 * Plan the floor detail for a layout. `height` is the sculpted ground (GroundRelief.height) so pools sit in real
 * dips; deterministic per seed through its own stream.
 */
export function planFloor(L: ArenaLayout, height: (x: number, z: number) => number): FloorPlan {
  const rnd = mulberry32(((L.seed ?? 1) ^ SEED) >>> 0);
  const free = floorFree(L);
  const biome = L.biome ?? 'outpost';
  const H = L.half - WALL_BAND;
  const plan: FloorPlan = { joints: [], cracks: [], patches: [], pools: [], spots: [], paint: [] };
  const lim = Math.floor(H / SLAB) * SLAB;

  // Saw-cut joints on the slab grid (under cryo snow they do not show).
  if (biome !== 'cryo') for (let k = -lim; k <= lim; k += SLAB) {
    runs(k, -H, k, H, free, plan.joints);
    runs(-H, k, H, k, free, plan.joints);
  }

  // Slab-level features: replaced slabs, trench strips, cracks, oil spots.
  for (let i = -lim; i < lim; i += SLAB)
    for (let j = -lim; j < lim; j += SLAB) {
      const cx = i + SLAB / 2, cz = j + SLAB / 2;
      const r = rnd();
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]].every(([a, b]) => free(i + a * SLAB, j + b * SLAB, 0.2));
      if (corners && r < 0.11) {
        // A whole slab replaced (inset so its own saw cut shows beside the joint).
        plan.patches.push({ x: cx, z: cz, w: SLAB - 0.16, d: SLAB - 0.16, yaw: 0 });
      } else if (corners && r < 0.2) {
        // Trench reinstatement: a narrow strip across the slab, along one axis.
        const along = rnd() < 0.5;
        const off = (rnd() - 0.5) * (SLAB - 2);
        const w = 0.7 + rnd() * 0.6;
        const strip = along ? { x: cx + off, z: cz, w, d: SLAB - 0.16, yaw: 0 } : { x: cx, z: cz + off, w: SLAB - 0.16, d: w, yaw: 0 };
        if (free(strip.x, strip.z, 0.2)) plan.patches.push(strip);
      } else if (biome !== 'cryo' && free(cx, cz, 1.6) && r < 0.6) {
        plan.cracks.push({ x: cx + (rnd() - 0.5) * 2, z: cz + (rnd() - 0.5) * 2, r: 1.4 + rnd() * 1.6, rot: rnd() * Math.PI * 2 });
      }
      const sx = cx + (rnd() - 0.5) * 4, sz = cz + (rnd() - 0.5) * 4;
      if (rnd() < 0.28 && free(sx, sz, 0.8)) plan.spots.push({ x: sx, z: sz, r: 0.5 + rnd() * 0.9, rot: rnd() * Math.PI * 2 });
    }

  // Standing water / ice: local minima of the relief that hold water inside a closed rim.
  const taken: FloorPool[] = [];
  for (let x = -H + 2; x < H - 2; x += 2.5)
    for (let z = -H + 2; z < H - 2; z += 2.5) {
      let bx = x, bz = z, bh = height(x, z);
      if (bh > -0.035) continue;
      // Walk downhill to the dip's bottom.
      for (let it = 0; it < 12; it++) {
        let moved = false;
        for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
          const h = height(bx + dx, bz + dz);
          if (h < bh - 1e-4) { bh = h; bx += dx; bz += dz; moved = true; }
        }
        if (!moved) break;
      }
      if (taken.some((p) => Math.hypot(p.x - bx, p.z - bz) < p.r + 2)) continue;
      const level = bh + 0.012 + rnd() * 0.018;
      // Smallest disc whose rim is everywhere above the water (so the disc edge itself is hidden by ground).
      let radius = 0;
      for (let rr = 0.8; rr <= 4.5 && !radius; rr += 0.35) {
        let dry = true;
        for (let a = 0; a < 20 && dry; a++) {
          const px = bx + Math.cos((a / 20) * Math.PI * 2) * rr, pz = bz + Math.sin((a / 20) * Math.PI * 2) * rr;
          if (height(px, pz) <= level + 0.003 || !free(px, pz)) dry = false;
        }
        if (dry) radius = rr;
      }
      if (!radius || !free(bx, bz, 0.4)) continue;
      const pool = { x: bx, z: bz, r: radius, level };
      taken.push(pool);
      plan.pools.push(pool);
    }

  // Worn walkway lines parallel to each perimeter wall, broken wherever something stands on them.
  if (biome !== 'cryo') {
    const d = L.half - 3.6;
    for (const s of [-1, 1]) {
      runs(-d, s * d, d, s * d, free, plan.paint);
      runs(s * d, -d, s * d, d, free, plan.paint);
    }
  }
  return plan;
}
