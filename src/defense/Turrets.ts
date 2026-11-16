import { type Mesh, MeshBuilder, type Scene, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { CombatStats } from '../combat/stats';
import { SENTINEL, type TowerDef } from '../data/defs';
import type { Enemy } from '../enemies/EnemyManager';
import type { Effects } from '../fx/Effects';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';
import { buildTurret, type TurretRig } from '../visuals/models';

export interface TurretContext {
  enemies: readonly Enemy[];
  effects: Effects;
  stats: CombatStats;
  los(a: Vector3, b: Vector3): boolean;
  /** Applies turret damage to an enemy (shared damage pipeline). */
  hitEnemy(t: Turret, e: Enemy, damage: number, point: Vector3): void;
  panFor(p: Vector3): { pan: number; volume: number };
}

export interface TurretHitboxMeta {
  turret: Turret;
}

const TMP = new Vector3();
const TMP2 = new Vector3();

/**
 * Sentinel automatic turret. Separation of concerns: targeting (pickTarget),
 * aiming (rotate yaw/pitch nodes), firing (cooldown + hit callback), presentation (rig).
 */
export class Turret {
  building = true;
  buildT = 0;
  cooldown = 0;
  target: Enemy | null = null;
  retargetT = 0;
  barrel = 0;
  kills = 0;
  damageDealt = 0;
  yaw = 0;
  pitch = 0;
  scanT = Math.random() * 10;
  readonly head = new Vector3();
  hitbox: Mesh;

  constructor(readonly def: TowerDef, readonly rig: TurretRig, readonly pos: Vector3, scene: Scene) {
    rig.root.position.copyFrom(pos);
    this.head.set(pos.x, pos.y + 1.45, pos.z);
    this.hitbox = MeshBuilder.CreateCylinder('turretHit', { diameter: def.radius * 2, height: 2.2 }, scene);
    this.hitbox.position.set(pos.x, pos.y + 1.1, pos.z);
    this.hitbox.isVisible = false;
    this.hitbox.isPickable = true;
    this.hitbox.metadata = { turret: this } satisfies TurretHitboxMeta;
  }

  range(stats: CombatStats): number {
    return this.def.range * stats.turretRangeMult;
  }

  private validTarget(e: Enemy | null, range: number, ctx: TurretContext): boolean {
    if (!e || !e.alive) return false;
    const c = e.center(TMP);
    const dx = c.x - this.pos.x;
    const dz = c.z - this.pos.z;
    if (dx * dx + dz * dz > range * range) return false;
    return ctx.los(this.head, c);
  }

  private pickTarget(range: number, ctx: TurretContext): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const c = e.center(TMP);
      const dx = c.x - this.pos.x;
      const dz = c.z - this.pos.z;
      if (dx * dx + dz * dz > range * range) continue;
      // Priority: closest to the reactor (least remaining path).
      if (e.remaining >= bestScore) continue;
      if (!ctx.los(this.head, c)) continue;
      best = e;
      bestScore = e.remaining;
    }
    return best;
  }

  update(dt: number, ctx: TurretContext): void {
    const r = this.rig;
    if (this.building) {
      this.buildT += dt;
      const f = Math.min(1, this.buildT / this.def.buildTime);
      const ease = 1 - Math.pow(1 - f, 3);
      r.root.position.y = this.pos.y - (1 - ease) * 2.3;
      r.root.scaling.setAll(0.6 + 0.4 * ease);
      if (f >= 1) {
        this.building = false;
        r.root.position.y = this.pos.y;
        r.root.scaling.setAll(1);
        ctx.effects.burst('build', this.head, 30);
      }
      return;
    }
    const range = this.range(ctx.stats);
    this.retargetT -= dt;
    if (this.retargetT <= 0) {
      this.retargetT = 0.15;
      if (!this.validTarget(this.target, range, ctx)) this.target = null;
      // Re-evaluate priority even with a valid target, so turrets swap to leaking enemies.
      const cand = this.pickTarget(range, ctx);
      if (cand) this.target = cand;
    } else if (this.target && !this.target.alive) this.target = null;

    let aimed = false;
    if (this.target) {
      const c = this.target.center(TMP);
      const dx = c.x - this.head.x;
      const dz = c.z - this.head.z;
      const dy = c.y - this.head.y;
      const desiredYaw = Math.atan2(dx, dz);
      const desiredPitch = -Math.atan2(dy, Math.hypot(dx, dz));
      const dYaw = wrap(desiredYaw - this.yaw);
      const step = this.def.turnRate * dt;
      this.yaw += Math.abs(dYaw) <= step ? dYaw : Math.sign(dYaw) * step;
      this.pitch += (desiredPitch - this.pitch) * Math.min(1, dt * 10);
      aimed = Math.abs(wrap(desiredYaw - this.yaw)) < 0.14;
    } else {
      this.scanT += dt;
      this.yaw += Math.sin(this.scanT * 0.6) * dt * 0.6;
      this.pitch += (0 - this.pitch) * Math.min(1, dt * 3);
    }
    r.yaw.rotation.y = this.yaw;
    r.pitch.rotation.x = this.pitch;

    this.cooldown -= dt;
    if (aimed && this.target && this.cooldown <= 0) {
      this.cooldown = 1 / (this.def.fireRate * ctx.stats.turretFireRateMult);
      const m = r.muzzles[this.barrel];
      this.barrel = (this.barrel + 1) % r.muzzles.length;
      m.computeWorldMatrix(true);
      const from = TMP2.copyFrom(m.getAbsolutePosition());
      const to = this.target.center(TMP);
      to.y += (Math.random() - 0.5) * 0.4;
      ctx.effects.tracer(from, to, 1, 0.07, 0.08);
      ctx.effects.burst('impact', from, 3);
      ctx.effects.burst('spark', to, 5);
      const a = ctx.panFor(from);
      sfx.play('turretShot', { volume: a.volume * 0.7, pan: a.pan });
      ctx.hitEnemy(this, this.target, this.def.damage * ctx.stats.turretDamageMult, to);
    }
    // core pulse
    r.coreGlow.scaling.y = 0.12 + (this.cooldown > 0 ? this.cooldown * 0.15 : 0);
  }

  dispose(): void {
    this.rig.root.dispose(false, false);
    this.hitbox.dispose();
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class TurretManager {
  readonly turrets: Turret[] = [];
  constructor(private scene: Scene, private kit: Kit, private P: Palette) {}

  add(pos: Vector3, yaw: number): Turret {
    const rig = buildTurret(this.kit, this.P);
    const t = new Turret(SENTINEL, rig, pos.clone(), this.scene);
    t.yaw = yaw;
    rig.yaw.rotation.y = yaw;
    this.turrets.push(t);
    sfx.play('build');
    return t;
  }

  remove(t: Turret): void {
    const i = this.turrets.indexOf(t);
    if (i >= 0) this.turrets.splice(i, 1);
    t.dispose();
  }

  clear(): void {
    for (const t of this.turrets) t.dispose();
    this.turrets.length = 0;
  }

  update(dt: number, ctx: TurretContext): void {
    for (const t of this.turrets) t.update(dt, ctx);
  }
}
