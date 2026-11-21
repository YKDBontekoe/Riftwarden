import { Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import {
  canPound,
  canSlide,
  grappleOver,
  grappleStep,
  KIT,
  type MoveState,
  type PoundBlast,
  poundBlast,
  slideEntry,
  slideOver,
  slideStep,
  wallGravity,
  wallJump,
  wallRollFor,
  wallRunnable,
  wallRunVelocity,
} from '@riftwarden/rules/player/movement';

/** A level hit from a probe ray. */
export interface ProbeHit {
  point: Vector3;
  normal: Vector3;
}

/** The parts of the drone body the kit drives (Player implements it). */
export interface KitBody {
  /** Horizontal velocity (mutated in place). */
  readonly hv: Vector3;
  vy: number;
  airBoost: boolean;
  dashT: number;
  readonly yaw: number;
  readonly position: Vector3;
  readonly eye: Vector3;
  readonly capsuleRadius: number;
  /** Ground normal of the current support (Havok). */
  readonly groundNormal: Vector3;
  forward(out?: Vector3): Vector3;
  /** First level hit on the segment a -> b (static geometry only), or null. */
  probe(a: Vector3, b: Vector3): ProbeHit | null;
}

/** A finished ground pound (consumed by the arena: blast + effects). */
export interface PoundLanding {
  at: Vector3;
  fall: number;
  blast: PoundBlast;
}

const A = new Vector3();
const B = new Vector3();
const F = new Vector3();
const G = 30;

/**
 * Slide / wall-run / grapple / ground pound state machine for the arena drone. Rules (speeds, timings, blast
 * size) are in `movement.ts`; this class keeps the state, runs the collision probes and tells `Player` which
 * velocity components it owns this frame.
 */
export class MoveKit {
  state: MoveState = '';
  private t = 0;
  airTime = 0;
  slideCd = 0;
  grappleCd = 0;
  /** Cooldown the last grapple attempt set (HUD fill). */
  grappleCdMax = KIT.grappleCooldown;
  poundCd = 0;
  readonly wallN = new Vector3();
  private lastWall = new Vector3();
  private wallRepeat = 0;
  readonly anchor = new Vector3();
  private poundY = 0;
  /** Set on the frame a pound lands (the game consumes and clears it). */
  landed: PoundLanding | null = null;
  /** Fired grapple this frame: 'hook' | 'miss' (game feedback), cleared by the game. */
  grappleEvent: 'hook' | 'miss' | null = null;
  /** Blast power multiplier (stats). */
  powerMult = 1;

  constructor(private readonly b: KitBody) {}

  get grappling(): boolean {
    return this.state === 'grapple';
  }

  reset(): void {
    this.state = '';
    this.t = 0;
    this.airTime = 0;
    this.slideCd = this.grappleCd = this.poundCd = 0;
    this.wallRepeat = 0;
    this.landed = null;
    this.grappleEvent = null;
  }

  /** Any kit state ends (dash, death). */
  cancel(): void {
    if (this.state === 'grapple') this.grappleCd = this.grappleCdMax = KIT.grappleCooldown;
    if (this.state === 'wall') this.leaveWall();
    this.state = '';
    this.t = 0;
  }

  /** Timers and landing detection, once per frame after the support check. */
  tick(dt: number, grounded: boolean): void {
    this.slideCd = Math.max(0, this.slideCd - dt);
    this.grappleCd = Math.max(0, this.grappleCd - dt);
    this.poundCd = Math.max(0, this.poundCd - dt);
    this.wallRepeat = Math.max(0, this.wallRepeat - dt);
    this.airTime = grounded ? 0 : this.airTime + dt;
    if (this.state) this.t += dt;
    if (this.state === 'pound' && (grounded || this.t > 3)) {
      const p = this.b.position;
      const fall = Math.max(0, this.poundY - p.y);
      this.landed = { at: p.clone(), fall, blast: poundBlast(fall, this.powerMult) };
      this.state = '';
      this.poundCd = KIT.poundCooldown;
      sfx.play('slam', { volume: Math.min(1, 0.6 + fall * 0.03) });
    }
    if (this.state === 'wall' && grounded) this.endWall();
  }

  /** Fire the grapple along the view. Returns what happened (the game decides when it may be called). */
  fireGrapple(): 'hook' | 'miss' | 'cooldown' | 'release' {
    if (this.state === 'grapple') {
      this.endGrapple();
      return 'release';
    }
    if (this.grappleCd > 0) return 'cooldown';
    const b = this.b;
    const eye = b.eye;
    b.forward(F);
    A.copyFrom(eye);
    B.copyFrom(eye).addInPlace(F.scale(KIT.grappleRange));
    const hit = b.probe(A, B);
    if (!hit || Vector3.Distance(eye, hit.point) < KIT.grappleRelease + 1.5) {
      this.grappleCd = this.grappleCdMax = KIT.grappleMissCooldown;
      this.grappleEvent = 'miss';
      sfx.play('buildDeny', { volume: 0.5 });
      return 'miss';
    }
    if (this.state === 'wall') this.leaveWall();
    // Hang the line a little off the surface so the pull never drives the capsule into it.
    this.anchor.copyFrom(hit.point).addInPlace(hit.normal.scale(0.6));
    this.state = 'grapple';
    this.t = 0;
    b.dashT = 0;
    b.airBoost = true;
    if (b.vy < 4) b.vy = 4;
    this.grappleEvent = 'hook';
    sfx.play('dash', { pitch: 0.7, volume: 0.8 });
    return 'hook';
  }

  /**
   * Input step, before the regular jump/dash logic. `wx/wz` is the input direction (unit or zero).
   * Returns true when the kit consumed the jump press.
   */
  input(active: boolean, grounded: boolean, ctrlPressed: boolean, ctrlHeld: boolean, jumpPressed: boolean, wx: number, wz: number, mult: number): boolean {
    const b = this.b;
    if (!active) {
      if (this.state === 'slide' || this.state === 'wall') this.cancel();
      return false;
    }
    if (jumpPressed && this.state === 'wall') {
      const [vx, vy, vz] = wallJump(b.hv.x, b.hv.z, this.wallN.x, this.wallN.z);
      b.hv.set(vx, 0, vz);
      b.vy = vy;
      b.airBoost = true;
      this.endWall();
      sfx.play('jump', { pitch: 1.2 });
      return true;
    }
    if (jumpPressed && this.state === 'grapple') {
      b.vy = Math.max(b.vy, KIT.grappleHop);
      this.endGrapple();
      sfx.play('jump', { pitch: 1.3 });
      return true;
    }
    if (ctrlPressed) {
      const speed = Math.hypot(b.hv.x, b.hv.z);
      if (this.state === 'wall') this.endWall();
      else if (this.state === '' && canSlide(grounded, speed, this.slideCd)) {
        b.forward(F);
        const [vx, vz] = slideEntry(b.hv.x, b.hv.z, F.x, F.z, mult);
        b.hv.set(vx, 0, vz);
        b.dashT = 0;
        this.state = 'slide';
        this.t = 0;
        sfx.play('dash', { pitch: 0.6, volume: 0.7 });
      } else if ((this.state === '' || this.state === 'slide') && canPound(grounded, this.airTime, this.poundCd)) {
        this.state = 'pound';
        this.t = 0;
        this.poundY = b.position.y;
        b.hv.scaleInPlace(KIT.poundCarry);
        b.dashT = 0;
        b.vy = -KIT.poundSpeed;
        sfx.play('dash', { pitch: 0.5 });
      }
    }
    if (this.state === 'slide' && slideOver(Math.hypot(b.hv.x, b.hv.z), this.t, ctrlHeld, grounded)) {
      this.state = '';
      this.slideCd = KIT.slideCooldown;
    }
    if (this.state === '' && !grounded && (wx !== 0 || wz !== 0)) this.tryWall(mult);
    else if (this.state === 'wall') this.keepWall(wx, wz);
    return false;
  }

  /** Horizontal (and for the grapple, vertical) velocity. Returns true when the kit owns it this frame. */
  velocity(dt: number, wx: number, wz: number, mult: number): boolean {
    const b = this.b;
    switch (this.state) {
      case 'slide': {
        const n = b.groundNormal;
        const [vx, vz] = slideStep(b.hv.x, b.hv.z, wx, wz, n.x, n.z, G, dt);
        b.hv.set(vx, 0, vz);
        return true;
      }
      case 'wall': {
        const [vx, vz] = wallRunVelocity(b.hv.x, b.hv.z, this.wallN.x, this.wallN.z, mult);
        // A light push into the wall keeps the capsule in contact.
        b.hv.set(vx - this.wallN.x * 1.5, 0, vz - this.wallN.z * 1.5);
        return true;
      }
      case 'grapple': {
        const p = b.position;
        const a = this.anchor;
        const [vx, vy, vz] = grappleStep(p.x, p.y, p.z, a.x, a.y, a.z, b.hv.x, b.vy, b.hv.z, dt);
        b.hv.set(vx, 0, vz);
        b.vy = vy;
        const dist = Vector3.Distance(p, a);
        // Snagged on cover: the line goes slack instead of grinding the drone against it.
        if (grappleOver(dist, this.t) || (this.t > 0.35 && Math.hypot(vx, vy, vz) < 3)) this.endGrapple();
        return true;
      }
      case 'pound':
        return true;
      default:
        return false;
    }
  }

  /** Vertical velocity. Returns true when the kit set it this frame (the regular gravity step is skipped). */
  vertical(dt: number): boolean {
    const b = this.b;
    if (this.state === 'wall') {
      b.vy = Math.max(-7, b.vy - G * wallGravity(this.t) * dt);
      return true;
    }
    if (this.state === 'pound') {
      b.vy = -KIT.poundSpeed;
      return true;
    }
    if (this.state === 'grapple') {
      b.vy -= G * dt;
      return true;
    }
    return false;
  }

  /** Camera roll target (wall-run lean). */
  roll(): number {
    return this.state === 'wall' ? wallRollFor(this.wallN.x, this.wallN.z, this.b.yaw) : 0;
  }

  // ---------------------------------------------------------------- walls

  private tryWall(mult: number): void {
    const b = this.b;
    if (this.airTime < 0.08 || b.dashT > 0) return;
    const speed = Math.hypot(b.hv.x, b.hv.z);
    if (speed < KIT.wallMinSpeed) return;
    const reach = b.capsuleRadius + KIT.wallReach;
    const p = b.position;
    const rx = Math.cos(b.yaw);
    const rz = -Math.sin(b.yaw);
    let best: ProbeHit | null = null;
    let bestD = Infinity;
    for (const s of [1, -1]) {
      A.copyFrom(p);
      B.set(p.x + rx * s * reach, p.y, p.z + rz * s * reach);
      const hit = b.probe(A, B);
      if (!hit) continue;
      const d = Math.hypot(hit.point.x - p.x, hit.point.z - p.z);
      if (d < bestD) {
        best = hit;
        bestD = d;
      }
    }
    if (!best) return;
    const n = best.normal;
    const h = Math.hypot(n.x, n.z);
    if (h < 1e-3 || !wallRunnable(n.y, n.x / h, n.z / h, b.hv.x, b.hv.z)) return;
    const nx = n.x / h;
    const nz = n.z / h;
    if (this.wallRepeat > 0 && nx * this.lastWall.x + nz * this.lastWall.z > 0.9) return;
    this.wallN.set(nx, 0, nz);
    this.state = 'wall';
    this.t = 0;
    b.vy = KIT.wallLift;
    b.airBoost = true;
    const [vx, vz] = wallRunVelocity(b.hv.x, b.hv.z, nx, nz, mult);
    b.hv.set(vx, 0, vz);
    sfx.play('dash', { pitch: 1.6, volume: 0.45 });
  }

  private keepWall(wx: number, wz: number): void {
    const b = this.b;
    if (this.t >= KIT.wallRunTime || (wx === 0 && wz === 0) || wx * this.wallN.x + wz * this.wallN.z > 0.7) {
      this.endWall();
      return;
    }
    const p = b.position;
    const reach = b.capsuleRadius + KIT.wallReach + 0.25;
    A.copyFrom(p);
    B.set(p.x - this.wallN.x * reach, p.y, p.z - this.wallN.z * reach);
    const hit = b.probe(A, B);
    const n = hit?.normal;
    const h = n ? Math.hypot(n.x, n.z) : 0;
    if (!n || h < 1e-3 || Math.abs(n.y) > KIT.wallMaxNy || (n.x * this.wallN.x + n.z * this.wallN.z) / h < 0.7) {
      this.endWall();
      return;
    }
    this.wallN.set(n.x / h, 0, n.z / h);
    if (Math.hypot(b.hv.x, b.hv.z) < 6) this.endWall();
  }

  private leaveWall(): void {
    this.lastWall.copyFrom(this.wallN);
    this.wallRepeat = KIT.wallRepeat;
  }

  private endWall(): void {
    this.leaveWall();
    this.state = '';
    this.t = 0;
  }

  private endGrapple(): void {
    this.state = '';
    this.t = 0;
    this.grappleCd = this.grappleCdMax = KIT.grappleCooldown;
  }
}
