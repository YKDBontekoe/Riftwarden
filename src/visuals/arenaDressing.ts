import { type Material, type Mesh, MeshBuilder, type Scene } from '@babylonjs/core';
import type { ArenaLayout, Box } from '../world/layout';
import type { Palette } from './materials';

/** What the dressing needs from the arena builder: merged-by-material boxes and meshes. */
export interface DressingHost {
  readonly scene: Scene;
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, surface: string | null): Mesh;
  add(mesh: Mesh, mat: Material, surface: string | null): void;
}

type Axis = 'x' | 'y' | 'z';

/**
 * Set dressing for the arena: purely visual detail on existing solids, flush with the floor, or outside
 * the playable walls. Nothing here adds collision, so placement, navigation and line of sight are
 * unchanged; every piece is merged into the arena's per-material meshes (no extra draw calls).
 */
export class ArenaDressing {
  private n = 0;

  constructor(private h: DressingHost, private P: Palette, private L: ArenaLayout) {}

  build(): void {
    for (const b of this.L.boxes) {
      if (b.kind === 'wall') this.wall(b);
      else if (b.kind === 'block') this.block(b);
    }
    this.tunnels();
    this.drains();
    this.outside();
  }

  // ------------------------------------------------------------------ helpers

  /** Cylinder along an axis from a to b (centre line at the two other coordinates). */
  private pipe(axis: Axis, a: number, b: number, u: number, v: number, d: number, mat: Material, surface: string | null = null): void {
    const len = Math.abs(b - a);
    if (len < 0.05) return;
    const m = MeshBuilder.CreateCylinder(`pipe${this.n++}`, { height: len, diameter: d, tessellation: d > 1 ? 20 : 12 }, this.h.scene);
    const mid = (a + b) / 2;
    if (axis === 'y') m.position.set(u, mid, v);
    else if (axis === 'x') {
      m.rotation.z = Math.PI / 2;
      m.position.set(mid, u, v);
    } else {
      m.rotation.x = Math.PI / 2;
      m.position.set(u, v, mid);
    }
    this.h.add(m, mat, surface);
  }

  /** Box given by centre/half extents (shorter for detail work). */
  private cbox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, mat: Material, surface: string | null = null): void {
    this.h.box(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz, mat, surface);
  }

  // ------------------------------------------------------------------ perimeter walls

  /** Inner face of a perimeter wall: pipe runs with brackets, vent grilles and wall screens per bay. */
  private wall(b: Box): void {
    const P = this.P;
    const H = this.L.half;
    const [x0, , z0] = b.min;
    const [x1, y1, z1] = b.max;
    const alongX = x1 - x0 > z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Face toward the arena centre and its outward normal sign.
    const face = alongX ? (cz < 0 ? z1 : z0) : cx < 0 ? x1 : x0;
    const s = alongX ? (cz < 0 ? 1 : -1) : cx < 0 ? 1 : -1;
    // Run limited to the inside of the perimeter (walls overlap at the corners).
    const a = Math.max(alongX ? x0 : z0, -H + 0.3);
    const e = Math.min(alongX ? x1 : z1, H - 0.3);
    const at = (along: number, y: number, out: number, ha: number, hy: number, ho: number, mat: Material, surface: string | null = null) =>
      alongX ? this.cbox(along, y, face + s * out, ha, hy, ho, mat, surface) : this.cbox(face + s * out, y, along, ho, hy, ha, mat, surface);

    // Two service pipes high on the wall, on brackets every 4 m.
    const pipeY = y1 - 1.75;
    if (alongX) {
      this.pipe('x', a, e, pipeY, face + s * 0.42, 0.42, P.metal);
      this.pipe('x', a, e, pipeY + 0.5, face + s * 0.3, 0.24, P.graphite);
    } else {
      this.pipe('z', a, e, face + s * 0.42, pipeY, 0.42, P.metal);
      this.pipe('z', a, e, face + s * 0.3, pipeY + 0.5, 0.24, P.graphite);
    }
    for (let t = a + 2; t < e - 0.5; t += 4) at(t, pipeY + 0.2, 0.3, 0.08, 0.5, 0.3, P.graphite, 'wall');

    // Bays between the pilasters (pilasters sit every 8 m from the wall's start, see ArenaBuilder.buildBox).
    const start = alongX ? x0 : z0;
    let bay = 0;
    for (let p = start + 4; p < e; p += 8, bay++) {
      const mid = p + 4;
      if (mid - 2 < a || mid + 2 > e) continue;
      if (bay % 2 === 0) {
        // Low vent grille: frame + slats.
        at(mid, 1.35, 0.03, 1.4, 0.55, 0.05, P.graphite, 'wall');
        for (let k = 0; k < 5; k++) at(mid, 0.95 + k * 0.2, 0.09, 1.25, 0.035, 0.03, P.metal, 'wall');
      } else {
        // Status screen: dark frame + glowing panel + a small amber indicator.
        at(mid, 3.6, 0.04, 1.2, 0.7, 0.05, P.graphite, 'wall');
        at(mid, 3.62, 0.1, 1.0, 0.52, 0.01, P.cyanDim, null);
        at(mid + 0.9, 2.75, 0.06, 0.12, 0.05, 0.02, P.orangeGlow, null);
      }
      // Panel seam between bays at mid height.
      at(mid, 6.2, 0.02, 3.6, 0.04, 0.03, P.graphite, 'wall');
    }
  }

  // ------------------------------------------------------------------ partitions and cover pillars

  private block(b: Box): void {
    const P = this.P;
    const [x0, , z0] = b.min;
    const [x1, y1, z1] = b.max;
    const top = y1 - 0.4;
    // Vertical panel seams every ~1.8 m on every face.
    const seams = (len: number) => Math.max(1, Math.round(len / 1.8));
    const nx = seams(x1 - x0);
    for (let i = 1; i < nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      for (const z of [z0 + 0.05, z1 - 0.05]) this.cbox(x, (0.7 + top) / 2, z, 0.04, (top - 0.7) / 2, 0.025, P.graphite, 'wall');
    }
    const nz = seams(z1 - z0);
    for (let i = 1; i < nz; i++) {
      const z = z0 + ((z1 - z0) * i) / nz;
      for (const x of [x0 + 0.05, x1 - 0.05]) this.cbox(x, (0.7 + top) / 2, z, 0.025, (top - 0.7) / 2, 0.04, P.graphite, 'wall');
    }
    // Roof units: a vent box and a small fan housing (low, no collision needed).
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;
    this.cbox(cx - w * 0.2, y1 + 0.15, cz, Math.min(0.6, w * 0.18), 0.15, Math.min(0.5, d * 0.2), P.graphite);
    this.cbox(cx - w * 0.2, y1 + 0.31, cz, Math.min(0.5, w * 0.15), 0.01, Math.min(0.4, d * 0.16), P.metal);
    this.pipe('y', y1, y1 + 0.28, cx + w * 0.22, cz + d * 0.15, Math.min(0.7, Math.min(w, d) * 0.35), P.metal);
    this.pipe('y', y1 + 0.28, y1 + 0.3, cx + w * 0.22, cz + d * 0.15, Math.min(0.55, Math.min(w, d) * 0.28), P.cyanDim);
  }

  // ------------------------------------------------------------------ gate tunnels

  /** Structural ribs and ceiling beams inside each gate tunnel (built in north space, rotated per gate). */
  private tunnels(): void {
    const P = this.P;
    const H = this.L.half;
    const g = 4.5;
    const rots: ((x: number, z: number) => [number, number])[] = [
      (x, z) => [x, z],
      (x, z) => [z, -x],
      (x, z) => [-z, x],
      (x, z) => [x, -z],
    ];
    for (const rot of rots) {
      const quad = (lx0: number, y0: number, lz0: number, lx1: number, y1: number, lz1: number, mat: Material, surface: string | null) => {
        const [ax, az] = rot(lx0, lz0);
        const [bx, bz] = rot(lx1, lz1);
        this.h.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), mat, surface);
      };
      for (let z = H + 3; z < H + 11.5; z += 2.6) {
        for (const side of [-1, 1]) {
          const x = side * g;
          quad(x - side * 0.28, 0, z - 0.25, x, 8.2, z + 0.25, P.metal, 'wall');
          quad(x - side * 0.34, 2.0, z - 0.3, x, 2.2, z + 0.3, P.orangeDim, null);
        }
        quad(-g, 8.2, z - 0.22, g, 8.6, z + 0.22, P.graphite, null);
      }
    }
  }

  // ------------------------------------------------------------------ floor

  /** Drainage channels with grate slats along the inner wall bases (flush, cosmetic). */
  private drains(): void {
    const P = this.P;
    const H = this.L.half;
    const g = 4.5;
    const runs: [number, number][] = [[-H + 1, -g - 1], [g + 1, H - 1]];
    for (const [a, b] of runs) {
      for (const side of [-1, 1]) {
        const c = side * (H - 0.7);
        // north/south walls (along x) and east/west walls (along z)
        this.h.box(a, 0.005, c - 0.35, b, 0.02, c + 0.35, P.graphite, null);
        this.h.box(c - 0.35, 0.005, a, c + 0.35, 0.02, b, P.graphite, null);
        for (let t = a + 0.3; t < b; t += 0.6) {
          this.h.box(t - 0.05, 0.02, c - 0.3, t + 0.05, 0.035, c + 0.3, P.metal, null);
          this.h.box(c - 0.3, 0.02, t - 0.05, c + 0.3, 0.035, t + 0.05, P.metal, null);
        }
      }
    }
  }

  // ------------------------------------------------------------------ beyond the walls

  /** Mid-ground industry outside the facility: stacks, gantry cranes, pipelines, lattice masts. */
  private outside(): void {
    const P = this.P;
    const H = this.L.half;
    // Refinery stacks with banded rings and red aviation lights.
    for (const [x, z, d, h] of [[-78, 58, 7, 34], [-66, 72, 4.5, 26], [84, 66, 8, 38], [92, -48, 6, 30], [-88, -64, 7, 32], [70, -80, 4, 22]]) {
      this.pipe('y', 0, h, x, z, d, P.graphite);
      for (let y = 6; y < h - 2; y += 7) this.pipe('y', y, y + 0.6, x, z, d + 0.4, P.metal);
      this.pipe('y', h, h + 0.5, x, z, d + 0.6, P.metal);
      this.pipe('y', h + 0.5, h + 0.9, x, z, 0.6, P.redGlow);
    }
    // Gantry cranes straddling the north and west walls: two legs outside, a beam over the wall top.
    const crane = (alongX: boolean, c: number, lo: number, hi: number) => {
      const legOut = c + Math.sign(c) * 8;
      const legIn = c + Math.sign(c) * 3;
      for (const l of [lo, hi]) {
        for (const o of [legIn, legOut]) {
          if (alongX) this.cbox(l, 9, o, 0.5, 9, 0.5, P.graphite);
          else this.cbox(o, 9, l, 0.5, 9, 0.5, P.graphite);
        }
      }
      for (const o of [legIn, legOut]) {
        if (alongX) this.h.box(lo - 0.6, 17.4, o - 0.6, hi + 0.6, 18.6, o + 0.6, P.graphite, null);
        else this.h.box(o - 0.6, 17.4, lo - 0.6, o + 0.6, 18.6, hi + 0.6, P.graphite, null);
      }
      // Trolley + hook block, and a warning light strip under the beam.
      const mid = (lo + hi) / 2;
      const oc = (legIn + legOut) / 2;
      if (alongX) {
        this.h.box(mid - 1.4, 16.6, legIn - 0.8, mid + 1.4, 17.4, legOut + 0.8, P.metal, null);
        this.h.box(lo, 17.3, legIn - 0.1, hi, 17.38, legIn + 0.1, P.orangeDim, null);
        this.pipe('y', 12.5, 16.6, mid, oc, 0.08, P.metal);
        this.cbox(mid, 12.2, oc, 0.5, 0.35, 0.5, P.white);
      } else {
        this.h.box(legIn - 0.8, 16.6, mid - 1.4, legOut + 0.8, 17.4, mid + 1.4, P.metal, null);
        this.h.box(legIn - 0.1, 17.3, lo, legIn + 0.1, 17.38, hi, P.orangeDim, null);
        this.pipe('y', 12.5, 16.6, oc, mid, 0.08, P.metal);
        this.cbox(oc, 12.2, mid, 0.5, 0.35, 0.5, P.white);
      }
    };
    crane(true, H + 2, -30, -14);
    crane(false, -H - 2, 14, 30);
    // Pipelines along the east and south exteriors on trestles; the tops show above the wall line.
    const line = (alongX: boolean, c: number, lo: number, hi: number) => {
      for (const [off, y, d, mat] of [[5, 10.2, 1.8, P.metal], [7.2, 9.6, 1.2, P.graphite]] as const) {
        if (alongX) this.pipe('x', lo, hi, y, c + Math.sign(c) * off, d, mat);
        else this.pipe('z', lo, hi, c + Math.sign(c) * off, y, d, mat);
      }
      for (let t = lo + 4; t < hi; t += 10) {
        if (alongX) this.h.box(t - 0.4, 0, c + Math.sign(c) * 3.8 - 0.4, t + 0.4, 9.3, c + Math.sign(c) * 8.4 + 0.4, P.graphite, null);
        else this.h.box(c + Math.sign(c) * 3.8 - 0.4, 0, t - 0.4, c + Math.sign(c) * 8.4 + 0.4, 9.3, t + 0.4, P.graphite, null);
      }
    };
    line(false, H + 2, -42, 42);
    line(true, -H - 2, -42, 42);
    // Lattice masts with cross-arms and a beacon.
    for (const [x, z] of [[-62, 18], [64, 24], [-58, -30], [30, -66], [-24, 68]]) {
      for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) this.pipe('y', 0, 28, x + dx, z + dz, 0.16, P.metal);
      for (let y = 4; y < 28; y += 4) this.cbox(x, y, z, 0.7, 0.06, 0.7, P.graphite);
      this.cbox(x, 24, z, 3.2, 0.12, 0.12, P.graphite);
      this.pipe('y', 28, 28.6, x, z, 0.5, P.redGlow);
    }
  }
}
