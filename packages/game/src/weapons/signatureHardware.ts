import { boxData, prismData } from './geometry';
import type { Ctx, Mounts } from './model';
import { cylZ } from './shapes';

/** Signature hardware rides on the barrel assembly and scales with installed components. */
export function uniqueHardware(c: Ctx, m: Mounts, front: number, id?: string): void {
  const { a, M, b, energy, chargeGlow } = c;
  const slide = c.rig.slide!;
  const z = m.barrelZ;
  const y = m.axisY;
  const length = front - z;
  if (id === 'rime_breath' && b.family === 'plasma') {
    // Open-sided ceramic radiator with visible cryo lines and thick stepped fins.
    for (const side of [-1, 1]) {
      const x = side * 0.043;
      a.add(prismData([[z - 0.028, y + 0.022], [z + length * 0.86, y + 0.017], [z + length * 0.72, y + 0.045], [z + length * 0.20, y + 0.061], [z - 0.04, y + 0.044]], 0.023, 0.004), M.frostCeramic, slide, [x, 0, 0]);
      a.add(cylZ(0.006, -0.013, length * 0.79, 0.0012, 12), energy, slide, [x, y - 0.008, z]);
      for (let i = 0; i < 5; i++) {
        a.add(boxData(0.027, 0.035, 0.014, 0.003), M.frostCeramic, slide, [x, y - 0.021, z + length * (0.10 + i * 0.14)], [0.2, 0, 0]);
      }
    }
    a.add(boxData(0.105, 0.013, 0.035, 0.003), M.graphite, slide, [0, y + 0.049, z - 0.01]);
  } else if (id === 'heartbreaker' && b.family === 'rail') {
    const railX = b.barrel === 'rb_quad' ? 0.052 : 0.041;
    for (const side of [-1, 1]) {
      const x = side * railX;
      a.add(prismData([[z - 0.023, y + 0.014], [z + length * 0.66, y + 0.022], [z + length * 0.88, y + 0.046], [z + length * 0.52, y + 0.065], [z + 0.002, y + 0.057]], 0.017, 0.004), M.graphite, slide, [x, 0, 0]);
      a.add(cylZ(0.0072, 0.005, length * 0.78, 0.0012, 14), chargeGlow, slide, [x, y - 0.011, z]);
      for (const fraction of [0.08, 0.31, 0.63, 0.77]) {
        a.add(cylZ(0.011, -0.006, 0.006, 0.002, 12), M.satin, slide, [x, y - 0.011, z + length * fraction]);
      }
      a.add(boxData(0.018, 0.008, 0.098, 0.002), energy, slide, [x, y + 0.058, z + length * 0.29]);
    }
  }
}
