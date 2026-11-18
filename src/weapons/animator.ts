import type { WeaponFamily } from '../data/defs';
import { heatColor } from './materials';
import type { WeaponRig } from './model';

/**
 * Viewmodel animation (presentation only; never affects hit resolution).
 *
 * Driven entirely by the dt it is given (fixed-step automation and real frames behave
 * the same) and kept separate from generation data: it reads a WeaponRig's hooks and the
 * current weapon/player state. Motion is built from damped springs so every impulse
 * (shot, dash, landing, switch) settles smoothly without ever blocking aim.
 */
export interface AnimInput {
  dt: number;
  /** Look deltas this frame (radians) for sway lag. */
  lookDx: number;
  lookDy: number;
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  dashing: boolean;
  verticalSpeed: number;
  heat: number; // 0..1
  overheated: boolean;
  /** Rail charge 0..1 (others: 0). */
  charge: number;
  /** Beam/cycle activity 0..1. */
  active: number;
  /** 1 = lowered (build mode / switching). */
  holster: number;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
}

/** Per-family recoil feel. */
const RECOIL: Record<WeaponFamily, { back: number; pitch: number; roll: number; slide: number; stiff: number; damp: number }> = {
  plasma: { back: 0.022, pitch: 0.045, roll: 0.03, slide: 0.012, stiff: 520, damp: 34 },
  rail: { back: 0.075, pitch: 0.2, roll: 0.06, slide: 0.034, stiff: 170, damp: 17 },
  beam: { back: 0.006, pitch: 0.006, roll: 0.004, slide: 0.004, stiff: 260, damp: 26 },
};

class Spring {
  x = 0;
  v = 0;
  constructor(public k: number, public c: number) {}
  step(dt: number, target = 0): number {
    // Semi-implicit Euler in sub-steps: stable for large dt (automation advances).
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-(this.x - target) * this.k - this.v * this.c) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v: number): void {
    this.v += v;
  }
}

export class WeaponAnimator {
  readonly pose: Pose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  /** M7 accessibility: damp sway and bob to a fraction. */
  reduceMotion = false;
  private t = 0;
  private back: Spring;
  private pitch: Spring;
  private roll: Spring;
  private yawS = new Spring(140, 18);
  private bobY = new Spring(160, 20);
  private slide: Spring;
  private swayX = 0;
  private swayY = 0;
  private sprint = 0;
  private hol = 0;
  private wasGrounded = true;
  private wasDashing = false;
  private lastVy = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private spinBoost = 0;
  private finOpen = 0;
  private alt = 0;
  readonly family: WeaponFamily;

  constructor(private rig: WeaponRig) {
    this.family = rig.family;
    const r = RECOIL[rig.family];
    this.back = new Spring(r.stiff, r.damp);
    this.pitch = new Spring(r.stiff, r.damp);
    this.roll = new Spring(r.stiff * 0.8, r.damp);
    this.slide = new Spring(r.stiff * 1.6, r.damp * 1.3);
  }

  /** A shot left the weapon; power scales the kick (rail partial charges, projectiles). */
  fire(power = 1, rand = Math.random): void {
    const r = RECOIL[this.family];
    const p = Math.max(0.2, Math.min(2.5, power));
    this.back.kick(r.back * 60 * p);
    this.pitch.kick(r.pitch * 60 * p * (0.85 + rand() * 0.3));
    this.roll.kick(r.roll * 60 * p * (rand() - 0.5) * 2);
    this.yawS.kick(r.roll * 25 * p * (rand() - 0.5));
    this.slide.kick(r.slide * 90 * p);
    this.spinBoost = Math.min(3, this.spinBoost + 0.6 * p);
    this.alt ^= 1;
  }

  /** Index of the muzzle the next shot leaves from (twin barrels alternate). */
  get muzzleIndex(): number {
    return this.rig.muzzles.length > 1 ? this.alt % this.rig.muzzles.length : 0;
  }

  /** Strong dip used when the weapon is swapped (model rebuilt) or recovers from overheat. */
  impulse(pitch: number, back = 0): void {
    this.pitch.kick(pitch);
    this.back.kick(back);
  }

  update(i: AnimInput): void {
    const dt = Math.max(0, Math.min(0.1, i.dt));
    this.t += dt;
    const rig = this.rig;
    const p = this.pose;

    // Drive sway from turn rate so mouse input does not kick the weapon harder on slow frames.
    const sampleTime = Math.max(dt, 0.001);
    const sx = Math.max(-0.018, Math.min(0.018, (-i.lookDx / sampleTime) * 0.0036));
    const sy = Math.max(-0.016, Math.min(0.016, (i.lookDy / sampleTime) * 0.003));
    const kSway = 1 - Math.exp(-dt * 14);
    this.swayX += (sx - this.swayX) * kSway;
    this.swayY += (sy - this.swayY) * kSway;
    const moving = i.grounded && !i.dashing ? Math.min(1, i.speed / 15) : 0;
    this.bobAmt += ((this.reduceMotion ? moving * 0.25 : moving) - this.bobAmt) * (1 - Math.exp(-dt * 10));
    // A hover drone drifts gently. Sprinting or dashing should not speed up a footstep cycle.
    this.bobPhase += dt * (3.5 + 4 * this.bobAmt);
    this.sprint += ((i.sprinting ? 1 : 0) - this.sprint) * (1 - Math.exp(-dt * 9));
    this.hol += (i.holster - this.hol) * (1 - Math.exp(-dt * 12));
    if (i.dashing && !this.wasDashing) {
      this.back.kick(0.9);
      this.roll.kick(1.6);
      this.pitch.kick(-0.8);
    }
    this.wasDashing = i.dashing;
    if (!i.grounded && this.wasGrounded && i.verticalSpeed > 1) this.bobY.kick(-0.35);
    if (i.grounded && !this.wasGrounded && this.lastVy < -4) this.bobY.kick(Math.max(-1.6, this.lastVy * 0.07));
    this.wasGrounded = i.grounded;
    this.lastVy = i.verticalSpeed;

    const back = this.back.step(dt);
    const pitch = this.pitch.step(dt);
    const roll = this.roll.step(dt);
    const yaw = this.yawS.step(dt);
    const bobY = this.bobY.step(dt);
    const slide = this.slide.step(dt);

    const bob = this.bobAmt * (1 - this.sprint * 0.3);
    const bx = Math.sin(this.bobPhase) * 0.003 * bob;
    const by = Math.cos(this.bobPhase) * 0.002 * bob;
    const oh = i.overheated ? 1 : 0;
    this.ohT += ((oh) - this.ohT) * (1 - Math.exp(-dt * 6));

    p.x = this.swayX + bx - this.sprint * 0.03 + this.ohT * 0.01;
    p.y = -this.swayY + by + bobY * 0.04 - this.sprint * 0.025 - this.hol * 0.22 - this.ohT * 0.02;
    p.z = -back * 0.03 - this.sprint * 0.02 + (this.family === 'beam' ? -i.active * 0.006 : 0);
    p.pitch = -pitch * 0.025 + this.swayY * 0.8 + this.sprint * 0.16 + this.hol * 0.7 + this.ohT * 0.06;
    p.yaw = yaw * 0.03 + this.swayX * 1.2 - this.sprint * 0.42 + this.ohT * 0.12;
    p.roll = roll * 0.04 + this.swayX * 1.4 + this.sprint * 0.22 + this.ohT * 0.32 + bx * 1.5;

    // --- mechanical parts
    rig.slide.position.z = -slide * 0.03;
    this.spinBoost = Math.max(0, this.spinBoost - dt * 2.2);
    const act = 1 + i.heat * 2 + this.spinBoost + i.active * 3 + i.charge * 4;
    for (const s of rig.spin) {
      const r = s.node.rotation;
      const d = s.rate * act * dt;
      if (s.axis === 'x') r.x += d;
      else if (s.axis === 'y') r.y += d;
      else r.z += d;
    }
    // Fins flare open with heat and stay open during overheat.
    const finTarget = Math.max(i.overheated ? 1 : 0, Math.max(0, (i.heat - 0.35) / 0.65));
    this.finOpen += (finTarget - this.finOpen) * (1 - Math.exp(-dt * 8));
    for (const f of rig.fins) f.node.rotation.x = f.max * this.finOpen;
    // Capacitors / accelerator rings travel forward with charge (or activity).
    const ch = Math.max(i.charge, this.family === 'beam' ? i.active : 0);
    for (const c of rig.charge) c.node.position.z = c.z0 + c.travel * ch;

    // --- materials: energy pulse, charge glow, heat
    const e = rig.energyBase;
    const pulse = i.overheated ? 0.35 + 0.25 * Math.sin(this.t * 18) : 1 + 0.08 * Math.sin(this.t * 4) + this.spinBoost * 0.15;
    const hot = i.heat;
    rig.energy.emissiveColor.set(e.r * pulse + hot * 1.4, e.g * pulse * (1 - hot * 0.35), e.b * pulse * (1 - hot * 0.55));
    const cg = 0.3 + ch * 1.6 + this.spinBoost * 0.25 + (this.family === 'beam' ? i.active * 0.6 : 0);
    const cgk = i.overheated ? 0.15 : cg;
    rig.chargeGlow.emissiveColor.set(e.r * cgk + hot * 0.6, e.g * cgk, e.b * cgk);
    heatColor(hot, rig.heat.emissiveColor);
    // LEDs: heat bar fills 5 segments, turns red near overheat, blinks while locked out.
    const lit = Math.ceil(hot * 5 - 0.01);
    const blink = i.overheated && Math.sin(this.t * 14) > 0;
    for (let k = 0; k < rig.leds.length; k++) {
      const on = i.overheated ? blink : k < lit;
      rig.leds[k].material = on ? (hot > 0.7 || i.overheated ? rig.ledHot : rig.ledOn) : rig.ledOff;
    }
  }
  private ohT = 0;
}
