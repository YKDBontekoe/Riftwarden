import { type Material, Mesh, MeshBuilder, type Scene } from '@babylonjs/core';
import type { ArenaLayout, Box } from '../world/layout';
import { prismData } from '../weapons/geometry';
import type { Palette } from './materials';
import { loftData, smoothLatheData } from './sculpt';

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
    this.containmentArch();
    this.operationsGallery();
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

    // The retaining wall doubles as a cable gallery. Set each brace into its foot and cap.
    let bay = 0;
    for (let p = a + 0.9; p < e - 2; p += 7.4, bay++) {
      const brace = new Mesh('retainingButtress', this.h.scene);
      prismData([[-0.23, 0], [0.82, 0], [0.82, 0.92], [0.41, 2.45], [0.33, y1 - 0.68], [0, y1 - 0.22], [-0.23, y1 - 0.22]], 1.27, 0.105).applyToMesh(brace);
      if (alongX) brace.position.set(p, 0, face);
      else brace.position.set(face, 0, p);
      brace.rotation.y = alongX ? (s > 0 ? 0 : Math.PI) : s * Math.PI / 2;
      this.h.add(brace, bay % 3 === 0 ? P.concrete : P.graphite, 'wall');
      at(p, 2.42, 0.44, 0.20, 0.14, 0.06, P.enamel);
      const mid = p + 3.7;
      if (mid + 2.65 > e) continue;
      if (bay % 3 !== 1) {
        at(mid, 2.87, 0.02, 2.55, 1.76, 0.10, P.graphite, 'wall');
        at(mid, 2.88, 0.13, 2.24, 1.51, 0.045, P.panel, 'wall');
        at(mid, 4.44, 0.16, 2.35, 0.082, 0.06, P.metal, 'wall');
        at(mid + 1.7, 1.63, 0.19, 0.30, 0.085, 0.02, P.enamel);
      } else {
        at(mid, 2.88, 0.04, 2.3, 1.33, 0.15, P.graphite, 'wall');
        for (let k = 0; k < 7; k++) at(mid, 1.91 + k * 0.31, 0.20, 2.10, 0.072, 0.075, P.metal, 'wall');
        at(mid, 4.34, 0.14, 1.97, 0.035, 0.06, P.orangeDim, null);
      }
    }
  }

  // ------------------------------------------------------------------ partitions and cover pillars

  private block(b: Box): void {
    const P = this.P;
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    const wide = x1 - x0 > z1 - z0;
    const run = wide ? x1 - x0 : z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (run < 3.1) {
      // An open cooling stack sits between two cast cheek pieces. Broad sections at
      // shoulder height keep the collision silhouette readable from across the yard.
      const span = y1 - y0;
      const profile = smoothLatheData([[1.18, 0], [1.24, 0.18], [1.21, 0.43], [0.94, 0.64],
        [0.91, span - 0.78], [1.16, span - 0.56], [1.17, span - 0.21], [1.06, span]], 48);
      const stack = new Mesh('exchangerColumn', this.h.scene);
      profile.applyToMesh(stack);
      stack.position.set(cx, y0, cz);
      this.h.add(stack, P.graphite, 'wall');
      for (let j = 0; j < 9; j++) this.pipe('y', 0.78 + j * (span - 1.65) / 9, 0.86 + j * (span - 1.65) / 9, cx, cz, 1.98, P.metal, 'wall');
      for (const side of [-1, 1]) {
        const cheek = new Mesh('exchangerCeramic', this.h.scene);
        loftData([[0.22, 0.25, 0.78, 0.87], [0.42, 0.27, 0.87, 0.94], [0.93, 0.23, 0.84, 0.96],
          [span * 0.65, 0.20, 0.72, 1.02], [span - 0.48, 0.25, 0.55, 0.93], [span - 0.09, 0.15, 0.38, 0.82]]
          .map(([t,w,h,u]) => ({ t,w,h,u: side * u,n: 3.2 })), 'y', 28).applyToMesh(cheek);
        cheek.position.set(cx, y0, cz);
        cheek.rotation.y = cx > 0 ? 0.43 : -0.52;
        this.h.add(cheek, P.panel, 'wall');
      }
      this.pipe('y', span - 0.22, span - 0.13, cx, cz, 2.35, P.enamel, 'wall');
      return;
    }
    // Each substation has a continuous cast shell resting on a recessed plinth.
    // The longitudinal cooling drum sits between the two end castings.
    const depth = wide ? z1 - z0 : x1 - x0;
    const shell = (name: string, rows: number[][], mat: Material, position: number, scale = 1) => {
      const mesh = new Mesh(name, this.h.scene);
      loftData(rows.map(([t,w,h,v]) => ({t: t * scale + position, w, h, v, n: 4.6})), wide ? 'x' : 'z', 48).applyToMesh(mesh);
      mesh.position.set(cx, y0, cz);
      this.h.add(mesh, mat, 'wall');
    };
    const shellHalf = depth / 2;
    const halfRun = run / 2;
    const h = y1 - y0;
    shell('transformerBed', [[-halfRun + 0.08,shellHalf-0.08,0.37,0.37],[-halfRun+0.24,shellHalf,0.43,0.43],
      [halfRun-0.22,shellHalf,0.43,0.43],[halfRun-0.08,shellHalf-0.08,0.37,0.37]], P.concrete, 0);
    shell('transformerVessel', [[-halfRun+0.2,shellHalf-0.5,1.21,2.05],[-halfRun+0.6,shellHalf-0.16,1.56,2.2],
      [halfRun-0.6,shellHalf-0.16,1.56,2.2],[halfRun-0.2,shellHalf-0.5,1.21,2.05]], P.graphite, 0);
    for (const side of [-1,1]) {
      shell('transformerCheek', [[0,shellHalf-0.10,h*0.42,h*0.51],[0.2,shellHalf+0.02,h*0.45,h*0.52],
        [0.76,shellHalf+0.01,h*0.44,h*0.55],[1.18,shellHalf-0.09,h*0.36,h*0.57]],
        P.panel, side * halfRun, -side);
    }
    for (let bay = -2; bay <= 2; bay++) {
      const center = bay * (run - 3.15) / 5;
      shell('exchangerFin', [[-0.12,shellHalf-0.02,h*0.385,h*0.50],[-0.06,shellHalf+0.02,h*0.40,h*0.50],
        [0.06,shellHalf+0.02,h*0.40,h*0.50],[0.12,shellHalf-0.02,h*0.385,h*0.50]], bay === -2 ? P.enamel : P.metal, center);
    }
    const axis = wide ? 'x' : 'z';
    for (const side of [-1, 1]) {
      if (wide) this.pipe(axis, x0+0.55,x1-0.55, h-0.45,cz+side*0.56,0.2,P.graphite,'wall');
      else this.pipe(axis,z0+0.55,z1-0.55,cx+side*0.56,h-0.45,0.2,P.graphite,'wall');
    }
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
        quad(-g, 8.2, z - 0.22, g, 8.6, z + 0.22, P.steel, null);
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

  /** Split ceramic magnet above the north yard. Its opening frames the sky rift. */
  private containmentArch(): void {
    const { scene } = this.h;
    const x = -37, z = this.L.half + 58;
    for (const side of [-1, 1]) {
      // A cast magnet yoke follows a single elliptical arc. Narrow insulating joints
      // divide the outer ceramic jacket into removable sections.
      const band = (name: string, t0: number, t1: number, spread: number, reach: number, back: number, mat: Material) => {
        const mesh = new Mesh(name, scene);
        const sections = Array.from({length: 19}, (_, i) => {
          const t = t0 + (t1-t0) * i/18, angle = -0.72 + t * 2.16;
          return {t: 24 + 33 * Math.sin(angle), u: side * (4.3 + 27 * Math.cos(angle)),
            v: back + t * 3.2, w: spread * (1-0.53*t), h: reach * (1-0.45*t), n: 3.5};
        });
        loftData(sections, 'y', 32).applyToMesh(mesh);
        mesh.position.set(x, 0, z);
        this.h.add(mesh, mat, null);
      };
      band('magnetKeel', -0.08, 1.0, 3.35, 4.0, 0.7, this.P.graphite);
      for (let i = 0; i < 5; i++) band('magnetCeramic', i/5 + 0.004, (i+1)/5 - 0.003, 3.71, 4.05, -0.09, i === 4 ? this.P.enamel : this.P.white);
      this.cbox(x + side * 24, 2.4, z, 6.9, 2.4, 6.4, this.P.concrete);
    }
    this.cbox(x, 4.1, z, 24, 0.45, 2.3, this.P.graphite);
  }

  /** Glazed control room overlooking the north gate, with a continuous curved nose. */
  private operationsGallery(): void {
    const { scene } = this.h;
    const P = this.P;
    const x = 24, z = this.L.half + 6.6;
    const deck = (name: string, rows: number[][], material: Material) => {
      const mesh = new Mesh(name, scene);
      loftData(rows.map(([t, w, h, v]) => ({ t, w, h, v, n: 4.7 })), 'y', 80).applyToMesh(mesh);
      mesh.position.set(x, 0, z);
      this.h.add(mesh, material, null);
    };
    deck('galleryPiers', [[0,13,2.4,0.6],[7.9,13,2.4,0.6],[9.65,16.3,4.0,0.1]], P.concrete);
    deck('galleryCantilever', [[8.8,15,3.4,0.2],[9.55,18.7,4.6,0],[9.9,19.25,4.75,0],[10.16,19.2,4.72,0]], P.white);
    deck('galleryCurtainWall', [[10.14,18.63,4.57,0],[13.05,17.95,4.17,0.15]], P.glazing);
    deck('galleryRoof', [[13.0,19.2,4.7,0.15],[13.16,19.7,4.96,0.15],[13.64,19.1,4.67,0.19],[13.78,18.2,4.35,0.2]], P.white);
    for (let i = -7; i <= 7; i++) {
      const along = i * 2.4;
      const curve = (w: number) => Math.pow(1 - Math.pow(Math.abs(along) / w, 4.7), 1 / 4.7);
      const front = z - 4.57 * curve(18.63);
      const upper = z + 0.15 - 4.17 * curve(17.95);
      const fin = MeshBuilder.CreateBox('galleryMullion', { width: 0.11, height: Math.hypot(upper-front, 2.96), depth: 0.19 }, scene);
      fin.position.set(x + along, 11.62, (front+upper)/2);
      fin.rotation.x = Math.atan2(upper-front, 2.96);
      this.h.add(fin, P.metal, null);
    }
  }

  /** Mid-ground industry outside the facility: stacks, gantry cranes, pipelines, lattice masts. */
  private outside(): void {
    const P = this.P;
    const H = this.L.half;
    // Tall cooling structures are visible above different edges of the yard.
    for (const [x, z, radius, height] of [[-70, 103, 14, 53], [-96, 124, 12, 44], [110, 63, 10, 38], [50, -126, 16, 55]]) {
      const tower = new Mesh('coolingTower', this.h.scene);
      smoothLatheData([
        [radius, -8], [radius, 2], [radius * 0.93, height * 0.27], [radius * 0.72, height * 0.60],
        [radius * 0.62, height * 0.83], [radius * 0.68, height], [radius * 0.70, height + 1.1],
        [radius * 0.62, height + 1.1], [radius * 0.58, height - 6],
      ], 48).applyToMesh(tower);
      tower.position.set(x, 0, z);
      this.h.add(tower, P.concrete, null);
      for (const [dx, dz] of [[0.56, 0.34], [-0.56, -0.34]]) {
        this.pipe('y', height - 4, height + 4, x + dx * radius, z + dz * radius, 0.21, P.metal);
        this.pipe('y', height + 4, height + 4.4, x + dx * radius, z + dz * radius, 0.42, P.redGlow);
      }
    }
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
