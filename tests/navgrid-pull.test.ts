// NavGrid path pulling: the memoised pull must return exactly the paths of the plain greedy pull, in any query order,
// across tower changes and survival retargets.
import { describe, expect, it } from 'vitest';
import { generateArena } from '@riftwarden/rules/world/arenaGen';
import { ARENA } from '@riftwarden/rules/world/layout';
import { NavGrid } from '@riftwarden/rules/world/navgrid';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function plain(layout: ConstructorParameters<typeof NavGrid>[0]): NavGrid {
  const g = new NavGrid(layout, true);
  (g as unknown as { pullMemo: (pts: unknown) => unknown }).pullMemo = (pts) => g.pull(pts as Parameters<NavGrid['pull']>[0]);
  return g;
}

describe('navgrid pull memo', () => {
  for (const [name, layout] of [['classic', ARENA], ['procedural 11', generateArena(11)], ['procedural 4242', generateArena(4242)]] as const) {
    it(`equals the plain pull: ${name}`, () => {
      const fast = new NavGrid(layout, true);
      const ref = plain(layout);
      const r = rng(7);
      const H = layout.half;
      const queries = () => Array.from({ length: 150 }, () => ({ x: (r() - 0.5) * H * 1.9, z: (r() - 0.5) * H * 1.9 }));
      for (let phase = 0; phase < 4; phase++) {
        if (phase === 1) {
          const obs = Array.from({ length: 8 }, () => ({ x: (r() - 0.5) * H, z: (r() - 0.5) * H, r: 1.2 }));
          fast.setObstacles(obs);
          ref.setObstacles(obs);
        }
        if (phase >= 2) {
          const goals = [{ x: (r() - 0.5) * H, z: (r() - 0.5) * H }];
          fast.retarget(goals);
          ref.retarget(goals);
        }
        // Repeat starts (memo hits) and nearby starts (shared tails).
        const qs = queries();
        for (const q of [...qs, ...qs.slice(0, 40), ...qs.slice(0, 40).map((p) => ({ x: p.x + 0.7, z: p.z - 0.4 }))]) {
          expect(fast.pathFrom(q.x, q.z)).toEqual(ref.pathFrom(q.x, q.z));
        }
      }
    });
  }

  it('paths do not share array identity between calls', () => {
    const g = new NavGrid(generateArena(11), true);
    const a = g.pathFrom(20, 20);
    const b = g.pathFrom(20, 20);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
