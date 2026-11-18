import { Color3, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { isFrozen, isShocked, speedFactor } from '../combat/status';
import type { Turret } from '../defense/Turrets';
import { buildCrawler, buildJammer, type CrawlerRig, type JammerRig } from '../visuals/enemyModels';
import { type Behavior, type Enemy, type HitInfo, turnTowards } from './EnemyManager';

const TMP = new Vector3();
const disrupted = (e: Enemy) => isShocked(e.status) || isFrozen(e.status);

// ============================================================================ Jammer Drone

/**
 * Electronic-warfare drone (M7): the first machine that hunts the defences. It flies over the lanes,
 * peels off toward the nearest working tower, locks a telegraphed jamming beam onto it and keeps it
 * offline while channelling. Counterplay: kill it (fragile, weak dish), shock/freeze it, or burst it
 * (12% of its max HP during the lock-on breaks the beam). Jammed towers recover as soon as it stops.
 */
export const JAMMER = { altitude: 4.4, seek: 24, standoff: 9, lock: 1.2, channel: 5, cooldown: 4.5, interrupt: 0.12, reactorDps: 6 } as const;

interface JammerAI {
  rig: JammerRig;
  mode: 'fly' | 'approach' | 'lock' | 'jam' | 'cool';
  t: number;
  tower: Turret | null;
  line: number;
  taken: number;
  bob: number;
  atReactor: boolean;
}

export const jammerBehavior: Behavior = {
  create(e, m) {
    const rig = buildJammer(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
    m.addHitbox(e, e.root, e.def.bodyY, 0, e.def.bodyR, false);
    m.addHitbox(e, e.root, e.def.weakY, e.def.weakForward * e.def.scale, e.def.weakR, true, 'dish');
  },
  spawn(e) {
    Object.assign(e.ai, { mode: 'fly', t: 1.5, tower: null, line: 0, taken: 0, bob: Math.random() * 6, atReactor: false });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as JammerAI;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    const speed = e.def.speed * e.moveMult * sf;
    const stop = () => {
      if (ai.line) ctx.tele.cancel(ai.line);
      ai.line = 0;
      ai.tower = null;
    };
    if ((ai.mode === 'lock' || ai.mode === 'jam') && (disrupted(e) || ai.taken > e.maxHp * JAMMER.interrupt || !ai.tower || ai.tower.building)) {
      // Interrupted: beam drops, the tower reboots on its own.
      ctx.effects.burst('zap', e.center(TMP), 10);
      if (ai.taken > e.maxHp * JAMMER.interrupt) ctx.alert('JAMMER INTERRUPTED', 'blue');
      stop();
      ai.mode = 'cool';
      ai.t = JAMMER.cooldown;
    }
    switch (ai.mode) {
      case 'fly':
      case 'cool': {
        ai.t -= adt;
        if (!ai.atReactor) ai.atReactor = m.follow(e, speed, hdt, 4);
        else {
          // Over the reactor: low but steady interference damage.
          const R = ctx.layout.reactor;
          e.yaw = turnTowards(e.yaw, Math.atan2(R.x - e.pos.x, R.z - e.pos.z), hdt * 3);
          ctx.damageReactor(e.dmg(JAMMER.reactorDps) * adt, TMP.set(R.x, 3, R.z));
        }
        if (ai.t <= 0 && sf > 0.3) {
          let best: Turret | null = null;
          let bd = JAMMER.seek * JAMMER.seek;
          for (const t of ctx.towers) {
            if (t.building || t.disabled) continue;
            const d = (t.pos.x - e.pos.x) ** 2 + (t.pos.z - e.pos.z) ** 2;
            if (d < bd) {
              bd = d;
              best = t;
            }
          }
          if (best) {
            ai.tower = best;
            ai.mode = 'approach';
            ai.taken = 0;
          } else ai.t = 0.6;
        }
        break;
      }
      case 'approach': {
        const t = ai.tower!;
        const dx = t.pos.x - e.pos.x;
        const dz = t.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        e.yaw = turnTowards(e.yaw, Math.atan2(dx, dz), hdt * 4);
        if (d > JAMMER.standoff) {
          const step = Math.min(d - JAMMER.standoff, speed * 1.2 * hdt);
          e.pos.x += (dx / d) * step;
          e.pos.z += (dz / d) * step;
        } else {
          ai.mode = 'lock';
          ai.t = JAMMER.lock / e.rateMult;
          ai.taken = 0;
          rig(e).muzzle.computeWorldMatrix(true);
          ai.line = ctx.tele.line(rig(e).muzzle.getAbsolutePosition(), t.head, ai.t + JAMMER.channel, 'violet', 0.05);
          sfx.play('charge', { pitch: 1.6, volume: 0.6, pan: ctx.panFor(e.pos).pan });
        }
        break;
      }
      case 'lock':
      case 'jam': {
        const t = ai.tower!;
        e.yaw = turnTowards(e.yaw, Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z), hdt * 4);
        rig(e).muzzle.computeWorldMatrix(true);
        ctx.tele.moveLine(ai.line, rig(e).muzzle.getAbsolutePosition(), t.head, ai.mode === 'jam' ? 0.09 : 0.05);
        ai.t -= adt;
        if (ai.mode === 'lock' && ai.t <= 0) {
          ai.mode = 'jam';
          ai.t = JAMMER.channel;
          ctx.alert('TOWER JAMMED · DESTROY THE JAMMER DRONE', 'orange');
          sfx.play('arc', { pitch: 0.6, volume: 0.7, pan: ctx.panFor(t.pos).pan });
        }
        if (ai.mode === 'jam') {
          t.disable(0.35);
          if (Math.random() < hdt * 8) ctx.effects.burst('zap', t.head, 2, undefined, 0.7);
          if (ai.t <= 0) {
            stop();
            ai.mode = 'cool';
            ai.t = JAMMER.cooldown;
          }
        }
        break;
      }
    }
    // Presentation: hover bob, rotor, dish glow.
    ai.bob += hdt;
    const r = rig(e);
    r.body.position.y = JAMMER.altitude + Math.sin(ai.bob * 2.1) * 0.18;
    r.body.rotation.z = Math.sin(ai.bob * 1.4) * 0.08 + e.flinch * 0.3;
    r.rotor.rotation.y += hdt * 9;
    const charging = ai.mode === 'lock' || ai.mode === 'jam';
    r.emitter.scaling.setAll(charging ? 0.26 + Math.sin(ai.bob * 30) * 0.05 : 0.18);
    r.dish.rotation.x = charging ? -0.35 : -0.1;
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
  },
  damageMod(e, amount, info) {
    const ai = e.ai as unknown as JammerAI;
    if (!info.dot) ai.taken += amount;
    return amount;
  },
  release(e) {
    const ai = e.ai as unknown as JammerAI;
    ai.tower = null;
  },
};

// ============================================================================ Siege Crawler

/**
 * Siege Crawler (M7): a slow six-legged breacher. Its frontal prow blunts fire from the front (x0.5)
 * unless shocked or frozen, its rear carrier pods are the weakpoint, and it carries rush drones: two
 * spill out at half health and the rest when it is destroyed. At the reactor it drills for heavy damage.
 * Counterplay: flank it or let towers hit its rear, kill it before it reaches the reactor, prepare for
 * the drone release.
 */
export const CRAWLER = { frontCos: 0.35, frontMult: 0.5, drones: 2, deathDrones: 2 } as const;

interface CrawlerAI {
  rig: CrawlerRig;
  gait: number;
  released: boolean;
  atReactor: boolean;
  drill: number;
}

export const crawlerBehavior: Behavior = {
  create(e, m) {
    const rig = buildCrawler(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
    m.addHitbox(e, e.root, e.def.bodyY, 0.3, e.def.bodyR, false);
    m.addHitbox(e, e.root, e.def.weakY, e.def.weakForward * e.def.scale, e.def.weakR, true, 'pods');
  },
  spawn(e) {
    Object.assign(e.ai, { gait: Math.random() * 6, released: false, atReactor: false, drill: 1.5 });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as CrawlerAI;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    const before = e.pos.x + e.pos.z;
    if (!ai.atReactor) ai.atReactor = m.follow(e, e.def.speed * e.moveMult * sf * (1 - e.flinch * 0.2), hdt, 1.6);
    else {
      const R = ctx.layout.reactor;
      e.yaw = turnTowards(e.yaw, Math.atan2(R.x - e.pos.x, R.z - e.pos.z), hdt * 2);
      ai.drill -= adt;
      if (ai.drill <= 0) {
        ai.drill = e.def.attackInterval / e.rateMult;
        const at = TMP.set(R.x + (e.pos.x - R.x) * 0.5, 2, R.z + (e.pos.z - R.z) * 0.5);
        ctx.damageReactor(e.dmg(e.def.reactorDamage), at);
        ctx.effects.burst('sparks', at, 14, undefined, 1.1);
        ctx.effects.burst('enemySpark', at, 8);
        sfx.play('grind', { volume: ctx.panFor(at).volume, pan: ctx.panFor(at).pan });
      }
    }
    // Half health: the carrier pods open and release rush drones.
    if (!ai.released && e.hp < e.maxHp * 0.5) {
      ai.released = true;
      for (let i = 0; i < CRAWLER.drones; i++) ctx.summon('rusher', new Vector3(e.pos.x - Math.sin(e.yaw) * 2 + (i - 0.5) * 1.5, 0, e.pos.z - Math.cos(e.yaw) * 2));
      ctx.alert('SIEGE CRAWLER RELEASED ITS DRONES', 'orange');
      for (const p of (e.ai as unknown as CrawlerAI).rig.pods.slice(0, 2)) p.setEnabled(false);
    }
    // Gait: alternating tripod, speed-scaled.
    const moving = Math.abs(e.pos.x + e.pos.z - before) > 1e-4;
    ai.gait += adt * (moving ? 4.2 : 0.8);
    const r = ai.rig;
    for (const l of r.legs) {
      const ph = ai.gait + l.phase;
      l.hip.rotation.y = Math.sin(ph) * 0.35 * l.side;
      l.hip.rotation.z = l.side * (-0.5 + Math.max(0, Math.sin(ph + Math.PI / 2)) * 0.25);
    }
    r.body.position.y = 1.25 + Math.abs(Math.sin(ai.gait * 2)) * 0.06 - e.flinch * 0.1;
    r.drill.rotation.z += hdt * (ai.atReactor ? 14 : 2);
    r.glow.scaling.x = 1.4 * (0.8 + 0.2 * Math.sin(ai.gait * 3));
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
  },
  damageMod(e, amount, info: HitInfo) {
    if (info.weak || info.dot || isShocked(e.status) || isFrozen(e.status)) return amount;
    const src = info.from ?? info.point;
    const dx = src.x - e.pos.x;
    const dz = src.z - e.pos.z;
    const l = Math.hypot(dx, dz);
    if (l > 0.3 && (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / l > CRAWLER.frontCos) return amount * CRAWLER.frontMult;
    return amount;
  },
  death(e, ctx) {
    const ai = e.ai as unknown as CrawlerAI;
    const n = CRAWLER.deathDrones + (ai.released ? 0 : CRAWLER.drones);
    for (let i = 0; i < n; i++) ctx.summon('rusher', new Vector3(e.pos.x + (Math.random() - 0.5) * 3, 0, e.pos.z + (Math.random() - 0.5) * 3));
    const c = e.center(new Vector3());
    ctx.effects.explode(c, { scale: 1.9, debris: 18, color: new Color3(2.8, 1.1, 0.2) });
    sfx.play('explosion', { volume: ctx.panFor(c).volume, pitch: 0.6, pan: ctx.panFor(c).pan });
    return true;
  },
};

const rig = (e: Enemy) => (e.ai as unknown as JammerAI).rig;

export const M7_BEHAVIORS = { jammer: jammerBehavior, crawler: crawlerBehavior } as const;
