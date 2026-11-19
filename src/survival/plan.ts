import { mulberry32 } from '../combat/damage';
import type { EnemyKind } from '../data/defs';
import { getTier, type ThreatTier } from '../progression/tiers';
import { damageMultiplier, expand, type Group, HAND_WAVES, hpMultiplier, type SpawnEntry, type WaveDef } from '../waves/waves';
import { PACE, prepTime } from '../waves/pace';
import type { GateId } from '../world/layout';
import { type BossId, bossScaling } from './bosses';
import { ELITE_MODS, type EliteModId, eliteHpMult, rollMods } from './elites';
import { EVENTS, EVENT_IDS, EVENT_TUNING, type EventId } from './events';

/**
 * M6 survival director (pure, deterministic per seed + tier).
 *
 *  - A run-level schedule fixes when the arena evolves (seeded windows).
 *  - `plan(n)` decides each wave's theme, dynamic event and boss from the history of earlier waves
 *    (cooldowns, time since the last boss, repetition), computed sequentially and memoised, so the same
 *    seed + tier always produce the same sequence, and different seeds produce different ones.
 *  - `compose(n)` turns a plan into spawn entries by spending an encounter budget over eligible enemy
 *    types, elite modifiers and themes, bounded by a spawn cap: beyond it the surplus becomes health,
 *    never more simultaneous entities.
 */

export type ThemeId = 'standard' | 'rush' | 'armor' | 'ranged' | 'support' | 'elite' | 'mixed' | 'siege' | 'jamming' | 'swarm' | 'boss';
export type EvolutionId = 'routes' | 'instability';

export const EVOLUTIONS: Record<EvolutionId, { name: string; warning: string; blurb: string }> = {
  routes: {
    name: 'Secondary Access Route',
    warning: 'SECONDARY ACCESS ROUTE ACTIVATED',
    blurb: 'The south blast door retracts: enemies now also arrive through the southern gate.',
  },
  instability: {
    name: 'Reactor Instability',
    warning: 'REACTOR INSTABILITY · CONTAINMENT MEASURES',
    blurb: 'Plasma vents open on the lanes and containment bulkheads rise beside the reactor. Towers near vents are conduit-fed (+25% fire rate).',
  },
};

/** Encounter cost per enemy (budget units). */
export const ENEMY_COST: Record<EnemyKind, number> = {
  walker: 1,
  rusher: 0.55,
  bulwark: 4,
  enforcer: 4.5,
  artillery: 3.5,
  engineer: 3,
  courier: 0,
  colossus: 0,
  overseer: 0,
  pylon: 0,
  jammer: 2.6,
  crawler: 6.5,
};

/** First wave each archetype can appear (tier `unlockShift` pulls these earlier, never below 4). */
export const ENEMY_UNLOCK: Partial<Record<EnemyKind, number>> = {
  walker: 1,
  rusher: 2,
  bulwark: 4,
  enforcer: 6,
  artillery: 7,
  engineer: 9,
  jammer: 8,
  crawler: 11,
};

interface ThemeDef {
  minWave: number;
  weight: number;
  /** Relative budget share per kind. */
  mix: Partial<Record<EnemyKind, number>>;
  label: string;
}

export const THEMES: Record<Exclude<ThemeId, 'swarm' | 'boss'>, ThemeDef> = {
  standard: { minWave: 4, weight: 3, mix: { walker: 5, rusher: 2, bulwark: 1, enforcer: 0.6, artillery: 0.5, engineer: 0.4 }, label: 'Standard assault' },
  rush: { minWave: 4, weight: 1.2, mix: { rusher: 5, walker: 2, engineer: 0.3 }, label: 'Rush wave' },
  armor: { minWave: 6, weight: 1, mix: { bulwark: 3, enforcer: 3, walker: 2, engineer: 0.8, crawler: 1.2 }, label: 'Heavy armor' },
  ranged: { minWave: 7, weight: 1, mix: { artillery: 3, walker: 3, rusher: 1, enforcer: 0.6, jammer: 0.8 }, label: 'Ranged pressure' },
  support: { minWave: 9, weight: 0.9, mix: { engineer: 2.2, walker: 3, bulwark: 1.5, enforcer: 1 }, label: 'Support-heavy' },
  elite: { minWave: 10, weight: 0.7, mix: { walker: 3, bulwark: 2, enforcer: 1, artillery: 1 }, label: 'Elite invasion' },
  mixed: { minWave: 8, weight: 1.6, mix: { walker: 3, rusher: 2, bulwark: 1, enforcer: 1, artillery: 1, engineer: 0.8, jammer: 0.6, crawler: 0.6 }, label: 'Mixed assault' },
  siege: { minWave: 12, weight: 0.8, mix: { crawler: 3, enforcer: 1, walker: 3, jammer: 1.2 }, label: 'Siege breach' },
  jamming: { minWave: 10, weight: 0.7, mix: { jammer: 2.5, walker: 3, rusher: 2, artillery: 0.8 }, label: 'Electronic warfare' },
};

export const THEME_LABEL: Record<ThemeId, string> = {
  ...Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.label])),
  swarm: 'Swarm invasion',
  boss: 'Boss encounter',
} as Record<ThemeId, string>;

export interface WavePlan {
  wave: number;
  theme: ThemeId;
  event: EventId | null;
  boss: { id: BossId; encounter: number } | null;
  /** Evolution that activates during this wave's preparation phase. */
  evolution: EvolutionId | null;
  /** Evolutions in effect for this wave (cumulative). */
  evolved: EvolutionId[];
  gates: GateId[];
  /** Encounter budget spent by compose(). */
  budget: number;
  /** 0..1 rough encounter intensity (for HUD/diagnostics and event pacing). */
  intensity: number;
  /** HVT reward signal: the equipment category its cache favours (target farming). */
  signal: string | null;
  /** Debug-forced (development tools). */
  forced: boolean;
}

export interface Forced {
  event?: EventId | null;
  boss?: BossId | null;
  evolution?: EvolutionId | null;
}

const SIGNALS = ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'module'];
/** Unlimited waves do not mean unlimited simultaneous entities. */
export const MAX_WAVE_SPAWNS = 120;
const SAFE_WAVE = 1_000_000;

function h32(a: number, b: number, c = 0): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (c + 0x165667b1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function safeWave(n: number): number {
  return Math.max(1, Math.min(SAFE_WAVE, Math.floor(Number.isFinite(n) ? n : 1)));
}

/** Encounter budget for wave n: linear + mild quadratic, tier scaled. */
export function waveBudget(n: number, tier: ThreatTier): number {
  const k = safeWave(n) - 1;
  return (12 + 3.4 * k + 0.035 * k * k) * tier.budgetMult;
}

/** Spawn cap for wave n (entities per wave, not simultaneous). */
export function spawnCap(n: number): number {
  return Math.min(MAX_WAVE_SPAWNS, Math.round(34 + 2.4 * safeWave(n)));
}

/** Chance that an eligible spawn is an elite. */
export function eliteChance(n: number, tier: ThreatTier): number {
  return Math.min(0.4, Math.max(0, safeWave(n) - 5) * 0.011 * tier.eliteRate);
}

/** Maximum modifiers per elite at wave n on this tier. */
export function maxModsFor(n: number, tier: ThreatTier): number {
  const w = safeWave(n) + tier.unlockShift * 3;
  const byWave = w >= 26 ? 3 : w >= 14 ? 2 : 1;
  return Math.min(tier.maxMods, byWave);
}

export function unlockWave(kind: EnemyKind, tier: ThreatTier): number {
  const base = ENEMY_UNLOCK[kind] ?? Infinity;
  return base <= 4 ? base : Math.max(4, base - tier.unlockShift);
}

export class SurvivalPlanner {
  readonly tier: ThreatTier;
  readonly evolutionAt: Record<EvolutionId, number>;
  private plans: WavePlan[] = [];
  private forced = new Map<number, Forced>();
  /** Debug: evolutions activated out of schedule (wave -> id). */
  private extraEvo = new Map<number, EvolutionId>();

  constructor(
    readonly seed: number,
    tier: ThreatTier | number,
  ) {
    this.tier = typeof tier === 'number' ? getTier(tier) : tier;
    const r = mulberry32(h32(seed >>> 0, 0xe501));
    const shift = Math.min(2, this.tier.unlockShift);
    const a = 7 + Math.floor(r() * 4) - shift; // 7..10 (tier shifts earlier)
    const b = a + 6 + Math.floor(r() * 4); // 6..9 waves later
    this.evolutionAt = { routes: a, instability: b };
  }

  /** Development tools: override a future wave. Clears memoised plans from that wave on. */
  force(n: number, f: Forced): void {
    n = safeWave(n);
    this.forced.set(n, { ...this.forced.get(n), ...f });
    this.plans.length = Math.min(this.plans.length, n - 1);
  }

  /** Development tools: activate an evolution right now (from wave n). */
  forceEvolution(n: number, id: EvolutionId): void {
    n = safeWave(n);
    if (this.evolutionAt[id] <= n) return;
    this.evolutionAt[id] = n;
    this.extraEvo.set(n, id);
    this.plans.length = Math.min(this.plans.length, n - 1);
  }

  plan(n: number): WavePlan {
    n = safeWave(n);
    // Plans depend on history: compute sequentially. Very deep jumps are compressed (see below).
    while (this.plans.length < n) {
      const i = this.plans.length + 1;
      if (n - i > 400 && i > 60) {
        // Fast-forward deep jumps (debug high-wave testing): keep history state but skip per-wave work.
        const skip = n - 200;
        const last = this.plans[this.plans.length - 1];
        for (let j = i; j < skip; j++) this.plans.push({ ...last, wave: j, event: null, boss: null, evolution: null });
        continue;
      }
      this.plans.push(this.makePlan(i));
    }
    return this.plans[n - 1];
  }

  private makePlan(n: number): WavePlan {
    const t = this.tier;
    const r = mulberry32(h32(this.seed >>> 0, n, 0x51ab));
    const f = this.forced.get(n);
    const prev = this.plans;
    let evolution: EvolutionId | null = null;
    for (const id of Object.keys(this.evolutionAt) as EvolutionId[]) if (this.evolutionAt[id] === n) evolution = id;
    if (f?.evolution !== undefined) evolution = f.evolution;
    const evolved = (Object.keys(this.evolutionAt) as EvolutionId[]).filter((id) => this.evolutionAt[id] <= n);
    const gates: GateId[] = ['north', 'east', 'west'];
    if (evolved.includes('routes')) gates.push('south');

    // ---- boss
    let boss: WavePlan['boss'] = null;
    const lastBossIdx = findLastIndex(prev, (p) => !!p.boss);
    const lastBoss = lastBossIdx >= 0 ? lastBossIdx + 1 : 0;
    const since = n - Math.max(lastBoss, t.bossFirstWave - 6);
    const minGap = Math.max(4, 7 - Math.floor(n / 25));
    const maxGap = minGap + 4;
    let bossId: BossId | null = null;
    if (f?.boss !== undefined) bossId = f.boss;
    else if (n >= t.bossFirstWave && !evolution && since >= minGap) {
      const p = Math.min(1, (since - minGap + 1) / (maxGap - minGap + 1));
      if (r() < p || n === t.bossFirstWave + 2 && lastBoss === 0) {
        const met = { colossus: 0, overseer: 0 };
        for (const q of prev) if (q.boss) met[q.boss.id]++;
        // Favour the boss met less often; ties are a coin flip (variety between runs).
        const wc = met.colossus <= met.overseer ? 2.4 : 1;
        const wo = met.overseer <= met.colossus ? 2.4 : 1;
        bossId = r() * (wc + wo) < wc ? 'colossus' : 'overseer';
      }
    }
    if (bossId) boss = { id: bossId, encounter: prev.filter((q) => q.boss?.id === bossId).length + 1 };

    // ---- event (never on boss waves, never two waves in a row, per-event repeat gap)
    let event: EventId | null = null;
    if (f?.event !== undefined) event = f.event;
    else if (!boss && n >= 4) {
      const lastEvent = findLastIndex(prev, (p) => !!p.event);
      const gapOk = lastEvent < 0 || n - (lastEvent + 1) >= 2;
      const chance = Math.min(0.6, (0.26 + 0.008 * n) * t.eventRate);
      if (gapOk && r() < chance) {
        const pool = EVENT_IDS.filter((id) => {
          const d = EVENTS[id];
          if (n < Math.max(4, d.minWave - t.unlockShift)) return false;
          const li = findLastIndex(prev, (p) => p.event === id);
          return li < 0 || n - (li + 1) >= d.repeatGap;
        });
        event = weighted(pool, (id) => EVENTS[id].weight, r);
      }
    }

    // ---- theme
    let theme: ThemeId;
    if (boss) theme = 'boss';
    else if (event === 'swarm') theme = 'swarm';
    else if (event === 'eliteAssault') theme = 'elite';
    else {
      const prevTheme = prev[n - 2]?.theme;
      const pool = (Object.keys(THEMES) as (keyof typeof THEMES)[]).filter((k) => n >= Math.max(4, THEMES[k].minWave - t.unlockShift));
      theme = weighted(pool, (k) => THEMES[k].weight * (k === prevTheme && k !== 'standard' ? 0.25 : 1), r) ?? 'standard';
    }
    const signal = event === 'hvt' ? SIGNALS[Math.floor(r() * SIGNALS.length) % SIGNALS.length] : null;
    const budget = waveBudget(n, t) * (event ? EVENTS[event].budgetMult : 1) * (boss ? 0.45 : 1);
    const intensity = Math.min(1, (boss ? 0.6 : 0.2) + (event ? 0.2 : 0) + Math.min(0.4, n / 60));
    return { wave: n, theme, event, boss, evolution, evolved, gates, budget, intensity, signal, forced: !!f || this.extraEvo.has(n) };
  }

  /** Full wave definition for wave n (hand-designed openers, then budgeted composition). */
  compose(n: number): WaveDef {
    n = safeWave(n);
    const plan = this.plan(n);
    const t = this.tier;
    const hp = hpMultiplier(n) * t.hpMult;
    const dmg = damageMultiplier(n) * t.damageMult;
    const base = { number: n, hpMult: hp, damageMult: dmg, speedMult: t.speedMult, prepTime: prepTime(n), clearReward: 60 + Math.min(n, 2000) * 15, plan };
    if (n <= HAND_WAVES.length && !plan.event && !plan.boss) return { ...base, spawns: expand(HAND_WAVES[n - 1], t.countMult) };
    const r = mulberry32(h32(this.seed >>> 0, n, 0xc0de));
    return { ...base, spawns: composeSpawns(n, plan, t, r) };
  }
}

function findLastIndex<T>(a: T[], f: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) return i;
  return -1;
}

function weighted<T>(pool: T[], w: (x: T) => number, r: () => number): T | null {
  if (!pool.length) return null;
  const total = pool.reduce((s, x) => s + Math.max(0, w(x)), 0);
  let x = r() * total;
  for (const p of pool) {
    x -= Math.max(0, w(p));
    if (x < 0) return p;
  }
  return pool[pool.length - 1];
}

/** Spend the plan's budget on spawns. Pure. */
export function composeSpawns(n: number, plan: WavePlan, t: ThreatTier, r: () => number): SpawnEntry[] {
  const gates = [...plan.gates].sort(() => r() - 0.5);
  const k = Math.max(0, n - 3);
  const duration = (30 + Math.min(40, k * 2.5)) * (plan.theme === 'swarm' ? 0.7 : 1);
  const groups: (Group & { mods?: EliteModId[]; tag?: SpawnEntry['tag']; hpMult?: number; encounter?: number })[] = [];
  let budget = plan.budget;

  // Boss + event-specific spawns first.
  if (plan.boss) groups.push({ kind: plan.boss.id, count: 1, gate: plan.boss.id === 'colossus' ? gates[0] : 'north', start: 4, interval: 0, tag: 'boss', encounter: plan.boss.encounter });
  if (plan.event === 'hvt') groups.push({ kind: 'courier', count: 1, gate: 'north', start: 8, interval: 0, tag: 'hvt' });

  const eligible = (kind: EnemyKind) => n >= unlockWave(kind, t);
  // The tier count multiplier is applied to groups later, so the cap accounts for it (total stays bounded).
  const cap = Math.round((spawnCap(n) * (plan.theme === 'swarm' ? 1.35 : 1) * (plan.boss ? 0.5 : 1)) / Math.max(1, t.countMult));
  const maxMods = maxModsFor(n, t);

  if (plan.event === 'eliteAssault') {
    // Coordinated squad: arrives together through one gate mid-wave with 2+ modifiers each where allowed.
    const size = EVENT_TUNING.squadSize[0] + Math.floor(r() * (EVENT_TUNING.squadSize[1] - EVENT_TUNING.squadSize[0] + 1));
    const kinds = (['walker', 'bulwark', 'enforcer', 'artillery'] as EnemyKind[]).filter(eligible);
    const gate = gates[0];
    for (let i = 0; i < size; i++) {
      const kind = kinds[Math.floor(r() * kinds.length) % kinds.length];
      const mods = rollMods(kind, Math.max(Math.min(2, t.maxMods), maxMods), r);
      groups.push({ kind, count: 1, gate, start: duration * 0.4 + i * 0.9, interval: 0, mods, tag: 'squad', hpMult: eliteHpMult(mods) });
      budget -= ENEMY_COST[kind] * (1 + mods.reduce((s, m) => s + ELITE_MODS[m].cost, 0)) * 0.5;
    }
  }

  // Theme mix -> per-kind budget shares.
  const mix: Partial<Record<EnemyKind, number>> =
    plan.theme === 'swarm' ? { rusher: 5, walker: 2.5 } : plan.theme === 'boss' ? { walker: 3, rusher: 2, engineer: n >= 12 ? 0.6 : 0 } : THEMES[plan.theme as keyof typeof THEMES].mix;
  const kinds = (Object.keys(mix) as EnemyKind[]).filter((kd) => eligible(kd) && (mix[kd] ?? 0) > 0);
  if (!kinds.includes('walker')) kinds.push('walker');
  const totalW = kinds.reduce((s, kd) => s + (mix[kd] ?? 1), 0);
  const counts = new Map<EnemyKind, number>();
  let used = 0;
  let spawns = groups.filter((g) => g.tag !== 'boss' && g.tag !== 'hvt').length;
  for (const kd of kinds) {
    const share = Math.max(0, budget) * ((mix[kd] ?? 1) / totalW);
    let c = Math.floor(share / ENEMY_COST[kd]);
    if (kd === 'walker' && c === 0 && !plan.boss) c = 2;
    counts.set(kd, c);
    spawns += c;
    used += c * ENEMY_COST[kd];
  }
  // Spawn cap: shrink counts proportionally; the surplus becomes durability (power), not entities.
  let overflow = 1;
  if (spawns > cap) {
    const f = cap / spawns;
    for (const [kd, c] of counts) counts.set(kd, Math.max(kd === 'walker' ? 1 : 0, Math.floor(c * f)));
    const usedAfter = [...counts].reduce((s, [kd, c]) => s + c * ENEMY_COST[kd], 0);
    overflow = usedAfter > 0 ? Math.min(6, 1 + ((used - usedAfter) / usedAfter) * 0.7) : 1;
  }

  // Elites: per spawn chance (squad waves and the elite theme get more).
  const eChance = Math.min(0.85, eliteChance(n, t) * (plan.theme === 'elite' ? 2.5 : plan.theme === 'swarm' ? 0.2 : 1));
  const eliteCap = Math.min(16, 2 + Math.floor(n / 5));
  let elites = 0;
  const swarm = plan.theme === 'swarm';
  for (const [kd, c] of counts) {
    if (c <= 0) continue;
    // Packets of 3-8 distributed over the active gates and the wave duration.
    const packet = kd === 'rusher' ? 5 + Math.floor(r() * 4) : kd === 'walker' ? 4 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
    const packets = Math.max(1, Math.ceil(c / packet));
    let left = c;
    for (let i = 0; i < packets; i++) {
      const count = Math.min(left, Math.ceil(c / packets));
      left -= count;
      if (count <= 0) break;
      const start = 1 + (kd === 'engineer' ? 4 : 0) + ((i + r() * 0.6) / packets) * duration;
      const gate = gates[(i + Math.floor(r() * gates.length)) % gates.length];
      const interval = swarm ? EVENT_TUNING.swarmInterval * 0.6 : kd === 'rusher' ? 0.45 : Math.max(0.7, 1.8 - k * 0.04);
      // Elite roll per member: split the packet member out as its own group.
      let plain = count;
      for (let m = 0; m < count; m++) {
        if (elites >= eliteCap || maxMods <= 0 || !(r() < eChance)) continue;
        const nm = 1 + Math.floor(r() * maxMods);
        const mods = rollMods(kd, nm, r);
        if (!mods.length) continue;
        elites++;
        plain--;
        groups.push({ kind: kd, count: 1, gate, start: start + m * interval, interval: 0, mods, hpMult: overflow * eliteHpMult(mods) * (swarm ? EVENT_TUNING.swarmHp : 1), tag: swarm ? 'swarm' : undefined });
      }
      if (plain > 0) groups.push({ kind: kd, count: plain, gate, start, interval, hpMult: overflow * (swarm ? EVENT_TUNING.swarmHp : 1), tag: swarm ? 'swarm' : undefined });
    }
  }

  const out: SpawnEntry[] = [];
  for (const g of groups) {
    const count = g.tag === 'boss' || g.tag === 'hvt' || g.tag === 'squad' ? g.count : Math.max(1, Math.round(g.count * t.countMult));
    const interval = count > g.count && g.count > 0 ? (g.interval * g.count) / count : g.interval;
    for (let i = 0; i < count; i++) {
      const e: SpawnEntry = { time: (g.start + i * interval) * PACE.spawnTempo, kind: g.kind, gate: g.gate };
      if (g.mods?.length) e.mods = [...g.mods];
      if (g.tag) e.tag = g.tag;
      if (g.hpMult !== undefined && g.hpMult !== 1) e.hpMult = g.hpMult;
      if (g.encounter) e.encounter = g.encounter;
      out.push(e);
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Health/damage multiplier of a boss spawn (on top of the wave multipliers). */
export function bossMults(encounter: number, tier: ThreatTier) {
  return bossScaling(encounter, tier.bossPower);
}
