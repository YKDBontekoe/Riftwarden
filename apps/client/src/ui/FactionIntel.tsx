import { BIOMES, type BiomeId } from '@riftwarden/rules/world/biomes';
import { FieldArt } from './FieldArt';
import { FieldIcon, type FieldIconName } from './FieldIcon';

const INTEL: Record<BiomeId, { icon: FieldIconName; artwork: string; unit: string; record: string }> = {
  outpost: {
    icon: 'scrapline', artwork: 'scrapline-sapper', unit: 'Scrapline sapper',
    record: 'The yard camera caught a flicker below the gantry. By the next frame, the whole turret line was dark.',
  },
  cryo: {
    icon: 'rimebound', artwork: 'rimebound-burrower', unit: 'Rimebound burrower',
    record: 'The frost above the tunnel was intact. The scanner still counted three contacts moving beneath it.',
  },
  foundry: {
    icon: 'crucible', artwork: 'crucible-skimmer', unit: 'Crucible skimmer',
    record: 'The scanner dropped every contact over the slag. When the swarm cleared the channel, it was already inside the perimeter.',
  },
};

export function FactionSigil({ biome }: { biome?: BiomeId }) {
  return biome ? (
    <span className="faction-sigil" data-biome={biome}>
      <FieldIcon name={INTEL[biome].icon} size={24} />
    </span>
  ) : null;
}

export function FactionIntel({ biome, recovered = false }: { biome: BiomeId; recovered?: boolean }) {
  const { artwork, unit, record } = INTEL[biome];
  return (
    <figure className="faction-intel" data-biome={biome} data-testid="faction-intel">
      <FieldArt name={artwork} className="faction-intel-art" />
      <figcaption>
        <FactionSigil biome={biome} />
        <div>
          <div className="ds-lbl">{recovered ? 'Recovered scanner record' : `${BIOMES[biome].faction.name} field intel`}</div>
          <b>{unit}</b>
          {recovered && <p>“{record}”</p>}
        </div>
      </figcaption>
    </figure>
  );
}
