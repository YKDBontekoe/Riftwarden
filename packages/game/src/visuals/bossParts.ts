import { loftData } from './sculpt';

/** Detachable side armor from the Siege Colossus. */
export function colossusFlankData() {
  return loftData([
    { t: -1.24, w: 0.10, h: 0.38, v: 0.13, n: 5 }, { t: -0.86, w: 0.29, h: 0.73, n: 6 },
    { t: 0.68, w: 0.28, h: 0.68, n: 7 }, { t: 1.16, w: 0.12, h: 0.4, v: -0.13, n: 5 },
  ], 'z', 16);
}

/** One armor segment of the Overseer's concentric gimbals. */
export function overseerGimbalData() {
  return loftData([
    { t: -0.75, w: 0.09, h: 0.16, u: -0.16, n: 4 },
    { t: -0.55, w: 0.16, h: 0.28, u: -0.065, n: 6 },
    { t: 0, w: 0.19, h: 0.35, n: 6 },
    { t: 0.55, w: 0.16, h: 0.28, u: -0.065, n: 6 },
    { t: 0.75, w: 0.09, h: 0.16, u: -0.16, n: 4 },
  ], 'x', 16);
}
