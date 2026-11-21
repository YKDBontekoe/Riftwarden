import { rollSignature } from './signatures';
import { mulberry32 } from '../combat/damage';
import { STAT_DEFS, type StatKey } from '../combat/stats';
import { AFFIXES, type AffixDef, affixPool, MAX_TIER, type Scaling, TIER_MULT } from './affixes';
import { type BaseDef, baseDef, BASES, basesFor } from './bases';
import { type RarityDef, type RarityId, rarity } from './rarity';
import type { Category, ItemInstance, RolledAffix, RolledStat, WeaponRoll } from './types';
import { buildEffects, DEFAULT_PARTS, rollBuild } from '../weapons/build';
import { rollElement } from '../combat/elements';

/**
 * Centralised, deterministic item generation.
 *
 * Same (seed, spec, GENERATOR_VERSION, definitions) -> same item. The result stores all
 * rolled values, so formula changes in later versions never reroll owned items.
 */
/** 2 = M3: weapon builds (family components baked into the roll), weapon-only sockets. */
export const GENERATOR_VERSION = 2;

/**
 * Numerical safety bound for item levels. Not a design cap: progression is endless, but
 * levels are clamped here so every derived value stays finite and exact in doubles.
 */
export const MAX_ITEM_LEVEL = 1_000_000;

// ------------------------------------------------------------------ scaling

/** Growth of absolute ("flat") values with item level: 1 at L1, ~7 at L50, ~18 at L100. */
export function flatScale(level: number): number {
  const l = clampLevel(level) - 1;
  return 1 + 0.08 * l + 0.0009 * l * l;
}

/** Growth of percentage values with item level: slow and logarithmic (1.25 at L11, 1.5 at L31). */
export function pctScale(level: number): number {
  const l = clampLevel(level) - 1;
  return 1 + 0.25 * Math.log2(1 + l / 10);
}

export function levelScale(s: Scaling, level: number): number {
  return s === 'flat' ? flatScale(level) : s === 'pct' ? pctScale(level) : 1;
}

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(MAX_ITEM_LEVEL, Math.max(1, Math.floor(level)));
}

/** Highest affix tier available at an item level (tiers unlock as levels climb). */
export function maxTierFor(level: number): number {
  return Math.min(MAX_TIER, 2 + Math.floor((clampLevel(level) - 1) / 8));
}

// ------------------------------------------------------------------ helpers

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function round(v: number, stat: StatKey | 'weapon'): number {
  if (!Number.isFinite(v)) return 0;
  const kind = stat === 'weapon' ? 'flat' : STAT_DEFS[stat].kind;
  const q = kind === 'flat' ? (Math.abs(v) >= 100 ? 1 : 10) : 1000;
  return Math.round(v * q) / q;
}

/** Roll inside [0,1] with the rarity's quality floor. */
export function qualityRoll(rand: () => number, r: RarityDef): number {
  return r.quality + (1 - r.quality) * rand();
}

export function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, rand: () => number): T | undefined {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return undefined;
  let x = rand() * total;
  for (const it of items) {
    x -= Math.max(0, weight(it));
    if (x < 0) return it;
  }
  return items[items.length - 1];
}

/** Hash a string to a 32-bit seed (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ------------------------------------------------------------------ generation

export interface GenSpec {
  uid: string;
  seed: number;
  level: number;
  rarity: RarityId;
  /** Explicit base, or pick one from `category`. */
  baseId?: string;
  category?: Category;
  /** Exclusive bases this source may produce. */
  allowExclusive?: readonly string[];
  source: string;
  now?: number;
  /** Force every roll to this position (0..1) and no affixes: starter/legacy kit. */
  fixedRoll?: number;
}

export function pickBase(category: Category, rand: () => number, allowExclusive: readonly string[] = []): BaseDef {
  const pool = basesFor(category, allowExclusive);
  return pickWeighted(pool, (b) => b.weight, rand) ?? BASES[0];
}

export function generateItem(spec: GenSpec): ItemInstance {
  const rand = mulberry32(spec.seed >>> 0);
  const level = clampLevel(spec.level);
  const r = rarity(spec.rarity);
  const base = baseDef(spec.baseId) ?? pickBase(spec.category ?? 'weapon', rand, spec.allowExclusive);
  const fixed = spec.fixedRoll;
  const roll = () => (fixed !== undefined ? fixed : qualityRoll(rand, r));

  // Implicit (base) stats.
  const implicit: RolledStat[] = base.implicit.map((s) => ({
    stat: s.stat,
    op: s.op,
    value: round(lerp(s.range[0], s.range[1], roll()) * levelScale(s.scaling, level) * (s.range[0] < 0 || s.exact ? 1 : r.baseMult), s.stat),
  }));

  // Weapon base parameters, then the procedural build (own random stream, so the
  // affix sequence of a seed is independent of component tables).
  let weapon: WeaponRoll | undefined;
  let build: ItemInstance['build'];
  const sockets = base.category === 'weapon' ? r.sockets : 0;
  if (base.weapon) {
    const w = base.weapon;
    const t = w.template;
    weapon = {
      damage: lerp(w.damage[0], w.damage[1], roll()) * flatScale(level) * r.baseMult,
      fireRate: lerp(w.fireRate[0], w.fireRate[1], roll()),
      // Lower heat is better: high quality rolls land at the low end.
      heatPerShot: lerp(w.heatPerShot[1], w.heatPerShot[0], roll()),
      coolRate: lerp(w.coolRate[0], w.coolRate[1], roll()),
    };
    {
      build = rollBuild(mulberry32((spec.seed ^ 0x5bd1e995) >>> 0), w.family, base.id, fixed === undefined ? r.index : 0, sockets);
      if (fixed !== undefined) {
        // Starter-grade kit: plain default components.
        build.barrel = DEFAULT_PARTS[w.family].barrel;
        build.core = 'co_cell';
        build.cooling = 'cl_fins';
        build.mechanism = DEFAULT_PARTS[w.family].mechanism;
        build.attachments = [];
        build.finish = 'arctic';
        build.params = { length: 0.5, bulk: 0.5, hue: 0.5 };
      }
      // Fixed (starter/legacy/repair) rolls keep the template numbers exactly.
      const e = fixed === undefined ? buildEffects(build) : { ...buildEffects({ ...build, attachments: [], barrel: '', core: '', cooling: '', mechanism: '' }), range: 1 };
      weapon.damage *= e.damage;
      weapon.fireRate *= e.fireRate;
      weapon.heatPerShot *= e.heatPerShot;
      weapon.coolRate *= e.coolRate;
      weapon.range = Math.round(t.range * e.range);
      weapon.accuracy = Math.round(e.accuracy * 100) / 100;
      weapon.pierce = t.pierce + e.pierce;
      if (w.family === 'rail') weapon.chargeTime = Math.round(t.chargeTime * e.chargeTime * 100) / 100;
      if (w.family === 'swarm') {
        weapon.drones = t.drones + e.drones;
        weapon.seekCone = Math.round(t.seekCone * e.seekCone * 1000) / 1000;
      }
      if (w.family === 'beam') {
        weapon.beamWidth = Math.round(t.beamWidth * e.beamWidth * 100) / 100;
        weapon.rampMax = Math.round(t.rampMax * e.rampMax * 100) / 100;
      }
    }
    weapon.damage = round(weapon.damage, 'weapon');
    weapon.fireRate = Math.round(weapon.fireRate * 100) / 100;
    weapon.heatPerShot = Math.round(weapon.heatPerShot * 100) / 100;
    weapon.coolRate = Math.round(weapon.coolRate * 10) / 10;
    // Element: its own stream (other rolls of a seed are unchanged); starter-grade kit is kinetic.
    weapon.element = fixed === undefined ? rollElement(w.family, r.index, mulberry32((spec.seed ^ 0x2c1b3c6d) >>> 0)) : 'kinetic';
  }

  // Affixes.
  const affixes: RolledAffix[] = [];
  if (fixed === undefined) {
    // Modules exist for their affixes: always at least one.
    const lo = base.category === 'module' ? Math.max(1, r.affixes[0]) : r.affixes[0];
    const count = lo + Math.floor(rand() * (Math.max(lo, r.affixes[1]) - lo + 1));
    const used = new Set<string>(base.implicit.map((s) => groupOfStat(s.stat)));
    const maxTier = maxTierFor(level);
    for (let i = 0; i < count; i++) {
      const pool = affixPool(base.category, used, base.affixes);
      const a = pickWeighted(pool, (x) => x.weights[base.category] ?? 0, rand);
      if (!a) break;
      used.add(a.group);
      let tier = rollTier(rand, r, maxTier);
      if (i === 0 && r.minTopTier > 0) tier = Math.max(tier, Math.min(maxTier, r.minTopTier));
      tier = Math.min(maxTier, Math.max(1, tier));
      affixes.push(rollAffix(a, tier, qualityRoll(rand, r), level, r));
    }
  }

  // Ascended: one extra affix at the level's top tier with a perfect roll (consumes the stream only for ascended).
  if (fixed === undefined && r.id === 'ascended') {
    const used = new Set<string>([...base.implicit.map((s) => groupOfStat(s.stat)), ...affixes.map((a) => AFFIXES.find((x) => x.id === a.id)?.group ?? '')]);
    const a = pickWeighted(affixPool(base.category, used, base.affixes), (x) => x.weights[base.category] ?? 0, rand);
    if (a) affixes.push(rollAffix(a, maxTierFor(level), 1, level, r));
  }

  const item: ItemInstance = {
    uid: spec.uid,
    defId: base.id,
    acquiredAt: spec.now ?? Date.now(),
    source: spec.source,
    category: base.category,
    level,
    rarity: r.id,
    name: '',
    base: implicit,
    affixes,
    weapon,
    build,
    module: base.module ? { type: base.module.type, compatible: [...base.module.compatible], socketCost: base.module.socketCost } : undefined,
    sockets,
    socketed: Array.from({ length: sockets }, () => null),
    signature: null,
    seed: spec.seed >>> 0,
    gen: GENERATOR_VERSION,
  };
  item.name = nameItem(item, base, mulberry32((spec.seed ^ 0x9e3779b9) >>> 0));
  item.signature = rollSignature(item);
  return item;
}

/** Affix tier roll: skewed low for commons, high for exotics, capped by the level's max tier. */
export function rollTier(rand: () => number, r: RarityDef, maxTier: number): number {
  const p = 1.6 / (1 + r.tierBias);
  return Math.min(maxTier, Math.max(1, 1 + Math.floor(Math.pow(rand(), p) * maxTier)));
}

export function groupOfStat(stat: StatKey): string {
  // Implicit stats block affixes on the same stat (no "+crit" on a crit processor).
  return AFFIXES.find((a) => a.stat === stat)?.group ?? `stat:${stat}`;
}

export function rollAffix(a: AffixDef, tier: number, q: number, level: number, r: RarityDef): RolledAffix {
  const t = Math.min(MAX_TIER, Math.max(1, Math.floor(tier)));
  const raw = lerp(a.range[0], a.range[1], q) * TIER_MULT[t - 1] * levelScale(a.scaling, level) * r.affixMult;
  return { id: a.id, stat: a.stat, op: a.op, value: round(raw, a.stat), tier: t, roll: Math.round(q * 100) / 100 };
}

/** The basic kit every profile owns (deterministic mid rolls, no affixes). */
export function starterWeapon(uid: string, now = Date.now()): ItemInstance {
  return generateItem({ uid, seed: hashSeed(uid), level: 1, rarity: 'common', baseId: 'plasma_repeater', source: 'starter', now, fixedRoll: 0.5 });
}

// ------------------------------------------------------------------ naming

const MAKERS = ['VX-7', 'Halden', 'Orison', 'KR-2', 'Tessar', 'NX-9', 'Corvane', 'Aster'];
const EPITHETS = ['Lodestar', 'Ninth Gate', 'Stormglass', 'Last Light', 'Riftbreaker', 'Meridian', 'Black Sun', 'Vigil', 'Aurora', 'Sentence', 'Halcyon', 'Ember Crown'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/**
 * Structured names that reflect the item: strongest affix theme + base noun, with a
 * manufacturer from Rare, a mark from Epic and a designation from Legendary.
 */
export function nameItem(item: ItemInstance, base: BaseDef, rand: () => number): string {
  const r = rarity(item.rarity);
  const top = [...item.affixes].sort((a, b) => b.tier - a.tier || b.roll - a.roll)[0];
  const adj = top ? (affixPool(base.category).find((a) => a.id === top.id)?.adjective ?? '') : '';
  const maker = MAKERS[Math.floor(rand() * MAKERS.length)];
  const noun = base.name;
  switch (r.index) {
    case 0:
      return adj ? `${adj} ${noun}` : noun;
    case 1:
      return adj ? `${adj} ${noun}` : noun;
    case 2:
      return `${maker} ${adj ? `${adj} ` : ''}${noun}`;
    case 3:
      return `${maker} ${adj ? `${adj} ` : ''}${noun} Mk ${ROMAN[Math.min(4, (top?.tier ?? 1) - 1)]}`;
    default: {
      const ep = EPITHETS[Math.floor(rand() * EPITHETS.length)];
      return `${r.id === 'ascended' ? 'Ascended ' : ''}${adj ? `${adj} ` : ''}${noun} "${ep}"`;
    }
  }
}

// ------------------------------------------------------------------ validation

/** True when every stored number is finite and every stat is a known key. */
export function isValidItem(it: ItemInstance): boolean {
  const okStat = (s: RolledStat) => Object.prototype.hasOwnProperty.call(STAT_DEFS, s.stat) && Number.isFinite(s.value) && (s.op === 'add' || s.op === 'pct' || s.op === 'mul');
  if (!Number.isInteger(it.level) || it.level < 1 || it.level > MAX_ITEM_LEVEL) return false;
  if (!it.base.every(okStat) || !it.affixes.every(okStat)) return false;
  if (it.weapon) {
    const w = it.weapon;
    if (![w.damage, w.fireRate, w.heatPerShot, w.coolRate].every((v) => Number.isFinite(v) && v > 0)) return false;
  }
  return typeof it.name === 'string' && it.name.length > 0;
}
