// M10 faction archetypes: Sapper (tower hunter), Skimmer (swarm flyer), Marksman (sniper), Burrower (tunneler).
// Same Behavior interface as every other enemy; state in `e.ai` (primitive fields replicate to co-op replicas).
import { Color3, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { isFrozen, isShocked, speedFactor } from '../combat/status';
import type { Turret } from '../defense/Turrets';
import { buildCrawler, type CrawlerRig, enemyMats } from '../visuals/enemyModels';
import { buildRusher, buildWalker } from '../visuals/models';
import { animateCore, updateCore } from './coreBehaviors';
import { hasLost } from './limbs';
import { type Behavior, type Enemy, type EnemyContext, type EnemyManager, turnTowards } from './EnemyManager';

const TMP = new Vector3();
const TMP2 = new Vector3();
const disrupted = (e: Enemy) => isShocked(e.status) || isFrozen(e.status);

// ============================================================================ Sapper

/**
 * Tower hunter. Walks its lane like a strider (no gun) until a tower comes into view within `seek` m, then
 * sprints straight at it, plants a charge (telegraphed ring, `fuse` s) and detonates with it: heavy tower
 * damage (wrecks a fresh standard tower), suppression around it and a sting for a drone standing too close.
 * At the reactor it detonates there. Counterplay: kill it en route (weak charge pack on its back), or shock /
 * freeze it to hold the fuse.
 */
export const SAPPER = { seek: 18, fuse: 2, charge: 460, blast: 4, playerDamage: 18, disable: 2.5 } as const;

interface SapperAI {
  mode: 'lane' | 'hunt' | 'plant';
  tower: Turret | null;
  t: number;
  scan: number;
  mark: number;
}

function sapperDetonate(e: Enemy, ctx: EnemyContext, m: EnemyManager, at: Vector3, tower: Turret | null): void {
  if (tower) ctx.damageTower?.(tower, e.dmg(SAPPER.charge));
  ctx.hostileBlast(at, SAPPER.blast, { player: e.dmg(SAPPER.playerDamage), disable: SAPPER.disable, color: 'orange', owner: e });
  ctx.effects.explode(at.add(new Vector3(0, 1, 0)), { scale: 1.3, debris: 10, color: new Color3(3, 1.2, 0.2), style: 'heavy' });
  m.kill(e, ctx.effects, ctx, true);
}

export const sapperBehavior: Behavior = {
  rig(m) {
    const rig = buildWalker(m.kit, m.P, false);
    const M = enemyMats(m.P.white.getScene(), m.P);
    // Charge pack on the back: casing, two straps and a hot core (the weakpoint).
    m.kit.part('box', m.P.graphite, rig.torso, { pos: [0, 0.15, -0.42], scale: [0.7, 0.62, 0.34] });
    for (const x of [-0.24, 0.24]) m.kit.part('box', M.plate, rig.torso, { pos: [x, 0.15, -0.6], scale: [0.08, 0.66, 0.06] });
    m.kit.part('sphere', M.chargeRed, rig.torso, { pos: [0, 0.2, -0.62], scale: [0.26, 0.26, 0.26], shadow: false });
    return { root: rig.root, walker: rig };
  },
  spawn(e) {
    Object.assign(e.ai, { mode: 'lane', tower: null, t: 0, scan: 0.5, mark: 0 });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as SapperAI;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    if (ai.mode === 'lane') {
      if (e.state === 'attack') {
        // Reached the reactor ring: blow the charge on the reactor.
        const R = ctx.layout.reactor;
        ctx.damageReactor(e.dmg(e.def.reactorDamage), TMP.set(R.x, 2, R.z));
        sapperDetonate(e, ctx, m, new Vector3(e.pos.x, 0, e.pos.z), null);
        return;
      }
      updateCore(e, hdt, ctx, m);
      ai.scan -= hdt;
      if (ai.scan <= 0) {
        ai.scan = 0.4;
        const c = e.center(TMP);
        let best: Turret | null = null;
        let bd = SAPPER.seek * SAPPER.seek;
        for (const t of ctx.towers) {
          if (t.building || t.wrecked) continue;
          const d = (t.pos.x - e.pos.x) ** 2 + (t.pos.z - e.pos.z) ** 2;
          if (d < bd && ctx.los(c, t.head)) {
            bd = d;
            best = t;
          }
        }
        if (best) {
          ai.tower = best;
          ai.mode = 'hunt';
          sfx.play('beep', { pitch: 1.4, volume: 0.5, pan: ctx.panFor(c).pan });
        }
      }
      return;
    }
    const t = ai.tower;
    if (!t || t.wrecked || !ctx.towers.includes(t)) {
      // Target gone: back to the lane (re-plan from here on procedural arenas).
      if (ai.mark) ctx.tele.cancel(ai.mark);
      ai.mark = 0;
      ai.tower = null;
      ai.mode = 'lane';
      e.navV = -1;
      return;
    }
    const dx = t.pos.x - e.pos.x;
    const dz = t.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    e.yaw = turnTowards(e.yaw, Math.atan2(dx, dz), hdt * 6);
    if (ai.mode === 'hunt') {
      const reach = t.radius + e.def.radius + 0.3;
      if (d > reach) {
        const step = Math.min(d - reach, e.def.speed * 1.15 * e.moveMult * sf * hdt);
        e.pos.x += (dx / d) * step;
        e.pos.z += (dz / d) * step;
      } else {
        ai.mode = 'plant';
        ai.t = SAPPER.fuse;
        ai.mark = ctx.tele.marker(new Vector3(t.pos.x, t.pos.y, t.pos.z), SAPPER.blast, SAPPER.fuse, 'orange');
        ctx.alert('SAPPER PLANTING A CHARGE', 'orange');
        sfx.play('charge', { pitch: 1.2, volume: 0.7, pan: ctx.panFor(t.pos).pan });
      }
      e.state = 'move';
    } else {
      // Planting: shock / freeze holds the fuse.
      if (!disrupted(e)) ai.t -= adt;
      e.state = 'attack';
      if (Math.random() < hdt * 6) ctx.effects.burst('sparks', t.head, 2, undefined, 0.6);
      if (ai.t <= 0) {
        ai.mark = 0;
        sapperDetonate(e, ctx, m, new Vector3(t.pos.x, t.pos.y, t.pos.z), t);
        return;
      }
    }
    animateCore(e, adt, ctx.player.position, ctx.effects);
  },
  release(e, m) {
    const ai = e.ai as unknown as SapperAI;
    ai.tower = null;
    void m;
  },
};

// ============================================================================ Skimmer

/**
 * Swarm flyer. Rides the lane fast and low; when the drone is within `aggro` m and in sight it swoops at it,
 * pecks on contact (small damage, a nudge) and peels away, then comes around again. At the reactor it rams it.
 * Fragile: sweep the swarm with beams, scatter or arcs.
 */
export const SKIMMER = { aggro: 24, peel: 0.9, contact: 1.7, hover: 1.3, leash: 40 } as const;

interface SkimmerAI {
  mode: 'lane' | 'swoop' | 'peel';
  t: number;
  scan: number;
  ox: number;
  oz: number;
  atReactor: boolean;
}

export const skimmerBehavior: Behavior = {
  rig(m) {
    const rig = buildRusher(m.kit, m.P);
    rig.body.scaling.setAll(0.62);
    return { root: rig.root, drone: rig };
  },
  spawn(e) {
    Object.assign(e.ai, { mode: 'lane', t: 0, scan: Math.random() * 0.5, ox: 0, oz: 0, atReactor: false });
    e.pos.y = 0;
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as SkimmerAI;
    const sf = speedFactor(e.status);
    const speed = e.def.speed * e.moveMult * sf;
    const p = ctx.player;
    if (ai.mode === 'lane') {
      e.pos.y += (0 - e.pos.y) * Math.min(1, hdt * 3);
      if (!ai.atReactor && m.follow(e, speed, hdt, 9)) {
        ai.atReactor = true;
        ctx.damageReactor(e.dmg(e.def.reactorDamage), e.center(TMP));
        m.kill(e, ctx.effects, ctx, true);
        return;
      }
      ai.scan -= hdt;
      if (ai.scan <= 0) {
        ai.scan = 0.3;
        const c = e.center(TMP);
        if (p.alive && Vector3.DistanceSquared(c, p.eye) < SKIMMER.aggro ** 2 && ctx.los(c, p.eye)) ai.mode = 'swoop';
      }
    } else if (ai.mode === 'swoop') {
      const c = e.center(TMP);
      const to = TMP2.copyFrom(p.eye).subtractInPlace(c);
      const d = to.length();
      if (!p.alive || d > SKIMMER.leash) {
        ai.mode = 'lane';
        e.navV = -1;
      } else if (d < SKIMMER.contact) {
        ctx.hurtPlayer(e.dmg(e.def.playerDamage), c);
        p.knockback(to.normalize(), 3);
        ctx.effects.burst('sparks', c, 4, undefined, 0.6);
        ai.mode = 'peel';
        ai.t = SKIMMER.peel;
        ai.ox = -to.x;
        ai.oz = -to.z;
      } else {
        to.scaleInPlace(1 / d);
        const step = speed * 1.1 * hdt;
        e.pos.x += to.x * step;
        e.pos.z += to.z * step;
        e.pos.y = Math.max(0, Math.min(6, e.pos.y + to.y * step));
        e.yaw = turnTowards(e.yaw, Math.atan2(to.x, to.z), hdt * 10);
      }
    } else {
      ai.t -= hdt;
      const l = Math.hypot(ai.ox, ai.oz) || 1;
      e.pos.x += (ai.ox / l) * speed * 0.8 * hdt;
      e.pos.z += (ai.oz / l) * speed * 0.8 * hdt;
      e.pos.y = Math.min(6, e.pos.y + 3 * hdt);
      e.yaw = turnTowards(e.yaw, Math.atan2(ai.ox, ai.oz), hdt * 8);
      if (ai.t <= 0) ai.mode = 'swoop';
    }
    animateCore(e, hdt * sf, p.position, ctx.effects);
  },
};

// ============================================================================ Marksman

/**
 * Sniper frame. Walks its lane; when the drone is in sight within range it plants, paints it with a red laser
 * for `aim` s (the laser thickens as it locks) and fires one heavy round. Breaking line of sight for `lose` s
 * cancels the shot; shock or freeze cancels it too. Then it cools down and moves on.
 */
export const MARKSMAN = { aim: 1.6, lose: 0.35, cooldown: 4, scan: 0.5 } as const;

interface MarksmanAI {
  mode: 'walk' | 'aim' | 'cool';
  t: number;
  scan: number;
  blind: number;
  line: number;
}

export const marksmanBehavior: Behavior = {
  rig(m) {
    const rig = buildWalker(m.kit, m.P, false);
    const M = enemyMats(m.P.white.getScene(), m.P);
    // Long rail barrel, muzzle brake and a red scope lens on the cannon arm.
    m.kit.part('cyl8', m.P.metal, rig.barrel, { pos: [0, 0, 0.55], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.9, 0.07] });
    m.kit.part('box', m.P.graphite, rig.barrel, { pos: [0, 0, 1.0], scale: [0.16, 0.12, 0.18] });
    m.kit.part('sphere', M.red, rig.cannon, { pos: [0, 0.2, 0.1], scale: [0.12, 0.12, 0.12], shadow: false });
    return { root: rig.root, walker: rig };
  },
  spawn(e) {
    Object.assign(e.ai, { mode: 'walk', t: 0, scan: MARKSMAN.scan, blind: 0, line: 0 });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as MarksmanAI;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    const p = ctx.player;
    const cancel = (cool: number) => {
      if (ai.line) ctx.tele.cancel(ai.line);
      ai.line = 0;
      ai.mode = 'cool';
      ai.t = cool;
      e.state = 'move';
    };
    if (ai.mode !== 'aim') {
      updateCore(e, hdt, ctx, m);
      if (ai.mode === 'cool') {
        ai.t -= adt;
        if (ai.t <= 0) ai.mode = 'walk';
      } else if (e.state === 'move') {
        ai.scan -= hdt;
        if (ai.scan <= 0) {
          ai.scan = MARKSMAN.scan;
          const muzzle = m.muzzlePos(e, TMP);
          // A marksman whose sensor head was shot off can no longer paint the drone.
          if (p.alive && !hasLost(e.limbsLost, 'head') && Vector3.DistanceSquared(muzzle, p.eye) < e.def.playerShotRange ** 2 && ctx.los(muzzle, p.eye) && !disrupted(e)) {
            ai.mode = 'aim';
            ai.t = MARKSMAN.aim / e.rateMult;
            ai.blind = 0;
            ai.line = ctx.tele.line(muzzle, p.eye, ai.t + 0.2, 'red', 0.02);
            sfx.play('railCharge', { volume: 0.5 * ctx.panFor(muzzle).volume, pan: ctx.panFor(muzzle).pan });
          }
        }
      }
      return;
    }
    // Aiming: planted, tracking the drone with the laser.
    const muzzle = m.muzzlePos(e, TMP);
    e.state = 'attack';
    e.yaw = turnTowards(e.yaw, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), hdt * 5);
    if (disrupted(e) || !p.alive) {
      cancel(MARKSMAN.cooldown * 0.5);
      return;
    }
    const sees = ctx.los(muzzle, p.eye);
    ai.blind = sees ? 0 : ai.blind + hdt;
    if (ai.blind > MARKSMAN.lose) {
      ctx.alert('MARKSMAN LOST ITS LOCK', 'white');
      cancel(MARKSMAN.cooldown * 0.6);
      return;
    }
    ai.t -= adt;
    const k = 1 - Math.max(0, ai.t) / MARKSMAN.aim;
    ctx.tele.moveLine(ai.line, muzzle, p.eye, 0.02 + k * 0.07);
    if (ai.t <= 0) {
      const target = TMP2.copyFrom(p.eye);
      ctx.effects.tracer(muzzle, target, 2, 0.2, 0.18);
      ctx.effects.burst('flash', muzzle, 1, undefined, 0.35);
      if (sees) ctx.hurtPlayer(e.dmg(e.def.playerDamage), muzzle.clone());
      sfx.play('railFire', { volume: ctx.panFor(muzzle).volume, pan: ctx.panFor(muzzle).pan, pitch: 0.8 });
      e.motion?.fire();
      cancel(MARKSMAN.cooldown);
      return;
    }
    animateCore(e, adt, p.position, ctx.effects);
    e.state = 'attack';
  },
  release(e) {
    (e.ai as unknown as MarksmanAI).line = 0;
  },
};

// ============================================================================ Burrower

/**
 * Tunneler. Travels buried (untargetable, unhittable: towers ignore it) along the terrain field, so mazes and
 * tower walls do not stop it; a dirt wake shows where it is. It surfaces every few seconds to breathe and fire
 * at the drone (`up` s, vulnerable, weak drill head in front), and for good near the reactor, where it drills.
 * Counterplay: burst it while it is up, read the wake.
 */
export const BURROWER = { down: 5.5, up: 3.2, rise: 0.55, depth: 2.4, surfaceAt: 11, bolt: 26 } as const;

interface BurrowerAI {
  rig: CrawlerRig;
  mode: 'buried' | 'rising' | 'up' | 'diving' | 'reactor';
  t: number;
  gait: number;
  shot: number;
  wake: number;
}

function setBuried(e: Enemy, buried: boolean): void {
  e.hidden = buried;
  for (const h of e.hitboxes) h.isPickable = !buried;
}

export const burrowerBehavior: Behavior = {
  create(e, m) {
    const rig = buildCrawler(m.kit, m.P);
    rig.root.parent = e.root;
    rig.root.scaling.setAll(0.72);
    for (const p of rig.pods) p.setEnabled(false);
    e.ai.rig = rig;
    m.addHitbox(e, e.root, e.def.bodyY, 0, e.def.bodyR, false);
    m.addHitbox(e, e.root, e.def.weakY, e.def.weakForward, e.def.weakR, true, 'drill');
  },
  spawn(e) {
    Object.assign(e.ai, { mode: 'buried', t: BURROWER.down * (0.6 + Math.random() * 0.5), gait: Math.random() * 6, shot: 1, wake: 0 });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as BurrowerAI;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    const speed = e.def.speed * e.moveMult * sf;
    // Near the reactor it surfaces for good.
    if (ai.mode !== 'reactor' && ai.mode !== 'rising' && e.remaining < BURROWER.surfaceAt && e.remaining > 0) {
      ai.mode = 'rising';
      ai.t = BURROWER.rise;
    }
    switch (ai.mode) {
      case 'buried': {
        if (m.follow(e, speed * 1.1, hdt, 3)) {
          ai.mode = 'rising';
          ai.t = BURROWER.rise;
        }
        ai.t -= adt;
        if (ai.t <= 0) {
          ai.mode = 'rising';
          ai.t = BURROWER.rise;
          sfx.play('grind', { volume: 0.6 * ctx.panFor(e.pos).volume, pan: ctx.panFor(e.pos).pan, pitch: 1.2 });
        }
        ai.wake -= hdt;
        if (ai.wake <= 0) {
          ai.wake = 0.12;
          ctx.effects.burst('puff', TMP.set(e.pos.x, 0.2, e.pos.z), 2, undefined, 0.9);
        }
        break;
      }
      case 'rising':
      case 'diving': {
        ai.t -= hdt;
        if (ai.t <= 0) {
          if (ai.mode === 'diving') {
            ai.mode = 'buried';
            ai.t = BURROWER.down;
          } else {
            ai.mode = e.remaining < BURROWER.surfaceAt ? 'reactor' : 'up';
            ai.t = BURROWER.up;
            ctx.effects.debrisBurst(TMP.set(e.pos.x, 0.4, e.pos.z), 8, 5, 0.8);
          }
        }
        break;
      }
      case 'up':
      case 'reactor': {
        if (ai.mode === 'up') {
          m.follow(e, speed * 0.35, hdt, 3);
          ai.t -= adt;
          if (ai.t <= 0) {
            ai.mode = 'diving';
            ai.t = BURROWER.rise;
          }
        } else if (!m.follow(e, speed * 0.6, hdt, 3)) {
          // still closing in
        } else {
          const R = ctx.layout.reactor;
          e.yaw = turnTowards(e.yaw, Math.atan2(R.x - e.pos.x, R.z - e.pos.z), hdt * 2);
          e.attackT -= adt;
          if (e.attackT <= 0) {
            e.attackT = e.def.attackInterval;
            const at = TMP.set(R.x + (e.pos.x - R.x) * 0.5, 2, R.z + (e.pos.z - R.z) * 0.5);
            ctx.damageReactor(e.dmg(e.def.reactorDamage), at);
            ctx.effects.burst('sparks', at, 10, undefined, 1);
          }
        }
        // Fires plasma bolts at the drone while surfaced.
        ai.shot -= adt;
        if (ai.shot <= 0) {
          ai.shot = e.def.playerShotInterval;
          const c = e.center(TMP);
          const p = ctx.player;
          if (p.alive && Vector3.DistanceSquared(c, p.eye) < e.def.playerShotRange ** 2 && ctx.los(c, p.eye)) {
            const vel = TMP2.copyFrom(p.eye).subtractInPlace(c).normalize().scaleInPlace(BURROWER.bolt);
            ctx.effects.spawnProjectile(c.clone(), vel.clone(), e.dmg(e.def.playerDamage));
            ctx.effects.burst('flash', c, 1, undefined, 0.25);
          }
        }
        break;
      }
    }
    // Buried state (replicated through `ai.mode`, so co-op replicas agree on what can be hit).
    setBuried(e, ai.mode === 'buried');
    const depth = ai.mode === 'buried' ? 1 : ai.mode === 'rising' ? Math.max(0, ai.t / BURROWER.rise) : ai.mode === 'diving' ? 1 - Math.max(0, ai.t / BURROWER.rise) : 0;
    const r = ai.rig;
    ai.gait += adt * 4;
    for (const l of r.legs) {
      const ph = ai.gait + l.phase;
      l.hip.rotation.y = Math.sin(ph) * 0.35 * l.side;
      l.hip.rotation.z = l.side * (-0.5 + Math.max(0, Math.sin(ph + Math.PI / 2)) * 0.25);
    }
    r.drill.rotation.z += hdt * (depth > 0.2 ? 18 : 6);
    r.body.position.y = 1.25 - depth * BURROWER.depth / 0.72;
    r.root.rotation.x = depth > 0 && depth < 1 ? -0.35 : 0;
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
  },
  release(e) {
    setBuried(e, false);
  },
};

export const FACTION_BEHAVIORS = { sapper: sapperBehavior, skimmer: skimmerBehavior, marksman: marksmanBehavior, burrower: burrowerBehavior } as const;

