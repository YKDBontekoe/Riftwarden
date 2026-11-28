import { distToBoxXZ, distToPolyline } from '@riftwarden/rules/world/geometry';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { planPads } from '@riftwarden/rules/world/rubblePlan';

/**
 * Visual relief for the arena ground (pure, no Babylon): settled concrete slabs with their own tilt and offset,
 * broad dips where water would pool, cryo snow drifts and sunken scorch around foundry slag. Presentation only:
 * the collider stays the flat plane at y = 0, and the relief fades to exactly 0 on enemy lanes, the reactor
 * plaza, the spawn and within `CLEAR` metres of every solid, so enemies' feet, props, rubble, grime strips and
 * towers all still sit flush. Amplitude stays small (|h| <= MAX_RELIEF) so nothing visibly floats elsewhere.
 */
export const MAX_RELIEF = 0.16;
/** Distance from solids over which the relief fades in (props, grime and rubble sit in this band). */
export const CLEAR = 2.2;
/** Slab size of the settled-concrete relief (m); floor joints run on this grid. */
export const SLAB = 6;

const hash = (x: number, z: number, seed: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function noise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, zi, seed), b = hash(xi + 1, zi, seed), c = hash(xi, zi + 1, seed), d = hash(xi + 1, zi + 1, seed);
  const u = s(fx), v = s(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth01 = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** A precomputed relief field for one layout: `height(x, z)` is cheap enough to sample per ground vertex. */
export class GroundRelief {
  private readonly seed: number;
  private readonly biome: NonNullable<ArenaLayout['biome']>;
  /** Fade mask on a 1 m grid (0 = flat, 1 = full relief), from distances to solids, lanes, plaza and spawn. */
  private readonly mask: Float32Array;
  private readonly n: number;
  private readonly origin: number;

  constructor(private readonly L: ArenaLayout) {
    this.seed = (L.seed ?? 7) >>> 0;
    this.biome = L.biome ?? 'outpost';
    const H = L.half;
    this.origin = -H;
    this.n = Math.ceil(H * 2) + 1;
    this.mask = new Float32Array(this.n * this.n);
    const solids = [...L.boxes.filter((b) => b.min[1] < 0.2), L.southDoor, ...L.barriers];
    // Painted or emissive floor features that sit just above y = 0 must not be buried by raised relief.
    const discs = [
      ...(L.hazards ?? []).map((p) => ({ x: p.x, z: p.z, r: p.r + 1 })),
      ...L.vents.map((v) => ({ x: v.x, z: v.z, r: v.r + 1.5 })),
      ...(L.rifts ?? []).map((r) => ({ x: r.x, z: r.z, r: 4 })),
      ...planPads(L).map((p) => ({ x: p.x, z: p.z, r: p.half * 1.6 })),
    ];
    for (let i = 0; i < this.n; i++)
      for (let j = 0; j < this.n; j++) {
        const x = this.origin + i;
        const z = this.origin + j;
        let d = Infinity;
        for (const b of solids) d = Math.min(d, distToBoxXZ(x, z, b));
        let lane = Infinity;
        for (const r of Object.values(L.routes)) lane = Math.min(lane, distToPolyline(x, z, r.points) - L.laneHalfWidth);
        const plaza = Math.hypot(x - L.reactor.x, z - L.reactor.z) - (L.reactor.radius + 4);
        const spawn = Math.hypot(x - L.playerSpawn.x, z - L.playerSpawn.z) - 4;
        const edge = H - Math.max(Math.abs(x), Math.abs(z)) - 1;
        let m = smooth01((d - CLEAR) / 1.5) * smooth01((lane - 0.6) / 2) * smooth01(plaza / 3) * smooth01(spawn / 3) * smooth01(edge / 2);
        for (const r of L.ramps) if (x > r.x0 - 1.5 && x < r.x1 + 1.5 && z > r.z0 - 1.5 && z < r.z1 + 1.5) m = 0;
        for (const q of discs) m *= smooth01((Math.hypot(x - q.x, z - q.z) - q.r) / 1.5);
        this.mask[i * this.n + j] = m;
      }
  }

  /** Fade mask at (x, z), bilinear on the 1 m grid; 0 outside the playable square. */
  fade(x: number, z: number): number {
    const fx = x - this.origin;
    const fz = z - this.origin;
    if (fx < 0 || fz < 0 || fx >= this.n - 1 || fz >= this.n - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const m = this.mask;
    const n = this.n;
    const a = m[i * n + j], b = m[(i + 1) * n + j], c = m[i * n + j + 1], d = m[(i + 1) * n + j + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Relief height (m) at a world point. */
  height(x: number, z: number): number {
    const f = this.fade(x, z);
    if (f <= 0) return 0;
    const s = this.seed;
    let h: number;
    if (this.biome === 'cryo') {
      // Wind-packed snow: long low drifts plus small hummocks.
      const drift = noise(x / 14 + z / 40, z / 9, s) - 0.5;
      const hum = noise(x / 3.5, z / 3.5, s + 5) - 0.5;
      h = 0.07 + drift * 0.16 + hum * 0.05;
    } else {
      // Settled slabs: each 6 m slab has its own offset and tilt, so edges step and catch the light.
      const si = Math.floor(x / SLAB), sj = Math.floor(z / SLAB);
      const lx = x - (si + 0.5) * SLAB, lz = z - (sj + 0.5) * SLAB;
      const off = (hash(si, sj, s) - 0.5) * 0.06;
      const tx = (hash(si, sj, s + 1) - 0.5) * 0.012;
      const tz = (hash(si, sj, s + 2) - 0.5) * 0.012;
      // Broad dips where water pools (negative only), and a slight rut grain.
      const dip = Math.min(0, noise(x / 11, z / 11, s + 3) - 0.62) * 0.35;
      h = off + tx * lx + tz * lz + dip;
      if (this.biome === 'foundry') {
        // Scorched patches have sunk a little around the slag pools.
        for (const p of this.L.hazards ?? []) {
          const d = Math.hypot(x - p.x, z - p.z) - p.r - 1;
          if (d < 5) h -= 0.06 * smooth01(1 - Math.max(0, d) / 5);
        }
      }
    }
    h = Math.max(-MAX_RELIEF, Math.min(MAX_RELIEF, h));
    return h * f;
  }
}
