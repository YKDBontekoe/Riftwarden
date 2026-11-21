import { Vector3 } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import { type KitBody, MoveKit, type ProbeHit } from '@riftwarden/game/player/MoveKit';
import {
  canPound,
  canSlide,
  grappleOver,
  grappleStep,
  KIT,
  poundBlast,
  slideEntry,
  slideOver,
  slideStep,
  wallGravity,
  wallJump,
  wallRollFor,
  wallRunnable,
  wallRunVelocity,
} from '@riftwarden/rules/player/movement';
import { MOVE } from '@riftwarden/game/player/Player';

describe('slide rules', () => {
  it('starts only grounded, fast enough and off cooldown', () => {
    expect(canSlide(true, KIT.slideEnter, 0)).toBe(true);
    expect(canSlide(false, 30, 0)).toBe(false);
    expect(canSlide(true, KIT.slideEnter - 0.1, 0)).toBe(false);
    expect(canSlide(true, 30, 0.1)).toBe(false);
  });

  it('kicks a run up to the slide speed and keeps faster momentum', () => {
    const [vx, vz] = slideEntry(MOVE.runSpeed, 0, 0, 1);
    expect(Math.hypot(vx, vz)).toBeCloseTo(KIT.slideSpeed);
    expect(vx).toBeGreaterThan(0);
    const [fx] = slideEntry(MOVE.dashCarrySpeed + 5, 0, 0, 1);
    expect(fx).toBeCloseTo(MOVE.dashCarrySpeed + 5);
    // Standing still: the slide goes where the camera faces.
    const [sx, sz] = slideEntry(0, 0, 0, 1);
    expect(sx).toBe(0);
    expect(sz).toBeCloseTo(KIT.slideSpeed);
  });

  it('loses speed on flat ground, gains it down a ramp', () => {
    const flat = slideStep(26, 0, 0, 0, 0, 0, 30, 0.1);
    expect(flat[0]).toBeCloseTo(26 - KIT.slideFriction * 0.1);
    // Ramp normal leaning +x: downhill is +x.
    const down = slideStep(26, 0, 0, 0, 0.4, 0, 30, 0.1);
    expect(down[0]).toBeGreaterThan(26);
    const up = slideStep(26, 0, 0, 0, -0.4, 0, 30, 0.1);
    expect(up[0]).toBeLessThan(flat[0]);
  });

  it('steers only gently and never reverses within a step', () => {
    const [vx, vz] = slideStep(26, 0, -1, 0, 0, 0, 30, 1 / 60);
    expect(vx).toBeGreaterThan(25);
    expect(Math.abs(vz)).toBeLessThan(0.01);
    const [, sz] = slideStep(26, 0, 0, 1, 0, 0, 30, 1 / 60);
    expect(sz).toBeGreaterThan(0);
    expect(sz).toBeLessThan(26 * 0.05);
  });

  it('ends on release, airborne, slow or timeout', () => {
    expect(slideOver(20, 0.2, true, true)).toBe(false);
    expect(slideOver(20, 0.2, false, true)).toBe(true);
    expect(slideOver(20, 0.2, true, false)).toBe(true);
    expect(slideOver(KIT.slideExit - 0.1, 0.2, true, true)).toBe(true);
    expect(slideOver(20, KIT.slideMaxTime, true, true)).toBe(true);
  });

  it('a full slide on flat ground lasts long enough to matter and is finite', () => {
    let v: [number, number] = [KIT.slideSpeed, 0];
    let t = 0;
    while (!slideOver(Math.hypot(...v), t, true, true)) {
      v = slideStep(v[0], v[1], 1, 0, 0, 0, 30, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(0.8);
    expect(t).toBeLessThanOrEqual(KIT.slideMaxTime + 1 / 60);
  });
});

describe('wall-run rules', () => {
  it('needs a vertical wall and speed along it', () => {
    // Wall facing -x (drone on its -x side), running along +z.
    expect(wallRunnable(0, -1, 0, 0, 20)).toBe(true);
    expect(wallRunnable(0.8, -1, 0, 0, 20)).toBe(false); // a ramp/floor
    expect(wallRunnable(0, -1, 0, 0, KIT.wallMinSpeed - 1)).toBe(false);
    expect(wallRunnable(0, -1, 0, 20, 2)).toBe(false); // straight into it
  });

  it('runs along the wall at the run floor, keeping the direction', () => {
    const [vx, vz] = wallRunVelocity(3, 12, -1, 0);
    expect(vx).toBeCloseTo(0);
    expect(vz).toBeCloseTo(KIT.wallRunSpeed);
    const [, fast] = wallRunVelocity(0, -30, -1, 0);
    expect(fast).toBeCloseTo(-30);
  });

  it('wall jump pushes off and up, gravity ramps back during the run', () => {
    const [vx, vy, vz] = wallJump(0, 21, -1, 0);
    expect(vx).toBeCloseTo(-KIT.wallJumpOut);
    expect(vy).toBe(KIT.wallJumpUp);
    expect(vz).toBe(21);
    expect(wallGravity(0)).toBeCloseTo(KIT.wallGravity);
    expect(wallGravity(KIT.wallRunTime)).toBeGreaterThan(wallGravity(0.5));
    expect(wallGravity(99)).toBeLessThan(1);
  });

  it('leans the camera away from the wall', () => {
    // yaw 0: right = +x. Wall on the right has normal -x.
    expect(wallRollFor(-1, 0, 0)).toBe(KIT.wallRoll);
    expect(wallRollFor(1, 0, 0)).toBe(-KIT.wallRoll);
  });
});

describe('grapple rules', () => {
  it('pulls toward the anchor and caps the speed', () => {
    let v: [number, number, number] = [0, 0, 0];
    const p = [0, 1, 0];
    for (let i = 0; i < 120; i++) {
      v = grappleStep(p[0], p[1], p[2], 0, 6, 30, v[0], v[1], v[2], 1 / 60);
      expect(Math.hypot(...v)).toBeLessThanOrEqual(KIT.grappleMax + 1e-6);
    }
    expect(v[2]).toBeGreaterThan(20);
    expect(v[1]).toBeGreaterThan(0);
  });

  it('removes motion away from the anchor (the line does not stretch)', () => {
    const [, , vz] = grappleStep(0, 0, 0, 0, 0, 20, 0, 0, -30, 1 / 60);
    expect(vz).toBeGreaterThan(0);
  });

  it('a pull from 40 m reaches the release distance within its time budget', () => {
    const p = new Vector3(0, 1, 0);
    const a = new Vector3(0, 8, 40);
    let v: [number, number, number] = [0, 4, 0];
    let t = 0;
    while (!grappleOver(Vector3.Distance(p, a), t)) {
      v = grappleStep(p.x, p.y, p.z, a.x, a.y, a.z, v[0], v[1] - 30 / 60, v[2], 1 / 60);
      p.addInPlaceFromFloats(v[0] / 60, v[1] / 60, v[2] / 60);
      t += 1 / 60;
    }
    expect(Vector3.Distance(p, a)).toBeLessThanOrEqual(KIT.grappleRelease + 0.7);
    expect(t).toBeLessThan(KIT.grappleTime);
  });
});

describe('ground pound rules', () => {
  it('needs air time and no cooldown', () => {
    expect(canPound(false, KIT.poundAirTime, 0)).toBe(true);
    expect(canPound(true, 1, 0)).toBe(false);
    expect(canPound(false, 0.05, 0)).toBe(false);
    expect(canPound(false, 1, 0.2)).toBe(false);
  });

  it('grows with the fall, capped, and stays finite on bad input', () => {
    const low = poundBlast(0);
    const high = poundBlast(10);
    expect(high.radius).toBeGreaterThan(low.radius);
    expect(high.damage).toBeGreaterThan(low.damage);
    const huge = poundBlast(1e9);
    expect(huge.radius).toBe(KIT.poundRadiusMax);
    expect(huge.damage).toBe(KIT.poundDamageMax);
    for (const f of [NaN, -5, Infinity]) {
      const b = poundBlast(f);
      expect(Number.isFinite(b.radius) && Number.isFinite(b.damage)).toBe(true);
    }
    expect(poundBlast(4, 1.5).damage).toBeCloseTo(poundBlast(4).damage * 1.5);
  });
});

/** A drone body without Havok: walls are axis planes, the floor is y = 0. */
function fakeBody(walls: { x?: number }[] = []): KitBody & { pos: Vector3 } {
  const pos = new Vector3(0, 0.95, 0);
  const body = {
    hv: new Vector3(),
    vy: 0,
    airBoost: false,
    dashT: 0,
    yaw: 0,
    pos,
    get position() { return pos; }, // prettier-ignore
    get eye() { return pos.add(new Vector3(0, 0.55, 0)); }, // prettier-ignore
    capsuleRadius: 0.55,
    groundNormal: new Vector3(0, 1, 0),
    forward: (out = new Vector3()) => out.set(0, 0, 1),
    probe(a: Vector3, b: Vector3): ProbeHit | null {
      for (const w of walls) {
        if (w.x === undefined) continue;
        if ((a.x - w.x) * (b.x - w.x) > 0) continue;
        const t = (w.x - a.x) / (b.x - a.x);
        const point = a.add(b.subtract(a).scale(t));
        return { point, normal: new Vector3(a.x < w.x ? -1 : 1, 0, 0) };
      }
      if (b.z > 30) return { point: new Vector3(b.x, b.y, 30), normal: new Vector3(0, 0, -1) };
      return null;
    },
  };
  return body;
}

describe('MoveKit state machine', () => {
  it('slides from a run while Ctrl is held and stops on release', () => {
    const b = fakeBody();
    const k = new MoveKit(b);
    b.hv.set(0, 0, MOVE.runSpeed);
    k.tick(1 / 60, true);
    k.input(true, true, true, true, false, 0, 1, 1);
    expect(k.state).toBe('slide');
    expect(b.hv.length()).toBeCloseTo(KIT.slideSpeed);
    expect(k.velocity(1 / 60, 0, 1, 1)).toBe(true);
    k.tick(1 / 60, true);
    k.input(true, true, false, false, false, 0, 1, 1);
    expect(k.state).toBe('');
    expect(k.slideCd).toBeGreaterThan(0);
  });

  it('ground pound slams down and reports the fall height on landing', () => {
    const b = fakeBody();
    const k = new MoveKit(b);
    b.pos.y = 8;
    k.tick(0.3, false);
    k.input(true, false, true, true, false, 0, 0, 1);
    expect(k.state).toBe('pound');
    expect(b.vy).toBe(-KIT.poundSpeed);
    expect(k.vertical(1 / 60)).toBe(true);
    b.pos.y = 0.95;
    k.tick(1 / 60, true);
    expect(k.state).toBe('');
    expect(k.landed?.fall).toBeCloseTo(7.05);
    expect(k.poundCd).toBe(KIT.poundCooldown);
  });

  it('wall-runs beside a wall, then wall-jumps off it with the boost restored', () => {
    const b = fakeBody([{ x: 0.9 }]);
    const k = new MoveKit(b);
    b.hv.set(0, 0, 18);
    k.tick(0.2, false);
    k.input(true, false, false, false, false, 0, 1, 1);
    expect(k.state).toBe('wall');
    expect(b.airBoost).toBe(true);
    expect(k.wallN.x).toBe(-1);
    expect(k.vertical(1 / 60)).toBe(true);
    expect(b.vy).toBeLessThan(KIT.wallLift);
    expect(b.vy).toBeGreaterThan(0);
    k.velocity(1 / 60, 0, 1, 1);
    expect(b.hv.z).toBeCloseTo(KIT.wallRunSpeed);
    b.airBoost = false;
    expect(k.input(true, false, false, false, true, 0, 1, 1)).toBe(true);
    expect(k.state).toBe('');
    expect(b.hv.x).toBeLessThan(-5);
    expect(b.vy).toBe(KIT.wallJumpUp);
    expect(b.airBoost).toBe(true);
    // The same wall is off limits for a moment.
    k.tick(0.1, false);
    k.input(true, false, false, false, false, 0, 1, 1);
    expect(k.state).toBe('');
  });

  it('grapples to geometry ahead, misses into open air, and cools down', () => {
    const b = fakeBody();
    const k = new MoveKit(b);
    expect(k.fireGrapple()).toBe('hook');
    expect(k.state).toBe('grapple');
    expect(k.anchor.z).toBeCloseTo(29.4);
    for (let i = 0; i < 200 && k.state === 'grapple'; i++) {
      k.tick(1 / 60, false);
      k.velocity(1 / 60, 0, 0, 1);
      k.vertical(1 / 60);
      b.pos.addInPlaceFromFloats(b.hv.x / 60, b.vy / 60, b.hv.z / 60);
    }
    expect(k.state).toBe('');
    expect(b.pos.z).toBeGreaterThan(20);
    expect(k.grappleCd).toBe(KIT.grappleCooldown);
    expect(k.fireGrapple()).toBe('cooldown');
    const open = fakeBody();
    open.forward = (out = new Vector3()) => out.set(0, 0, -1);
    const k2 = new MoveKit(open);
    expect(k2.fireGrapple()).toBe('miss');
    expect(k2.grappleCd).toBe(KIT.grappleMissCooldown);
  });

  it('jumping off the line releases it with a hop', () => {
    const b = fakeBody();
    const k = new MoveKit(b);
    k.fireGrapple();
    b.vy = 0;
    expect(k.input(true, false, false, false, true, 0, 0, 1)).toBe(true);
    expect(k.state).toBe('');
    expect(b.vy).toBe(KIT.grappleHop);
  });
});
