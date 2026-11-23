import { BOSSES } from '@riftwarden/rules/survival/bosses';

const urls = import.meta.glob<string>('../assets/field-art/*.webp', { eager: true, query: '?url', import: 'default' });

export function fieldArtwork(name: string | null | undefined): string | undefined {
  return name ? urls[`../assets/field-art/${name}.webp`] : undefined;
}

const STATION_ART: Partial<Record<string, string>> = {
  deploy: 'hq-deploy', command: 'hq-command', loadout: 'hq-loadout', storage: 'hq-storage',
  workshop: 'hq-workshop', fabricate: 'hq-fabricate', merchant: 'hq-merchant', modules: 'hq-modules',
  salvage: 'hq-salvage', architect: 'hq-fabricate', lattice: 'hq-lattice',
};

export function stationArtwork(id: string | null | undefined): string | undefined {
  return id && Object.hasOwn(STATION_ART, id) ? STATION_ART[id] : undefined;
}

export function bossArtwork(name: string): string | undefined {
  if (name === BOSSES.colossus.name) return 'boss-colossus';
  if (name === BOSSES.overseer.name) return 'boss-overseer';
  return undefined;
}
