/**
 * Procedural arenas: one seeded, deterministic layout per run (server and clients build the same map from the
 * run seed). The output is a plain `ArenaLayout`, so collision, visuals, placement and dynamics read it exactly
 * like the classic hand-built arena. Structure:
 *
 *  - perimeter + four gate tunnels at the wall midpoints (shared with the classic arena), half size 84-100 m;
 *  - a reactor plaza at the centre that stays open (bulkheads as in the classic arena), the player spawn south of it;
 *  - districts of platforms (with ramps), partition blocks, cover pillars and wall machinery, placed by rejection
 *    sampling with walkable gaps between them;
 *  - lanes (`routes`) traced on the nav grid from each tunnel, forward rifts per gate sector 34-62 m from the
 *    reactor, plasma vents on the lanes, reserved footprints for gate mouths and rifts.
 *
 * Pure: no Babylon imports, all randomness from the seed.
 */
import { mulberry32 } from '../combat/damage';
import { type ArenaLayout, type Box, type GateId, LAYOUT_CONST, perimeterBoxes, type Ramp, type Rift, type Route, southDoorBox } from './layout';
import { NavGrid } from './navgrid';

export const GEN = {
  halfMin: 84,
  halfMax: 100,
  plaza: 19,
  gap: 4.2,
  riftMin: 34,
  riftMax: 62,
};

const GATE_DIR: Record<GateId, { x: number; z: number }> = {
  north: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
  south: { x: 0, z: -1 },
};

const NAME_A = ['Ashfall', 'Breaker', 'Cinder', 'Dusk', 'Ember', 'Fracture', 'Gantry', 'Hollow', 'Iron', 'Kestrel', 'Lumen', 'Mire', 'Null', 'Obsidian', 'Pylon', 'Quarry', 'Rust', 'Slag', 'Tether', 'Vantage', 'Warden', 'Zenith'];
const NAME_B = ['Yard', 'Span', 'Works', 'Basin', 'Reach', 'Foundry', 'Junction', 'Terrace', 'Depot', 'Crossing', 'Bastion', 'Spillway', 'Annex', 'Verge'];

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const overlaps = (a: Rect, b: Rect, pad: number): boolean => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.z0 - pad < b.z1 && a.z1 + pad > b.z0;

/** Sector code + display name for a seed (also used by the loading screen before the arena exists). */
export function sectorName(seed: number): { code: string; name: string } {
  const r = mulberry32((seed ^ 0x2c1b3c6d) >>> 0);
  const name = `${NAME_A[Math.floor(r() * NAME_A.length)]} ${NAME_B[Math.floor(r() * NAME_B.length)]}`;
  const code = `${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}-${(seed >>> 0).toString(16).slice(-4).padStart(4, '0').toUpperCase()}`;
  return { code, name };
}

const cache = new Map<number, ArenaLayout>();

/** Seeded arena (memoised: the loading screen, the Game and dev tools ask for the same seed). */
export function generateArena(seed: number): ArenaLayout {
  const s = seed >>> 0;
  const hit = cache.get(s);
  if (hit) return hit;
  const out = build(s);
  if (cache.size > 8) cache.delete(cache.keys().next().value as number);
  cache.set(s, out);
  return out;
}

function build(seed: number): ArenaLayout {
  const r = mulberry32(seed ^ 0x51ed270b);
  const rand = (a: number, b: number) => a + (b - a) * r();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const H = Math.round(rand(GEN.halfMin, GEN.halfMax));

  const reactor = { x: 0, z: 0, radius: 3.4, height: 7 };
  const playerSpawn = { x: -3.8, z: -20, yaw: 0.3 };

  // Keep-out rectangles for structures (plaza, gate mouths, spawn).
  const keepOut: Rect[] = [
    { x0: -GEN.plaza, z0: -GEN.plaza, x1: GEN.plaza, z1: GEN.plaza },
    { x0: playerSpawn.x - 7, z0: playerSpawn.z - 9, x1: playerSpawn.x + 7, z1: playerSpawn.z + 5 },
  ];
  for (const d of Object.values(GATE_DIR)) {
    // Gate mouth: 16 m wide, 18 m deep corridor inside the wall.
    const cx = d.x * (H - 9);
    const cz = d.z * (H - 9);
    const hw = d.x ? 9 : 8;
    const hd = d.x ? 8 : 9;
    keepOut.push({ x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd });
  }

  const placed: { rect: Rect; boxes: Box[]; ramps: Ramp[] }[] = [];
  const free = (rect: Rect, pad = GEN.gap): boolean => {
    const lim = H - 2.2;
    if (rect.x0 < -lim || rect.x1 > lim || rect.z0 < -lim || rect.z1 > lim) return false;
    if (keepOut.some((k) => overlaps(rect, k, 0))) return false;
    return placed.every((p) => !overlaps(rect, p.rect, pad));
  };
  const tryPlace = (make: () => { rect: Rect; boxes: Box[]; ramps: Ramp[] } | null, attempts = 40): boolean => {
    for (let i = 0; i < attempts; i++) {
      const c = make();
      if (c && free(c.rect)) {
        placed.push(c);
        return true;
      }
    }
    return false;
  };
  const spot = (margin: number) => ({ x: rand(-H + margin, H - margin), z: rand(-H + margin, H - margin) });

  // Lane benders: partition walls across each gate's straight approach, offset sideways, so every lane gets
  // its own chicanes (1-2 per gate, staggered left/right).
  for (const d of Object.values(GATE_DIR)) {
    const n = 1 + (r() < 0.6 ? 1 : 0);
    let side = r() < 0.5 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      tryPlace(() => {
        const along = rand(GEN.plaza + 10, H - 22) * (n === 2 ? (k === 0 ? 0.7 : 1) : 1);
        const width = rand(14, 24);
        const depth = rand(3.5, 5.5);
        const lateral = side * rand(2, 7);
        const cx = d.x ? d.x * along : lateral;
        const cz = d.z ? d.z * along : lateral;
        const w = d.x ? depth : width;
        const dd = d.x ? width : depth;
        const b: Box = { min: [cx - w / 2, 0, cz - dd / 2], max: [cx + w / 2, rand(4, 5.6), cz + dd / 2], kind: 'block' };
        return { rect: { x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] }, boxes: [b], ramps: [] };
      }, 25);
      side = -side;
    }
  }

  // Platforms with one ramp each (sniper decks / tower plateaus).
  const nPlat = 5 + Math.floor(r() * 4);
  for (let n = 0; n < nPlat; n++) {
    tryPlace(() => {
      const w = rand(10, 18);
      const d = rand(8, 14);
      const h = pick([3, 3, 4]);
      const c = spot(12);
      const p: Box = { min: [c.x - w / 2, 0, c.z - d / 2], max: [c.x + w / 2, h, c.z + d / 2], kind: 'platform' };
      const side = Math.floor(r() * 4);
      const len = h * 2.8 + 1;
      const rw = 4;
      let ramp: Ramp;
      if (side < 2) {
        const x0 = side === 0 ? p.min[0] + 1 : p.max[0] - 1 - rw;
        const south = r() < 0.5;
        ramp = south
          ? { x0, x1: x0 + rw, z0: p.min[2] - len, z1: p.min[2], axis: 'z', hMin: 0, hMax: h }
          : { x0, x1: x0 + rw, z0: p.max[2], z1: p.max[2] + len, axis: 'z', hMin: h, hMax: 0 };
      } else {
        const z0 = side === 2 ? p.min[2] + 1 : p.max[2] - 1 - rw;
        const west = r() < 0.5;
        ramp = west
          ? { x0: p.min[0] - len, x1: p.min[0], z0, z1: z0 + rw, axis: 'x', hMin: 0, hMax: h }
          : { x0: p.max[0], x1: p.max[0] + len, z0, z1: z0 + rw, axis: 'x', hMin: h, hMax: 0 };
      }
      const rect = { x0: Math.min(p.min[0], ramp.x0), z0: Math.min(p.min[2], ramp.z0), x1: Math.max(p.max[0], ramp.x1), z1: Math.max(p.max[2], ramp.z1) };
      return { rect, boxes: [p], ramps: [ramp] };
    });
  }

  // Partition blocks (cooling plants): long walls that shape lanes and chokepoints.
  const nBlock = 12 + Math.floor(r() * 8);
  for (let n = 0; n < nBlock; n++) {
    tryPlace(() => {
      const long = rand(6, 14);
      const short = rand(3, 6);
      const alongX = r() < 0.5;
      const w = alongX ? long : short;
      const d = alongX ? short : long;
      const c = spot(8);
      const h = rand(3.6, 5.4);
      const b: Box = { min: [c.x - w / 2, 0, c.z - d / 2], max: [c.x + w / 2, h, c.z + d / 2], kind: 'block' };
      return { rect: { x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] }, boxes: [b], ramps: [] };
    });
  }

  // Cover pillars.
  const nPillar = 16 + Math.floor(r() * 12);
  for (let n = 0; n < nPillar; n++) {
    tryPlace(() => {
      const c = spot(6);
      const s = 2.5;
      const b: Box = { min: [c.x - s / 2, 0, c.z - s / 2], max: [c.x + s / 2, rand(3.8, 7), c.z + s / 2], kind: 'block' };
      return { rect: { x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] }, boxes: [b], ramps: [] };
    }, 20);
  }

  // Wall machinery (south wall along x, east/west walls along z: the builder dresses those faces).
  const nMach = 4 + Math.floor(r() * 5);
  for (let n = 0; n < nMach; n++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const wall = Math.floor(r() * 3);
      const len = rand(8, 12);
      const depth = rand(4, 5);
      const h = rand(2.4, 3.2);
      let b: Box;
      if (wall === 0) {
        const x = rand(-H + 8, H - 8);
        b = { min: [x - len / 2, 0, -H + 1], max: [x + len / 2, h, -H + 1 + depth], kind: 'machine' };
      } else {
        const z = rand(-H + 8, H - 8);
        b = wall === 1
          ? { min: [-H + 1, 0, z - len / 2], max: [-H + 1 + depth, h, z + len / 2], kind: 'machine' }
          : { min: [H - 1 - depth, 0, z - len / 2], max: [H - 1, h, z + len / 2], kind: 'machine' };
      }
      // Machines hug the wall (the interior clamp would reject them): test keep-outs and structures only.
      const rect = { x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] };
      if (keepOut.some((k) => overlaps(rect, k, 0)) || placed.some((p) => overlaps(rect, p.rect, GEN.gap))) continue;
      placed.push({ rect, boxes: [b], ramps: [] });
      break;
    }
  }

  const boxes: Box[] = [...perimeterBoxes(H)];
  const ramps: Ramp[] = [];
  for (const p of placed) {
    boxes.push(...p.boxes);
    ramps.push(...p.ramps);
  }
  boxes.push({ min: [-2.6, 0, -2.6], max: [2.6, reactor.height, 2.6], kind: 'reactor' });

  // Bulkheads near the reactor, as in the classic arena (footprints reserved).
  const barriers: Box[] = [
    { min: [-12.2, 0, -6.5], max: [-10.6, 3.4, 2.5], kind: 'block' },
    { min: [10.6, 0, -2.5], max: [12.2, 3.4, 6.5], kind: 'block' },
  ];

  const base: ArenaLayout = {
    half: H,
    wallHeight: LAYOUT_CONST.WALL_H,
    boxes,
    ramps,
    routes: {} as Record<GateId, Route>,
    reactor,
    playerSpawn,
    laneHalfWidth: 2.8,
    initialGates: ['north', 'east', 'west'],
    southDoor: southDoorBox(H),
    reserved: [],
    barriers,
    vents: [],
    seed,
    mazing: true,
    rifts: [],
    ...sectorName(seed),
  };

  // Lanes: traced on the terrain-only nav grid from deep inside each tunnel.
  const nav = new NavGrid(base, false);
  const deep = H + LAYOUT_CONST.TUNNEL_LEN - 3;
  for (const gate of Object.keys(GATE_DIR) as GateId[]) {
    const d = GATE_DIR[gate];
    let pts = nav.pathFrom(d.x * deep, d.z * deep);
    if (pts.length < 2) {
      // Unreachable (should not happen: structures keep gaps). Fall back to a straight lane.
      pts = [{ x: d.x * deep, z: d.z * deep }, { x: d.x * 6.6, z: d.z * 6.6 }];
    }
    base.routes[gate] = { gate, points: pts };
  }

  // Forward rifts: two per gate sector in open ground, reachable, away from lanes' first metres.
  const rifts: Rift[] = [];
  for (const gate of Object.keys(GATE_DIR) as GateId[]) {
    const d = GATE_DIR[gate];
    const gateAng = Math.atan2(d.x, d.z);
    for (let n = 0, tries = 0; n < 2 && tries < 80; tries++) {
      const ang = gateAng + rand(-0.62, 0.62);
      const dist = rand(GEN.riftMin, Math.min(GEN.riftMax, H - 16));
      const x = Math.sin(ang) * dist;
      const z = Math.cos(ang) * dist;
      let ok = true;
      for (let a = 0; a < 8 && ok; a++) ok = nav.walkable(x + Math.cos(a) * 3.5, z + Math.sin(a) * 3.5);
      if (!ok || !Number.isFinite(nav.costAt(x, z))) continue;
      if (rifts.some((q) => Math.hypot(q.x - x, q.z - z) < 18)) continue;
      if (Math.hypot(x - playerSpawn.x, z - playerSpawn.z) < 22) continue;
      rifts.push({ gate, x, z });
      n++;
    }
  }
  base.rifts = rifts;

  // Vents on the lanes, about 45% of the way in.
  base.vents = (['north', 'east', 'west', 'south'] as GateId[]).map((g) => {
    const p = pointAlong(base.routes[g].points, 0.5);
    return { x: p.x, z: p.z, r: 3.2 };
  });

  base.reserved = [
    ...barriers.map((b) => ({ x0: b.min[0] - 0.4, z0: b.min[2] - 0.4, x1: b.max[0] + 0.4, z1: b.max[2] + 0.4, label: 'Reserved: containment bulkhead' })),
    ...Object.values(GATE_DIR).map((d) => {
      const cx = d.x * (H - 5);
      const cz = d.z * (H - 5);
      return { x0: cx - (d.x ? 5 : 7), z0: cz - (d.x ? 7 : 5), x1: cx + (d.x ? 5 : 7), z1: cz + (d.x ? 7 : 5), label: 'Reserved: gate mouth' };
    }),
    ...rifts.map((q) => ({ x0: q.x - 3.5, z0: q.z - 3.5, x1: q.x + 3.5, z1: q.z + 3.5, label: 'Reserved: rift anchor' })),
    ...base.vents.map((v) => ({ x0: v.x - v.r, z0: v.z - v.r, x1: v.x + v.r, z1: v.z + v.r, label: 'Reserved: plasma vent' })),
  ];
  return base;
}

/** Point at fraction `f` of a polyline's length. */
export function pointAlong(pts: readonly { x: number; z: number }[], f: number): { x: number; z: number } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  let left = total * Math.max(0, Math.min(1, f));
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (left <= l && l > 0) {
      const t = left / l;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
    }
    left -= l;
  }
  return pts[pts.length - 1];
}

/** Arena summary for the loading screen. */
export function arenaStats(L: ArenaLayout): { size: number; structures: number; platforms: number; rifts: number; lanes: number } {
  return {
    size: Math.round(L.half * 2),
    structures: L.boxes.filter((b) => b.kind === 'block' || b.kind === 'machine' || b.kind === 'platform').length,
    platforms: L.boxes.filter((b) => b.kind === 'platform').length,
    rifts: L.rifts?.length ?? 0,
    lanes: L.initialGates.length,
  };
}
