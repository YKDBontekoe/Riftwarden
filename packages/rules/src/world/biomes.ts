/**
 * Biomes (M10): every procedural sector belongs to one. A biome sets the look (fog, sky horizon, sun, material
 * tints, airborne particles, lane light colour), the ground hazard planted by the generator, and the enemy
 * faction that holds the sector (composition bias, faction archetypes, preferred mutations).
 *
 * Pure data + helpers; the arena reads it (`biomeOf(layout)`), the planner takes the faction.
 */
import type { EnemyKind } from '../data/defs';
import type { EliteModId } from '../survival/elites';
import type { ArenaLayout } from './layout';

export type BiomeId = 'outpost' | 'cryo' | 'foundry';
export type Rgb = [number, number, number];

export interface Faction {
  id: string;
  name: string;
  /** One-line identity for the briefing. */
  blurb: string;
  /** Multiplies theme mix weights per kind (missing = 1). */
  bias: Partial<Record<EnemyKind, number>>;
  /** Added to every theme mix (faction signature archetypes), before eligibility. */
  extra: Partial<Record<EnemyKind, number>>;
  /** Multiplies mutation roll weights (missing = 1). */
  mods: Partial<Record<EliteModId, number>>;
  /** Multiplies the elite chance. */
  eliteRate: number;
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  blurb: string;
  /** Base fog colour and density. */
  fog: Rgb;
  fogDensity: number;
  /** Sky horizon colour (rwSky). */
  horizon: Rgb;
  /** Sun (key light) diffuse colour and intensity multiplier. */
  sun: Rgb;
  sunMul: number;
  /** Albedo multipliers for the outdoor palette (concrete, panels, deck, steel). */
  tint: { concrete: Rgb; panel: Rgb; floor: Rgb; steel: Rgb };
  /** Airborne particles: colour, size range, gravity (negative = falling), rate multiplier. */
  air: { color: Rgb; size: [number, number]; gravity: number; rate: number; rain: boolean };
  /** Ground hazard patches the generator plants. */
  hazard: 'none' | 'frost' | 'slag';
  /** Hostile lane light colour (HDR). */
  lane: Rgb;
  faction: Faction;
  /** Sector name words (prefix pool). */
  words: readonly string[];
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  outpost: {
    id: 'outpost',
    name: 'Industrial Outpost',
    blurb: 'Rift-scarred refinery yard at storm dusk.',
    fog: [0.3, 0.29, 0.3],
    fogDensity: 0.0042,
    horizon: [0.36, 0.33, 0.32],
    sun: [1, 0.74, 0.5],
    sunMul: 1,
    tint: { concrete: [1, 1, 1], panel: [1, 1, 1], floor: [1, 1, 1], steel: [1, 1, 1] },
    air: { color: [0.9, 0.8, 0.62], size: [0.018, 0.05], gravity: -0.02, rate: 1, rain: true },
    hazard: 'none',
    lane: [2.7, 0.65, 0.11],
    faction: {
      id: 'scrap',
      name: 'Scrapline Legion',
      blurb: 'Balanced rift machines: walkers, drones and heavy frames.',
      bias: {},
      extra: { sapper: 0.6, marksman: 0.5 },
      mods: {},
      eliteRate: 1,
    },
    words: ['Ashfall', 'Breaker', 'Cinder', 'Dusk', 'Gantry', 'Iron', 'Kestrel', 'Pylon', 'Quarry', 'Rust', 'Tether', 'Vantage'],
  },
  cryo: {
    id: 'cryo',
    name: 'Cryo Excavation',
    blurb: 'Frozen dig site: frost fields slow the drone and chill machines.',
    fog: [0.56, 0.64, 0.72],
    fogDensity: 0.0047,
    horizon: [0.56, 0.67, 0.79],
    sun: [0.83, 0.91, 1],
    sunMul: 1.02,
    tint: { concrete: [0.92, 1, 1.12], panel: [0.9, 0.98, 1.1], floor: [0.95, 1.02, 1.12], steel: [0.85, 0.95, 1.1] },
    air: { color: [0.95, 0.98, 1], size: [0.03, 0.08], gravity: -0.9, rate: 1.8, rain: false },
    hazard: 'frost',
    lane: [0.5, 1.6, 2.8],
    faction: {
      id: 'rime',
      name: 'Rimebound Host',
      blurb: 'Armoured frost walkers and burrowers that tunnel under the ice.',
      bias: { bulwark: 1.5, enforcer: 1.4, rusher: 0.6, artillery: 0.7 },
      extra: { burrower: 1.6, sapper: 0.4 },
      mods: { frostbound: 4, armored: 1.5, regenerating: 1.6, molten: 0 },
      eliteRate: 1.1,
    },
    words: ['Rime', 'Glacier', 'Frostline', 'Hoarfrost', 'Permafrost', 'Whiteout', 'Icebreak', 'Boreal', 'Shiver', 'Polar', 'Silica', 'Sleet'],
  },
  foundry: {
    id: 'foundry',
    name: 'Molten Foundry',
    blurb: 'Smelting floor: slag pools burn anything that touches them.',
    fog: [0.42, 0.22, 0.14],
    fogDensity: 0.005,
    horizon: [0.62, 0.3, 0.16],
    sun: [1, 0.55, 0.3],
    sunMul: 1.1,
    tint: { concrete: [0.78, 0.7, 0.66], panel: [0.82, 0.74, 0.7], floor: [0.72, 0.66, 0.62], steel: [0.9, 0.78, 0.7] },
    air: { color: [2.4, 0.8, 0.22], size: [0.025, 0.06], gravity: 0.35, rate: 1.4, rain: false },
    hazard: 'slag',
    lane: [3.2, 0.42, 0.06],
    faction: {
      id: 'crucible',
      name: 'Crucible Swarm',
      blurb: 'Fast skimmer swarms, snipers and molten-core shock troops.',
      bias: { rusher: 1.4, walker: 1.1, artillery: 1.3, bulwark: 0.7 },
      extra: { skimmer: 1.8, marksman: 1.1 },
      mods: { molten: 4, volatile: 1.6, splitting: 1.5, frostbound: 0 },
      eliteRate: 1.1,
    },
    words: ['Crucible', 'Slag', 'Ember', 'Furnace', 'Kiln', 'Forge', 'Cinderfall', 'Smelter', 'Ingot', 'Bellows', 'Magma', 'Tuyere'],
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

/** The biome of a layout (the classic arena is the outpost). */
export function biomeOf(L: Pick<ArenaLayout, 'biome'> | null | undefined): BiomeDef {
  return BIOMES[(L?.biome as BiomeId) ?? 'outpost'] ?? BIOMES.outpost;
}

/** Biome for a seed: an even split between the three. */
export function biomeForSeed(seed: number): BiomeId {
  const h = Math.imul((seed >>> 0) ^ 0x7f4a7c15, 0x2c1b3c6d) >>> 0;
  return BIOME_IDS[(h >>> 7) % BIOME_IDS.length];
}

/** Apply a faction to a theme mix: bias existing weights, add signature archetypes (scaled to the mix size). */
export function factionMix(mix: Partial<Record<EnemyKind, number>>, f: Faction | null | undefined): Partial<Record<EnemyKind, number>> {
  if (!f) return mix;
  const out: Partial<Record<EnemyKind, number>> = {};
  let total = 0;
  for (const [k, w] of Object.entries(mix) as [EnemyKind, number][]) {
    out[k] = w * (f.bias[k] ?? 1);
    total += w;
  }
  // Extras are relative to the average weight of the mix, so they matter in every theme.
  const avg = total / Math.max(1, Object.keys(mix).length);
  for (const [k, w] of Object.entries(f.extra) as [EnemyKind, number][]) out[k] = (out[k] ?? 0) + w * avg * 0.5;
  return out;
}
