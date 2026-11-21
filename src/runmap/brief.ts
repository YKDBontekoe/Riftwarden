import { isCombatKind, NODE_KINDS, NODE_MODS } from './defs';
import { type MapNode, nodeInfo, segmentWaves } from './map';

/** Node summary for the loading briefing and map cards (pure). */
export interface NodeBrief {
  id: string;
  kind: MapNode['kind'];
  name: string;
  glyph: string;
  act: number;
  row: number;
  actBoss: boolean;
  blurb: string;
  reward: string;
  risk: number;
  waves: [number, number] | null;
  mods: { id: string; name: string; text: string; tone: string }[];
  faction: string;
  sector: string;
}

/** Combat node blurbs in survival (no reactor: the machines hunt the drone). */
const SURVIVAL_BLURB: Partial<Record<MapNode['kind'], string>> = {
  combat: 'Survive five waves. Every machine hunts you.',
  elite: 'Elite packs hunt you for five waves.',
  boss: 'Survive five waves; a boss hunts you on the last.',
};

export function nodeBrief(n: MapNode, lastWave: number, mode: 'defense' | 'survival' = 'defense'): NodeBrief {
  const k = NODE_KINDS[n.kind];
  const info = nodeInfo(n);
  return {
    id: n.id,
    kind: n.kind,
    name: n.actBoss ? `Act ${n.act} Boss` : k.name,
    glyph: k.glyph,
    act: n.act,
    row: n.row,
    actBoss: n.actBoss,
    blurb: n.actBoss ? 'The act commander holds the final wave. Clearing it lifts every curse.' : (mode === 'survival' && SURVIVAL_BLURB[n.kind]) || k.blurb,
    reward: n.actBoss ? 'Act chest · 3 rift shards · boss loot' : k.reward,
    risk: n.actBoss ? 3 : k.risk + Math.min(1, n.mods.length),
    waves: isCombatKind(n.kind) ? segmentWaves(lastWave) : null,
    mods: n.mods.map((m) => ({ id: m, name: NODE_MODS[m].name, text: NODE_MODS[m].text, tone: NODE_MODS[m].tone })),
    faction: info.faction,
    sector: `${info.name} · ${info.code}`,
  };
}
