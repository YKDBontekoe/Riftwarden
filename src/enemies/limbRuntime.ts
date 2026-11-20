import { Color3, type TransformNode, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { Effects } from '../fx/Effects';
import type { WalkerRig } from '../visuals/models';
import { bit, LIMB_IDS, type LimbId, limbDamage, limbForHit } from './limbs';

/** The slice of an enemy part loss needs (keeps this module free of the EnemyManager import cycle). */
export interface LimbBody {
  readonly walker: WalkerRig | null;
  readonly maxHp: number;
  limbDmg: number[];
  limbsLost: number;
}

const TMP = new Vector3();
const DIST: Record<LimbId, number> = { cannon: 0, arm: 0, head: 0 };
const SOCKET_FLASH = new Color3(1.6, 0.9, 0.35);

export function limbNode(rig: WalkerRig, l: LimbId): TransformNode {
  return l === 'cannon' ? rig.cannon : l === 'arm' ? rig.armL : rig.head;
}

/** Assign a hull hit to the nearest part; returns the part that came off now (or null). */
export function hitLimb(e: LimbBody, point: Vector3, toHp: number, survives: boolean): LimbId | null {
  const rig = e.walker;
  if (!rig || !(toHp > 0)) return null;
  const scale = Math.abs(rig.hips.parent ? (rig.hips.parent as TransformNode).scaling.x : 1) || 1;
  for (const l of LIMB_IDS) {
    const n = limbNode(rig, l);
    n.computeWorldMatrix(true);
    DIST[l] = Vector3.Distance(n.getAbsolutePosition(), point) / scale;
  }
  const l = limbForHit(DIST, e.limbsLost);
  if (!l) return null;
  const i = LIMB_IDS.indexOf(l);
  const r = limbDamage(e.limbDmg[i], toHp, l, e.maxHp, survives);
  e.limbDmg[i] = r.total;
  return r.breaks ? l : null;
}

/**
 * Knock a part off: its own pieces fly (the fragment system throws the part's instances), sparks and an oil spray
 * burst from the socket, and the node is hidden until the pooled enemy is respawned.
 */
export function detachLimb(e: LimbBody, l: LimbId, fx: Effects): void {
  const rig = e.walker;
  if (!rig || e.limbsLost & bit(l)) return;
  e.limbsLost |= bit(l);
  const node = limbNode(rig, l);
  node.computeWorldMatrix(true);
  const at = TMP.copyFrom(node.getAbsolutePosition());
  fx.shatter(node, at, 0.9, l === 'head' ? 5 : 7, 0.8);
  node.setEnabled(false);
  fx.burst('sparks', at, 22, undefined, 1.1);
  fx.burst('smoke', at, 2, undefined, 0.7);
  fx.debrisBurst(at, 4, 5, 0.7);
  fx.flashLight(at, 2.4, 0.16, SOCKET_FLASH);
  sfx.play('shieldHit', { pitch: l === 'head' ? 0.75 : 0.55, volume: 0.9 });
}

/** Re-attach every part (pooled enemies are reused). */
export function restoreLimbs(e: LimbBody): void {
  e.limbDmg = [0, 0, 0];
  if (!e.limbsLost || !e.walker) {
    e.limbsLost = 0;
    return;
  }
  for (const l of LIMB_IDS) limbNode(e.walker, l).setEnabled(true);
  e.limbsLost = 0;
}
