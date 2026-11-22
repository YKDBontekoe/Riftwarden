import { baseDef } from '@riftwarden/rules/loot/bases';
import type { DropSourceId } from '@riftwarden/rules/loot/drops';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { isCombatKind } from '@riftwarden/rules/runmap/defs';
import type { MapNode } from '@riftwarden/rules/runmap/map';
import { type NamedDrop, sectorNamedDrops } from '@riftwarden/rules/runmap/namedDrops';
import { BIOMES } from '@riftwarden/rules/world/biomes';
import { FieldIcon, type FieldIconName } from './FieldIcon';
import { ItemGlyph, RarityTag } from './inventory/glyphs';

const SOURCE_ICON: Partial<Record<DropSourceId, FieldIconName>> = {
  colossus: 'boss', overseer: 'boss', elite: 'elite', eliteCache: 'cache', hvt: 'courier',
};

export function NamedDrops({ node, drops }: { node: MapNode; drops?: readonly NamedDrop[] }) {
  const items = drops ?? sectorNamedDrops(node);
  const waitingForEncounters = drops === undefined && isCombatKind(node.kind);
  return (
    <section className="named-drops" aria-label="Named drops" data-testid="named-drops">
      <header className="nd-banner" data-biome={node.biome}>
        <span>{BIOMES[node.biome].faction.name}</span>
        <h3>Named drops</h3>
      </header>
      {items.length ? (
        <>
          <p>Possible drops</p>
          <ul className="nd-items">
            {items.map(({ item, sources }) => (
              <li key={item.id} className="nd-item" data-unique={item.id} style={{ ['--rc' as string]: rarity(item.rarity).color }}>
                <ItemGlyph item={{ defId: item.baseId, rarity: item.rarity, category: baseDef(item.baseId)?.category ?? 'accessory', uniqueId: item.id }} />
                <div className="nd-main">
                  <div className="nd-title"><b>{item.name}</b> <RarityTag id={item.rarity} /></div>
                  <ul className="nd-sources">
                    {sources.map(({ id, label }) => <li key={`${id}:${label}`}><FieldIcon name={SOURCE_ICON[id] ?? 'enemy'} />{label}</li>)}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : <p>{waitingForEncounters ? 'No fixed unique sources. Encounter drops appear during the run.' : 'No named drops listed for this sector.'}</p>}
    </section>
  );
}
