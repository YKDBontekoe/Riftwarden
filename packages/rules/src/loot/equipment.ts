import { ELEMENT_INFO } from '../combat/elements';
import { BASE_STATS, type CombatStats, computeStats, formatModifier, formatStat, fmtNum, type StatKey, STAT_DEFS, type StatModifier, STAT_KEYS, type StatOp } from '../combat/stats';
import { DAMAGE_PACE, HEAT_PACE } from '../combat/heat';
import type { WeaponDef } from '../data/defs';
import { buildMechanism, FAMILIES } from '../weapons/build';
import { installedModules } from '../weapons/modules';
import { enhanceStatMult, weaponEnhance } from '../economy/config';
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
  // Enhancement (M4) scales beneficial stored values; the stored roll itself never changes.
  const push = (it: ItemInstance) => {
    for (const s of it.base) out.push({ stat: s.stat, op: s.op, value: s.value * enhanceStatMult(it, s.stat, s.value, 'base'), source: it.uid });
    for (const a of it.affixes) out.push({ stat: a.stat, op: a.op, value: a.value * enhanceStatMult(it, a.stat, a.value, 'affix'), source: it.uid });
  };
  push(item);
  if (item.category === 'weapon') for (const m of installedModules(item)) push(m);
  return out;
}

/** A module's own stats with its enhancement applied (what it adds once installed). */
export function moduleStats(item: ItemInstance): RolledStat[] {
  return [
    ...item.base.map((s) => ({ stat: s.stat, op: s.op, value: s.value * enhanceStatMult(item, s.stat, s.value, 'base') })),
    ...item.affixes.map((a) => ({ stat: a.stat, op: a.op, value: a.value * enhanceStatMult(item, a.stat, a.value, 'affix') })),
  ];
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
  const enh = weaponEnhance(item);
  return {
    ...t,
    id: item.defId,
    name: item.name.toUpperCase(),
    mechanism: buildMechanism(item.build) ?? t.mechanism,
    damage: w.damage * enh.damage,
    fireRate: w.fireRate,
    heatPerShot: w.heatPerShot,
    coolRate: w.coolRate * enh.cooling,
    range: w.range ?? t.range,
    spreadMin: t.spreadMin * acc,
    spreadMax: t.spreadMax * acc,
    spreadPerShot: t.spreadPerShot * acc,
    pierce: w.pierce ?? t.pierce,
    chargeTime: w.chargeTime ?? t.chargeTime,
    beamWidth: w.beamWidth ?? t.beamWidth,
    rampMax: w.rampMax ?? t.rampMax,
    drones: w.drones ?? t.drones,
    seekCone: w.seekCone ?? t.seekCone,
    splash: w.splash ?? t.splash,
    spray: w.spray ?? t.spray,
    targets: w.targets ?? t.targets,
    element: w.element ?? 'kinetic',
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
  const list = item.category === 'module' ? moduleStats(item) : itemModifiers(item);
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
  const heat = (w.heatPerShot * HEAT_PACE.gain) / stats.heatEfficiency;
  const rate = w.fireRate * stats.fireRateMult;
  // Swarm: drones per launch (salvo: a full lock releases 3x) x projectiles.
  const drones = Math.max(1, w.drones) * Math.max(1, Math.floor(stats.projectiles)) * (w.mechanism === 'salvo' ? 3 : 1);
  const proj = w.family === 'beam' ? 1 : w.family === 'swarm' ? drones : w.mechanism === 'scatter' ? 7 + 2 * Math.max(0, Math.floor(stats.projectiles) - 1) : Math.floor(stats.projectiles);
  const dmg = w.damage * DAMAGE_PACE * stats.weaponDamageMult;
  const critFactor = 1 + stats.critChance * (stats.critMultiplier - 1);
  const chargeTime = w.chargeTime / stats.chargeRateMult;
  let cycle = 1 / rate;
  if (w.mechanism === 'charge' || w.mechanism === 'salvo') cycle = Math.max(1 / rate, chargeTime + 0.05);
  const rampTime = w.rampTime / stats.chargeRateMult;
  const rampAvg = w.mechanism === 'beam' ? (1 + w.rampMax) / 2 : 1;
  const perShot = dmg * proj;
  // Pulse: every pulse also detonates (60% splash, counted once for a single target group of ~2).
  const dps = (perShot / cycle) * critFactor * rampAvg * (w.mechanism === 'pulse' ? 1.6 : 1);
  return {
    damage: dmg,
    projectiles: proj,
    rate,
    dps,
    heat,
    shotsToOverheat: Math.ceil(100 / Math.max(0.01, heat)),
    cool: w.coolRate * stats.coolRateMult * HEAT_PACE.cool,
    range: w.range * stats.rangeMult,
    chargeTime,
    rampTime,
    rampMax: w.rampMax,
    pierce: w.pierce + Math.floor(stats.pierce),
    spread: w.spreadMin * stats.spreadMult,
    beamWidth: w.beamWidth,
    /** Swarm lock cone half-angle in degrees (0 for other families). */
    lockCone: w.family === 'swarm' ? (Math.atan(w.seekCone) * 180) / Math.PI : 0,
    /** Launcher blast radius (m, 0 for other families). */
    splash: w.family === 'launcher' ? w.splash : 0,
    /** Flamer spray cone half-angle in degrees and machines reached per tick (0 for other families). */
    sprayCone: w.family === 'flamer' ? (Math.atan(w.spray) * 180) / Math.PI : 0,
    targets: w.family === 'flamer' ? Math.max(1, w.targets) : 0,
    /** Seconds of continuous fire from cold to overheat. */
    sustain: (100 / Math.max(0.01, heat)) / (w.mechanism === 'charge' || w.mechanism === 'salvo' ? 1 / cycle : rate),
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
    rows.push({ key: 'w.element', label: 'Element', a: ELEMENT_INFO[wa.element].name, b: wb ? ELEMENT_INFO[wb.element].name : '', verdict: 0 });
    add('w.damage', wa.family === 'beam' || wa.family === 'flamer' ? 'Damage / tick' : wa.family === 'swarm' ? 'Damage / drone' : wa.family === 'launcher' ? 'Direct hit' : 'Damage / shot', sa.damage, same ? sb?.damage : undefined, 'higher');
    add('w.rate', wa.family === 'beam' ? 'Tick rate' : 'Fire rate', sa.rate, same ? sb?.rate : undefined, 'higher', (v) => `${fmtNum(v)}/s`);
    add('w.range', 'Range', sa.range, sb?.range, 'higher', (v) => `${fmtNum(v)} m`);
    add('w.sustain', 'Fire time to overheat', sa.sustain, sb?.sustain, 'higher', (v) => `${fmtNum(v)} s`);
    add('w.cool', 'Cooling', sa.cool, sb?.cool, 'higher', (v) => `${fmtNum(v)}/s`);
    if (wa.family === 'launcher' && same) add('w.splash', 'Blast radius', sa.splash, sb?.splash, 'higher', (v) => `${fmtNum(v)} m`);
    if (wa.family === 'flamer' && same) add('w.targets', 'Machines per tick', sa.targets, sb?.targets, 'higher', (v) => String(v));
    if (wa.family === 'flamer' && same) add('w.spray', 'Spray cone', sa.sprayCone, sb?.sprayCone, 'higher', (v) => `${fmtNum(v)}°`);
    if (wa.family === 'rail' && same) add('w.pierce', 'Pierce', sa.pierce, sb?.pierce, 'higher', (v) => `${v} targets`);
    if (wa.family === 'rail' && wa.mechanism === 'charge' && same) add('w.charge', 'Charge time', sa.chargeTime, sb?.chargeTime, 'lower', (v) => `${fmtNum(v)} s`);
    if (wa.family === 'swarm' && same) add('w.drones', 'Drones / launch', sa.projectiles, sb?.projectiles, 'higher', (v) => String(v));
    if (wa.family === 'swarm' && same) add('w.lock', 'Lock cone', sa.lockCone, sb?.lockCone, 'higher', (v) => `${fmtNum(v)}°`);
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

export interface WeaponStatRow {
  key: string;
  label: string;
  value: number;
  text: string;
  better: 'higher' | 'lower';
}

/**
 * Effective numbers of one weapon on its own (its rolls, affixes and installed modules,
 * through the real stat pipeline). Used by the engineering bench to show what an
 * installation or removal changes.
 */
export function weaponStatRows(item: ItemInstance): WeaponStatRow[] {
  const w = weaponDefFor(item);
  if (!w) return [];
  const st = computeStats(itemModifiers(item));
  const s = weaponSummary(w, st);
  const rows: WeaponStatRow[] = [];
  const add = (key: string, label: string, value: number, text: string, better: 'higher' | 'lower' = 'higher') => rows.push({ key, label, value, text, better });
  add('dps', 'Sustained DPS', s.dps, fmtNum(s.dps));
  add('damage', w.family === 'beam' ? 'Damage / tick' : w.family === 'swarm' ? 'Damage / drone' : 'Damage / shot', s.damage, fmtNum(s.damage));
  if (s.projectiles > 1) add('proj', w.family === 'swarm' ? 'Drones / launch' : 'Projectiles', s.projectiles, String(s.projectiles));
  if (w.family === 'swarm') add('lock', 'Lock cone', s.lockCone, `${fmtNum(s.lockCone)}°`);
  add('rate', w.family === 'beam' ? 'Tick rate' : 'Fire rate', s.rate, `${fmtNum(s.rate)}/s`);
  add('crit', 'Critical chance', st.critChance, `${fmtNum(st.critChance * 100)}%`);
  add('critdmg', 'Critical damage', st.critMultiplier, `×${fmtNum(st.critMultiplier)}`);
  add('sustain', 'Fire time to overheat', s.sustain, `${fmtNum(s.sustain)} s`);
  add('cool', 'Cooling', s.cool, `${fmtNum(s.cool)}%/s`);
  add('range', 'Range', s.range, `${fmtNum(s.range)} m`);
  add('spread', 'Spread & recoil', st.spreadMult, `${fmtNum(st.spreadMult * 100)}%`, 'lower');
  if (w.mechanism === 'charge' || w.mechanism === 'salvo') add('charge', w.mechanism === 'salvo' ? 'Full lock time' : 'Charge time', s.chargeTime, `${fmtNum(s.chargeTime)} s`, 'lower');
  if (w.family === 'rail') add('pierce', 'Pierce', s.pierce, `${s.pierce}`);
  if (w.family === 'beam') add('ramp', 'Ramp time', s.rampTime, `${fmtNum(s.rampTime)} s`, 'lower');
  if (st.arcChance > 0) add('arc', 'Arc chance · damage', st.arcChance, `${fmtNum(st.arcChance * 100)}% · ${fmtNum(st.arcDamage * 100)}%`);
  if (st.heatDamage > 0) add('thermal', 'Damage at full heat', st.heatDamage, `+${fmtNum(st.heatDamage * 100)}%`);
  return rows;
}

/** Copy of a weapon with a socket changed (engineering preview; never persisted). */
export function withSocket(weapon: ItemInstance, index: number, module: ItemInstance | null): ItemInstance {
  return { ...weapon, socketed: weapon.socketed.map((m, i) => (i === index ? module : m)) };
}
