import { ENEMIES, type EnemyKind } from '../data/defs';
import { RUN_INCOME } from '../economy/config';
import { ECONOMY } from '../data/defs';
import { DROP_SOURCES } from '../loot/drops';
import type { ThreatTier } from '../progression/tiers';
import { BOSSES } from '../survival/bosses';
import { EVENTS } from '../survival/events';
import { bossMults, SurvivalPlanner } from '../survival/plan';
import { BIOMES } from '../world/biomes';
import { actEffects, type RunCarry } from './carry';
import { ANOMALIES, FORGE, FORGE_IDS, isCombatKind, MODE_EFFECT, type NodeKind, type RunMode, SERVICES, SERVICE_IDS } from './defs';
import { forgePrice, GUARDIAN, merchantStock } from './hub';
import { type MapNode, nodeEffect, type SegmentEffect, segmentTier, SEGMENT } from './map';
import { findNode } from '../war/world';
import { regionLayout } from '../war/regions';

/**
 * Node intel for the run map (pure): the real expected roster of a combat node (the same planner the arena runs,
 * with the node's segment rules and effective tier), its reward breakdown, and a route lookahead (what the node
 * leads to before the act boss). Memoised per (planner seed, node, wave, tier, mode, act effects).
 */

export interface RosterLine {
  kind: EnemyKind;
  name: string;
  count: number;
  elites: number;
  /** Faction signature archetype. */
  signature: boolean;
}

export interface NodeIntel {
  /** Combat nodes only. */
  roster: RosterLine[];
  hostiles: number;
  elites: number;
  boss: string | null;
  events: string[];
  /** Sum of hostile hit points (incl. shields, boss scaling) over the segment. */
  totalHp: number;
  /** The strongest single hostile's hit points. */
  peakHp: number;
  /** Seconds of sustained fire at `dps` to clear the segment (null without a firepower figure). */
  fireSeconds: number | null;
  /** 1..5 rating vs the run's firepower (or vs the segment before when unknown). */
  threat: number;
  /** Multipliers versus a plain node at the same depth (1 = unchanged). */
  effect: SegmentEffect;
  rewards: RewardLine[];
  faction: string;
  signature: string[];
}

export interface RewardLine {
  label: string;
  value: string;
  /** Highlight (bonus from the node or a modifier). */
  bonus?: boolean;
}

export interface IntelContext {
  plannerSeed: number;
  tier: ThreatTier;
  mode: RunMode;
  /** Last cleared wave (the node starts at +1). */
  lastWave: number;
  act: Pick<RunCarry, 'curses' | 'blessings'>;
  /** Sustained weapon DPS of the current loadout (0 = unknown). */
  dps: number;
}

const cache = new Map<string, NodeIntel>();

const pct = (x: number): string => `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`;

export function nodeIntel(node: MapNode, ctx: IntelContext): NodeIntel {
  const key = `${ctx.plannerSeed}|${node.id}|${node.kind}|${node.mods.join()}|${ctx.lastWave}|${ctx.tier.id}|${ctx.mode}|${ctx.act.curses.join()}|${ctx.act.blessings.join()}|${Math.round(ctx.dps)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const effect = nodeEffect(node, [...actEffects(ctx.act), MODE_EFFECT[ctx.mode]]);
  const tier = segmentTier(ctx.tier, effect);
  const faction = BIOMES[node.biome].faction;
  const signature = Object.keys(faction.extra) as EnemyKind[];
  const out: NodeIntel = { roster: [], hostiles: 0, elites: 0, boss: null, events: [], totalHp: 0, peakHp: 0, fireSeconds: null, threat: 1, effect, rewards: [], faction: faction.name, signature: signature.map((k) => ENEMIES[k]?.name ?? k) };
  const from = ctx.lastWave + 1;
  const to = ctx.lastWave + SEGMENT;
  if (isCombatKind(node.kind)) {
    const planner = new SurvivalPlanner(ctx.plannerSeed, tier, faction);
    planner.setSegment({ from, to, boss: node.boss, event: effect.event ?? null, cores: effect.cores });
    const lines = new Map<EnemyKind, RosterLine>();
    for (let n = from; n <= to; n++) {
      const w = planner.compose(n);
      if (w.plan?.event) out.events.push(EVENTS[w.plan.event].name);
      for (const s of w.spawns) {
        const def = ENEMIES[s.kind];
        let hp = (def.hp + def.shield) * w.hpMult * (s.hpMult ?? 1);
        if (s.tag === 'boss') {
          hp *= bossMults(s.encounter ?? 1, tier).hp;
          out.boss = node.boss ? BOSSES[node.boss].name : def.name;
        }
        out.totalHp += hp;
        out.peakHp = Math.max(out.peakHp, hp);
        out.hostiles++;
        const line = lines.get(s.kind) ?? { kind: s.kind, name: def.name, count: 0, elites: 0, signature: signature.includes(s.kind) };
        line.count++;
        if (s.mods?.length) {
          line.elites++;
          out.elites++;
        }
        lines.set(s.kind, line);
      }
    }
    out.roster = [...lines.values()].sort((a, b) => b.count - a.count);
    if (ctx.dps > 0) out.fireSeconds = out.totalHp / ctx.dps;
    // Threat: seconds of fire per wave against the five-wave tempo (~30 s a wave): 1 easy .. 5 brutal.
    const perWave = out.fireSeconds !== null ? out.fireSeconds / SEGMENT : out.totalHp / SEGMENT / 2400;
    out.threat = Math.max(1, Math.min(5, Math.round(ctx.dps > 0 ? perWave / 6 : perWave)));
    out.rewards = combatRewards(node, ctx, tier, effect, from, to);
  } else out.rewards = hubRewards(node, from);
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

function combatRewards(node: MapNode, ctx: IntelContext, tier: ThreatTier, e: SegmentEffect, from: number, to: number): RewardLine[] {
  let credits = 0;
  let salvage = 0;
  let cores = 0;
  for (let n = from; n <= to; n++) {
    credits += Math.round(RUN_INCOME.waveCredits(n) * tier.salvageMult);
    salvage += Math.round((ECONOMY.salvageWaveBase + n * ECONOMY.salvagePerWave) * tier.salvageMult);
    cores += Math.round((60 + Math.min(n, 2000) * 15) * e.cores);
  }
  credits += Math.round(RUN_INCOME.checkpointCredits(to) * tier.salvageMult);
  const comps = RUN_INCOME.checkpointComponents(to, ctx.tier.id);
  const shards = RUN_INCOME.checkpointShards(to, ctx.tier.id) + e.shards + (node.actBoss ? 3 : 0);
  const out: RewardLine[] = [
    { label: 'Wave clears + checkpoint', value: `${credits} cr · ${salvage} salvage · ${comps} comp` },
    { label: 'Cores (wave clears)', value: `${cores}${e.cores !== 1 ? ` (${pct(e.cores)})` : ''}`, bonus: e.cores > 1 },
    { label: 'Checkpoint cache', value: `${DROP_SOURCES.checkpoint.rolls}× rare+ item` },
  ];
  if (shards > 0) out.push({ label: 'Rift shards', value: String(shards), bonus: e.shards > 0 || node.actBoss });
  if (node.kind === 'elite') out.push({ label: 'Elite cache', value: `${DROP_SOURCES.eliteCache.rolls}× rare+ item`, bonus: true });
  if (node.kind === 'boss') out.push({ label: 'Boss loot', value: `${DROP_SOURCES.boss.rolls}× epic+ · ~6% unique`, bonus: true });
  if (node.actBoss) out.push({ label: 'Act chest', value: '3 items (one epic+) · curses lifted', bonus: true });
  if (e.income !== 1) out.push({ label: 'Income', value: pct(e.income), bonus: e.income > 1 });
  if (e.luck !== 1) out.push({ label: 'Loot luck', value: pct(e.luck), bonus: e.luck > 1 });
  if (e.drops !== 1) out.push({ label: 'Drop chance', value: pct(e.drops), bonus: e.drops > 1 });
  return out;
}

function hubRewards(node: MapNode, from: number): RewardLine[] {
  switch (node.kind as NodeKind) {
    case 'merchant': {
      const s = merchantStock(node.seed, from);
      const prices = s.items.map((i) => i.price);
      return [
        { label: 'Stock', value: s.items.map((i) => `${i.rarity} ${i.category}`).join(' · ') },
        { label: 'Item prices', value: `${Math.min(...prices)}–${Math.max(...prices)} cores` },
        ...SERVICE_IDS.map((id) => ({ label: SERVICES[id].name, value: `${s.services[id]} cores` })),
      ];
    }
    case 'forge':
      return FORGE_IDS.map((id) => ({ label: FORGE[id].name, value: `${FORGE[id].text.replace(' for this run', '')} · from ${forgePrice(id, from, 0)} cores` }));
    case 'rest':
      return [{ label: 'Choose one', value: 'Repair · free upgrade pick · purge a curse' }];
    case 'vault':
      return [
        { label: 'Guardians', value: `the next wave's roster at x${GUARDIAN.budget} HP` },
        { label: 'Vault cache', value: `${DROP_SOURCES.eliteCache.rolls}× rare+ · ${GUARDIAN.cacheShards} shards · ${GUARDIAN.credits(from)} cr`, bonus: true },
      ];
    case 'event': {
      const a = ANOMALIES[node.anomaly ?? 'siphon'];
      return [{ label: a.name, value: a.choices.filter((c) => c.id !== 'leave').map((c) => c.label).join(' · ') }];
    }
  }
  return [];
}

/** Route lookahead on the war map: what lies within two links, and how far the region capital is. */
export interface Lookahead {
  /** The node and every node within two links (any unlocked region). */
  reach: string[];
  /** Links to the region capital (0 = this is the capital). */
  hopsToCapital: number;
  /** Nodes of each kind within two links (excluding this one). */
  kinds: Partial<Record<NodeKind, number>>;
  /** A merchant / forge / safe harbour within two links. */
  canShop: boolean;
  canRest: boolean;
}

export function lookahead(seed: number, node: MapNode, open: (id: string) => boolean = () => true): Lookahead {
  const dist = new Map<string, number>([[node.id, 0]]);
  const q = [node.id];
  while (q.length) {
    const id = q.shift()!;
    const d = dist.get(id)!;
    if (d >= 2) continue;
    for (const l of findNode(seed, id)?.links ?? []) if (!dist.has(l) && open(l)) (dist.set(l, d + 1), q.push(l));
  }
  const kinds: Partial<Record<NodeKind, number>> = {};
  for (const id of dist.keys()) {
    if (id === node.id) continue;
    const k = findNode(seed, id)?.kind;
    if (k) kinds[k] = (kinds[k] ?? 0) + 1;
  }
  // Hops to the region capital (inside the region).
  const capital = regionLayout(seed, node.act - 1).capital;
  const seen = new Map<string, number>([[node.id, 0]]);
  const q2 = [node.id];
  while (q2.length && !seen.has(capital)) {
    const id = q2.shift()!;
    for (const l of findNode(seed, id)?.links ?? []) if (!seen.has(l) && findNode(seed, l)?.act === node.act) (seen.set(l, seen.get(id)! + 1), q2.push(l));
  }
  return { reach: [...dist.keys()], hopsToCapital: seen.get(capital) ?? 0, kinds, canShop: !!(kinds.merchant || kinds.forge), canRest: !!kinds.rest };
}
