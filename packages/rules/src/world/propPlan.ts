import { mulberry32 } from '../combat/damage';
import { distToBoxXZ } from './geometry';
import type { ArenaLayout, Box } from './layout';
import { PROP_SPECIES, type PropPlacement, propRadius, type PropSpecies } from './propCatalog';
import { type RubbleSpot, spotBlocked } from './rubblePlan';
import { placeVignette, VIGNETTES, vignetteExtent } from './propVignettes';

/** Vignettes per biome (wall-foot story clusters). */
const BIOME_VIGNETTES: Record<NonNullable<ArenaLayout['biome']>, (keyof typeof VIGNETTES)[]> = {
  outpost: ['drumHuddle', 'palletStack', 'tyrePile', 'generatorBay', 'dumpster', 'parkedCar', 'barrierRun', 'pipeStore'],
  foundry: ['drumHuddle', 'gasBottles', 'fireCorner', 'generatorBay', 'pipeStore', 'dumpster', 'barrierRun'],
  cryo: ['palletStack', 'generatorBay', 'parkedCar', 'tyrePile', 'pipeStore', 'barrierRun', 'gasBottles'],
};

/** A dark ground stain under a vignette (oil, rust run-off, soot), for the arena to draw. */
export interface PropStain {
  x: number;
  z: number;
  r: number;
}

/**
 * Where the arena's scanned props go (pure). Same contract as the rubble plan: visual only, kept off every lane,
 * the reactor ring, the spawn, reserved machinery, vents, ramps, the inside of solids and the rubble already
 * planned. Four kinds of spot, dense enough that the yard reads as a working, lived-in facility:
 * - wall-foot clusters in most bays between the perimeter braces (drums, crates, dumpsters, parked cars...);
 * - wall-mounted lamps and floodlights high on the perimeter faces;
 * - deck clusters leaning on the long sides of blocks, machinery banks and container stacks;
 * - rooftop plant (air-con, ducts, cabinets, searchlights) on container stacks.
 * Each biome has its own recipes, so the dressing carries the biome identity together with its surfaces.
 * Own seed stream (`seed ^ 0xa55e7`), so adding props never shifts rubble, decals or any gameplay roll.
 */
export const PROP_SEED = 0xa55e7;
/** Upper bound on placed props per arena (instances; one draw call per part and species). */
export const MAX_ARENA_PROPS = 160;

type Biome = NonNullable<ArenaLayout['biome']>;

interface BiomeRecipes {
  /** Wall-foot clusters: the first species anchors, the rest line up beside it. */
  wall: PropSpecies[][];
  /** Deck clusters against solids. */
  deck: PropSpecies[][];
  roof: PropSpecies[];
  /** Wall-mounted fixtures (alternating along a face). */
  mount: PropSpecies[];
}

const RECIPES: Record<Biome, BiomeRecipes> = {
  outpost: {
    wall: [
      ['barrel-red', 'barrel-red', 'jerrycan'],
      ['crate-military', 'crate-plastic', 'jerrycan'],
      ['trash-can', 'barrel-steel'],
      ['covered-car'],
      ['pipes', 'utility-box-tall', 'extinguisher'],
      ['barrel-steel', 'tyre', 'propane-tank', 'wheel-rim'],
      ['generator', 'jerrycan', 'crate-plastic'],
      ['road-barrier', 'road-barrier'],
    ],
    deck: [['road-barrier', 'road-barrier', 'road-barrier'], ['covered-car'], ['trash-can', 'barrel-red'], ['crate-military', 'barrel-steel', 'tyre']],
    roof: ['aircon-unit', 'airduct', 'utility-box-tall', 'aircon-unit', 'generator'],
    mount: ['street-lamp', 'security-light'],
  },
  foundry: {
    wall: [
      ['barrel-red', 'barrel-steel', 'barrel-red'],
      ['fire-barrel', 'barrel-steel'],
      ['lpg-tank', 'propane-tank', 'lpg-tank'],
      ['pipes', 'pipes'],
      ['generator', 'barrel-steel', 'jerrycan'],
      ['utility-box-tall', 'extinguisher', 'lpg-tank'],
      ['trash-can', 'fire-barrel'],
    ],
    deck: [['fire-barrel', 'barrel-red', 'barrel-steel'], ['road-barrier', 'road-barrier'], ['trash-can', 'lpg-tank']],
    roof: ['airduct', 'aircon-unit', 'generator', 'airduct'],
    mount: ['security-light', 'street-lamp'],
  },
  cryo: {
    wall: [
      ['crate-military', 'crate-plastic', 'crate-plastic'],
      ['utility-box-tall', 'utility-box'],
      ['generator', 'propane-tank'],
      ['covered-car'],
      ['pipes', 'utility-box'],
      ['barrel-steel', 'crate-plastic', 'extinguisher'],
      ['road-barrier', 'road-barrier'],
    ],
    deck: [['covered-car'], ['road-barrier', 'road-barrier', 'road-barrier'], ['crate-military', 'crate-plastic', 'generator']],
    roof: ['aircon-unit', 'utility-box-tall', 'airduct', 'aircon-unit'],
    mount: ['security-light', 'street-lamp'],
  },
};

interface Taken {
  x: number;
  z: number;
  r: number;
}

/** The inner faces of the perimeter wall boxes: run axis, face coordinate, inward sign, usable span and top. */
function wallFaces(L: ArenaLayout): { alongX: boolean; face: number; s: number; a: number; e: number; top: number }[] {
  const H = L.half;
  return L.boxes.filter((b) => b.kind === 'wall').map((b) => {
    const [x0, , z0] = b.min;
    const [x1, y1, z1] = b.max;
    const alongX = x1 - x0 > z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const face = alongX ? (cz < 0 ? z1 : z0) : cx < 0 ? x1 : x0;
    const s = alongX ? (cz < 0 ? 1 : -1) : cx < 0 ? 1 : -1;
    return { alongX, face, s, a: Math.max(alongX ? x0 : z0, -H + 0.3), e: Math.min(alongX ? x1 : z1, H - 0.3), top: y1 };
  });
}

/** Footprint along / across a run for a species standing with its long side along the run. */
const along = (species: PropSpecies) => {
  const [w, , d] = PROP_SPECIES[species].size;
  return PROP_SPECIES[species].longZ ? [d, w] : [w, d];
};

export function planProps(L: ArenaLayout, rubble: readonly RubbleSpot[] = [], seed = (L.seed ?? 0) ^ PROP_SEED): PropPlacement[] {
  return planPropsDetailed(L, rubble, seed).props;
}

/** Props plus the ground stains under their vignettes. */
export function planPropsDetailed(L: ArenaLayout, rubble: readonly RubbleSpot[] = [], seed = (L.seed ?? 0) ^ PROP_SEED): { props: PropPlacement[]; stains: PropStain[] } {
  const rand = mulberry32(seed >>> 0);
  const out: PropPlacement[] = [];
  const taken: Taken[] = rubble.map((s) => ({ x: s.x, z: s.z, r: s.r * 0.8 }));
  // `from`: cluster members placed from this index on may touch each other (a cluster is one group of clutter).
  const free = (x: number, z: number, r: number, from = taken.length) =>
    !spotBlocked(L, x, z, Math.max(0.6, r)) && taken.every((t, i) => i >= from || Math.hypot(t.x - x, t.z - z) > t.r + r);
  const stains: PropStain[] = [];
  const put = (species: PropSpecies, x: number, y: number, z: number, yaw: number, scale = 1, tilt?: number) => {
    out.push(tilt ? { species, x, y, z, yaw, scale, tilt } : { species, x, y, z, yaw, scale });
    taken.push({ x, z, r: propRadius(species, scale) });
  };
  const R = RECIPES[L.biome ?? 'outpost'];
  const full = () => out.length >= MAX_ARENA_PROPS;

  /**
   * A row of props along a run (axis x or z) starting near `start`, backs against the line `face` (inward sign s).
   * Stops at the first blocked member or once it leaves [lo, hi].
   */
  const row = (recipe: PropSpecies[], alongX: boolean, face: number, s: number, start: number, lo: number, hi: number, y = 0) => {
    const cluster = taken.length;
    const dir = rand() < 0.5 ? -1 : 1;
    let t = start;
    let prevHalf = 0;
    const base = alongX ? 0 : Math.PI / 2;
    for (const species of recipe) {
      if (full()) return;
      const [len, depth] = along(species);
      if (prevHalf) t += dir * (prevHalf + len / 2 + 0.08 + rand() * 0.3);
      if (t - len / 2 < lo || t + len / 2 > hi) return;
      const off = 0.14 + depth / 2 + rand() * 0.1;
      const x = alongX ? t : face + s * off;
      const z = alongX ? face + s * off : t;
      if (y === 0 && !free(x, z, propRadius(species), cluster)) return;
      const yaw = base + (PROP_SPECIES[species].longZ ? Math.PI / 2 : 0) + (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.3;
      put(species, x, y, z, yaw);
      prevHalf = len / 2;
    }
  };

  // Wall-foot vignettes: story clusters, densest at the inside corners of each face and then at irregular gaps,
  // each group rotated a little off the wall line. Mounted lamps above every other brace bay.
  const names = BIOME_VIGNETTES[L.biome ?? 'outpost'];
  for (const w of wallFaces(L)) {
    const along: [number, number] = w.alongX ? [1, 0] : [0, 1];
    const outward: [number, number] = w.alongX ? [0, w.s] : [w.s, 0];
    const wallYaw = (w.alongX ? 0 : Math.PI / 2) + (w.s > 0 ? 0 : Math.PI);
    const tryAt = (t: number) => {
      if (full()) return;
      const v = VIGNETTES[names[Math.floor(rand() * names.length)]];
      const ext = vignetteExtent(v);
      // Mirror the group at random so leaning and stacked pieces are not always on the same side.
      const flip = rand() < 0.5 ? -1 : 1;
      const dir: [number, number] = [along[0] * flip, along[1] * flip];
      const lo = flip > 0 ? t + ext.u0 : t - ext.u1;
      const hi = flip > 0 ? t + ext.u1 : t - ext.u0;
      if (lo < w.a + 0.4 || hi > w.e - 0.4) return;
      const ax = w.alongX ? t : w.face;
      const az = w.alongX ? w.face : t;
      const items = placeVignette(v, ax, az, dir, outward, flip > 0 ? wallYaw : wallYaw + Math.PI, (rand() - 0.5) * 0.22);
      const cluster = taken.length;
      const midU = (lo + hi) / 2;
      const cx = w.alongX ? midU : w.face + w.s * ext.depth * 0.5;
      const cz = w.alongX ? w.face + w.s * ext.depth * 0.5 : midU;
      const r = Math.max((hi - lo) / 2, ext.depth / 2);
      if (!free(cx, cz, r * 0.8, cluster)) return;
      for (const p of items) put(p.species, p.x, p.y, p.z, p.yaw, p.scale, p.tilt);
      stains.push({ x: cx, z: cz, r: r * 1.15 });
    };
    // Inside corners first (both ends of the face), then irregular gaps along the run.
    tryAt(w.a + 1.6);
    tryAt(w.e - 1.6);
    for (let t = w.a + 6 + rand() * 4; t < w.e - 6; t += 6 + rand() * 9) if (rand() < 0.6) tryAt(t);
    let bay = 0;
    for (let p = w.a + 0.9; p < w.e - 2; p += 7.4, bay++) {
      const mid = p + 3.7;
      if (mid + 2.65 > w.e) continue;
      if (bay % 2 === 0 && !full()) {
        const species = R.mount[(bay / 2) % R.mount.length];
        const [, , depth] = PROP_SPECIES[species].size;
        const x = w.alongX ? mid : w.face + w.s * (0.1 + depth / 2);
        const z = w.alongX ? w.face + w.s * (0.1 + depth / 2) : mid;
        // The fixture's arm points out of the wall (+z of the model faces the arena).
        const yaw = w.alongX ? (w.s > 0 ? 0 : Math.PI) : w.s > 0 ? Math.PI / 2 : -Math.PI / 2;
        out.push({ species, x, y: Math.min(w.top - 2.4, 5.2), z, yaw, scale: species === 'security-light' ? 1.6 : 1.4 });
      }
    }
  }

  // Deck clusters along the long sides of blocks, machinery banks and container stacks.
  for (const b of L.boxes) {
    if ((b.kind !== 'block' && b.kind !== 'machine' && b.kind !== 'container') || full()) continue;
    const wide = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
    const run = wide ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
    if (run < 3.5) continue;
    for (const side of [-1, 1]) {
      if (rand() > 0.6) continue;
      const face = wide ? (side < 0 ? b.min[2] : b.max[2]) : side < 0 ? b.min[0] : b.max[0];
      const lo = wide ? b.min[0] : b.min[2];
      const hi = wide ? b.max[0] : b.max[2];
      row(R.deck[Math.floor(rand() * R.deck.length)], wide, face, side, lo + run * (0.25 + rand() * 0.5), lo + 0.3, hi - 0.3);
    }
  }

  // Loading-dock shutters flush on the long faces of elevated decks (platform solids are solid plinths).
  for (const b of L.boxes) {
    if (b.kind !== 'platform' || b.min[1] > 0.1 || b.max[1] < 3 || full()) continue;
    const wide = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
    const run = wide ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
    const doors = run > 9 ? 2 : run > 4.5 ? 1 : 0;
    for (const side of [-1, 1]) {
      if (rand() > 0.75) continue;
      const face = wide ? (side < 0 ? b.min[2] : b.max[2]) : side < 0 ? b.min[0] : b.max[0];
      const lo = wide ? b.min[0] : b.min[2];
      for (let k = 0; k < doors; k++) {
        const t = lo + (run * (k + 0.5)) / doors + (rand() - 0.5) * 0.6;
        const off = 0.17;
        const x = wide ? t : face + side * off;
        const z = wide ? face + side * off : t;
        // A ramp landing on this face would run through the door.
        if (L.ramps.some((r) => x > r.x0 - 1.8 && x < r.x1 + 1.8 && z > r.z0 - 1.8 && z < r.z1 + 1.8)) continue;
        out.push({ species: 'roller-shutter', x, y: 0, z, yaw: wide ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2, scale: 1 });
      }
    }
  }

  // Rooftop plant on blocks and container stacks with a usable top.
  // Containers only: blocks are dressed as open transformer bays whose visible top is below the collision box.
  const roofs: Box[] = L.boxes.filter((b) => b.kind === 'container' && b.max[0] - b.min[0] >= 3.1 && b.max[2] - b.min[2] >= 2.2);
  for (const b of roofs) {
    if (rand() > 0.8 || full()) continue;
    const wide = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
    const spanA = wide ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
    const spanB = wide ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    // Up to two units per roof, spread along its length.
    const units = spanA > 7 ? 2 : 1;
    for (let u = 0; u < units; u++) {
      const species = R.roof[Math.floor(rand() * R.roof.length)];
      const [width, , depth] = PROP_SPECIES[species].size;
      if (width + 1.2 > spanA / units || depth + 0.8 > spanB) continue;
      const slot = (u + 0.5) / units - 0.5;
      const shift = slot * spanA + (rand() - 0.5) * (spanA / units - width - 1.2);
      const x = wide ? cx + shift : cx;
      const z = wide ? cz : cz + shift;
      // A solid stacked on this one would bury the unit.
      if (L.boxes.some((o) => o !== b && o.min[1] >= b.max[1] - 0.05 && distToBoxXZ(x, z, o) < propRadius(species))) continue;
      out.push({ species, x, y: b.max[1], z, yaw: (wide ? 0 : Math.PI / 2) + (rand() < 0.5 ? 0 : Math.PI), scale: 1 });
      if (species === 'aircon-unit' && rand() < 0.5) out.push({ species: 'searchlight', x: wide ? x + width / 2 + 0.4 : x, y: b.max[1], z: wide ? z : z + width / 2 + 0.4, yaw: rand() * Math.PI * 2, scale: 2.2 });
    }
  }
  return { props: out, stains };
}
