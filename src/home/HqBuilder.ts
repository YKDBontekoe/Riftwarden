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
import { PHYS_ENV } from '../world/physicsGroups';
import { HQ_PORTALS, HQ_ROOMS, HQ_SEALED_DOORS, HQ_WINDOW, type Room, type WallSegment, wallSegments } from './layout';

export interface HqMaterials {
  floor: Material;
  wall: Material;
  white: Material;
  graphite: Material;
  metal: Material;
  ceiling: Material;
  glass: Material;
  cyan: Material;
  cyanDim: Material;
  teal: Material;
  amber: Material;
  amberDim: Material;
  lamp: Material;
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
    this.onLine(s.axis, s.c, s.a, s.b, -T - 0.02, T + 0.02, 0.32, 0.36, M.cyanDim, null);
    this.onLine(s.axis, s.c, s.a, s.b, -T - 0.07, T + 0.07, 2.62, 2.7, M.cyan, null);
    this.onLine(s.axis, s.c, s.a, s.b, -T - 0.09, T + 0.09, 2.7, 2.9, M.graphite);
    this.onLine(s.axis, s.c, s.a, s.b, -T - 0.05, T + 0.05, s.y1 - 0.3, s.y1, M.graphite);
    if (len > 3) {
      const n = Math.max(1, Math.round(len / 4));
      for (let i = 1; i < n; i++) {
        const t = s.a + (len * i) / n;
        this.onLine(s.axis, s.c, t - 0.18, t + 0.18, -T - 0.16, T + 0.16, 0.32, s.y1 - 0.3, M.white);
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
    this.box(x0, -0.3, z0, x1, 0, z1, M.floor, 'floor', 0.01);
  }

  /** Ceiling section: slab, recessed coffers with light panels, perimeter cove light. */
  ceiling(r: Room): void {
    const M = this.M;
    const [x0, z0] = r.min;
    const [x1, z1] = r.max;
    const h = r.height;
    this.solid(x0, h, z0, x1, h + 0.4, z1, M.ceiling, 'wall');
    const sx = x1 - x0;
    const sz = z1 - z0;
    const nx = Math.max(1, Math.round(sx / 4));
    const nz = Math.max(1, Math.round(sz / 4));
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const cx = x0 + ((i + 0.5) * sx) / nx;
        const cz = z0 + ((j + 0.5) * sz) / nz;
        if (r.id === 'command' && Math.hypot(cx, cz) < 5) continue; // central skylight ring instead
        // Beams between coffers
        this.box(cx - sx / nx / 2, h - 0.35, cz - 0.12, cx + sx / nx / 2, h, cz + 0.12, M.white, null);
        // Light panel
        const pw = Math.min(1.6, sx / nx - 1.2);
        const pd = Math.min(1.6, sz / nz - 1.2);
        if (pw > 0.4 && pd > 0.4 && (i + j) % 2 === 0) this.box(cx - pw / 2, h - 0.05, cz + 0.4 - pd / 2, cx + pw / 2, h, cz + 0.4 + pd / 2, M.lamp, null);
      }
    // Cove light strip around the perimeter
    const t = 0.08;
    this.box(x0 + 0.3, h - 0.5, z0 + 0.3, x1 - 0.3, h - 0.45, z0 + 0.3 + t, M.cyanDim, null);
    this.box(x0 + 0.3, h - 0.5, z1 - 0.3 - t, x1 - 0.3, h - 0.45, z1 - 0.3, M.cyanDim, null);
  }

  /** Thick framed portal: graphite jambs and header with a cyan inner edge. */
  doorFrame(axis: 'x' | 'z', c: number, a: number, b: number, height: number): void {
    const M = this.M;
    for (const e of [a, b]) {
      const dir = e === a ? 1 : -1;
      this.onLine(axis, c, e - (dir > 0 ? 0.35 : 0), e + (dir > 0 ? 0 : 0.35), -0.45, 0.45, 0, height + 0.35, M.graphite);
      this.onLine(axis, c, e + dir * 0.0 - 0.03, e + 0.03, -0.46, 0.46, 0.4, height - 0.1, M.cyan, null);
    }
    this.onLine(axis, c, a - 0.35, b + 0.35, -0.45, 0.45, height, height + 0.35, M.graphite);
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
    this.box(W.x0, W.y0 + 0.05, z + 0.32, W.x1, W.y0 + 0.1, z + 0.36, M.cyan, null);
    const glass = MeshBuilder.CreatePlane('hqGlass', { width: W.x1 - W.x0, height: W.y1 - W.y0 }, this.scene);
    glass.position.set((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, z);
    glass.rotation.y = Math.PI;
    glass.material = M.glass;
    glass.isPickable = true;
    glass.metadata = { surface: 'glass' };
    this.meshes.push(glass);
  }

  /** Build the full static shell: floors, walls (with window/portals), ceilings, frames. */
  buildShell(): void {
    const W = HQ_WINDOW;
    for (const r of HQ_ROOMS) {
      this.floor(r);
      this.ceiling(r);
    }
    // Ground collider under everything (floor slabs are visual).
    this.collider(-40, -1, -20, 44, 0, 30);
    for (const s of wallSegments()) {
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
    for (const p of HQ_PORTALS) this.doorFrame(p.axis, p.c, p.a, p.b, p.height);
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
