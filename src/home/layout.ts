import type { TerminalId } from '../ui/store';

/**
 * Headquarters floor plan (pure data, metres; +z is north, y up).
 * Rooms are axis-aligned; walls are generated once per shared edge with portals cut out.
 */
export interface Room {
  id: string;
  name: string;
  min: [number, number]; // x, z
  max: [number, number];
  height: number;
}

/** Wall opening on an axis-aligned line (x = c or z = c) from `a` to `b` along the other axis. */
export interface Portal {
  axis: 'x' | 'z';
  c: number;
  a: number;
  b: number;
  height: number;
}

export interface Station {
  id: TerminalId;
  title: string;
  action: string;
  /** Room/area label shown in the HUD when nearby. */
  area: string;
  /** Console position on the floor and the yaw the screen faces (towards the user). */
  pos: [number, number];
  yaw: number;
  /** Point the player looks at to interact (world space, in front of the screen). */
  focus: [number, number, number];
  range: number;
}

export const HQ_ROOMS: readonly Room[] = [
  { id: 'command', name: 'COMMAND DECK', min: [-11, -11], max: [11, 11], height: 7 },
  { id: 'config', name: 'DRONE BAY', min: [-21, -6], max: [-11, 6], height: 5 },
  { id: 'works', name: 'STORAGE & WORKSHOP', min: [11, -9], max: [23, 9], height: 5 },
  { id: 'deploy', name: 'LAUNCH BAY', min: [-6, 11], max: [6, 21], height: 8 },
  // M4 facilities
  { id: 'market', name: 'MARKET CONCOURSE', min: [23, -8], max: [37, 8], height: 6 },
  { id: 'reclaim', name: 'RECLAMATION', min: [-33, -7], max: [-21, 7], height: 6 },
];

export const HQ_PORTALS: readonly Portal[] = [
  { axis: 'x', c: -11, a: -3.5, b: 3.5, height: 4.2 },
  { axis: 'x', c: 11, a: -4, b: 4, height: 4.2 },
  { axis: 'z', c: 11, a: -4.5, b: 4.5, height: 6 },
  { axis: 'x', c: 23, a: -2.5, b: 2.5, height: 4.2 },
  { axis: 'x', c: -21, a: -2.5, b: 2.5, height: 4.2 },
];

/** Observation window in the command deck's south wall. */
export const HQ_WINDOW = { z: -11, x0: -7.5, x1: 7.5, y0: 1.3, y1: 5.6 };

/** Sealed doors reserved for future facilities (visual only, solid wall behind). */
export const HQ_SEALED_DOORS: readonly { axis: 'x' | 'z'; c: number; a: number; b: number; facing: 1 | -1; label: string }[] = [
  { axis: 'x', c: -33, a: -2, b: 2, facing: 1, label: 'HANGAR' },
  { axis: 'x', c: 37, a: -2, b: 2, facing: -1, label: 'TRANSIT' },
  { axis: 'z', c: -11, a: -10.4, b: -8.4, facing: 1, label: 'QUARTERS' },
];

export const HQ_SPAWN = { x: 0, z: -6.5, yaw: 0 };

/** Global default interaction distance (stations may override). */
export const INTERACT_RANGE = 3.6;

export const HQ_STATIONS: readonly Station[] = [
  { id: 'deploy', title: 'DEPLOYMENT TERMINAL', action: 'Plan a survival operation', area: 'LAUNCH BAY', pos: [0, 15.2], yaw: Math.PI, focus: [0, 1.3, 14.75], range: INTERACT_RANGE },
  { id: 'command', title: 'COMMAND CONSOLE', action: 'Service record & survival records', area: 'COMMAND DECK', pos: [0, 0], yaw: 0, focus: [0, 1.25, 0], range: 4.2 },
  { id: 'loadout', title: 'DRONE CONFIGURATION', action: 'Inspect loadout & equipment slots', area: 'DRONE BAY', pos: [-15.2, 0], yaw: Math.PI / 2, focus: [-14.75, 1.3, 0], range: INTERACT_RANGE },
  { id: 'storage', title: 'STORAGE TERMINAL', action: 'Secured equipment & resources', area: 'STORAGE', pos: [17, 6.6], yaw: Math.PI, focus: [17, 1.3, 6.15], range: INTERACT_RANGE },
  { id: 'workshop', title: 'ENGINEERING WORKSHOP', action: 'Modules · affixes · enhancement · components', area: 'WORKSHOP', pos: [17, -6.6], yaw: 0, focus: [17, 1.3, -6.15], range: INTERACT_RANGE },
  // M4 economy stations
  { id: 'fabricate', title: 'FABRICATOR', action: 'Craft equipment, modules and materials', area: 'WORKSHOP', pos: [21.55, -5.2], yaw: -Math.PI / 2, focus: [20.45, 1.3, -5.2], range: 3.8 },
  { id: 'merchant', title: 'EQUIPMENT EXCHANGE', action: 'Buy and sell equipment', area: 'MARKET CONCOURSE', pos: [30, 5.6], yaw: Math.PI, focus: [30, 1.3, 5.15], range: INTERACT_RANGE },
  { id: 'modules', title: 'MODULE BROKER', action: 'Upgrade modules and material exchange', area: 'MARKET CONCOURSE', pos: [30, -5.6], yaw: 0, focus: [30, 1.3, -5.15], range: INTERACT_RANGE },
  { id: 'salvage', title: 'RECLAMATION PRESS', action: 'Dismantle equipment into materials', area: 'RECLAMATION', pos: [-26.6, -3.6], yaw: Math.PI / 2, focus: [-26.15, 1.3, -3.6], range: INTERACT_RANGE },
];

/** Name of the area containing (x, z), for the location readout. */
export function areaAt(x: number, z: number): string {
  if (x > 23) return 'MARKET CONCOURSE';
  if (x < -21) return 'RECLAMATION';
  if (x > 11) return z >= 0 ? 'STORAGE' : 'WORKSHOP';
  for (const r of HQ_ROOMS) if (x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]) return r.name;
  return 'COMMAND DECK';
}

export interface WallSegment {
  axis: 'x' | 'z';
  c: number;
  a: number;
  b: number;
  y0: number;
  y1: number;
}

/**
 * Wall segments for the whole plan: each room edge contributes an interval on its
 * line; shared edges are merged so no wall is generated twice, and portals are cut
 * out (leaving a lintel above them). Height of a merged line is the max of its rooms.
 */
export function wallSegments(rooms: readonly Room[] = HQ_ROOMS, portals: readonly Portal[] = HQ_PORTALS): WallSegment[] {
  const lines = new Map<string, { axis: 'x' | 'z'; c: number; iv: [number, number, number][] }>();
  const add = (axis: 'x' | 'z', c: number, a: number, b: number, h: number) => {
    const k = `${axis}${c}`;
    if (!lines.has(k)) lines.set(k, { axis, c, iv: [] });
    lines.get(k)!.iv.push([Math.min(a, b), Math.max(a, b), h]);
  };
  for (const r of rooms) {
    add('z', r.min[1], r.min[0], r.max[0], r.height);
    add('z', r.max[1], r.min[0], r.max[0], r.height);
    add('x', r.min[0], r.min[1], r.max[1], r.height);
    add('x', r.max[0], r.min[1], r.max[1], r.height);
  }
  const out: WallSegment[] = [];
  for (const { axis, c, iv } of lines.values()) {
    // Split the line at every interval boundary, then emit each piece once at the max height covering it.
    const cuts = [...new Set(iv.flatMap(([a, b]) => [a, b]))].sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      const mid = (a + b) / 2;
      const covering = iv.filter(([p, q]) => mid > p && mid < q);
      if (!covering.length) continue;
      const h = Math.max(...covering.map((x) => x[2]));
      // A piece covered by two rooms of different height is an interior partition: keep it.
      let pieces: [number, number][] = [[a, b]];
      for (const p of portals) {
        if (p.axis !== axis || p.c !== c) continue;
        const next: [number, number][] = [];
        for (const [s, e] of pieces) {
          if (p.b <= s || p.a >= e) {
            next.push([s, e]);
            continue;
          }
          if (p.a > s) next.push([s, p.a]);
          if (p.b < e) next.push([p.b, e]);
          // Lintel above the opening.
          out.push({ axis, c, a: Math.max(s, p.a), b: Math.min(e, p.b), y0: p.height, y1: h });
        }
        pieces = next;
      }
      for (const [s, e] of pieces) if (e - s > 0.01) out.push({ axis, c, a: s, b: e, y0: 0, y1: h });
    }
  }
  return out;
}
