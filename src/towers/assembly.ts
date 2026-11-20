/**
 * Staged tower deployment pose for build progress f in 0..1 (same duration as before, so gameplay timing is
 * unchanged): the pedestal prints up out of the deck, then the weapon head drops onto its bearing with a small
 * overshoot while spinning into alignment, then the core lights. Pure.
 */
export interface AssemblyPose {
  /** Root offset below the final height (m) and vertical scale of the pedestal. */
  sink: number;
  stretch: number;
  /** Head offset above its bearing (m) and extra yaw (rad) while it drops in. */
  headLift: number;
  headSpin: number;
  /** Core glow scale 0..1 (overshoots briefly when it lights). */
  glow: number;
  /** 0 = printing the base (weld sparks at the deck), 1 = head docking, 2 = powering up. */
  stage: 0 | 1 | 2;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
/** Ease with a little overshoot and settle (back-out). */
const outBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

export function assemblyPose(f: number, out: AssemblyPose = { sink: 0, stretch: 1, headLift: 0, headSpin: 0, glow: 0, stage: 0 }): AssemblyPose {
  const t = clamp01(Number.isFinite(f) ? f : 1);
  const base = outCubic(clamp01(t / 0.5));
  out.sink = (1 - base) * 1.6;
  out.stretch = 0.25 + 0.75 * base;
  const head = clamp01((t - 0.35) / 0.45);
  out.headLift = (1 - outBack(head)) * 1.7;
  out.headSpin = (1 - outCubic(head)) * 2.4;
  const g = clamp01((t - 0.78) / 0.22);
  out.glow = g <= 0 ? 0 : Math.min(1.35, outBack(g) * 1.0 + Math.sin(g * Math.PI) * 0.25);
  out.stage = t < 0.38 ? 0 : t < 0.8 ? 1 : 2;
  return out;
}
