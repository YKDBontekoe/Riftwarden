// Hold-to-collect: after holding use briefly, every landed pickup within reach goes into the hold, best first, so a
// hold that fills up keeps the most valuable drops. Pure: positions and rarity in, collection order out.

/** Seconds use must be held before the sweep (a tap still picks up just the targeted drop). */
export const SWEEP_HOLD = 0.45;

export interface SweepCandidate {
  id: number;
  x: number;
  z: number;
  rarityIndex: number;
  level: number;
}

/** Ids within `range` of (px, pz), ordered by rarity, then level, then distance. */
export function sweepOrder(cands: readonly SweepCandidate[], px: number, pz: number, range: number): number[] {
  const r2 = range * range;
  return cands
    .map((c) => ({ c, d2: (c.x - px) ** 2 + (c.z - pz) ** 2 }))
    .filter((e) => e.d2 <= r2)
    .sort((a, b) => b.c.rarityIndex - a.c.rarityIndex || b.c.level - a.c.level || a.d2 - b.d2)
    .map((e) => e.c.id);
}
