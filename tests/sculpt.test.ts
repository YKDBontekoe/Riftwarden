import { describe, expect, it } from 'vitest';
import { chamferRatio, loftData } from '@riftwarden/game/visuals/sculpt';

const box = [
  { t: -0.5, w: 0.5, h: 0.3, n: 5 },
  { t: 0.5, w: 0.5, h: 0.3, n: 5 },
];

describe('hard-surface loft', () => {
  it('rectangular sections become chamfered octagons with axis-aligned flat sides', () => {
    const vd = loftData(box, 'z');
    const pos = vd.positions as number[];
    const nrm = vd.normals as number[];
    // Side vertices only (caps have z normals): every side normal is one of 4 faces or 4 chamfers.
    const dirs = new Set<string>();
    for (let i = 0; i < nrm.length; i += 3) {
      if (Math.abs(nrm[i + 2]) > 0.5) continue;
      dirs.add(`${Math.round(nrm[i] * 100)},${Math.round(nrm[i + 1] * 100)}`);
    }
    expect(dirs.size).toBe(8);
    expect(dirs.has('100,0') && dirs.has('0,100') && dirs.has('-100,0') && dirs.has('0,-100')).toBe(true);
    // Silhouette keeps the full half-extents; the chamfer is a small share of the shorter side.
    const xs = pos.filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs)).toBeCloseTo(0.5, 6);
    expect(chamferRatio(5) * 0.3).toBeLessThan(0.06);
  });

  it('normals point outward', () => {
    const vd = loftData(box, 'x');
    const pos = vd.positions as number[];
    const nrm = vd.normals as number[];
    for (let i = 0; i < pos.length; i += 3) {
      const radial = pos[i + 1] * nrm[i + 1] + pos[i + 2] * nrm[i + 2] + pos[i] * nrm[i];
      expect(radial).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('round sections (n < 3) stay smooth with the requested tessellation', () => {
    const vd = loftData([{ t: 0, w: 0.2, h: 0.2, n: 2 }, { t: 1, w: 0.2, h: 0.2, n: 2 }], 'y', 16);
    // 2 rings x 16 shared side vertices + 2 caps x (1 + 16).
    expect((vd.positions as number[]).length / 3).toBe(32 + 34);
  });
});
