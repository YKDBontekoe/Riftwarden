/**
 * Arena layout data: pure, engine-independent description of the facility.
 * Collision, placement rules, enemy routes and the visual builder all read from here,
 * so gameplay geometry and rendered geometry can never drift apart.
 */

/** `barrier`: thin concrete walls (mazes, chicanes, redoubts, pylons); `container`: shipping-container stacks; `bridge`: elevated deck (enemies pass under). */
export type SolidKind = 'wall' | 'platform' | 'block' | 'machine' | 'reactor' | 'gate' | 'barrier' | 'container' | 'bridge' | 'relay' | 'runwall';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  kind: SolidKind;
}

/** Ramp rising linearly from h0 at the low end to h1 at the high end of its axis. */
export interface Ramp {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  axis: 'x' | 'z';
  /** Height at the min end of the axis. */
  hMin: number;
  /** Height at the max end of the axis. */
  hMax: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export type GateId = 'north' | 'east' | 'west' | 'south';

export interface Route {
  gate: GateId;
  points: Vec2[];
}

export interface ArenaLayout {
  half: number;
  wallHeight: number;
  boxes: Box[];
  ramps: Ramp[];
  routes: Record<GateId, Route>;
  reactor: { x: number; z: number; radius: number; height: number };
  playerSpawn: { x: number; z: number; yaw: number };
  laneHalfWidth: number;
  /** M6: gates open at the start of a run; the others are sealed until an arena evolution opens them. */
  initialGates: GateId[];
  /** M6: sealed blast door filling the south gate opening (removed by evolution A). */
  southDoor: Box;
  /** M6: footprints reserved for facility machinery (no tower construction, ever). */
  reserved: { x0: number; z0: number; x1: number; z1: number; label: string }[];
  /** M6: containment bulkheads raised by evolution B (cover / chokepoints). Footprints are reserved. */
  barriers: Box[];
  /** M6: plasma vents opened by evolution B: on the lanes, erupt periodically. */
  vents: { x: number; z: number; r: number }[];
  /** Procedural arenas: generator seed (absent = the hand-built classic arena). */
  seed?: number;
  /** Procedural arenas: display name and short sector code (loading screen, HUD). */
  name?: string;
  code?: string;
  /** Towers may stand on lanes; ground enemies path on a nav grid and breach blocking towers. */
  mazing?: boolean;
  /** M10: biome (look, hazards, faction); absent = the outpost. */
  biome?: 'outpost' | 'cryo' | 'foundry';
  /** M10: ground hazard patches (frost fields / slag pools). */
  hazards?: { x: number; z: number; r: number; kind: 'frost' | 'slag' }[];
  /** Procedural arenas: set pieces placed (e.g. 'maze', 'overpass', 'skyway'), for the briefing. */
  features?: string[];
  /** Forward rifts: spawn points inside the arena, grouped by the gate whose waves they carry. */
  rifts?: Rift[];
}

/** A forward rift: a spawn point inside the arena that carries part of a gate's waves (keeps first contact fast). */
export interface Rift {
  gate: GateId;
  x: number;
  z: number;
}

const HALF = 44;
const WALL_T = 2;
const WALL_H = 9;
const GATE_HALF = 4.5;
const TUNNEL_LEN = 12;

type Rot = (p: Vec2) => Vec2;
const rotN: Rot = (p) => ({ x: p.x, z: p.z });
const rotE: Rot = (p) => ({ x: p.z, z: -p.x });
const rotW: Rot = (p) => ({ x: -p.z, z: p.x });
/** South mirrors the north lane in z only, so the bend keeps east of the player spawn. */
const rotS: Rot = (p) => ({ x: p.x, z: -p.z });

function rotBox(rot: Rot, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, kind: SolidKind): Box {
  const a = rot({ x: x0, z: z0 });
  const b = rot({ x: x1, z: z1 });
  return {
    min: [Math.min(a.x, b.x), y0, Math.min(a.z, b.z)],
    max: [Math.max(a.x, b.x), y1, Math.max(a.z, b.z)],
    kind,
  };
}


/**
 * Perimeter walls with the four gate openings and their tunnels (shared by the classic and generated arenas,
 * so gate frames, mist, lights and dressing always line up with the walls).
 */
export function perimeterBoxes(H: number): Box[] {
  const boxes: Box[] = [];
  const g = GATE_HALF;
  // Outer perimeter with gate openings on N, E, W. South wall is solid.
  // South wall (two halves around the sealed south gate)
  boxes.push({ min: [-H - WALL_T, 0, -H - WALL_T], max: [-g, WALL_H, -H], kind: 'wall' });
  boxes.push({ min: [g, 0, -H - WALL_T], max: [H + WALL_T, WALL_H, -H], kind: 'wall' });
  // North wall (two halves around the gate)
  boxes.push({ min: [-H - WALL_T, 0, H], max: [-g, WALL_H, H + WALL_T], kind: 'wall' });
  boxes.push({ min: [g, 0, H], max: [H + WALL_T, WALL_H, H + WALL_T], kind: 'wall' });
  // East wall
  boxes.push({ min: [H, 0, -H - WALL_T], max: [H + WALL_T, WALL_H, -g], kind: 'wall' });
  boxes.push({ min: [H, 0, g], max: [H + WALL_T, WALL_H, H + WALL_T], kind: 'wall' });
  // West wall
  boxes.push({ min: [-H - WALL_T, 0, -H - WALL_T], max: [-H, WALL_H, -g], kind: 'wall' });
  boxes.push({ min: [-H - WALL_T, 0, g], max: [-H, WALL_H, H + WALL_T], kind: 'wall' });

  // Gate tunnels (side walls + back wall), generated for N and rotated for E/W.
  for (const rot of [rotN, rotE, rotW, rotS]) {
    boxes.push(rotBox(rot, -g - WALL_T, H, -g, H + TUNNEL_LEN, 0, WALL_H, 'gate'));
    boxes.push(rotBox(rot, g, H, g + WALL_T, H + TUNNEL_LEN, 0, WALL_H, 'gate'));
    boxes.push(rotBox(rot, -g - WALL_T, H + TUNNEL_LEN, g + WALL_T, H + TUNNEL_LEN + WALL_T, 0, WALL_H, 'gate'));
  }

  return boxes;
}

/** Sealed blast door filling the south gate opening. */
export function southDoorBox(H: number): Box {
  return { min: [-GATE_HALF, 0, -H - WALL_T], max: [GATE_HALF, WALL_H, -H], kind: 'gate' };
}

export const LAYOUT_CONST = { WALL_T, WALL_H, GATE_HALF, TUNNEL_LEN };

function buildLayout(): ArenaLayout {
  const H = HALF;
  const boxes: Box[] = [];
  const ramps: Ramp[] = [];

  boxes.push(...perimeterBoxes(HALF));
  for (const rot of [rotN, rotE, rotW]) boxes.push(rotBox(rot, -7, 21, 3, 27, 0, 4.5, 'block'));

  // Elevated defensive platforms. South pair (h=3) and north pair (h=4).
  boxes.push({ min: [-32, 0, -36], max: [-17, 3, -24], kind: 'platform' });
  boxes.push({ min: [17, 0, -36], max: [32, 3, -24], kind: 'platform' });
  ramps.push({ x0: -31, x1: -27, z0: -24, z1: -15, axis: 'z', hMin: 3, hMax: 0 });
  ramps.push({ x0: 27, x1: 31, z0: -24, z1: -15, axis: 'z', hMin: 3, hMax: 0 });

  boxes.push({ min: [-38, 0, 26], max: [-24, 4, 38], kind: 'platform' });
  boxes.push({ min: [24, 0, 26], max: [38, 4, 38], kind: 'platform' });
  ramps.push({ x0: -36, x1: -32, z0: 15, z1: 26, axis: 'z', hMin: 0, hMax: 4 });
  ramps.push({ x0: 32, x1: 36, z0: 15, z1: 26, axis: 'z', hMin: 0, hMax: 4 });

  // Machinery banks against walls (cover + visual interest)
  boxes.push({ min: [-43, 0, -14], max: [-38, 3.2, -6], kind: 'machine' });
  boxes.push({ min: [38, 0, 6], max: [43, 3.2, 14], kind: 'machine' });
  boxes.push({ min: [-22, 0, -43], max: [-12, 2.4, -39], kind: 'machine' });
  // Grapple relays flank the approaches to the four existing ramp decks.
  boxes.push({ min: [-18.0, 0, -19.5], max: [-15.5, 8.8, -17.0], kind: 'relay' });
  boxes.push({ min: [15.5, 0, -16.5], max: [18, 10.2, -14], kind: 'relay' });
  boxes.push({ min: [-24.5, 0, 19], max: [-22, 10.5, 21.5], kind: 'relay' });
  boxes.push({ min: [20, 0, 19.0], max: [22.5, 9.4, 21.5], kind: 'relay' });

  // Reactor collision (approximated by a box slightly inside the visual radius)
  const reactor = { x: 0, z: 0, radius: 3.4, height: 7 };
  boxes.push({ min: [-2.6, 0, -2.6], max: [2.6, reactor.height, 2.6], kind: 'reactor' });

  // Enemy lanes: spawn deep inside the tunnel, bend around the partition, end at the reactor ring.
  const northPts: Vec2[] = [
    { x: 0, z: H + TUNNEL_LEN - 3 },
    { x: 0, z: 34 },
    { x: 10, z: 27 },
    { x: 10, z: 14 },
    { x: 3.6, z: 5.8 },
  ];
  const routes: Record<GateId, Route> = {
    north: { gate: 'north', points: northPts.map(rotN) },
    east: { gate: 'east', points: northPts.map(rotE) },
    west: { gate: 'west', points: northPts.map(rotW) },
    south: { gate: 'south', points: northPts.map(rotS) },
  };
  const barriers: Box[] = [
    { min: [-12.2, 0, -6.5], max: [-10.6, 3.4, 2.5], kind: 'block' },
    { min: [10.6, 0, -2.5], max: [12.2, 3.4, 6.5], kind: 'block' },
  ];
  const reserved = barriers.map((b) => ({ x0: b.min[0] - 0.4, z0: b.min[2] - 0.4, x1: b.max[0] + 0.4, z1: b.max[2] + 0.4, label: 'Reserved: containment bulkhead' }));

  return {
    half: HALF,
    wallHeight: WALL_H,
    boxes,
    ramps,
    routes,
    reactor,
    playerSpawn: { x: -3.8, z: -20, yaw: 0.30 },
    laneHalfWidth: 2.8,
    initialGates: ['north', 'east', 'west'],
    southDoor: southDoorBox(H),
    reserved,
    barriers,
    vents: [
      { x: 10, z: 20, r: 3.2 },
      { x: 20, z: -10, r: 3.2 },
      { x: -20, z: 10, r: 3.2 },
      { x: 10, z: -20, r: 3.2 },
    ],
  };
}

export const ARENA: ArenaLayout = buildLayout();
export const GATES: GateId[] = ['north', 'east', 'west', 'south'];
