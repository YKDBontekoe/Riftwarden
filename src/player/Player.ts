import {
  CharacterSupportedState,
  type CharacterSurfaceInfo,
  FreeCamera,
  PhysicsCharacterController,
  type Scene,
  Vector3,
} from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { ECONOMY } from '../data/defs';
import { BASE_STATS, type CombatStats, maxHull, mitigation } from '../combat/stats';
import type { Input } from '../core/Input';
import { PHYS_PLAYER } from '../world/physicsGroups';

const DOWN = new Vector3(0, -1, 0);
const GRAVITY = new Vector3(0, -26, 0);

export const MOVE = {
  runSpeed: 11,
  sprintSpeed: 15.5,
  groundAccel: 95,
  groundDecel: 85,
  airAccel: 32,
  jumpVel: 9.6,
  boostVel: 10.2,
  dashSpeed: 31,
  dashTime: 0.16,
  dashCharges: 2,
  dashRecharge: 1.5,
  coyote: 0.1,
  capsuleHeight: 1.8,
  capsuleRadius: 0.55,
  eyeOffset: 0.55,
};

/**
 * First-person hover drone. Collision, slopes and ramps are resolved by Havok's
 * PhysicsCharacterController; this class only decides the desired velocity, which
 * keeps the feel snappy (high accel, fast stop, short dash) and frame-rate independent.
 */
export class Player {
  readonly camera: FreeCamera;
  readonly controller: PhysicsCharacterController;
  private support: CharacterSurfaceInfo;
  yaw = 0;
  pitch = 0;
  recoil = 0;
  private hv = new Vector3(); // horizontal velocity
  private vy = 0;
  grounded = false;
  private coyoteT = 0;
  private airBoost = true;
  dashCharges = MOVE.dashCharges;
  dashRecharge = 0;
  private dashT = 0;
  private dashDir = new Vector3();
  sprinting = false;
  private landDip = 0;
  private bobT = 0;
  private roll = 0;
  private fovKick = 0;
  baseFov = 1.2;
  /** Camera shake energy (0..1); shake amplitude is trauma squared. */
  trauma = 0;
  sensitivity = 1;

  hp: number = ECONOMY.playerMaxHp;
  maxHp: number = ECONOMY.playerMaxHp;
  /** Energy shield from equipment: absorbs (mitigated) damage before the hull. */
  shield = 0;
  maxShield = 0;
  private shieldRegen = 0;
  private shieldDelay = 3;
  private sinceShieldHit = 99;
  /** Fraction of incoming damage removed by armor + resistance. */
  mitigation = 0;
  private dashRechargeMult = 1;
  alive = true;
  respawnT = 0;
  private sinceHurt = 99;
  hurtFlash = 0;

  private readonly tmp = new Vector3();
  private readonly spawn: Vector3;
  private readonly spawnYaw: number;

  constructor(scene: Scene, spawn: { x: number; z: number; yaw: number }) {
    this.spawn = new Vector3(spawn.x, MOVE.capsuleHeight / 2 + 0.05, spawn.z);
    this.spawnYaw = spawn.yaw;
    this.camera = new FreeCamera('playerCam', this.spawn.clone(), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 400;
    this.camera.fov = this.baseFov;
    this.controller = new PhysicsCharacterController(this.spawn.clone(), { capsuleHeight: MOVE.capsuleHeight, capsuleRadius: MOVE.capsuleRadius }, scene);
    this.controller.maxSlopeCosine = Math.cos((50 * Math.PI) / 180);
    this.controller.keepDistance = 0.03;
    this.controller.shape.filterMembershipMask = PHYS_PLAYER;
    this.support = this.controller.checkSupport(1 / 60, DOWN);
    this.yaw = spawn.yaw;
  }

  get position(): Vector3 {
    return this.controller.getPosition();
  }
  get eye(): Vector3 {
    return this.camera.position;
  }
  forward(out = new Vector3()): Vector3 {
    this.camera.getDirectionToRef(Vector3.Forward(), out);
    return out;
  }

  reset(): void {
    this.controller.setPosition(this.spawn.clone());
    this.controller.setVelocity(Vector3.Zero());
    this.hv.setAll(0);
    this.vy = 0;
    this.yaw = this.spawnYaw;
    this.pitch = 0;
    this.recoil = 0;
    this.hp = this.maxHp;
    this.shield = this.maxShield;
    this.sinceShieldHit = 99;
    this.alive = true;
    this.respawnT = 0;
    this.dashCharges = MOVE.dashCharges;
    this.dashRecharge = 0;
    this.dashT = 0;
    this.sinceHurt = 99;
    this.hurtFlash = 0;
    this.trauma = 0;
  }

  /** Called for every hit taken; `from` is the damage source position when known. */
  onHurt: ((amount: number, from: Vector3 | null) => void) | null = null;

  /**
   * Apply equipment-derived stats. Max hull/shield changes keep current values in
   * proportion (gaining capacity never heals beyond the gain, losing it clamps).
   * `attackerScale` is the enemy level scale armor is measured against.
   */
  applyStats(stats: CombatStats = BASE_STATS, attackerScale = 1): void {
    const newMax = maxHull(ECONOMY.playerMaxHp, stats);
    if (newMax !== this.maxHp) {
      this.hp = Math.min(newMax, Math.max(0, this.hp + Math.max(0, newMax - this.maxHp)));
      if (this.alive && this.hp <= 0) this.hp = 1;
      this.maxHp = newMax;
    }
    if (stats.shieldCapacity !== this.maxShield) {
      this.shield = Math.min(stats.shieldCapacity, this.shield + Math.max(0, stats.shieldCapacity - this.maxShield));
      this.maxShield = stats.shieldCapacity;
    }
    this.shieldRegen = stats.shieldRegen;
    this.shieldDelay = stats.shieldDelay;
    this.mitigation = mitigation(stats, attackerScale);
    this.dashRechargeMult = stats.dashRechargeMult;
  }

  /** Last hit breakdown (HUD feedback / tests). */
  lastHit = { raw: 0, mitigated: 0, toShield: 0, toHull: 0 };

  damage(amount: number, from: Vector3 | null = null): void {
    if (!this.alive || amount <= 0) return;
    const raw = amount;
    amount *= 1 - this.mitigation;
    const toShield = Math.min(this.shield, amount);
    this.shield -= toShield;
    amount -= toShield;
    this.sinceShieldHit = 0;
    this.lastHit = { raw, mitigated: raw - raw * (1 - this.mitigation), toShield, toHull: amount };
    this.onHurt?.(raw, from);
    if (amount <= 0) {
      sfx.play('shieldHit', { volume: 0.7 });
      return;
    }
    this.hp -= amount;
    this.sinceHurt = 0;
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.35 + amount / 40);
    sfx.play('playerHurt', { volume: Math.min(1, 0.5 + amount / 30) });
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.respawnT = ECONOMY.playerRespawnTime;
      this.hv.setAll(0);
    }
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  knockback(dir: Vector3, strength: number): void {
    this.hv.x += dir.x * strength;
    this.hv.z += dir.z * strength;
    this.vy = Math.max(this.vy, strength * 0.3);
  }

  update(dt: number, input: Input, moveSpeedMult: number, controlsEnabled: boolean): void {
    // --- Look ---
    if (controlsEnabled) {
      const k = 0.0022 * this.sensitivity;
      this.yaw += input.mouseDx * k;
      this.pitch += input.mouseDy * k;
      this.lookDx = input.mouseDx * k;
      this.lookDy = input.mouseDy * k;
      this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));
    } else {
      this.lookDx = 0;
      this.lookDy = 0;
    }
    this.recoil *= Math.exp(-dt * 14);

    // --- Health / respawn ---
    this.sinceHurt += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.reset();
      }
    } else if (this.sinceHurt > 4 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 18 * dt);
    }
    this.sinceShieldHit += dt;
    if (this.alive && this.shield < this.maxShield && this.sinceShieldHit >= this.shieldDelay) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegen * dt);
    }

    // --- Movement intent ---
    let fx = 0;
    let fz = 0;
    const active = controlsEnabled && this.alive;
    if (active) {
      if (input.isDown('KeyW')) fz += 1;
      if (input.isDown('KeyS')) fz -= 1;
      if (input.isDown('KeyD')) fx += 1;
      if (input.isDown('KeyA')) fx -= 1;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = fx * cos + fz * sin;
    let wz = -fx * sin + fz * cos;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }

    this.controller.checkSupportToRef(dt, DOWN, this.support);
    const wasGrounded = this.grounded;
    this.grounded = this.support.supportedState === CharacterSupportedState.SUPPORTED && this.vy <= 0.01;
    if (this.grounded) {
      this.coyoteT = MOVE.coyote;
      this.airBoost = true;
      if (!wasGrounded && this.vy < -6) this.landDip = Math.min(0.22, -this.vy * 0.012);
    } else this.coyoteT -= dt;

    // Dash charges
    if (this.dashCharges < MOVE.dashCharges) {
      this.dashRecharge += (dt * this.dashRechargeMult) / MOVE.dashRecharge;
      if (this.dashRecharge >= 1) {
        this.dashCharges++;
        this.dashRecharge = this.dashCharges < MOVE.dashCharges ? this.dashRecharge - 1 : 0;
      }
    }
    if (active && input.pressed('ShiftLeft') && this.dashCharges > 0) {
      this.dashCharges--;
      this.dashT = MOVE.dashTime;
      if (wl > 0) this.dashDir.set(wx, 0, wz);
      else this.dashDir.set(sin, 0, cos);
      this.fovKick = 0.12;
      sfx.play('dash');
    }
    this.sprinting = active && input.isDown('ShiftLeft') && fz > 0 && this.dashT <= 0;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.hv.set(this.dashDir.x * MOVE.dashSpeed, 0, this.dashDir.z * MOVE.dashSpeed);
      this.vy = Math.max(this.vy, 0);
      if (this.dashT <= 0) {
        const exit = this.sprinting || input.isDown('ShiftLeft') ? MOVE.sprintSpeed : MOVE.runSpeed;
        this.hv.set(this.dashDir.x * exit, 0, this.dashDir.z * exit);
      }
    } else {
      const speed = (this.sprinting ? MOVE.sprintSpeed : MOVE.runSpeed) * moveSpeedMult;
      const tx = wx * speed;
      const tz = wz * speed;
      const accel = this.grounded ? (wl > 0 ? MOVE.groundAccel : MOVE.groundDecel) : MOVE.airAccel;
      const dx = tx - this.hv.x;
      const dz = tz - this.hv.z;
      const dl = Math.hypot(dx, dz);
      const step = accel * dt;
      if (dl <= step) this.hv.set(tx, 0, tz);
      else {
        // In the air, never decelerate actively below current speed when no input (keep momentum).
        if (!this.grounded && wl === 0) {
          /* keep momentum */
        } else {
          this.hv.x += (dx / dl) * step;
          this.hv.z += (dz / dl) * step;
        }
      }
    }

    // Vertical
    if (active && input.pressed('Space')) {
      if (this.coyoteT > 0) {
        this.vy = MOVE.jumpVel;
        this.coyoteT = 0;
        this.grounded = false;
        sfx.play('jump');
      } else if (this.airBoost) {
        this.vy = MOVE.boostVel;
        this.airBoost = false;
        sfx.play('jump', { pitch: 1.4 });
      }
    }
    if (this.dashT > 0) {
      this.vy = Math.max(0, this.vy);
    } else if (this.grounded && this.vy <= 0) {
      this.vy = -2; // keep snapped to the ground on slopes/ramps
    } else {
      this.vy += GRAVITY.y * dt;
      this.vy = Math.max(this.vy, -40);
    }

    this.tmp.set(this.hv.x, this.vy, this.hv.z);
    this.controller.setVelocity(this.tmp);
    this.controller.integrate(dt, this.support, GRAVITY);
    const v = this.controller.getVelocity();
    // Accept collision response (walls, ceilings, landings)
    this.hv.x = v.x;
    this.hv.z = v.z;
    if (this.vy > 0 && v.y < this.vy - 0.5) this.vy = v.y; // bonked a ceiling
    if (this.grounded) this.vy = Math.min(this.vy, 0);

    // Safety: never fall out of the world
    const p = this.controller.getPosition();
    if (p.y < -5) this.controller.setPosition(this.spawn.clone());

    this.updateCamera(dt, fx);
  }

  private updateCamera(dt: number, strafe: number): void {
    const p = this.controller.getPosition();
    const speed = Math.hypot(this.hv.x, this.hv.z);
    this.bobT += dt * (2 + speed * 0.35);
    const hover = Math.sin(this.bobT * 1.6) * 0.025; // gentle hover drift, not a walk bob
    this.landDip *= Math.exp(-dt * 9);
    const deadDrop = this.alive ? 0 : -0.9;
    this.camera.position.set(p.x, p.y + MOVE.eyeOffset + hover - this.landDip + deadDrop, p.z);
    const targetRoll = -strafe * 0.012 * Math.min(1, speed / MOVE.runSpeed);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 10);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    const t = performance.now() * 0.001;
    const sp = sh * 0.035 * (Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3) * 0.6);
    const sy = sh * 0.035 * (Math.sin(t * 31.3 + 2.1) + Math.sin(t * 19.9) * 0.6);
    const sr = sh * 0.05 * Math.sin(t * 27.7 + 0.7);
    this.camera.rotation.set(this.pitch - this.recoil + sp, this.yaw + sy, (this.alive ? this.roll : 0.25) + sr);
    this.fovKick *= Math.exp(-dt * 8);
    const sprintFov = this.sprinting ? 0.05 : 0;
    this.camera.fov += (this.baseFov + this.fovKick + sprintFov - this.camera.fov) * Math.min(1, dt * 12);
  }

  /** Vertical velocity (m/s), for viewmodel jump/landing response. */
  get verticalSpeed(): number {
    return this.vy;
  }
  /** Look deltas applied this frame (radians), for weapon sway. */
  lookDx = 0;
  lookDy = 0;

  get dashing(): boolean {
    return this.dashT > 0;
  }
  get speed(): number {
    return Math.hypot(this.hv.x, this.hv.z);
  }
}
