import type { TerminalId } from '../terminals';
import { ATRIUM_BED, SURVEY_DESK, touchesFurniture, HQ_PORTALS, HQ_ROOMS, HQ_SPAWN, HQ_STATIONS } from '../layout';
import { LIMITS, MOVABLE_STATIONS, type PieceDef, pieceDef } from './catalog';

/**
 * HQ construction rules (pure, M7).
 *
 * Expansion grid: 5 m cells. Cell (i, j) spans x ∈ [2 + 5i, 7 + 5i], z ∈ [-2.5 + 5j, 2.5 + 5j], so the
 * two sealed doors of the original HQ (hangar x = -33, transit x = 37, both around z = 0) sit exactly
 * on cell edges: those two cells are the gateways new wings grow from. The original HQ footprint is
 * never buildable. Edges are keyed by the north (n) and east (e) edge of a cell.
 */
export const CELL = 5;
export const GRID = { x0: 2, z0: -2.5, iMin: -18, iMax: 17, jMin: -9, jMax: 9 };
export const WALL_H = 4.6;

export interface Structure {
  floors: Record<string, string>;
  edges: Record<string, string>;
  ceilings: Record<string, string>;
  pillars: Record<string, string>;
}

export interface StationPose {
  x: number;
  z: number;
  yaw: number;
}

export interface Gateway {
  id: 'hangar' | 'transit';
  cell: [number, number];
  /** Edge of the gateway cell that touches the HQ wall. */
  edge: string;
  door: { x: number; z: number };
}

export const GATEWAYS: readonly Gateway[] = [
  { id: 'hangar', cell: [-8, 0], edge: '-8,0,e', door: { x: -33, z: 0 } },
  { id: 'transit', cell: [7, 0], edge: '6,0,e', door: { x: 37, z: 0 } },
];

export const emptyStructure = (): Structure => ({ floors: {}, edges: {}, ceilings: {}, pillars: {} });

export const cellKey = (i: number, j: number) => `${i},${j}`;
export const parseCell = (k: string): [number, number] => k.split(',').map(Number) as [number, number];
export const cellMin = (i: number, j: number): [number, number] => [GRID.x0 + CELL * i, GRID.z0 + CELL * j];
export const cellCenter = (i: number, j: number): [number, number] => [GRID.x0 + CELL * i + CELL / 2, GRID.z0 + CELL * j + CELL / 2];
export const cellAt = (x: number, z: number): [number, number] => [Math.floor((x - GRID.x0) / CELL), Math.floor((z - GRID.z0) / CELL)];

/** Edge key for one side of a cell, canonicalised to (cell, n|e). */
export function edgeKey(i: number, j: number, side: 'n' | 's' | 'e' | 'w'): string {
  if (side === 's') return `${i},${j - 1},n`;
  if (side === 'w') return `${i - 1},${j},e`;
  return `${i},${j},${side}`;
}

/** The two cells an edge separates. */
export function edgeCells(k: string): [[number, number], [number, number]] {
  const [i, j, s] = k.split(',');
  const a: [number, number] = [Number(i), Number(j)];
  return [a, s === 'n' ? [a[0], a[1] + 1] : [a[0] + 1, a[1]]];
}

/** Segment of an edge in world space. */
export function edgeSegment(k: string): { x0: number; z0: number; x1: number; z1: number; axis: 'x' | 'z' } {
  const [i, j, s] = k.split(',');
  const [x, z] = cellMin(Number(i), Number(j));
  return s === 'n' ? { x0: x, z0: z + CELL, x1: x + CELL, z1: z + CELL, axis: 'z' } : { x0: x + CELL, z0: z, x1: x + CELL, z1: z + CELL, axis: 'x' };
}

/** Cells overlapping the original HQ (never buildable). */
export function coreCell(i: number, j: number): boolean {
  const [x0, z0] = cellMin(i, j);
  const x1 = x0 + CELL;
  const z1 = z0 + CELL;
  return HQ_ROOMS.some((r) => x0 < r.max[0] && x1 > r.min[0] && z0 < r.max[1] && z1 > r.min[1]);
}

export const inBounds = (i: number, j: number) => i >= GRID.iMin && i <= GRID.iMax && j >= GRID.jMin && j <= GRID.jMax;
const isGateway = (i: number, j: number) => GATEWAYS.some((g) => g.cell[0] === i && g.cell[1] === j);
const NEIGHBOURS: [number, number, 'n' | 's' | 'e' | 'w'][] = [
  [0, 1, 'n'],
  [0, -1, 's'],
  [1, 0, 'e'],
  [-1, 0, 'w'],
];

/** Gateways that are open (a floor exists in their cell). */
export const openGateways = (s: Structure) => GATEWAYS.filter((g) => s.floors[cellKey(...g.cell)]);

/** Floors structurally connected (any adjacency) to a gateway: "no floating rooms". */
export function connectedFloors(s: Structure): Set<string> {
  const seen = new Set<string>();
  const queue = openGateways(s).map((g) => cellKey(...g.cell));
  for (const k of queue) seen.add(k);
  while (queue.length) {
    const [i, j] = parseCell(queue.shift()!);
    for (const [di, dj] of NEIGHBOURS) {
      const k = cellKey(i + di, j + dj);
      if (s.floors[k] && !seen.has(k)) {
        seen.add(k);
        queue.push(k);
      }
    }
  }
  return seen;
}

/** Floors a drone can walk to from the HQ (through doorways/doors and open edges). */
export function walkableFloors(s: Structure): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const g of openGateways(s)) {
    const k = cellKey(...g.cell);
    const blocking = s.edges[g.edge];
    if (blocking && !pieceDef(blocking)?.passable) continue;
    seen.add(k);
    queue.push(k);
  }
  while (queue.length) {
    const [i, j] = parseCell(queue.shift()!);
    for (const [di, dj, side] of NEIGHBOURS) {
      const k = cellKey(i + di, j + dj);
      if (!s.floors[k] || seen.has(k)) continue;
      const e = s.edges[edgeKey(i, j, side)];
      if (e && !pieceDef(e)?.passable) continue;
      seen.add(k);
      queue.push(k);
    }
  }
  return seen;
}

// ------------------------------------------------------------------ free placement surfaces

/** Is (x, z) on a walkable interior floor (original HQ rooms, or a reachable expansion cell)? */
export function onFloor(s: Structure, x: number, z: number, margin = 0.5, walk?: Set<string>): boolean {
  for (const r of HQ_ROOMS) if (x > r.min[0] + margin && x < r.max[0] - margin && z > r.min[1] + margin && z < r.max[1] - margin) return true;
  const [i, j] = cellAt(x, z);
  const k = cellKey(i, j);
  if (!s.floors[k]) return false;
  if (walk && !walk.has(k)) return false;
  const [cx, cz] = cellMin(i, j);
  // Inside the cell, keeping clear of walls on its edges (open edges to neighbouring floors are fine).
  const lx = x - cx;
  const lz = z - cz;
  const wallAt = (side: 'n' | 's' | 'e' | 'w') => {
    const e = s.edges[edgeKey(i, j, side)];
    const [di, dj] = side === 'n' ? [0, 1] : side === 's' ? [0, -1] : side === 'e' ? [1, 0] : [-1, 0];
    const exterior = !s.floors[cellKey(i + di, j + dj)] && !(isGateway(i, j) && ((side === 'e' && i === -8) || (side === 'w' && i === 7)));
    return !!e || exterior;
  };
  if (lx < margin && wallAt('w')) return false;
  if (lx > CELL - margin && wallAt('e')) return false;
  if (lz < margin && wallAt('s')) return false;
  if (lz > CELL - margin && wallAt('n')) return false;
  return true;
}

export interface PlacedProp {
  uid: string;
  type: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  props: Record<string, string | number | boolean>;
}

/** Legacy saves can already contain custom furniture in a new fixture's footprint. */
export function furnitureOccupied(area: typeof SURVEY_DESK, props: readonly PlacedProp[], stations: Record<string, StationPose>): boolean {
  return props.some(p => touchesFurniture(area, p.position[0], p.position[2], (pieceDef(p.type)?.radius ?? 0.9) * p.scale)) ||
    Object.values(stations).some(st => touchesFurniture(area, st.x, st.z, 1));
}

/** Keep-out zones: spawn, launch pad, doorways, station access. */
export function keepOut(s: Structure, stations: Record<string, StationPose>): { x: number; z: number; r: number; what: string }[] {
  const out: { x: number; z: number; r: number; what: string }[] = [
    { x: HQ_SPAWN.x, z: HQ_SPAWN.z, r: 2.2, what: 'the arrival point' },
    { x: 0, z: 16, r: 5.6, what: 'the launch pad' },
  ];
  for (const p of HQ_PORTALS) {
    const m = (p.a + p.b) / 2;
    out.push(p.axis === 'x' ? { x: p.c, z: m, r: 2.2, what: 'a passage' } : { x: m, z: p.c, r: 2.4, what: 'a passage' });
  }
  for (const g of GATEWAYS) out.push({ x: g.door.x, z: g.door.z, r: 2.4, what: 'a gateway' });
  for (const [k, t] of Object.entries(s.edges)) {
    if (!pieceDef(t)?.passable) continue;
    const e = edgeSegment(k);
    out.push({ x: (e.x0 + e.x1) / 2, z: (e.z0 + e.z1) / 2, r: 1.8, what: 'a doorway' });
  }
  for (const st of stationPoses(stations)) out.push({ x: st.access[0], z: st.access[1], r: 1.4, what: `the ${st.title.toLowerCase()} access` });
  return out;
}

/** Every station's pose (relocated or default) and the floor point a player stands on to use it. */
export function stationPoses(over: Record<string, StationPose>) {
  return HQ_STATIONS.map((st) => {
    const o = over[st.id];
    const x = o?.x ?? st.pos[0];
    const z = o?.z ?? st.pos[1];
    const yaw = o?.yaw ?? st.yaw;
    // Screens face the user along (sin yaw, cos yaw); the user stands ~1.8 m in front of the console.
    const ax = x + Math.sin(yaw) * 1.8;
    const az = z + Math.cos(yaw) * 1.8;
    return { id: st.id, title: st.title, x, z, yaw, moved: !!o, access: [ax, az] as [number, number] };
  });
}

// ------------------------------------------------------------------ validation

export type Check = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });
const yes: Check = { ok: true };

export function checkFloor(s: Structure, i: number, j: number, type: string): Check {
  if (pieceDef(type)?.kind !== 'floor') return no('Not a floor module');
  if (!inBounds(i, j)) return no('Outside the construction zone');
  if (coreCell(i, j)) return no('The original facility cannot be built over');
  const k = cellKey(i, j);
  if (s.floors[k]) return no('A floor is already there');
  if (Object.keys(s.floors).length >= LIMITS.floors) return no(`Construction limit: ${LIMITS.floors} floor modules`);
  if (!isGateway(i, j) && !NEIGHBOURS.some(([di, dj]) => s.floors[cellKey(i + di, j + dj)])) return no('Must connect to an existing floor or a gateway (no floating rooms)');
  return yes;
}

export function checkRemoveFloor(s: Structure, i: number, j: number, props: readonly PlacedProp[], stations: Record<string, StationPose>): Check {
  const k = cellKey(i, j);
  if (!s.floors[k]) return no('Nothing to remove');
  for (const [di, dj, side] of NEIGHBOURS) {
    const e = edgeKey(i, j, side);
    if (s.edges[e] && !s.floors[cellKey(i + di, j + dj)]) return no('Remove the walls on this module first');
  }
  if (s.ceilings[k]) return no('Remove the ceiling first');
  for (const [pk] of Object.entries(s.pillars)) {
    const [pi, pj] = parseCell(pk);
    const touching = [cellKey(pi, pj), cellKey(pi - 1, pj), cellKey(pi, pj - 1), cellKey(pi - 1, pj - 1)].filter((c) => s.floors[c]);
    if (touching.length === 1 && touching[0] === k) return no('Remove the pillar on this module first');
  }
  const [x0, z0] = cellMin(i, j);
  if (props.some((p) => p.position[0] >= x0 && p.position[0] < x0 + CELL && p.position[2] >= z0 && p.position[2] < z0 + CELL)) return no('Move the objects standing on this module first');
  if (stationPoses(stations).some((st) => st.moved && st.x >= x0 && st.x < x0 + CELL && st.z >= z0 && st.z < z0 + CELL)) return no('A station stands here: relocate it first');
  const next: Structure = { ...s, floors: { ...s.floors } };
  delete next.floors[k];
  const conn = connectedFloors(next);
  if (Object.keys(next.floors).some((f) => !conn.has(f))) return no('Other modules would be left floating');
  return stationsReachable(next, stations);
}

export function checkEdge(s: Structure, key: string, type: string, stations: Record<string, StationPose>): Check {
  if (pieceDef(type)?.kind !== 'edge') return no('Not a wall module');
  if (s.edges[key]) return no('A wall is already there');
  const [a, b] = edgeCells(key);
  if (!s.floors[cellKey(...a)] && !s.floors[cellKey(...b)]) return no('Walls must stand on a floor edge');
  if (GATEWAYS.some((g) => g.edge === key) && !pieceDef(type)?.passable) return no('The gateway to the HQ must stay open (use a door)');
  if (Object.keys(s.edges).length >= LIMITS.edges) return no(`Construction limit: ${LIMITS.edges} wall modules`);
  const next: Structure = { ...s, edges: { ...s.edges, [key]: type } };
  return stationsReachable(next, stations);
}

export function checkCeiling(s: Structure, i: number, j: number, type: string): Check {
  if (pieceDef(type)?.kind !== 'ceiling') return no('Not a ceiling module');
  const k = cellKey(i, j);
  if (!s.floors[k]) return no('Ceilings need a floor below');
  if (s.ceilings[k]) return no('Already has a ceiling');
  return yes;
}

export function checkPillar(s: Structure, i: number, j: number): Check {
  const k = cellKey(i, j);
  if (s.pillars[k]) return no('A pillar is already there');
  if (![cellKey(i, j), cellKey(i - 1, j), cellKey(i, j - 1), cellKey(i - 1, j - 1)].some((c) => s.floors[c])) return no('Pillars stand on a floor corner');
  return yes;
}

/** Every relocated station on an expansion floor must stay reachable on foot. */
export function stationsReachable(s: Structure, stations: Record<string, StationPose>): Check {
  const walk = walkableFloors(s);
  for (const st of stationPoses(stations)) {
    if (!st.moved) continue;
    if (!onFloor(s, st.access[0], st.access[1], 0.3, walk) && !onFloor(s, st.x, st.z, 0.3, walk)) return no(`${st.title} would become unreachable`);
  }
  return yes;
}

/** Free placement of a prop/light/facility or a station (radius from the catalog). */
export function checkFree(s: Structure, type: string, x: number, z: number, scale: number, props: readonly PlacedProp[], stations: Record<string, StationPose>, ignoreUid?: string, ignoreStation?: string): Check {
  const def: PieceDef | undefined = pieceDef(type);
  const station = type.startsWith('station:');
  if (!def && !station) return no('Unknown object');
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(scale)) return no('Invalid position');
  if (!station && (scale < 0.75 || scale > 1.3)) return no('Scale must stay between 75% and 130%');
  const r = (station ? 1.0 : def!.radius ?? 1) * (station ? 1 : scale);
  if (touchesFurniture(ATRIUM_BED, x, z, r)) return no('Overlaps the planted wall');
  if (!stations.command && ignoreStation !== 'command' && touchesFurniture(SURVEY_DESK, x, z, r)) return no('Overlaps the survey table');
  const walk = walkableFloors(s);
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (!onFloor(s, x + dx, z + dz, 0.3, walk)) return no('Must stand fully on a reachable floor, clear of walls');
  for (const k of keepOut(s, stations)) {
    if (ignoreStation && k.what.includes('access') && stationPoses(stations).find((st) => st.id === ignoreStation)?.title && k.what.includes(stationPoses(stations).find((st) => st.id === ignoreStation)!.title.toLowerCase())) continue;
    if ((x - k.x) ** 2 + (z - k.z) ** 2 < (r + k.r) ** 2) return no(`Too close to ${k.what}`);
  }
  for (const p of props) {
    if (p.uid === ignoreUid) continue;
    const pr = (pieceDef(p.type)?.radius ?? 0.9) * p.scale;
    if ((x - p.position[0]) ** 2 + (z - p.position[2]) ** 2 < (r + pr - 0.15) ** 2) return no('Overlaps another object');
  }
  for (const st of stationPoses(stations)) {
    if (st.id === ignoreStation) continue;
    if ((x - st.x) ** 2 + (z - st.z) ** 2 < (r + 1.3) ** 2) return no(`Too close to the ${st.title.toLowerCase()}`);
  }
  return yes;
}

export function isMovableStation(id: string): id is TerminalId {
  return (MOVABLE_STATIONS as readonly string[]).includes(id);
}
