import { type Mesh, MeshBuilder, type Scene, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { CombatStats } from '../combat/stats';
import type { Enemy } from '../enemies/EnemyManager';
import type { Effects } from '../fx/Effects';
import { BASES, composeTower, configCost, DEFAULT_CONFIG, levelCost, partDef, type TowerConfig, type TowerRunInput, type TowerStats, WEAPONS } from '../towers/components';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';
import type { TurretRig } from '../visuals/models';
import { buildTowerRig } from '../visuals/towers';

export interface TurretContext {
  enemies: readonly Enemy[];
  effects: Effects;
  stats: CombatStats;
  /** Bumped whenever run stats/upgrades change: towers recompose their numbers lazily. */
  statsVersion: number;
  los(a: Vector3, b: Vector3): boolean;
  /** Run-level inputs (stats, upgrades, empowerment) for composeTower. */
  input(t: Turret): TowerRunInput;
  /** Performs the tower's archetype attack (damage goes through the shared pipeline). `target` is null for field emitters. */
  attack(t: Turret, target: Enemy | null, mult: number): void;
  panFor(p: Vector3): { pan: number; volume: number };
}

export interface TurretHitboxMeta {
  turret: Turret;
}

const TMP = new Vector3();
let nextTowerId = 1;

/**
 * Modular tower. Separation of concerns: targeting (pickTarget), aiming (rotate yaw/pitch nodes), firing
 * (cooldown -> ctx.attack, resolved by the combat director), numbers (composeTower, lazily recomposed) and
 * presentation (rig rebuilt from the configuration).
 */
export class Turret {
  readonly id = nextTowerId++;
  building = true;
  buildT = 0;
  cooldown = 0;
  target: Enemy | null = null;
  retargetT = 0;
  barrel = 0;
  kills = 0;
  damageDealt = 0;
  attacks = 0;
  /** Cores spent so far (construction + refits + upgrades); recycling refunds a share of it. */
  paid: number;
  level = 1;
  yaw = 0;
  pitch = 0;
  scanT = Math.random() * 10;
  /** Seconds of remaining empowerment (synergy upgrades). */
  empowerT = 0;
  readonly head = new Vector3();
  hitbox: Mesh;
  st: TowerStats;
  private seenVersion = -1;
  private wasEmpowered = false;
  refundRatio = 0.75;
  buildTime = 0.8;
  /** M6: seconds the tower stays offline (artillery hits, enforcer slams, EMP). Never destroyed. */
  disabledT = 0;
  /** M6: total seconds spent suppressed (statistics). */
  suppressedFor = 0;

  /** Knock the tower offline for `seconds` (longest wins; does not stack). */
  disable(seconds: number): void {
    if (!(seconds > 0) || this.building) return;
    this.disabledT = Math.max(this.disabledT, seconds);
    this.target = null;
  }
  get disabled(): boolean {
    return this.disabledT > 0;
  }

  constructor(public config: TowerConfig, public rig: TurretRig, readonly pos: Vector3, scene: Scene, ctx: TurretContext, private rebuildRig: (cfg: TowerConfig, level: number) => TurretRig) {
    this.paid = configCost(config);
    this.st = composeTower(config, 1);
    this.recompose(ctx);
    rig.root.position.copyFrom(pos);
    this.head.set(pos.x, pos.y + 1.45 + (config.base === 'spire' ? 1.1 : 0), pos.z);
    this.hitbox = MeshBuilder.CreateCylinder('turretHit', { diameter: this.radius * 2, height: 2.2 }, scene);
    this.hitbox.position.set(pos.x, pos.y + 1.1, pos.z);
    this.hitbox.isVisible = false;
    this.hitbox.isPickable = true;
    this.hitbox.metadata = { turret: this } satisfies TurretHitboxMeta;
  }

  get radius(): number {
    return BASES[this.config.base]?.radius ?? 1.1;
  }
  get weaponName(): string {
    return WEAPONS[this.config.weapon]?.name ?? 'Tower';
  }
  get archetype(): TowerStats['archetype'] {
    return this.st.archetype;
  }
  get name(): string {
    const a = this.st.archetype;
    return a === 'arc' ? 'ARC TOWER' : a === 'cryo' ? 'CRYO FIELD PROJECTOR' : 'BALLISTIC TURRET';
  }
  get empowered(): boolean {
    return this.empowerT > 0;
  }

  /** Recompute numbers from scratch (never accumulates old bonuses). */
  recompose(ctx: TurretContext): void {
    this.st = composeTower(this.config, this.level, ctx.input(this));
    this.seenVersion = ctx.statsVersion;
    this.wasEmpowered = this.empowerT > 0;
  }

  /** Replace the configuration/level and rebuild the model. Resets cooldown/target so no stale attack state survives. */
  refit(config: TowerConfig, level: number, ctx: TurretContext): void {
    this.config = { ...config };
    this.level = level;
    const old = this.rig;
    const rig = this.rebuildRig(this.config, level);
    rig.root.position.copyFrom(old.root.position);
    rig.root.scaling.copyFrom(old.root.scaling);
    rig.yaw.rotation.y = this.yaw;
    old.root.dispose(false, false);
    this.rig = rig;
    this.head.set(this.pos.x, this.pos.y + 1.45 + (config.base === 'spire' ? 1.1 : 0), this.pos.z);
    this.target = null;
    this.barrel = 0;
    this.cooldown = Math.max(this.cooldown, 0.3);
    this.recompose(ctx);
  }

  range(): number {
    return this.st.range;
  }

  private validTarget(e: Enemy | null, range: number, ctx: TurretContext): boolean {
    if (!e || !e.alive) return false;
    const c = e.center(TMP);
    const dx = c.x - this.pos.x;
    const dz = c.z - this.pos.z;
    if (dx * dx + dz * dz > range * range) return false;
    return ctx.los(this.head, c);
  }

  pickTarget(range: number, ctx: TurretContext): Enemy | null {
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

  private anyInRange(range: number, ctx: TurretContext): boolean {
    const r2 = range * range;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /** Fire immediately regardless of cooldown/aim (network discharge, conductor link). */
  forceFire(ctx: TurretContext, mult = 1): boolean {
    if (this.building || this.disabledT > 0) return false;
    if (this.st.archetype === 'cryo') {
      if (!this.anyInRange(this.st.range, ctx)) return false;
      ctx.attack(this, null, mult);
    } else {
      const tgt = this.validTarget(this.target, this.st.range, ctx) ? this.target : this.pickTarget(this.st.range, ctx);
      if (!tgt) return false;
      this.target = tgt;
      ctx.attack(this, tgt, mult);
    }
    this.attacks++;
    this.cooldown = Math.max(this.cooldown, 0.15);
    return true;
  }

  update(dt: number, ctx: TurretContext): void {
    const r = this.rig;
    if (this.building) {
      this.buildT += dt;
      const f = Math.min(1, this.buildT / this.buildTime);
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
    if (this.empowerT > 0) this.empowerT = Math.max(0, this.empowerT - dt);
    if (this.disabledT > 0) {
      // Offline: head slumps, sparks; no targeting or firing until it reboots.
      this.disabledT = Math.max(0, this.disabledT - dt);
      this.suppressedFor += dt;
      this.pitch += (0.55 - this.pitch) * Math.min(1, dt * 6);
      r.pitch.rotation.x = this.pitch;
      r.coreGlow.scaling.setAll(0.05 + (Math.random() < 0.2 ? 0.25 : 0));
      if (Math.random() < dt * 6) ctx.effects.burst('zap', this.head, 2, undefined, 0.6);
      if (this.disabledT === 0) {
        ctx.effects.burst('build', this.head, 12);
        this.cooldown = 0.4;
      }
      return;
    }
    if (this.seenVersion !== ctx.statsVersion || this.wasEmpowered !== this.empowerT > 0) this.recompose(ctx);
    const st = this.st;
    const range = st.range;
    this.cooldown -= dt;
    const pulse = this.empowerT > 0 ? 1.4 + Math.sin(performance.now() * 0.02) * 0.3 : 1;

    if (st.archetype === 'cryo') {
      this.scanT += dt;
      this.yaw += dt * 0.9;
      r.yaw.rotation.y = this.yaw;
      if (this.cooldown <= 0 && this.anyInRange(range, ctx)) {
        this.cooldown = 1 / st.fireRate;
        this.attacks++;
        ctx.attack(this, null, 1);
      }
      r.coreGlow.scaling.setAll(0.4 * pulse + Math.sin(this.scanT * 3) * 0.05);
      return;
    }

    this.retargetT -= dt;
    if (this.retargetT <= 0) {
      this.retargetT = 0.15;
      if (!this.validTarget(this.target, range, ctx)) this.target = null;
      // Re-evaluate priority even with a valid target, so towers swap to leaking enemies.
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
      const step = st.turnRate * dt;
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

    if (aimed && this.target && this.cooldown <= 0) {
      this.cooldown = 1 / st.fireRate;
      this.attacks++;
      ctx.attack(this, this.target, 1);
    }
    r.coreGlow.scaling.y = (0.12 + (this.cooldown > 0 ? Math.min(0.3, this.cooldown * 0.15) : 0)) * (this.empowerT > 0 ? pulse : 1);
  }

  /** Next muzzle node (alternating barrels). */
  nextMuzzle(): TurretRig['muzzles'][number] {
    const m = this.rig.muzzles[this.barrel % this.rig.muzzles.length];
    this.barrel = (this.barrel + 1) % this.rig.muzzles.length;
    return m;
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
  statsVersion = 0;
  constructor(private scene: Scene, private kit: Kit, private P: Palette) {}

  build(cfg: TowerConfig, level: number, unique?: Parameters<typeof buildTowerRig>[4]): TurretRig {
    return buildTowerRig(this.kit, this.P, cfg, level, unique);
  }

  add(pos: Vector3, yaw: number, ctx: TurretContext, config: TowerConfig = DEFAULT_CONFIG): Turret {
    const cfg = { ...config };
    const rig = this.build(cfg, 1);
    const t = new Turret(cfg, rig, pos.clone(), this.scene, ctx, (c, l) => this.build(c, l));
    t.yaw = yaw;
    rig.yaw.rotation.y = yaw;
    this.turrets.push(t);
    sfx.play('build');
    return t;
  }

  byId(id: number): Turret | undefined {
    return this.turrets.find((t) => t.id === id);
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

export { levelCost, partDef };
