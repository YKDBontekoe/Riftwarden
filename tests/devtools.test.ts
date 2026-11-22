import { describe, expect, it, vi } from 'vitest';
import { DevTools, type DevHost } from '@riftwarden/game/arena/DevTools';
import { uiEvents } from '@riftwarden/game/ui/store';

function fakeHost(over: Partial<{ phase: 'prep' | 'combat'; number: number }> = {}) {
  const calls: string[] = [];
  const run = { survival: { dev: false } };
  const host = {
    cfg: { run, tier: { id: 1 } },
    enemies: { clear: () => calls.push('enemies.clear'), spawn: vi.fn(() => ({ id: 1 })) },
    ordnance: { reset: () => calls.push('ordnance.reset') },
    tele: { reset: () => calls.push('tele.reset') },
    survival: { endEvent: () => calls.push('survival.endEvent'), prep: vi.fn(), applyEvolution: vi.fn() },
    waves: {
      phase: over.phase ?? 'prep',
      number: over.number ?? 4,
      wave: { hpMult: 2, damageMult: 3, speedMult: 1 },
      jumpTo: vi.fn((n: number) => calls.push(`jump:${n}`)),
      recompose: vi.fn(),
    },
    planner: { force: vi.fn(), forceEvolution: vi.fn() },
    turrets: { turrets: [{ disabledT: 5 }, { disabledT: 2 }] },
    enemyCtx: {},
    restoreReactor: () => calls.push('reactor'),
    resetToPlayable: () => calls.push('playable'),
  };
  return { host: host as unknown as DevHost & typeof host, calls, run };
}

describe('DevTools (fake host, no scene)', () => {
  it('marks the run as a development session exactly once', () => {
    const { host, run } = fakeHost();
    const seen: unknown[] = [];
    const off = uiEvents.on('alert', (a) => seen.push(a));
    const dev = new DevTools(host);
    dev.jump(3);
    dev.jump(5);
    off?.();
    expect(run.survival.dev).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('jump clears the field and moves the waves (floored, min 1)', () => {
    const { host, calls } = fakeHost();
    new DevTools(host).jump(0.2);
    expect(calls).toEqual(['enemies.clear', 'ordnance.reset', 'tele.reset', 'survival.endEvent', 'jump:1']);
    expect(host.waves.jumpTo).toHaveBeenCalledWith(1);
  });

  it('spawn applies wave multipliers and tags bosses / couriers', () => {
    const { host } = fakeHost();
    const dev = new DevTools(host);
    dev.spawn('walker');
    dev.spawn('courier');
    dev.spawn('colossus');
    const [walker, courier, boss] = host.enemies.spawn.mock.calls as unknown as unknown[][];
    const opts = (c: unknown[]) => c[6] as { tag?: string };
    expect(opts(walker).tag).toBeUndefined();
    expect(opts(courier).tag).toBe('hvt');
    expect(opts(boss).tag).toBe('boss');
    expect(walker[3]).toBe(2); // hp multiplier = wave hpMult * 1
    expect(walker[4]).toBe(3); // damage multiplier
  });

  it('force targets the current wave in prep and the next one in combat', () => {
    const prep = fakeHost({ phase: 'prep', number: 4 });
    new DevTools(prep.host).force({ boss: 'colossus' });
    expect(prep.host.planner.force).toHaveBeenCalledWith(4, { boss: 'colossus' });
    expect(prep.host.waves.recompose).toHaveBeenCalled();
    expect(prep.host.survival.prep).toHaveBeenCalled();

    const combat = fakeHost({ phase: 'combat', number: 4 });
    new DevTools(combat.host).force({ event: 'swarm' });
    expect(combat.host.planner.force).toHaveBeenCalledWith(5, { event: 'swarm' });
    expect(combat.host.waves.recompose).not.toHaveBeenCalled();
  });

  it('evolve forwards to planner + survival and recomposes only in prep', () => {
    const { host } = fakeHost({ phase: 'prep' });
    new DevTools(host).evolve('routes');
    expect(host.planner.forceEvolution).toHaveBeenCalledWith(4, 'routes');
    expect(host.survival.applyEvolution).toHaveBeenCalledWith('routes');
    expect(host.waves.recompose).toHaveBeenCalled();
  });

  it('reset clears hazards, heals the reactor, un-suppresses towers and returns to a playable screen', () => {
    const { host, calls } = fakeHost();
    new DevTools(host).reset();
    expect(calls).toEqual(['enemies.clear', 'ordnance.reset', 'tele.reset', 'survival.endEvent', 'reactor', 'playable']);
    expect(host.turrets.turrets.every((t) => t.disabledT === 0)).toBe(true);
  });
});
