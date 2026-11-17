import { BASE_STATS, type CombatStats, computeStats, formatModifier, formatStat, fmtNum, type StatKey, STAT_DEFS, type StatModifier, STAT_KEYS, type StatOp } from '../combat/stats';
import type { WeaponDef } from '../data/defs';
import { buildMechanism, FAMILIES } from '../weapons/build';
import { installedModules } from '../weapons/modules';
import { baseDef } from './bases';
import type { ItemInstance, RolledStat } from './types';

/**
 * Equipment -> gameplay (pure). The single place where item data becomes stat
 * modifiers and weapon parameters. Gameplay systems only ever see the results.
 */

/**
 * Modifiers an equipped item contributes. A weapon also contributes the modules installed
 * in its sockets (exactly once: modules only exist inside their weapon). Loose modules
 * contribute nothing.
 */
export function itemModifiers(item: ItemInstance): StatModifier[] {
  if (item.category === 'module') return [];
  const out: StatModifier[] = [];
  const push = (it: ItemInstance) => {
    for (const s of it.base) out.push({ stat: s.stat, op: s.op, value: s.value, source: it.uid });
    for (const a of it.affixes) out.push({ stat: a.stat, op: a.op, value: a.value, source: it.uid });
  };
  push(item);
  if (item.category === 'weapon') for (const m of installedModules(item)) push(m);
  return out;
}

export function equipmentModifiers(items: readonly (ItemInstance | null | undefined)[]): StatModifier[] {
  const out: StatModifier[] = [];
  for (const it of items) if (it) out.push(...itemModifiers(it));
  return out;
}

/**
 * Effective weapon parameters for an equipped weapon item (null if it is not a usable
 * weapon). Composition order: family template -> base roll (with component effects baked
 * in at generation) -> mechanism from the build. Stat-block modifiers (affixes, modules,
 * other equipment, run upgrades) are applied at fire time from CombatStats.
 */
export function weaponDefFor(item: ItemInstance | null | undefined): WeaponDef | null {
  if (!item || item.category !== 'weapon' || !item.weapon) return null;
  const b = baseDef(item.defId);
  if (!b?.weapon) return null;
  const w = item.weapon;
  const t = FAMILIES[b.weapon.family]?.template ?? b.weapon.template;
  const acc = w.accuracy ?? 1;
  return {
    ...t,
    id: item.defId,
    name: item.name.toUpperCase(),
    mechanism: buildMechanism(item.build) ?? t.mechanism,
    damage: w.damage,
    fireRate: w.fireRate,
    heatPerShot: w.heatPerShot,
    coolRate: w.coolRate,
    range: w.range ?? t.range,
    spreadMin: t.spreadMin * acc,
    spreadMax: t.spreadMax * acc,
    spreadPerShot: t.spreadPerShot * acc,
    pierce: w.pierce ?? t.pierce,
    chargeTime: w.chargeTime ?? t.chargeTime,
    beamWidth: w.beamWidth ?? t.beamWidth,
    rampMax: w.rampMax ?? t.rampMax,
  };
}

// ------------------------------------------------------------------ comparison

export interface CompareRow {
  key: string;
  label: string;
  /** Formatted values (candidate / equipped). Empty string = not present. */
  a: string;
  b: string;
  /** +1 candidate better, -1 worse, 0 equal / not comparable. */
  verdict: -1 | 0 | 1;
}

/** Sum an item's contributions per (stat, op). */
export function statTotals(item: ItemInstance | null | undefined): Map<string, RolledStat> {
  const m = new Map<string, RolledStat>();
  if (!item) return m;
  // Weapons include their installed modules.
  const list = item.category === 'module' ? [...item.base, ...item.affixes] : itemModifiers(item);
  for (const s of list) {
    const k = `${s.stat}|${s.op}`;
    const cur = m.get(k);
    if (cur) cur.value += s.value;
    else m.set(k, { stat: s.stat, op: s.op, value: s.value });
  }
  return m;
}

const verdictOf = (a: number, b: number, better: 'higher' | 'lower'): -1 | 0 | 1 => {
  const eps = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Math.abs(a - b) <= eps) return 0;
  return (a > b) === (better === 'higher') ? 1 : -1;
};

/** Rail charge-shot damage factor for a charge fraction (0..1). */
export function chargeFactor(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return 0.3 + 0.7 * Math.pow(x, 1.3);
}

/**
 * Weapon fundamentals for display, per family. `dps` is the sustained expectation while
 * the trigger is held on target (beam: average over the ramp; rail charge: full charges).
 */
export function weaponSummary(w: WeaponDef, stats: CombatStats = BASE_STATS) {
  const heat = w.heatPerShot / stats.heatEfficiency;
  const rate = w.fireRate * stats.fireRateMult;
  const proj = w.family === 'beam' ? 1 : Math.floor(stats.projectiles);
  const dmg = w.damage * stats.weaponDamageMult;
  const critFactor = 1 + stats.critChance * (stats.critMultiplier - 1);
  const chargeTime = w.chargeTime / stats.chargeRateMult;
  let cycle = 1 / rate;
  if (w.mechanism === 'charge') cycle = Math.max(1 / rate, chargeTime + 0.05);
  const rampTime = w.rampTime / stats.chargeRateMult;
  const rampAvg = w.mechanism === 'beam' ? (1 + w.rampMax) / 2 : 1;
  const perShot = dmg * proj;
  const dps = (perShot / cycle) * critFactor * rampAvg;
  return {
    damage: dmg,
    projectiles: proj,
    rate,
    dps,
    heat,
    shotsToOverheat: Math.ceil(100 / Math.max(0.01, heat)),
    cool: w.coolRate * stats.coolRateMult,
    range: w.range * stats.rangeMult,
    chargeTime,
    rampTime,
    rampMax: w.rampMax,
    pierce: w.pierce + Math.floor(stats.pierce),
    spread: w.spreadMin * stats.spreadMult,
    beamWidth: w.beamWidth,
    /** Seconds of continuous fire from cold to overheat. */
    sustain: (100 / Math.max(0.01, heat)) / (w.mechanism === 'charge' ? 1 / cycle : rate),
  };
}

/**
 * Raw item comparison: every stat either item carries, candidate (a) vs equipped (b).
 * Weapons also compare their base parameters.
 */
export function compareItems(a: ItemInstance, b: ItemInstance | null): CompareRow[] {
  const rows: CompareRow[] = [];
  const wa = weaponDefFor(a);
  const wb = weaponDefFor(b);
  if (wa) {
    const sa = weaponSummary(wa);
    const sb = wb ? weaponSummary(wb) : null;
    const add = (key: string, label: string, va: number, vb: number | undefined, better: 'higher' | 'lower', fmt = fmtNum) =>
      rows.push({ key, label, a: fmt(va), b: vb === undefined ? '' : fmt(vb), verdict: vb === undefined ? 0 : verdictOf(va, vb, better) });
    const same = !wb || wb.family === wa.family;
    add('w.dps', 'Sustained DPS', sa.dps, sb?.dps, 'higher');
    add('w.damage', wa.family === 'beam' ? 'Damage / tick' : 'Damage / shot', sa.damage, same ? sb?.damage : undefined, 'higher');
    add('w.rate', wa.family === 'beam' ? 'Tick rate' : 'Fire rate', sa.rate, same ? sb?.rate : undefined, 'higher', (v) => `${fmtNum(v)}/s`);
    add('w.range', 'Range', sa.range, sb?.range, 'higher', (v) => `${fmtNum(v)} m`);
    add('w.sustain', 'Fire time to overheat', sa.sustain, sb?.sustain, 'higher', (v) => `${fmtNum(v)} s`);
    add('w.cool', 'Cooling', sa.cool, sb?.cool, 'higher', (v) => `${fmtNum(v)}/s`);
    if (wa.family === 'rail' && same) add('w.pierce', 'Pierce', sa.pierce, sb?.pierce, 'higher', (v) => `${v} targets`);
    if (wa.family === 'rail' && wa.mechanism === 'charge' && same) add('w.charge', 'Charge time', sa.chargeTime, sb?.chargeTime, 'lower', (v) => `${fmtNum(v)} s`);
    if (wa.family === 'beam' && same) add('w.ramp', 'Ramp ceiling', sa.rampMax, sb?.rampMax, 'higher', (v) => `×${fmtNum(v)}`);
  }
  const ta = statTotals(a);
  const tb = statTotals(b);
  const keys = [...new Set([...ta.keys(), ...tb.keys()])];
  keys.sort((x, y) => STAT_KEYS.indexOf(x.split('|')[0] as StatKey) - STAT_KEYS.indexOf(y.split('|')[0] as StatKey));
  for (const k of keys) {
    const [stat, op] = k.split('|') as [StatKey, StatOp];
    const va = ta.get(k)?.value ?? 0;
    const vb = tb.get(k)?.value ?? 0;
    rows.push({
      key: k,
      label: STAT_DEFS[stat].label,
      a: ta.has(k) ? formatModifier(stat, op, va) : '',
      b: tb.has(k) ? formatModifier(stat, op, vb) : '',
      verdict: b ? verdictOf(va, vb, STAT_DEFS[stat].better) : 0,
    });
  }
  return rows;
}

export interface StatPreviewRow {
  stat: StatKey;
  label: string;
  before: string;
  after: string;
  verdict: -1 | 0 | 1;
}

/**
 * Effective drone stats before/after swapping `candidate` in for `replaced`, computed
 * with the real stat pipeline (so stacking and clamps are reflected honestly).
 */
export function statPreview(equipped: readonly (ItemInstance | null)[], candidate: ItemInstance | null, replaced: ItemInstance | null): StatPreviewRow[] {
  const before = computeStats(equipmentModifiers(equipped));
  const after = computeStats(equipmentModifiers([...equipped.filter((i) => i && i.uid !== replaced?.uid && i.uid !== candidate?.uid), candidate]));
  const rows: StatPreviewRow[] = [];
  for (const k of STAT_KEYS) {
    if (Math.abs(before[k] - after[k]) < 1e-9) continue;
    rows.push({ stat: k, label: STAT_DEFS[k].label, before: formatStat(k, before[k]), after: formatStat(k, after[k]), verdict: verdictOf(after[k], before[k], STAT_DEFS[k].better) });
  }
  return rows;
}
