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
import { barrierX, barrierZ, containerYard, maze, orient, overpass, type Piece, redoubt, serpentine, skyway, withWings } from './districts';
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

/** Quarter turns that point a district's local +z at each gate. */
const GATE_K: Record<GateId, number> = { north: 0, east: 1, south: 2, west: 3 };

const NAME_A = ['Ashfall', 'Breaker', 'Cinder', 'Dusk', 'Ember', 'Fracture', 'Gantry', 'Hollow', 'Iron', 'Kestrel', 'Lumen', 'Mire', 'Null', 'Obsidian', 'Pylon', 'Quarry', 'Rust', 'Slag', 'Tether', 'Vantage', 'Warden', 'Zenith'];
const NAME_B = ['Yard', 'Span', 'Works', 'Basin', 'Reach', 'Foundry', 'Junction', 'Terrace', 'Depot', 'Crossing', 'Bastion', 'Spillway', 'Annex', 'Verge'];

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const rectOf = (b: Box): Rect => ({ x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] });
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

/** Shared state of one generation pass (stages place pieces through it). */
interface Gen {
  r: () => number;
  rand: (a: number, b: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  H: number;
  placed: Piece[];
  keepOut: Rect[];
  free: (rect: Rect, pad?: number) => boolean;
  freePiece: (piece: Piece, pad?: number) => boolean;
  tryPlace: (make: () => Piece | null, attempts?: number) => boolean;
  spot: (margin: number) => { x: number; z: number };
  placeOriented: (make: () => Omit<Piece, 'rect'>, k: number, cx: number, cz: number, pad?: number) => boolean;
}

/** Lane districts, the bastion ring, outer winged districts and off-lane set pieces. */
function districtStage(g: Gen): void {
  const { r, rand, pick, H, placed, freePiece, spot, placeOriented } = g;
  // Lane districts: every gate's approach gets its own set piece straddling the straight line to the reactor
  // (a maze, a serpentine chicane, a container yard or an overpass with a bridge), so lanes wind and differ.
  const kinds = ['maze', 'serpentine', 'containers', 'overpass'] as const;
  type DistrictKind = (typeof kinds)[number];
  const order = [...kinds].sort(() => r() - 0.5);
  const makeDistrict = (kind: DistrictKind): Omit<Piece, 'rect'> => {
    if (kind === 'maze') return maze(r, 4 + Math.floor(r() * 3), 3 + Math.floor(r() * 2), rand(8, 10));
    if (kind === 'serpentine') return serpentine(r, rand(28, 38), 3 + Math.floor(r() * 3), rand(7.5, 9.5), rand(7, 8.5));
    if (kind === 'containers') return containerYard(r, 3 + Math.floor(r() * 2), 3 + Math.floor(r() * 2));
    return overpass(r, rand(16, 22), pick([4, 5]));
  };
  /** Place one winged district across a gate's approach, in [lo, hi] metres from the reactor. */
  const laneDistrict = (gate: GateId, kind: DistrictKind, band: [number, number]): boolean => {
    const k = GATE_K[gate];
    const d = GATE_DIR[gate];
    for (let attempt = 0; attempt < 36; attempt++) {
      // Wings reach most of the way across the quadrant (shorter on later attempts if they do not fit).
      const wing = Math.max(8, rand(30, 48) * (1 - attempt / 48));
      const proto = withWings(makeDistrict(kind), wing, 0, r);
      const probe = orient(proto, k, 0, 0);
      const ext = (k % 2 === 0 ? probe.rect.z1 - probe.rect.z0 : probe.rect.x1 - probe.rect.x0) / 2;
      const lo = Math.max(band[0], GEN.plaza + ext + 3);
      const hi = Math.min(band[1], H - 19 - ext);
      if (hi <= lo) continue;
      const along = rand(lo, hi);
      const lateral = kind === 'containers' ? rand(-5, 5) : rand(-2, 2);
      const piece = orient(proto, k, d.x ? d.x * along : lateral, d.z ? d.z * along : lateral);
      if (freePiece(piece)) {
        placed.push(piece);
        return true;
      }
    }
    return false;
  };
  // Bastion ring: each lane's inner district sits in a continuous rectangle of barrier walls whose sides meet at
  // the corners, so ground waves must pass through a district (or one of the rare breaches in the ring). The
  // drone hops the 3.2 m walls (jump + boost). Then an outer winged district per lane where it fits.
  const gates = Object.keys(GATE_DIR) as GateId[];
  const ringAt: Record<GateId, number> = { north: 0, east: 0, west: 0, south: 0 };
  const span: Record<GateId, [number, number]> = { north: [0, 0], east: [0, 0], west: [0, 0], south: [0, 0] };
  const ringKind: Record<GateId, DistrictKind> = { north: 'maze', east: 'maze', west: 'maze', south: 'maze' };
  gates.forEach((gate, gi) => {
    const kind = order[gi % order.length];
    ringKind[gate] = kind;
    const k = GATE_K[gate];
    const d = GATE_DIR[gate];
    let done = false;
    for (let attempt = 0; attempt < 30 && !done; attempt++) {
      const proto = makeDistrict(kind);
      const probe = orient(proto, k, 0, 0);
      const ext = (k % 2 === 0 ? probe.rect.z1 - probe.rect.z0 : probe.rect.x1 - probe.rect.x0) / 2;
      const lo = GEN.plaza + ext + 4;
      const hi = Math.min(H * 0.52, H - 19 - ext);
      if (hi <= lo) continue;
      const along = rand(lo, hi);
      const lateral = rand(-3, 3);
      const piece = orient(proto, k, d.x ? d.x * along : lateral, d.z ? d.z * along : lateral);
      if (!freePiece(piece)) continue;
      placed.push(piece);
      ringAt[gate] = along;
      span[gate] = d.x ? [piece.rect.z0, piece.rect.z1] : [piece.rect.x0, piece.rect.x1];
      done = true;
    }
    if (!done) {
      // No district fits: the ring side gets a plain 9 m opening instead.
      ringAt[gate] = rand(GEN.plaza + 14, H * 0.45);
      span[gate] = [-4.5, 4.5];
    }
  });
  const ring: Box[] = [];
  const seg = (alongX: boolean, c: number, from: number, to: number) => {
    const a0 = Math.min(from, to);
    const a1 = Math.max(from, to);
    if (a1 - a0 < 0.5) return;
    // Rare breach: a 4.5 m gap somewhere in the middle of the segment.
    if (a1 - a0 > 14 && r() < 0.22) {
      const g0 = a0 + (a1 - a0) * rand(0.3, 0.7);
      ring.push(alongX ? barrierX(a0, g0 - 2.25, c) : barrierZ(a0, g0 - 2.25, c));
      ring.push(alongX ? barrierX(g0 + 2.25, a1, c) : barrierZ(g0 + 2.25, a1, c));
    } else ring.push(alongX ? barrierX(a0, a1, c) : barrierZ(a0, a1, c));
  };
  const e = 0.45;
  // North / south sides run along x between the west and east ring lines; east / west along z.
  seg(true, ringAt.north, -ringAt.west - e, span.north[0]);
  seg(true, ringAt.north, span.north[1], ringAt.east + e);
  seg(true, -ringAt.south, -ringAt.west - e, span.south[0]);
  seg(true, -ringAt.south, span.south[1], ringAt.east + e);
  seg(false, ringAt.east, -ringAt.south - e, span.east[0]);
  seg(false, ringAt.east, span.east[1], ringAt.north + e);
  seg(false, -ringAt.west, -ringAt.south - e, span.west[0]);
  seg(false, -ringAt.west, span.west[1], ringAt.north + e);
  placed.push({ rect: { x0: -ringAt.west, z0: -ringAt.south, x1: ringAt.east, z1: ringAt.north }, boxes: ring, ramps: [], tag: 'ring' });
  // Outer layer: a winged district further out on each lane, of a different kind than the ring passage.
  gates.forEach((gate) => {
    const second = kinds.filter((x) => x !== ringKind[gate])[Math.floor(r() * 3)];
    laneDistrict(gate, second, [ringAt[gate] + 14, H]);
  });

  // Off-lane districts: redoubts (tower nests), extra yards and the odd second maze.
  for (let n = 0, want = 2 + Math.floor(r() * 2); n < want; n++) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const c = spot(20);
      if (placeOriented(() => redoubt(r, rand(8, 11)), Math.floor(r() * 4), c.x, c.z)) break;
    }
  }
  for (let n = 0, want = 1 + Math.floor(r() * 2); n < want; n++) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const c = spot(18);
      if (placeOriented(() => containerYard(r, 2 + Math.floor(r() * 2), 2 + Math.floor(r() * 2)), Math.floor(r() * 4), c.x, c.z)) break;
    }
  }
  if (r() < 0.6) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const c = spot(22);
      if (placeOriented(() => maze(r, 3, 3, rand(6.5, 7.5), 0.3), Math.floor(r() * 4), c.x, c.z)) break;
    }
  }

}

/** Platforms with ramps, partition blocks, cover pillars and wall machinery. */
function scatterStage(g: Gen): void {
  const { r, rand, pick, H, placed, keepOut, tryPlace, spot } = g;
  // Platforms with one ramp each (sniper decks / tower plateaus).
  const nPlat = 4 + Math.floor(r() * 4);
  for (let n = 0; n < nPlat; n++) {
    tryPlace(() => {
      const w = rand(10, 18);
      const d = rand(8, 14);
      const h = pick([3, 4, 4, 5]);
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
      return { rect, boxes: [p], ramps: [ramp], tag: 'platform' };
    });
  }

  // Partition blocks (cooling plants): long walls that shape lanes and chokepoints.
  const nBlock = 7 + Math.floor(r() * 6);
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
      return { rect: { x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] }, boxes: [b], ramps: [], tag: 'block' };
    });
  }

  // Cover pillars.
  const nPillar = 10 + Math.floor(r() * 10);
  for (let n = 0; n < nPillar; n++) {
    tryPlace(() => {
      const c = spot(6);
      const s = 2.5;
      const b: Box = { min: [c.x - s / 2, 0, c.z - s / 2], max: [c.x + s / 2, rand(3.8, 7), c.z + s / 2], kind: 'block' };
      return { rect: { x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] }, boxes: [b], ramps: [], tag: 'block' };
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
      placed.push({ rect, boxes: [b], ramps: [], tag: 'machine' });
      break;
    }
  }

}

/** Skyways between facing platforms of the same height. */
function skywayStage(g: Gen): void {
  const { placed, keepOut } = g;
  // Skyways: bridges between facing platforms of the same height (players cross above, enemies pass under).
  const decks = placed.flatMap((p) => p.boxes.filter((b) => b.kind === 'platform'));
  let skyways = 0;
  for (let i = 0; i < decks.length && skyways < 4; i++) {
    for (let j = i + 1; j < decks.length && skyways < 4; j++) {
      const A = decks[i];
      const B = decks[j];
      if (A.max[1] !== B.max[1]) continue;
      const h = A.max[1];
      const tall = (p: Piece) => p.boxes.some((b) => b !== A && b !== B && b.kind !== 'bridge' && b.max[1] > h - 0.7);
      const tryDeck = (deck: Box[], rect: Rect): boolean => {
        const len = Math.max(rect.x1 - rect.x0, rect.z1 - rect.z0);
        if (len < 6 || len > 40) return false;
        if (placed.some((p) => tall(p) && overlaps(rect, p.rect, 0.6))) return false;
        if (placed.some((p) => p.ramps.some((q) => overlaps(rect, { x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1 }, 0.5)))) return false;
        if (keepOut.slice(0, 2).some((k) => overlaps(rect, k, 0))) return false;
        placed.push({ rect, boxes: deck, ramps: [], tag: 'skyway' });
        skyways++;
        return true;
      };
      const oz0 = Math.max(A.min[2], B.min[2]);
      const oz1 = Math.min(A.max[2], B.max[2]);
      const ox0 = Math.max(A.min[0], B.min[0]);
      const ox1 = Math.min(A.max[0], B.max[0]);
      if (oz1 - oz0 >= 5) {
        const z = (oz0 + oz1) / 2;
        const [L0, R0] = A.max[0] < B.min[0] ? [A, B] : [B, A];
        if (L0.max[0] < R0.min[0]) tryDeck(skyway(L0.max[0], z, R0.min[0], z, h), { x0: L0.max[0], z0: z - 1.8, x1: R0.min[0], z1: z + 1.8 });
      } else if (ox1 - ox0 >= 5) {
        const x = (ox0 + ox1) / 2;
        const [L0, R0] = A.max[2] < B.min[2] ? [A, B] : [B, A];
        if (L0.max[2] < R0.min[2]) tryDeck(skyway(x, L0.max[2], x, R0.min[2], h), { x0: x - 1.8, z0: L0.max[2], x1: x + 1.8, z1: R0.min[2] });
      }
    }
  }

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

  const placed: Piece[] = [];
  const free = (rect: Rect, pad = GEN.gap): boolean => {
    const lim = H - 2.2;
    if (rect.x0 < -lim || rect.x1 > lim || rect.z0 < -lim || rect.z1 > lim) return false;
    if (keepOut.some((k) => overlaps(rect, k, 0))) return false;
    return placed.every((p) => !overlaps(rect, p.rect, pad) || !pieceHits(p, [rect], pad));
  };
  /** Box-level test for big multi-part pieces (winged districts): bounding rects overlap far more often. */
  const pieceHits = (p: Piece, rects: Rect[], pad: number): boolean => {
    const own = [...p.boxes.map(rectOf), ...p.ramps.map((q) => ({ x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1 }))];
    return rects.some((a) => own.some((b) => overlaps(a, b, pad)));
  };
  const freePiece = (piece: Piece, pad = GEN.gap): boolean => {
    const lim = H - 2.2;
    const rects = [...piece.boxes.map(rectOf), ...piece.ramps.map((q) => ({ x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1 }))];
    if (rects.some((a) => a.x0 < -lim || a.x1 > lim || a.z0 < -lim || a.z1 > lim)) return false;
    if (rects.some((a) => keepOut.some((k) => overlaps(a, k, 0)))) return false;
    return placed.every((p) => !overlaps(piece.rect, p.rect, pad) || !pieceHits(p, rects, pad));
  };
  const tryPlace = (make: () => Piece | null, attempts = 40): boolean => {
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

  const placeOriented = (make: () => Omit<Piece, 'rect'>, k: number, cx: number, cz: number, pad = GEN.gap): boolean => {
    const piece = orient(make(), k, cx, cz);
    if (!freePiece(piece, pad)) return false;
    placed.push(piece);
    return true;
  };

  const g: Gen = { r, rand, pick, H, placed, keepOut, free, freePiece, tryPlace, spot, placeOriented };
  districtStage(g);
  scatterStage(g);
  skywayStage(g);
  // Bulkheads near the reactor, as in the classic arena (footprints reserved).
  const barriers: Box[] = [
    { min: [-12.2, 0, -6.5], max: [-10.6, 3.4, 2.5], kind: 'block' },
    { min: [10.6, 0, -2.5], max: [12.2, 3.4, 6.5], kind: 'block' },
  ];

  const assemble = (): ArenaLayout => {
    const boxes: Box[] = [...perimeterBoxes(H)];
    const ramps: Ramp[] = [];
    for (const p of placed) {
      boxes.push(...p.boxes);
      ramps.push(...p.ramps);
    }
    boxes.push({ min: [-2.6, 0, -2.6], max: [2.6, reactor.height, 2.6], kind: 'reactor' });
    return {
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
      features: placed.map((p) => p.tag).filter((t) => !['platform', 'block', 'machine'].includes(t)),
      ...sectorName(seed),
    };
  };

  // Connectivity: every gate must reach the reactor on the ground. Drop the latest district that sits on a
  // failing gate's approach until it does (districts are built connected, so this is a rare safety net).
  const deep = H + LAYOUT_CONST.TUNNEL_LEN - 3;
  let base = assemble();
  let nav = new NavGrid(base, false);
  for (let guard = 0; guard < 12; guard++) {
    const bad = (Object.keys(GATE_DIR) as GateId[]).find((g) => !Number.isFinite(nav.costAt(GATE_DIR[g].x * deep, GATE_DIR[g].z * deep)));
    if (!bad) break;
    const d = GATE_DIR[bad];
    const axis = d.x ? { x0: 0, z0: -6, x1: d.x * H, z1: 6 } : { x0: -6, z0: 0, x1: 6, z1: d.z * H };
    const norm = { x0: Math.min(axis.x0, axis.x1), z0: Math.min(axis.z0, axis.z1), x1: Math.max(axis.x0, axis.x1), z1: Math.max(axis.z0, axis.z1) };
    let idx = -1;
    for (let i = placed.length - 1; i >= 0; i--) if (overlaps(placed[i].rect, norm, 0)) { idx = i; break; }
    placed.splice(idx >= 0 ? idx : placed.length - 1, 1);
    base = assemble();
    nav = new NavGrid(base, false);
  }

  // Lanes: traced on the terrain-only nav grid from deep inside each tunnel.
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
