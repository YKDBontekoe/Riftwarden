import { Color3, type Mesh, MeshBuilder, PhysicsBody, PhysicsMotionType, PhysicsShapeBox, Quaternion, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { type AbilityKind, DEPLOY, deployDistance } from '../abilities/defs';
import type { Turret, TurretContext, TurretManager } from '../defense/Turrets';
import type { Effects } from '../fx/Effects';
import { MOVE, Player } from '../player/Player';
import { buildWardenDrone, type DroneRig } from '../visuals/droneModel';
import type { Kit } from '../visuals/kit';
import { type Palette, unlit } from '../visuals/materials';
import { PHYS_ENV } from '../world/physicsGroups';

/** What deployables need from the arena (no Game import). */
export interface DeployHost {
  readonly scene: Scene;
  readonly kit: Kit;
  readonly pal: Palette;
  readonly fx: Effects;
  readonly turrets: TurretManager;
  readonly turretCtx: TurretContext;
  /** First static-level hit on a -> b, or null. */
  probe(a: Vector3, b: Vector3): Vector3 | null;
}

interface Wall {
  mesh: Mesh;
  body: PhysicsBody | null;
  t: number;
  life: number;
}

const DOWN_FROM = new Vector3();
const DOWN_TO = new Vector3();
const WALL_COLOR = new Color3(0.5, 1.5, 3.2);

/**
 * Placed abilities: Shield Wall (a static Havok box in the ENV group, so enemy bolts and enemy line of sight stop
 * at it while player hitscan, which picks meshes tagged `surface`, passes), Holo Decoy (a stand-in drone body that
 * enemies within its radius target instead of the warden: `decoyFor` is used by the enemy focus) and Mini-Sentry
 * (a temporary Sentinel that never blocks lanes and cannot be refitted, recycled or repaired).
 */
export class Deployables {
  private walls: Wall[] = [];
  private wallMat: ReturnType<typeof unlit> | null = null;
  private edgeMat: ReturnType<typeof unlit> | null = null;
  private decoyBody: Player | null = null;
  private decoyRig: DroneRig | null = null;
  decoyHp = 0;
  decoyT = 0;
  private decoyRadius = 0;
  private sentries: Turret[] = [];
  /** Placed this run (diagnostics / tests). */
  placedCount = 0;
  /** Co-op server: a temporary sentry appeared / went away (replicated as a tower). */
  onSentry: ((t: Turret, added: boolean) => void) | null = null;
  /** Co-op server: replicate a wall / decoy to the clients. */
  onPlaced: ((kind: 'wall' | 'decoy', at: Vector3, yaw: number, seconds: number, size: number) => void) | null = null;

  constructor(private readonly h: DeployHost) {}

  /** Place a deployable from `eye` along `aim`. `power` = seconds (wall, sentry) or hit points (decoy). */
  deploy(kind: AbilityKind, eye: Vector3, aim: Vector3, power: number, radius: number, yaw: number): Vector3 {
    const at = this.groundPoint(eye, aim);
    if (kind === 'wall') this.wall(at, yaw, power, radius);
    else if (kind === 'decoy') this.decoy(at, power, radius);
    else if (kind === 'sentry') this.sentry(at, yaw, power);
    this.placedCount++;
    return at;
  }

  /** Where along the aim the deployable lands (on the ground). */
  groundPoint(eye: Vector3, aim: Vector3): Vector3 {
    const end = eye.add(aim.scale(DEPLOY.range));
    const hit = this.h.probe(eye, end);
    const d = deployDistance(DEPLOY.range, hit ? Vector3.Distance(eye, hit) : null);
    const at = eye.add(aim.scale(d));
    DOWN_FROM.set(at.x, Math.max(at.y, 0.3) + 0.5, at.z);
    DOWN_TO.set(at.x, -2, at.z);
    const ground = this.h.probe(DOWN_FROM, DOWN_TO);
    at.y = ground ? ground.y : 0;
    return at;
  }

  // ---------------------------------------------------------------- shield wall

  /** A barrier `2 * half` wide facing the drone (`yaw` = the drone's heading). Visual only when `solid` is false. */
  wall(at: Vector3, yaw: number, seconds: number, half: number, solid = true): void {
    const scene = this.h.scene;
    const w = half * 2;
    const hgt = DEPLOY.wallHeight;
    const mesh = MeshBuilder.CreateBox('shieldWall', { width: w, height: hgt, depth: 0.12 }, scene);
    this.wallMat ??= unlit(scene, 'shieldWallMat', [0.07, 0.26, 0.62], { additive: true });
    this.wallMat.alpha = 0.5;
    this.edgeMat ??= unlit(scene, 'shieldWallEdge', [0.7, 1.9, 3.4]);
    mesh.material = this.wallMat;
    mesh.isPickable = false;
    // Bright emitter rails along the edges and a few horizontal scan lines: reads as a projected field, not a slab.
    const rail = (name: string, x: number, y: number, rw: number, rh: number): void => {
      const r = MeshBuilder.CreateBox(name, { width: rw, height: rh, depth: 0.16 }, scene);
      r.material = this.edgeMat;
      r.isPickable = false;
      r.parent = mesh;
      r.position.set(x, y, 0);
    };
    rail('wallRailB', 0, -hgt / 2, w, 0.09);
    rail('wallRailT', 0, hgt / 2, w, 0.05);
    rail('wallRailL', -w / 2, 0, 0.07, hgt);
    rail('wallRailR', w / 2, 0, 0.07, hgt);
    for (const f of [-0.25, 0.1, 0.32]) rail('wallScan', 0, hgt * f, w, 0.012);
    mesh.position.set(at.x, at.y + hgt / 2, at.z);
    mesh.rotation.y = yaw;
    let body: PhysicsBody | null = null;
    if (solid && scene.getPhysicsEngine()) {
      const node = new TransformNode('shieldWallPhys', scene);
      node.position.copyFrom(mesh.position);
      node.rotationQuaternion = Quaternion.FromEulerAngles(0, yaw, 0);
      body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
      const shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(w, hgt, 0.5), scene);
      shape.filterMembershipMask = PHYS_ENV;
      body.shape = shape;
    }
    this.walls.push({ mesh, body, t: seconds, life: seconds });
    this.h.fx.burst('build', mesh.position, 30);
    this.h.fx.ring(at.add(new Vector3(0, 0.1, 0)), w, 0.35, WALL_COLOR, true);
    sfx.play('shieldHit', { pitch: 0.6, volume: 0.9 });
    if (solid) this.onPlaced?.('wall', at, yaw, seconds, half);
  }

  get wallCount(): number {
    return this.walls.length;
  }

  // ---------------------------------------------------------------- decoy

  /** A stand-in drone. `visualOnly` replicas never take hits or draw fire. */
  decoy(at: Vector3, hp: number, radius: number, visualOnly = false): void {
    const h = this.h;
    if (!this.decoyRig) {
      this.decoyRig = buildWardenDrone(h.scene, h.kit, h.pal, 3);
      this.decoyRig.root.setEnabled(false);
    }
    if (!visualOnly && !this.decoyBody) this.decoyBody = new Player(h.scene, { x: at.x, z: at.z, yaw: 0 }, MOVE);
    const p = this.decoyBody;
    if (p && !visualOnly) {
      p.controller.setPosition(new Vector3(at.x, at.y + 1.6, at.z));
      p.camera.position.set(at.x, at.y + 2.1, at.z);
      p.hp = p.maxHp = hp;
      p.alive = true;
      this.decoyHp = hp;
      this.decoyRadius = radius;
    }
    this.decoyT = DEPLOY.decoySeconds;
    this.decoyRig.root.position.set(at.x, at.y + 1.8, at.z);
    this.decoyRig.root.setEnabled(true);
    h.fx.burst('zap', this.decoyRig.root.position, 18);
    h.fx.ring(at.add(new Vector3(0, 0.1, 0)), 2.2, 0.4, WALL_COLOR, true);
    sfx.play('chargeReady', { pitch: 1.6, volume: 0.6 });
    if (!visualOnly) this.onPlaced?.('decoy', at, 0, DEPLOY.decoySeconds, radius);
  }

  /** The decoy body enemies near `pos` should target instead of the drone (null = none). */
  decoyFor(pos: Vector3): Player | null {
    const p = this.decoyBody;
    if (!p || !p.alive || this.decoyT <= 0) return null;
    const c = p.position;
    return (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2 <= this.decoyRadius ** 2 ? p : null;
  }

  isDecoy(p: Player): boolean {
    return p === this.decoyBody;
  }

  /** Hostile damage aimed at the decoy. */
  hurtDecoy(amount: number): void {
    if (!this.decoyBody?.alive || !(amount > 0)) return;
    this.decoyHp -= amount;
    this.h.fx.burst('zap', this.decoyBody.eye, 4);
    if (this.decoyHp <= 0) this.endDecoy();
  }

  /** Segment test for enemy bolts (the decoy is not a real drone, so the projectile loop asks here). */
  decoyHitBy(a: Vector3, b: Vector3): boolean {
    const p = this.decoyBody;
    if (!p?.alive || this.decoyT <= 0) return false;
    const c = p.eye;
    const ab = b.subtract(a);
    const len2 = ab.lengthSquared() || 1;
    const t = Math.max(0, Math.min(1, Vector3.Dot(c.subtract(a), ab) / len2));
    return Vector3.DistanceSquared(a.add(ab.scale(t)), c) < 0.9 * 0.9;
  }

  private endDecoy(): void {
    if (this.decoyRig?.root.isEnabled()) {
      this.h.fx.explode(this.decoyRig.root.position, { scale: 0.4, style: 'electric', debris: 0, scorch: false });
      this.decoyRig.root.setEnabled(false);
    }
    if (this.decoyBody) {
      this.decoyBody.alive = false;
      // Park the body under the deck so nothing collides with it.
      this.decoyBody.controller.setPosition(new Vector3(0, -50, 0));
    }
    this.decoyT = 0;
  }

  // ---------------------------------------------------------------- sentry

  private sentry(at: Vector3, yaw: number, seconds: number): void {
    const t = this.h.turrets.add(at, yaw, this.h.turretCtx);
    t.temporary = true;
    t.expiresT = seconds;
    t.refundRatio = 0;
    t.paid = 0;
    this.sentries.push(t);
    this.onSentry?.(t, true);
  }

  get sentryCount(): number {
    return this.sentries.length;
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.t -= dt;
      // Flicker in the last second.
      w.mesh.visibility = w.t < 1 ? 0.4 + 0.6 * Math.abs(Math.sin(w.t * 18)) : 1;
      if (w.t <= 0) {
        this.h.fx.burst('zap', w.mesh.position, 10);
        w.body?.transformNode.dispose();
        w.body?.shape?.dispose();
        w.body?.dispose();
        w.mesh.dispose();
        this.walls.splice(i, 1);
      }
    }
    if (this.decoyT > 0) {
      this.decoyT -= dt;
      const r = this.decoyRig?.root;
      if (r) {
        r.rotation.y += dt * 2.4;
        r.position.y += Math.sin(performance.now() * 0.004) * dt * 0.3;
      }
      if (this.decoyT <= 0) this.endDecoy();
    }
    for (let i = this.sentries.length - 1; i >= 0; i--) {
      const t = this.sentries[i];
      if (!this.h.turrets.turrets.includes(t)) {
        this.sentries.splice(i, 1);
        continue;
      }
      t.expiresT -= dt;
      if (t.expiresT <= 0) {
        this.h.fx.burst('build', t.head, 24);
        this.h.fx.debrisBurst(t.head, 4, 3, 0.6);
        this.onSentry?.(t, false);
        this.h.turrets.remove(t);
        this.sentries.splice(i, 1);
      }
    }
  }

  reset(): void {
    this.decoyT = 0.0001;
    this.update(1);
    for (const w of this.walls) w.t = 0;
    this.update(0);
    for (const t of this.sentries) if (this.h.turrets.turrets.includes(t)) this.h.turrets.remove(t);
    this.sentries.length = 0;
  }
}
