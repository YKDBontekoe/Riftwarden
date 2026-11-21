import { NODE_KINDS, type NodeKind } from '../runmap/defs';
import type { MapNode } from '../runmap/map';
import { parseRegionId, regionLayout, regionNode } from './regions';
import { liveMods, playable, regionState, type WarState } from './state';

/**
 * Run-side view of the Rift War (pure): node lookup, live modifiers, where a run can travel, history path codes.
 * Static layouts come from the war seed; live state (unlocked regions, corruption, events) from the war state.
 */

/** Static node by id. */
export const findNode = (seed: number, id: string): MapNode | null => regionNode(seed, id);

/** "Act" of a node = region index + 1 (difficulty and curse scope follow it). */
export const regionOf = (id: string): number => (parseRegionId(id)?.k ?? 0) + 1;

/** Node with its live war modifiers (corruption, stronghold, events) appended. */
export function liveNode(seed: number, war: WarState | null, id: string): MapNode | null {
  const n = findNode(seed, id);
  if (!n || !war) return n;
  const extra = liveMods(war, id).filter((m) => !n.mods.includes(m));
  return extra.length ? { ...n, mods: [...n.mods, ...extra] } : n;
}

/** Nodes a run can travel to from `current` (linked and in an unlocked region). Null current: every landing. */
export function reachable(seed: number, war: WarState | null, current: string | null): MapNode[] {
  if (!current) return (war?.regions ?? [{ k: 0 }]).map((r) => findNode(seed, regionLayout(seed, r.k).landing)!).filter(Boolean);
  const n = findNode(seed, current);
  if (!n) return [];
  return n.links.filter((id) => (war ? playable(war, id) : parseRegionId(id)?.k === parseRegionId(current)?.k)).map((id) => findNode(seed, id)!).filter(Boolean);
}

/** Where a new deployment lands by default: the front (the newest active region's landing). */
export function defaultEntry(war: WarState): string {
  const active = [...war.regions].reverse().find((r) => r.status === 'active') ?? war.regions[war.regions.length - 1];
  return regionLayout(war.seed, active.k).landing;
}

/** Is the node's region unlocked? */
export const nodePlayable = (war: WarState | null, id: string): boolean => (war ? playable(war, id) : true);

/** Region status of a node ('locked' when not unlocked yet). */
export function regionStatus(war: WarState | null, id: string): 'active' | 'liberated' | 'locked' {
  const p = parseRegionId(id);
  const r = p && war ? regionState(war, p.k) : null;
  return r ? r.status : 'locked';
}

const LETTER: Record<NodeKind, string> = { combat: 'C', elite: 'E', boss: 'B', merchant: 'M', forge: 'F', event: '?', vault: 'V', rest: 'R' };

/** Compact path code for history (e.g. "1C", "1E", "1B*": region number, kind, capital star). */
export function pathCode(ids: readonly string[], seed: number): string[] {
  return ids.map((id) => {
    const n = findNode(seed, id);
    return n ? `${n.act}${LETTER[n.kind]}${n.actBoss ? '*' : ''}` : '';
  }).filter(Boolean);
}

/** Display name of a node ("Rime Basin · capital", "Rime Basin · sector 4"). */
export function nodeTitle(n: MapNode): string {
  return `${n.region ?? `Region ${n.act}`} · ${n.actBoss ? 'capital' : `sector ${n.col + 1}`}${n.kind !== 'combat' && !n.actBoss ? ` (${NODE_KINDS[n.kind].name})` : ''}`;
}
