import { mulberry32 } from '../combat/damage';
import type { DamageElement } from '../combat/elements';
import { STAT_DEFS, type StatKey, type StatOp } from '../combat/stats';
import { affixDef } from './affixes';
import { baseDef } from './bases';
import { flatScale, generateItem, hashSeed, maxTierFor, pctScale, rollAffix } from './generate';
import { RARITY_UNLOCK, rarity, type RarityId } from './rarity';
import type { ItemInstance, RolledStat } from './types';

/**
 * Hand-made uniques (pure data + generation). A unique is a named item on a fixed base with a fixed set of affixes
 * (rolled near the top of their range at the drop's level), fixed bonus stats and one named mechanic:
 *  - weapons carry a unique-only signature (loot/signatures.ts, `unique: true`), so the signature pipeline applies
 *    it for whoever fires (solo and co-op server alike),
 *  - gear carries an equipped effect read by PlayerCombat through `CombatHost.uniques()`, or (ability/ultimate
 *    uniques) a stat profile no procedural roll can reach.
 * Target farming: each unique drops only from its listed sources (bosses, archetypes, elites, events), some only in
 * sectors of a faction. A drop of a listed source becomes the unique when `uniqueChance(seed, id) < chance`, decided
 * from the drop's own seed, so unique checks never shift any random stream.
 */
export interface UniqueStat {
  stat: StatKey;
  op: StatOp;
  value: number;
  /** Grow with item level like base stats ('flat' / 'pct'), default none. */
  scaling?: 'flat' | 'pct';
}

export interface UniqueDef {
  id: string;
  name: string;
  baseId: string;
  rarity: Extract<RarityId, 'legendary' | 'exotic'>;
  /** Flavour line (italic in the item card). */
  flavour: string;
  /** The mechanic in one sentence (shown as UNIQUE EFFECT). */
  effect: string;
  /** Weapons: the unique-only signature id that implements the mechanic. */
  signature?: string;
  /** Gear: equipped effect id read by PlayerCombat (absent = stat profile only). */
  gear?: string;
  /** Weapons: forced damage element. */
  element?: DamageElement;
  /** Affix ids, rolled at the level's top tier with a 70-100% roll. */
  affixes: string[];
  /** Extra fixed stats on top of the base's implicit stats. */
  extra?: UniqueStat[];
  drops: { sources: string[]; faction?: string; chance: number };
}

const s = (stat: StatKey, op: StatOp, value: number, scaling?: 'flat' | 'pct'): UniqueStat => ({ stat, op, value, scaling });

export const UNIQUES: readonly UniqueDef[] = [
  // ---------------------------------------------------------------- weapons (signature mechanics)
  {
    id: 'heartbreaker', name: 'Heartbreaker', baseId: 'rail_siege', rarity: 'exotic', signature: 'u_heartbreaker', element: 'corrosive',
    flavour: 'Machined from the Colossus core-door hinge. It remembers where the heart is.',
    effect: 'Weakpoint hits deal +70% damage and corrode the target (2 stacks).',
    affixes: ['dmg', 'crit', 'cool'], drops: { sources: ['colossus'], chance: 0.06 },
  },
  {
    id: 'prism_gaze', name: "Overseer's Gaze", baseId: 'beam_prism', rarity: 'exotic', signature: 'u_prismgaze', element: 'void',
    flavour: 'The lens still looks for something to judge.',
    effect: 'Every 8th tick fires a prism ray that chains to 3 machines for 120% of the tick.',
    affixes: ['dmg', 'heat', 'crit'], drops: { sources: ['overseer'], chance: 0.06 },
  },
  {
    id: 'rime_breath', name: "Rime Warden's Breath", baseId: 'plasma_repeater', rarity: 'legendary', signature: 'u_rimebreath', element: 'cryo',
    flavour: 'Issued to the excavation guard. The guard did not come back; the rifle did.',
    effect: 'Hits on chilled or frozen machines deal +40%; frozen machines you kill shatter: 4 m cryo burst for 80% of the hit.',
    affixes: ['rate', 'crit', 'cool'], drops: { sources: ['elite', 'eliteCache', 'burrower'], faction: 'rime', chance: 0.05 },
  },
  {
    id: 'crucible_choir', name: 'Crucible Choir', baseId: 'swarm_brood', rarity: 'legendary', signature: 'u_choir', element: 'thermal',
    flavour: 'A hundred tiny furnaces, all singing the same note.',
    effect: 'Hits on burning machines ignite every machine within 3.5 m.',
    affixes: ['dmg', 'rate', 'heat'], drops: { sources: ['elite', 'eliteCache', 'skimmer'], faction: 'crucible', chance: 0.05 },
  },
  {
    id: 'jury_rig', name: 'Scrapline Jury-Rig', baseId: 'heavy_repeater', rarity: 'legendary', signature: 'u_juryrig', element: 'electric',
    flavour: 'Three repeaters, one capacitor, no warranty.',
    effect: 'Above 50% heat every hit has a 25% chance to arc to 2 machines for 60% of the hit.',
    affixes: ['dmg', 'crit', 'heat'], drops: { sources: ['elite', 'eliteCache', 'sapper', 'marksman'], faction: 'scrap', chance: 0.05 },
  },
  {
    id: 'hive_mother', name: 'Hive Mother', baseId: 'swarm_hive', rarity: 'legendary', signature: 'u_hivemother',
    flavour: 'Every death is a birth, if you ask her.',
    effect: 'Kills release two seekers that strike the nearest machines within 14 m for 50% of the killing hit.',
    affixes: ['dmg', 'rate', 'crit'], drops: { sources: ['elite', 'eliteCache'], chance: 0.025 },
  },
  {
    id: 'ninth_gate', name: 'Lance of the Ninth Gate', baseId: 'rail_lancer', rarity: 'exotic', signature: 'u_ninthgate',
    flavour: 'Recovered from a courier vault. The vault had nine locks; the slug went through all of them.',
    effect: 'Slugs pierce 2 more machines and gain +20% per machine pierced instead of losing 15%.',
    affixes: ['dmg', 'critdmg', 'heat'], extra: [s('pierce', 'add', 2)], drops: { sources: ['hvt'], chance: 0.12 },
  },
  // ---------------------------------------------------------------- gear (equipped effects)
  {
    id: 'bulwark_mantle', name: 'Mantle of the Last Bulwark', baseId: 'bulwark_plating', rarity: 'legendary', gear: 'u_mantle',
    flavour: 'Heavier than it should be. The dents are load-bearing now.',
    effect: 'Kills restore 4% of maximum hull. Heavy: -6% movement speed.',
    affixes: ['hullpct', 'resist'], extra: [s('armor', 'add', 14, 'flat'), s('moveSpeedMult', 'pct', -0.06)], drops: { sources: ['bulwark', 'colossus'], chance: 0.04 },
  },
  {
    id: 'logic_lattice', name: 'Overseer Logic Lattice', baseId: 'overseer_logic', rarity: 'exotic', gear: 'u_lattice',
    flavour: 'It still runs the old targeting heuristics. They are very good.',
    effect: 'Critical hits charge your ultimate by 1.5%.',
    affixes: ['critdmg', 'ucharge', 'tactical'], drops: { sources: ['overseer'], chance: 0.06 },
  },
  {
    id: 'tailwind', name: 'Skimmer Tailwind', baseId: 'servo_booster', rarity: 'legendary', gear: 'u_tailwind',
    flavour: 'Pulled from a skimmer mid-swoop. It wants to keep moving.',
    effect: 'Kills refund an extra 50% of a dash charge.',
    affixes: ['resist', 'tactical'], extra: [s('moveSpeedMult', 'pct', 0.06)], drops: { sources: ['skimmer', 'elite'], faction: 'crucible', chance: 0.035 },
  },
  {
    id: 'frost_aegis', name: 'Frostbound Aegis', baseId: 'barrier_lattice', rarity: 'legendary', gear: 'u_frostaegis',
    flavour: 'The barrier hums colder the closer the enemy gets.',
    effect: 'Hits on chilled or frozen machines restore 1% of maximum shield.',
    affixes: ['armor', 'resist'], extra: [s('shieldCapacity', 'add', 10, 'flat')], drops: { sources: ['elite', 'eliteCache', 'burrower'], faction: 'rime', chance: 0.04 },
  },
  {
    id: 'reactor_heart', name: 'Colossus Reactor Heart', baseId: 'fusion_cell', rarity: 'exotic', gear: 'u_reactorheart',
    flavour: 'Still warm. Always warm.',
    effect: 'Weapon hits deal +30% damage while weapon heat is above 60%. Runs hot: -10% heat efficiency.',
    affixes: ['cool', 'tactical'], extra: [s('heatEfficiency', 'pct', -0.1)], drops: { sources: ['colossus'], chance: 0.06 },
  },
  {
    id: 'monocle', name: "Marksman's Monocle", baseId: 'targeting_lens', rarity: 'legendary', gear: 'u_monocle',
    flavour: 'Prised from a marksman that had painted you three times.',
    effect: 'Weapon hits on machines more than 30 m away deal +35% damage.',
    affixes: ['move', 'dash'], extra: [s('critChance', 'add', 0.04)], drops: { sources: ['marksman', 'elite'], faction: 'scrap', chance: 0.035 },
  },
  {
    id: 'last_fuse', name: "Sapper's Last Fuse", baseId: 'frag_charge', rarity: 'legendary',
    flavour: 'Two seconds is a long time if you are the one holding it.',
    effect: 'A far bigger, harder charge: +60% ability power and +30% radius, at +25% cooldown.',
    affixes: ['apower', 'aradius'], extra: [s('abilityPowerMult', 'pct', 0.6), s('abilityRadiusMult', 'pct', 0.3), s('abilityCooldownMult', 'pct', 0.25)], drops: { sources: ['sapper', 'elite'], faction: 'scrap', chance: 0.04 },
  },
  {
    id: 'orbital_writ', name: 'Orbital Writ', baseId: 'orbital_lance', rarity: 'exotic',
    flavour: 'Signed authority to call fire from orbit. Nobody remembers who signed it.',
    effect: 'The lance answers faster: +50% ultimate charge and +25% ability power.',
    affixes: ['ucharge', 'apower'], extra: [s('ultChargeMult', 'pct', 0.5), s('abilityPowerMult', 'pct', 0.25)], drops: { sources: ['hvt', 'overseer'], chance: 0.05 },
  },
];

const BY_ID = new Map(UNIQUES.map((u) => [u.id, u]));
export const uniqueDef = (id: string | null | undefined): UniqueDef | null => (id ? BY_ID.get(id) ?? null : null);

/** Deterministic 0..1 from a drop seed and a unique id (independent of every random stream). */
export function uniqueChance(seed: number, id: string): number {
  return (hashSeed(`unique:${id}:${seed >>> 0}`) >>> 0) / 4294967296;
}

/** The unique a drop of `source` becomes (or null): listed source, matching faction, seed-based chance. */
/**
 * The unique a drop turns into (seed-decided), if any. A unique only drops once its rarity is open on the Rift Level
 * (`RARITY_UNLOCK`: legendary uniques from RL 7, exotic ones from RL 12) and its family/category is unlocked.
 */
export function uniqueForDrop(source: string, seed: number, faction: string | null | undefined, rl = 999, locked: { families?: readonly string[]; categories?: readonly string[] } = {}): UniqueDef | null {
  for (const u of UNIQUES) {
    if (!u.drops.sources.includes(source)) continue;
    if (u.drops.faction && u.drops.faction !== faction) continue;
    if (RARITY_UNLOCK[u.rarity] > rl) continue;
    const base = baseDef(u.baseId);
    if (base && (locked.categories?.includes(base.category) || (base.weapon && locked.families?.includes(base.weapon.family)))) continue;
    if (uniqueChance(seed, u.id) < u.drops.chance) return u;
  }
  return null;
}

/** Uniques a source can drop in a faction's sector (codex / tooltips / tests). */
export function uniquesFrom(source: string, faction?: string | null): UniqueDef[] {
  return UNIQUES.filter((u) => u.drops.sources.includes(source) && (!u.drops.faction || u.drops.faction === faction));
}

function scaled(u: UniqueStat, level: number): RolledStat {
  const k = u.scaling === 'flat' ? flatScale(level) : u.scaling === 'pct' ? pctScale(level) : 1;
  const v = u.value * k;
  const flat = STAT_DEFS[u.stat].kind === 'flat';
  return { stat: u.stat, op: u.op, value: flat ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000 };
}

/** Generate a unique at a level (same seed + level -> same item). */
export function generateUnique(def: UniqueDef, spec: { uid: string; seed: number; level: number; source: string; now?: number }): ItemInstance {
  const it = generateItem({ uid: spec.uid, seed: spec.seed, level: spec.level, rarity: def.rarity, baseId: def.baseId, allowExclusive: [def.baseId], source: spec.source, now: spec.now });
  const rand = mulberry32((spec.seed ^ 0x7a1e5e11) >>> 0);
  const r = rarity(def.rarity);
  const tier = maxTierFor(it.level);
  it.affixes = def.affixes.map((id) => affixDef(id)).filter((a): a is NonNullable<typeof a> => !!a).map((a) => rollAffix(a, tier, 0.7 + 0.3 * rand(), it.level, r));
  it.base = [...it.base, ...(def.extra ?? []).map((x) => scaled(x, it.level))];
  if (it.weapon && def.element) it.weapon.element = def.element;
  it.signature = def.signature ?? null;
  it.uniqueId = def.id;
  it.name = def.name;
  return it;
}

const SOURCE_LABEL: Record<string, string> = {
  colossus: 'Siege Colossus', overseer: 'Overseer Core', hvt: 'Vault Couriers', elite: 'elites', eliteCache: 'elite caches', bulwark: 'Bulwarks',
  burrower: 'Burrowers', skimmer: 'Skimmers', sapper: 'Sappers', marksman: 'Marksmen',
};
const FACTION_LABEL: Record<string, string> = { scrap: 'Scrapline (outpost)', rime: 'Rime (cryo)', crucible: 'Crucible (foundry)' };

/** "Siege Colossus" / "elites, Burrowers · Rime (cryo) sectors" (item cards, codex). */
export function uniqueSourceText(def: UniqueDef): string {
  const src = def.drops.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ');
  return def.drops.faction ? `${src} · ${FACTION_LABEL[def.drops.faction] ?? def.drops.faction} sectors` : src;
}

/** Equipped-effect ids of the unique gear among `items` (the weapon in hand's signature is read separately). */
export function gearUniques(items: readonly ItemInstance[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    const g = uniqueDef(it.uniqueId)?.gear;
    if (g) out.add(g);
  }
  return out;
}

/** True when a definition points at a real base of a matching category (data validation). */
export function isValidUnique(def: UniqueDef): boolean {
  const b = baseDef(def.baseId);
  return !!b && def.affixes.every((id) => (affixDef(id)?.weights[b.category] ?? 0) > 0 && !b.implicit.some((x) => x.stat === affixDef(id)!.stat)) && new Set(def.affixes.map((id) => affixDef(id)?.group)).size === def.affixes.length && (!def.signature || b.category === 'weapon') && (!def.gear || b.category !== 'weapon');
}
