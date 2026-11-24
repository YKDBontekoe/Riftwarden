/**
 * One table describing every currency the player sees (pure): what it is called, where it comes
 * from, what it buys and whether it survives the operation. The HUD, terminals, tooltips and the
 * station directory all read from here, so names and glyphs never drift between screens.
 */
import type { ResourceKey } from './config';

export type CurrencyKey = ResourceKey | 'xp' | 'cores' | 'tactical';

export interface CurrencyInfo {
  key: CurrencyKey;
  name: string;
  /** Short unit for compact cost/delta text. */
  short: string;
  icon: string;
  /** CSS class for the colour (res-*). */
  cls: string;
  /** Persistent profile currency (true) or valid only during an operation (false). */
  persistent: boolean;
  earned: string;
  spent: string;
  /** How it is kept: banking rules in one line. */
  banking: string;
}

export const CURRENCIES: Record<CurrencyKey, CurrencyInfo> = {
  credits: {
    key: 'credits',
    name: 'Credits',
    short: 'cr',
    icon: '◈',
    cls: 'res-cr',
    persistent: true,
    earned: 'Kills, wave clears, checkpoints, events and selling gear at the Exchange.',
    spent: 'Buying gear and modules, merchant refreshes, tower research, HQ blueprints, affix work and skill tree respecs.',
    banking: 'Unsecured during an operation: banked at every 5-wave checkpoint, lost on defeat.',
  },
  salvage: {
    key: 'salvage',
    name: 'Salvage',
    short: 'salvage',
    icon: '⬢',
    cls: 'res-sv',
    persistent: true,
    earned: 'Destroyed machines, wave clears and dismantling items at the Reclamation Press.',
    spent: 'Storage bays, module removal, enhancement, fabrication and HQ construction.',
    banking: 'Unsecured during an operation: banked at every 5-wave checkpoint, lost on defeat.',
  },
  components: {
    key: 'components',
    name: 'Components',
    short: 'comp',
    icon: '✦',
    cls: 'res-co',
    persistent: true,
    earned: 'Checkpoints, elites, events, bosses and dismantling rare+ items.',
    spent: 'Advanced work: affix rerolls, component refits, higher fabrication grades, tower research.',
    banking: 'Unsecured during an operation: banked at every 5-wave checkpoint, lost on defeat.',
  },
  shards: {
    key: 'shards',
    name: 'Rift Shards',
    short: 'shards',
    icon: '⟡',
    cls: 'res-sh',
    persistent: true,
    earned: 'Elites, bosses, elite caches, high-value targets and checkpoints from Rift Level 3.',
    spent: 'Masterwork and apex fabrication, and Ascension (turning an Exotic into an Ascended item at the workshop).',
    banking: 'Unsecured during an operation: banked at every 5-wave checkpoint, lost on defeat.',
  },
  xp: {
    key: 'xp',
    name: 'Warden XP',
    short: 'XP',
    icon: '▲',
    cls: 'res-xp',
    persistent: true,
    earned: 'Waves cleared (more on higher Rift Levels), kills, elites, bosses, events and milestones.',
    spent: 'Never spent: every level grants a skill point for the Neural Lattice; every 5 levels reveal a new ring.',
    banking: 'Banked at checkpoints like loot; on defeat or abandon 25% of the unsecured XP is kept.',
  },
  cores: {
    key: 'cores',
    name: 'Cores',
    short: 'cores',
    icon: '◆',
    cls: 'res-core',
    persistent: false,
    earned: 'Kills and wave clears during the operation.',
    spent: 'Building, refitting and levelling towers in the arena.',
    banking: 'Operation only: shared by the team and gone when the operation ends.',
  },
  tactical: {
    key: 'tactical',
    name: 'Tactical energy',
    short: 'tac',
    icon: '◷',
    cls: 'res-tac',
    persistent: false,
    earned: 'Recharges over time (faster with tactical recharge stats).',
    spent: 'Tactical time: slows hostiles so you can aim and build.',
    banking: 'Operation only.',
  },
};

export const currency = (k: CurrencyKey): CurrencyInfo => CURRENCIES[k];

/** "120 cr · 4 comp" style text with the table's short units. */
export function amountText(c: Partial<Record<CurrencyKey, number>>, sign = ''): string {
  return (Object.keys(CURRENCIES) as CurrencyKey[])
    .filter((k) => c[k])
    .map((k) => `${sign}${Math.abs(c[k] ?? 0).toLocaleString()} ${CURRENCIES[k].short}`)
    .join(' · ');
}

/** One-line tooltip text for a currency. */
export const currencyTooltip = (k: CurrencyKey): string => {
  const c = CURRENCIES[k];
  return `${c.name}${c.persistent ? '' : ' (operation only)'}\nEarned: ${c.earned}\nSpent on: ${c.spent}\n${c.banking}`;
};
