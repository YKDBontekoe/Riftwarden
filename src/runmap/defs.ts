import type { StatKey, StatOp } from '../combat/stats';
import type { EventId } from '../survival/events';
import type { BossId } from '../survival/bosses';

/**
 * Branching run map: node kinds, node modifiers, act curses / blessings and anomalies (pure data).
 * Rules live in map.ts (generation), hub.ts (non-combat nodes) and carry.ts (what crosses nodes).
 */

/** Combat kinds play a 5-wave segment (the global wave count continues); hubs are short visits without waves. */
export type NodeKind = 'combat' | 'elite' | 'boss' | 'merchant' | 'forge' | 'event' | 'vault' | 'rest';
export const COMBAT_KINDS: readonly NodeKind[] = ['combat', 'elite', 'boss'];
export const isCombatKind = (k: NodeKind): boolean => COMBAT_KINDS.includes(k);

export interface NodeKindDef {
  id: NodeKind;
  name: string;
  /** Map glyph (single character, drawn in the node badge). */
  glyph: string;
  /** One line for the map card. */
  blurb: string;
  /** Reward hint for the map card. */
  reward: string;
  /** 0 safe .. 3 deadly (map card risk pips). */
  risk: number;
}

export const NODE_KINDS: Record<NodeKind, NodeKindDef> = {
  combat: { id: 'combat', name: 'Combat Sector', glyph: '⚔', blurb: 'Hold the reactor for five waves.', reward: 'Wave loot + checkpoint cache', risk: 1 },
  elite: { id: 'elite', name: 'Elite Sector', glyph: '◆', blurb: 'Elite packs and heavier mutations.', reward: 'Elite cache + rift shards', risk: 2 },
  boss: { id: 'boss', name: 'Warlord Sector', glyph: '☠', blurb: 'A boss commands the final wave.', reward: 'Boss loot · unique chances', risk: 3 },
  merchant: { id: 'merchant', name: 'Rift Merchant', glyph: '¤', blurb: 'Trade cores for gear, upgrades and repairs.', reward: 'Shop (cores)', risk: 0 },
  forge: { id: 'forge', name: 'Field Forge', glyph: '⚒', blurb: 'Temper the drone and its towers for this run.', reward: 'Run buffs · blueprint', risk: 0 },
  event: { id: 'event', name: 'Anomaly', glyph: '?', blurb: 'An unknown rift phenomenon. Risk for reward.', reward: 'Gamble · curses · blessings', risk: 1 },
  vault: { id: 'vault', name: 'Sealed Vault', glyph: '▣', blurb: 'Crack the vault, survive its guardians.', reward: 'Vault cache + shards', risk: 2 },
  rest: { id: 'rest', name: 'Safe Harbour', glyph: '✚', blurb: 'Repair, reflect or purge a curse.', reward: 'Repair · upgrade · purge', risk: 0 },
};

/** Numeric effect of node modifiers, curses and blessings on a combat segment (all multiplicative, 1 = none). */
export interface NodeEffect {
  hp?: number;
  damage?: number;
  speed?: number;
  /** Elite chance multiplier. */
  elite?: number;
  /** Encounter budget multiplier (extra budget becomes HP, never more entities past the cap). */
  budget?: number;
  /** Loot luck multiplier (rarity). */
  luck?: number;
  /** Drop chance multiplier. */
  drops?: number;
  /** Run income: salvage and credits. */
  income?: number;
  /** Cores earned (wave clears, kills). */
  cores?: number;
  /** Rift shards granted at the end of the segment. */
  shards?: number;
  /** Tower construction disabled. */
  noTowers?: boolean;
  /** Force this event on the segment's middle wave. */
  event?: EventId;
}

export interface StatMod {
  stat: StatKey;
  op: StatOp;
  value: number;
}

export type NodeModId = 'elite_surge' | 'fortified' | 'blitz' | 'no_towers' | 'bounty' | 'swarm' | 'scarcity' | 'hunt';

export interface NodeModDef {
  id: NodeModId;
  name: string;
  text: string;
  /** Map chip tone. */
  tone: 'risk' | 'reward' | 'mixed';
  effect: NodeEffect;
  /** Only combat kinds roll modifiers; some are restricted further. */
  kinds?: NodeKind[];
}

export const NODE_MODS: Record<NodeModId, NodeModDef> = {
  elite_surge: { id: 'elite_surge', name: 'Elite Surge', text: 'Elite chance x2 · loot luck +30%', tone: 'mixed', effect: { elite: 2, luck: 1.3 } },
  fortified: { id: 'fortified', name: 'Fortified', text: 'Hostiles +25% HP · loot luck +30% · income +20%', tone: 'mixed', effect: { hp: 1.25, luck: 1.3, income: 1.2 } },
  blitz: { id: 'blitz', name: 'Blitz', text: 'Hostiles +15% speed · income +25%', tone: 'mixed', effect: { speed: 1.15, income: 1.25 } },
  no_towers: { id: 'no_towers', name: 'Null Field', text: 'No tower construction · income +40%', tone: 'risk', effect: { noTowers: true, income: 1.4 } },
  bounty: { id: 'bounty', name: 'Bounty', text: 'Hostiles +15% damage · income +50%', tone: 'reward', effect: { damage: 1.15, income: 1.5 } },
  swarm: { id: 'swarm', name: 'Swarm Front', text: 'A swarm event is guaranteed · drop chance +25%', tone: 'mixed', effect: { event: 'swarm', drops: 1.25 } },
  scarcity: { id: 'scarcity', name: 'Scarcity', text: 'Cores -40% · loot luck +50%', tone: 'risk', effect: { cores: 0.6, luck: 1.5 } },
  hunt: { id: 'hunt', name: 'High-Value Target', text: 'A vault courier is guaranteed · +1 rift shard', tone: 'reward', effect: { event: 'hvt', shards: 1 }, kinds: ['combat', 'elite'] },
};
export const NODE_MOD_IDS = Object.keys(NODE_MODS) as NodeModId[];

/** Per-kind segment effect (on top of the modifiers). */
export const KIND_EFFECT: Partial<Record<NodeKind, NodeEffect>> = {
  elite: { elite: 2.4, budget: 1.1, luck: 1.4, shards: 2 },
  boss: { luck: 1.2, shards: 1 },
};

// ------------------------------------------------------------------ curses and blessings (act-persistent)

export type CurseId = 'brittle' | 'famine' | 'hunted' | 'overclock' | 'static' | 'rust';
export type BlessingId = 'resonance' | 'aegis' | 'fortune';

export interface ActEffectDef {
  id: string;
  name: string;
  text: string;
  effect?: NodeEffect;
  stats?: StatMod[];
}

export const CURSES: Record<CurseId, ActEffectDef> = {
  brittle: { id: 'brittle', name: 'Brittle Hull', text: 'Max hull -20%', stats: [{ stat: 'maxHealthMult', op: 'pct', value: -0.2 }] },
  famine: { id: 'famine', name: 'Famine', text: 'Cores earned -30%', effect: { cores: 0.7 } },
  hunted: { id: 'hunted', name: 'Hunted', text: 'Elite chance +50%', effect: { elite: 1.5 } },
  overclock: { id: 'overclock', name: 'Overclocked Foes', text: 'Hostile damage +15%', effect: { damage: 1.15 } },
  static: { id: 'static', name: 'Static Bleed', text: 'Ability cooldowns +25%', stats: [{ stat: 'abilityCooldownMult', op: 'pct', value: 0.25 }] },
  rust: { id: 'rust', name: 'Rust Rot', text: 'Weapon cooling -20%', stats: [{ stat: 'coolRateMult', op: 'pct', value: -0.2 }] },
};
export const CURSE_IDS = Object.keys(CURSES) as CurseId[];

export const BLESSINGS: Record<BlessingId, ActEffectDef> = {
  resonance: { id: 'resonance', name: 'Void Resonance', text: 'Elemental power +25%', stats: [{ stat: 'elementalPower', op: 'pct', value: 0.25 }] },
  aegis: { id: 'aegis', name: 'Rift Aegis', text: 'Shield capacity +30%', stats: [{ stat: 'shieldCapacity', op: 'pct', value: 0.3 }] },
  fortune: { id: 'fortune', name: 'Fortune', text: 'Loot luck +25%', effect: { luck: 1.25 } },
};
export const BLESSING_IDS = Object.keys(BLESSINGS) as BlessingId[];

/** Curses carry until the act boss falls (or a purge); blessings likewise. */
export const MAX_CURSES = 4;

// ------------------------------------------------------------------ anomalies (event nodes)

export type AnomalyId = 'siphon' | 'gamble' | 'echo' | 'derelict' | 'pact' | 'cache';

export interface AnomalyChoice {
  id: string;
  label: string;
  /** What the player is told before choosing (honest odds). */
  text: string;
}

export interface AnomalyDef {
  id: AnomalyId;
  name: string;
  lore: string;
  choices: AnomalyChoice[];
}

export const ANOMALIES: Record<AnomalyId, AnomalyDef> = {
  siphon: {
    id: 'siphon',
    name: 'Rift Siphon',
    lore: 'A wound in the sky drips raw rift matter into a cracked conduit.',
    choices: [
      { id: 'drink', label: 'Drink deep', text: 'An epic+ item and 2 rift shards. Gain a random curse.' },
      { id: 'sip', label: 'Sip', text: '1 rift shard. 35% chance of a random curse.' },
      { id: 'leave', label: 'Leave it', text: 'Nothing happens.' },
    ],
  },
  gamble: {
    id: 'gamble',
    name: "Gambler's Engine",
    lore: 'A humming slot of salvaged logic boards. It wants cores.',
    choices: [
      { id: 'bet', label: 'Bet half your cores', text: '50%: double the bet back. 50%: lose it.' },
      { id: 'jackpot', label: 'Feed it everything', text: 'All cores. 30%: a legendary+ item. Otherwise nothing.' },
      { id: 'leave', label: 'Walk away', text: 'Keep your cores.' },
    ],
  },
  echo: {
    id: 'echo',
    name: 'Echo Shrine',
    lore: 'Your own drone, a second ahead of you, beckons from the glass.',
    choices: [
      { id: 'accept', label: 'Accept the echo', text: 'A free run upgrade pick. Gain Static Bleed.' },
      { id: 'mirror', label: 'Study the reflection', text: 'Purge one curse (if any). 40% chance of a free upgrade pick.' },
      { id: 'leave', label: 'Look away', text: 'Nothing happens.' },
    ],
  },
  derelict: {
    id: 'derelict',
    name: 'Derelict Warden',
    lore: 'A fallen warden drone, its cargo bay still sealed. Something guards it.',
    choices: [
      { id: 'salvage', label: 'Salvage it', text: 'Guardians attack the reactor. Defeat them for an elite cache.' },
      { id: 'scrap', label: 'Strip the plating', text: '+150 cores. 25% chance of Brittle Hull.' },
      { id: 'leave', label: 'Leave it', text: 'Nothing happens.' },
    ],
  },
  pact: {
    id: 'pact',
    name: 'Void Pact',
    lore: 'The rift offers power. The rift always collects.',
    choices: [
      { id: 'sign', label: 'Sign the pact', text: 'Blessing: Void Resonance (+25% elemental power). Gain Brittle Hull.' },
      { id: 'barter', label: 'Barter', text: 'Blessing: Fortune (+25% loot luck). Gain Famine.' },
      { id: 'leave', label: 'Refuse', text: 'Nothing happens.' },
    ],
  },
  cache: {
    id: 'cache',
    name: 'Abandoned Cache',
    lore: 'A supply crate, half buried, its lock still blinking.',
    choices: [
      { id: 'open', label: 'Force it open', text: '70%: a rare+ item. 30%: guardians ambush the reactor (then the cache is yours).' },
      { id: 'leave', label: 'Leave it', text: 'Nothing happens.' },
    ],
  },
};
export const ANOMALY_IDS = Object.keys(ANOMALIES) as AnomalyId[];

// ------------------------------------------------------------------ forge, rest, merchant

export type ForgeId = 'temper' | 'plating' | 'coolant' | 'calibrate';

export interface ForgeDef {
  id: ForgeId;
  name: string;
  text: string;
  stat: StatMod;
  /** Base core price (scaled by wave). */
  price: number;
  max: number;
}

export const FORGE: Record<ForgeId, ForgeDef> = {
  temper: { id: 'temper', name: 'Temper Weapon', text: '+10% weapon damage for this run', stat: { stat: 'weaponDamageMult', op: 'pct', value: 0.1 }, price: 160, max: 4 },
  plating: { id: 'plating', name: 'Reinforce Plating', text: '+15% max hull for this run', stat: { stat: 'maxHealthMult', op: 'pct', value: 0.15 }, price: 140, max: 4 },
  coolant: { id: 'coolant', name: 'Coolant Loop', text: '+15% weapon cooling for this run', stat: { stat: 'coolRateMult', op: 'pct', value: 0.15 }, price: 120, max: 4 },
  calibrate: { id: 'calibrate', name: 'Calibrate Towers', text: '+15% tower damage for this run', stat: { stat: 'turretDamageMult', op: 'pct', value: 0.15 }, price: 140, max: 4 },
};
export const FORGE_IDS = Object.keys(FORGE) as ForgeId[];

export type RestId = 'repair' | 'reflect' | 'purge';
export const REST: Record<RestId, { id: RestId; name: string; text: string }> = {
  repair: { id: 'repair', name: 'Repair', text: 'Reactor to full integrity and a fresh tactical charge.' },
  reflect: { id: 'reflect', name: 'Reflect', text: 'A free run upgrade pick.' },
  purge: { id: 'purge', name: 'Purge', text: 'Remove one curse (the oldest).' },
};
export const REST_IDS = Object.keys(REST) as RestId[];

export type ServiceId = 'repair' | 'upgrade' | 'purge';
export const SERVICES: Record<ServiceId, { id: ServiceId; name: string; text: string; price: number }> = {
  repair: { id: 'repair', name: 'Reactor Repair', text: 'Reactor to full integrity.', price: 110 },
  upgrade: { id: 'upgrade', name: 'Upgrade Cache', text: 'Choose one of three run upgrades.', price: 240 },
  purge: { id: 'purge', name: 'Curse Purge', text: 'Remove the oldest curse.', price: 360 },
};
export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];

/** Game mode of a run: defense (hold the reactor, build towers) or survival (no towers, hunted, one life). */
export type RunMode = 'defense' | 'survival';

/**
 * Mode effect on every combat segment. Survival has no towers and one life: smaller encounters, better income and
 * luck to pay for the risk.
 */
export const MODE_EFFECT: Record<RunMode, NodeEffect> = {
  defense: {},
  survival: { budget: 0.8, income: 1.25, luck: 1.2 },
};

/** Act boss rotation (an act boss always commands the final wave of its node). */
export const ACT_BOSSES: readonly BossId[] = ['colossus', 'overseer'];

/** Price scaling with the run's depth (global wave). */
export const priceScale = (wave: number): number => 1 + Math.max(0, Math.min(2000, wave)) * 0.05;
