/** Touch control rules: virtual stick, look scaling, when touch mode is on. Pure (no DOM, no Babylon). */

export type TouchPref = 'auto' | 'on' | 'off';

export const TOUCH = {
  /** Stick travel in CSS px for full deflection. */
  stickRadius: 60,
  /** Fraction of the radius ignored around the centre. */
  deadzone: 0.14,
  /** Pushing the knob past this many radii (mostly forward) sprints. */
  sprintAt: 1.2,
  /** Lowest analog speed share once outside the dead zone (crawling at 5% speed feels broken). */
  minDrive: 0.3,
  /** Touch px -> mouse-equivalent px (the Player turns 0.0022 rad per mouse px at sensitivity 1):
   * a 900 px swipe turns ~180 degrees at the default setting. */
  lookScale: 1.6,
  /** Look zone: the left share of the screen is the stick, the rest looks. */
  stickZone: 0.42,
} as const;

export interface StickVector {
  /** Strafe -1..1 (right +). */
  x: number;
  /** Forward -1..1 (up the screen +). */
  z: number;
  /** 0..1 deflection after the dead zone. */
  mag: number;
  sprint: boolean;
}

/** Knob offset in screen px (dy down) -> movement intent. */
export function stickVector(dx: number, dy: number, radius: number = TOUCH.stickRadius, deadzone: number = TOUCH.deadzone): StickVector {
  const r = Math.max(1, radius);
  const dist = Math.hypot(dx, dy);
  const raw = dist / r;
  if (!Number.isFinite(raw) || raw <= deadzone) return { x: 0, z: 0, mag: 0, sprint: false };
  const mag = Math.min(1, TOUCH.minDrive + ((Math.min(1, raw) - deadzone) / (1 - deadzone)) * (1 - TOUCH.minDrive));
  const x = (dx / dist) * mag;
  const z = (-dy / dist) * mag;
  // Sprint: pushed beyond the ring and within ~45 degrees of straight ahead.
  const sprint = raw >= TOUCH.sprintAt && -dy / dist > 0.7;
  return { x, z, mag, sprint };
}

/** Where the knob is drawn: the finger, clamped to the ring. */
export function knobOffset(dx: number, dy: number, radius: number = TOUCH.stickRadius): [number, number] {
  const d = Math.hypot(dx, dy);
  if (d <= radius || d === 0) return [dx, dy];
  return [(dx / d) * radius, (dy / d) * radius];
}

/** Finger movement (CSS px) -> mouse-equivalent look delta. */
export function lookDelta(px: number, sensitivity: number): number {
  const s = Number.isFinite(sensitivity) ? Math.min(3, Math.max(0.2, sensitivity)) : 1;
  return Number.isFinite(px) ? px * TOUCH.lookScale * s : 0;
}

export interface TouchEnv {
  /** matchMedia('(pointer: coarse)') */
  coarse: boolean;
  /** navigator.maxTouchPoints */
  touchPoints: number;
}

/** Whether touch controls start on (auto: a coarse primary pointer with touch points). */
export function wantsTouch(pref: TouchPref, env: TouchEnv): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return env.coarse && env.touchPoints > 0;
}

/** Auto mode follows the last pointer kind; explicit preferences never switch. */
export function nextTouchState(pref: TouchPref, current: boolean, pointerType: string): boolean {
  if (pref !== 'auto') return pref === 'on';
  if (pointerType === 'touch') return true;
  if (pointerType === 'mouse') return false;
  return current;
}

export const isPortrait = (w: number, h: number): boolean => h > w * 1.05;
