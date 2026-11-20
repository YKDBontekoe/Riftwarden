/**
 * Ground navigation for procedural arenas: a flow field on a 1 m grid.
 *
 * The static layout (boxes, ramps, perimeter, gate tunnels) is rasterised once, inflated by the walker
 * clearance. Towers are *expensive* rather than blocked: a sealed maze still has a path, it simply runs
 * through the cheapest tower, and the enemy following it breaches that tower (see EnemyManager). Wrecked
 * towers are no obstacle at all. One Dijkstra from the reactor ring gives every cell its cost-to-goal, so a
 * path from anywhere is a gradient descent plus string pulling, and re-planning after a build is one pass.
 *
 * Pure: no Babylon imports. Deterministic for a given layout + obstacle list (server and clients agree).
 */
import type { ArenaLayout, Vec2 } from './layout';

/** Footprint of something that is expensive to walk through (a live tower). */
export interface NavObstacle {
  x: number;
  z: number;
  r: number;
}

export const NAV = {
  cell: 1,
  /** Walker clearance added around solids (m). */
  clearance: 1.5,
  /** Extra cost per metre walked through a tower footprint: detours up to this long are preferred. */
  towerCost: 45,
  /** Goal ring around the reactor (m from its centre). */
  goalRadius: 7,
  /** Tunnel depth beyond the perimeter (matches the layout tunnels). */
  tunnel: 12,
  gateHalf: 4.5,
};

const SQRT2 = Math.SQRT2;
const NB: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oz: number;
  readonly cell = NAV.cell;
  /** 1 = solid for ground enemies. */
  readonly blocked: Uint8Array;
  /** Additional per-metre cost (towers). */
  readonly extra: Float32Array;
  /** Cost to the reactor ring; Infinity = unreachable. */
  dist: Float32Array;
  /** Bumped whenever the field changes (enemies compare it to re-plan). */
  version = 0;
  private obstacleKey = '';

  constructor(readonly layout: ArenaLayout, private withTowers = true) {
    const ext = layout.half + NAV.tunnel + 2;
    this.ox = -ext;
    this.oz = -ext;
    this.w = this.h = Math.ceil((ext * 2) / this.cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.extra = new Float32Array(n);
    this.dist = new Float32Array(n);
    this.rasterise();
    this.compute();
  }

  idx(x: number, z: number): number {
    const i = Math.floor((x - this.ox) / this.cell);
    const j = Math.floor((z - this.oz) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  cx(i: number): number {
    return this.ox + ((i % this.w) + 0.5) * this.cell;
  }
  cz(i: number): number {
    return this.oz + (Math.floor(i / this.w) + 0.5) * this.cell;
  }

  private rasterise(): void {
    const L = this.layout;
    const H = L.half;
    const g = NAV.gateHalf;
    const c = NAV.clearance;
    const solids = [...L.boxes, ...L.barriers].filter((b) => b.kind !== 'wall' && b.kind !== 'gate' && b.min[1] <= 1.2);
    for (let k = 0; k < this.blocked.length; k++) {
      const x = this.cx(k);
      const z = this.cz(k);
      const inside = Math.abs(x) < H && Math.abs(z) < H;
      const deep = H + NAV.tunnel - 0.5;
      const tunnel = (Math.abs(x) < g - 0.6 && Math.abs(z) >= H && Math.abs(z) < deep) || (Math.abs(z) < g - 0.6 && Math.abs(x) >= H && Math.abs(x) < deep);
      let b = !(inside || tunnel);
      if (!b && inside) b = Math.abs(x) > H - c || Math.abs(z) > H - c ? !(Math.abs(x) < g - 0.6 || Math.abs(z) < g - 0.6) : false;
      if (!b) {
        for (const box of solids) {
          if (x > box.min[0] - c && x < box.max[0] + c && z > box.min[2] - c && z < box.max[2] + c) {
            b = true;
            break;
          }
        }
      }
      if (!b) {
        for (const r of L.ramps) {
          if (x > r.x0 - c * 0.6 && x < r.x1 + c * 0.6 && z > r.z0 - c * 0.6 && z < r.z1 + c * 0.6) {
            b = true;
            break;
          }
        }
      }
      // The reactor ring is always walkable (the goal).
      if (Math.hypot(x - L.reactor.x, z - L.reactor.z) < NAV.goalRadius && Math.hypot(x - L.reactor.x, z - L.reactor.z) > L.reactor.radius + 1.2) b = false;
      this.blocked[k] = b ? 1 : 0;
    }
  }

  /** Replace the tower obstacles. Returns true (and bumps `version`) when the field changed. */
  setObstacles(obs: readonly NavObstacle[]): boolean {
    if (!this.withTowers) return false;
    const key = obs.map((o) => `${o.x.toFixed(1)},${o.z.toFixed(1)},${o.r.toFixed(1)}`).sort().join(';');
    if (key === this.obstacleKey) return false;
    this.obstacleKey = key;
    this.extra.fill(0);
    for (const o of obs) {
      const rr = o.r + NAV.clearance * 0.7;
      const i0 = Math.max(0, Math.floor((o.x - rr - this.ox) / this.cell));
      const i1 = Math.min(this.w - 1, Math.floor((o.x + rr - this.ox) / this.cell));
      const j0 = Math.max(0, Math.floor((o.z - rr - this.oz) / this.cell));
      const j1 = Math.min(this.h - 1, Math.floor((o.z + rr - this.oz) / this.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * this.w + i;
          if (Math.hypot(this.cx(k) - o.x, this.cz(k) - o.z) <= rr) this.extra[k] = NAV.towerCost;
        }
      }
    }
    this.compute();
    return true;
  }

  /** Dijkstra from every goal cell (binary heap on typed arrays). */
  compute(): void {
    const n = this.w * this.h;
    const dist = new Float32Array(n).fill(Infinity);
    const heap = new MinHeap(n);
    const L = this.layout;
    for (let k = 0; k < n; k++) {
      if (this.blocked[k]) continue;
      if (Math.hypot(this.cx(k) - L.reactor.x, this.cz(k) - L.reactor.z) <= NAV.goalRadius) {
        dist[k] = 0;
        heap.push(k, 0);
      }
    }
    const w = this.w;
    while (heap.size) {
      const k = heap.pop();
      const d = dist[k];
      const i = k % w;
      const j = (k - i) / w;
      for (const [di, dj, len] of NB) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
        const nk = nj * w + ni;
        if (this.blocked[nk]) continue;
        // No corner cutting past solids.
        if (di && dj && (this.blocked[j * w + ni] || this.blocked[nj * w + i])) continue;
        const nd = d + len * this.cell * (1 + this.extra[nk]);
        if (nd < dist[nk]) {
          dist[nk] = nd;
          heap.push(nk, nd);
        }
      }
    }
    this.dist = dist;
    this.version++;
  }

  /** Cost to goal at a world point (nearest walkable cell). */
  costAt(x: number, z: number): number {
    const k = this.nearestOpen(x, z);
    return k < 0 ? Infinity : this.dist[k];
  }

  walkable(x: number, z: number): boolean {
    const k = this.idx(x, z);
    return k >= 0 && !this.blocked[k];
  }

  /** Nearest walkable, reachable cell (spiral search, up to 8 m). */
  nearestOpen(x: number, z: number): number {
    const k0 = this.idx(x, z);
    if (k0 >= 0 && !this.blocked[k0] && Number.isFinite(this.dist[k0])) return k0;
    const i0 = Math.floor((x - this.ox) / this.cell);
    const j0 = Math.floor((z - this.oz) / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= 8 / this.cell && best < 0; r++) {
      for (let j = j0 - r; j <= j0 + r; j++) {
        for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const k = j * this.w + i;
          if (this.blocked[k] || !Number.isFinite(this.dist[k])) continue;
          const d = Math.hypot(this.cx(k) - x, this.cz(k) - z);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
      }
    }
    return best;
  }

  /** Straight segment that stays on walkable, tower-free cells. */
  clear(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const k = this.idx(ax + (bx - ax) * t, az + (bz - az) * t);
      if (k < 0 || this.blocked[k] || this.extra[k] > 0) return false;
    }
    return true;
  }

  /**
   * Path from a world point to the reactor ring: gradient descent over the field, then string pulling.
   * The first point is the start itself. Returns [] when unreachable.
   */
  pathFrom(x: number, z: number): Vec2[] {
    let k = this.nearestOpen(x, z);
    if (k < 0) return [];
    const cells: number[] = [k];
    const w = this.w;
    for (let guard = 0; guard < this.w * 4 && this.dist[k] > 0; guard++) {
      const i = k % w;
      const j = (k - i) / w;
      let best = k;
      let bestD = this.dist[k];
      for (const [di, dj] of NB) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
        const nk = nj * w + ni;
        if (this.blocked[nk]) continue;
        if (di && dj && (this.blocked[j * w + ni] || this.blocked[nj * w + i])) continue;
        if (this.dist[nk] < bestD) {
          bestD = this.dist[nk];
          best = nk;
        }
      }
      if (best === k) break;
      k = best;
      cells.push(k);
    }
    const pts: Vec2[] = [{ x, z }, ...cells.slice(1).map((c) => ({ x: this.cx(c), z: this.cz(c) }))];
    // End on the ring, on the line from the reactor to the last cell (walkers ring the reactor).
    const last = pts[pts.length - 1];
    const R = this.layout.reactor;
    const ang = Math.atan2(last.x - R.x, last.z - R.z);
    const ring = R.radius + 3.2;
    pts.push({ x: R.x + Math.sin(ang) * ring, z: R.z + Math.cos(ang) * ring });
    return this.pull(pts);
  }

  /** Greedy string pulling: keep a point only when the straight line past it is not clear. */
  private pull(pts: Vec2[]): Vec2[] {
    if (pts.length <= 2) return pts;
    const out: Vec2[] = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.clear(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }
}

/** Index min-heap keyed by float priority (duplicates allowed; stale entries skipped by the caller's relax). */
class MinHeap {
  private keys: Int32Array;
  private pri: Float32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Int32Array(cap * 2 + 16);
    this.pri = new Float32Array(cap * 2 + 16);
  }
  push(k: number, p: number): void {
    if (this.size >= this.keys.length) {
      const nk = new Int32Array(this.keys.length * 2);
      nk.set(this.keys);
      const np = new Float32Array(this.pri.length * 2);
      np.set(this.pri);
      this.keys = nk;
      this.pri = np;
    }
    let i = this.size++;
    while (i > 0) {
      const p2 = (i - 1) >> 1;
      if (this.pri[p2] <= p) break;
      this.keys[i] = this.keys[p2];
      this.pri[i] = this.pri[p2];
      i = p2;
    }
    this.keys[i] = k;
    this.pri[i] = p;
  }
  pop(): number {
    const top = this.keys[0];
    const lk = this.keys[--this.size];
    const lp = this.pri[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.pri[c + 1] < this.pri[c]) c++;
      if (this.pri[c] >= lp) break;
      this.keys[i] = this.keys[c];
      this.pri[i] = this.pri[c];
      i = c;
    }
    this.keys[i] = lk;
    this.pri[i] = lp;
    return top;
  }
}
