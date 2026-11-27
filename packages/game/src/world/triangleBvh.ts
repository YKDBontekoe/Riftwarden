/**
 * Static triangle BVH for ray picking against large frozen meshes (merged arena/HQ shells: 15k-125k triangles in a
 * handful of meshes whose bounds cover the whole level, so Babylon's per-submesh loop tested every triangle on every
 * ray). Pure (no Babylon): built once from local-space positions + indices, queried with a local-space ray.
 *
 * Results match Babylon's brute force exactly: the same Moller-Trumbore test with the same epsilon/length rules
 * (`Ray.intersectsTriangle`), nearest hit wins and equal distances resolve to the lowest triangle index (the
 * brute-force loop keeps the first strictly-closer hit). `fastCheck` returns any hit (callers only need yes/no).
 */
export interface BvhHit {
  /** Triangle index relative to the indexed range the BVH was built from. */
  face: number;
  distance: number;
  /** Barycentrics as Babylon reports them (`bu` = 1 - bv - bw, `bv`). */
  bu: number;
  bv: number;
}

/** Triangles per leaf; small leaves keep per-ray tests in the tens even for 100k-triangle meshes. */
const LEAF = 6;

export class TriangleBvh {
  /** Per node: minX, minY, minZ, maxX, maxY, maxZ. */
  private readonly bounds: Float64Array;
  /** Per node: leaf -> first triangle slot (>= 0) and count; inner -> -(right child) - 1 and 0 (left child = node + 1). */
  private readonly nodeStart: Int32Array;
  private readonly nodeCount: Int32Array;
  /** Triangle slots in leaf order -> original triangle index. */
  private readonly order: Int32Array;
  /** Vertex positions per triangle (9 floats), indexed by original triangle index. */
  private readonly tri: Float64Array;
  private nodes = 0;
  readonly triangles: number;
  private readonly stack: Int32Array;

  constructor(positions: ArrayLike<number>, indices: ArrayLike<number>, indexStart = 0, indexCount = indices.length) {
    const n = Math.floor(indexCount / 3);
    this.triangles = n;
    const tri = new Float64Array(n * 9);
    const cx = new Float32Array(n);
    const cy = new Float32Array(n);
    const cz = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const v = indices[indexStart + t * 3 + k] * 3;
        tri[t * 9 + k * 3] = positions[v];
        tri[t * 9 + k * 3 + 1] = positions[v + 1];
        tri[t * 9 + k * 3 + 2] = positions[v + 2];
      }
      cx[t] = (tri[t * 9] + tri[t * 9 + 3] + tri[t * 9 + 6]) / 3;
      cy[t] = (tri[t * 9 + 1] + tri[t * 9 + 4] + tri[t * 9 + 7]) / 3;
      cz[t] = (tri[t * 9 + 2] + tri[t * 9 + 5] + tri[t * 9 + 8]) / 3;
    }
    this.tri = tri;
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    this.order = order;
    const maxNodes = Math.max(1, 2 * Math.ceil(n / Math.max(1, LEAF / 2)));
    this.bounds = new Float64Array(maxNodes * 6);
    this.nodeStart = new Int32Array(maxNodes);
    this.nodeCount = new Int32Array(maxNodes);
    let depth = 0;
    if (n > 0) depth = this.build(0, n, cx, cy, cz, 0);
    this.stack = new Int32Array(Math.max(64, depth * 2 + 4));
  }

  /** Builds node(s) for order[lo..hi), median split on the widest centroid axis. Returns the subtree depth. */
  private build(lo: number, hi: number, cx: Float32Array, cy: Float32Array, cz: Float32Array, level: number): number {
    const node = this.nodes++;
    const b = this.bounds;
    const o = node * 6;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let c0x = Infinity, c0y = Infinity, c0z = Infinity, c1x = -Infinity, c1y = -Infinity, c1z = -Infinity;
    for (let i = lo; i < hi; i++) {
      const t = this.order[i];
      for (let k = 0; k < 9; k += 3) {
        const px = this.tri[t * 9 + k], py = this.tri[t * 9 + k + 1], pz = this.tri[t * 9 + k + 2];
        if (px < x0) x0 = px;
        if (py < y0) y0 = py;
        if (pz < z0) z0 = pz;
        if (px > x1) x1 = px;
        if (py > y1) y1 = py;
        if (pz > z1) z1 = pz;
      }
      if (cx[t] < c0x) c0x = cx[t];
      if (cy[t] < c0y) c0y = cy[t];
      if (cz[t] < c0z) c0z = cz[t];
      if (cx[t] > c1x) c1x = cx[t];
      if (cy[t] > c1y) c1y = cy[t];
      if (cz[t] > c1z) c1z = cz[t];
    }
    b[o] = x0; b[o + 1] = y0; b[o + 2] = z0; b[o + 3] = x1; b[o + 4] = y1; b[o + 5] = z1;
    const count = hi - lo;
    const ex = c1x - c0x, ey = c1y - c0y, ez = c1z - c0z;
    if (count <= LEAF || Math.max(ex, ey, ez) <= 0) {
      this.nodeStart[node] = lo;
      this.nodeCount[node] = count;
      return level + 1;
    }
    const axis = ex >= ey && ex >= ez ? cx : ey >= ez ? cy : cz;
    const mid = (lo + hi) >> 1;
    this.select(lo, hi - 1, mid, axis);
    const dl = this.build(lo, mid, cx, cy, cz, level + 1);
    const right = this.nodes;
    const dr = this.build(mid, hi, cx, cy, cz, level + 1);
    this.nodeStart[node] = -right - 1;
    this.nodeCount[node] = 0;
    return Math.max(dl, dr);
  }

  /** Quickselect: order[k] gets the element that belongs there by `key`, smaller ones before it. */
  private select(lo: number, hi: number, k: number, key: Float32Array): void {
    const a = this.order;
    while (hi > lo) {
      const pivot = key[a[(lo + hi) >> 1]];
      let i = lo, j = hi;
      while (i <= j) {
        while (key[a[i]] < pivot) i++;
        while (key[a[j]] > pivot) j--;
        if (i <= j) {
          const t = a[i]; a[i] = a[j]; a[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }

  /**
   * Nearest triangle along the ray within `length` (Babylon's `Ray.length`), or null. The direction need not be
   * normalised (distances are in units of the direction, as in Babylon).
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number, epsilon = 0, fastCheck = false): BvhHit | null {
    if (this.nodes === 0) return null;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const b = this.bounds;
    const tri = this.tri;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    let bestD = Infinity, bestF = -1, bestU = 0, bestV = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const o = node * 6;
      // Slab test; NaN-safe for axis-parallel rays (0 * Infinity never reaches here: min/max below handle +-Infinity).
      let t0 = 0, t1 = Math.min(length, bestD);
      let ta = (b[o] - ox) * ix, tb = (b[o + 3] - ox) * ix;
      if (ta !== ta || tb !== tb) { if (ox < b[o] || ox > b[o + 3]) continue; } else {
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1 + 1e-6) continue;
      }
      ta = (b[o + 1] - oy) * iy; tb = (b[o + 4] - oy) * iy;
      if (ta !== ta || tb !== tb) { if (oy < b[o + 1] || oy > b[o + 4]) continue; } else {
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1 + 1e-6) continue;
      }
      ta = (b[o + 2] - oz) * iz; tb = (b[o + 5] - oz) * iz;
      if (ta !== ta || tb !== tb) { if (oz < b[o + 2] || oz > b[o + 5]) continue; } else {
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1 + 1e-6) continue;
      }
      const start = this.nodeStart[node];
      if (start < 0) {
        stack[sp++] = -start - 1;
        stack[sp++] = node + 1;
        continue;
      }
      const end = start + this.nodeCount[node];
      for (let s = start; s < end; s++) {
        const f = this.order[s];
        const p = f * 9;
        const v0x = tri[p], v0y = tri[p + 1], v0z = tri[p + 2];
        const e1x = tri[p + 3] - v0x, e1y = tri[p + 4] - v0y, e1z = tri[p + 5] - v0z;
        const e2x = tri[p + 6] - v0x, e2y = tri[p + 7] - v0y, e2z = tri[p + 8] - v0z;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det === 0) continue;
        const inv = 1 / det;
        const tx = ox - v0x, ty = oy - v0y, tz = oz - v0z;
        const bv = (tx * px + ty * py + tz * pz) * inv;
        if (bv < -epsilon || bv > 1 + epsilon) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const bw = (dx * qx + dy * qy + dz * qz) * inv;
        if (bw < -epsilon || bv + bw > 1 + epsilon) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > length || dist < 0) continue;
        if (dist < bestD || (dist === bestD && f < bestF)) {
          bestD = dist;
          bestF = f;
          bestU = 1 - bv - bw;
          bestV = bv;
          if (fastCheck) return { face: bestF, distance: bestD, bu: bestU, bv: bestV };
        }
      }
    }
    return bestF < 0 ? null : { face: bestF, distance: bestD, bu: bestU, bv: bestV };
  }
}
