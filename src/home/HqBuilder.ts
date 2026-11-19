import {
  type Material,
  Mesh,
  MeshBuilder,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeBox,
  PhysicsShapeContainer,
  Quaternion,
  type Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { createBeveledBox } from '../visuals/bevel';
import { boxProjectUVs } from '../visuals/uv';
import { loftData } from '../visuals/sculpt';
import { segmentedRing } from '../visuals/rings';
import { PHYS_ENV } from '../world/physicsGroups';
import { SURVEY_DESK, GATEWAY_PORTALS, HQ_PORTALS, HQ_ROOMS, HQ_SEALED_DOORS, HQ_WINDOW, type Room, type WallSegment, wallSegments } from './layout';

export interface HqMaterials {
  floor: Material;
  terrazzo: Material;
  wall: Material;
  white: Material;
  graphite: Material;
  metal: Material;
  ceiling: Material;
  bronze: Material;
  glass: Material;
  cyan: Material;
  cyanDim: Material;
  teal: Material;
  amber: Material;
  amberDim: Material;
  lamp: Material;
  /** Accent emissive per room id (roomStyle); rooms without one use cyanDim. */
  accents?: Record<string, Material>;
}

/**
 * Static headquarters architecture from reusable components (wall run, floor slab,
 * ceiling section, light strip, door frame, sealed door, window). Render pieces are
 * merged per material (few draw calls) and every solid piece adds a box to one static
 * compound Havok body. Surfaces carry `metadata.surface` for picking/occlusion.
 */
export class HqBuilder {
  private parts = new Map<string, { mat: Material; surface: string | null; meshes: Mesh[] }>();
  private shape: PhysicsShapeContainer;
  readonly meshes: Mesh[] = [];
  readonly shadowCasters: Mesh[] = [];

  constructor(
    private scene: Scene,
    private M: HqMaterials,
  ) {
    this.shape = new PhysicsShapeContainer(scene);
  }

  // ------------------------------------------------------------- primitives

  private add(mesh: Mesh, mat: Material, surface: string | null): void {
    const key = `${mat.uniqueId}|${surface ?? '-'}`;
    let g = this.parts.get(key);
    if (!g) {
      g = { mat, surface, meshes: [] };
      this.parts.set(key, g);
    }
    g.meshes.push(mesh);
  }

  /** Axis-aligned bevelled box between two corners. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, surface: string | null = 'wall', bevel?: number): Mesh {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    const m = createBeveledBox('hq', w, h, d, bevel ?? Math.min(0.06, Math.min(w, h, d) * 0.22), this.scene);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(m, mat, surface);
    return m;
  }

  /** Box plus matching collider. */
  solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, surface = 'wall'): Mesh {
    this.collider(x0, y0, z0, x1, y1, z1);
    return this.box(x0, y0, z0, x1, y1, z1, mat, surface);
  }

  collider(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const c = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const e = new Vector3(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    this.shape.addChild(new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), e, this.scene), c, Quaternion.Identity());
  }

  /** Box oriented along a wall line: `along` range, `depth` offset from the line (signed), height range. */
  private onLine(axis: 'x' | 'z', c: number, a: number, b: number, d0: number, d1: number, y0: number, y1: number, mat: Material, surface: string | null = 'wall'): Mesh {
    return axis === 'x' ? this.box(c + d0, y0, a, c + d1, y1, b, mat, surface) : this.box(a, y0, c + d0, b, y1, c + d1, mat, surface);
  }

  // ------------------------------------------------------------- components

  /**
   * Wall run: composite core, graphite skirting and cornice, a cyan light strip and
   * structural ribs every 4 m on both faces. Thickness 0.5 m centred on the line.
   */
  wallRun(s: WallSegment): void {
    const M = this.M;
    const T = 0.25;
    const len = s.b - s.a;
    if (s.axis === 'x') this.collider(s.c - T, s.y0, s.a, s.c + T, s.y1, s.b);
    else this.collider(s.a, s.y0, s.c - T, s.b, s.y1, s.c + T);
    this.onLine(s.axis, s.c, s.a, s.b, -T, T, s.y0, s.y1, M.wall);
    if (s.y0 > 0) {
      // Lintel: graphite underside trim.
      this.onLine(s.axis, s.c, s.a, s.b, -T - 0.05, T + 0.05, s.y0, s.y0 + 0.25, M.graphite);
      return;
    }
    this.onLine(s.axis, s.c, s.a, s.b, -T - 0.06, T + 0.06, 0, 0.32, M.graphite);
    this.onLine(s.axis, s.c, s.a, s.b, -T - 0.02, T + 0.02, 0.32, 0.36, M.metal, null);
    if (s.y1 >= 2.9) {
      this.onLine(s.axis, s.c, s.a, s.b, -T - 0.07, T + 0.07, 2.63, 2.67, M.metal, null);
      this.onLine(s.axis, s.c, s.a, s.b, -T - 0.09, T + 0.09, 2.7, 2.9, M.graphite);
    }
    this.onLine(s.axis, s.c, s.a, s.b, -T - 0.05, T + 0.05, s.y1 - 0.3, s.y1, M.graphite);
    if (len > 3 && s.y1 > 2.9) {
      const n = Math.max(1, Math.round(len / 4));
      const bayWidth = len / n;
      for (let i = 0; i < n; i++) {
        const a = s.a + i * bayWidth;
        const b = a + bayWidth;
        if (i > 0) {
          this.onLine(s.axis, s.c, a - 0.18, a + 0.18, -T - 0.16, T + 0.16, 0.32, s.y1 - 0.3, M.white);
          this.onLine(s.axis, s.c, a - 0.23, a + 0.23, -T - 0.19, T + 0.19, 0.33, 0.66, M.metal);
        }
        for (const side of [-1, 1]) {
          const face = (l: number, r: number, y0: number, y1: number, d0: number, d1: number, m: Material) =>
            this.onLine(s.axis, s.c, l, r, side * (T + d0), side * (T + d1), y0, y1, m);
          face(a + 0.27, b - 0.27, 0.56, 2.49, -0.01, 0.032, M.graphite);
          face(a + 0.34, b - 0.34, 0.65, 2.40, 0.029, 0.085, M.wall);
          face(a + 0.41, b - 0.41, 0.68, 0.84, 0.082, 0.12, M.metal);
          if (i % 3 !== 1) continue;
          const center = (a + b) / 2;
          face(center - 0.55, center + 0.55, 1.67, 2.18, 0.082, 0.132, M.graphite);
          for (let slot = 0; slot < 3; slot++) face(center - 0.47, center + 0.47, 1.76 + slot * 0.124, 1.81 + slot * 0.124, 0.13, 0.16, M.metal);
        }
      }
    }
    // End caps make cut ends read as deliberate (jambs).
    for (const e of [s.a, s.b]) this.onLine(s.axis, s.c, e - 0.12, e + 0.12, -T - 0.12, T + 0.12, 0, s.y1, M.graphite);
  }

  /** Floor slab for a room, with seams supplied by the deck material. */
  floor(r: Room): void {
    const M = this.M;
    const [x0, z0] = r.min;
    const [x1, z1] = r.max;
    this.box(x0, -0.3, z0, x1, 0, z1, r.id === 'command' ? M.terrazzo : M.floor, 'floor', 0.01);
    if (r.id === 'command') {
      for (const x of [-6.3, 2.45, 2.53, 7.6]) this.box(x, 0.001, z0, x + 0.018, 0.005, z1, M.bronze, null, 0);
      for (const z of [-5.8, 3.2, 9.1]) this.box(x0, 0.001, z, x1, 0.004, z + 0.012, M.graphite, null, 0);
    }
  }

  /** Ceiling section: slab, recessed coffers with light panels, perimeter cove light. */
  ceiling(r: Room): void {
    const M = this.M;
    const [x0, z0] = r.min;
    const [x1, z1] = r.max;
    const h = r.height;
    this.solid(x0, h, z0, x1, h + 0.4, z1, M.ceiling, 'wall');
    if (r.id === 'command') {
      this.atriumCeiling(h);
      return;
    }
    const sx = x1 - x0;
    const sz = z1 - z0;
    const nx = Math.max(1, Math.round(sx / 4));
    const nz = Math.max(1, Math.round(sz / 4));
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const cx = x0 + ((i + 0.5) * sx) / nx;
        const cz = z0 + ((j + 0.5) * sz) / nz;
        const hw = sx / nx / 2 - 0.12;
        const hd = sz / nz / 2 - 0.12;
        this.box(cx - hw, h - 0.2, cz - hd, cx + hw, h, cz + hd, M.graphite, null);
        this.box(cx - hw + 0.18, h - 0.28, cz - hd + 0.18, cx + hw - 0.18, h - 0.2, cz + hd - 0.18, M.ceiling, null);
        for (const side of [-1, 1]) {
          const x = cx + side * (hw - 0.29);
          this.box(x - 0.035, h - 0.3, cz - hd * 0.61, x + 0.035, h - 0.275, cz + hd * 0.61, (i + j) % 2 === 0 ? M.lamp : M.cyanDim, null);
        }
      }
    // Cove light strip around the perimeter
    const t = 0.08;
    const cove = M.accents?.[r.id] ?? M.cyanDim;
    this.box(x0 + 0.3, h - 0.5, z0 + 0.3, x1 - 0.3, h - 0.45, z0 + 0.3 + t, cove, null);
    this.box(x0 + 0.3, h - 0.5, z1 - 0.3 - t, x1 - 0.3, h - 0.45, z1 - 0.3, cove, null);
    this.serviceRun(r);
  }

  /**
   * Room identity: inset accent line around the floor perimeter and corner columns with
   * vertical accent slits (both in the room's accent colour, see roomStyle).
   */
  roomAccents(r: Room): void {
    const M = this.M;
    const acc = M.accents?.[r.id];
    if (!acc) return;
    const [x0, z0] = r.min;
    const [x1, z1] = r.max;
    const h = r.height;
    const i = 0.62;
    const w = 0.035;
    const y = 0.006;
    this.box(x0 + i, 0, z0 + i, x1 - i, y, z0 + i + w, acc, null, 0);
    this.box(x0 + i, 0, z1 - i - w, x1 - i, y, z1 - i, acc, null, 0);
    this.box(x0 + i, 0, z0 + i, x0 + i + w, y, z1 - i, acc, null, 0);
    this.box(x1 - i - w, 0, z0 + i, x1 - i, y, z1 - i, acc, null, 0);
    if (r.id === 'command') return; // the atrium keeps its open corners (window, displays)
    const c = 0.25;
    const d = 0.36;
    for (const [cx, sx] of [[x0, 1], [x1, -1]] as const)
      for (const [cz, sz] of [[z0, 1], [z1, -1]] as const) {
        const ax = cx + sx * c;
        const bx = cx + sx * (c + d);
        const az = cz + sz * c;
        const bz = cz + sz * (c + d);
        this.solid(Math.min(ax, bx), 0, Math.min(az, bz), Math.max(ax, bx), h - 0.3, Math.max(az, bz), M.graphite);
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        // Slits on the two room-facing faces.
        this.box(bx - sx * 0.005, 0.5, mz - 0.025, bx + sx * 0.012, h - 0.9, mz + 0.025, acc, null, 0);
        this.box(mx - 0.025, 0.5, bz - sz * 0.005, mx + 0.025, h - 0.9, bz + sz * 0.012, acc, null, 0);
        this.box(Math.min(ax, bx) - 0.02, 0.32, Math.min(az, bz) - 0.02, Math.max(ax, bx) + 0.02, 0.4, Math.max(az, bz) + 0.02, M.metal, null);
      }
  }

  /** Cable tray with hangers along the room's long axis, close to the north/west wall. */
  private serviceRun(r: Room): void {
    const M = this.M;
    const [x0, z0] = r.min;
    const [x1, z1] = r.max;
    const h = r.height;
    const alongX = x1 - x0 >= z1 - z0;
    const y = h - 0.95;
    const a = (alongX ? x0 : z0) + 0.9;
    const b = (alongX ? x1 : z1) - 0.9;
    const off = (alongX ? z0 : x0) + 0.85;
    const run = (l: number, rr: number, o0: number, o1: number, y0: number, y1: number, m: Material) =>
      alongX ? this.box(l, y0, o0, rr, y1, o1, m, null) : this.box(o0, y0, l, o1, y1, rr, m, null);
    run(a, b, off, off + 0.42, y, y + 0.05, M.metal);
    run(a, b, off, off + 0.03, y, y + 0.14, M.metal);
    run(a, b, off + 0.39, off + 0.42, y, y + 0.14, M.metal);
    run(a, b, off + 0.06, off + 0.18, y + 0.05, y + 0.13, M.graphite);
    run(a, b, off + 0.21, off + 0.3, y + 0.05, y + 0.11, M.graphite);
    run(a, b, off + 0.32, off + 0.36, y + 0.05, y + 0.09, M.accents?.[r.id] ?? M.cyanDim);
    for (let p = a + 0.4; p < b; p += 2.4) run(p - 0.02, p + 0.02, off + 0.19, off + 0.23, y + 0.05, h - 0.25, M.graphite);
  }

  private atriumCeiling(h: number): void {
    const M = this.M;
    // Continuous acoustic blades follow the approach. Their lower edges lift above the map table.
    for (let i = 0; i < 15; i++) {
      const x = -10.3 + i * 1.46;
      const sections = [-10.85, -9, -6, -3, 0, 3, 6, 9, 10.85].map(z => {
        const trough = 0.22 + 0.58 * (1 + Math.sin(z * 0.23 + x * 0.24)) / 2;
        return { t: z, w: 0.095, h: trough / 2, v: h - trough / 2 - 0.04, n: 4 };
      });
      const blade = new Mesh('acousticBlade', this.scene);
      loftData(sections, 'z', 16).applyToMesh(blade);
      blade.position.x = x;
      this.add(blade, M.bronze, null);
    }
    const { x: centerX, z: centerZ } = SURVEY_DESK;
    const y = h - 1.32;
    for (const [r, width, dy, mat] of [[2.03, 0.19, 0, M.graphite], [2.01, 0.09, -0.025, M.lamp]] as const) {
      const ring = segmentedRing(this.scene, 'surveyPendant', r, width, 4, 0.996);
      ring.position.set(centerX, y + dy, centerZ);
      ring.scaling.z = 1.32;
      ring.rotation.x = Math.PI;
      this.add(ring, mat, null);
    }
    for (const z of [-2.58, 2.58]) this.box(centerX - 0.022, y, centerZ + z - 0.022, centerX + 0.022, h, centerZ + z + 0.022, M.graphite, null);
  }

  /** Thick framed portal: graphite jambs and header with a cyan inner edge. */
  doorFrame(axis: 'x' | 'z', c: number, a: number, b: number, height: number): void {
    const M = this.M;
    for (const [e, out] of [[a, -1], [b, 1]]) {
      this.onLine(axis, c, e, e + out * 0.35, -0.45, 0.45, 0, height + 0.35, M.graphite);
      this.onLine(axis, c, e - 0.03, e + 0.03, -0.46, 0.46, 0.4, height - 0.1, M.cyan, null);
      for (const side of [-1, 1]) {
        this.onLine(axis, c, e + out * 0.06, e + out * 0.35, side * 0.44, side * 0.53, 0.17, 0.62, M.metal);
        this.onLine(axis, c, e + out * 0.1, e + out * 0.29, side * 0.44, side * 0.54, height - 0.71, height + 0.15, M.white);
      }
    }
    this.onLine(axis, c, a - 0.35, b + 0.35, -0.45, 0.45, height, height + 0.35, M.graphite);
    this.onLine(axis, c, a - 0.24, b + 0.24, -0.51, 0.51, height + 0.18, height + 0.32, M.metal);
    this.onLine(axis, c, a, b, -0.46, 0.46, height - 0.04, height, M.cyan, null);
    // Threshold plate
    this.onLine(axis, c, a, b, -0.5, 0.5, 0, 0.02, M.metal, 'floor');
  }

  /** Sealed blast door reserved for a future facility (wall behind remains solid). */
  sealedDoor(d: (typeof HQ_SEALED_DOORS)[number]): void {
    const M = this.M;
    const f = d.facing * 0.3;
    const lo = Math.min(f, f + d.facing * 0.12);
    const hi = Math.max(f, f + d.facing * 0.12);
    const flo = Math.min(f, f + d.facing * 0.25);
    const fhi = Math.max(f, f + d.facing * 0.25);
    this.onLine(d.axis, d.c, d.a - 0.4, d.a, flo, fhi, 0, 3.5, M.graphite);
    this.onLine(d.axis, d.c, d.b, d.b + 0.4, flo, fhi, 0, 3.5, M.graphite);
    this.onLine(d.axis, d.c, d.a - 0.4, d.b + 0.4, flo, fhi, 3.1, 3.5, M.graphite);
    const mid = (d.a + d.b) / 2;
    this.onLine(d.axis, d.c, d.a, mid - 0.02, lo, hi, 0, 3.1, M.white);
    this.onLine(d.axis, d.c, mid + 0.02, d.b, lo, hi, 0, 3.1, M.white);
    // Hazard bands and a dim amber "sealed" indicator
    for (let i = 0; i < 4; i++) {
      const y = 0.3 + i * 0.22;
      this.onLine(d.axis, d.c, d.a + 0.1, d.b - 0.1, Math.min(hi, hi + d.facing * 0.01), Math.max(hi, hi + d.facing * 0.015), y, y + 0.1, i % 2 ? M.graphite : M.amberDim, null);
    }
    this.onLine(d.axis, d.c, mid - 0.5, mid + 0.5, Math.min(fhi, fhi + d.facing * 0.01), Math.max(fhi, fhi + d.facing * 0.02), 3.2, 3.32, M.amber, null);
  }

  /** Observation window: sill, header, mullions and a glass pane (collider fills the hole). */
  window(): void {
    const M = this.M;
    const W = HQ_WINDOW;
    const z = W.z;
    this.collider(W.x0, W.y0, z - 0.25, W.x1, W.y1, z + 0.25);
    this.box(W.x0 - 0.2, W.y0 - 0.15, z - 0.45, W.x1 + 0.2, W.y0, z + 0.45, M.graphite);
    this.box(W.x0 - 0.2, W.y1, z - 0.4, W.x1 + 0.2, W.y1 + 0.2, z + 0.4, M.graphite);
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const x = W.x0 + ((W.x1 - W.x0) * i) / n;
      this.box(x - 0.12, W.y0, z - 0.3, x + 0.12, W.y1, z + 0.3, i === 0 || i === n ? M.graphite : M.metal);
    }
    this.box(W.x0, W.y0 + 0.025, z + 0.32, W.x1, W.y0 + 0.06, z + 0.36, M.cyanDim, null);
    const glass = MeshBuilder.CreatePlane('hqGlass', { width: W.x1 - W.x0, height: W.y1 - W.y0 }, this.scene);
    glass.position.set((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, z);
    glass.rotation.y = Math.PI;
    glass.material = M.glass;
    glass.isPickable = true;
    glass.metadata = { surface: 'glass' };
    this.meshes.push(glass);
  }

  /** Recessed launch-bay surround and overhead utility channels on the command deck. */
  private commandDeckDetails(): void {
    const M = this.M;
    this.box(-5.63, 6.33, 10.28, 5.63, 6.77, 10.79, M.graphite, null, 0.12);
    this.box(-5.83, 6.77, 10.10, 5.83, 6.89, 10.78, M.metal, null);
    this.box(-3.85, 6.31, 10.20, 3.85, 6.355, 10.38, M.lamp, null);
    for (const sign of [-1, 1]) {
      // Bronze acoustic fins flank the launch entry behind the service displays.
      for (let i = 0; i < 29; i++) {
        const finX = sign * (5.5 + i * 0.178);
        this.box(finX - 0.048, 0.82, 10.56, finX + 0.048, 6.15, 10.72, M.bronze, null, 0.018);
      }
      const x = sign * 4.97;
      this.box(x - 0.36, 0.16, 10.19, x + 0.36, 6.74, 10.76, M.graphite, null, 0.11);
      this.box(x - 0.22, 0.71, 10.14, x + 0.22, 5.81, 10.23, M.metal, null, 0.035);
      this.box(x - 0.028, 1.24, 10.12, x + 0.028, 5.6, 10.16, M.lamp, null);
      this.box(x - 0.5, 0.03, 10.13, x + 0.5, 0.54, 10.79, M.graphite, null, 0.09);
      for (let y = 0.17; y < 0.52; y += 0.11) {
        this.box(x - 0.31, y, 10.10, x + 0.31, y + 0.036, 10.15, M.amberDim, null);
      }

    }
  }

  /** Build the full static shell: floors, walls (with window/portals), ceilings, frames. */
  buildShell(): void {
    const W = HQ_WINDOW;
    for (const r of HQ_ROOMS) {
      this.floor(r);
      this.ceiling(r);
      this.roomAccents(r);
    }
    // Ground collider under everything (floor slabs are visual).
    this.collider(-40, -1, -20, 44, 0, 30);
    for (const s of wallSegments(HQ_ROOMS, [...HQ_PORTALS, ...GATEWAY_PORTALS])) {
      // Window cut in the command deck's south wall.
      if (s.axis === 'z' && s.c === W.z && s.y0 === 0 && s.a < W.x1 && s.b > W.x0) {
        if (s.a < W.x0) this.wallRun({ ...s, b: W.x0 });
        if (s.b > W.x1) this.wallRun({ ...s, a: W.x1 });
        this.wallRun({ ...s, a: Math.max(s.a, W.x0), b: Math.min(s.b, W.x1), y1: W.y0 });
        this.wallRun({ ...s, a: Math.max(s.a, W.x0), b: Math.min(s.b, W.x1), y0: W.y1 });
        continue;
      }
      this.wallRun(s);
    }
    this.window();
    for (const d of HQ_SEALED_DOORS) this.sealedDoor(d);
    for (const p of [...HQ_PORTALS, ...GATEWAY_PORTALS]) this.doorFrame(p.axis, p.c, p.a, p.b, p.height);
    this.commandDeckDetails();
  }

  /** Merge render parts, box-project UVs, and create the static physics body. */
  finish(): void {
    for (const { mat, ...g } of this.parts.values()) {
      const merged = Mesh.MergeMeshes(g.meshes, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `hq:${mat.name}`;
      merged.material = mat;
      boxProjectUVs(merged, mat === this.M.floor ? 6 : mat === this.M.wall ? 4 : 2.5);
      merged.isPickable = g.surface !== null;
      merged.metadata = g.surface ? { surface: g.surface } : null;
      merged.receiveShadows = g.surface !== null;
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      this.meshes.push(merged);
      if (g.surface) this.shadowCasters.push(merged);
    }
    this.parts.clear();
    const node = new TransformNode('hqPhysics', this.scene);
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    this.shape.filterMembershipMask = PHYS_ENV;
    body.shape = this.shape;
  }
}
