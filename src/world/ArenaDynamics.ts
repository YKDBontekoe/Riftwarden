import {
  type AbstractMesh,
  Color3,
  type Material,
  type Mesh,
  MeshBuilder,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeBox,
  Quaternion,
  type Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { createBeveledBox } from '../visuals/bevel';
import { type Palette, unlit } from '../visuals/materials';
import type { ArenaLayout, Box } from './layout';
import { PHYS_ENV } from './physicsGroups';

/** Plasma vent eruption cycle (hostile seconds). */
export const VENT = { period: 9.5, warn: 1.7, burn: 0.9, tick: 0.25 } as const;

interface Movable {
  root: TransformNode;
  meshes: AbstractMesh[];
  body: PhysicsBody | null;
  shape: PhysicsShapeBox | null;
  box: Box;
  /** 0 = rest (closed door / lowered bulkhead), 1 = moved. */
  t: number;
  target: number;
  speed: number;
}

interface Vent {
  x: number;
  z: number;
  r: number;
  phase: number;
  glowMat: Material & { emissiveColor: Color3 };
  plume: Mesh;
  ring: Mesh;
  ticked: number;
}

export interface DynamicsHooks {
  playerPos(): Vector3;
  /** Move the player out of a footprint (only used if they ignored the warning). */
  movePlayer(to: Vector3): void;
  /** A vent tick: damage everything inside (radius) once. */
  ventTick(at: Vector3, r: number): void;
  /** Visual / audio cues for vents. */
  ventFx(at: Vector3, stage: 'warn' | 'erupt'): void;
  /** Loot or other items inside a footprint that is about to be occupied. */
  clearZone(box: Box): void;
  shake(pos: Vector3, strength: number): void;
}

/**
 * M6 evolving arena: the parts of the facility that change during a run.
 *  - South blast door: two armoured leaves slide into the wall; its collider is removed only once fully open.
 *  - Containment bulkheads: rise out of reserved footprints; they only start rising when the player is clear,
 *    and get their collider when fully raised (a player who walks in mid-rise is moved out first).
 *  - Plasma vents on the lanes: telegraphed eruptions that hurt anything standing in them.
 * Nothing here can touch towers: every footprint is reserved by the placement rules from the start.
 */
export class ArenaDynamics {
  private door: Movable[] = [];
  private barriers: Movable[] = [];
  private vents: Vent[] = [];
  private warnLights: { mat: Material & { emissiveColor: Color3 }; on: () => boolean }[] = [];
  southOpen = false;
  barriersUp = false;
  ventsActive = false;
  /** Seconds the barrier rise has been held back by the player standing in a footprint. */
  private holdT = 0;
  private time = 0;

  constructor(private scene: Scene, private P: Palette, private layout: ArenaLayout, private hooks: DynamicsHooks) {
    this.buildDoor();
    this.buildBarriers();
    this.buildVents();
  }

  // ------------------------------------------------------------------ construction

  private body(center: Vector3, ext: Vector3): { body: PhysicsBody; shape: PhysicsShapeBox } {
    const node = new TransformNode('dynBody', this.scene);
    node.position.copyFrom(center);
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    const shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), ext, this.scene);
    shape.filterMembershipMask = PHYS_ENV;
    body.shape = shape;
    return { body, shape };
  }

  private part(root: TransformNode, w: number, h: number, d: number, x: number, y: number, z: number, mat: Material, surface: string | null): AbstractMesh {
    const m = createBeveledBox('dynPart', w, h, d, Math.min(0.045, Math.min(w, h, d) * 0.12), this.scene);
    m.parent = root;
    m.position.set(x, y, z);
    m.material = mat;
    m.isPickable = !!surface;
    m.metadata = surface ? { surface, impact: 'alloy' } : null;
    m.receiveShadows = true;
    return m;
  }

  private buildDoor(): void {
    const b = this.layout.southDoor;
    const P = this.P;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const hazard = unlit(this.scene, 'doorHazard', [1.9, 0.75, 0.08]);
    const warn = unlit(this.scene, 'doorWarn', [0.6, 0.05, 0.02]);
    this.warnLights.push({ mat: warn, on: () => this.door.some((m) => m.t > 0 && m.t < 1) });
    for (const side of [-1, 1]) {
      const root = new TransformNode('southDoorLeaf', this.scene);
      root.position.set(cx + side * w * 0.25, 0, cz);
      const meshes: AbstractMesh[] = [];
      meshes.push(this.part(root, w / 2, h, d * 0.7, 0, h / 2, 0, P.graphite, 'wall'));
      for (let i = 0; i < 4; i++) meshes.push(this.part(root, w / 2 - 0.5, 1.4, d * 0.78, 0, 1.2 + i * 2.05, 0, P.white, 'wall'));
      // chevrons on the inner face + leading edge light
      for (let i = 0; i < 5; i++) meshes.push(this.part(root, 0.5, 0.18, 0.05, side * -0.4 + side * i * -0.55 + side * 1.2, 0.5, d * 0.36 + 0.04, hazard, null));
      meshes.push(this.part(root, 0.12, h - 0.6, 0.06, -side * (w / 4 - 0.08), h / 2, d * 0.36 + 0.03, warn, null));
      const { body, shape } = this.body(new Vector3(cx + side * w * 0.25, h / 2, cz), new Vector3(w / 2, h, d));
      this.door.push({ root, meshes, body, shape, box: b, t: 0, target: 0, speed: 1 / 4.5 });
    }
    // Overhead warning beacon
    const beacon = new TransformNode('doorBeacon', this.scene);
    beacon.position.set(cx, h + 0.6, cz + d / 2 + 0.3);
    this.part(beacon, 3, 0.3, 0.3, 0, 0, 0, warn, null);
  }

  private buildBarriers(): void {
    const P = this.P;
    const strip = unlit(this.scene, 'bulkheadStrip', [0.2, 1.4, 1.7]);
    for (const b of this.layout.barriers) {
      const w = b.max[0] - b.min[0];
      const h = b.max[1] - b.min[1];
      const d = b.max[2] - b.min[2];
      const root = new TransformNode('bulkhead', this.scene);
      root.position.set((b.min[0] + b.max[0]) / 2, -h - 0.05, (b.min[2] + b.max[2]) / 2);
      const meshes: AbstractMesh[] = [];
      meshes.push(this.part(root, w, h - 0.3, d, 0, (h - 0.3) / 2, 0, P.white, 'wall'));
      meshes.push(this.part(root, w + 0.1, 0.3, d + 0.1, 0, h - 0.15, 0, P.graphite, 'wall'));
      const along = d > w;
      for (let i = -1; i <= 1; i++) meshes.push(this.part(root, along ? w + 0.04 : 0.4, h - 0.8, along ? 0.4 : d + 0.04, along ? 0 : i * w * 0.3, (h - 0.3) / 2, along ? i * d * 0.3 : 0, P.graphite, 'wall'));
      meshes.push(this.part(root, along ? w + 0.06 : w * 0.8, 0.1, along ? d * 0.8 : d + 0.06, 0, h - 0.55, 0, strip, null));
      for (const m of meshes) m.setEnabled(false);
      // Floor hatch marks the reserved footprint from the start.
      const hatch = MeshBuilder.CreateGround('bulkheadHatch', { width: w + 0.6, height: d + 0.6 }, this.scene);
      hatch.position.set(root.position.x, 0.02, root.position.z);
      hatch.material = unlit(this.scene, 'hatchMat', [0.55, 0.32, 0.06], { additive: true });
      hatch.isPickable = false;
      this.barriers.push({ root, meshes, body: null, shape: null, box: b, t: 0, target: 0, speed: 1 / 3.2 });
    }
  }

  private buildVents(): void {
    const P = this.P;
    for (let i = 0; i < this.layout.vents.length; i++) {
      const v = this.layout.vents[i];
      const root = new TransformNode('vent', this.scene);
      root.position.set(v.x, 0, v.z);
      const grate = MeshBuilder.CreateCylinder('ventGrate', { diameter: v.r * 1.5, height: 0.08, tessellation: 24 }, this.scene);
      grate.parent = root;
      grate.position.y = 0.03;
      grate.material = P.graphite;
      grate.isPickable = false;
      const rim = MeshBuilder.CreateTorus('ventRim', { diameter: v.r * 1.55, thickness: 0.16, tessellation: 32 }, this.scene);
      rim.parent = root;
      rim.position.y = 0.05;
      rim.material = P.metal;
      rim.isPickable = false;
      const glowMat = unlit(this.scene, `ventGlow${i}`, [0, 0, 0]);
      for (let k = 0; k < 4; k++) {
        const slat = MeshBuilder.CreateBox('ventSlat', { width: v.r * 1.3, height: 0.05, depth: 0.12 }, this.scene);
        slat.parent = root;
        slat.position.set(0, 0.09, (k - 1.5) * 0.45);
        slat.material = glowMat;
        slat.isPickable = false;
      }
      const ring = MeshBuilder.CreateTorus('ventWarn', { diameter: v.r * 2, thickness: 0.12, tessellation: 40 }, this.scene);
      ring.parent = root;
      ring.position.y = 0.06;
      ring.material = unlit(this.scene, `ventWarnMat${i}`, [2.6, 0.5, 0.06], { additive: true });
      ring.isPickable = false;
      ring.setEnabled(false);
      const plume = MeshBuilder.CreateCylinder('ventPlume', { diameterTop: v.r * 1.6, diameterBottom: v.r * 1.2, height: 7, tessellation: 18, cap: 0 }, this.scene);
      plume.parent = root;
      plume.position.y = 3.5;
      plume.material = unlit(this.scene, `ventPlumeMat${i}`, [2.8, 0.9, 0.15], { additive: true, twoSided: true });
      plume.isPickable = false;
      plume.setEnabled(false);
      this.vents.push({ x: v.x, z: v.z, r: v.r, phase: (i * VENT.period) / this.layout.vents.length, glowMat: glowMat as Material & { emissiveColor: Color3 }, plume, ring, ticked: 0 });
    }
  }

  // ------------------------------------------------------------------ transitions

  /** Evolution A: open the south blast door (collider removed when fully open). */
  openSouth(instant = false): void {
    this.southOpen = true;
    for (const m of this.door) {
      m.target = 1;
      if (instant) m.t = 0.999;
    }
  }

  /** Evolution B: raise the containment bulkheads and arm the plasma vents. */
  activateInstability(instant = false): void {
    this.barriersUp = true;
    this.ventsActive = true;
    for (const m of this.barriers) {
      m.target = 1;
      if (instant) m.t = 0.999;
    }
    for (const z of this.layout.barriers) this.hooks.clearZone(z);
  }

  /** Development reset: close everything again. */
  resetAll(): void {
    this.southOpen = this.barriersUp = this.ventsActive = false;
    for (const m of this.door) {
      m.target = 0;
      m.t = 0;
      if (!m.body) {
        const b = m.box;
        const w = (b.max[0] - b.min[0]) / 2;
        const made = this.body(new Vector3(m.root.position.x, (b.max[1] - b.min[1]) / 2, (b.min[2] + b.max[2]) / 2), new Vector3(w, b.max[1] - b.min[1], b.max[2] - b.min[2]));
        m.body = made.body;
        m.shape = made.shape;
      }
    }
    for (const m of this.barriers) {
      m.target = 0;
      m.t = 0;
      this.dropBody(m);
    }
    this.layoutDoor();
    for (const m of this.barriers) this.layoutBarrier(m);
  }

  get busy(): boolean {
    return [...this.door, ...this.barriers].some((m) => m.t !== m.target);
  }

  private dropBody(m: Movable): void {
    m.body?.dispose();
    m.shape?.dispose();
    m.body = null;
    m.shape = null;
  }

  private layoutDoor(): void {
    for (let i = 0; i < this.door.length; i++) {
      const m = this.door[i];
      const side = i === 0 ? -1 : 1;
      const b = m.box;
      const w = b.max[0] - b.min[0];
      const e = m.t * m.t * (3 - 2 * m.t);
      m.root.position.x = (b.min[0] + b.max[0]) / 2 + side * w * 0.25 + side * e * (w * 0.5 + 0.1);
    }
  }

  private layoutBarrier(m: Movable): void {
    const h = m.box.max[1] - m.box.min[1];
    const e = m.t * m.t * (3 - 2 * m.t);
    m.root.position.y = -h - 0.05 + e * (h + 0.05);
    for (const mesh of m.meshes) mesh.setEnabled(m.t > 0);
  }

  private playerInside(b: Box, margin = 0.7): boolean {
    const p = this.hooks.playerPos();
    return p.x > b.min[0] - margin && p.x < b.max[0] + margin && p.z > b.min[2] - margin && p.z < b.max[2] + margin && p.y < b.max[1] + 1.5;
  }

  private pushOut(b: Box): void {
    const p = this.hooks.playerPos();
    const cx = (b.min[0] + b.max[0]) / 2;
    const out = p.x < cx ? b.min[0] - 1.4 : b.max[0] + 1.4;
    this.hooks.movePlayer(new Vector3(out, Math.max(p.y, 1), p.z));
  }

  /** Real-time animation of structures + hostile-time vent cycles. */
  update(dt: number, hdt: number): void {
    this.time += dt;
    // Door leaves
    for (const m of this.door) {
      if (m.t === m.target) continue;
      m.t = Math.min(1, m.t + dt * m.speed);
      if (m.t >= 1) {
        this.dropBody(m);
        this.hooks.shake(m.root.position, 0.25);
      }
    }
    if (this.door.some((m) => m.t > 0)) this.layoutDoor();

    // Bulkheads: hold while the player stands in a footprint; after a grace period, move them out.
    if (this.barriers.some((m) => m.t < m.target)) {
      const blocked = this.barriers.filter((m) => m.t === 0 && this.playerInside(m.box));
      if (blocked.length) {
        this.holdT += dt;
        if (this.holdT > 4) for (const m of blocked) this.pushOut(m.box);
      } else this.holdT = 0;
      for (const m of this.barriers) {
        if (m.t >= m.target || (m.t === 0 && this.playerInside(m.box))) continue;
        m.t = Math.min(1, m.t + dt * m.speed);
        this.layoutBarrier(m);
        if (m.t >= 1) {
          if (this.playerInside(m.box, 0.45)) this.pushOut(m.box);
          const b = m.box;
          const made = this.body(new Vector3((b.min[0] + b.max[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.min[2] + b.max[2]) / 2), new Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
          m.body = made.body;
          m.shape = made.shape;
          this.hooks.shake(m.root.position, 0.3);
        }
      }
    }
    for (const w of this.warnLights) {
      const on = w.on();
      const k = on ? 0.5 + 0.5 * Math.sin(this.time * 12) : 0.15;
      w.mat.emissiveColor.set(2.8 * k, 0.25 * k, 0.05 * k);
    }

    // Vents (hostile time so tactical mode slows them too)
    for (const v of this.vents) {
      if (!this.ventsActive) {
        v.glowMat.emissiveColor.set(0.04, 0.02, 0.01);
        continue;
      }
      const prev = v.phase;
      v.phase = (v.phase + hdt) % VENT.period;
      const tWarn = VENT.period - VENT.warn - VENT.burn;
      const tBurn = VENT.period - VENT.burn;
      const at = new Vector3(v.x, 0.2, v.z);
      if (prev < tWarn && v.phase >= tWarn) this.hooks.ventFx(at, 'warn');
      if (prev < tBurn && v.phase >= tBurn) {
        this.hooks.ventFx(at, 'erupt');
        v.ticked = 0;
      }
      const warn = v.phase >= tWarn && v.phase < tBurn;
      const burn = v.phase >= tBurn;
      v.ring.setEnabled(warn);
      if (warn) {
        const f = (v.phase - tWarn) / VENT.warn;
        v.ring.scaling.setAll(0.35 + 0.65 * f);
        v.glowMat.emissiveColor.set(0.6 + 2.4 * f, 0.15 + 0.5 * f, 0.02);
      } else if (burn) {
        v.glowMat.emissiveColor.set(3.2, 1.2, 0.2);
        const f = (v.phase - tBurn) / VENT.burn;
        // Damage ticks during the eruption.
        const ticks = Math.floor(f * (VENT.burn / VENT.tick)) + 1;
        while (v.ticked < ticks) {
          v.ticked++;
          this.hooks.ventTick(at, v.r);
        }
      } else v.glowMat.emissiveColor.set(0.25, 0.06, 0.01);
      v.plume.setEnabled(burn);
      if (burn) {
        const f = (v.phase - tBurn) / VENT.burn;
        v.plume.scaling.set(1 + 0.2 * Math.sin(this.time * 30), Math.min(1, f * 5) * (1 - Math.max(0, f - 0.7) * 3), 1 + 0.2 * Math.cos(this.time * 27));
        v.plume.rotation.y = this.time * 3;
      }
    }
  }

  /** Is (x,z) within `range` of an active vent (conduit-fed towers)? */
  nearVent(x: number, z: number, range = 7.5): boolean {
    if (!this.ventsActive) return false;
    return this.vents.some((v) => (v.x - x) ** 2 + (v.z - z) ** 2 < range * range);
  }

  /** Vent positions + phase for the HUD/radar. */
  ventState(): { x: number; z: number; r: number; danger: number }[] {
    const tWarn = VENT.period - VENT.warn - VENT.burn;
    return this.vents.map((v) => ({ x: v.x, z: v.z, r: v.r, danger: !this.ventsActive ? 0 : v.phase >= tWarn ? 1 : 0 }));
  }
}

export const COLOR_VENT = new Color3(2.8, 0.9, 0.15);
