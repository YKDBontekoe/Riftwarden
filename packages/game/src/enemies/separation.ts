/**
 * Crowd separation: overlapping machines push each other apart (bosses are immovable and push twice as hard).
 * Pure (no Babylon). The pair rule and its sequential, in-place order are the original O(n^2) loop's: pairs (i, j)
 * with i < j in list order, each resolved against the positions left by the pairs before it. A uniform grid only
 * skips pairs that cannot overlap: candidates come from the 3x3 neighbouring cells of a grid whose cells are wider
 * than the largest contact distance plus a margin for the movement the loop itself causes, and are visited in
 * ascending j, so results equal the brute-force loop (tests/separation.test.ts). Below `GRID_MIN` bodies the plain
 * loop is cheaper.
 */
export interface SeparationBody {
  readonly pos: { x: number; y: number; z: number };
  readonly def: { readonly radius: number; readonly role: string };
}

const GRID_MIN = 48;
/** Extra cell width (m) for positions that shift during the pass itself. */
const MARGIN = 1.5;

/** Reference loop (also used for small crowds). */
export function separateBrute(list: readonly SeparationBody[], hdt: number): void {
  const k = Math.min(1, hdt * 8);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) pair(a, list[j], k);
  }
}

function pair(a: SeparationBody, b: SeparationBody, k: number): void {
  if (Math.abs(a.pos.y - b.pos.y) > 2.5) return;
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const min = a.def.radius + b.def.radius;
  const d2 = dx * dx + dz * dz;
  if (d2 < min * min && d2 > 1e-6) {
    const d = Math.sqrt(d2);
    const push = ((min - d) / d) * 0.5 * k;
    const wa = a.def.role === 'boss' ? 0 : b.def.role === 'boss' ? 2 : 1;
    const wb = b.def.role === 'boss' ? 0 : a.def.role === 'boss' ? 2 : 1;
    a.pos.x -= dx * push * wa;
    a.pos.z -= dz * push * wa;
    b.pos.x += dx * push * wb;
    b.pos.z += dz * push * wb;
  }
}

/** Reused across frames (one crowd per game). */
export class Separation {
  private cellOf = new Int32Array(0);
  private head = new Map<number, number>();
  private next = new Int32Array(0);
  private cand: number[] = [];

  apply(list: readonly SeparationBody[], hdt: number): void {
    const n = list.length;
    if (n < GRID_MIN) {
      separateBrute(list, hdt);
      return;
    }
    const k = Math.min(1, hdt * 8);
    let maxR = 0;
    for (let i = 0; i < n; i++) if (list[i].def.radius > maxR) maxR = list[i].def.radius;
    const size = 2 * maxR + MARGIN;
    if (this.next.length < n) {
      this.next = new Int32Array(n * 2);
      this.cellOf = new Int32Array(n * 2);
    }
    const head = this.head;
    head.clear();
    // Buckets as linked lists, built back to front so each bucket lists indices in ascending order.
    for (let i = n - 1; i >= 0; i--) {
      const p = list[i].pos;
      const key = cellKey(Math.floor(p.x / size), Math.floor(p.z / size));
      this.cellOf[i] = key;
      this.next[i] = head.get(key) ?? -1;
      head.set(key, i);
    }
    const cand = this.cand;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      const key = this.cellOf[i];
      const cx = (key >>> 16) - 0x8000;
      const cz = (key & 0xffff) - 0x8000;
      cand.length = 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          for (let j = head.get(cellKey(cx + ox, cz + oz)) ?? -1; j >= 0; j = this.next[j]) if (j > i) cand.push(j);
        }
      }
      if (cand.length > 1) cand.sort((x, y) => x - y);
      for (let c = 0; c < cand.length; c++) pair(a, list[cand[c]], k);
    }
  }
}

/** 16-bit signed cell coordinates packed into one int (arenas are a few hundred metres across). */
function cellKey(x: number, z: number): number {
  return (((x + 0x8000) & 0xffff) << 16) | ((z + 0x8000) & 0xffff);
}
