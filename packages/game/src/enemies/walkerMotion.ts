import { Quaternion, Vector3 } from '@babylonjs/core';
import { WALKER_SHIN, WALKER_THIGH, type WalkerRig } from '../visuals/models';

interface Foot {
  side: number;
  ground: Vector3;
  from: Vector3;
  to: Vector3;
  phase: number;
}

const direction = new Vector3();
const knee = new Vector3();
const shin = new Vector3();
const inverse = new Quaternion();
const down = new Vector3(0, -1, 0);
const ankleHeight = 0.075;

function foot(side: number): Foot {
  return { side, ground: new Vector3(), from: new Vector3(), to: new Vector3(), phase: 1 };
}

/** Presentation-only stance targets. A foot stays in world space until its next swing. */
export class WalkerMotion {
  private feet = [foot(-1), foot(1)];
  private previous = new Vector3();
  private yaw = 0;
  private lean = 0;
  private shotAge = 1;

  constructor(private rig: WalkerRig, private scale: number) {}

  reset(position: Vector3, yaw: number): void {
    this.crawlT = 0;
    this.previous.copyFrom(position);
    this.yaw = yaw;
    this.lean = 0;
    this.shotAge = 1;
    for (const f of this.feet) {
      this.place(f.ground, position, Math.sin(yaw), Math.cos(yaw), f.side, 0.08 + f.side * 0.17);
      f.phase = 1;
    }
    this.pose(position, yaw, 0, false, 0, 0, 0);
  }

  fire(): void {
    this.shotAge = 0;
  }

  /** Returns a planted foot this frame, for contact effects. */
  /** One leg shot off: the frame drops low, pitches forward and leans onto the lost side. */
  crawl = false;
  private crawlT = 0;

  pose(position: Vector3, yaw: number, dt: number, moving: boolean, charge: number, flinch: number, aimPitch: number): Vector3 | null {
    const { hips, torso, cannon, barrel, muzzleGlow } = this.rig;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const advance = Math.hypot(position.x - this.previous.x, position.z - this.previous.z);
    if (advance > 2.4 * this.scale) {
      this.reset(position, yaw);
      return null;
    }
    const deltaYaw = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    const turn = Math.max(-0.16, Math.min(0.16, deltaYaw * 2.4));
    this.lean += (turn - this.lean) * Math.min(1, dt * 11);
    this.yaw = yaw;
    this.previous.copyFrom(position);

    // Faster striders take quicker, longer steps (the swing shortens with ground speed) so feet never skate.
    const groundSpeed = advance / Math.max(dt, 0.001);
    const cadence = Math.max(0.6, Math.min(1, 4.2 / Math.max(0.1, groundSpeed / this.scale)));
    const swingSeconds = moving ? (0.17 + (this.scale - 1) * 0.15) * cadence : 0.19;
    const lead = moving ? Math.max(0.34, Math.min(0.82, groundSpeed * 0.126 / this.scale)) : 0.08;
    let planted: Vector3 | null = null;
    let swinging = false;
    let candidate: Foot | null = null;
    let largestOffset = (moving ? 0.53 : 0.34) * this.scale;

    for (const f of this.feet) {
      if (f.phase < 1) {
        f.phase = Math.min(1, f.phase + dt / swingSeconds);
        const p = f.phase;
        Vector3.LerpToRef(f.from, f.to, p * p * (3 - 2 * p), f.ground);
        if (p === 1) planted = f.ground;
        else swinging = true;
      } else {
        this.place(direction, position, sin, cos, f.side, 0.06);
        const offset = Vector3.Distance(f.ground, direction);
        if (offset > largestOffset) {
          largestOffset = offset;
          candidate = f;
        }
      }
    }
    if (!swinging && candidate) {
      candidate.phase = 0;
      candidate.from.copyFrom(candidate.ground);
      this.place(candidate.to, position, sin, cos, candidate.side, lead);
    }

    const liftL = Math.sin(this.feet[0].phase * Math.PI);
    const liftR = Math.sin(this.feet[1].phase * Math.PI);
    const brace = charge * charge;
    this.shotAge += dt;
    const recoil = (1 - Math.exp(-this.shotAge * 90)) * Math.exp(-this.shotAge * 13) * 1.55;
    hips.position.y = 1.31 + Math.max(liftL, liftR) * 0.045 - brace * 0.055;
    torso.rotation.z = (liftL - liftR) * 0.065 + this.lean;
    torso.rotation.x = 0.06 + brace * 0.14 - recoil * 0.13 - flinch * 0.32;
    this.crawlT += ((this.crawl ? 1 : 0) - this.crawlT) * Math.min(1, dt * 7);
    if (this.crawlT > 0.001) {
      const c = this.crawlT;
      const drag = moving ? Math.sin(performance.now() * 0.009) * 0.06 : 0;
      hips.position.y -= c * (0.62 + drag);
      torso.rotation.x += c * (0.5 + drag);
      torso.rotation.z += c * 0.28;
    }
    cannon.rotation.x = aimPitch + brace * 0.12 - recoil * 0.19;
    barrel.position.z = -recoil * 0.28 - brace * 0.065;
    muzzleGlow.scaling.setAll(0.30 + brace * 0.37 + recoil * 0.18);

    this.leg(this.feet[0], position, sin, cos, liftL, this.rig.thighL, this.rig.kneeL, this.rig.ankleL);
    this.leg(this.feet[1], position, sin, cos, liftR, this.rig.thighR, this.rig.kneeR, this.rig.ankleR);
    return planted;
  }

  private place(out: Vector3, root: Vector3, sin: number, cos: number, side: number, ahead: number): void {
    const spread = 0.46 * side;
    out.set(root.x + (cos * spread + sin * ahead) * this.scale, root.y, root.z + (-sin * spread + cos * ahead) * this.scale);
  }

  private leg(f: Foot, root: Vector3, sin: number, cos: number, lift: number, thigh: WalkerRig['thighL'], kneePivot: WalkerRig['kneeL'], ankle: WalkerRig['ankleL']): void {
    const dx = (f.ground.x - root.x) / this.scale;
    const dz = (f.ground.z - root.z) / this.scale;
    direction.set(dx * cos - dz * sin - thigh.position.x, ankleHeight + lift * 0.25 - this.rig.hips.position.y - thigh.position.y, dx * sin + dz * cos);
    // Triangle formed by the hip, knee and ankle. Bend the knee toward the front.
    const length = Math.max(0.1, Math.min(WALKER_THIGH + WALKER_SHIN - 0.001, direction.length()));
    direction.normalize();
    const reach = (length * length + WALKER_THIGH ** 2 - WALKER_SHIN ** 2) / (2 * length);
    const bend = Math.sqrt(Math.max(0, WALKER_THIGH ** 2 - reach * reach));
    knee.set(0, 0, 1).subtractInPlace(shin.copyFrom(direction).scaleInPlace(direction.z)).normalize().scaleInPlace(bend);
    knee.addInPlace(shin.copyFrom(direction).scaleInPlace(reach));
    shin.copyFrom(direction).scaleInPlace(length).subtractInPlace(knee).normalize();

    const upper = thigh.rotationQuaternion!;
    const lower = kneePivot.rotationQuaternion!;
    Quaternion.FromUnitVectorsToRef(down, knee.normalize(), upper);
    upper.conjugateToRef(inverse);
    shin.rotateByQuaternionToRef(inverse, direction);
    Quaternion.FromUnitVectorsToRef(down, direction, lower);
    upper.multiplyToRef(lower, inverse);
    inverse.conjugateToRef(ankle.rotationQuaternion!);
  }
}
