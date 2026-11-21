// Walker / Bulwark / Rush Drone through the real EnemyManager on a Babylon NullEngine scene (as the server runs it).
import '../apps/server/headless';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CORE_BEHAVIORS } from '@riftwarden/game/enemies/coreBehaviors';
import { type EnemyContext, EnemyManager } from '@riftwarden/game/enemies/EnemyManager';
import { Kit } from '@riftwarden/game/visuals/kit';
import { createPalette } from '@riftwarden/game/visuals/materials';
import { ARENA } from '@riftwarden/rules/world/layout';

let engine: NullEngine;
let scene: Scene;
let mgr: EnemyManager;

const noopFx = new Proxy({}, { get: () => () => undefined }) as never;

function ctx(over: Partial<{ playerAt: Vector3; alive: boolean }> = {}) {
  const pos = over.playerAt ?? new Vector3(0, 1, -80);
  const player = {
    position: pos,
    eye: pos.add(new Vector3(0, 0.6, 0)),
    alive: over.alive ?? true,
    knockback: vi.fn(),
  };
  const spies = { reactor: vi.fn(), hurt: vi.fn() };
  const c = {
    player,
    effects: noopFx,
    layout: ARENA,
    damageReactor: spies.reactor,
    los: () => false,
    panFor: () => ({ pan: 0, volume: 0 }),
    towers: [],
    tele: noopFx,
    ordnance: noopFx,
    hurtPlayer: spies.hurt,
    hostileBlast: () => undefined,
    summon: () => null,
    alert: () => undefined,
    escaped: () => undefined,
    time: 0,
  } as unknown as EnemyContext;
  return { c, spies, player };
}

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  mgr = new EnemyManager(scene, new Kit(scene), createPalette(scene, false));
  for (const [kind, b] of Object.entries(CORE_BEHAVIORS)) mgr.register(kind as 'walker', b);
});
afterAll(() => {
  scene.dispose();
  engine.dispose();
});

function run(seconds: number, c: EnemyContext, until?: () => boolean): number {
  let t = 0;
  for (; t < seconds; t += 1 / 60) {
    c.time = t;
    mgr.update(1 / 60, c);
    if (until?.()) break;
  }
  return t;
}

describe('core enemy behaviours', () => {
  it('every core kind has a registered behaviour and builds a rig', () => {
    for (const kind of ['walker', 'bulwark', 'rusher'] as const) {
      const { c } = ctx();
      const e = mgr.spawn(kind, 'north', ARENA, 1, 1, 1, { ctx: c });
      expect(e.behavior, kind).toBe(CORE_BEHAVIORS[kind]);
      expect(kind === 'rusher' ? e.drone : e.walker, kind).toBeTruthy();
      mgr.despawn(e);
    }
  });

  it('a spawn without a registered behaviour fails loudly', () => {
    const bare = new EnemyManager(scene, new Kit(scene), createPalette(scene, false));
    expect(() => bare.spawn('walker', 'north', ARENA, 1, 1, 1, {})).toThrow(/No behaviour registered/);
  });

  it('a walker follows its lane, reaches the reactor and starts hitting it', () => {
    const { c, spies } = ctx();
    const e = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: c });
    const start = e.pos.clone();
    run(180, c, () => spies.reactor.mock.calls.length > 0);
    expect(e.state).toBe('attack');
    expect(Vector3.Distance(e.pos, start)).toBeGreaterThan(10);
    expect(spies.reactor).toHaveBeenCalled();
    expect(spies.reactor.mock.calls[0][0]).toBeGreaterThan(0);
    mgr.despawn(e);
  });

  it('a rush drone detonates on the reactor and is removed', () => {
    const { c, spies } = ctx();
    const e = mgr.spawn('rusher', 'north', ARENA, 1, 1, 1, { ctx: c });
    run(180, c, () => !e.alive);
    expect(e.alive).toBe(false);
    expect(spies.reactor).toHaveBeenCalledTimes(1);
  });

  it('a rush drone detonates on a nearby drone (player) and knocks it back', () => {
    const { c, spies, player } = ctx();
    const e = mgr.spawn('rusher', 'north', ARENA, 1, 1, 1, { ctx: c });
    player.position.copyFrom(e.pos);
    player.eye.copyFrom(e.pos);
    run(2, c, () => !e.alive);
    expect(e.alive).toBe(false);
    expect(spies.hurt).toHaveBeenCalled();
    expect(player.knockback).toHaveBeenCalled();
  });

  it('chill slows movement (status speed factor is applied by the shared behaviour)', () => {
    const a = ctx().c;
    const b = ctx().c;
    const fast = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: a });
    const slow = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: b });
    slow.status.chill = 80;
    const f0 = fast.pos.clone();
    const s0 = slow.pos.clone();
    run(2, a);
    expect(Vector3.Distance(fast.pos, f0)).toBeGreaterThan(Vector3.Distance(slow.pos, s0));
    mgr.despawn(fast);
    mgr.despawn(slow);
  });

  it('bulwark and walker share one update path but keep different stats', () => {
    const { c } = ctx();
    const w = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: c });
    const b = mgr.spawn('bulwark', 'north', ARENA, 1, 1, 1, { ctx: c });
    expect(b.maxHp).toBeGreaterThan(w.maxHp);
    mgr.despawn(w);
    mgr.despawn(b);
  });
});
