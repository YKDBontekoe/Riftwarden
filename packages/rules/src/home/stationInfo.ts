/**
 * What every HQ station is for (pure): one plain-language purpose line and the currencies it uses.
 * Terminal headers, the HQ interaction prompt and the Command Console directory read from here.
 */
import type { CurrencyKey } from '../economy/currencies';

export interface StationInfo {
  /** Short name used in the directory. */
  name: string;
  purpose: string;
  uses: CurrencyKey[];
}

export const STATION_INFO: Record<string, StationInfo> = {
  deploy: { name: 'Deployment', purpose: 'Pick a threat tier and launch an operation. Higher tiers give better loot and more XP.', uses: [] },
  command: { name: 'Command Console', purpose: 'Your service record, survival records, milestones and a directory of every station.', uses: ['xp'] },
  loadout: { name: 'Drone Configuration', purpose: 'Equip gear into your 7 slots, compare stats and save presets.', uses: [] },
  storage: { name: 'Storage', purpose: 'Everything you own that is not equipped. Buy extra bays here.', uses: ['salvage'] },
  workshop: { name: 'Workshop', purpose: 'Improve a weapon you own: install modules, reroll affixes, enhance, swap components, research towers.', uses: ['salvage', 'components', 'credits'] },
  fabricate: { name: 'Fabricator', purpose: 'Craft new equipment or modules from a recipe and a quality grade.', uses: ['salvage', 'components', 'credits'] },
  merchant: { name: 'Exchange', purpose: 'Buy equipment from the rotating stock or sell your own for credits.', uses: ['credits'] },
  modules: { name: 'Broker', purpose: 'Buy weapon modules and trade materials between currencies.', uses: ['credits', 'salvage', 'components'] },
  salvage: { name: 'Reclamation', purpose: 'Dismantle unwanted items into salvage and components. Lock items to protect them.', uses: ['salvage', 'components'] },
  architect: { name: 'Architect', purpose: 'Expand and decorate the HQ: rooms, walls, lights and facilities.', uses: ['salvage', 'credits'] },
  lattice: { name: 'Neural Lattice', purpose: 'Spend skill points from Warden levels on your personal procedural skill tree.', uses: ['xp', 'credits'] },
};

export const stationInfo = (id: string | null | undefined): StationInfo | null => (id ? STATION_INFO[id] ?? null : null);
