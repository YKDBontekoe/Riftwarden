import { mulberry32 } from '../combat/damage';
import { BIOMES, type BiomeId, biomeForSeed } from '../world/biomes';
import { sectorName } from '../world/arenaGen';
import type { BossId } from '../survival/bosses';
import type { ThreatTier } from '../progression/tiers';
import {
  ACT_BOSSES,
  ANOMALY_IDS,
  type AnomalyId,
  isCombatKind,
  KIND_EFFECT,
  ROLLED_MOD_IDS,
  NODE_MODS,
  type NodeEffect,
  type NodeKind,
  type NodeModId,
} from './defs';

/**
 * Branching run map (pure). A run is an endless series of acts; each act is ROWS rows of nodes
 * joined by non-crossing links (row 0 = entry sectors, the last row = the act boss). Everything is
 * derived from (map seed, act), so the map is never stored: saves keep the seed and the path.
 */

export const ROWS = 7;
/** Waves per combat node (one checkpoint segment). */
export const SEGMENT = 5;

export interface MapNode {
  id: string;
  act: number;
  row: number;
  /** Index within its row (left to right). */
  col: number;
  /** Horizontal position 0..1 (layout). */
  x: number;
  kind: NodeKind;
  /** Final node of the act. */
  actBoss: boolean;
  /** Arena seed of the node's sector (never 0). */
  seed: number;
  biome: BiomeId;
  mods: NodeModId[];
  /** Anomaly shown at an event node. */
  anomaly: AnomalyId | null;
  /** Boss that commands the last wave (boss nodes). */
  boss: BossId | null;
  /** Ids of the nodes in the next row this node leads to (none on the last row). */
  links: string[];
  // ---- war regions (free networks on the globe)
  /** Vertical position 0..1 on the region map. */
  y?: number;
  /** Region name. */
  region?: string;
  /** Globe position (degrees). */
  lat?: number;
  lon?: number;
}

export interface ActMap {
  act: number;
  seed: number;
  rows: MapNode[][];
}

export function h32(a: number, b: number, c = 0): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (c + 0x165667b1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Map seed for a run (independent of the upgrade, planner and arena seeds). */
export const mapSeedFor = (runSeed: number): number => (h32(runSeed >>> 0, 0x6d61) || 1) >>> 0;

const ROW_KINDS: [NodeKind, number][] = [
  ['combat', 44],
  ['elite', 14],
  ['event', 14],
  ['merchant', 8],
  ['vault', 7],
  ['forge', 6],
  ['rest', 5],
  ['boss', 4],
];
const CAMP_KINDS: [NodeKind, number][] = [
  ['rest', 5],
  ['merchant', 3],
  ['forge', 2],
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

/** Row widths: 2-3 entry sectors, 2-4 in the middle, 1-3 camps before the boss, 1 boss. */
function rowWidth(row: number, r: () => number): number {
  if (row === ROWS - 1) return 1;
  if (row === 0) return 2 + Math.floor(r() * 2);
  if (row === ROWS - 2) return 2 + Math.floor(r() * 2);
  return 2 + Math.floor(r() * 3);
}

/**
 * Links between two rows as a monotone staircase: every node of both rows gets at least one link and no two
 * links cross (the map stays readable and every node is reachable).
 */
export function staircase(a: number, b: number, r: () => number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  let i = 0;
  let j = 0;
  while (i < a - 1 || j < b - 1) {
    const ci = i < a - 1;
    const cj = j < b - 1;
    const x = r();
    if (ci && cj) {
      if (x < 0.4) (i++, j++);
      else if (x < 0.7) i++;
      else j++;
    } else if (ci) i++;
    else j++;
    out.push([i, j]);
  }
  return out;
}

/** Node modifiers: combat kinds only, more and nastier with depth. */
export function rollMods(kind: NodeKind, act: number, row: number, r: () => number): NodeModId[] {
  if (!isCombatKind(kind) || row === 0 && act === 1) return [];
  const chance = Math.min(0.85, 0.22 + 0.06 * row + 0.12 * (act - 1));
  const out: NodeModId[] = [];
  const max = act >= 3 ? 2 : 1;
  for (let k = 0; k < max; k++) {
    if (r() >= chance * (k ? 0.5 : 1)) break;
    const pool = ROLLED_MOD_IDS.filter((m) => !out.includes(m) && (!NODE_MODS[m].kinds || NODE_MODS[m].kinds!.includes(kind)));
    // Two forced events never stack.
    const filtered = out.some((m) => NODE_MODS[m].effect.event) ? pool.filter((m) => !NODE_MODS[m].effect.event) : pool;
    if (!filtered.length) break;
    out.push(filtered[Math.floor(r() * filtered.length) % filtered.length]);
  }
  return out;
}

/** Generate act `act` (1-based) of a map. Pure and memoised. */
export function generateAct(mapSeed: number, act: number): ActMap {
  act = Math.max(1, Math.floor(act));
  const key = `${mapSeed >>> 0}:${act}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = mulberry32(h32(mapSeed >>> 0, act, 0xac7));
  const rows: MapNode[][] = [];
  let midBoss = false;
  for (let row = 0; row < ROWS; row++) {
    const n = rowWidth(row, r);
    const nodes: MapNode[] = [];
    for (let col = 0; col < n; col++) {
      const seed = h32(mapSeed >>> 0, act * 64 + row * 8 + col, 0x5ec7) || 1;
      let kind: NodeKind;
      if (row === 0) kind = 'combat';
      else if (row === ROWS - 1) kind = 'boss';
      else if (row === ROWS - 2) kind = col === 0 ? 'rest' : pick(CAMP_KINDS, r);
      else {
        kind = pick(ROW_KINDS, r);
        // Elites from row 2, at most one mid-act boss (from row 3), rests from row 3.
        if (kind === 'elite' && row < 2) kind = 'combat';
        if (kind === 'boss' && (row < 3 || midBoss)) kind = 'elite';
        if (kind === 'rest' && row < 3) kind = 'event';
        if (kind === 'boss') midBoss = true;
      }
      const biome = biomeForSeed(seed);
      const actBoss = row === ROWS - 1;
      nodes.push({
        id: `a${act}r${row}c${col}`,
        act,
        row,
        col,
        x: n === 1 ? 0.5 : 0.12 + (0.76 * col) / (n - 1) + (r() - 0.5) * 0.06,
        kind,
        actBoss,
        seed,
        biome,
        mods: rollMods(kind, act, row, r),
        anomaly: kind === 'event' ? ANOMALY_IDS[Math.floor(r() * ANOMALY_IDS.length) % ANOMALY_IDS.length] : null,
        boss: kind === 'boss' ? (actBoss ? ACT_BOSSES[(act - 1) % ACT_BOSSES.length] : ACT_BOSSES[act % ACT_BOSSES.length]) : null,
        links: [],
      });
    }
    // No row may be all hubs except the camp row: the middle of an act always offers a fight.
    if (row > 0 && row < ROWS - 2 && !nodes.some((q) => isCombatKind(q.kind))) nodes[Math.floor(r() * nodes.length) % nodes.length].kind = 'combat';
    for (const q of nodes) if (!isCombatKind(q.kind)) (q.mods = []), (q.boss = null);
    for (const q of nodes) if (q.kind !== 'event') q.anomaly = null;
    for (const q of nodes) if (q.kind === 'event' && !q.anomaly) q.anomaly = ANOMALY_IDS[q.seed % ANOMALY_IDS.length];
    rows.push(nodes);
  }
  for (let row = 0; row < ROWS - 1; row++) {
    const a = rows[row];
    const b = rows[row + 1];
    for (const [i, j] of staircase(a.length, b.length, r)) if (!a[i].links.includes(b[j].id)) a[i].links.push(b[j].id);
  }
  const out = { act, seed: mapSeed >>> 0, rows };
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}
const cache = new Map<string, ActMap>();

export function nodeById(map: ActMap, id: string): MapNode | null {
  for (const row of map.rows) for (const n of row) if (n.id === id) return n;
  return null;
}

/** Parse the act out of a node id ("a3r2c1" -> 3). */
export function actOf(id: string): number {
  const m = /^a(\d+)r(\d+)c(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** Find a node of any act of a map by id. */
export function findNode(mapSeed: number, id: string): MapNode | null {
  const act = actOf(id);
  return act ? nodeById(generateAct(mapSeed, act), id) : null;
}

/**
 * Nodes the run can travel to next: the current node's links, or (after an act boss, or before the first
 * node) the entry row of the next act.
 */
export function reachable(mapSeed: number, current: string | null): MapNode[] {
  if (!current) return generateAct(mapSeed, 1).rows[0];
  const node = findNode(mapSeed, current);
  if (!node) return [];
  if (node.actBoss) return generateAct(mapSeed, node.act + 1).rows[0];
  const map = generateAct(mapSeed, node.act);
  return node.links.map((id) => nodeById(map, id)).filter((n): n is MapNode => !!n);
}

/** Combined segment effect of a node (kind + modifiers + act effects), multiplicative. */
export function combineEffects(...effects: (NodeEffect | undefined)[]): Required<Omit<NodeEffect, 'event'>> & { event: NodeEffect['event'] | null } {
  const out = { hp: 1, damage: 1, speed: 1, elite: 1, budget: 1, luck: 1, drops: 1, income: 1, cores: 1, shards: 0, noTowers: false, event: null as NodeEffect['event'] | null };
  for (const e of effects) {
    if (!e) continue;
    for (const k of ['hp', 'damage', 'speed', 'elite', 'budget', 'luck', 'drops', 'income', 'cores'] as const) if (e[k] !== undefined) out[k] *= e[k]!;
    out.shards += e.shards ?? 0;
    if (e.noTowers) out.noTowers = true;
    if (e.event && !out.event) out.event = e.event;
  }
  return out;
}
export type SegmentEffect = ReturnType<typeof combineEffects>;

/** Every act after the first is harder (on top of the global wave count) and luckier. */
export function actEffect(act: number): NodeEffect {
  const k = Math.max(0, Math.min(1000, act - 1));
  return { hp: 1 + 0.08 * k, damage: 1 + 0.05 * k, luck: 1 + 0.1 * k };
}

export function nodeEffect(node: MapNode, extra: (NodeEffect | undefined)[] = []): SegmentEffect {
  return combineEffects(actEffect(node.act), KIND_EFFECT[node.kind], ...node.mods.map((m) => NODE_MODS[m].effect), ...extra);
}

/** Display info for the map card (sector name/code, faction). */
export function nodeInfo(node: MapNode): { name: string; code: string; faction: string; factionId: string } {
  const s = sectorName(node.seed);
  const f = BIOMES[node.biome].faction;
  return { name: s.name, code: s.code, faction: f.name, factionId: f.id };
}

/** Waves a combat node covers when entered after `lastCleared` waves. */
export function segmentWaves(lastCleared: number): [number, number] {
  return [lastCleared + 1, lastCleared + SEGMENT];
}

/** Compact path code for history (e.g. "1C 1E 1M 1B*"). */
export function pathCode(ids: readonly string[], mapSeed: number): string[] {
  const letter: Record<NodeKind, string> = { combat: 'C', elite: 'E', boss: 'B', merchant: 'M', forge: 'F', event: '?', vault: 'V', rest: 'R' };
  return ids.map((id) => {
    const n = findNode(mapSeed, id);
    return n ? `${n.act}${letter[n.kind]}${n.actBoss ? '*' : ''}` : '';
  }).filter(Boolean);
}

/**
 * The threat tier a combat segment plays at: the node's effect folded into the tier's multipliers, so the planner,
 * spawns, loot rolls and income formulas pick it up without knowing about the map. The id (records, unlocks) is kept.
 */
export function segmentTier(t: ThreatTier, e: SegmentEffect): ThreatTier {
  return {
    ...t,
    hpMult: t.hpMult * e.hp,
    damageMult: t.damageMult * e.damage,
    speedMult: t.speedMult * e.speed,
    eliteRate: t.eliteRate * e.elite,
    budgetMult: t.budgetMult * e.budget,
    lootLuck: t.lootLuck * e.luck,
    salvageMult: t.salvageMult * e.income,
  };
}
