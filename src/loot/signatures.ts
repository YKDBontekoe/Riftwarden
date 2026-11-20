import type { ItemInstance } from './types';

/**
 * M7 signature effects: every legendary and exotic weapon carries one named mechanic on top of its
 * rolled stats. The id is part of the item (persisted, never rerolled); older legendary weapons that
 * predate signatures receive one deterministically from their uid when loaded.
 */
export interface SignatureDef {
  id: string;
  name: string;
  text: string;
  exotic?: boolean;
  /** Carried only by a hand-made unique (loot/uniques.ts); never rolled. */
  unique?: boolean;
}

export const SIGNATURES: readonly SignatureDef[] = [
  { id: 'overdrive', name: 'Overdrive Coil', text: 'Above 70% heat every hit deals +35% damage.' },
  { id: 'chain_reaction', name: 'Chain Reaction', text: 'Kills detonate: 3.5 m blast for 60% of the killing hit.' },
  { id: 'stormcaller', name: 'Stormcaller', text: 'Every 6th hit calls lightning on the target: 2x damage, shocks, chains to 2 enemies.' },
  { id: 'siphon', name: 'Siphon Lattice', text: 'Hits restore shield equal to 3% of the damage dealt.' },
  { id: 'phase', name: 'Phase Rounds', text: 'Shots ignore energy shields and directional armour: +80% damage against shielded or armoured machines.', exotic: true },
  { id: 'rift_echo', name: 'Rift Resonance', text: 'Critical hits tear a rift that pulls nearby machines in and chills them (+40 chill in 4 m).', exotic: true },
  // Unique-only mechanics (text mirrors the unique's effect line).
  { id: 'u_heartbreaker', name: 'Heartbreaker', text: 'Weakpoint hits deal +70% damage and corrode the target (2 stacks).', unique: true },
  { id: 'u_prismgaze', name: "Overseer's Gaze", text: 'Every 8th tick fires a prism ray that chains to 3 machines for 120% of the tick.', unique: true },
  { id: 'u_rimebreath', name: "Rime Warden's Breath", text: 'Hits on chilled or frozen machines deal +40%; frozen machines you kill shatter: 4 m cryo burst for 80% of the hit.', unique: true },
  { id: 'u_choir', name: 'Crucible Choir', text: 'Hits on burning machines ignite every machine within 3.5 m.', unique: true },
  { id: 'u_juryrig', name: 'Jury-Rig', text: 'Above 50% heat every hit has a 25% chance to arc to 2 machines for 60% of the hit.', unique: true },
  { id: 'u_hivemother', name: 'Hive Mother', text: 'Kills release two seekers that strike the nearest machines within 14 m for 50% of the killing hit.', unique: true },
  { id: 'u_ninthgate', name: 'Ninth Gate', text: 'Slugs pierce 2 more machines and gain +20% per machine pierced instead of losing 15%.', unique: true },
];

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const BY_ID = new Map(SIGNATURES.map((s) => [s.id, s]));
export const signatureDef = (id: string | null | undefined): SignatureDef | null => (id ? BY_ID.get(id) ?? null : null);

/** Deterministic signature for a legendary/exotic weapon (exotics may roll exotic-only ones). */
/** Deterministic from the item's seed (same seed + spec => same item, like every other rolled value). */
export function rollSignature(item: Pick<ItemInstance, 'seed' | 'rarity' | 'category'>): string | null {
  if (item.category !== 'weapon' || (item.rarity !== 'legendary' && item.rarity !== 'exotic' && item.rarity !== 'ascended')) return null;
  const pool = SIGNATURES.filter((s) => !s.unique && (item.rarity !== 'legendary' || !s.exotic));
  const h = hashSeed(`sig:${item.seed}`);
  return pool[h % pool.length].id;
}
