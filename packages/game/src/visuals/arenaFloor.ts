import { type Material, type Mesh, MeshBuilder, type Scene } from '@babylonjs/core';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { planPads } from '@riftwarden/rules/world/rubblePlan';
import type { Palette } from './materials';

/**
 * Floor zoning for the arena yard: breaks the open deck into readable areas without touching
 * gameplay. Everything is a thin inlay (top at 8 mm, below the floor decals at 16 mm and the
 * lane lights at 28 mm), not pickable and without collision, merged per material by the host.
 *
 * - Reactor plaza: a ring of radial steel plates with a painted hazard border.
 * - Drainage gutters along the base of every perimeter wall, with grate bars.
 * - Hazard chevrons across each gate mouth (where the hostiles come in).
 */
export interface FloorHost {
  readonly scene: Scene;
  add(mesh: Mesh, mat: Material, surface: string | null): void;
}

const TOP = 0.008;

export class ArenaFloor {
  private n = 0;

  constructor(
    private h: FloorHost,
    private P: Palette,
    private L: ArenaLayout,
  ) {}

  build(): void {
    this.plaza();
    this.gutters();
    for (const p of planPads(this.L)) this.pad(p.x, p.z, p.half, p.yaw);
    for (const g of [
      { x: 0, z: this.L.half, yaw: 0 },
      { x: 0, z: -this.L.half, yaw: Math.PI },
      { x: this.L.half, z: 0, yaw: Math.PI / 2 },
      { x: -this.L.half, z: 0, yaw: -Math.PI / 2 },
    ]) this.chevrons(g.x, g.z, g.yaw);
  }

  /** Flat plate centred at (x, z), rotated by yaw, from y=0 to `top`. */
  private plate(x: number, z: number, w: number, d: number, yaw: number, mat: Material, top = TOP): void {
    const m = MeshBuilder.CreateBox(`af${this.n++}`, { width: w, height: top, depth: d }, this.h.scene);
    m.position.set(x, top / 2, z);
    m.rotation.y = yaw;
    this.h.add(m, mat, null);
  }

  /** Radial steel plates around the reactor base (two courses), seams between them, painted border. */
  private plaza(): void {
    const { x: cx, z: cz } = this.L.reactor;
    const courses: [number, number, number][] = [
      [5.3, 7.9, 20],
      [8.1, 10.9, 28],
    ];
    for (const [r0, r1, n] of courses) {
      const mid = (r0 + r1) / 2;
      const d = r1 - r0;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        // Plate width = arc length at mid radius minus a seam; alternating finish for a cast/plate rhythm.
        const w = ((2 * Math.PI * mid) / n) * 0.94;
        this.plate(cx + Math.sin(a) * mid, cz + Math.cos(a) * mid, w, d - 0.08, a, i % 4 === 0 ? this.P.metal : this.P.graphite);
      }
    }
    // Painted hazard border: alternating dashes on the outer edge.
    const r = 11.25;
    const dashes = 56;
    for (let i = 0; i < dashes; i++) {
      const a = (i / dashes) * Math.PI * 2;
      const w = ((2 * Math.PI * r) / dashes) * 0.52;
      this.plate(cx + Math.sin(a) * r, cz + Math.cos(a) * r, w, 0.34, a, i % 2 === 0 ? this.P.enamel : this.P.graphite);
    }
  }

  /** Drainage gutter along the inner face of each wall: dark channel + grate bars. */
  private gutters(): void {
    const H = this.L.half;
    const g = 4.5 + 0.6; // keep clear of the gate mouths
    const w = 0.85;
    const runs: [number, number][] = [[-H + 0.3, -g], [g, H - 0.3]];
    for (const side of [-1, 1]) {
      const c = side * (H - w / 2 - 0.05);
      for (const [a, b] of runs) {
        const len = b - a;
        const mid = (a + b) / 2;
        // along x (north/south walls) and along z (east/west walls)
        this.plate(mid, c, len, w, 0, this.P.enemyDark, TOP * 0.5);
        this.plate(c, mid, w, len, 0, this.P.enemyDark, TOP * 0.5);
        for (let t = a + 0.2; t < b; t += 0.32) {
          this.plate(t, c, 0.07, w - 0.12, 0, this.P.metal, TOP * 1.6);
          this.plate(c, t, w - 0.12, 0.07, 0, this.P.metal, TOP * 1.6);
        }
        // Frame rails along both edges.
        for (const e of [-1, 1]) {
          this.plate(mid, c + e * (w / 2 - 0.03), len, 0.06, 0, this.P.graphite, TOP * 1.8);
          this.plate(c + e * (w / 2 - 0.03), mid, 0.06, len, 0, this.P.graphite, TOP * 1.8);
        }
      }
    }
  }

  /** Painted build pad: lighter deck square, corner brackets and a centre mark. */
  private pad(x: number, z: number, half: number, yaw: number): void {
    const P = this.P;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
    // Dark sealed square, bright corner brackets: reads as paint on the deck, not as a loose sheet.
    this.plate(x, z, half * 2, half * 2, yaw, P.enemyDark, TOP * 0.6);
    const arm = half * 0.5;
    const t = 0.18;
    for (const su of [-1, 1])
      for (const sv of [-1, 1]) {
        const [ax, az] = at(su * (half - arm / 2), sv * (half - t / 2));
        this.plate(ax, az, arm, t, yaw, P.enamel, TOP * 1.2);
        const [bx, bz] = at(su * (half - t / 2), sv * (half - arm / 2));
        this.plate(bx, bz, t, arm, yaw, P.enamel, TOP * 1.2);
      }
    this.plate(x, z, 0.7, 0.08, yaw, P.metal, TOP * 1.2);
    this.plate(x, z, 0.08, 0.7, yaw, P.metal, TOP * 1.2);
  }

  /** Diagonal hazard stripes across a gate mouth (yaw: 0 = north gate). */
  private chevrons(x: number, z: number, yaw: number): void {
    const width = 9;
    const depth = 1.6;
    const inward = 1.2;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // Centre of the strip, just inside the wall line.
    const cx = x - fx * inward, cz = z - fz * inward;
    this.plate(cx, cz, width, depth, yaw, this.P.graphite, TOP * 0.9);
    const stripes = 9;
    for (let i = 0; i < stripes; i++) {
      const t = (i + 0.5) / stripes - 0.5;
      this.plate(cx + rx * t * width, cz + rz * t * width, 0.42, depth * 1.25, yaw + Math.PI / 4, this.P.enamel, TOP * 1.4);
    }
  }
}
