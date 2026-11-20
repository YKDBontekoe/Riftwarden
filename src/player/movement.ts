/**
 * Advanced movement rules (slide, wall-run, grapple, ground pound): plain numbers in, plain numbers out, so the
 * feel can be tested without Havok. `Player` owns the state machine and the collision queries; these functions
 * decide velocities, timings and what a ground pound hits.
 */
export const KIT = {
  // ---- slide (grounded, Ctrl): keeps momentum, low friction, accelerates down ramps
  /** Minimum ground speed to start a slide. */
  slideEnter: 9,
  /** Entry speed floor: a slide from a run kicks up to this. */
  slideSpeed: 26,
  /** Friction while sliding (m/s^2). */
  slideFriction: 8,
  /** The slide ends below this speed. */
  slideExit: 8,
  slideMaxTime: 1.3,
  slideCooldown: 0.45,
  /** Steering rate toward the input while sliding (1/s): sliding commits to its line. */
  slideSteer: 1.8,
  /** Gravity share that pulls a slide down a slope. */
  slopePull: 0.9,
  slideDip: 0.58,
  slideFov: 0.07,

  // ---- wall-run (airborne next to a wall, moving along it)
  /** Probe reach beyond the capsule radius. */
  wallReach: 0.5,
  wallMinSpeed: 9,
  /** Speed floor along the wall. */
  wallRunSpeed: 21,
  wallRunTime: 1.6,
  /** Gravity multiplier while running (the drone sinks slowly, faster near the end). */
  wallGravity: 0.16,
  /** Vertical speed when the run starts (a small lift, never a launch). */
  wallLift: 2.2,
  /** A wall jump pushes off the wall and up. */
  wallJumpOut: 11,
  wallJumpUp: 10.8,
  /** Keep-off time for the same wall after leaving it (s). */
  wallRepeat: 0.5,
  /** Camera roll away from the wall (radians). */
  wallRoll: 0.14,
  /** Normals steeper than this (|ny|) are floors/ceilings, not walls. */
  wallMaxNy: 0.35,

  // ---- grapple (R / middle mouse): hook level geometry and reel in
  grappleRange: 46,
  grapplePull: 82,
  grappleMax: 38,
  /** Detach when this close to the anchor. */
  grappleRelease: 3,
  grappleTime: 2.2,
  grappleCooldown: 4.5,
  grappleMissCooldown: 0.6,
  /** Upward bias on the pull so a hook at eye level still lifts the drone over cover. */
  grappleLift: 9,
  /** Damping of the swing (motion across the line), 1/s. */
  grappleSwingDamp: 4,
  /** Release jump: vertical kick when jumping off the line. */
  grappleHop: 7,

  // ---- ground pound (Ctrl in the air)
  /** Minimum time airborne before a pound can start (so a jump + Ctrl slides on landing instead). */
  poundAirTime: 0.18,
  poundSpeed: 44,
  /** Horizontal speed kept when the pound starts. */
  poundCarry: 0.2,
  poundCooldown: 2.4,
  poundRadius: 4.5,
  poundRadiusPerM: 0.28,
  poundRadiusMax: 9.5,
  poundDamage: 70,
  poundDamagePerM: 9,
  poundDamageMax: 260,
  /** Camera shake on landing (grows with the fall). */
  poundShake: 0.35,
};

export type MoveState = '' | 'slide' | 'wall' | 'grapple' | 'pound';

/** Can a slide start now? */
export function canSlide(grounded: boolean, speed: number, cooldown: number): boolean {
  return grounded && cooldown <= 0 && speed >= KIT.slideEnter;
}

/** Slide entry velocity: keeps the current heading (or the facing when standing), at least `slideSpeed`. */
export function slideEntry(vx: number, vz: number, fx: number, fz: number, mult = 1): [number, number] {
  const cur = Math.hypot(vx, vz);
  const dx = cur > 0.5 ? vx / cur : fx;
  const dz = cur > 0.5 ? vz / cur : fz;
  const speed = Math.max(cur, KIT.slideSpeed * mult);
  return [dx * speed, dz * speed];
}

/**
 * One slide step. `wx/wz` is the (normalised or zero) input direction, `nx/nz` the horizontal part of the ground
 * normal (points downhill on a ramp, zero on flat ground), `g` gravity magnitude.
 */
export function slideStep(vx: number, vz: number, wx: number, wz: number, nx: number, nz: number, g: number, dt: number): [number, number] {
  let cur = Math.hypot(vx, vz);
  if (cur < 1e-4) return [0, 0];
  let dx = vx / cur;
  let dz = vz / cur;
  if (wx !== 0 || wz !== 0) {
    const k = 1 - Math.exp(-dt * KIT.slideSteer);
    dx += (wx - dx) * k;
    dz += (wz - dz) * k;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
  }
  // Slope: the downhill component of gravity along the slide direction.
  const downhill = (nx * dx + nz * dz) * g * KIT.slopePull;
  cur = Math.max(0, cur + (downhill - KIT.slideFriction) * dt);
  return [dx * cur, dz * cur];
}

/** Should the slide end? */
export function slideOver(speed: number, t: number, held: boolean, grounded: boolean): boolean {
  return !held || !grounded || speed < KIT.slideExit || t >= KIT.slideMaxTime;
}

/**
 * Wall-run start test. `nx/nz` is the wall normal (horizontal, unit), `ny` its vertical part, `vx/vz` the drone's
 * horizontal velocity. The drone must be moving fast enough *along* the wall, not straight into or away from it.
 */
export function wallRunnable(ny: number, nx: number, nz: number, vx: number, vz: number): boolean {
  if (Math.abs(ny) > KIT.wallMaxNy) return false;
  const into = vx * nx + vz * nz;
  const tx = vx - into * nx;
  const tz = vz - into * nz;
  return Math.hypot(tx, tz) >= KIT.wallMinSpeed && into < 4;
}

/** Velocity along the wall: the tangential part of the current velocity, at least `wallRunSpeed`. */
export function wallRunVelocity(vx: number, vz: number, nx: number, nz: number, mult = 1): [number, number] {
  const into = vx * nx + vz * nz;
  let tx = vx - into * nx;
  let tz = vz - into * nz;
  const t = Math.hypot(tx, tz);
  if (t < 1e-4) return [0, 0];
  tx /= t;
  tz /= t;
  const speed = Math.max(t, KIT.wallRunSpeed * mult);
  return [tx * speed, tz * speed];
}

/** Jump off a wall: keep the run speed, push out along the normal, and up. */
export function wallJump(vx: number, vz: number, nx: number, nz: number): [number, number, number] {
  return [vx + nx * KIT.wallJumpOut, KIT.wallJumpUp, vz + nz * KIT.wallJumpOut];
}

/** Gravity multiplier during a wall-run: light at first, back to ~half at the end of the run. */
export function wallGravity(t: number): number {
  const f = Math.min(1, t / KIT.wallRunTime);
  return KIT.wallGravity + f * f * 0.35;
}

/**
 * Grapple pull. Velocity (vx, vy, vz) is accelerated toward the anchor (plus a small lift) and capped; the
 * component away from the anchor is damped so the rope never stretches. Returns the new velocity.
 */
export function grappleStep(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  vx: number, vy: number, vz: number,
  dt: number,
): [number, number, number] {
  let dx = ax - px;
  let dy = ay - py;
  let dz = az - pz;
  const d = Math.hypot(dx, dy, dz) || 1;
  dx /= d;
  dy /= d;
  dz /= d;
  // Remove motion away from the anchor (inextensible line) and damp the swing, so a near miss converges on
  // the anchor instead of orbiting it.
  const radial = vx * dx + vy * dy + vz * dz;
  const keepRadial = Math.max(0, radial);
  const swing = Math.exp(-dt * KIT.grappleSwingDamp);
  vx = keepRadial * dx + (vx - radial * dx) * swing;
  vy = keepRadial * dy + (vy - radial * dy) * swing;
  vz = keepRadial * dz + (vz - radial * dz) * swing;
  vx += dx * KIT.grapplePull * dt;
  vy += (dy * KIT.grapplePull + KIT.grappleLift) * dt;
  vz += dz * KIT.grapplePull * dt;
  const s = Math.hypot(vx, vy, vz);
  if (s > KIT.grappleMax) {
    const k = KIT.grappleMax / s;
    vx *= k;
    vy *= k;
    vz *= k;
  }
  return [vx, vy, vz];
}

/** Ends the grapple: close to the anchor or out of time. */
export function grappleOver(dist: number, t: number): boolean {
  return dist <= KIT.grappleRelease || t >= KIT.grappleTime;
}

/** Can a ground pound start? */
export function canPound(grounded: boolean, airTime: number, cooldown: number): boolean {
  return !grounded && airTime >= KIT.poundAirTime && cooldown <= 0;
}

export interface PoundBlast {
  radius: number;
  damage: number;
  shake: number;
}

/** What a ground pound hits on landing, from the height it fell (higher = wider and harder, capped). */
export function poundBlast(fall: number, powerMult = 1): PoundBlast {
  const h = Math.max(0, Number.isFinite(fall) ? fall : 0);
  const radius = Math.min(KIT.poundRadiusMax, KIT.poundRadius + h * KIT.poundRadiusPerM);
  const damage = Math.min(KIT.poundDamageMax, KIT.poundDamage + h * KIT.poundDamagePerM) * Math.max(0, powerMult);
  return { radius, damage, shake: Math.min(0.7, KIT.poundShake + h * 0.02) };
}

/** Roll of the camera during a wall-run: away from the wall (wall on the right = roll left). */
export function wallRollFor(nx: number, nz: number, yaw: number): number {
  // Right vector of the view: (cos yaw, -sin yaw). A wall on the right has a normal pointing left (-right).
  const side = nx * Math.cos(yaw) - nz * Math.sin(yaw);
  return side < 0 ? KIT.wallRoll : -KIT.wallRoll;
}
