import { BIOMES, type BiomeId } from '../world/biomes';
import { sectorName } from '../world/arenaGen';
import type { BossId } from '../survival/bosses';
import type { ThreatTier } from '../progression/tiers';
import {
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
 * Map node rules shared by the Rift War regions (pure): the node shape, modifier rolls, segment effects and the
 * effective tier of a combat segment. Node layouts live in war/regions.ts, the live war in war/state.ts.
 */

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

export function h32(a: number, b: number, c = 0): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (c + 0x165667b1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
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
