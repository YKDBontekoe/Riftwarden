/**
 * Skill tree profile operations (pure): allocate a node, full respec. Executed by `Profile.op`
 * locally and by the co-op server against the online profile (see ops.ts).
 */
import type { SaveData } from './save';
import { levelForXp } from './level';
import { allocateBlocker, respecCost, treeForLevel } from './skilltree';
import { MAX_BALANCE } from '../economy/config';

type Res = { ok: true; [k: string]: unknown } | { ok: false; reason: string };

export function allocateNode(d: SaveData, id: string): Res {
  if (d.activeRun) return { ok: false, reason: 'Only available at HQ between operations' };
  const level = levelForXp(d.progress.xp);
  const why = allocateBlocker(treeForLevel(d.progress.tree.seed, level), d.progress.tree.allocated, id, level);
  if (why) return { ok: false, reason: why };
  d.progress.tree.allocated.push(id);
  return { ok: true };
}

/** Refund every point for credits (cost escalates per respec). Free while nothing is allocated is refused. */
export function respecTree(d: SaveData): Res {
  if (d.activeRun) return { ok: false, reason: 'Only available at HQ between operations' };
  if (!d.progress.tree.allocated.length) return { ok: false, reason: 'Nothing allocated' };
  const cost = respecCost(d.progress.respecs);
  if (d.resources.credits < cost) return { ok: false, reason: `Not enough credits (need ${cost})` };
  d.resources.credits = Math.min(MAX_BALANCE, d.resources.credits - cost);
  d.economy.stats.creditsSpent += cost;
  d.progress.tree.allocated = [];
  d.progress.respecs++;
  return { ok: true, cost };
}
