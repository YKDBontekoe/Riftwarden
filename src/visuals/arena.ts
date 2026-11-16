import {
  Mesh,
  MeshBuilder,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeBox,
  PhysicsShapeContainer,
  Quaternion,
  type Scene,
  type Material,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import type { ArenaLayout, Box, Ramp, Vec2 } from '../world/layout';
import { PHYS_ENV } from '../world/physicsGroups';
import type { Palette } from './materials';
import { boxProjectUVs } from './uv';

/**
 * Builds the research facility from layout data:
 * - render meshes, merged per material/surface tag to keep draw calls low;
 * - a single static Havok body with a compound box shape for collision.
 * Pickable meshes carry `metadata.surface` so picking can classify hits.
 */
export class ArenaBuilder {
  private parts = new Map<string, { mat: Material; surface: string | null; meshes: Mesh[] }>();
  private physicsShape: PhysicsShapeContainer;
  readonly animated: { node: TransformNode | Mesh; spin: Vector3 }[] = [];
  readonly shadowCasters: Mesh[] = [];
  /** Every static render mesh (for environment capture). */
  readonly meshes: Mesh[] = [];

  constructor(private scene: Scene, private pal: Palette, private layout: ArenaLayout) {
    this.physicsShape = new PhysicsShapeContainer(scene);
  }

  private add(mesh: Mesh, mat: Material, surface: string | null): void {
    const key = `${mat.name}|${surface ?? '-'}`;
    let g = this.parts.get(key);
    if (!g) {
      g = { mat, surface, meshes: [] };
      this.parts.set(key, g);
    }
    g.meshes.push(mesh);
  }

  private box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, surface: string | null): Mesh {
    const m = MeshBuilder.CreateBox('b', { width: x1 - x0, height: y1 - y0, depth: z1 - z0 }, this.scene);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(m, mat, surface);
    return m;
  }

  private collider(center: Vector3, extents: Vector3, rot = Quaternion.Identity()): void {
    this.physicsShape.addChild(new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), extents, this.scene), center, rot);
  }

  build(): void {
    const L = this.layout;
    const P = this.pal;

    // Floor
    const ground = MeshBuilder.CreateGround('ground', { width: 120, height: 120 }, this.scene);
    ground.material = P.floor;
    ground.receiveShadows = true;
    ground.metadata = { surface: 'floor' };
    ground.freezeWorldMatrix();
    this.meshes.push(ground);
    this.collider(new Vector3(0, -0.5, 0), new Vector3(120, 1, 120));

    for (const b of L.boxes) {
      if (b.kind === 'reactor') continue; // reactor has its own model; collider below
      this.buildBox(b);
      const ext = new Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      const c = new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      this.collider(c, ext);
    }
    // Reactor collider (slightly inside the visual)
    this.collider(new Vector3(0, L.reactor.height / 2, 0), new Vector3(5.2, L.reactor.height, 5.2));
    // Invisible ceiling-height caps above gate tunnels so the player cannot leave via the tunnels
    for (const g of [[0, 50.5, 9, 13], [50.5, 0, 13, 9], [-50.5, 0, 13, 9]]) {
      this.collider(new Vector3(g[0], 4, g[1]), new Vector3(g[2], 8, g[3]));
    }

    for (const r of L.ramps) this.buildRamp(r);
    for (const route of Object.values(L.routes)) this.buildLane(route.points);
    this.buildConduits();
    this.buildGates();
    this.buildSkyline();

    this.merge();

    const node = new TransformNode('arenaPhysics', this.scene);
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    this.physicsShape.filterMembershipMask = PHYS_ENV;
    body.shape = this.physicsShape;
  }

  private buildBox(b: Box): void {
    const P = this.pal;
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    switch (b.kind) {
      case 'wall': {
        this.box(x0, y0, z0, x1, y1, z1, P.panel, 'wall');
        // graphite skirting + cap, cyan light strip on the inner face
        const inset = 0.08;
        this.box(x0 - inset, 0, z0 - inset, x1 + inset, 0.6, z1 + inset, P.graphite, 'wall');
        this.box(x0 - inset, y1 - 0.5, z0 - inset, x1 + inset, y1, z1 + inset, P.graphite, 'wall');
        this.box(x0 - 0.04, 5.2, z0 - 0.04, x1 + 0.04, 5.35, z1 + 0.04, P.cyanDim, null);
        // vertical pilasters every 8 m along the long axis
        const alongX = x1 - x0 > z1 - z0;
        const len = alongX ? x1 - x0 : z1 - z0;
        for (let s = 4; s < len - 1; s += 8) {
          if (alongX) this.box(x0 + s - 0.5, 0, z0 - 0.3, x0 + s + 0.5, y1, z1 + 0.3, P.graphite, 'wall');
          else this.box(x0 - 0.3, 0, z0 + s - 0.5, x1 + 0.3, y1, z0 + s + 0.5, P.graphite, 'wall');
        }
        break;
      }
      case 'gate':
        this.box(x0, y0, z0, x1, y1, z1, P.graphite, 'wall');
        this.box(x0 - 0.04, 2.0, z0 - 0.04, x1 + 0.04, 2.15, z1 + 0.04, P.orangeDim, null);
        break;
      case 'platform': {
        this.box(x0, y0, z0, x1, y1 - 0.12, z1, P.graphite, 'wall');
        this.box(x0, y1 - 0.12, z0, x1, y1, z1, P.white, 'platform');
        // edge light strip + low railing posts
        this.box(x0 - 0.03, y1 - 0.4, z0 - 0.03, x1 + 0.03, y1 - 0.3, z1 + 0.03, P.cyanGlow, null);
        // Support columns
        for (const [cx, cz] of [[x0 + 0.6, z0 + 0.6], [x1 - 0.6, z0 + 0.6], [x0 + 0.6, z1 - 0.6], [x1 - 0.6, z1 - 0.6]]) {
          this.box(cx - 0.45, 0, cz - 0.45, cx + 0.45, y1 - 0.12, cz + 0.45, P.metal, 'wall');
        }
        break;
      }
      case 'block': {
        this.box(x0, y0, z0, x1, y1 - 0.4, z1, P.white, 'wall');
        this.box(x0 - 0.05, y1 - 0.4, z0 - 0.05, x1 + 0.05, y1, z1 + 0.05, P.graphite, 'wall');
        this.box(x0 - 0.04, 0.5, z0 - 0.04, x1 + 0.04, 0.62, z1 + 0.04, P.orangeDim, null);
        break;
      }
      case 'machine': {
        this.box(x0, y0, z0, x1, y1, z1, P.graphite, 'wall');
        // capacitor cylinders on top
        const alongX = x1 - x0 > z1 - z0;
        const n = 3;
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n;
          const cx = alongX ? x0 + (x1 - x0) * f : (x0 + x1) / 2;
          const cz = alongX ? (z0 + z1) / 2 : z0 + (z1 - z0) * f;
          const c = MeshBuilder.CreateCylinder('cap', { height: 1.6, diameter: 1.5, tessellation: 20 }, this.scene);
          c.position.set(cx, y1 + 0.8, cz);
          this.add(c, P.metal, 'wall');
          const ring = MeshBuilder.CreateCylinder('capRing', { height: 0.12, diameter: 1.56, tessellation: 20 }, this.scene);
          ring.position.set(cx, y1 + 1.2, cz);
          this.add(ring, i % 2 ? P.cyanGlow : P.cyanDim, null);
          this.collider(new Vector3(cx, y1 + 0.8, cz), new Vector3(1.5, 1.6, 1.5));
        }
        // indicator lights
        const inner = alongX ? (z0 + z1) / 2 : x0 < 0 ? x1 + 0.02 : x0 - 0.02;
        for (let i = 0; i < 6; i++) {
          const f = (i + 0.5) / 6;
          if (alongX) this.box(x0 + (x1 - x0) * f - 0.2, 1.6, z1, x0 + (x1 - x0) * f + 0.2, 1.75, z1 + 0.04, i % 3 === 0 ? P.orangeGlow : P.cyanGlow, null);
          else this.box(inner - 0.02, 1.6, z0 + (z1 - z0) * f - 0.2, inner + 0.02, 1.75, z0 + (z1 - z0) * f + 0.2, i % 3 === 0 ? P.orangeGlow : P.cyanGlow, null);
        }
        break;
      }
      default:
        this.box(x0, y0, z0, x1, y1, z1, P.panel, 'wall');
    }
  }

  private buildRamp(r: Ramp): void {
    const P = this.pal;
    const alongZ = r.axis === 'z';
    const len = alongZ ? r.z1 - r.z0 : r.x1 - r.x0;
    const width = alongZ ? r.x1 - r.x0 : r.z1 - r.z0;
    const rise = r.hMax - r.hMin;
    const angle = Math.atan2(rise, len);
    const slopeLen = Math.hypot(len, rise);
    const thick = 0.5;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const cy = (r.hMin + r.hMax) / 2;
    // Rotation such that the box's long axis follows the slope.
    const rot = alongZ ? Quaternion.RotationAxis(Vector3.Right(), -angle) : Quaternion.RotationAxis(Vector3.Forward(), angle);
    const offset = new Vector3(0, -thick / 2, 0).rotateByQuaternionToRef(rot, new Vector3());
    const center = new Vector3(cx, cy, cz).addInPlace(offset);
    const dims = alongZ ? { width, height: thick, depth: slopeLen } : { width: slopeLen, height: thick, depth: width };
    const m = MeshBuilder.CreateBox('ramp', dims, this.scene);
    m.rotationQuaternion = rot;
    m.position.copyFrom(center);
    this.add(m, P.graphite, 'ramp');
    // stripes
    for (let i = 1; i < 6; i++) {
      const s = MeshBuilder.CreateBox('rampStripe', alongZ ? { width: width * 0.9, height: 0.02, depth: 0.18 } : { width: 0.18, height: 0.02, depth: width * 0.9 }, this.scene);
      s.rotationQuaternion = rot;
      const local = alongZ ? new Vector3(0, 0.01, -slopeLen / 2 + (i / 6) * slopeLen) : new Vector3(-slopeLen / 2 + (i / 6) * slopeLen, 0.01, 0);
      s.position.copyFrom(local.rotateByQuaternionToRef(rot, new Vector3()).addInPlace(new Vector3(cx, cy, cz)));
      this.add(s, P.white, 'ramp');
    }
    this.physicsShape.addChild(new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(dims.width, dims.height, dims.depth), this.scene), center, rot);
  }

  /** Hostile lanes: orange edge strips plus chevrons pointing toward the reactor. */
  private buildLane(pts: Vec2[]): void {
    const P = this.pal;
    const hw = this.layout.laneHalfWidth;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      const nx = dz / len;
      const nz = -dx / len;
      for (const side of [-1, 1]) {
        const s = MeshBuilder.CreateBox('lane', { width: 0.14, height: 0.02, depth: len + 0.3 }, this.scene);
        s.position.set((a.x + b.x) / 2 + nx * hw * side, 0.012, (a.z + b.z) / 2 + nz * hw * side);
        s.rotation.y = yaw;
        this.add(s, P.orangeDim, null);
      }
      for (let d = 2.5; d < len - 1; d += 4) {
        for (const side of [-1, 1]) {
          const c = MeshBuilder.CreateBox('chev', { width: 0.12, height: 0.02, depth: 0.9 }, this.scene);
          const px = a.x + (dx / len) * d;
          const pz = a.z + (dz / len) * d;
          c.position.set(px + nx * 0.32 * side, 0.014, pz + nz * 0.32 * side);
          c.rotation.y = yaw + side * 0.75;
          this.add(c, P.orangeGlow, null);
        }
      }
    }
  }

  /** Friendly cyan conduits feeding the reactor from the southern platforms. */
  private buildConduits(): void {
    const P = this.pal;
    const lines: [number, number, number, number][] = [
      [0, -4.5, 0, -38],
      [-4, -3, -20, -22],
      [4, -3, 20, -22],
    ];
    for (const [x0, z0, x1, z1] of lines) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      for (const off of [-0.35, 0.35]) {
        const s = MeshBuilder.CreateBox('conduit', { width: 0.1, height: 0.02, depth: len }, this.scene);
        s.rotation.y = yaw;
        const nx = Math.cos(yaw) * off;
        const nz = -Math.sin(yaw) * off;
        s.position.set((x0 + x1) / 2 + nx, 0.012, (z0 + z1) / 2 + nz);
        this.add(s, P.cyanDim, null);
      }
    }
    // Reactor plaza ring
    const ring = MeshBuilder.CreateTorus('plaza', { diameter: 15, thickness: 0.12, tessellation: 64 }, this.scene);
    ring.position.y = 0.01;
    ring.scaling.y = 0.1;
    this.add(ring, P.cyanDim, null);
  }

  private buildGates(): void {
    const P = this.pal;
    const H = this.layout.half;
    const frames: { pos: Vector3; yaw: number }[] = [
      { pos: new Vector3(0, 0, H), yaw: 0 },
      { pos: new Vector3(H, 0, 0), yaw: Math.PI / 2 },
      { pos: new Vector3(-H, 0, 0), yaw: -Math.PI / 2 },
    ];
    for (const f of frames) {
      const root = new TransformNode('gate', this.scene);
      root.position.copyFrom(f.pos);
      root.rotation.y = f.yaw;
      const mk = (w: number, h: number, d: number, x: number, y: number, z: number, mat: Material) => {
        const m = MeshBuilder.CreateBox('gatePart', { width: w, height: h, depth: d }, this.scene);
        root.computeWorldMatrix(true);
        m.rotation.y = f.yaw;
        m.position = Vector3.TransformCoordinates(new Vector3(x, y, z), root.getWorldMatrix());
        this.add(m, mat, mat === P.orangeGlow || mat === P.redGlow ? null : 'wall');
        return m;
      };
      // massive frame
      mk(1.4, 9.4, 2.6, -5.2, 4.7, 0.2, P.graphite);
      mk(1.4, 9.4, 2.6, 5.2, 4.7, 0.2, P.graphite);
      mk(11.8, 1.6, 2.6, 0, 8.6, 0.2, P.graphite);
      mk(9.0, 0.18, 0.1, 0, 7.6, -1.12, P.orangeGlow);
      mk(0.18, 6.8, 0.1, -4.45, 3.6, -1.12, P.orangeGlow);
      mk(0.18, 6.8, 0.1, 4.45, 3.6, -1.12, P.orangeGlow);
      // hazard chevrons on the floor at the threshold
      for (let i = -3; i <= 3; i++) mk(0.6, 0.02, 0.6, i * 1.2, 0.015, -1.6, i % 2 ? P.orangeDim : P.graphite);
      // Rift portal at the back of the tunnel
      root.computeWorldMatrix(true);
      const portalPos = Vector3.TransformCoordinates(new Vector3(0, 3.6, 11.2), root.getWorldMatrix());
      const disc = MeshBuilder.CreateDisc('rift', { radius: 3.4, tessellation: 48 }, this.scene);
      disc.material = P.rift;
      disc.position.copyFrom(portalPos);
      disc.rotation.y = f.yaw;
      disc.isPickable = false;
      const ringA = MeshBuilder.CreateTorus('riftRing', { diameter: 7.4, thickness: 0.22, tessellation: 48 }, this.scene);
      ringA.material = P.orangeGlow;
      ringA.position.copyFrom(portalPos);
      ringA.rotation.set(Math.PI / 2, f.yaw, 0);
      ringA.isPickable = false;
      const ringB = MeshBuilder.CreateTorus('riftRing2', { diameter: 5.6, thickness: 0.1, tessellation: 40 }, this.scene);
      ringB.material = P.redGlow;
      ringB.parent = disc;
      ringB.rotation.x = Math.PI / 2;
      ringB.position.z = -0.1;
      ringB.isPickable = false;
      this.animated.push({ node: disc, spin: new Vector3(0, 0, 0.9) });
    }
  }

  /** Overhead truss frame and distant light pylons: frames the space without enclosing it. */
  private buildSkyline(): void {
    const P = this.pal;
    const H = this.layout.half;
    for (const x of [-22, 0, 22]) {
      this.box(x - 0.4, 12, -H - 2, x + 0.4, 12.8, H + 2, P.graphite, null);
      this.box(x - 0.05, 11.9, -H - 2, x + 0.05, 12.0, H + 2, P.cyanDim, null);
    }
    for (const [x, z] of [[-H - 1, -H - 1], [H + 1, -H - 1], [-H - 1, H + 1], [H + 1, H + 1]]) {
      this.box(x - 1.2, 0, z - 1.2, x + 1.2, 13, z + 1.2, P.graphite, null);
      this.box(x - 1.25, 12.2, z - 1.25, x + 1.25, 12.5, z + 1.25, P.cyanGlow, null);
    }
  }

  private merge(): void {
    for (const [key, g] of this.parts) {
      const merged = Mesh.MergeMeshes(g.meshes, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `arena:${key}`;
      merged.material = g.mat;
      // World-scale texturing: panels tile every 4 m, worn metal every 2 m.
      if (g.mat === this.pal.panel) boxProjectUVs(merged, 4);
      else if (g.mat === this.pal.white || g.mat === this.pal.graphite || g.mat === this.pal.metal) boxProjectUVs(merged, 2.5);
      this.meshes.push(merged);
      merged.isPickable = g.surface !== null;
      merged.metadata = g.surface ? { surface: g.surface } : null;
      merged.receiveShadows = g.surface === 'platform' || g.surface === 'ramp';
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      if (g.surface === 'wall' || g.surface === 'platform') this.shadowCasters.push(merged);
    }
  }
}
