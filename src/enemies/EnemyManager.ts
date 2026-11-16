import { type Mesh, MeshBuilder, type Scene, type TransformNode, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { applyDamage, type DamageResult, type DamageType, type Health } from '../combat/damage';
import { ENEMIES, type EnemyDef, type EnemyKind } from '../data/defs';
import type { Effects } from '../fx/Effects';
import type { Player } from '../player/Player';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';
import { buildRusher, buildWalker, type DroneRig, type WalkerRig } from '../visuals/models';
import type { ArenaLayout, GateId, Vec2 } from '../world/layout';

export interface EnemyContext {
  player: Player;
  effects: Effects;
  layout: ArenaLayout;
  damageReactor(amount: number, at: Vector3): void;
  /** Line of sight against static level geometry. */
  los(a: Vector3, b: Vector3): boolean;
  /** Pan for positional audio. */
  panFor(p: Vector3): { pan: number; volume: number };
}

export interface EnemyHitboxMeta {
  enemy: Enemy;
  weak: boolean;
}

let nextId = 1;

export class Enemy implements Health {
  readonly id = nextId++;
  hp = 0;
  maxHp = 0;
  shield = 0;
  maxShield = 0;
  alive = false;
  state: 'move' | 'attack' = 'move';
  path: Vec2[] = [];
  seg = 1;
  readonly pos = new Vector3();
  yaw = 0;
  attackT = 0;
  shotT = 0;
  chargeT = 0;
  phase = Math.random() * 10;
  flinch = 0;
  stuckT = 0;
  bestDist = Infinity;
  damageMult = 1;
  /** Remaining path length to the reactor: lower = more dangerous (turret priority). */
  remaining = 0;
  shieldFlash = 0;
  shieldRegenT = 0;
  /** performance.now() of the last damage taken (drives the HUD health bar). */
  lastHit = 0;
  readonly hitboxes: Mesh[] = [];

  constructor(
    readonly def: EnemyDef,
    readonly root: TransformNode,
    readonly walker: WalkerRig | null,
    readonly drone: DroneRig | null,
  ) {}

  get kind(): EnemyKind {
    return this.def.kind;
  }
  center(out = new Vector3()): Vector3 {
    return out.set(this.pos.x, this.pos.y + this.def.bodyY, this.pos.z);
  }
}

const TMP = new Vector3();
const TMP2 = new Vector3();

export class EnemyManager {
  readonly active: Enemy[] = [];
  private pool = new Map<EnemyKind, Enemy[]>();
  private hitboxTemplate: Mesh;

  constructor(scene: Scene, private kit: Kit, private P: Palette) {
    this.hitboxTemplate = MeshBuilder.CreateSphere('hitbox', { diameter: 1, segments: 6 }, scene);
    this.hitboxTemplate.isVisible = false;
    this.hitboxTemplate.isPickable = false;
    this.hitboxTemplate.setEnabled(false);
  }

  private create(kind: EnemyKind): Enemy {
    const def = ENEMIES[kind];
    let e: Enemy;
    if (kind === 'rusher') {
      const rig = buildRusher(this.kit, this.P);
      e = new Enemy(def, rig.root, null, rig);
    } else {
      const rig = buildWalker(this.kit, this.P, kind === 'bulwark');
      e = new Enemy(def, rig.root, rig, null);
    }
    const addHit = (y: number, z: number, r: number, weak: boolean) => {
      const h = this.hitboxTemplate.clone('hb', e.root)!;
      h.setEnabled(true);
      h.isVisible = false;
      h.isPickable = true;
      h.position.set(0, y, z);
      h.scaling.setAll(r * 2);
      h.metadata = { enemy: e, weak } satisfies EnemyHitboxMeta;
      e.hitboxes.push(h);
    };
    addHit(def.bodyY, 0, def.bodyR, false);
    addHit(def.weakY, def.weakForward, def.weakR, true);
    return e;
  }

  spawn(kind: EnemyKind, gate: GateId, layout: ArenaLayout, hpMult: number, dmgMult: number): Enemy {
    const free = this.pool.get(kind);
    const e = free && free.length ? free.pop()! : this.create(kind);
    const def = e.def;
    e.maxHp = e.hp = def.hp * hpMult;
    e.maxShield = e.shield = def.shield * hpMult;
    e.damageMult = dmgMult;
    e.alive = true;
    e.state = 'move';
    e.attackT = def.attackInterval * Math.random();
    e.shotT = def.playerShotInterval * (0.5 + Math.random());
    e.chargeT = 0;
    e.flinch = 0;
    e.stuckT = 0;
    e.bestDist = Infinity;
    e.shieldFlash = 0;
    e.lastHit = 0;
    // Offset lane so groups spread out instead of single-file.
    const lateral = (Math.random() * 2 - 1) * (kind === 'bulwark' ? 0.6 : 1.3);
    e.path = offsetPath(layout.routes[gate].points, lateral);
    // Jitter spawn depth so simultaneous spawns don't overlap
    const start = e.path[0];
    const dir = { x: e.path[1].x - start.x, z: e.path[1].z - start.z };
    const back = Math.random() * 2;
    const dl = Math.hypot(dir.x, dir.z);
    e.pos.set(start.x - (dir.x / dl) * back, 0, start.z - (dir.z / dl) * back);
    e.seg = 1;
    e.yaw = Math.atan2(dir.x, dir.z);
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
    e.root.setEnabled(true);
    if (e.walker?.shield) e.walker.shield.setEnabled(e.maxShield > 0);
    e.remaining = pathLength(e.path, 1, e.pos);
    this.active.push(e);
    return e;
  }

  /** Apply damage. Returns null if the enemy was already dead. */
  damage(e: Enemy, amount: number, type: DamageType, hitPoint: Vector3, fx: Effects): DamageResult | null {
    if (!e.alive) return null;
    const res = applyDamage(e, amount, type);
    e.flinch = Math.min(1, e.flinch + (res.toHp > 0 ? 0.5 : 0.2));
    e.shieldRegenT = 4;
    e.lastHit = performance.now();
    if (res.toShield > 0) {
      e.shieldFlash = 1;
      fx.burst('shield', hitPoint, 6);
    }
    if (res.shieldBroken) {
      fx.burst('shield', e.center(TMP), 40, undefined, 2);
      sfx.play('shieldHit', { pitch: 0.6 });
      if (e.walker?.shield) e.walker.shield.setEnabled(false);
    }
    return res;
  }

  /** Remove the enemy from play with destruction effects. */
  kill(e: Enemy, fx: Effects, ctx: EnemyContext, detonated = false): void {
    if (!e.alive && !this.active.includes(e)) return;
    e.alive = false;
    const c = e.center(TMP);
    const big = e.kind === 'bulwark' ? 1.6 : e.kind === 'rusher' ? 0.8 : 1;
    fx.explode(c, { scale: detonated ? big * 1.25 : big, debris: e.kind === 'rusher' ? 6 : e.kind === 'bulwark' ? 18 : 12 });
    const a = ctx.panFor(c);
    sfx.play('explosion', { volume: a.volume * (detonated ? 1 : 0.8), pan: a.pan, pitch: e.kind === 'rusher' ? 1.4 : e.kind === 'bulwark' ? 0.75 : 1 });
    this.release(e);
  }

  private release(e: Enemy): void {
    e.alive = false;
    e.root.setEnabled(false);
    const i = this.active.indexOf(e);
    if (i >= 0) this.active.splice(i, 1);
    if (!this.pool.has(e.kind)) this.pool.set(e.kind, []);
    this.pool.get(e.kind)!.push(e);
  }

  clear(): void {
    for (const e of [...this.active]) this.release(e);
  }

  update(hdt: number, ctx: EnemyContext): void {
    if (hdt <= 0) return;
    const player = ctx.player;
    const ppos = player.position;
    // Separation (n is small; O(n^2) is cheaper than a spatial structure here)
    const list = this.active;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = a.def.radius + b.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.5 * Math.min(1, hdt * 8);
          a.pos.x -= dx * push;
          a.pos.z -= dz * push;
          b.pos.x += dx * push;
          b.pos.z += dz * push;
        }
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.alive) continue;
      const def = e.def;
      e.flinch = Math.max(0, e.flinch - hdt * 4);
      e.shieldFlash = Math.max(0, e.shieldFlash - hdt * 5);
      if (e.maxShield > 0) {
        e.shieldRegenT -= hdt;
        if (e.shieldRegenT <= 0 && e.shield < e.maxShield) {
          if (e.shield <= 0 && e.walker?.shield) e.walker.shield.setEnabled(true);
          e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.25 * hdt);
        }
      }

      const slow = 1 - e.flinch * 0.5;
      if (e.state === 'move') {
        const target = e.path[e.seg];
        const dx = target.x - e.pos.x;
        const dz = target.z - e.pos.z;
        const dist = Math.hypot(dx, dz);
        const step = def.speed * slow * hdt;
        if (dist <= step + 0.05) {
          e.pos.x = target.x;
          e.pos.z = target.z;
          e.seg++;
          e.bestDist = Infinity;
          e.stuckT = 0;
          if (e.seg >= e.path.length) {
            if (e.kind === 'rusher') {
              ctx.damageReactor(def.reactorDamage * e.damageMult, e.center(TMP2));
              this.kill(e, ctx.effects, ctx, true);
              continue;
            }
            e.state = 'attack';
          }
        } else {
          e.pos.x += (dx / dist) * step;
          e.pos.z += (dz / dist) * step;
          const desiredYaw = Math.atan2(dx, dz);
          e.yaw = turnTowards(e.yaw, desiredYaw, hdt * (e.kind === 'rusher' ? 10 : 5));
          // Stuck watchdog: if no progress for 5 s, snap to the waypoint.
          if (dist < e.bestDist - 0.1) {
            e.bestDist = dist;
            e.stuckT = 0;
          } else {
            e.stuckT += hdt;
            if (e.stuckT > 5) {
              e.pos.x = target.x;
              e.pos.z = target.z;
              e.stuckT = 0;
            }
          }
        }
        e.remaining = pathLength(e.path, e.seg, e.pos);

        // Rush drones detonate on the player.
        if (e.kind === 'rusher' && player.alive) {
          const c = e.center(TMP);
          if (Vector3.DistanceSquared(c, ppos) < 2.3 * 2.3) {
            player.damage(def.playerDamage * e.damageMult, e.pos);
            TMP2.copyFrom(ppos).subtractInPlace(c).normalize();
            player.knockback(TMP2, 9);
            this.kill(e, ctx.effects, ctx, true);
            continue;
          }
        }
      } else {
        // Attack the reactor
        const desiredYaw = Math.atan2(ctx.layout.reactor.x - e.pos.x, ctx.layout.reactor.z - e.pos.z);
        e.yaw = turnTowards(e.yaw, desiredYaw, hdt * 4);
        e.attackT -= hdt;
        if (e.attackT <= 0) {
          e.attackT = def.attackInterval;
          const muzzle = this.muzzlePos(e, TMP);
          const target = TMP2.set(ctx.layout.reactor.x, 3, ctx.layout.reactor.z);
          target.subtractInPlace(muzzle).normalize().scaleInPlace(2.2).addInPlace(muzzle);
          ctx.effects.tracer(muzzle, target.set(ctx.layout.reactor.x, 3 + Math.random(), ctx.layout.reactor.z), 2, 0.12, 0.12);
          ctx.effects.burst('enemySpark', target, 8);
          ctx.damageReactor(def.reactorDamage * e.damageMult, target);
          const a = ctx.panFor(muzzle);
          sfx.play('enemyShot', { volume: a.volume * 0.6, pan: a.pan });
        }
      }

      // Walkers fire telegraphed plasma bolts at the player when they have line of sight.
      if (e.walker && player.alive && def.playerShotInterval > 0) {
        if (e.chargeT > 0) {
          e.chargeT -= hdt;
          if (e.chargeT <= 0) {
            const muzzle = this.muzzlePos(e, TMP);
            const aim = TMP2.copyFrom(player.eye);
            aim.y -= 0.35;
            aim.subtractInPlace(muzzle).normalize().scaleInPlace(e.kind === 'bulwark' ? 24 : 21);
            ctx.effects.spawnProjectile(muzzle, aim, def.playerDamage * e.damageMult);
            const a = ctx.panFor(muzzle);
            sfx.play('enemyShot', { volume: a.volume, pan: a.pan });
          }
        } else {
          e.shotT -= hdt;
          if (e.shotT <= 0) {
            e.shotT = def.playerShotInterval * (0.8 + Math.random() * 0.4);
            const c = e.center(TMP);
            const d2 = Vector3.DistanceSquared(c, ppos);
            if (d2 < def.playerShotRange * def.playerShotRange && ctx.los(c, player.eye)) e.chargeT = 0.55;
          }
        }
      }

      this.animate(e, hdt, ppos);
    }
  }

  private muzzlePos(e: Enemy, out: Vector3): Vector3 {
    if (e.walker) {
      e.walker.muzzleGlow.computeWorldMatrix(true);
      return out.copyFrom(e.walker.muzzleGlow.getAbsolutePosition());
    }
    return e.center(out);
  }

  private animate(e: Enemy, hdt: number, ppos: Vector3): void {
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
    e.phase += hdt;
    if (e.walker) {
      const w = e.walker;
      const moving = e.state === 'move';
      const cadence = e.kind === 'bulwark' ? 5 : 6.5;
      const t = e.phase * cadence;
      const sw = moving ? Math.sin(t) * 0.55 : 0;
      w.thighL.rotation.x = sw;
      w.thighR.rotation.x = -sw;
      w.kneeL.rotation.x = moving ? Math.max(0, -Math.sin(t)) * 0.8 + 0.1 : 0.1;
      w.kneeR.rotation.x = moving ? Math.max(0, Math.sin(t)) * 0.8 + 0.1 : 0.1;
      w.hips.position.y = 1.35 + (moving ? Math.abs(Math.cos(t)) * 0.07 : 0);
      w.torso.rotation.z = moving ? Math.sin(t) * 0.04 : 0;
      w.torso.rotation.x = e.flinch * -0.35 + (moving ? 0.08 : 0.15);
      // Track the player with the head when close
      const dx = ppos.x - e.pos.x;
      const dz = ppos.z - e.pos.z;
      const look = Math.atan2(dx, dz) - e.yaw;
      w.head.rotation.y = clampAngle(look, 0.7);
      const charge = e.chargeT > 0 ? 1 + (0.55 - e.chargeT) * 3.5 : 1;
      w.muzzleGlow.scaling.setAll(0.3 * charge);
      w.cannon.rotation.x = e.state === 'attack' ? 0.25 : e.chargeT > 0 ? -0.1 : 0;
      if (w.shield) {
        const s = e.shieldFlash;
        w.shield.scaling.set(3.6 + s * 0.3, 3.9 + s * 0.3, 3.6 + s * 0.3);
        w.shield.visibility = 0.55 + s * 0.45;
      }
    } else if (e.drone) {
      const d = e.drone;
      d.body.position.y = 1.3 + Math.sin(e.phase * 7) * 0.12;
      d.body.position.x = Math.sin(e.phase * 3.1) * 0.35;
      d.body.rotation.z = Math.cos(e.phase * 3.1) * -0.35 + e.flinch * 0.6;
      d.body.rotation.x = 0.18 + e.flinch * -0.5;
      d.ring.rotation.y = e.phase * 12;
    }
  }

  /** For HUD/debug: counts by kind. */
  get count(): number {
    return this.active.length;
  }
}

function turnTowards(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

function clampAngle(a: number, lim: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.max(-lim, Math.min(lim, a));
}

function offsetPath(pts: Vec2[], lateral: number): Vec2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // The final point stays closer to the lane end so walkers ring the reactor.
    const k = i === pts.length - 1 ? 1.4 : 1;
    return { x: p.x + (dz / l) * lateral * k, z: p.z - (dx / l) * lateral * k };
  });
}

function pathLength(path: Vec2[], seg: number, pos: Vector3): number {
  if (seg >= path.length) return 0;
  let len = Math.hypot(path[seg].x - pos.x, path[seg].z - pos.z);
  for (let i = seg; i < path.length - 1; i++) len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
  return len;
}

