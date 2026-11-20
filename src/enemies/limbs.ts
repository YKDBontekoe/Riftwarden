/**
 * Shoot-off parts: walker-frame robots (walker, bulwark, sapper, marksman) lose their cannon arm, blade arm or
 * sensor head once a part has soaked enough hull damage. Hits are assigned to the nearest part within its reach;
 * a lost part changes behaviour (no cannon = no shots at the drone, no head = blinded and staggering).
 * Pure (no Babylon values): the manager measures distances, these rules decide.
 */
export type LimbId = 'cannon' | 'arm' | 'head';
export const LIMB_IDS: readonly LimbId[] = ['cannon', 'arm', 'head'];

export interface LimbDef {
  /** Share of max hull a part soaks before it comes off. */
  share: number;
  /** Reach around the part's node (m, before the rig scale) inside which a hit counts for it. */
  reach: number;
}

export const LIMBS: Record<LimbId, LimbDef> = {
  cannon: { share: 0.3, reach: 0.75 },
  arm: { share: 0.26, reach: 0.65 },
  head: { share: 0.28, reach: 0.5 },
};

/** Behaviour after losing parts. */
export const LIMB_EFFECT = {
  /** Without a head the frame staggers along its path. */
  headlessSpeed: 0.8,
  /** Exposed wiring: extra damage taken once the head is gone. */
  headlessVulnerability: 1.15,
  /** A walker without its cannon still hits the reactor, but weakly (it rams / claws it). */
  disarmedReactor: 0.5,
} as const;

export const bit = (l: LimbId): number => 1 << LIMB_IDS.indexOf(l);
export const hasLost = (mask: number, l: LimbId): boolean => (mask & bit(l)) !== 0;

/** The part a hit belongs to: nearest node within its reach (distances already divided by the rig scale). */
export function limbForHit(dist: Record<LimbId, number>, lostMask: number): LimbId | null {
  let best: LimbId | null = null;
  let bd = Infinity;
  for (const l of LIMB_IDS) {
    if (hasLost(lostMask, l)) continue;
    const d = dist[l];
    if (!(d <= LIMBS[l].reach) || d >= bd) continue;
    bd = d;
    best = l;
  }
  return best;
}

/**
 * Add hull damage to a part. Returns the part's new damage total and whether it comes off now. A part never
 * comes off on the killing blow (the whole frame bursts then).
 */
export function limbDamage(prev: number, toHp: number, l: LimbId, maxHp: number, alive: boolean): { total: number; breaks: boolean } {
  const total = prev + Math.max(0, Number.isFinite(toHp) ? toHp : 0);
  return { total, breaks: alive && maxHp > 0 && total >= LIMBS[l].share * maxHp };
}
