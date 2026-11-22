import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { sfx } from '../audio/Sfx';
import { isFrozen, isShocked, speedFactor } from '@riftwarden/rules/combat/status';
import { EVENT_TUNING } from '@riftwarden/rules/survival/events';
import { buildArtillery, buildCourier, buildEnforcer, buildEngineer, type ArtilleryRig, type CourierRig, type EnforcerRig, type EngineerRig } from '../visuals/enemyModels';
import { type Behavior, clampAngle, type Enemy, type HitInfo, turnTowards } from './EnemyManager';

const TMP = new Vector3();
const TMP2 = new Vector3();
const disrupted = (e: Enemy) => isShocked(e.status) || isFrozen(e.status);

/** Facing test for directional defences: is `from` within the frontal cone (cos > `cos`) of the enemy? */
function fromFront(e: Enemy, info: HitInfo, cos: number): boolean {
  const src = info.from ?? info.point;
  const dx = src.x - e.pos.x;
  const dz = src.z - e.pos.z;
  const l = Math.hypot(dx, dz);
  if (l < 0.3) return false;
  return (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / l > cos;
}

// ============================================================================ Shielded Enforcer

interface EnforcerAI {
  rig: EnforcerRig;
  mode: 'move' | 'wind' | 'recover';
  t: number;
  cd: number;
  scan: number;
  aim: Vector3;
  marker: number;
  lower: number;
  atReactor: boolean;
  wheel: number;
}
export const ENFORCER = { windup: 1.25, recover: 0.9, radius: 4.6, reach: 3.6, scanPlayer: 7, scanTower: 8, frontCos: 0.3, frontMult: 0.2, exposedMult: 1.3, disable: 5 } as const;

export const enforcerBehavior: Behavior = {
  create(e, m) {
    const rig = buildEnforcer(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
    // Rear generator weakpoint + body; the chest vent is a second weakpoint that only matters when exposed.
    m.addHitbox(e, e.root, e.def.bodyY, 0, e.def.bodyR, false);
    m.addHitbox(e, e.root, e.def.weakY, e.def.weakForward * e.def.scale, e.def.weakR, true, 'generator');
  },
  spawn(e) {
    const ai = e.ai as unknown as EnforcerAI;
    Object.assign(ai, { mode: 'move', t: 0, cd: 1.5, scan: 0, aim: new Vector3(), marker: 0, lower: 0, atReactor: false, wheel: 0 });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as EnforcerAI;
    const def = e.def;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    const before = e.pos.clone();
    if (ai.mode === 'move') {
      ai.cd -= adt;
      ai.scan -= hdt;
      if (!ai.atReactor) ai.atReactor = m.follow(e, def.speed * e.moveMult * sf * (1 - e.flinch * 0.3), hdt, 3);
      if (ai.atReactor) {
        const dy = Math.atan2(ctx.layout.reactor.x - e.pos.x, ctx.layout.reactor.z - e.pos.z);
        e.yaw = turnTowards(e.yaw, dy, hdt * 3);
      }
      if (ai.cd <= 0 && ai.scan <= 0 && sf > 0.2) {
        ai.scan = 0.3;
        let tx: number | null = null;
        let tz = 0;
        const pp = ctx.player.position;
        if (ctx.player.alive && (pp.x - e.pos.x) ** 2 + (pp.z - e.pos.z) ** 2 < ENFORCER.scanPlayer ** 2 && pp.y < 4) {
          tx = pp.x;
          tz = pp.z;
        } else {
          for (const t of ctx.towers) {
            if (t.building || t.disabled) continue;
            if ((t.pos.x - e.pos.x) ** 2 + (t.pos.z - e.pos.z) ** 2 < ENFORCER.scanTower ** 2 && t.pos.y < 1) {
              tx = t.pos.x;
              tz = t.pos.z;
              break;
            }
          }
          if (tx === null && ai.atReactor) {
            tx = ctx.layout.reactor.x;
            tz = ctx.layout.reactor.z;
          }
        }
        if (tx !== null) {
          const dx = tx - e.pos.x;
          const dz = tz - e.pos.z;
          const d = Math.max(0.01, Math.hypot(dx, dz));
          const reach = Math.min(d, ENFORCER.reach);
          ai.aim.set(e.pos.x + (dx / d) * reach, 0, e.pos.z + (dz / d) * reach);
          ai.mode = 'wind';
          ai.t = ENFORCER.windup / e.rateMult;
          ai.marker = ctx.tele.marker(ai.aim, ENFORCER.radius, ai.t, 'orange');
          sfx.play('charge', { pitch: 0.6, volume: 0.7, pan: ctx.panFor(e.pos).pan });
        }
      }
    } else if (ai.mode === 'wind') {
      e.yaw = turnTowards(e.yaw, Math.atan2(ai.aim.x - e.pos.x, ai.aim.z - e.pos.z), hdt * 4);
      ai.t -= adt;
      if (ai.t <= 0) {
        // Slam: ground shockwave at the aim point. Hits the drone (if low), suppresses towers, cracks the reactor.
        const at = ai.aim.clone();
        ctx.hostileBlast(at, ENFORCER.radius, { player: e.dmg(def.playerDamage), reactor: e.dmg(def.reactorDamage), disable: ENFORCER.disable, owner: e, color: 'orange' });
        ctx.effects.burst('puff', at, 18, undefined, 1.6);
        ctx.effects.burst('sparks', at, 16, undefined, 1);
        ctx.effects.ring(new Vector3(at.x, 0.12, at.z), ENFORCER.radius * 1.2, 0.45, new Color3(2.6, 1, 0.2), true);
        ctx.effects.debrisBurst(at, 5, 5, 0.7);
        sfx.play('slam', { volume: ctx.panFor(at).volume, pan: ctx.panFor(at).pan });
        ai.mode = 'recover';
        ai.t = ENFORCER.recover;
      }
    } else {
      ai.t -= adt;
      if (ai.t <= 0) {
        ai.mode = 'move';
        ai.cd = def.attackInterval / e.rateMult;
      }
    }
    // Animation
    const rig = ai.rig;
    const exposed = ai.mode !== 'move';
    ai.lower += ((exposed || disrupted(e) ? 1 : 0) - ai.lower) * Math.min(1, hdt * 7);
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
    const moved = Math.hypot(e.pos.x - before.x, e.pos.z - before.z);
    ai.wheel += moved * 2.2;
    for (const w of rig.wheels) w.rotation.x = ai.wheel;
    e.phase += adt;
    rig.hull.position.y = 1.25 + Math.sin(e.phase * 9) * 0.02 * (moved > 0 ? 1 : 0) - e.flinch * 0.06;
    rig.hull.rotation.x = -e.flinch * 0.12 + (ai.mode === 'wind' ? -0.1 : ai.mode === 'recover' ? 0.15 : 0);
    rig.shieldArm.rotation.y = -1.25 * ai.lower;
    // Instances share their source's visibility: the wall collapses vertically instead, and swells on impacts.
    rig.shield.setEnabled(ai.lower < 0.85);
    const sw = 1 + e.shieldFlash * 0.06;
    rig.shield.scaling.set(3.2 * sw, 2.5 * (1 - ai.lower * 0.9) * sw, 3.2 * sw);
    const f = ai.mode === 'wind' ? 1 - ai.t / (ENFORCER.windup / e.rateMult) : 0;
    rig.hammer.rotation.x = ai.mode === 'wind' ? -2.3 * Math.min(1, f * 1.4) : ai.mode === 'recover' ? 0.35 * Math.min(1, ai.t / 0.3) : 0;
    rig.vent.scaling.set(0.7, 0.26 * (exposed ? 1.6 + 0.4 * Math.sin(ctx.time * 20) : 1), 0.04);
    rig.generator.rotation.z = Math.sin(e.phase * 2) * 0.03;
  },
  damageMod(e, amount, info) {
    const ai = e.ai as unknown as EnforcerAI;
    if (info.dot) return amount;
    if (ai.mode !== 'move') return amount * ENFORCER.exposedMult;
    // Void damage passes through the frontal energy shield.
    if (ai.lower < 0.3 && !disrupted(e) && !info.weak && info.element !== 'void' && fromFront(e, info, ENFORCER.frontCos)) {
      e.shieldFlash = 1;
      return amount * ENFORCER.frontMult;
    }
    return amount;
  },
  release(e) {
    (e.ai as unknown as EnforcerAI).mode = 'move';
  },
};

// ============================================================================ Artillery Drone

interface ArtilleryAI {
  rig: ArtilleryRig;
  mode: 'move' | 'deploy' | 'idle' | 'charge' | 'retreat';
  t: number;
  cd: number;
  target: Vector3;
  toReactor: boolean;
  marker: number;
  line: number;
  taken: number;
  retreatLeft: number;
  retreatCd: number;
  deploy: number;
  recoil: number;
  shots: number;
  interrupts: number;
}
export const ARTILLERY = { range: 30, charge: 2.1, flight: 1.7, radius: 3.8, towerBias: 0.55, towerRange: 36, interrupt: 0.12, threat: 9, retreat: 7, disable: 6 } as const;

export const artilleryBehavior: Behavior = {
  create(e, m) {
    const rig = buildArtillery(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
  },
  spawn(e) {
    Object.assign(e.ai, { mode: 'move', t: 0, cd: 1.5, target: new Vector3(), toReactor: true, marker: 0, line: 0, taken: 0, retreatLeft: 0, retreatCd: 0, deploy: 0, recoil: 0, shots: 0, interrupts: 0 });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as ArtilleryAI;
    const rig = ai.rig;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    const R = ctx.layout.reactor;
    const pp = ctx.player.position;
    ai.retreatCd -= hdt;
    const threatened = ctx.player.alive && (pp.x - e.pos.x) ** 2 + (pp.z - e.pos.z) ** 2 < ARTILLERY.threat ** 2;
    if (threatened && ai.retreatCd <= 0 && ai.mode !== 'move' && ai.mode !== 'charge') {
      ai.mode = 'retreat';
      ai.retreatLeft = ARTILLERY.retreat;
      ai.retreatCd = 6;
    }
    if (ai.mode === 'move') {
      const reached = m.follow(e, e.def.speed * e.moveMult * sf, hdt, 3);
      if (reached || Math.hypot(e.pos.x - R.x, e.pos.z - R.z) <= ARTILLERY.range) {
        ai.mode = 'deploy';
        ai.t = 0.8;
      }
    } else if (ai.mode === 'retreat') {
      const before = e.pos.clone();
      m.retreat(e, e.def.speed * 1.7 * e.moveMult * sf, hdt);
      ai.retreatLeft -= Vector3.Distance(before, e.pos);
      if (ai.retreatLeft <= 0 || e.seg <= 1 && Vector3.Distance(before, e.pos) < 0.001) {
        ai.mode = 'deploy';
        ai.t = 0.6;
      }
    } else if (ai.mode === 'deploy') {
      ai.t -= adt;
      if (ai.t <= 0) ai.mode = 'idle';
    } else if (ai.mode === 'idle') {
      ai.cd -= adt;
      if (ai.cd <= 0 && sf > 0.3) {
        // Target: exposed towers within range (bias), otherwise the reactor rim facing us.
        let tower = null;
        let best = ARTILLERY.towerRange ** 2;
        for (const t of ctx.towers) {
          if (t.building || t.disabled) continue;
          const d = (t.pos.x - e.pos.x) ** 2 + (t.pos.z - e.pos.z) ** 2;
          if (d < best) {
            best = d;
            tower = t;
          }
        }
        if (tower && Math.random() < ARTILLERY.towerBias) {
          ai.target.set(tower.pos.x, tower.pos.y, tower.pos.z);
          ai.toReactor = false;
        } else {
          const dx = e.pos.x - R.x;
          const dz = e.pos.z - R.z;
          const d = Math.max(0.01, Math.hypot(dx, dz));
          ai.target.set(R.x + (dx / d) * (R.radius + 1.2), 0, R.z + (dz / d) * (R.radius + 1.2));
          ai.toReactor = true;
        }
        ai.mode = 'charge';
        ai.t = ARTILLERY.charge / e.rateMult;
        ai.taken = 0;
        ai.marker = ctx.tele.marker(ai.target, ARTILLERY.radius, ai.t, 'red');
        rig.muzzle.computeWorldMatrix(true);
        ai.line = ctx.tele.line(rig.muzzle.getAbsolutePosition(), ai.target, ai.t, 'red', 0.045);
        sfx.play('charge', { pitch: 0.9, volume: 0.8 * ctx.panFor(e.pos).volume, pan: ctx.panFor(e.pos).pan });
      }
    } else if (ai.mode === 'charge') {
      if (disrupted(e) || ai.taken >= ARTILLERY.interrupt * e.maxHp) {
        // Interrupted: the charge vents harmlessly.
        ctx.tele.cancel(ai.marker);
        ctx.tele.cancel(ai.line);
        ai.mode = 'idle';
        ai.cd = 2.5;
        ai.interrupts++;
        ctx.effects.burst('sparks', e.center(TMP), 18, undefined, 1);
        ctx.effects.burst('smoke', e.center(TMP), 4);
        sfx.play('shieldHit', { pitch: 0.5, pan: ctx.panFor(e.pos).pan });
      } else {
        ai.t -= adt;
        rig.muzzle.computeWorldMatrix(true);
        ctx.tele.moveLine(ai.line, rig.muzzle.getAbsolutePosition(), ai.target, 0.045);
        if (ai.t <= 0) {
          rig.muzzle.computeWorldMatrix(true);
          const from = rig.muzzle.getAbsolutePosition().clone();
          ctx.tele.cancel(ai.marker);
          ctx.tele.cancel(ai.line);
          ctx.ordnance.lob(from, ai.target, ARTILLERY.flight, { radius: ARTILLERY.radius, damage: e.dmg(e.def.playerDamage), reactorDamage: ai.toReactor ? e.dmg(e.def.reactorDamage) : 0, disable: ARTILLERY.disable, owner: e.id });
          ctx.effects.burst('flash', from, 1, undefined, 0.5);
          ctx.effects.burst('smoke', from, 3);
          sfx.play('mortar', { volume: ctx.panFor(from).volume, pan: ctx.panFor(from).pan });
          ai.recoil = 1;
          ai.shots++;
          ai.mode = 'idle';
          ai.cd = e.def.attackInterval / e.rateMult;
        }
      }
    }
    // Animation: hover, stabilizers fold out when deployed, turret tracks the target, charge rings light up.
    e.phase += adt;
    ai.deploy += ((ai.mode === 'move' || ai.mode === 'retreat' ? 0 : 1) - ai.deploy) * Math.min(1, hdt * 4);
    ai.recoil = Math.max(0, ai.recoil - hdt * 3);
    e.root.position.copyFrom(e.pos);
    if (ai.mode !== 'move') e.yaw = turnTowards(e.yaw, Math.atan2(R.x - e.pos.x, R.z - e.pos.z), hdt * 1.5);
    e.root.rotation.y = e.yaw;
    rig.body.position.y = 3.0 + Math.sin(e.phase * 2.2) * 0.12 - ai.deploy * 0.25 - e.flinch * 0.2;
    rig.body.rotation.z = Math.sin(e.phase * 1.7) * 0.04 + e.flinch * 0.15;
    for (const s of rig.stabilizers) s.rotation.x = -0.5 * ai.deploy;
    const aimTarget = ai.mode === 'charge' ? ai.target : TMP2.set(R.x, 0, R.z);
    const local = clampAngle(Math.atan2(aimTarget.x - e.pos.x, aimTarget.z - e.pos.z) - e.yaw, Math.PI);
    rig.turret.rotation.y += (local - rig.turret.rotation.y) * Math.min(1, hdt * 3);
    const f = ai.mode === 'charge' ? 1 - ai.t / (ARTILLERY.charge / e.rateMult) : 0;
    rig.cannon.rotation.x = -0.75 - ai.deploy * 0.2 + ai.recoil * 0.25;
    for (let i = 0; i < rig.rings.length; i++) {
      const on = ai.mode === 'charge' && f > i / rig.rings.length;
      rig.rings[i].setEnabled(on);
      if (on) rig.rings[i].scaling.setAll(0.5 + 0.08 * Math.sin(ctx.time * 30 + i));
    }
    rig.optic.scaling.set(0.3, 0.22, 0.14).scaleInPlace(1 + f * 0.6);
  },
  damageMod(e, amount, info) {
    const ai = e.ai as unknown as ArtilleryAI;
    if (ai.mode === 'charge' && !info.dot) ai.taken += amount;
    return amount;
  },
  release(e) {
    const ai = e.ai as unknown as ArtilleryAI;
    for (const r of ai.rig.rings) r.setEnabled(false);
    ai.mode = 'move';
  },
};

// ============================================================================ Support Engineer

interface EngineerAI {
  rig: EngineerRig;
  target: Enemy | null;
  scan: number;
  buffCd: number;
  attackT: number;
  heals: number;
  buffs: number;
  atEnd: boolean;
  reach: number;
}
export const ENGINEER = { range: 15, heal: 0.08, bossHeal: 0.008, shield: 0.15, buffEvery: 7, buffTime: 6, holdBehind: 6 } as const;

export const engineerBehavior: Behavior = {
  create(e, m) {
    const rig = buildEngineer(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
  },
  spawn(e) {
    Object.assign(e.ai, { target: null, scan: 0, buffCd: 3, attackT: 2, heals: 0, buffs: 0, atEnd: false, reach: 0 });
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as EngineerAI;
    const rig = ai.rig;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    const off = disrupted(e);
    // Stay behind the front line: hold while closer to the reactor than the leading ally + margin.
    let front = Infinity;
    for (const o of m.active) {
      if (o === e || !o.alive || o.def.role === 'support' || o.def.role === 'hvt') continue;
      if ((o.pos.x - e.pos.x) ** 2 + (o.pos.z - e.pos.z) ** 2 > 30 * 30) continue;
      front = Math.min(front, o.remaining);
    }
    const hold = front < Infinity && e.remaining < front + ENGINEER.holdBehind;
    if (!ai.atEnd) ai.atEnd = m.follow(e, e.def.speed * e.moveMult * sf * (hold ? 0.15 : 1), hdt, 4);
    if (ai.atEnd) {
      e.yaw = turnTowards(e.yaw, Math.atan2(-e.pos.x, -e.pos.z), hdt * 3);
      ai.attackT -= adt;
      if (ai.attackT <= 0) {
        ai.attackT = e.def.attackInterval;
        ctx.damageReactor(e.dmg(e.def.reactorDamage), e.center(TMP));
        ctx.tele.line(e.center(TMP), TMP2.set(0, 3, 0), 0.25, 'green', 0.08);
      }
    }
    // Pick the most damaged ally in range (4 Hz decision rate).
    ai.scan -= hdt;
    const c = e.center(TMP);
    if (ai.scan <= 0) {
      ai.scan = 0.25;
      ai.target = null;
      let worst = 0.995;
      for (const o of m.active) {
        if (o === e || !o.alive || o.def.role === 'hvt') continue;
        const d2 = (o.pos.x - e.pos.x) ** 2 + (o.pos.z - e.pos.z) ** 2;
        if (d2 > ENGINEER.range ** 2) continue;
        const f = Math.min(o.hp / o.maxHp, o.maxShield > 0 ? 0.5 + 0.5 * (o.shield / o.maxShield) : 1);
        if (f < worst) {
          worst = f;
          ai.target = o;
        }
      }
    }
    const tgt = ai.target && ai.target.alive ? ai.target : null;
    if (tgt && !off) {
      const boss = tgt.def.role === 'boss';
      m.heal(tgt, tgt.maxHp * (boss ? ENGINEER.bossHeal : ENGINEER.heal) * adt, tgt.maxShield * ENGINEER.shield * adt);
      rig.arms[0].tip.computeWorldMatrix(true);
      ctx.tele.line(rig.arms[0].tip.getAbsolutePosition(), tgt.center(TMP2), 0.05, 'green', 0.07);
      if (Math.random() < hdt * 6) ctx.effects.burst('build', tgt.center(TMP2), 2, undefined, 0.6);
      ai.heals += adt;
    }
    // Empower the strongest unbuffed ally periodically.
    ai.buffCd -= adt;
    if (ai.buffCd <= 0 && !off) {
      let best: Enemy | null = null;
      for (const o of m.active) {
        if (o === e || !o.alive || o.buffT > 0 || o.def.role === 'support' || o.def.role === 'hvt') continue;
        if ((o.pos.x - e.pos.x) ** 2 + (o.pos.z - e.pos.z) ** 2 > ENGINEER.range ** 2) continue;
        if (!best || o.maxHp > best.maxHp) best = o;
      }
      ai.buffCd = best ? ENGINEER.buffEvery : 1;
      if (best) {
        best.buffT = ENGINEER.buffTime;
        ai.buffs++;
        ctx.tele.line(c, best.center(TMP2), 0.4, 'green', 0.16);
        ctx.effects.ring(best.center(TMP2), 2.6, 0.4, new Color3(0.3, 2.6, 1.2), false);
        sfx.play('heal', { pitch: 0.7, volume: ctx.panFor(c).volume, pan: ctx.panFor(c).pan });
      }
    }
    // Animation
    e.phase += adt;
    e.root.position.copyFrom(e.pos);
    if (tgt) e.yaw = turnTowards(e.yaw, Math.atan2(tgt.pos.x - e.pos.x, tgt.pos.z - e.pos.z), hdt * 4);
    e.root.rotation.y = e.yaw;
    rig.body.position.y = 1.65 + Math.sin(e.phase * 2.6) * 0.1 - e.flinch * 0.2;
    rig.body.rotation.z = Math.sin(e.phase * 1.3) * 0.06 + e.flinch * 0.3;
    ai.reach += ((tgt && !off ? 1 : 0) - ai.reach) * Math.min(1, hdt * 5);
    for (let i = 0; i < rig.arms.length; i++) {
      const a = rig.arms[i];
      a.shoulder.rotation.x = 0.6 - ai.reach * 0.75 + Math.sin(e.phase * 3 + i) * 0.05;
      a.elbow.rotation.x = -0.9 + ai.reach * 0.7;
      a.shoulder.rotation.y = (i ? -1 : 1) * ai.reach * 0.25;
    }
    rig.dish.rotation.y = e.phase * 1.5;
    rig.beacon.scaling.setAll(0.16 * (1 + 0.5 * Math.max(0, Math.sin(e.phase * 6))));
    rig.ring.rotation.y = e.phase * 3;
  },
};

// ============================================================================ Vault Courier (HVT)

interface CourierAI {
  rig: CourierRig;
  mode: 'enter' | 'orbit' | 'escape';
  angle: number;
  life: number;
  phaseCd: number;
  phaseWarn: number;
  phaseT: number;
  shotCd: number;
  charge: number;
  alt: number;
  warned: boolean;
}
export const COURIER = { radius: 24, alt: 0, phaseEvery: 7, phaseWarn: 0.8, phaseTime: 1.6, orbSpeed: 18 } as const;

export const courierBehavior: Behavior = {
  create(e, m) {
    const rig = buildCourier(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
  },
  spawn(e) {
    Object.assign(e.ai, { mode: 'enter', angle: 0, life: 0, phaseCd: 4, phaseWarn: 0, phaseT: 0, shotCd: 2, charge: 0, alt: 0, warned: false });
    e.remaining = 30;
  },
  update(e, hdt, ctx, m) {
    const ai = e.ai as unknown as CourierAI;
    const rig = ai.rig;
    const sf = speedFactor(e.status);
    const adt = hdt * sf * e.rateMult;
    ai.life += hdt;
    const speed = e.def.speed * e.moveMult * sf;
    const R = COURIER.radius;
    if (ai.mode !== 'escape' && ai.life >= EVENT_TUNING.hvtEscape) {
      ai.mode = 'escape';
      ctx.alert('HIGH-VALUE TARGET ESCAPING', 'orange');
    } else if (!ai.warned && ai.life >= EVENT_TUNING.hvtEscape - 12) {
      ai.warned = true;
      ctx.alert('COURIER ESCAPES IN 12 S', 'orange');
    }
    if (ai.mode === 'enter') {
      ai.angle = Math.atan2(e.pos.x, e.pos.z);
      const tx = Math.sin(ai.angle) * R;
      const tz = Math.cos(ai.angle) * R;
      const d = Math.hypot(tx - e.pos.x, tz - e.pos.z);
      if (d < 0.5) ai.mode = 'orbit';
      else {
        const k = Math.min(1, (speed * hdt) / d);
        e.pos.x += (tx - e.pos.x) * k;
        e.pos.z += (tz - e.pos.z) * k;
        e.yaw = Math.atan2(tx - e.pos.x, tz - e.pos.z);
      }
    } else if (ai.mode === 'orbit') {
      ai.angle += (speed / R) * hdt;
      e.pos.x = Math.sin(ai.angle) * R;
      e.pos.z = Math.cos(ai.angle) * R;
      e.yaw = ai.angle + Math.PI / 2;
    } else {
      // Fly out over the north wall.
      const tx = 0;
      const tz = 60;
      const d = Math.hypot(tx - e.pos.x, tz - e.pos.z);
      e.pos.y = Math.min(14, e.pos.y + hdt * 3);
      if (d < 1 || e.pos.y >= 14 && d < 8) {
        m.escape(e, ctx);
        return;
      }
      const k = Math.min(1, (speed * 1.4 * hdt) / d);
      e.pos.x += (tx - e.pos.x) * k;
      e.pos.z += (tz - e.pos.z) * k;
      e.yaw = turnTowards(e.yaw, Math.atan2(tx - e.pos.x, tz - e.pos.z), hdt * 2);
    }
    // Phase shield cycle: shimmer warning, then a short immunity window.
    if (ai.phaseT > 0) {
      ai.phaseT -= adt;
      if (ai.phaseT <= 0) ai.phaseCd = COURIER.phaseEvery;
    } else if (ai.phaseWarn > 0) {
      ai.phaseWarn -= adt;
      if (ai.phaseWarn <= 0) {
        ai.phaseT = COURIER.phaseTime;
        sfx.play('tacticalOn', { pitch: 1.6, volume: 0.6, pan: ctx.panFor(e.pos).pan });
      }
    } else {
      ai.phaseCd -= adt;
      if (ai.phaseCd <= 0) ai.phaseWarn = COURIER.phaseWarn;
    }
    // Vault orbs at the drone.
    const c = e.center(TMP);
    if (ai.charge > 0) {
      ai.charge -= adt;
      if (ai.charge <= 0 && ctx.player.alive) {
        ctx.ordnance.orb(c, ctx.player.eye, COURIER.orbSpeed, e.dmg(e.def.playerDamage), e.id);
        sfx.play('enemyShot', { pitch: 0.6, volume: ctx.panFor(c).volume, pan: ctx.panFor(c).pan });
      }
    } else if (ai.mode !== 'escape') {
      ai.shotCd -= adt;
      if (ai.shotCd <= 0) {
        ai.shotCd = e.def.attackInterval / e.rateMult;
        if (ctx.player.alive && Vector3.DistanceSquared(c, ctx.player.eye) < 50 * 50 && ctx.los(c, ctx.player.eye)) {
          ai.charge = 0.55;
          ctx.tele.line(c, ctx.player.eye, 0.5, 'violet', 0.03);
        }
      }
    }
    // Animation
    e.phase += adt;
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
    rig.body.rotation.z = ai.mode === 'orbit' ? -0.28 : 0;
    rig.body.position.y = 6.8 + Math.sin(e.phase * 1.8) * 0.2;
    rig.ring.rotation.y += hdt * 0.8;
    rig.ring.rotation.x = 0.3 + Math.sin(e.phase) * 0.1;
    for (let i = 0; i < rig.petals.length; i++) rig.petals[i].position.y = Math.sin(e.phase * 3 + i) * 0.04 + (ai.phaseT > 0 ? 0.2 : 0);
    rig.vault.scaling.setAll(0.7 * (1 + (ai.charge > 0 ? 0.5 : 0) + 0.08 * Math.sin(e.phase * 5)));
    const shimmer = ai.phaseT > 0 || (ai.phaseWarn > 0 && Math.sin(ctx.time * 40) > 0);
    rig.phase.setEnabled(shimmer);
  },
  damageMod(e, amount, info) {
    const ai = e.ai as unknown as CourierAI;
    if (ai.phaseT > 0 && !info.dot) {
      e.shieldFlash = 1;
      return 0;
    }
    return amount;
  },
};

export const M6_BEHAVIORS = { enforcer: enforcerBehavior, artillery: artilleryBehavior, engineer: engineerBehavior, courier: courierBehavior } as const;
export type EngineerState = EngineerAI;
export type ArtilleryState = ArtilleryAI;
export type CourierState = CourierAI;
export type EnforcerState = EnforcerAI;
