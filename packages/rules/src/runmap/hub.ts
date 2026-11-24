import { rarity, rarityCeiling } from '../loot/rarity';
import { mulberry32 } from '../combat/damage';
import type { Category } from '../loot/types';
import type { RarityId } from '../loot/rarity';
import { addCurse, purgeCurse, randomCurse, type RunCarry } from './carry';
import { ANOMALIES, type AnomalyId, type BlessingId, type CurseId, FORGE, type ForgeId, priceScale, SERVICES, type ServiceId } from './defs';
import { h32 } from './map';

/**
 * Non-combat node rules (pure): merchant stock and prices, forge prices, anomaly outcomes. The arena
 * applies the returned outcome (items are generated there, upgrades are offered there).
 */

export interface StockOffer {
  key: string;
  category: Category;
  rarity: RarityId;
  price: number;
  /** Item seed (generation happens in the arena with the node's item level). */
  seed: number;
}

const STOCK_CATS: Category[] = ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'module', 'ability'];
const STOCK_RARITY: [RarityId, number, number][] = [
  ['uncommon', 50, 220],
  ['rare', 35, 380],
  ['epic', 15, 650],
];

/**
 * Merchant stock of a node: three items (one is always rare+, never above the Rift Level's own drop ceiling, so no
 * epics before RL 3) and the service prices.
 */
export function merchantStock(nodeSeed: number, wave: number, rl = 99): { items: StockOffer[]; services: Record<ServiceId, number> } {
  const ceiling = rarity(rarityCeiling(rl)).index;
  const r = mulberry32(h32(nodeSeed >>> 0, 0x5701));
  const k = priceScale(wave);
  const items: StockOffer[] = [];
  for (let i = 0; i < 3; i++) {
    let roll = r() * 100;
    let pick = STOCK_RARITY[0];
    for (const row of STOCK_RARITY) {
      roll -= row[1];
      if (roll < 0) {
        pick = row;
        break;
      }
    }
    if (i === 0 && pick[0] === 'uncommon') pick = STOCK_RARITY[1];
    while (rarity(pick[0]).index > ceiling && pick !== STOCK_RARITY[0]) pick = STOCK_RARITY[STOCK_RARITY.indexOf(pick) - 1];
    const category = STOCK_CATS[Math.floor(r() * STOCK_CATS.length) % STOCK_CATS.length];
    items.push({ key: `s${i}`, category, rarity: pick[0], price: Math.round(pick[2] * k), seed: h32(nodeSeed >>> 0, 0x1e7 + i) });
  }
  const services = Object.fromEntries((Object.keys(SERVICES) as ServiceId[]).map((id) => [id, Math.round(SERVICES[id].price * k)])) as Record<ServiceId, number>;
  return { items, services };
}

/** Price of the next forge stack (+35% per owned stack). */
export function forgePrice(id: ForgeId, wave: number, owned: number): number {
  return Math.round(FORGE[id].price * priceScale(wave) * (1 + 0.35 * Math.max(0, owned)));
}

/** What a resolved anomaly choice does. The arena applies it. */
export interface AnomalyOutcome {
  /** Line shown in the result banner. */
  text: string;
  tone: 'good' | 'bad' | 'mixed' | 'none';
  curse: CurseId | null;
  purged: CurseId | null;
  blessing: BlessingId | null;
  /** Change of the run's cores (negative = paid). */
  cores: number;
  shards: number;
  /** Items to generate: drop source id + rarity floor. */
  items: { source: 'eliteCache' | 'checkpoint' | 'boss'; minRarity: RarityId }[];
  /** Free run upgrade picks. */
  picks: number;
  /** Guardians attack the reactor; the listed items/rewards come when they fall. */
  ambush: boolean;
}

const none = (text: string): AnomalyOutcome => ({ text, tone: 'none', curse: null, purged: null, blessing: null, cores: 0, shards: 0, items: [], picks: 0, ambush: false });

/**
 * Resolve an anomaly choice. Mutates `carry` (curses/blessings) so a pure test sees the whole result;
 * `r` is the node's own stream, so the outcome of a seed is reproducible.
 */
export function resolveAnomaly(id: AnomalyId, choice: string, carry: Pick<RunCarry, 'curses' | 'blessings'>, ctx: { cores: number }, r: () => number): AnomalyOutcome | null {
  const def = ANOMALIES[id];
  if (!def || !def.choices.some((c) => c.id === choice)) return null;
  if (choice === 'leave') return none('You leave the anomaly undisturbed.');
  const out = none('');
  const curse = (): void => {
    const c = randomCurse(carry, r);
    out.curse = c ? addCurse(carry, c) : null;
  };
  const curseOf = (c: CurseId): void => {
    out.curse = addCurse(carry, c);
  };
  const bless = (b: BlessingId): void => {
    if (!carry.blessings.includes(b)) carry.blessings.push(b);
    out.blessing = b;
  };
  switch (`${id}:${choice}`) {
    case 'siphon:drink':
      out.items.push({ source: 'eliteCache', minRarity: 'epic' });
      out.shards = 2;
      curse();
      out.text = 'Rift matter floods the drone. Power, at a price.';
      out.tone = 'mixed';
      break;
    case 'siphon:sip':
      out.shards = 1;
      if (r() < 0.35) curse();
      out.text = out.curse ? 'Even a sip leaves a mark.' : 'A clean draught. +1 shard.';
      out.tone = out.curse ? 'mixed' : 'good';
      break;
    case 'gamble:bet': {
      const bet = Math.floor(ctx.cores / 2);
      if (bet <= 0) return none('The engine ignores an empty purse.');
      const win = r() < 0.5;
      out.cores = win ? bet : -bet;
      out.text = win ? `Jackpot lights. +${bet} cores.` : `The engine swallows ${bet} cores.`;
      out.tone = win ? 'good' : 'bad';
      break;
    }
    case 'gamble:jackpot': {
      if (ctx.cores <= 0) return none('The engine ignores an empty purse.');
      out.cores = -ctx.cores;
      if (r() < 0.3) {
        out.items.push({ source: 'boss', minRarity: 'legendary' });
        out.text = 'Every light on the engine burns gold.';
        out.tone = 'good';
      } else {
        out.text = 'The engine whirs, clicks and goes dark.';
        out.tone = 'bad';
      }
      break;
    }
    case 'echo:accept':
      out.picks = 1;
      curseOf('static');
      out.text = 'The echo merges with you. Something lags behind.';
      out.tone = 'mixed';
      break;
    case 'echo:mirror':
      out.purged = purgeCurse(carry as Pick<RunCarry, 'curses'>);
      if (r() < 0.4) out.picks = 1;
      out.text = out.purged ? 'The reflection takes a curse with it.' : 'The reflection shows nothing new.';
      out.tone = out.purged || out.picks ? 'good' : 'none';
      break;
    case 'derelict:salvage':
    case 'cache:open':
      if (id === 'cache' && r() < 0.7) {
        out.items.push({ source: 'checkpoint', minRarity: 'rare' });
        out.text = 'The lock gives. A clean haul.';
        out.tone = 'good';
        break;
      }
      out.ambush = true;
      out.items.push({ source: 'eliteCache', minRarity: 'rare' });
      out.text = 'Guardians wake. Defend the reactor to claim the cargo.';
      out.tone = 'mixed';
      break;
    case 'derelict:scrap':
      out.cores = 150;
      if (r() < 0.25) curseOf('brittle');
      out.text = out.curse ? 'The plating comes away, and so does yours.' : '+150 cores of stripped plating.';
      out.tone = out.curse ? 'mixed' : 'good';
      break;
    case 'pact:sign':
      bless('resonance');
      curseOf('brittle');
      out.text = 'The pact is sealed. The rift hums in your weapons.';
      out.tone = 'mixed';
      break;
    case 'pact:barter':
      bless('fortune');
      curseOf('famine');
      out.text = 'Fortune smiles. Your purse thins.';
      out.tone = 'mixed';
      break;
    default:
      return none('Nothing happens.');
  }
  return out;
}

/** Guardian encounter (vaults, ambushes): budget multiplier on the current wave level. */
export const GUARDIAN = { budget: 1.25, elite: 3, cacheShards: 2, credits: (wave: number) => Math.round(60 + 9 * wave) };
