/**
 * Pure waypoint graph for ambient HQ drones: room centres joined through doorway midpoints,
 * plus one hover point per station. Drones fly above the floor plan, so only room/portal
 * connectivity matters (no per-cell obstacle data).
 */
export interface NavRoom {
  id: string;
  min: readonly [number, number];
  max: readonly [number, number];
}
export interface NavPortal {
  axis: 'x' | 'z';
  c: number;
  a: number;
  b: number;
}
export interface NavStation {
  id: string;
  focus: readonly [number, number, number];
}
export interface NavNode {
  id: string;
  x: number;
  z: number;
  kind: 'room' | 'portal' | 'station';
}
export interface NavGraph {
  nodes: NavNode[];
  adj: number[][];
}

const EPS = 0.05;
const inRoom = (r: NavRoom, x: number, z: number, pad = 0): boolean => x >= r.min[0] - pad && x <= r.max[0] + pad && z >= r.min[1] - pad && z <= r.max[1] + pad;

export function buildNav(rooms: readonly NavRoom[], portals: readonly NavPortal[], stations: readonly NavStation[]): NavGraph {
  const nodes: NavNode[] = [];
  const adj: number[][] = [];
  const add = (n: NavNode): number => {
    nodes.push(n);
    adj.push([]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number): void => {
    if (a === b || adj[a].includes(b)) return;
    adj[a].push(b);
    adj[b].push(a);
  };
  const roomNode = new Map<string, number>();
  for (const r of rooms) roomNode.set(r.id, add({ id: `room:${r.id}`, x: (r.min[0] + r.max[0]) / 2, z: (r.min[1] + r.max[1]) / 2, kind: 'room' }));

  portals.forEach((p, i) => {
    const mid = (p.a + p.b) / 2;
    const x = p.axis === 'x' ? p.c : mid;
    const z = p.axis === 'x' ? mid : p.c;
    const n = add({ id: `portal:${i}`, x, z, kind: 'portal' });
    // Rooms whose boundary this doorway sits on.
    for (const r of rooms) if (inRoom(r, x, z, EPS)) link(n, roomNode.get(r.id)!);
  });

  for (const s of stations) {
    const x = s.focus[0];
    const z = s.focus[2];
    const n = add({ id: `station:${s.id}`, x, z, kind: 'station' });
    const room = rooms.find((r) => inRoom(r, x, z));
    if (room) link(n, roomNode.get(room.id)!);
  }
  return { nodes, adj };
}

/** Index of the node closest to (x, z), optionally restricted to a kind. */
export function nearestNode(g: NavGraph, x: number, z: number, kind?: NavNode['kind']): number {
  let best = -1;
  let bd = Infinity;
  g.nodes.forEach((n, i) => {
    if (kind && n.kind !== kind) return;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Shortest path (Dijkstra by distance) as node indices including both ends; [] when unreachable. */
export function findPath(g: NavGraph, from: number, to: number): number[] {
  if (from === to) return [from];
  const dist = new Array<number>(g.nodes.length).fill(Infinity);
  const prev = new Array<number>(g.nodes.length).fill(-1);
  const done = new Array<boolean>(g.nodes.length).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) return [];
    if (u === to) break;
    done[u] = true;
    for (const v of g.adj[u]) {
      const d = dist[u] + Math.hypot(g.nodes[u].x - g.nodes[v].x, g.nodes[u].z - g.nodes[v].z);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const path: number[] = [];
  for (let n = to; n >= 0; n = prev[n]) path.push(n);
  return path.reverse();
}
