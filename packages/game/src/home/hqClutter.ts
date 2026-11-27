import { HQ_PORTALS, HQ_ROOMS, type Room } from '@riftwarden/rules/home/layout';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { PROP_SPECIES, type PropPlacement, type PropSpecies } from '@riftwarden/rules/world/propCatalog';

/**
 * Scanned kit for the core HQ rooms (CC0, `visuals/propLibrary.ts`): maintained workshop gear, not the arena's
 * yard junk, so the clean interior keeps its look. Pure candidate generation: each room walks its walls in a
 * seeded order and offers small clusters at the wall foot, clear of portals and station consoles. HomeBase keeps
 * the first `perRoom` clusters whose footprint is free of existing geometry (downward ray picks against the built
 * room, `clutterFits`), so racks, shelves and scrap that the room style already placed are never overlapped.
 * Visual only (no collider, never pickable), like the station props.
 */
type Recipe = PropSpecies[];

/** Per room: the clusters that belong there (first species stands on the floor, the rest beside or on it). */
const RECIPES: Record<string, Recipe[]> = {
  works: [['tool-chest', 'toolbox'], ['shelves'], ['welding-cart', 'propane-tank'], ['cardboard-box', 'cardboard-box', 'crate-plastic'], ['extinguisher']],
  config: [['tool-chest', 'toolbox'], ['shelves'], ['crate-plastic', 'crate-plastic'], ['extinguisher']],
  market: [['cardboard-box', 'cardboard-box', 'cardboard-box'], ['shelves'], ['crate-plastic', 'crate-plastic'], ['extinguisher']],
  reclaim: [['barrel-steel', 'barrel-steel', 'oil-tin'], ['welding-cart'], ['generator'], ['shelves'], ['extinguisher']],
  deploy: [['crate-military', 'crate-plastic'], ['generator', 'jerrycan'], ['crate-military'], ['extinguisher']],
};
/** Items that stack on the previous item instead of standing beside it. */
const STACKS = new Set<PropSpecies>(['toolbox', 'oil-tin']);

export interface ClutterCluster {
  room: string;
  items: PropPlacement[];
  /** Footprint of the whole cluster (centre + half extents along x / z), for the occupancy test. */
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** Height of the tallest stack in the cluster: the occupancy test only cares about what is below it. */
  top: number;
}

const near = (a: readonly [number, number], x: number, z: number, d: number) => Math.hypot(a[0] - x, a[1] - z) < d;

/** Candidate clusters for one room, in preference order (seeded, so the HQ looks the same every visit). */
function roomCandidates(room: Room, stations: readonly (readonly [number, number])[], seed: number): ClutterCluster[] {
  const recipes = RECIPES[room.id];
  if (!recipes) return [];
  const rand = mulberry32(seed);
  const out: ClutterCluster[] = [];
  const [x0, z0] = room.min;
  const [x1, z1] = room.max;
  // Wall runs: [axis the wall runs along, fixed coordinate, inward sign, start, end].
  const walls: ['x' | 'z', number, number, number, number][] = [
    ['x', z0, 1, x0, x1], ['x', z1, -1, x0, x1], ['z', x0, 1, z0, z1], ['z', x1, -1, z0, z1],
  ];
  const slots: [number, number][] = [];
  for (let w = 0; w < walls.length; w++) for (let t = walls[w][3] + 0.9; t <= walls[w][4] - 0.9; t += 0.8) slots.push([w, t]);
  // Shuffle the slots so clusters spread around the room instead of filling the first wall.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  for (const [w, t] of slots) {
    const [axis, c, s] = walls[w];
    const recipe = recipes[out.length % recipes.length];
    const items: PropPlacement[] = [];
    let along = t;
    let prev: PropPlacement | null = null;
    let prevHalf = 0;
    let depthMax = 0;
    for (const species of recipe) {
      const [width, , depth] = PROP_SPECIES[species].size;
      const yaw = (axis === 'x' ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.3;
      if (prev && STACKS.has(species)) {
        items.push({ species, x: prev.x, y: prev.y + PROP_SPECIES[prev.species].size[1], z: prev.z, yaw, scale: 1 });
        continue;
      }
      if (prev) along += prevHalf + width / 2 + 0.06;
      // The wall cladding has a 0.3 m plinth and a rail at about 0.8 m: low kit stands in front of the plinth,
      // anything taller clears the rail.
      const off = (PROP_SPECIES[species].size[1] > 0.75 ? 0.5 : 0.36) + depth / 2;
      const x = axis === 'x' ? along : c + s * off;
      const z = axis === 'x' ? c + s * off : along;
      prev = { species, x, y: 0, z, yaw, scale: 1 };
      items.push(prev);
      prevHalf = width / 2;
      depthMax = Math.max(depthMax, depth);
    }
    const first = items[0];
    const last = items.filter((p) => p.y === 0).at(-1)!;
    const midAlong = ((axis === 'x' ? first.x : first.z) + (axis === 'x' ? last.x : last.z)) / 2;
    const halfAlong = Math.abs((axis === 'x' ? last.x : last.z) - (axis === 'x' ? first.x : first.z)) / 2 + PROP_SPECIES[first.species].size[0] / 2;
    const wallOff = items.some((p) => PROP_SPECIES[p.species].size[1] > 0.75) ? 0.5 : 0.36;
    const cx = axis === 'x' ? midAlong : c + s * (wallOff + depthMax / 2);
    const cz = axis === 'x' ? c + s * (wallOff + depthMax / 2) : midAlong;
    const hx = axis === 'x' ? halfAlong : depthMax / 2;
    const hz = axis === 'x' ? depthMax / 2 : halfAlong;
    // Inside the room, off the portals (doorways and their approach) and the station consoles.
    if (cx - hx < x0 + 0.05 || cx + hx > x1 - 0.05 || cz - hz < z0 + 0.05 || cz + hz > z1 - 0.05) continue;
    if (HQ_PORTALS.some((p) => (p.axis === 'x' ? Math.abs(cx - p.c) < 2.4 && cz + hz > p.a - 1.2 && cz - hz < p.b + 1.2 : Math.abs(cz - p.c) < 2.4 && cx + hx > p.a - 1.2 && cx - hx < p.b + 1.2))) continue;
    if (stations.some((st) => near(st, cx, cz, 2.4 + Math.max(hx, hz)))) continue;
    const top = Math.max(...items.map((p) => p.y + PROP_SPECIES[p.species].size[1])) + 0.15;
    out.push({ room: room.id, items, x: cx, z: cz, hx, hz, top });
  }
  return out;
}

/** All candidate clusters, grouped per room in preference order. */
export function clutterCandidates(stations: readonly (readonly [number, number])[], seed = 0xc1a7): Map<string, ClutterCluster[]> {
  const out = new Map<string, ClutterCluster[]>();
  HQ_ROOMS.forEach((room, i) => out.set(room.id, roomCandidates(room, stations, (seed + i * 0x9e37) >>> 0)));
  return out;
}

/**
 * Pick up to `perRoom` clusters per room that `fits` accepts and that do not overlap each other. `fits` is the
 * scene's occupancy test (HomeBase: downward ray picks); keeping it injected keeps this module engine-free.
 */
export function pickClutter(candidates: Map<string, ClutterCluster[]>, fits: (c: ClutterCluster) => boolean, perRoom = 5): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const list of candidates.values()) {
    const kept: ClutterCluster[] = [];
    for (const c of list) {
      if (kept.length >= perRoom) break;
      if (kept.some((k) => Math.abs(k.x - c.x) < k.hx + c.hx + 0.8 && Math.abs(k.z - c.z) < k.hz + c.hz + 0.8)) continue;
      if (!fits(c)) continue;
      kept.push(c);
      out.push(...c.items);
    }
  }
  return out;
}
