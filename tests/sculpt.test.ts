import { describe, expect, it } from 'vitest';
import { loftData, smoothLatheData, type LoftAxis, type Section } from '../src/visuals/sculpt';

/** Every triangle's winding normal points away from the shape's centroid, and agrees with its vertex normals. */
function check(vd: ReturnType<typeof loftData>) {
  const p = vd.positions as number[];
  const n = vd.normals as number[];
  const ix = vd.indices as number[];
  let cx = 0, cy = 0, cz = 0;
  const nv = p.length / 3;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  let outward = 0, agree = 0, tris = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    // Babylon is left-handed with clockwise front faces: face normal = e2 x e1.
    const fn = [e2[1] * e1[2] - e2[2] * e1[1], e2[2] * e1[0] - e2[0] * e1[2], e2[0] * e1[1] - e2[1] * e1[0]];
    const len = Math.hypot(...fn);
    if (len < 1e-9) continue;
    tris++;
    const m = [(p[a] + p[b] + p[c]) / 3 - cx, (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - cy, (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - cz];
    if (fn[0] * m[0] + fn[1] * m[1] + fn[2] * m[2] > 0) outward++;
    const vn = [n[a] + n[b] + n[c], n[a + 1] + n[b + 1] + n[c + 1], n[a + 2] + n[b + 2] + n[c + 2]];
    if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] > 0) agree++;
  }
  return { outward: outward / tris, agree: agree / tris };
}

const secs = (rev: boolean): Section[] => {
  const s: Section[] = [{ t: -0.5, w: 0.2, h: 0.15 }, { t: 0, w: 0.4, h: 0.3, n: 5 }, { t: 0.6, w: 0.25, h: 0.2 }];
  return rev ? s.map((x) => ({ ...x, t: -x.t })).reverse() : s;
};

describe('sculpt', () => {
  for (const axis of ['x', 'y', 'z'] as LoftAxis[]) {
    for (const rev of [false, true]) {
      it(`loft along ${axis}${rev ? ' (reversed)' : ''} winds outward with matching normals`, () => {
        const r = check(loftData(secs(rev), axis));
        expect(r.outward).toBeGreaterThan(0.97);
        expect(r.agree).toBeGreaterThan(0.97);
      });
    }
  }
  it('lathe winds outward', () => {
    const r = check(smoothLatheData([[0.1, 0], [0.2, 0.1], [0.2, 0.4], [0.12, 0.5]]));
    expect(r.outward).toBeGreaterThan(0.97);
    expect(r.agree).toBeGreaterThan(0.97);
  });
});
