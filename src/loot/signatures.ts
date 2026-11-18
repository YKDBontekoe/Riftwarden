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
}

export const SIGNATURES: readonly SignatureDef[] = [
  { id: 'overdrive', name: 'Overdrive Coil', text: 'Above 70% heat every hit deals +35% damage.' },
  { id: 'chain_reaction', name: 'Chain Reaction', text: 'Kills detonate: 3.5 m blast for 60% of the killing hit.' },
  { id: 'stormcaller', name: 'Stormcaller', text: 'Every 6th hit calls lightning on the target: 2x damage, shocks, chains to 2 enemies.' },
  { id: 'siphon', name: 'Siphon Lattice', text: 'Hits restore shield equal to 3% of the damage dealt.' },
  { id: 'phase', name: 'Phase Rounds', text: 'Shots ignore energy shields and directional armour: +80% damage against shielded or armoured machines.', exotic: true },
  { id: 'rift_echo', name: 'Rift Resonance', text: 'Critical hits tear a rift that pulls nearby machines in and chills them (+40 chill in 4 m).', exotic: true },
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
export function rollSignature(item: Pick<ItemInstance, 'uid' | 'seed' | 'rarity' | 'category'>): string | null {
  if (item.category !== 'weapon' || (item.rarity !== 'legendary' && item.rarity !== 'exotic')) return null;
  const pool = SIGNATURES.filter((s) => item.rarity === 'exotic' || !s.exotic);
  const h = hashSeed(`sig:${item.seed}:${item.uid}`);
  return pool[h % pool.length].id;
}
