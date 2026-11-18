import type { Element } from '../combat/events';

/**
 * M5 modular towers (pure). A tower = Base + Weapon module + Power core + Modifier.
 *  - Base: footprint, turn rate, range/damage factors, which weapons it can mount. Fixed at build time.
 *  - Weapon: defines the archetype (ballistic / arc / cryo field), numbers, element, targeting.
 *  - Core: energy characteristics (rate/damage trade-offs, elemental bonuses).
 *  - Modifier: special behaviour (extra targets / chain, splash, crit, range, field size).
 * Compatibility is explicit (`canInstall`); stats are always recomputed from scratch by
 * `composeTower`, so replacing a part can never leave stale bonuses behind.
 */
export type Archetype = 'ballistic' | 'arc' | 'cryo' | 'missile' | 'support';
export type TowerSlot = 'base' | 'weapon' | 'core' | 'modifier';
export const TOWER_SLOTS: readonly TowerSlot[] = ['base', 'weapon', 'core', 'modifier'];
export const SWAPPABLE_SLOTS: readonly TowerSlot[] = ['weapon', 'core', 'modifier'];

export interface TowerConfig {
  base: string;
  weapon: string;
  core: string;
  modifier: string;
}

export interface TechCost {
  credits: number;
  components: number;
  /** Best wave ever cleared (any tier) needed before the blueprint can be researched. */
  wave: number;
}

interface PartCommon {
  id: string;
  name: string;
  blurb: string;
  /** Construction / refit price in cores (before construction-efficiency modifiers). */
  cost: number;
  /** Absent = starter part (always owned). */
  tech?: TechCost;
}

export interface BaseDef extends PartCommon {
  radius: number;
  turnRate: number;
  rangeMult: number;
  damageMult: number;
  weapons: readonly string[];
  /** Visual scale of the pedestal. */
  look: 'standard' | 'bastion' | 'spire';
}

export interface WeaponModDef extends PartCommon {
  archetype: Archetype;
  element: Element;
  damage: number;
  fireRate: number;
  range: number;
  /** Extra enemies hit per attack (ballistic) / chain jumps (arc). */
  targets: number;
  chain: number;
  chainFalloff: number;
  critChance: number;
  /** Chill meter added per hit (cryo). */
  chill: number;
  /** Shock applied on hit (arc). */
  shock: boolean;
}

export interface CoreDef extends PartCommon {
  archetypes: readonly Archetype[];
  damageMult: number;
  fireRateMult: number;
  rangeMult: number;
  /** Multiplies chill/burn magnitudes of every hit. */
  elementalMult: number;
  /** Fraction of hit damage applied as burn dps (0 = none). */
  burnFrac: number;
  /** Chill added to every hit of non-cryo weapons. */
  chillHit: number;
  color: [number, number, number];
}

export interface ModifierDef extends PartCommon {
  archetypes: readonly Archetype[];
  targets: number;
  chain: number;
  splash: number;
  critChance: number;
  rangeMult: number;
  chillMult: number;
  look: 'none' | 'array' | 'shells' | 'optics' | 'dish' | 'lens';
}

const ALL: readonly Archetype[] = ['ballistic', 'arc', 'cryo', 'missile', 'support'];
const HIT: readonly Archetype[] = ['ballistic', 'arc', 'missile'];
const DAMAGE: readonly Archetype[] = ['ballistic', 'arc', 'cryo', 'missile'];

export const BASES: Readonly<Record<string, BaseDef>> = {
  standard: { id: 'standard', name: 'Standard Platform', blurb: 'Balanced pedestal. Mounts every weapon.', cost: 60, radius: 1.1, turnRate: 5, rangeMult: 1, damageMult: 1, weapons: ['autocannon', 'marksman', 'chain_emitter', 'frost_projector', 'missile_battery', 'support_amp'], look: 'standard' },
  bastion: { id: 'bastion', name: 'Bastion Mount', blurb: 'Heavy footing: +20% damage, slow traverse. Cannot mount field projectors.', cost: 90, radius: 1.35, turnRate: 3.4, rangeMult: 1, damageMult: 1.2, weapons: ['autocannon', 'marksman', 'chain_emitter', 'missile_battery'], look: 'bastion', tech: { credits: 250, components: 0, wave: 4 } },
  spire: { id: 'spire', name: 'Spire Pylon', blurb: 'Tall, fast mast: +20% range, quick traverse, -10% damage. Needs a precision or field weapon.', cost: 80, radius: 1.0, turnRate: 6.5, rangeMult: 1.2, damageMult: 0.9, weapons: ['marksman', 'chain_emitter', 'frost_projector', 'support_amp'], look: 'spire', tech: { credits: 300, components: 2, wave: 6 } },
};

export const WEAPONS: Readonly<Record<string, WeaponModDef>> = {
  autocannon: { id: 'autocannon', name: 'Autocannon', blurb: 'Ballistic Turret: accurate rapid single-target fire.', cost: 40, archetype: 'ballistic', element: 'none', damage: 15, fireRate: 3.2, range: 22, targets: 0, chain: 0, chainFalloff: 1, critChance: 0.05, chill: 0, shock: false },
  marksman: { id: 'marksman', name: 'Marksman Rail', blurb: 'Ballistic Turret: slow, heavy, long-range shots with high crit chance.', cost: 70, archetype: 'ballistic', element: 'none', damage: 54, fireRate: 0.9, range: 31, targets: 0, chain: 0, chainFalloff: 1, critChance: 0.18, chill: 0, shock: false, tech: { credits: 200, components: 0, wave: 2 } },
  chain_emitter: { id: 'chain_emitter', name: 'Chain Emitter', blurb: 'Arc Tower: electrical bolt that jumps between enemies and shocks them.', cost: 70, archetype: 'arc', element: 'electric', damage: 11, fireRate: 1.5, range: 18, targets: 0, chain: 3, chainFalloff: 0.72, critChance: 0.05, chill: 0, shock: true, tech: { credits: 300, components: 0, wave: 3 } },
  // ---- M7
  missile_battery: { id: 'missile_battery', name: 'Missile Battery', blurb: 'Siege launcher: slow salvos of four homing missiles with blast damage. Prioritises elites and bosses; huge range.', cost: 90, archetype: 'missile', element: 'none', damage: 20, fireRate: 0.45, range: 38, targets: 0, chain: 0, chainFalloff: 1, critChance: 0.08, chill: 0, shock: false, tech: { credits: 450, components: 3, wave: 8 } },
  support_amp: { id: 'support_amp', name: 'Support Amplifier', blurb: 'No weapon. Towers in its field gain +25% damage and +20% fire rate; machines in it take +10% damage from every source.', cost: 75, archetype: 'support', element: 'none', damage: 0.25, fireRate: 0.33, range: 11, targets: 0, chain: 0, chainFalloff: 1, critChance: 0, chill: 0, shock: false, tech: { credits: 400, components: 2, wave: 6 } },
  frost_projector: { id: 'frost_projector', name: 'Cryogenic Field Projector', blurb: 'Field emitter: pulses chill into every enemy in range. Slows, freezes, enables reactions.', cost: 80, archetype: 'cryo', element: 'cryo', damage: 3, fireRate: 1.2, range: 14, targets: 0, chain: 0, chainFalloff: 1, critChance: 0, chill: 20, shock: false, tech: { credits: 400, components: 0, wave: 5 } },
};

export const CORES: Readonly<Record<string, CoreDef>> = {
  standard_core: { id: 'standard_core', name: 'Standard Core', blurb: 'Stable reference core.', cost: 0, archetypes: ALL, damageMult: 1, fireRateMult: 1, rangeMult: 1, elementalMult: 1, burnFrac: 0, chillHit: 0, color: [0.2, 1.4, 1.8] },
  overcharged: { id: 'overcharged', name: 'Overcharged Core', blurb: '+30% fire rate at -10% damage per shot.', cost: 60, archetypes: HIT, damageMult: 0.9, fireRateMult: 1.3, rangeMult: 1, elementalMult: 1, burnFrac: 0, chillHit: 0, color: [2.4, 1.6, 0.3], tech: { credits: 350, components: 3, wave: 7 } },
  capacitor: { id: 'capacitor', name: 'Capacitor Core', blurb: '+25% damage, -15% fire rate (amplifiers: +25% boost).', cost: 60, archetypes: ALL, damageMult: 1.25, fireRateMult: 0.85, rangeMult: 1, elementalMult: 1, burnFrac: 0, chillHit: 0, color: [0.5, 1.2, 2.6], tech: { credits: 200, components: 0, wave: 4 } },
  thermal_core: { id: 'thermal_core', name: 'Thermal Core', blurb: 'Hits ignite enemies (30% of the hit per second, 4 s).', cost: 70, archetypes: HIT, damageMult: 1, fireRateMult: 1, rangeMult: 1, elementalMult: 1, burnFrac: 0.3, chillHit: 0, color: [2.6, 0.9, 0.15], tech: { credits: 300, components: 2, wave: 5 } },
  cryo_core: { id: 'cryo_core', name: 'Cryo Core', blurb: 'Hits add chill; cryo fields +40% chill and +10% range.', cost: 70, archetypes: DAMAGE, damageMult: 1, fireRateMult: 1, rangeMult: 1.1, elementalMult: 1.4, burnFrac: 0, chillHit: 9, color: [1.2, 2.0, 2.6], tech: { credits: 300, components: 2, wave: 5 } },
};

export const MODIFIERS: Readonly<Record<string, ModifierDef>> = {
  none: { id: 'none', name: 'No Modifier', blurb: 'Empty modifier bay.', cost: 0, archetypes: ALL, targets: 0, chain: 0, splash: 0, critChance: 0, rangeMult: 1, chillMult: 1, look: 'none' },
  multi_target: { id: 'multi_target', name: 'Multi-Target Amplifier', blurb: 'Ballistic: fires at +2 targets. Arc: chains +2 jumps. Missiles: +2 per salvo.', cost: 80, archetypes: HIT, targets: 2, chain: 2, splash: 0, critChance: 0, rangeMult: 1, chillMult: 1, look: 'array', tech: { credits: 350, components: 3, wave: 6 } },
  splash_shells: { id: 'splash_shells', name: 'Splash Shells', blurb: 'Ballistic hits detonate: 50% damage in 3.2 m. Missiles: +60% blast radius.', cost: 70, archetypes: ['ballistic', 'missile'], targets: 0, chain: 0, splash: 3.2, critChance: 0, rangeMult: 1, chillMult: 1, look: 'shells', tech: { credits: 250, components: 0, wave: 3 } },
  crit_optics: { id: 'crit_optics', name: 'Crit Optics', blurb: '+25% critical chance.', cost: 60, archetypes: HIT, targets: 0, chain: 0, splash: 0, critChance: 0.25, rangeMult: 1, chillMult: 1, look: 'optics', tech: { credits: 200, components: 0, wave: 2 } },
  range_amp: { id: 'range_amp', name: 'Range Amplifier', blurb: '+20% targeting range.', cost: 50, archetypes: ALL, targets: 0, chain: 0, splash: 0, critChance: 0, rangeMult: 1.2, chillMult: 1, look: 'dish', tech: { credits: 150, components: 0, wave: 2 } },
  field_amp: { id: 'field_amp', name: 'Field Amplifier', blurb: 'Cryo field: +15% radius and +30% chill per pulse. Amplifier: +15% radius and +30% boost.', cost: 70, archetypes: ['cryo', 'support'], targets: 0, chain: 0, splash: 0, critChance: 0, rangeMult: 1.15, chillMult: 1.3, look: 'lens', tech: { credits: 250, components: 2, wave: 5 } },
};

export const DEFAULT_CONFIG: Readonly<TowerConfig> = { base: 'standard', weapon: 'autocannon', core: 'standard_core', modifier: 'none' };
export const MAX_TOWER_LEVEL = 5;

const TABLES = { base: BASES, weapon: WEAPONS, core: CORES, modifier: MODIFIERS } as const;
type AnyPart = BaseDef | WeaponModDef | CoreDef | ModifierDef;

export function partDef(slot: TowerSlot, id: string): AnyPart | null {
  return (TABLES[slot] as Record<string, AnyPart>)[id] ?? null;
}
export const partsFor = (slot: TowerSlot): AnyPart[] => Object.values(TABLES[slot]) as AnyPart[];
export const techKey = (slot: TowerSlot, id: string) => `${slot}:${id}`;

/** All researchable blueprints (parts with a tech cost). */
export const TECH_LIST: readonly { slot: TowerSlot; id: string; name: string; tech: TechCost }[] = TOWER_SLOTS.flatMap((slot) =>
  partsFor(slot).filter((p) => p.tech).map((p) => ({ slot, id: p.id, name: p.name, tech: p.tech! })),
);

/** Starter blueprints (always unlocked). */
export const STARTER_TECH: readonly string[] = TOWER_SLOTS.flatMap((slot) => partsFor(slot).filter((p) => !p.tech).map((p) => techKey(slot, p.id)));

export const isUnlocked = (unlocked: ReadonlySet<string> | readonly string[], slot: TowerSlot, id: string): boolean => {
  const key = techKey(slot, id);
  const p = partDef(slot, id);
  if (!p) return false;
  if (!p.tech) return true;
  return Array.isArray(unlocked) ? unlocked.includes(key) : (unlocked as ReadonlySet<string>).has(key);
};

/** Explicit compatibility rules. Returns null when valid, else the reason. */
export function compatibility(cfg: TowerConfig): string | null {
  const b = BASES[cfg.base];
  const w = WEAPONS[cfg.weapon];
  const c = CORES[cfg.core];
  const m = MODIFIERS[cfg.modifier];
  if (!b || !w || !c || !m) return 'Unknown component';
  if (!b.weapons.includes(w.id)) return `${b.name} cannot mount the ${w.name}`;
  if (!c.archetypes.includes(w.archetype)) return `${c.name} is incompatible with ${w.archetype} weapons`;
  if (!m.archetypes.includes(w.archetype)) return `${m.name} is incompatible with ${w.archetype} weapons`;
  return null;
}

export function canInstall(cfg: TowerConfig, slot: TowerSlot, id: string): string | null {
  if (!partDef(slot, id)) return 'Unknown component';
  return compatibility({ ...cfg, [slot]: id });
}

/** Components of `slot` that fit this tower and are owned (the refit menu). */
export function availableParts(cfg: TowerConfig, slot: TowerSlot, unlocked: ReadonlySet<string> | readonly string[]): AnyPart[] {
  return partsFor(slot).filter((p) => isUnlocked(unlocked, slot, p.id) && canInstall(cfg, slot, p.id) === null);
}

/** Construction price of a full configuration (cores). */
export function configCost(cfg: TowerConfig, costMult = 1): number {
  const sum = TOWER_SLOTS.reduce((s, slot) => s + (partDef(slot, cfg[slot])?.cost ?? 0), 0);
  return Math.max(1, Math.round(sum * (Number.isFinite(costMult) ? costMult : 1)));
}

/** Net price of replacing a part (new price minus half the old one, never negative). */
export function swapCost(cfg: TowerConfig, slot: TowerSlot, id: string, costMult = 1): number {
  const next = partDef(slot, id);
  const cur = partDef(slot, cfg[slot]);
  if (!next || !cur || next.id === cur.id) return 0;
  return Math.max(0, Math.round((next.cost - cur.cost * 0.5) * costMult));
}

export function levelCost(cfg: TowerConfig, level: number, costMult = 1): number {
  const total = TOWER_SLOTS.reduce((s, slot) => s + (partDef(slot, cfg[slot])?.cost ?? 0), 0);
  return Math.max(1, Math.round(total * 0.45 * level * costMult));
}

/** Run-level inputs to tower stats (from CombatStats + run upgrades + temporary empowerment). */
export interface TowerRunInput {
  damageMult: number;
  fireRateMult: number;
  rangeMult: number;
  extraTargets: number;
  extraChain: number;
  /** Fraction of each hit applied as burn dps by run upgrades. */
  burnFrac: number;
  empowered: boolean;
}
export const NO_RUN_INPUT: TowerRunInput = { damageMult: 1, fireRateMult: 1, rangeMult: 1, extraTargets: 0, extraChain: 0, burnFrac: 0, empowered: false };

export const EMPOWER_RATE = 1.4;
export const EMPOWER_CHAIN = 2;

export interface TowerStats {
  archetype: Archetype;
  element: Element;
  damage: number;
  fireRate: number;
  range: number;
  turnRate: number;
  radius: number;
  critChance: number;
  /** Extra simultaneous targets (ballistic). */
  targets: number;
  /** Chain jumps (arc). */
  chain: number;
  chainFalloff: number;
  splash: number;
  chill: number;
  burnFrac: number;
  shock: boolean;
  /** dps against a single target (diagnostics/UI). */
  dps: number;
}

/**
 * Single source of truth for a tower's numbers:
 * base x weapon x core x modifier x level x run stats x empowerment. Pure and deterministic.
 */
export function composeTower(cfg: TowerConfig, level: number, run: TowerRunInput = NO_RUN_INPUT): TowerStats {
  const b = BASES[cfg.base] ?? BASES.standard;
  const w = WEAPONS[cfg.weapon] ?? WEAPONS.autocannon;
  const c = CORES[cfg.core] ?? CORES.standard_core;
  const m = MODIFIERS[cfg.modifier] ?? MODIFIERS.none;
  const L = Math.max(1, Math.min(MAX_TOWER_LEVEL, Math.floor(level) || 1));
  const damage = w.damage * b.damageMult * c.damageMult * (1 + 0.14 * (L - 1)) * run.damageMult;
  const fireRate = w.fireRate * c.fireRateMult * (1 + 0.06 * (L - 1)) * run.fireRateMult * (run.empowered ? EMPOWER_RATE : 1);
  const range = w.range * b.rangeMult * c.rangeMult * m.rangeMult * run.rangeMult;
  const arc = w.archetype === 'arc';
  const ballistic = w.archetype === 'ballistic';
  const missile = w.archetype === 'missile';
  const element: Element = w.element !== 'none' ? w.element : c.burnFrac > 0 && ballistic ? 'thermal' : 'none';
  const chain = arc ? w.chain + m.chain + run.extraChain + (run.empowered ? EMPOWER_CHAIN : 0) : 0;
  const targets = ballistic ? w.targets + m.targets + run.extraTargets : missile ? 4 + m.targets + run.extraTargets : 0;
  const chill = w.archetype === 'cryo' ? w.chill * c.elementalMult * m.chillMult : c.chillHit;
  const stats: TowerStats = {
    archetype: w.archetype,
    element,
    damage,
    fireRate,
    range,
    turnRate: b.turnRate,
    radius: b.radius,
    critChance: Math.min(1, w.critChance + m.critChance),
    targets,
    chain,
    chainFalloff: w.chainFalloff,
    splash: missile ? 3.4 * (m.splash > 0 ? 1.6 : 1) : m.splash,
    chill,
    burnFrac: c.burnFrac + run.burnFrac,
    shock: w.shock,
    dps: 0,
  };
  stats.dps = damage * fireRate * (missile ? stats.targets : 1 + stats.targets * (ballistic ? 1 : 0));
  if (w.archetype === 'support') {
    // Amplifier: `damage` is the boost fraction (core damage, field amplifier and level raise it).
    stats.damage = w.damage * c.damageMult * m.chillMult * (1 + 0.1 * (L - 1));
    stats.dps = 0;
  }
  return stats;
}

/** Human label of the archetype a part belongs to (UI). */
export function archetypeOf(slot: TowerSlot, id: string): string {
  const p = partDef(slot, id);
  if (!p) return '';
  if (slot === 'weapon') return (p as WeaponModDef).archetype;
  if (slot === 'base') return 'platform';
  const a = (p as CoreDef | ModifierDef).archetypes;
  return a.length >= 5 ? 'all archetypes' : a.join(' / ');
}
