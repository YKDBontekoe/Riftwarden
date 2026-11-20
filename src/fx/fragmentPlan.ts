/** A rig part that could break off: its world-space extents (metres). */
export interface FragmentCandidate<T> {
  item: T;
  sx: number;
  sy: number;
  sz: number;
}

/** Parts smaller than this (largest extent) are bolts and greebles: not worth a piece. */
export const MIN_FRAGMENT = 0.08;
/** Parts larger than this are hulls that would read as the whole robot flying away. */
export const MAX_FRAGMENT = 4.5;

/**
 * Choose which parts of a destroyed rig become flying pieces: the `max` most visible ones (silhouette area =
 * the two largest extents), skipping tiny greebles and whole-body hulls. Pure, so the choice is testable.
 */
export function pickFragments<T>(cands: readonly FragmentCandidate<T>[], max: number): FragmentCandidate<T>[] {
  if (max <= 0) return [];
  const scored: { c: FragmentCandidate<T>; area: number }[] = [];
  for (const c of cands) {
    const a = Math.max(c.sx, c.sy, c.sz);
    if (!(a >= MIN_FRAGMENT) || a > MAX_FRAGMENT) continue;
    const b = c.sx + c.sy + c.sz - a - Math.min(c.sx, c.sy, c.sz);
    scored.push({ c, area: a * b });
  }
  scored.sort((x, y) => y.area - x.area);
  return scored.slice(0, max).map((s) => s.c);
}
