/**
 * Directional hit reaction: a damped spring on the enemy root's local pitch and roll. A hit adds angular velocity
 * leaning the body away from the source (weighted by how much of its health the hit took), the spring snaps it
 * back within ~0.3 s. Pure (no Babylon values), so the response is testable.
 */
export const LEAN = { stiffness: 210, damping: 15, maxAngle: 0.32 } as const;

/** Angular velocity (rad/s) for a hit that took `fraction` of max health. */
export function hitImpulse(fraction: number): number {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  return 1.1 + Math.min(4.5, f * 14);
}

export class HitLean {
  pitch = 0;
  roll = 0;
  private vp = 0;
  private vr = 0;

  get active(): boolean {
    return this.pitch !== 0 || this.roll !== 0 || this.vp !== 0 || this.vr !== 0;
  }

  /** (ax, az) = world direction away from the source; yaw = the body's facing (Babylon: 0 faces +z). */
  kick(ax: number, az: number, yaw: number, speed: number): void {
    const l = Math.hypot(ax, az);
    if (!(l > 1e-4) || !(speed > 0)) return;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const fwd = (ax * s + az * c) / l; // + = pushed forward
    const side = (ax * c - az * s) / l; // + = pushed to its right
    this.vp += fwd * speed;
    this.vr -= side * speed; // positive roll tips the top toward -x (left)
  }

  step(dt: number): void {
    const h = Math.min(dt, 1 / 30);
    const { stiffness: k, damping: d, maxAngle: m } = LEAN;
    this.vp += (-k * this.pitch - d * this.vp) * h;
    this.vr += (-k * this.roll - d * this.vr) * h;
    this.pitch = Math.max(-m, Math.min(m, this.pitch + this.vp * h));
    this.roll = Math.max(-m, Math.min(m, this.roll + this.vr * h));
    if (Math.abs(this.pitch) < 1e-4 && Math.abs(this.roll) < 1e-4 && Math.abs(this.vp) < 1e-3 && Math.abs(this.vr) < 1e-3) this.reset();
  }

  reset(): void {
    this.pitch = this.roll = this.vp = this.vr = 0;
  }
}
