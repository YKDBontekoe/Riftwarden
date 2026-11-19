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
const GRAVITY = new Vector3(0, -30, 0);

/**
 * Arena movement. Fast and momentum based: dashes and boosts carry their speed (it bleeds off slowly while the
 * player keeps pushing roughly the same way, `overspeedDecel` on the ground, `airDrag` in the air), so dash ->
 * jump -> boost chains keep the drone flying. Letting go of the keys still stops quickly (`groundDecel`).
 */
export const MOVE = {
  runSpeed: 16.5,
  sprintSpeed: 24,
  groundAccel: 175,
  groundDecel: 130,
  airAccel: 85,
  jumpVel: 11.6,
  boostVel: 13.2,
  boostSpeed: 28,
  dashSpeed: 50,
  dashCarrySpeed: 31,
  dashTime: 0.17,
  dashCharges: 2,
  dashRecharge: 0.85,
  /** Bleed rate (m/s^2) of speed above the run/sprint target while grounded and pushing along the velocity. */
  overspeedDecel: 26,
  /** Same, airborne (steer only, keep the fling). */
  airDrag: 6,
  /** Steering rate of carried momentum toward the input direction (1/s), ground / air. */
  steerGround: 9,
  steerAir: 5,
  /** Fraction of a dash charge refunded per kill (aggression keeps the drone mobile). */
  killDashRefund: 0.3,
  /** Camera drop during a grounded dash (slide), metres. */
  slideDip: 0.32,
  coyote: 0.12,
  jumpBuffer: 0.12,
  strafeRoll: 0.045,
  sprintFov: 0.09,
  dashFov: 0.16,
  boostFov: 0.07,
  /** Extra FOV at full carried overspeed (sense of speed). */
  speedFov: 0.08,
};

export const HQ_MOVE: typeof MOVE = {
  ...MOVE,
  runSpeed: 11,
  sprintSpeed: 15.5,
  groundAccel: 95,
  groundDecel: 85,
  airAccel: 32,
  jumpVel: 10.2,
  boostVel: 10.8,
  boostSpeed: 0,
  dashSpeed: 31,
  dashCarrySpeed: 15.5,
  dashTime: 0.16,
  dashRecharge: 1.5,
  overspeedDecel: 80,
  airDrag: 24,
  killDashRefund: 0,
  slideDip: 0.12,
  strafeRoll: 0.012,
  sprintFov: 0.05,
  dashFov: 0.12,
  boostFov: 0,
  speedFov: 0,
};

const CAPSULE_HEIGHT = 1.8;
const CAPSULE_RADIUS = 0.55;
const EYE_OFFSET = 0.55;

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
  private jumpBufferT = 0;
  private airBoost = true;
  dashCharges: number;
  dashRecharge = 0;
  private dashT = 0;
  /** Set when a dash starts (consumed by the game to emit the dash event). */
  dashedThisFrame = false;
  private dashDir = new Vector3();
  sprinting = false;
  private landDip = 0;
  private slide = 0;
  private bobT = 0;
  private roll = 0;
  private fovKick = 0;
  baseFov = 1.2;
  /** Camera shake energy (0..1); shake amplitude is trauma squared. */
  trauma = 0;
  sensitivity = 1;
  /** M7 accessibility: no FOV kicks, roll or camera shake. */
  reduceMotion = false;
  /** M7: camera shake multiplier (settings). */
  shakeScale = 1;

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

  constructor(scene: Scene, spawn: { x: number; z: number; yaw: number }, private readonly move = MOVE) {
    this.spawn = new Vector3(spawn.x, CAPSULE_HEIGHT / 2 + 0.05, spawn.z);
    this.spawnYaw = spawn.yaw;
    this.camera = new FreeCamera('playerCam', this.spawn.clone(), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 400;
    this.camera.fov = this.baseFov;
    this.controller = new PhysicsCharacterController(this.spawn.clone(), { capsuleHeight: CAPSULE_HEIGHT, capsuleRadius: CAPSULE_RADIUS }, scene);
    this.controller.maxSlopeCosine = Math.cos((50 * Math.PI) / 180);
    this.controller.keepDistance = 0.03;
    this.controller.shape.filterMembershipMask = PHYS_PLAYER;
    this.support = this.controller.checkSupport(1 / 60, DOWN);
    this.yaw = spawn.yaw;
    this.dashCharges = move.dashCharges;
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
    this.grounded = false;
    this.coyoteT = 0;
    this.jumpBufferT = 0;
    this.airBoost = true;
    this.dashCharges = this.move.dashCharges;
    this.dashRecharge = 0;
    this.dashT = 0;
    this.sprinting = false;
    this.landDip = 0;
    this.slide = 0;
    this.roll = 0;
    this.fovKick = 0;
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
      this.dashT = 0;
      this.jumpBufferT = 0;
    }
  }

  /**
   * M7: health regeneration, shield recharge and respawn. Runs inside `update` for a local drone;
   * co-op replicas set `vitalsLocal = false` (the server owns vitals) and the server ticks remote bodies.
   */
  vitalsLocal = true;
  tickVitals(dt: number): void {
    this.sinceHurt += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.reset();
        this.respawns++;
      }
    } else if (this.sinceHurt > 4 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 18 * dt);
    }
    this.sinceShieldHit += dt;
    if (this.alive && this.shield < this.maxShield && this.sinceShieldHit >= this.shieldDelay) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegen * dt);
    }
  }
  /** Number of respawns (co-op: replicas reset their drone when this changes). */
  respawns = 0;
  /** Kill chain: consecutive kills within a short window (Game.playerKill) and the run time of the last one. */
  chain = 0;
  chainAt = -99;

  /** M7 replicas: adopt server vitals. */
  setVitals(hp: number, maxHp: number, shield: number, maxShield: number, alive: boolean, respawnT: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
    this.shield = shield;
    this.maxShield = maxShield;
    if (this.alive && !alive) {
      this.hv.setAll(0);
      this.dashT = 0;
    }
    this.alive = alive;
    this.respawnT = respawnT;
  }

  /** M7 replicas: feedback for a hit the server applied. */
  feelHit(amount: number, toHull: boolean, from: Vector3 | null): void {
    this.onHurt?.(amount, from);
    if (!toHull) {
      sfx.play('shieldHit', { volume: 0.7 });
      return;
    }
    this.sinceHurt = 0;
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.35 + amount / 40);
    sfx.play('playerHurt', { volume: Math.min(1, 0.5 + amount / 30) });
  }

  addTrauma(amount: number): void {
    if (this.reduceMotion) return;
    this.trauma = Math.min(1, this.trauma + amount * this.shakeScale);
  }

  /** Refund part of a dash charge (kills). */
  refundDash(fraction: number): void {
    const max = this.move.dashCharges;
    if (!(fraction > 0) || this.dashCharges >= max) return;
    this.dashRecharge += fraction;
    while (this.dashRecharge >= 1 && this.dashCharges < max) {
      this.dashCharges++;
      this.dashRecharge -= 1;
    }
    if (this.dashCharges >= max) this.dashRecharge = 0;
  }

  knockback(dir: Vector3, strength: number): void {
    this.hv.x += dir.x * strength;
    this.hv.z += dir.z * strength;
    this.vy = Math.max(this.vy, strength * 0.3);
  }

  update(dt: number, input: Input, moveSpeedMult: number, controlsEnabled: boolean): void {
    const move = this.move;
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
    if (this.vitalsLocal) this.tickVitals(dt);
    else this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);

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
      this.coyoteT = move.coyote;
      this.airBoost = true;
      if (!wasGrounded && this.vy < -6) this.landDip = Math.min(0.22, -this.vy * 0.012);
    } else this.coyoteT -= dt;

    // Dash charges
    const shiftHeld = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const shiftPressed = input.pressed('ShiftLeft') || input.pressed('ShiftRight');
    if (this.dashCharges < move.dashCharges) {
      this.dashRecharge += (dt * this.dashRechargeMult) / move.dashRecharge;
      if (this.dashRecharge >= 1) {
        this.dashCharges++;
        this.dashRecharge = this.dashCharges < move.dashCharges ? this.dashRecharge - 1 : 0;
      }
    }
    // A second jump can redirect the drone mid-dash. With no input, keep its heading.
    const jumpPressed = active && input.pressed('Space');
    this.jumpBufferT = active ? Math.max(0, this.jumpBufferT - dt) : 0;
    let redirected = false;
    if (jumpPressed || this.jumpBufferT > 0) {
      if (this.coyoteT > 0) {
        this.vy = move.jumpVel;
        this.coyoteT = 0;
        this.grounded = false;
        this.jumpBufferT = 0;
        sfx.play('jump');
      } else if (this.airBoost) {
        this.vy = move.boostVel;
        this.airBoost = false;
        this.jumpBufferT = 0;
        this.fovKick = Math.max(this.fovKick, move.boostFov);
        if (wl > 0 && move.boostSpeed > 0) {
          const speed = move.boostSpeed * moveSpeedMult;
          this.hv.set(wx * speed, 0, wz * speed);
          this.dashT = 0;
          redirected = true;
        }
        sfx.play('jump', { pitch: 1.4 });
      } else if (jumpPressed) {
        this.jumpBufferT = move.jumpBuffer;
      }
    }

    if (active && shiftPressed && this.dashCharges > 0) {
      this.dashCharges--;
      this.dashedThisFrame = true;
      this.dashT = move.dashTime;
      if (wl > 0) this.dashDir.set(wx, 0, wz);
      else this.dashDir.set(sin, 0, cos);
      this.fovKick = move.dashFov;
      sfx.play('dash');
    }
    this.sprinting = active && shiftHeld && fz > 0 && this.dashT <= 0;
    const dashDt = Math.min(dt, this.dashT);
    if (dashDt > 0) {
      this.dashT -= dashDt;
      // Blend the last partial frame into carry speed so a low frame rate cannot extend the dash.
      const speed = move.dashCarrySpeed + (move.dashSpeed - move.dashCarrySpeed) * (dashDt / dt);
      this.hv.set(this.dashDir.x * speed, 0, this.dashDir.z * speed);
    } else if (!redirected && (this.grounded || wl > 0)) {
      const speed = (this.sprinting ? move.sprintSpeed : move.runSpeed) * moveSpeedMult;
      const cur = Math.hypot(this.hv.x, this.hv.z);
      const along = cur > 0 ? (this.hv.x * wx + this.hv.z * wz) / cur : 0;
      if (wl > 0 && cur > speed + 0.25 && along > 0.2) {
        // Carried momentum (dash, boost, knockback): steer toward the input and bleed the excess slowly.
        const keep = Math.max(speed, cur - (this.grounded ? move.overspeedDecel : move.airDrag) * dt);
        const k = 1 - Math.exp(-dt * (this.grounded ? move.steerGround : move.steerAir));
        let nx = this.hv.x / cur + (wx - this.hv.x / cur) * k;
        let nz = this.hv.z / cur + (wz - this.hv.z / cur) * k;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        this.hv.x = nx * keep;
        this.hv.z = nz * keep;
      } else {
        const dx = wx * speed - this.hv.x;
        const dz = wz * speed - this.hv.z;
        const accel = this.grounded ? (wl > 0 ? move.groundAccel : move.groundDecel) : move.airAccel;
        const change = Math.hypot(dx, dz);
        const fraction = change > 0 ? Math.min(1, (accel * dt) / change) : 0;
        this.hv.x += dx * fraction;
        this.hv.z += dz * fraction;
      }
    }

    if (this.grounded && this.vy <= 0) {
      this.vy = -2; // keep snapped to the ground on slopes/ramps
    } else {
      if (dashDt > 0) this.vy = Math.max(0, this.vy);
      this.vy = Math.max(-40, this.vy + GRAVITY.y * dt);
    }

    this.tmp.set(this.hv.x, this.vy, this.hv.z);
    this.controller.setVelocity(this.tmp);
    this.controller.integrate(dt, this.support, GRAVITY);
    const v = this.controller.getVelocity();
    // Accept collision response (walls, ceilings, landings)
    this.hv.x = v.x;
    this.hv.z = v.z;
    if (dashDt > 0 && this.dashT === 0) {
      const speed = this.speed;
      if (speed > move.dashCarrySpeed) this.hv.scaleInPlace(move.dashCarrySpeed / speed);
    }
    if (this.vy > 0 && v.y < this.vy - 0.5) this.vy = v.y; // bonked a ceiling
    if (this.grounded) this.vy = Math.min(this.vy, 0);

    // Safety: never fall out of the world
    const p = this.controller.getPosition();
    if (p.y < -5) this.controller.setPosition(this.spawn.clone());

    this.updateCamera(dt, this.hv.x * cos - this.hv.z * sin);
  }

  private updateCamera(dt: number, strafe: number): void {
    const p = this.controller.getPosition();
    const speed = Math.hypot(this.hv.x, this.hv.z);
    this.bobT += dt * (2 + speed * 0.35);
    const hover = Math.sin(this.bobT * 1.6) * 0.025; // gentle hover drift, not a walk bob
    this.landDip *= Math.exp(-dt * 9);
    // Grounded dash = slide: the eye drops while it lasts and eases back up as the momentum bleeds.
    const sliding = this.dashT > 0 && this.grounded;
    this.slide += ((sliding ? this.move.slideDip : 0) - this.slide) * (1 - Math.exp(-dt * (sliding ? 30 : 9)));
    const deadDrop = this.alive ? 0 : -0.9;
    this.camera.position.set(p.x, p.y + EYE_OFFSET + hover - this.landDip - this.slide + deadDrop, p.z);
    const targetRoll = -this.move.strafeRoll * Math.max(-1, Math.min(1, strafe / this.move.runSpeed));
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 12));
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    const t = performance.now() * 0.001;
    const sp = sh * 0.035 * (Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3) * 0.6);
    const sy = sh * 0.035 * (Math.sin(t * 31.3 + 2.1) + Math.sin(t * 19.9) * 0.6);
    const sr = sh * 0.05 * Math.sin(t * 27.7 + 0.7);
    this.camera.rotation.set(this.pitch - this.recoil + sp, this.yaw + sy, (this.alive ? this.roll : 0.25) + sr);
    this.fovKick *= Math.exp(-dt * 8);
    if (this.reduceMotion) {
      this.fovKick = 0;
      this.roll = 0;
    }
    const sprintFov = this.sprinting ? this.move.sprintFov : 0;
    // Sense of speed: carried overspeed widens the view a little more.
    const over = (speed - this.move.sprintSpeed) / Math.max(1, this.move.dashCarrySpeed - this.move.sprintSpeed);
    const speedFov = this.reduceMotion ? 0 : this.move.speedFov * Math.max(0, Math.min(1, over));
    this.camera.fov += (this.baseFov + this.fovKick + sprintFov + speedFov - this.camera.fov) * (1 - Math.exp(-dt * 14));
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
