// traceShot: the hitscan geometry shared by the authoritative game and the co-op replica (NullEngine scene).
import '../server/headless';
import { MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { traceShot } from '../src/arena/shotTrace';
import { shotOutcome } from '../src/arena/PlayerCombat';
import type { ShotRequest } from '../src/combat/Weapon';
import { CORE_BEHAVIORS } from '../src/enemies/coreBehaviors';
import { type Enemy, EnemyManager } from '../src/enemies/EnemyManager';
import { Kit } from '../src/visuals/kit';
import { createPalette } from '../src/visuals/materials';
import { ARENA } from '../src/world/layout';

let engine: NullEngine;
let scene: Scene;
let mgr: EnemyManager;

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  mgr = new EnemyManager(scene, new Kit(scene), createPalette(scene, false));
  for (const [kind, b] of Object.entries(CORE_BEHAVIORS)) mgr.register(kind as 'walker', b);
  // A wall across the shot line at z = 30.
  const wall = MeshBuilder.CreateBox('wall', { width: 40, height: 20, depth: 1 }, scene);
  wall.position.set(0, 5, 30);
  wall.metadata = { surface: 'wall' };
  wall.computeWorldMatrix(true);
});
afterAll(() => {
  scene.dispose();
  engine.dispose();
});

const spawned: Enemy[] = [];
// Park every walker of the previous test far off the shot lines (their hitboxes stay pickable).
afterEach(() => {
  for (const e of spawned.splice(0)) {
    e.pos.set(500, 0, 500);
    e.root.position.copyFrom(e.pos);
    e.root.computeWorldMatrix(true);
    for (const h of e.hitboxes) h.computeWorldMatrix(true);
  }
});

function walkerAt(z: number, x = 0): Enemy {
  const e = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: null });
  spawned.push(e);
  e.pos.set(x, 0, z);
  e.root.position.copyFrom(e.pos);
  e.root.rotation.set(0, 0, 0);
  return e;
}

function shot(o: Partial<ShotRequest> = {}): ShotRequest {
  return { origin: new Vector3(0, 0, 0), dir: new Vector3(0, 0, 1), range: 100, damage: 10, pierce: 0, width: 0, family: 'plasma', ...o } as ShotRequest;
}

function aimAt(e: Enemy): ShotRequest {
  const c = e.center();
  const origin = new Vector3(c.x, c.y, 0);
  return shot({ origin });
}

describe('traceShot', () => {
  it('hits the first enemy on the ray and stops (no pierce)', () => {
    const a = walkerAt(10);
    const b = walkerAt(18);
    const t = traceShot(scene, [a, b], aimAt(a));
    expect(t.struck.map((s) => s.enemy)).toEqual([a]);
    expect(t.wall).not.toBeNull();
    expect(shotOutcome(aimAt(a), t.struck, t.wall).target).toBe('enemy');
  });

  it('pierces up to `pierce` extra enemies in ray order, never through the wall', () => {
    const a = walkerAt(10);
    const b = walkerAt(18);
    const c = walkerAt(36); // behind the wall
    const t = traceShot(scene, [c, b, a], { ...aimAt(a), pierce: 5 });
    expect(t.struck.map((s) => s.enemy)).toEqual([a, b]);
    expect(t.struck[0].point.z).toBeLessThan(t.struck[1].point.z);
  });

  it('beam aim assist finds an enemy near the axis only when nothing was picked', () => {
    const e = walkerAt(12, 1.6);
    const c = e.center();
    const base = shot({ origin: new Vector3(0, c.y, 0) });
    expect(traceShot(scene, [e], base).struck.length).toBe(0);
    const assisted = traceShot(scene, [e], { ...base, width: 1.5 });
    expect(assisted.struck.length).toBe(1);
    expect(assisted.struck[0].assisted).toBe(true);
    expect(assisted.struck[0].weak).toBe(false);
  });

  it('the accept filter skips enemies (co-op replica: only replicated ones)', () => {
    const a = walkerAt(10);
    const b = walkerAt(18);
    const t = traceShot(scene, [a, b], aimAt(a), (e) => e !== a);
    expect(t.struck.map((s) => s.enemy)).toEqual([b]);
  });

  it('a miss ends at the wall or at the range', () => {
    const up = shot({ origin: new Vector3(0, 30, 0), range: 20 });
    const t = traceShot(scene, [], up);
    expect(t.wall).toBeNull();
    const out = shotOutcome(up, t.struck, t.wall);
    expect(out.target).toBe('none');
    expect(out.point.z).toBeCloseTo(20);
    const flat = shot({ origin: new Vector3(0, 5, 0) });
    const w = shotOutcome(flat, [], traceShot(scene, [], flat).wall, false);
    expect(w.target).toBe('surface');
    expect(w.point.z).toBeCloseTo(29.5, 1);
  });
});
