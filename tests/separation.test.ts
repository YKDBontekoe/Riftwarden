// Crowd separation: the grid pass must reproduce the original O(n^2) loop exactly (same pairs, same order).
import { describe, expect, it } from 'vitest';
import { Separation, type SeparationBody, separateBrute } from '@riftwarden/game/enemies/separation';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function crowd(seed: number, n: number, spread: number, boss = false): SeparationBody[] {
  const r = rng(seed);
  const out: SeparationBody[] = [];
  for (let i = 0; i < n; i++) {
    // Clumps at the gates plus a scatter, a few airborne, radii of the real archetypes (0.6 .. 1.6, bosses 4).
    const clump = i % 3 === 0;
    const cx = clump ? (i % 4) * 30 - 45 : 0;
    const x = cx + (r() - 0.5) * (clump ? 6 : spread);
    const z = (clump ? -40 : 0) + (r() - 0.5) * (clump ? 6 : spread);
    const y = i % 9 === 0 ? 4 + r() * 3 : 0;
    const isBoss = boss && i === 5;
    out.push({ pos: { x, y, z }, def: { radius: isBoss ? 4 : 0.6 + r(), role: isBoss ? 'boss' : 'grunt' } });
  }
  return out;
}

const clone = (l: SeparationBody[]) => l.map((b) => ({ pos: { ...b.pos }, def: b.def }));

describe('enemy separation', () => {
  for (const [n, spread, boss] of [[60, 40, false], [150, 60, true], [300, 80, true], [500, 50, false], [260, 12, true]] as const) {
    it(`grid equals brute force: ${n} bodies, spread ${spread}${boss ? ', boss' : ''}`, () => {
      const a = crowd(n * 7 + spread, n, spread, boss);
      const b = clone(a);
      const sep = new Separation();
      // Several frames so positions evolve (dense crowds keep resolving).
      for (let f = 0; f < 30; f++) {
        separateBrute(a, 1 / 60);
        sep.apply(b, 1 / 60);
      }
      expect(b.map((x) => [x.pos.x, x.pos.z])).toEqual(a.map((x) => [x.pos.x, x.pos.z]));
    });
  }

  it('negative and far coordinates map to distinct cells', () => {
    const l: SeparationBody[] = [];
    for (let i = 0; i < 64; i++) l.push({ pos: { x: -400 + (i % 8) * 0.5, y: 0, z: 400 - Math.floor(i / 8) * 0.5 }, def: { radius: 0.8, role: 'grunt' } });
    const ref = clone(l);
    separateBrute(ref, 1 / 30);
    new Separation().apply(l, 1 / 30);
    expect(l.map((x) => [x.pos.x, x.pos.z])).toEqual(ref.map((x) => [x.pos.x, x.pos.z]));
  });
});
