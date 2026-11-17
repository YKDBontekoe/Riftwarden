import { mulberry32 } from '../combat/damage';
import { type AffixDef, affixDef, affixPool, MAX_TIER, TIER_MULT } from '../loot/affixes';
import { baseDef } from '../loot/bases';
import { groupOfStat, hashSeed, levelScale, maxTierFor, pickWeighted, qualityRoll, rollAffix, rollTier } from '../loot/generate';
import { rarity } from '../loot/rarity';
import type { ItemInstance, RolledAffix, WeaponRoll } from '../loot/types';
import { buildEffects, FAMILIES, isValidBuild, type WeaponBuild } from '../weapons/build';
import { type ComponentDef, componentDef, componentsFor, type ComponentSlot } from '../weapons/components';
import type { RerollMode } from './config';

/**
 * Item engineering rules (pure): affix rerolling and weapon component modification.
 * These functions compute results; ownership, costs and persistence are handled by the
 * transactions in economy/transactions.ts.
 *
 * Rerolls use the same affix pool, tier distribution, quality floor, level scaling and
 * rarity multipliers as generation (loot/generate.ts), so an engineered affix is always
 * one the item could have dropped with. Randomness is a deterministic stream keyed by the
 * item seed and its engineering counter: restoring an older save repeats the same outcome.
 */

export type EngineeringCheck = { ok: true } | { ok: false; reason: string };

/** Deterministic random stream for the item's next engineering operation. */
export function engineeringRand(item: Pick<ItemInstance, 'seed' | 'uid' | 'rerolls'>, op: string): () => number {
  return mulberry32(hashSeed(`${item.uid}|${item.seed}|${item.rerolls ?? 0}|${op}`));
}

/** Can this item's affixes be engineered at all? */
export function affixEngineerable(item: ItemInstance): EngineeringCheck {
  const base = baseDef(item.defId);
  if (!base) return { ok: false, reason: 'Unknown item definition' };
  if (!item.affixes.length) return { ok: false, reason: 'This item has no affixes' };
  if (!affixPool(item.category, new Set(), base.affixes).length) return { ok: false, reason: 'No affixes can roll on this item' };
  return { ok: true };
}

/** Groups blocked for a replacement at `index`: implicit stats and every other affix. */
function blockedGroups(item: ItemInstance, except: ReadonlySet<number>): Set<string> {
  const used = new Set<string>(item.base.map((s) => groupOfStat(s.stat)));
  item.affixes.forEach((a, i) => {
    if (except.has(i)) return;
    const d = affixDef(a.id);
    used.add(d ? d.group : groupOfStat(a.stat));
  });
  return used;
}

/** Affix definitions a 'stat' reroll of affix `index` can produce (the current one included). */
export function rerollPool(item: ItemInstance, index: number): AffixDef[] {
  const base = baseDef(item.defId);
  if (!base) return [];
  return affixPool(item.category, blockedGroups(item, new Set([index])), base.affixes);
}

/** Stored value range [min, max] an affix definition can take on this item (any allowed tier, any roll). */
export function affixValueRange(item: Pick<ItemInstance, 'level' | 'rarity'>, def: AffixDef, tiers?: [number, number]): [number, number] {
  const r = rarity(item.rarity);
  const maxT = maxTierFor(item.level);
  const [t0, t1] = tiers ?? [1, maxT];
  const vals = [t0, t1].flatMap((t) => [r.quality, 1].map((q) => rollAffix(def, t, q, item.level, r).value));
  return [Math.min(...vals), Math.max(...vals)];
}

/** Highest affix tier of an item excluding some indices. */
function topTier(affixes: readonly RolledAffix[], except: ReadonlySet<number>): number {
  let t = 0;
  affixes.forEach((a, i) => {
    if (!except.has(i)) t = Math.max(t, a.tier);
  });
  return t;
}

/** Tier for a rerolled affix, keeping the rarity's guaranteed top tier intact. */
function engineeredTier(item: ItemInstance, rand: () => number, others: number): number {
  const r = rarity(item.rarity);
  const maxT = maxTierFor(item.level);
  let tier = rollTier(rand, r, maxT);
  const floor = Math.min(maxT, r.minTopTier);
  if (floor > 0 && others < floor) tier = Math.max(tier, floor);
  return Math.min(maxT, Math.max(1, tier));
}

export function checkSingleReroll(item: ItemInstance, index: number): EngineeringCheck {
  const ok = affixEngineerable(item);
  if (!ok.ok) return ok;
  const a = item.affixes[index];
  if (!Number.isInteger(index) || !a) return { ok: false, reason: 'No such affix' };
  if (a.locked) return { ok: false, reason: 'This affix is locked: unlock it to recalibrate it' };
  return { ok: true };
}

/**
 * Reroll one affix. 'stat' may produce any compatible affix (possibly the same stat again);
 * 'value' keeps the stat and rerolls tier and roll. Returns the new affix (not applied).
 */
export function rerollSingle(item: ItemInstance, index: number, mode: RerollMode, rand: () => number): RolledAffix | null {
  if (!checkSingleReroll(item, index).ok) return null;
  const r = rarity(item.rarity);
  const cur = item.affixes[index];
  let def: AffixDef | undefined;
  if (mode === 'value') def = affixDef(cur.id);
  else {
    const base = baseDef(item.defId)!;
    def = pickWeighted(rerollPool(item, index), (x) => x.weights[base.category] ?? 0, rand);
  }
  if (!def) return null;
  const tier = engineeredTier(item, rand, topTier(item.affixes, new Set([index])));
  return rollAffix(def, tier, qualityRoll(rand, r), item.level, r);
}

export function checkFullReroll(item: ItemInstance): EngineeringCheck {
  const ok = affixEngineerable(item);
  if (!ok.ok) return ok;
  const locks = item.affixes.filter((a) => a.locked).length;
  if (locks >= item.affixes.length) return { ok: false, reason: 'Every affix is locked: nothing would change' };
  return { ok: true };
}

/** Maximum affixes that may be locked at once (at least one always rerolls). */
export function maxLocks(item: Pick<ItemInstance, 'affixes'>): number {
  return Math.max(0, item.affixes.length - 1);
}

/** Reroll every unlocked affix (locked ones are kept exactly). Returns the new affix list. */
export function rerollAll(item: ItemInstance, rand: () => number): RolledAffix[] | null {
  if (!checkFullReroll(item).ok) return null;
  const base = baseDef(item.defId)!;
  const r = rarity(item.rarity);
  const out: RolledAffix[] = item.affixes.map((a) => ({ ...a }));
  const open = new Set(out.map((a, i) => (a.locked ? -1 : i)).filter((i) => i >= 0));
  // Rebuild unlocked slots one by one; each pick blocks its group for the next.
  const pending = new Set(open);
  for (const i of open) {
    const probe: ItemInstance = { ...item, affixes: out };
    const pool = affixPool(item.category, blockedGroups(probe, pending), base.affixes);
    const def = pickWeighted(pool, (x) => x.weights[base.category] ?? 0, rand);
    if (!def) return null;
    const tier = engineeredTier(item, rand, topTier(out, pending));
    out[i] = rollAffix(def, tier, qualityRoll(rand, r), item.level, r);
    pending.delete(i);
  }
  return out;
}

/** Possible tier range of an engineered affix on this item. */
export function tierRange(item: ItemInstance, index: number): [number, number] {
  const maxT = maxTierFor(item.level);
  const r = rarity(item.rarity);
  const others = topTier(item.affixes, new Set([index]));
  const floor = Math.min(maxT, r.minTopTier);
  return [floor > 0 && others < floor ? floor : 1, maxT];
}

// ------------------------------------------------------------------ component engineering

/** Component slots that can be swapped (attachments stay cosmetic/fixed). */
export const SWAPPABLE_SLOTS: readonly ComponentSlot[] = ['barrel', 'core', 'cooling', 'mechanism'];

/** Components that may replace the current one in `slot` (family and rarity rules). */
export function swapOptions(item: ItemInstance, slot: ComponentSlot): ComponentDef[] {
  if (item.category !== 'weapon' || !item.build || !SWAPPABLE_SLOTS.includes(slot)) return [];
  const cur = (item.build as unknown as Record<string, string>)[slot];
  return componentsFor(slot, item.build.family, rarity(item.rarity).index).filter((c) => c.id !== cur);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Weapon with one component replaced. Component effects are baked into stored rolls, so
 * the roll is rescaled by new/old effect ratios (no reroll; the item's quality is kept).
 * Returns null for an invalid combination (wrong family/slot/rarity).
 */
export function swapComponent(item: ItemInstance, slot: ComponentSlot, componentId: string): { build: WeaponBuild; weapon: WeaponRoll } | null {
  if (item.category !== 'weapon' || !item.build || !item.weapon) return null;
  const c = componentDef(componentId);
  if (!c || c.slot !== slot || !swapOptions(item, slot).some((o) => o.id === componentId)) return null;
  const build: WeaponBuild = { ...item.build, [slot]: componentId } as WeaponBuild;
  if (!isValidBuild(build)) return null;
  const o = buildEffects(item.build);
  const n = buildEffects(build);
  const t = FAMILIES[build.family].template;
  const w = item.weapon;
  const ratio = (k: keyof typeof o) => (o[k] === 0 ? 1 : n[k] / o[k]);
  const dmg = w.damage * ratio('damage');
  const weapon: WeaponRoll = {
    damage: Math.abs(dmg) >= 100 ? Math.round(dmg) : Math.round(dmg * 10) / 10,
    fireRate: clampTo(r2(w.fireRate * ratio('fireRate')), 0.05, 60),
    heatPerShot: clampTo(r2(w.heatPerShot * ratio('heatPerShot')), 0.01, 100),
    coolRate: clampTo(Math.round(w.coolRate * ratio('coolRate') * 10) / 10, 0.1, 1000),
    range: clampTo(Math.round((w.range ?? t.range) * ratio('range')), 5, 1000),
    accuracy: clampTo(r2((w.accuracy ?? 1) * ratio('accuracy')), 0.05, 5),
    pierce: clampTo(Math.round((w.pierce ?? t.pierce) + (n.pierce - o.pierce)), 0, 10),
  };
  if (build.family === 'rail') weapon.chargeTime = clampTo(r2((w.chargeTime ?? t.chargeTime) * ratio('chargeTime')), 0.05, 10);
  if (build.family === 'beam') {
    weapon.beamWidth = clampTo(r2((w.beamWidth ?? t.beamWidth) * ratio('beamWidth')), 0, 5);
    weapon.rampMax = clampTo(r2((w.rampMax ?? t.rampMax) * ratio('rampMax')), 1, 10);
  }
  if (!(weapon.damage > 0)) return null;
  return { build, weapon };
}

/** Debug/test helper: highest value an affix id can reach at a level (tier 5, perfect roll). */
export function affixCeiling(id: string, level: number, rarityId: ItemInstance['rarity']): number {
  const d = affixDef(id);
  if (!d) return 0;
  const r = rarity(rarityId);
  return d.range[1] * TIER_MULT[MAX_TIER - 1] * levelScale(d.scaling, level) * r.affixMult;
}
