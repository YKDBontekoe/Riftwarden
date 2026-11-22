import type { Mechanism, WeaponFamily } from '@riftwarden/rules/data/defs';

/**
 * Shot feel (pure): what one shot does to the camera, the lens and the muzzle, per family and
 * mechanism. Presentation only, except the camera kick (pitch from the weapon def, yaw from here),
 * which moves the aim like real recoil and then recovers.
 *
 * - punchFov / punchRoll: instant lens punch (radians), applied on top of the smoothed FOV and roll so
 *   it never moves the crosshair; decays in ~0.1 s.
 * - yawKick: share of the pitch kick that goes sideways (signed per shot, drifting right on average).
 * - trauma: camera shake energy per shot (heavy weapons only).
 * - recoverFiring / recoverIdle: recoil recovery rate (1/s) while the trigger is held / after release:
 *   sustained fire climbs a little and settles the moment you let go.
 */
export interface ShotFeel {
  yawKick: number;
  punchFov: number;
  punchRoll: number;
  trauma: number;
  flashTime: number;
  flashScale: [number, number];
  light: number;
  recoverFiring: number;
  recoverIdle: number;
}

const BASE: Record<WeaponFamily, ShotFeel> = {
  plasma: { yawKick: 0.35, punchFov: 0.012, punchRoll: 0.006, trauma: 0, flashTime: 0.06, flashScale: [1.0, 1.5], light: 4.2, recoverFiring: 8, recoverIdle: 16 },
  rail: { yawKick: 0.2, punchFov: 0.045, punchRoll: 0.018, trauma: 0.22, flashTime: 0.09, flashScale: [1.8, 2.6], light: 7, recoverFiring: 6, recoverIdle: 10 },
  beam: { yawKick: 0, punchFov: 0.002, punchRoll: 0.0015, trauma: 0, flashTime: 0.05, flashScale: [0.8, 1.1], light: 2.6, recoverFiring: 12, recoverIdle: 16 },
  swarm: { yawKick: 0.15, punchFov: 0.008, punchRoll: 0.01, trauma: 0, flashTime: 0.07, flashScale: [0.9, 1.3], light: 3.2, recoverFiring: 10, recoverIdle: 16 },
};

/** Mechanism tweaks on top of the family profile. */
const MECH: Partial<Record<Mechanism, Partial<ShotFeel>>> = {
  burst: { punchFov: 0.016, recoverFiring: 7 },
  scatter: { yawKick: 0.5, punchFov: 0.03, punchRoll: 0.014, trauma: 0.12, flashScale: [1.6, 2.2], light: 6 },
  pulse: { punchFov: 0.02, punchRoll: 0.008, trauma: 0.05, light: 4.8 },
  cycle: { punchFov: 0.03, trauma: 0.1 },
  salvo: { punchFov: 0.024, punchRoll: 0.016, trauma: 0.08, flashScale: [1.3, 1.8], light: 5 },
};

/** Feel of one shot. `power` is the rail charge / burst factor (0..1+); heavier shots kick harder. */
export function shotFeel(family: WeaponFamily, mechanism: Mechanism, power = 1): ShotFeel {
  const f = { ...BASE[family], ...(MECH[mechanism] ?? {}) };
  const p = Math.max(0.2, Math.min(1.6, Number.isFinite(power) ? power : 1));
  return {
    ...f,
    punchFov: f.punchFov * p,
    punchRoll: f.punchRoll * p,
    trauma: f.trauma * p * p,
    light: f.light * (0.6 + 0.4 * p),
    flashScale: [f.flashScale[0] * (0.7 + 0.3 * p), f.flashScale[1] * (0.7 + 0.3 * p)],
  };
}

/**
 * Sideways kick sign for shot n: a gentle right drift with occasional corrections, deterministic in n
 * (so sustained fire has a learnable pattern instead of noise).
 */
export function yawPattern(n: number): number {
  const k = ((n * 2654435761) >>> 0) / 4294967296;
  return k < 0.68 ? 1 : -1;
}
