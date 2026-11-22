import { DROP_SOURCES, type DropSourceId } from '../loot/drops';
import { uniquesFrom, type UniqueDef } from '../loot/uniques';
import { EVENTS } from '../survival/events';
import type { WaveDef } from '../waves/waves';
import { BIOMES } from '../world/biomes';
import { isCombatKind } from './defs';
import { type MapNode, nodeEffect } from './map';

export interface NamedDropSource {
  id: DropSourceId;
  label: string;
}

export interface NamedDrop {
  item: UniqueDef;
  sources: NamedDropSource[];
}

/** Before deployment the run seed is unknown. Only show sources fixed by the sector and its modifiers. */
export function sectorNamedDrops(node: MapNode, waves: readonly WaveDef[] = []): NamedDrop[] {
  const sources = new Map<DropSourceId, Set<string>>();
  const add = (id: DropSourceId, label: string = DROP_SOURCES[id].label): void => {
    const labels = sources.get(id) ?? new Set<string>();
    labels.add(label);
    sources.set(id, labels);
  };

  if (isCombatKind(node.kind)) {
    if (node.boss) add(node.boss);
    if (node.kind === 'elite') add('eliteCache', 'Elite sector cache');
    if (node.actBoss) add('eliteCache', 'Capital clear cache');
    if (nodeEffect(node).event === 'hvt') add('hvt', 'Destroy the Vault Courier');
  }
  if (node.kind === 'vault') add('eliteCache', 'Open the vault and defeat its guardians');
  if (node.kind === 'event') {
    if (!node.anomaly || node.anomaly === 'siphon') add('eliteCache', 'Drink from the Siphon');
    if (node.anomaly === 'derelict') add('eliteCache', 'Salvage the Derelict and defeat its guardians');
    if (node.anomaly === 'cache') add('eliteCache', 'Defeat the guardians if the cache triggers an ambush');
  }

  for (const wave of waves) {
    const event = wave.plan?.event;
    const cache = event && EVENTS[event].reward.drop;
    if (cache === 'eliteCache') add(cache, 'Clear the Elite Assault');
    for (const spawn of wave.spawns) {
      if (spawn.tag === 'hvt') add('hvt', 'Destroy the Vault Courier');
      if (spawn.mods?.length) add('elite', 'Defeat an elite');
      if (Object.hasOwn(DROP_SOURCES, spawn.kind)) add(spawn.kind as DropSourceId);
    }
  }

  const drops = new Map<string, NamedDrop>();
  const faction = BIOMES[node.biome].faction.id;
  for (const [id, labels] of sources) {
    for (const item of uniquesFrom(id, faction)) {
      const drop = drops.get(item.id) ?? { item, sources: [] };
      for (const label of labels) drop.sources.push({ id, label });
      drops.set(item.id, drop);
    }
  }
  return [...drops.values()];
}
