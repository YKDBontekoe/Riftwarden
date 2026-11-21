import { mulberry32 } from '../combat/damage';
import { ACT_BOSSES, ANOMALY_IDS, isCombatKind, type NodeKind } from '../runmap/defs';
import { h32, type MapNode, rollMods } from '../runmap/map';
import { BIOME_IDS, BIOMES, type BiomeId, biomeForSeed } from '../world/biomes';

/**
 * Rift War regions (pure). The war is an endless chain of regions on a globe; each region is a free network of
 * 10-13 sector nodes (any node can be played and replayed): a landing zone, a capital (the region boss, a
 * stronghold until the region is 60% liberated), a rift source (corrupted from the start) and weighted sectors and
 * hubs. Links are a minimum spanning tree plus short non-crossing extras; a region's landing links to the previous
 * region's capital. Everything is derived from (war seed, region index), so only the live war state is stored.
 */

export interface RegionDef {
  k: number;
  name: string;
  biome: BiomeId;
  faction: string;
  /** Globe position of the region centre (degrees). */
  lat: number;
  lon: number;
  nodes: MapNode[];
  landing: string;
  capital: string;
  rift: string;
}

const SUFFIX = ['Reach', 'Expanse', 'Frontier', 'Basin', 'March', 'Wastes', 'Belt', 'Verge', 'Hollow', 'Divide'];

const KIND_WEIGHTS: [NodeKind, number][] = [
  ['combat', 40],
  ['elite', 14],
  ['event', 12],
  ['merchant', 7],
  ['vault', 7],
  ['forge', 6],
  ['rest', 6],
];

function pick<T>(pool: [T, number][], r: () => number): T {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of pool) {
    x -= w;
    if (x < 0) return k;
  }
  return pool[pool.length - 1][0];
}

/** Region node id ("r3n7"). */
export const regionNodeId = (k: number, i: number): string => `r${k}n${i}`;

/** Parse a region node id. */
export function parseRegionId(id: string): { k: number; i: number } | null {
  const m = /^r(\d{1,5})n(\d{1,2})$/.exec(id);
  return m ? { k: Number(m[1]), i: Number(m[2]) } : null;
}

/** Arena seed for a node whose generated sector has the region's biome (coherent territories on the globe). */
function seedForBiome(seed: number, k: number, i: number, biome: BiomeId): number {
  for (let a = 0; a < 64; a++) {
    const s = h32(seed >>> 0, k * 256 + i, 0x5e00 + a) || 1;
    if (biomeForSeed(s) === biome) return s;
  }
  return h32(seed >>> 0, k * 256 + i, 0x5e00) || 1;
}

/** Do segments ab and cd properly cross? */
function crosses(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function regionLayout(seed: number, k: number): RegionDef {
  k = Math.max(0, Math.floor(k));
  const key = `${seed >>> 0}:${k}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = mulberry32(h32(seed >>> 0, k, 0x9e61));
  const biome = BIOME_IDS[(h32(seed >>> 0, k, 0xb10) >>> 3) % BIOME_IDS.length];
  const words = BIOMES[biome].words;
  const name = `${words[Math.floor(r() * words.length) % words.length]} ${SUFFIX[Math.floor(r() * SUFFIX.length) % SUFFIX.length]}`;
  // Globe: a golden-angle spiral, so consecutive regions sit near each other but never overlap.
  const lon = ((k * 137.508) % 360) - 180;
  const lat = (((k * 0.6180339) % 1) * 2 - 1) * 55;
  // Positions: landing on the west edge, capital on the east edge, the rest rejection-sampled.
  const n = 10 + Math.floor(r() * 4);
  const pts: [number, number][] = [
    [0.08 + r() * 0.05, 0.3 + r() * 0.4],
    [0.87 + r() * 0.05, 0.3 + r() * 0.4],
  ];
  for (let guard = 0; pts.length < n && guard < 4000; guard++) {
    const p: [number, number] = [0.1 + r() * 0.8, 0.08 + r() * 0.84];
    if (pts.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.17)) pts.push(p);
  }
  // Links: minimum spanning tree (Kruskal) + short extras that never cross an existing link (max degree 4).
  const edges: [number, number, number][] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) edges.push([Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]), i, j]);
  edges.sort((a, b) => a[0] - b[0]);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links: [number, number][] = [];
  const deg = pts.map(() => 0);
  const clear = (i: number, j: number) => links.every(([a, b]) => a === i || a === j || b === i || b === j || !crosses(pts[i], pts[j], pts[a], pts[b]));
  for (const [, i, j] of edges) {
    if (find(i) === find(j)) continue;
    parent[find(i)] = find(j);
    links.push([i, j]);
    deg[i]++;
    deg[j]++;
  }
  for (const [d, i, j] of edges) {
    if (d > 0.34 || deg[i] >= 4 || deg[j] >= 4 || links.some(([a, b]) => (a === i && b === j) || (a === j && b === i)) || !clear(i, j)) continue;
    if (r() < 0.7) {
      links.push([i, j]);
      deg[i]++;
      deg[j]++;
    }
  }
  // Hops from the landing (difficulty and modifiers grow with depth).
  const adj = pts.map(() => [] as number[]);
  for (const [a, b] of links) (adj[a].push(b), adj[b].push(a));
  const hops = pts.map(() => Infinity);
  hops[0] = 0;
  const q = [0];
  while (q.length) {
    const i = q.shift()!;
    for (const j of adj[i]) if (hops[j] === Infinity) (hops[j] = hops[i] + 1), q.push(j);
  }
  // Rift source: the node farthest from the landing that is not the capital.
  let rift = 2;
  for (let i = 2; i < pts.length; i++) if (hops[i] > hops[rift] || (hops[i] === hops[rift] && pts[i][1] < pts[rift][1])) rift = i;
  const kinds: NodeKind[] = pts.map((_, i) => (i === 0 || i === rift ? 'combat' : i === 1 ? 'boss' : pick(KIND_WEIGHTS, r)));
  // Every region offers a safe harbour and a merchant.
  for (const need of ['rest', 'merchant'] as NodeKind[]) {
    if (kinds.includes(need)) continue;
    const free = kinds.map((kd, i) => (i > 1 && i !== rift && kd === 'combat' ? i : -1)).filter((i) => i >= 0);
    const at = free.length ? free[Math.floor(r() * free.length) % free.length] : -1;
    if (at >= 0) kinds[at] = need;
  }
  const nodes: MapNode[] = pts.map(([x, y], i) => {
    const kind = kinds[i];
    const nodeSeed = seedForBiome(seed, k, i, biome);
    const ids = adj[i].map((j) => regionNodeId(k, j));
    return {
      id: regionNodeId(k, i),
      act: k + 1,
      row: hops[i],
      col: i,
      x,
      y,
      kind,
      actBoss: i === 1,
      seed: nodeSeed,
      biome,
      mods: isCombatKind(kind) && i !== 0 ? rollMods(kind, k + 1, Math.min(4, hops[i]), r) : [],
      anomaly: kind === 'event' ? ANOMALY_IDS[Math.floor(r() * ANOMALY_IDS.length) % ANOMALY_IDS.length] : null,
      boss: kind === 'boss' ? ACT_BOSSES[k % ACT_BOSSES.length] : null,
      links: ids,
      region: name,
      lat: lat + (y - 0.5) * 22,
      lon: lon + (x - 0.5) * 30,
    };
  });
  // Cross-region link: this landing <-> the previous region's capital.
  if (k > 0) nodes[0].links.push(regionNodeId(k - 1, 1));
  const out: RegionDef = { k, name, biome, faction: BIOMES[biome].faction.name, lat, lon, nodes, landing: nodes[0].id, capital: nodes[1].id, rift: nodes[rift].id };
  if (cache.size > 128) cache.clear();
  cache.set(key, out);
  return out;
}
const cache = new Map<string, RegionDef>();

/** Static node of any region (links to the next region's landing are added for capitals). */
export function regionNode(seed: number, id: string): MapNode | null {
  const p = parseRegionId(id);
  if (!p) return null;
  const n = regionLayout(seed, p.k).nodes[p.i];
  if (!n) return null;
  // A capital also leads to the next region's landing.
  if (p.i === 1) return { ...n, links: [...n.links, regionNodeId(p.k + 1, 0)] };
  return n;
}
