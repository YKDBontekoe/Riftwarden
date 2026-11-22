/**
 * Damage elements (pure). Six types; every weapon rolls exactly one, towers take theirs from their weapon / core.
 *
 *  kinetic   - neutral: no status, x1 against shields.
 *  thermal   - ignites (burn DoT).
 *  electric  - chance to shock (disrupts), x1.5 against shields.
 *  cryo      - builds the chill meter (slow -> freeze).
 *  corrosive - corrodes: stacking DoT that shreds armour (more damage taken, elite plating strips faster).
 *  void      - pierces shields (energy barriers and frontal shields), no status.
 *
 * Resistances: each faction is weak to two elements (x WEAK) and resists two (x RESIST); every element is a
 * weakness once and a resistance once across the three factions. Archetype / mutation overrides and boss rows
 * multiply on top, clamped to [AFFINITY_MIN, AFFINITY_MAX]. The classic arena has no faction (neutral).
 */
import type { EnemyKind } from '../data/defs';
import type { EliteModId } from '../survival/elites';

export type DamageElement = 'kinetic' | 'thermal' | 'electric' | 'cryo' | 'corrosive' | 'void';
export type WeaponFamilyId = 'plasma' | 'rail' | 'beam' | 'swarm';

export const ELEMENTS: readonly DamageElement[] = ['kinetic', 'thermal', 'electric', 'cryo', 'corrosive', 'void'];

export interface ElementInfo {
  id: DamageElement;
  name: string;
  /** Three-letter tag for chips. */
  short: string;
  /** HDR colour for energy materials / fx. */
  color: [number, number, number];
  /** UI colour. */
  css: string;
  blurb: string;
}

export const ELEMENT_INFO: Record<DamageElement, ElementInfo> = {
  kinetic: { id: 'kinetic', name: 'Kinetic', short: 'KIN', color: [2.2, 2.1, 1.9], css: '#d9d4c8', blurb: 'Neutral: no status effect, never shifts with temperature.' },
  thermal: { id: 'thermal', name: 'Thermal', short: 'THR', color: [3.4, 1.1, 0.18], css: '#ff7a2e', blurb: 'Hits ignite machines (burn damage over time).' },
  electric: { id: 'electric', name: 'Electric', short: 'ELC', color: [0.7, 1.6, 4], css: '#6cb6ff', blurb: 'Chance to shock (disrupts movement and attacks); +50% damage to shields.' },
  cryo: { id: 'cryo', name: 'Cryo', short: 'CRY', color: [1.5, 2.6, 3.3], css: '#9fe6ff', blurb: 'Builds chill: slows, then freezes (+25% damage taken).' },
  corrosive: { id: 'corrosive', name: 'Corrosive', short: 'COR', color: [1.2, 2.9, 0.35], css: '#9be04a', blurb: 'Corrodes: stacking damage over time that shreds armour (+5% damage taken per stack).' },
  void: { id: 'void', name: 'Void', short: 'VOI', color: [2.2, 0.5, 3.4], css: '#c070ff', blurb: 'Pierces shields and energy barriers: damage goes straight to the hull.' },
};

export const isDamageElement = (x: unknown): x is DamageElement => typeof x === 'string' && (ELEMENTS as readonly string[]).includes(x);
/** Elements that scale with elemental power and apply a status. */
export const isElemental = (x: string): boolean => x !== 'none' && x !== 'kinetic';

// ------------------------------------------------------------------ affinities

export const WEAK = 1.35;
export const RESIST = 0.65;
export const AFFINITY_MIN = 0.4;
export const AFFINITY_MAX = 1.8;

export interface Affinity {
  weak: readonly DamageElement[];
  resist: readonly DamageElement[];
}

/** Per faction id (`world/biomes.ts`). */
export const FACTION_AFFINITY: Record<string, Affinity> = {
  scrap: { weak: ['electric', 'void'], resist: ['kinetic', 'corrosive'] },
  rime: { weak: ['thermal', 'corrosive'], resist: ['cryo', 'electric'] },
  crucible: { weak: ['cryo', 'kinetic'], resist: ['thermal', 'void'] },
};

/** Bosses replace the faction row with their own. */
export const BOSS_AFFINITY: Partial<Record<EnemyKind, Affinity>> = {
  colossus: { weak: ['corrosive', 'electric'], resist: ['kinetic', 'cryo'] },
  overseer: { weak: ['void', 'kinetic'], resist: ['electric', 'thermal'] },
};

/** Heavy plated frames corrode easily. */
const PLATED: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['bulwark', 'enforcer', 'crawler']);

export interface AffinityTarget {
  kind: EnemyKind;
  mods: readonly EliteModId[];
}

const rowMult = (row: Affinity | undefined, el: DamageElement) => (!row ? 1 : row.weak.includes(el) ? WEAK : row.resist.includes(el) ? RESIST : 1);

/** Damage multiplier of `element` against `t` in a sector held by `faction` (null = neutral arena). */
export function affinity(element: string, t: AffinityTarget, faction: string | null | undefined): number {
  if (!isDamageElement(element)) return 1;
  const boss = BOSS_AFFINITY[t.kind];
  let m = boss ? rowMult(boss, element) : rowMult(faction ? FACTION_AFFINITY[faction] : undefined, element);
  if (element === 'corrosive' && (PLATED.has(t.kind) || t.mods.includes('armored'))) m *= 1.25;
  if (element === 'cryo' && t.mods.includes('frostbound')) m *= 0.6;
  if (element === 'thermal' && t.mods.includes('molten')) m *= 0.6;
  if (element === 'void' && t.mods.includes('shielded')) m *= 1.15;
  return Math.min(AFFINITY_MAX, Math.max(AFFINITY_MIN, m));
}

/** Sector-wide hint for an element against a faction's base row (HUD): +1 weak, -1 resisted, 0 neutral. */
export function sectorAffinity(element: string, faction: string | null | undefined): -1 | 0 | 1 {
  const row = faction ? FACTION_AFFINITY[faction] : undefined;
  if (!row || !isDamageElement(element)) return 0;
  return row.weak.includes(element) ? 1 : row.resist.includes(element) ? -1 : 0;
}

/** +1 weak, -1 resisted, 0 neutral (for numbers / tags). */
export const affinitySign = (m: number): -1 | 0 | 1 => (m > 1.02 ? 1 : m < 0.98 ? -1 : 0);

// ------------------------------------------------------------------ weapon rolls

/** Chance that a weapon of this rarity index rolls kinetic (common .. exotic). */
export const KINETIC_CHANCE = [0.6, 0.45, 0.32, 0.24, 0.18, 0.14, 0.1];

/** Family leanings for the elemental share. */
export const FAMILY_ELEMENTS: Record<WeaponFamilyId, Record<Exclude<DamageElement, 'kinetic'>, number>> = {
  plasma: { thermal: 1, electric: 1, cryo: 1, corrosive: 1, void: 0.6 },
  rail: { thermal: 0.6, electric: 1, cryo: 0.8, corrosive: 0.6, void: 1.4 },
  beam: { thermal: 1.4, electric: 1.2, cryo: 1, corrosive: 0.8, void: 0.5 },
  swarm: { thermal: 0.8, electric: 1.4, cryo: 0.7, corrosive: 1.4, void: 0.6 },
};

/** Roll a weapon element from its own random stream (so other item rolls do not shift). */
export function rollElement(family: WeaponFamilyId, rarityIndex: number, rand: () => number): DamageElement {
  const k = KINETIC_CHANCE[Math.max(0, Math.min(KINETIC_CHANCE.length - 1, rarityIndex | 0))];
  if (rand() < k) return 'kinetic';
  const w = FAMILY_ELEMENTS[family] ?? FAMILY_ELEMENTS.plasma;
  const ids = Object.keys(w) as (keyof typeof w)[];
  let total = 0;
  for (const id of ids) total += w[id];
  let x = rand() * total;
  for (const id of ids) {
    x -= w[id];
    if (x <= 0) return id;
  }
  return ids[ids.length - 1];
}

// ------------------------------------------------------------------ status payloads

export interface ElementPayload {
  /** Burn dps per stack. */
  burn?: number;
  chill?: number;
  shock?: boolean;
  /** Corrode dps per stack. */
  corrode?: number;
}

/**
 * Per-hit status weight from the number of hits per second, so a beam (15 ticks/s) and a rail (1 slug/s)
 * build statuses at a comparable rate: 1 at 8 hits/s, bounded [0.25, 4].
 */
export function procWeight(hitsPerSecond: number): number {
  if (!(hitsPerSecond > 0)) return 1;
  return Math.max(0.25, Math.min(4, 8 / hitsPerSecond));
}

export const PROC = { burnFrac: 0.16, shockChance: 0.12, chill: 7, corrodeFrac: 0.09 };

/** Status a weapon hit of `element` applies (`hit` = damage of the hit, `weight` = procWeight; `roll` in [0,1)). */
export function elementPayload(element: string, hit: number, weight: number, roll: number): ElementPayload | undefined {
  if (!(hit > 0)) return undefined;
  const w2 = Math.min(2, weight);
  switch (element) {
    case 'thermal': return { burn: hit * PROC.burnFrac * w2 };
    case 'electric': return roll < Math.min(1, PROC.shockChance * weight) ? { shock: true } : undefined;
    case 'cryo': return { chill: PROC.chill * weight };
    case 'corrosive': return { corrode: hit * PROC.corrodeFrac * w2 };
    default: return undefined;
  }
}

/** Shield effectiveness (void bypasses shields entirely). */
export const shieldMult = (element: string): number => (element === 'electric' ? 1.5 : 1);
export const piercesShields = (element: string): boolean => element === 'void';

/** Weapon energy colour: elemental weapons glow mostly in their element's colour, so it reads at a glance. */
export function elementEnergy(family: readonly number[], element?: string): [number, number, number] {
  const el = element && isElemental(element) && isDamageElement(element) ? ELEMENT_INFO[element].color : null;
  return el ? [family[0] * 0.2 + el[0] * 0.8, family[1] * 0.2 + el[1] * 0.8, family[2] * 0.2 + el[2] * 0.8] : [family[0], family[1], family[2]];
}
