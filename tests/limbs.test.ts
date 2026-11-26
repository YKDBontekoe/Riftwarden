// Shoot-off parts: pure rules + a real walker on a NullEngine scene (as the co-op server runs it).
import '../apps/worker/src/sim/headless';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CORE_BEHAVIORS } from '@riftwarden/game/enemies/coreBehaviors';
import { sapperBehavior } from '@riftwarden/game/enemies/factionBehaviors';
import { type EnemyContext, EnemyManager } from '@riftwarden/game/enemies/EnemyManager';
import { bit, hasLost, LIMB_EFFECT, LIMBS, limbDamage, limbForHit } from '@riftwarden/rules/enemies/limbs';
import { limbNode } from '@riftwarden/game/enemies/limbRuntime';
import { Kit } from '@riftwarden/game/visuals/kit';
import { createPalette } from '@riftwarden/game/visuals/materials';
import { ARENA } from '@riftwarden/rules/world/layout';

describe('limb rules', () => {
  it('a hit goes to the nearest intact part within reach', () => {
    expect(limbForHit({ cannon: 0.3, arm: 0.2, head: 2, leg: 9 }, 0)).toBe('arm');
    expect(limbForHit({ cannon: 0.3, arm: 0.2, head: 2, leg: 9 }, bit('arm'))).toBe('cannon');
    expect(limbForHit({ cannon: 5, arm: 5, head: 5, leg: 9 }, 0)).toBeNull();
    expect(limbForHit({ cannon: Number.NaN, arm: 9, head: 0.1, leg: 9 }, 0)).toBe('head');
  });

  it('a part breaks at its share of max hull, never on the killing blow', () => {
    const at = LIMBS.cannon.share * 100;
    expect(limbDamage(0, at - 1, 'cannon', 100, true).breaks).toBe(false);
    expect(limbDamage(at - 1, 1, 'cannon', 100, true)).toEqual({ total: at, breaks: true });
    expect(limbDamage(0, 1000, 'cannon', 100, false).breaks).toBe(false);
    expect(limbDamage(0, Number.NaN, 'head', 100, true)).toEqual({ total: 0, breaks: false });
  });

  it('masks are per part', () => {
    const m = bit('cannon') | bit('head');
    expect(hasLost(m, 'cannon') && hasLost(m, 'head') && !hasLost(m, 'arm')).toBe(true);
  });
});

describe('walker parts in the enemy pipeline', () => {
  let engine: NullEngine;
  let scene: Scene;
  let mgr: EnemyManager;
  const fx = new Proxy({}, { get: () => () => 0 }) as never;

  beforeAll(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    mgr = new EnemyManager(scene, new Kit(scene), createPalette(scene, false));
    for (const [kind, b] of Object.entries(CORE_BEHAVIORS)) mgr.register(kind as 'walker', b);
    mgr.register('sapper', sapperBehavior);
  });
  afterAll(() => {
    scene.dispose();
    engine.dispose();
  });

  function ctx(playerAt: Vector3) {
    return {
      player: { position: playerAt, eye: playerAt.add(new Vector3(0, 0.6, 0)), alive: true, knockback: vi.fn() },
      effects: fx,
      layout: ARENA,
      damageReactor: vi.fn(),
      los: () => true,
      panFor: () => ({ pan: 0, volume: 0 }),
      towers: [],
      tele: fx,
      ordnance: fx,
      hurtPlayer: vi.fn(),
      hostileBlast: () => undefined,
      summon: () => null,
      alert: () => undefined,
      escaped: () => undefined,
      time: 0,
    } as unknown as EnemyContext;
  }

  function partPoint(e: ReturnType<EnemyManager['spawn']>, l: 'cannon' | 'arm' | 'head'): Vector3 {
    e.root.computeWorldMatrix(true);
    const n = limbNode(e.walker!, l);
    n.computeWorldMatrix(true);
    return n.getAbsolutePosition().clone();
  }

  it('hull hits at the cannon knock it off, hide it, and stop shots at the drone', () => {
    const c = ctx(new Vector3(0, 1, -80));
    const e = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: c });
    const at = partPoint(e, 'cannon');
    for (let i = 0; i < 40 && !hasLost(e.limbsLost, 'cannon') && e.hp > 0; i++) mgr.damage(e, e.maxHp * 0.05, 'energy', at, fx);
    expect(hasLost(e.limbsLost, 'cannon')).toBe(true);
    expect(e.walker!.cannon.isEnabled()).toBe(false);
    expect(e.hp).toBeGreaterThan(0);
    // The drone stands right next to it with line of sight: a disarmed walker never starts a shot.
    c.player.position.copyFrom(e.pos.add(new Vector3(0, 0, 6)));
    c.player.eye.copyFrom(c.player.position);
    e.shotT = 0;
    for (let i = 0; i < 300; i++) mgr.update(1 / 60, c);
    expect(e.chargeT).toBe(0);
    mgr.despawn(e);
  });

  it('a headless walker staggers and takes extra damage; parts come back on respawn', () => {
    const c = ctx(new Vector3(0, 1, -80));
    const e = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: c });
    const speed = e.moveMult;
    const at = partPoint(e, 'head');
    for (let i = 0; i < 40 && !hasLost(e.limbsLost, 'head') && e.hp > 0; i++) mgr.damage(e, e.maxHp * 0.05, 'energy', at, fx);
    expect(hasLost(e.limbsLost, 'head')).toBe(true);
    expect(e.moveMult).toBeCloseTo(speed * LIMB_EFFECT.headlessSpeed, 6);
    const hp = e.hp;
    mgr.damage(e, 10, 'energy', e.center(), fx);
    expect(hp - e.hp).toBeCloseTo(10 * LIMB_EFFECT.headlessVulnerability, 4);
    mgr.despawn(e);
    const again = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: c });
    expect(again.limbsLost).toBe(0);
    expect(again.walker!.head.isEnabled()).toBe(true);
    mgr.despawn(again);
  });

  it('body hits far from any part never knock one off', () => {
    const c = ctx(new Vector3(0, 1, -80));
    const e = mgr.spawn('walker', 'north', ARENA, 1, 1, 1, { ctx: c });
    const feet = e.pos.clone();
    for (let i = 0; i < 15; i++) mgr.damage(e, e.maxHp * 0.05, 'energy', feet, fx);
    expect(e.limbsLost).toBe(0);
    mgr.despawn(e);
  });

  it('plants the sapper forefeet and restores a detached foreleg when pooled', () => {
    const c = ctx(new Vector3(0, 1, -80));
    const e = mgr.spawn('sapper', 'north', ARENA, 1, 1, 1, { ctx: c });
    const rig = e.walker!;
    const forward = new Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    for (const { ankle } of rig.forelegs!) {
      ankle.computeWorldMatrix(true);
      const offset = ankle.getAbsolutePosition().subtract(e.pos);
      expect(offset.y).toBeCloseTo(0.075, 2);
      expect(Vector3.Dot(offset, forward)).toBeGreaterThan(0.45);
    }
    const rightForeleg = rig.forelegs![1].thigh;
    const at = partPoint(e, 'cannon');
    for (let i = 0; i < 10 && rightForeleg.isEnabled(); i++) mgr.damage(e, e.maxHp * 0.05, 'energy', at, fx);
    expect(rightForeleg.isEnabled()).toBe(false);
    mgr.despawn(e);
    const again = mgr.spawn('sapper', 'north', ARENA, 1, 1, 1, { ctx: c });
    expect(again).toBe(e);
    expect(rightForeleg.isEnabled()).toBe(true);
    mgr.despawn(again);
  });
});

describe('legs', () => {
  it('the right leg is a fourth part: hits near it count for it, and losing it slows the frame to a crawl', async () => {
    const { LIMB_EFFECT, LIMB_IDS } = await import('@riftwarden/rules/enemies/limbs');
    expect(LIMB_IDS).toContain('leg');
    expect(limbForHit({ cannon: 2, arm: 2, head: 2, leg: 0.4 }, 0)).toBe('leg');
    expect(limbForHit({ cannon: 2, arm: 2, head: 2, leg: 0.4 }, bit('leg'))).toBeNull();
    expect(LIMB_EFFECT.leglessSpeed).toBeLessThan(0.6);
  });
});
