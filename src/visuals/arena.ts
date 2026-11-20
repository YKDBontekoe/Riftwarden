import {
  Color3,
  Mesh,
  type PBRMaterial,
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
import type { ArenaLayout, Box, GateId, Ramp } from '../world/layout';
import { RiftAnchors } from './riftAnchors';
import { PHYS_ENV } from '../world/physicsGroups';
import { type Palette, unlit } from './materials';
import { boxProjectUVs } from './uv';
import { createBeveledBox } from './bevel';
import { createPathLight } from './pathLighting';
import { segmentedRing } from './rings';
import { ArenaDecals } from './arenaDecals';
import { ArenaDressing } from './arenaDressing';
import { RubbleBuilder } from './rubble';
import { ArenaFloor } from './arenaFloor';
import { planRubble } from '../world/rubblePlan';
import { smoothLatheData } from './sculpt';

interface GateVisual {
  lane: ReturnType<typeof createPathLight>;
  rotor: Mesh;
  counterRotor: Mesh;
  lights: PBRMaterial;
  charge: number;
  flash: number;
}


/**
 * Builds the research facility from layout data:
 * - render meshes, merged per material/surface tag to keep draw calls low;
 * - a single static Havok body with a compound box shape for collision.
 * Pickable meshes carry `metadata.surface` so picking can classify hits.
 */
export class ArenaBuilder {
  private parts = new Map<string, { mat: Material; surface: string | null; meshes: Mesh[] }>();
  private physicsShape: PhysicsShapeContainer;
  private gates = new Map<GateId, GateVisual>();
  private armed = new Set<GateId>();
  /** M6: gates sealed until an arena evolution opens them (lane shown as a dim reserved corridor). */
  private sealed = new Set<GateId>();
  private conduits: ReturnType<typeof createPathLight>[] = [];
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
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    // Chamfered edges catch highlights; thin trims get proportionally small bevels.
    const bevel = Math.min(0.09, Math.min(w, h, d) * 0.22);
    const m = createBeveledBox('b', w, h, d, bevel, this.scene);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(m, mat, surface);
    return m;
  }

  private collider(center: Vector3, extents: Vector3, rot = Quaternion.Identity()): void {
    this.physicsShape.addChild(new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), extents, this.scene), center, rot);
  }

  /** Forward rift anchors (procedural arenas only). */
  rifts: RiftAnchors | null = null;
  private riftT = 0;

  build(): void {
    if (this.layout.rifts?.length) this.rifts = new RiftAnchors(this.scene, this.layout.rifts);
    const L = this.layout;
    const P = this.pal;

    // Floor
    const span = Math.max(120, (L.half + 16) * 2);
    const ground = MeshBuilder.CreateGround('ground', { width: span, height: span }, this.scene);
    ground.material = P.floor;
    ground.receiveShadows = true;
    ground.metadata = { surface: 'floor' };
    ground.freezeWorldMatrix();
    this.meshes.push(ground);
    this.collider(new Vector3(0, -0.5, 0), new Vector3(span, 1, span));

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
    const cap = L.half + 6.5;
    for (const g of [[0, cap, 9, 13], [cap, 0, 13, 9], [-cap, 0, 13, 9], [0, -cap, 9, 13]]) {
      this.collider(new Vector3(g[0], 4, g[1]), new Vector3(g[2], 8, g[3]));
    }

    for (const r of L.ramps) this.buildRamp(r);
    this.buildConduits();
    const decals = new ArenaDecals(this.scene);
    this.buildGates(decals);
    decals.floor(8, 0, -12.4, 8, 5.2, 0);
    decals.floor(9, 0, -15.3, 3.7, 4, 0);
    decals.floor(10, -8.6, 0, 5.9, 4, Math.PI / 2);
    decals.floor(10, 8.6, 0, 5.9, 4, -Math.PI / 2);
    decals.floor(11, -15, -31, 5.3, 4, Math.PI / 2);
    decals.floor(11, 15, -31, 5.3, 4, -Math.PI / 2);
    for (const b of L.boxes) {
      if (b.kind === 'machine') decals.floor(0, (b.min[0] + b.max[0]) * 0.5, (b.min[2] + b.max[2]) * 0.5, 11, 9, 0.6);
    }
    for (const route of Object.values(L.routes)) {
      const pts = route.points;
      const p = pts[Math.min(2, pts.length - 1)];
      decals.floor(2, p.x, p.z, 5.7, 4.6, Math.atan2(p.x, p.z));
      const q = pts[Math.min(3, pts.length - 1)];
      decals.floor(1, q.x, q.z, 7.4, 5.1, Math.atan2(q.x, q.z) + 0.55);
    }
    decals.finish();
    this.buildSkyline();
    new ArenaDressing({ scene: this.scene, box: (...a) => this.box(...a), add: (m, mat, s) => this.add(m, mat, s) }, this.pal, this.layout).build();
    // Floor zoning: reactor plaza, wall gutters, gate chevrons (thin inlays under decals and lanes).
    new ArenaFloor({ scene: this.scene, add: (m, mat, s) => this.add(m, mat, s) }, this.pal, this.layout).build();
    // Weathering: rubble piles, scattered debris and wreckage (visual only, planned off every lane).
    new RubbleBuilder({ scene: this.scene, add: (m, mat, s) => this.add(m, mat, s) }, { concrete: P.debris, rust: P.rust, graphite: P.graphite, enamel: P.enamel }, true).build(planRubble(L));

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
        this.box(x0, y0, z0, x1, y1, z1, P.concrete, 'wall');
        // Armored kick plate and cable cap.
        const inset = 0.08;
        this.box(x0 - inset, 0, z0 - inset, x1 + inset, 1.05, z1 + inset, P.graphite, 'wall');
        this.box(x0 - inset, y1 - 0.5, z0 - inset, x1 + inset, y1, z1 + inset, P.graphite, 'wall');
        break;
      }
      case 'gate': {
        // The perimeter already supplies the first two metres of each tunnel side.
        // Trim just the render pieces so two materials never share the same inner face.
        const trim = (a: number, b: number): [number, number] => {
          const h = this.layout.half;
          return a === h && b > h + 2 ? [h + 2, b] : b === -h && a < -h - 2 ? [a, -h - 2] : [a, b];
        };
        const [left, right] = trim(x0, x1);
        const [front, back] = trim(z0, z1);
        this.box(left, y0, front, right, y1, back, P.steel, 'wall');
        const extendX = right - left < back - front ? 0.045 : 0;
        const extendZ = extendX > 0 ? 0 : 0.045;
        this.box(left - extendX, 2.0, front - extendZ, right + extendX, 2.15, back + extendZ, P.orangeDim, null);
        break;
      }
      case 'platform': {
        this.box(x0, y0, z0, x1, y1 - 0.24, z1, P.concrete, 'wall');
        this.box(x0, y1 - 0.24, z0, x1, y1, z1, P.graphite, 'platform');
        this.box(x0 - 0.045, y1 - 0.49, z0 - 0.045, x1 + 0.045, y1 - 0.38, z1 + 0.045, P.enamel, null);
        // Support columns
        for (const [cx, cz] of [[x0 + 0.6, z0 + 0.6], [x1 - 0.6, z0 + 0.6], [x0 + 0.6, z1 - 0.6], [x1 - 0.6, z1 - 0.6]]) {
          this.box(cx - 0.45, 0, cz - 0.45, cx + 0.45, y1 - 0.12, cz + 0.45, P.metal, 'wall');
        }
        // Flush fascia hides the bearing plates under the deck overhang.
        for (const edge of [z0, z1]) {
          const side = edge === z0 ? -1 : 1;
          const fascia = (x: number, w: number, y: number, h: number, near: number, far: number, mat: Material) => {
            const a = edge + side * near;
            const b = edge + side * far;
            this.box(x - w, y, Math.min(a, b), x + w, y + h, Math.max(a, b), mat, 'wall');
          };
          for (let x = x0 + 2.3; x < x1 - 1.5; x += 3.6) {
            fascia(x, 0.91, y1 - 1.44, 0.84, 0, 0.085, P.graphite);
            fascia(x, 0.77, y1 - 1.31, 0.58, 0.084, 0.132, P.panel);
            fascia(x, 0.47, y1 - 1.04, 0.07, 0.13, 0.15, P.metal);
          }
        }
        break;
      }
      case 'block':
        // ArenaDressing builds the pickable cooling plant inside this collision footprint.
        break;
      case 'machine': {
        this.box(x0, y0, z0, x1, y1, z1, P.graphite, 'wall');
        const capacitor = smoothLatheData([
          [0.61, 0], [0.73, 0.10], [0.73, 0.28], [0.56, 0.39], [0.56, 1.01],
          [0.71, 1.12], [0.71, 1.34], [0.59, 1.48], [0.35, 1.60],
        ], 24);
        const alongX = x1 - x0 > z1 - z0;
        const face = alongX ? z1 : x0 < 0 ? x1 : x0;
        const side = alongX || x0 < 0 ? 1 : -1;
        const n = 3;
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n;
          const cx = alongX ? x0 + (x1 - x0) * f : (x0 + x1) / 2;
          const cz = alongX ? (z0 + z1) / 2 : z0 + (z1 - z0) * f;
          const c = new Mesh('cap', this.scene);
          capacitor.applyToMesh(c);
          c.position.set(cx, y1, cz);
          this.add(c, P.metal, 'wall');
          const ring = MeshBuilder.CreateTorus('capRing', { thickness: 0.08, diameter: 1.42, tessellation: 24 }, this.scene);
          ring.position.set(cx, y1 + 1.2, cz);
          this.add(ring, i % 2 ? P.cyanGlow : P.cyanDim, null);
          this.collider(new Vector3(cx, y1 + 0.8, cz), new Vector3(1.5, 1.6, 1.5));
          const slot = (w: number, y: number, height: number, near: number, far: number, mat: Material, surface: string | null) => {
            const a = face + side * near;
            const b = face + side * far;
            if (alongX) this.box(cx - w, y, a, cx + w, y + height, b, mat, surface);
            else this.box(Math.min(a, b), y, cz - w, Math.max(a, b), y + height, cz + w, mat, surface);
          };
          slot(1.13, 0.37, y1 - 0.63, -0.025, 0.12, P.metal, 'wall');
          slot(0.95, 0.57, y1 - 1.1, 0.117, 0.17, P.panel, 'wall');
          for (let j = 0; j < 4; j++) slot(0.81, 0.78 + j * 0.156, 0.062, 0.166, 0.218, P.graphite, 'wall');
          slot(0.48, y1 - 0.8, 0.064, 0.17, 0.202, i === 1 ? P.cyanDim : P.orangeDim, null);
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

  prepareWave(gates: Iterable<GateId>): void {
    this.armed = new Set(gates);
  }

  gateSpawned(gate: GateId, at?: { x: number; z: number }): void {
    // Forward-rift spawns flare their anchor instead of the gate.
    if (at && this.rifts && Math.max(Math.abs(at.x), Math.abs(at.z)) < this.layout.half - 2) {
      this.rifts.spawned(at.x, at.z);
      return;
    }
    const visual = this.gates.get(gate);
    if (visual) visual.flash = 1;
  }

  gateActivity(gate: GateId): number {
    return this.gates.get(gate)?.charge ?? 0;
  }

  /** Seal / open a gate (M6 arena evolution). Sealed lanes render as a dim grey reserved corridor. */
  setSealed(gate: GateId, sealed: boolean): void {
    const v = this.gates.get(gate);
    if (!v) return;
    if (sealed) this.sealed.add(gate);
    else this.sealed.delete(gate);
    v.lane.setColor(sealed ? new Color3(0.32, 0.36, 0.4) : new Color3(2.7, 0.65, 0.11));
  }

  update(dt: number, hostileDt: number, warning: number): void {
    this.riftT += dt;
    this.rifts?.update(dt, this.riftT);
    for (const [id, gate] of this.gates) {
      const target = this.sealed.has(id) ? 0.02 : this.armed.has(id) ? 0.13 + 0.87 * warning : 0.12;
      gate.charge += (target - gate.charge) * (1 - Math.exp(-dt * 4));
      gate.flash *= Math.exp(-hostileDt * 3.4);
      gate.lane.update(hostileDt, gate.charge, gate.flash);
      gate.rotor.rotation.y += hostileDt * (0.24 + gate.charge * 0.7);
      gate.counterRotor.rotation.y -= hostileDt * (0.32 + gate.charge * 0.9);
      const power = 0.33 + 0.75 * gate.charge + 0.7 * gate.flash;
      gate.lights.emissiveColor.set(2.5 * power, 0.64 * power, 0.13 * power);
    }
    for (const conduit of this.conduits) conduit.update(dt, 0.72);
  }

  /** Cyan power guides run from the southern deck into the reactor hub. */
  private buildConduits(): void {
    const P = this.pal;
    const lines: [number, number, number, number][] = [
      [-5, -36, -1.6, -4.5],
      [-20, -22, -4, -3],
      [20, -22, 4, -3],
    ];
    for (const [x0, z0, x1, z1] of lines) {
      this.conduits.push(createPathLight(this.scene, 'reactorFeed', [{ x: x0, z: z0 }, { x: x1, z: z1 }], 0.52, new Color3(0.23, 1.7, 2.2)));
    }
    // Reactor plaza ring
    const ring = MeshBuilder.CreateTorus('plaza', { diameter: 15, thickness: 0.12, tessellation: 64 }, this.scene);
    ring.position.y = 0.01;
    ring.scaling.y = 0.1;
    this.add(ring, P.cyanDim, null);
  }

  private buildGates(decals: ArenaDecals): void {
    const P = this.pal;
    const H = this.layout.half;
    const frames: { id: GateId; pos: Vector3; yaw: number }[] = [
      { id: 'north', pos: new Vector3(0, 0, H), yaw: 0 },
      { id: 'east', pos: new Vector3(H, 0, 0), yaw: Math.PI / 2 },
      { id: 'west', pos: new Vector3(-H, 0, 0), yaw: -Math.PI / 2 },
      { id: 'south', pos: new Vector3(0, 0, -H), yaw: Math.PI },
    ];
    for (const f of frames) {
      const lights = unlit(this.scene, `gateSignal:${f.id}`, [1.35, 0.36, 0.08], { twoSided: true });
      const root = new TransformNode('gate', this.scene);
      root.position.copyFrom(f.pos);
      root.rotation.y = f.yaw;
      const mk = (w: number, h: number, d: number, x: number, y: number, z: number, mat: Material) => {
        const m = createBeveledBox('gatePart', w, h, d, Math.min(w, h, d, 0.32) * 0.32, this.scene);
        m.rotation.y = f.yaw;
        m.position = Vector3.TransformCoordinates(new Vector3(x, y, z), root.getWorldMatrix());
        this.add(m, mat, mat === lights || mat === P.orangeDim || mat === P.whiteGlow ? null : 'wall');
        return m;
      };
      root.computeWorldMatrix(true);
      // Blast-gate structure, weather shields and chevron-shaped energy clamps.
      mk(1.4, 9.4, 2.6, -5.12, 4.7, 0.2, P.graphite);
      mk(1.4, 9.4, 2.6, 5.12, 4.7, 0.2, P.graphite);
      mk(11.8, 1.6, 2.6, 0, 8.6, 0.2, P.graphite);
      mk(11.78, 0.24, 0.54, 0, 9.19, -1.29, P.metal);
      mk(9.25, 0.45, 0.4, 0, 7.87, -1.1, P.metal);
      mk(8.7, 0.07, 0.08, 0, 7.68, -1.33, lights);
      for (const side of [-1, 1]) {
        mk(0.53, 6.95, 0.34, side * 4.65, 3.72, -1.15, P.metal);
        mk(0.09, 5.3, 0.08, side * 4.55, 3.64, -1.35, lights);
        mk(0.75, 1.72, 0.48, side * 5.13, 1.1, -1.25, P.enamel);
        mk(0.8, 1.15, 0.44, side * 5.24, 6.23, -1.21, P.panel);
        mk(0.8, 0.12, 0.36, side * 5.24, 6.17, -1.36, P.whiteGlow);
        for (let i = 0; i < 4; i++) {
          mk(0.64, 0.067, 0.048, side * 5.13, 0.63 + i * 0.26, -1.50, P.graphite);
        }
        // Hydraulic ram and receiver casing behind each guide.
        mk(0.83, 2.95, 0.51, side * 5.22, 3.77, -1.32, P.panel);
        mk(0.3, 2.45, 0.09, side * 5.22, 3.75, -1.6, P.graphite);
        mk(0.15, 1.56, 0.09, side * 5.22, 4.02, -1.655, P.metal);
        for (const y of [2.55, 4.95]) mk(0.54, 0.14, 0.20, side * 5.22, y, -1.61, P.enamel);
        const gusset = mk(1.34, 0.39, 0.53, side * 4.47, 7.38, -1.27, P.graphite);
        gusset.rotate(Vector3.Forward(), side * 0.68);
      }
      const stencilPosition = Vector3.TransformCoordinates(new Vector3(0, 8.67, -1.128), root.getWorldMatrix());
      decals.gate(f.id, stencilPosition, f.yaw);
      for (const side of [-1, 1]) {
        const threshold = Vector3.TransformCoordinates(new Vector3(side * 3.5, 0, -1.55), root.getWorldMatrix());
        decals.floor(3, threshold.x, threshold.z, 1.2, 2.1, f.yaw);
      }
      // Rift portal at the back of the tunnel
      root.computeWorldMatrix(true);
      const portalPos = Vector3.TransformCoordinates(new Vector3(0, 3.6, 11.2), root.getWorldMatrix());
      const disc = MeshBuilder.CreateDisc('rift', { radius: 3.4, tessellation: 48 }, this.scene);
      disc.material = P.rift;
      disc.position.copyFrom(portalPos);
      disc.rotation.y = f.yaw;
      disc.isPickable = false;
      const frame = new TransformNode('gateRotorFrame', this.scene);
      frame.parent = root;
      frame.position.set(0, 3.6, 10.94);
      frame.rotation.x = -Math.PI / 2;
      const rim = MeshBuilder.CreateTorus('riftRing', { diameter: 7.4, thickness: 0.22, tessellation: 48 }, this.scene);
      rim.material = P.graphite;
      rim.parent = frame;
      rim.isPickable = false;
      const cage = segmentedRing(this.scene, 'gateFieldCage', 3.79, 0.34, 8, 0.79);
      cage.parent = frame;
      cage.position.y = 0.09;
      cage.material = P.metal;
      const rotor = segmentedRing(this.scene, 'gateRotor', 3.66, 0.12, 8, 0.57);
      rotor.parent = frame;
      rotor.position.y = 0.11;
      rotor.material = lights;
      const counterRotor = segmentedRing(this.scene, 'gateRotorInner', 3.19, 0.04, 20, 0.35);
      counterRotor.parent = frame;
      counterRotor.material = P.orangeDim;
      const lane = createPathLight(this.scene, `hostileLane:${f.id}`, this.layout.routes[f.id].points,
        this.layout.laneHalfWidth, new Color3(2.7, 0.65, 0.11), true);
      this.gates.set(f.id, { lane, rotor, counterRotor, lights, charge: 0.4, flash: 0 });
    }
  }

  /** Overhead truss frame and distant light pylons: frames the space without enclosing it. */
  private buildSkyline(): void {
    const P = this.pal;
    const H = this.layout.half;
    for (const x of [-22, 22]) {
      this.box(x - 0.46, 12.09, -H - 2, x + 0.46, 12.36, H + 2, P.graphite, null);
      this.box(x - 0.40, 13.12, -H - 2, x + 0.40, 13.34, H + 2, P.graphite, null);
      for (let z = -H; z < H; z += 4) {
        const brace = createBeveledBox('trussBrace', 0.3, 0.28, Math.hypot(4, 1.03), 0.04, this.scene);
        brace.position.set(x, 12.73, z + 2);
        brace.rotation.x = (Math.round((z + H) / 4) % 2 === 0 ? 1 : -1) * Math.atan2(1.03, 4);
        this.add(brace, P.metal, null);
        if (z % 12 === 0) this.box(x - 0.075, 12.01, z + 0.8, x + 0.075, 12.09, z + 1.6, P.cyanDim, null);
      }
    }
    for (const z of [-34, 36]) {
      const arch = [[-22, 12.95], [-13, 16.9], [13, 16.9], [22, 12.95]];
      for (let i = 1; i < arch.length; i++) {
        const [x0, y0] = arch[i - 1];
        const [x1, y1] = arch[i];
        const strut = createBeveledBox('gantrySpan', Math.hypot(x1 - x0, y1 - y0) + 0.45, 0.67, 0.91, 0.095, this.scene);
        strut.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
        strut.rotation.z = Math.atan2(y1 - y0, x1 - x0);
        this.add(strut, P.graphite, null);
      }
      const catenary = Array.from({ length: 15 }, (_, i) => {
        const span = i / 14;
        return new Vector3(25 * (span - 0.5), 16.62 - 1.3 * Math.sin(span * Math.PI), z - 0.56);
      });
      this.add(MeshBuilder.CreateTube('overheadUtilityCable', { path: catenary, radius: 0.065, tessellation: 7 }, this.scene), P.graphite, null);
      if (z > 0) {
        for (const x of [-10, 10]) {
          this.box(x - 0.09, 11.58, z - 0.09, x + 0.09, 16.68, z + 0.09, P.metal, null);
          this.box(x - 0.45, 16.43, z - 0.44, x + 0.45, 16.7, z + 0.44, P.graphite, null);
        }
      }
    }
    for (const z of [-H - 1, H + 1]) {
      for (const x of [-22, 22]) {
        this.box(x - 0.8, 0, z - 0.85, x + 0.8, 13.34, z + 0.85, P.graphite, null);
        this.box(x - 1, 11.4, z - 1.05, x + 1, 13.48, z + 1.05, P.concrete, null);
      }
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
      const masonry = g.mat === this.pal.concrete;
      if (masonry || g.mat === this.pal.panel) boxProjectUVs(merged, masonry ? 3 : 4);
      else if (g.mat === this.pal.white || g.mat === this.pal.graphite || g.mat === this.pal.metal || g.mat === this.pal.enamel || g.mat === this.pal.steel) boxProjectUVs(merged, 2.5);
      this.meshes.push(merged);
      merged.isPickable = g.surface !== null;
      merged.metadata = g.surface ? { surface: g.surface, impact: masonry || g.mat === this.pal.white || g.mat === this.pal.panel ? 'ceramic' : 'alloy' } : null;
      merged.receiveShadows = g.surface !== null;
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      if (g.surface === 'wall' || g.surface === 'platform') this.shadowCasters.push(merged);
    }
    this.parts.clear();
  }
}
