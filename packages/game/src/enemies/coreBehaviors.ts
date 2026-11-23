// Core ground archetypes: Walker / Bulwark (bipedal rig, shoots the player, fires at the reactor) and Rush Drone
// (flies the lane and detonates on the player or the reactor). Same Behavior interface as every other enemy.
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { sfx } from '../audio/Sfx';
import { speedFactor } from '@riftwarden/rules/combat/status';
import type { Effects } from '../fx/Effects';
import { buildRusher, buildWalker } from '../visuals/models';
import { type Behavior, clampAngle, type Enemy, type EnemyContext, type EnemyManager, turnTowards } from './EnemyManager';
import { hasLost, LIMB_EFFECT } from '@riftwarden/rules/enemies/limbs';

const TMP = new Vector3();
const TMP2 = new Vector3();
/** Walker / Bulwark plasma shot: wind-up telegraph (s) and bolt speed (m/s). Fast, but a dash still clears it. */
const SHOT_CHARGE = 0.48;
const BOLT_SPEED = { walker: 28, bulwark: 31 };

export function updateCore(e: Enemy, hdt: number, ctx: EnemyContext, m: EnemyManager): void {
  const def = e.def;
  const player = ctx.player;
  const ppos = player.position;
  // Statuses: chill slows, shock disrupts briefly, freeze stops movement, attacks and animation.
  const sf = speedFactor(e.status);
  const adt = hdt * sf * e.rateMult;
  const slow = (1 - e.flinch * 0.5) * sf;
  if (e.state === 'move') {
    const reached = m.follow(e, def.speed * e.moveMult * slow, hdt, e.kind === 'rusher' ? 10 : 5);
    if (reached) {
      if (e.kind === 'rusher') {
        ctx.damageReactor(e.dmg(def.reactorDamage), e.center(TMP2));
        m.kill(e, ctx.effects, ctx, true);
        return;
      }
      e.state = 'attack';
    }
    // Rush drones detonate on the player.
    if (e.kind === 'rusher' && player.alive) {
      const c = e.center(TMP);
      if (Vector3.DistanceSquared(c, ppos) < 2.3 * 2.3) {
        ctx.hurtPlayer(e.dmg(def.playerDamage), e.pos);
        TMP2.copyFrom(ppos).subtractInPlace(c).normalize();
        player.knockback(TMP2, 9);
        m.kill(e, ctx.effects, ctx, true);
        return;
      }
    }
  } else {
    // Attack the reactor
    const desiredYaw = Math.atan2(ctx.layout.reactor.x - e.pos.x, ctx.layout.reactor.z - e.pos.z);
    e.yaw = turnTowards(e.yaw, desiredYaw, hdt * 4);
    e.attackT -= adt;
    if (e.attackT <= 0) {
      e.attackT = def.attackInterval;
      const muzzle = m.muzzlePos(e, TMP);
      e.motion?.fire();
      ctx.effects.burst('flash', muzzle, 1, undefined, 0.22);
      const target = TMP2.set(ctx.layout.reactor.x, 3, ctx.layout.reactor.z);
      target.subtractInPlace(muzzle).normalize().scaleInPlace(2.2).addInPlace(muzzle);
      ctx.effects.tracer(muzzle, target.set(ctx.layout.reactor.x, 3 + Math.random(), ctx.layout.reactor.z), 2, 0.12, 0.12);
      ctx.effects.burst('enemySpark', target, 8);
      ctx.damageReactor(e.dmg(def.reactorDamage) * (hasLost(e.limbsLost, 'cannon') ? LIMB_EFFECT.disarmedReactor : 1), target);
      const a = ctx.panFor(muzzle);
      sfx.play('enemyShot', { volume: a.volume * 0.6, pan: a.pan });
    }
  }

  // Walkers fire telegraphed plasma bolts at the player when they have line of sight.
  // A walker that lost its cannon or its sensor head cannot shoot the drone any more.
  if (e.walker && player.alive && def.playerShotInterval > 0 && !hasLost(e.limbsLost, 'cannon') && !hasLost(e.limbsLost, 'head')) {
    if (e.chargeT > 0) {
      e.chargeT -= adt;
      if (e.chargeT <= 0) {
        const muzzle = m.muzzlePos(e, TMP);
        const aim = TMP2.copyFrom(player.eye);
        aim.y -= 0.35;
        aim.subtractInPlace(muzzle).normalize().scaleInPlace(e.kind === 'bulwark' ? BOLT_SPEED.bulwark : BOLT_SPEED.walker);
        ctx.effects.spawnProjectile(muzzle, aim, e.dmg(def.playerDamage));
        e.motion?.fire();
        ctx.effects.burst('flash', muzzle, 1, undefined, e.kind === 'bulwark' ? 0.3 : 0.23);
        const a = ctx.panFor(muzzle);
        sfx.play('enemyShot', { volume: a.volume, pan: a.pan });
      }
    } else {
      e.shotT -= adt;
      if (e.shotT <= 0) {
        e.shotT = def.playerShotInterval * (0.8 + Math.random() * 0.4);
        const c = e.center(TMP);
        const d2 = Vector3.DistanceSquared(c, ppos);
        if (d2 < def.playerShotRange * def.playerShotRange && ctx.los(c, player.eye)) e.chargeT = SHOT_CHARGE;
      }
    }
  }

  animateCore(e, adt, ppos, ctx.effects);
}

export function animateCore(e: Enemy, hdt: number, ppos: Vector3, fx: Effects): void {
  const turnRate = clampAngle(e.yaw - e.root.rotation.y, Math.PI) / Math.max(1 / 240, hdt);
  e.root.position.copyFrom(e.pos);
  e.root.rotation.y = e.yaw;
  e.phase += hdt;
  if (e.walker) {
    const w = e.walker;
    const dx = ppos.x - e.pos.x;
    const dz = ppos.z - e.pos.z;
    const look = Math.atan2(dx, dz) - e.yaw;
    w.head.rotation.y = clampAngle(look, 0.7);
    const charge = e.chargeT > 0 ? 1 - e.chargeT / SHOT_CHARGE : 0;
    const aimPitch = e.state === 'attack' ? 0.10 : Math.max(-0.15, Math.min(0.22, (e.pos.y + 1.9 - ppos.y) / Math.max(2, Math.hypot(dx, dz))));
    e.motion!.crawl = hasLost(e.limbsLost, 'leg');
    const planted = e.motion!.pose(e.pos, e.yaw, hdt * (e.boostT > 0 ? 1.6 : 1), e.state === 'move', charge, e.flinch, aimPitch);
    if (e.kind === 'bulwark') w.torso.rotation.x += charge * 0.065;
    const d2 = dx * dx + dz * dz;
    if (planted && d2 < 18 * 18) fx.burst('puff', planted, e.kind === 'bulwark' ? 3 : 1, undefined, 0.6);
    // M7: heavy mechanical footfalls (nearby only; the sound bank rate-limits and caps voices).
    if (planted && d2 < 26 * 26) sfx.play('step', { volume: (1 - Math.sqrt(d2) / 26) * (e.kind === 'bulwark' ? 0.9 : 0.5), pitch: e.kind === 'bulwark' ? 0.75 : 1 });
    if (w.shield) {
      const s = e.shieldFlash;
      w.shield.scaling.set(3.6 + s * 0.3, 3.9 + s * 0.3, 3.6 + s * 0.3);
      w.shield.visibility = 0.55 + s * 0.45;
    }
  } else if (e.drone) {
    const d = e.drone;
    d.body.position.y = 1.3 + Math.sin(e.phase * 7) * 0.12;
    d.body.position.x = Math.sin(e.phase * 3.1) * 0.35;
    const bank = Math.max(-0.38, Math.min(0.38, turnRate * .11));
    const roll = Math.cos(e.phase * 3.1) * -0.20 + bank + e.flinch * .6;
    d.body.rotation.z += (roll - d.body.rotation.z) * (1 - Math.exp(-hdt * 12));
    d.body.rotation.x = 0.18 + e.flinch * -0.5 + (e.boostT > 0 ? 0.3 : 0);
    d.ring.rotation.y = e.phase * 12;
  }
}

const walker = (bulwark: boolean): Behavior => ({
  rig(m) {
    const rig = buildWalker(m.kit, m.P, bulwark);
    return { root: rig.root, walker: rig };
  },
  spawn() {},
  update: updateCore,
});

export const rusherBehavior: Behavior = {
  rig(m) {
    const rig = buildRusher(m.kit, m.P);
    return { root: rig.root, drone: rig };
  },
  spawn() {},
  update: updateCore,
};

/** Registered by Game together with the M6/M7 behaviours. */
export const CORE_BEHAVIORS = { walker: walker(false), bulwark: walker(true), rusher: rusherBehavior } as const;
