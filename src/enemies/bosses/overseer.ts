import { Color3, Vector3 } from '@babylonjs/core';
import { sfx } from '../../audio/Sfx';
import { speedFactor } from '../../combat/status';
import { BOSSES, bossPhase, bossScaling } from '../../survival/bosses';
import { buildOverseer, buildPylon, type OverseerRig, type PylonRig } from '../../visuals/bossModels';
import type { Behavior, Enemy, EnemyContext, EnemyManager } from '../EnemyManager';
import { turnTowards } from '../EnemyManager';

type AttackKind = 'orbs' | 'summon' | 'lances' | 'sweep' | 'relocate' | 'discharge' | 'redeploy';

interface Attack {
  kind: AttackKind;
  t: number;
  dur: number;
  lines: number[];
  markers: number[];
  points: Vector3[];
  fired: number;
  from: Vector3;
  to: Vector3;
  hitT: number;
}

interface OverseerAI {
  rig: OverseerRig;
  phase: 1 | 2 | 3;
  transT: number;
  atk: Attack | null;
  gcd: number;
  cd: Record<AttackKind, number>;
  pylons: Enemy[];
  exposedT: number;
  open: number;
  posIdx: number;
  entered: boolean;
  summons: number;
  attacks: Partial<Record<AttackKind, number>>;
  shieldHits: number;
  /** Emitters are deployed (their loss opens the exposure window). */
  deployed: boolean;
}

export const OVERSEER = {
  height: 12,
  positions: [
    [0, 20],
    [19, 2],
    [-19, -2],
    [0, -17],
    [13, -14],
    [-13, 15],
  ] as [number, number][],
  orbitR: 6.2,
  exposed: 10,
  sweepCharge: 1.7,
  sweepTime: 2.2,
  sweepMult: 2,
  sweepRadius: 2.3,
  dischargeCharge: 3.2,
  lanceWindup: 2.0,
  lanceRadius: 3.1,
  transition: 1.7,
} as const;

const TMP = new Vector3();
const PHASE_NAMES = ['', 'COMMAND', 'RELOCATION PROTOCOL', 'OVERLOAD'];
const ATTACK_NAMES: Record<AttackKind, string> = { orbs: 'ORB BARRAGE', summon: 'SUMMONING DRONES', lances: 'GRID LANCES', sweep: 'PRISM SWEEP · CORE OPEN', relocate: 'RELOCATING', discharge: 'OVERLOAD DISCHARGE · TAKE COVER', redeploy: 'DEPLOYING EMITTERS' };

function ai(e: Enemy): OverseerAI {
  return e.ai as unknown as OverseerAI;
}

function livePylons(a: OverseerAI): Enemy[] {
  a.pylons = a.pylons.filter((p) => p.alive && (p.ai as { owner?: Enemy }).owner !== undefined);
  return a.pylons;
}

export const overseerBehavior: Behavior = {
  create(e, m) {
    const rig = buildOverseer(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
    m.addHitbox(e, rig.body, 0, 0, 2.2, false);
    m.addHitbox(e, rig.body, 0, 1.3, 0.75, true, 'eye');
  },
  spawn(e) {
    const a = ai(e);
    Object.assign(a, { phase: 1, transT: 0, atk: null, gcd: 2.5, cd: { orbs: 2, summon: 8, lances: 4, sweep: 6, relocate: 10, discharge: 6, redeploy: 0 }, pylons: [], exposedT: 0, open: 0, posIdx: 0, entered: false, summons: 0, attacks: {}, shieldHits: 0, deployed: false });
    e.pos.y = 6;
    e.remaining = 20;
  },
  update(e, hdt, ctx, m) {
    const a = ai(e);
    const rig = a.rig;
    const sc = bossScaling(e.encounter, 1);
    const sf = Math.max(0.35, speedFactor(e.status));
    const adt = hdt * sf * e.rateMult;
    e.remaining = 20;
    // ---- entrance: fly from the gate to the first combat position, then deploy emitters.
    if (!a.entered) {
      const [tx, tz] = OVERSEER.positions[0];
      const to = TMP.set(tx, OVERSEER.height, tz);
      const d = Vector3.Distance(e.pos, to);
      if (d < 0.4) {
        a.entered = true;
        a.cd.redeploy = 0;
      } else {
        const k = Math.min(1, (e.def.speed * hdt) / d);
        e.pos.addInPlace(to.subtract(e.pos).scaleInPlace(k));
      }
    }
    // ---- phases
    const want = bossPhase(BOSSES.overseer, e.hp / e.maxHp);
    if (want > a.phase) {
      a.phase = want;
      a.transT = OVERSEER.transition;
      a.summons = 0;
      cancel(a, ctx);
      ctx.alert(`OVERSEER CORE · PHASE ${a.phase} · ${PHASE_NAMES[a.phase]}`, 'red');
      sfx.play('bossRoar', { pitch: 1.3, volume: 1 });
      if (a.phase === 3) {
        // Overload: the emitters burn out, the core is briefly exposed.
        for (const p of livePylons(a)) m.kill(p, ctx.effects, ctx, true);
        a.pylons = [];
        a.deployed = false;
        a.exposedT = 7;
        a.cd.redeploy = 14;
      }
    }
    if (a.transT > 0) {
      a.transT -= hdt;
      for (const r of rig.rings) r.node.rotation.y += hdt * 6;
      animate(e, a, hdt, ctx);
      return;
    }
    for (const k of Object.keys(a.cd) as AttackKind[]) a.cd[k] -= adt;
    a.gcd -= adt;
    const pylons = livePylons(a);
    if (a.exposedT > 0) a.exposedT -= hdt;
    if (a.deployed && pylons.length === 0) {
      // All emitters down: expose the core for a window, then redeploy.
      a.deployed = false;
      a.exposedT = OVERSEER.exposed;
      a.cd.redeploy = OVERSEER.exposed + 0.5;
      ctx.alert('EMITTERS DOWN · CORE EXPOSED', 'blue');
      sfx.play('shieldHit', { pitch: 0.5, volume: 1 });
    }
    if (a.entered && !a.atk && a.gcd <= 0) choose(e, a, ctx, sc);
    if (a.atk) run(e, a, adt, hdt, ctx, m, sc);
    // Face the drone.
    const pp = ctx.player.position;
    e.yaw = turnTowards(e.yaw, Math.atan2(pp.x - e.pos.x, pp.z - e.pos.z), hdt * 1.4);
    animate(e, a, hdt, ctx);
  },
  damageMod(e, amount, info) {
    const a = ai(e);
    if (a.transT > 0) return amount * 0.15;
    const sweeping = a.atk?.kind === 'sweep';
    if (!sweeping && a.exposedT <= 0 && livePylons(a).length > 0) {
      e.shieldFlash = 1;
      a.shieldHits++;
      return 0;
    }
    return sweeping && !info.dot ? amount * OVERSEER.sweepMult : amount;
  },
  death(e, ctx, m) {
    const a = ai(e);
    cancel(a, ctx);
    for (const p of livePylons(a)) m.despawn(p, ctx.effects);
    a.pylons = [];
    ctx.alert('OVERSEER CORE · CONTAINMENT LOST', 'white');
    sfx.play('bossRoar', { volume: 1, pitch: 0.5 });
    return 3.2;
  },
  dying(e, dt, t, ctx) {
    const a = ai(e);
    // Spiral fall with chained violet bursts, then a ground detonation.
    e.pos.y = Math.max(2, e.pos.y - dt * (2 + t * 3));
    e.root.position.copyFrom(e.pos);
    a.rig.body.rotation.y += dt * (2 + t * 4);
    a.rig.body.rotation.z = Math.sin(t * 3) * 0.4;
    for (const r of a.rig.rings) for (const p of r.plates) p.position.z += dt * 1.6;
    if (Math.floor(t / 0.25) !== Math.floor((t - dt) / 0.25) && t < 2.9) {
      const p = e.center(new Vector3()).addInPlaceFromFloats((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4);
      ctx.effects.explode(p, { scale: 0.9 + Math.random() * 0.5, debris: 4, color: new Color3(1.6, 0.5, 3.2) });
      sfx.play('explosion', { volume: ctx.panFor(p).volume * 0.8, pitch: 1.1 + Math.random() * 0.3, pan: ctx.panFor(p).pan });
    }
    if (t >= 3 && t - dt < 3) {
      const c = e.center(new Vector3());
      ctx.effects.explode(c, { scale: 4, debris: 28, color: new Color3(1.8, 0.6, 3.6) });
      ctx.effects.ring(new Vector3(c.x, 0.2, c.z), 15, 0.7, new Color3(1.6, 0.5, 3.4), true);
      ctx.effects.flashLight(c, 16, 1.1, new Color3(0.7, 0.4, 1.2));
      sfx.play('explosion', { volume: 1, pitch: 0.5 });
    }
  },
  release(e) {
    const a = ai(e);
    a.atk = null;
    a.rig.body.rotation.set(0, 0, 0);
    for (const r of a.rig.rings) for (const p of r.plates) p.position.z = 2.15;
  },
  hud(e) {
    const a = ai(e);
    const n = livePylons(a).length;
    const sweeping = a.atk?.kind === 'sweep';
    return {
      title: BOSSES.overseer.title,
      phase: a.phase,
      ticks: [...BOSSES.overseer.phases],
      state: a.transT > 0 ? 'RECONFIGURING' : sweeping ? 'CORE OPEN · DOUBLE DAMAGE' : a.exposedT > 0 ? `CORE EXPOSED · ${Math.ceil(a.exposedT)} S` : n > 0 ? `SHIELDED · DESTROY ${n} EMITTER${n === 1 ? '' : 'S'}` : PHASE_NAMES[a.phase],
      immune: a.transT > 0 || (!sweeping && a.exposedT <= 0 && n > 0),
      attack: a.atk ? ATTACK_NAMES[a.atk.kind] : '',
    };
  },
};

function animate(e: Enemy, a: OverseerAI, hdt: number, ctx: EnemyContext): void {
  const rig = a.rig;
  e.phase += hdt;
  e.root.position.copyFrom(e.pos);
  e.root.position.y += Math.sin(e.phase * 1.3) * 0.35;
  e.root.rotation.y = e.yaw;
  const want = a.atk?.kind === 'sweep' || a.exposedT > 0 ? 1 : a.atk?.kind === 'discharge' ? 0.5 : 0;
  a.open += (want - a.open) * Math.min(1, hdt * 3);
  for (let i = 0; i < rig.rings.length; i++) {
    const r = rig.rings[i];
    r.node.rotation.y += hdt * r.speed * (1 + a.phase * 0.4 + (a.atk?.kind === 'discharge' ? 3 : 0));
    for (const p of r.plates) p.position.z = 2.15 + i * 0.4 + a.open * (1.2 + i * 0.2);
  }
  const shielded = a.exposedT <= 0 && a.atk?.kind !== 'sweep' && a.transT <= 0 && a.pylons.some((p) => p.alive);
  rig.shield.setEnabled(shielded);
  if (shielded) rig.shield.scaling.setAll(7.4 * (1 + e.shieldFlash * 0.05 + 0.01 * Math.sin(ctx.time * 3)));
  const charge = a.atk?.kind === 'discharge' ? Math.min(1, a.atk.t / a.atk.dur) : 0;
  rig.inner.scaling.setAll(1.7 * (1 + a.open * 0.2 + charge * 0.5 + 0.04 * Math.sin(ctx.time * 6)));
  rig.eye.scaling.set(0.7 * (1 + charge * 0.4), 0.7 * (1 + charge * 0.4), 0.25);
  rig.crown.rotation.y += hdt * 0.6;
  for (const t of rig.thrusters) t.scaling.set(0.45, 1.2 + 0.25 * Math.sin(ctx.time * 20 + t.uniqueId), 0.45);
  for (const arm of rig.arms) arm.node.rotation.x = Math.sin(e.phase * 0.8) * 0.15;
}

function cancel(a: OverseerAI, ctx: EnemyContext): void {
  if (!a.atk) return;
  for (const l of a.atk.lines) ctx.tele.cancel(l);
  for (const mk of a.atk.markers) ctx.tele.cancel(mk);
  a.atk = null;
}

function start(a: OverseerAI, kind: AttackKind, dur: number): Attack {
  a.atk = { kind, t: 0, dur, lines: [], markers: [], points: [], fired: 0, from: new Vector3(), to: new Vector3(), hitT: 0 };
  a.attacks[kind] = (a.attacks[kind] ?? 0) + 1;
  return a.atk;
}

function choose(e: Enemy, a: OverseerAI, ctx: EnemyContext, sc: ReturnType<typeof bossScaling>): void {
  const pl = ctx.player;
  const cad = sc.cadence * (a.phase === 3 ? 0.7 : 1);
  const c = e.center(new Vector3());
  if (!a.deployed && a.cd.redeploy <= 0 && a.exposedT <= 0) {
    start(a, 'redeploy', 1.6);
    ctx.alert('OVERSEER DEPLOYING SHIELD EMITTERS', 'orange');
    return;
  }
  if (a.phase === 3 && a.cd.discharge <= 0) {
    start(a, 'discharge', OVERSEER.dischargeCharge);
    ctx.alert('OVERLOAD DISCHARGE · TAKE COVER BEHIND GEOMETRY', 'red');
    sfx.play('alarm', { volume: 0.9 });
    sfx.play('charge', { pitch: 0.3, volume: 1 });
    a.cd.discharge = 17 * cad;
    return;
  }
  if (a.phase >= 2 && a.cd.relocate <= 0) {
    const k = start(a, 'relocate', 1.1 + 2.4);
    let idx = a.posIdx;
    while (idx === a.posIdx) idx = Math.floor(Math.random() * OVERSEER.positions.length);
    a.posIdx = idx;
    const [x, z] = OVERSEER.positions[idx];
    k.from.copyFrom(e.pos);
    k.to.set(x, OVERSEER.height + (a.phase === 3 ? -1.5 : 0), z);
    k.lines.push(ctx.tele.line(c, k.to, 1.1, 'violet', 0.08));
    a.cd.relocate = (a.phase === 3 ? 8 : 12) * cad;
    return;
  }
  if (a.phase >= 2 && a.cd.sweep <= 0 && pl.alive) {
    const k = start(a, 'sweep', OVERSEER.sweepCharge + OVERSEER.sweepTime);
    // A 30 m line across the drone's position, roughly perpendicular to the boss's view.
    const pp = pl.position;
    const dx = pp.x - e.pos.x;
    const dz = pp.z - e.pos.z;
    const l = Math.max(0.01, Math.hypot(dx, dz));
    const nx = -dz / l;
    const nz = dx / l;
    const lim = ctx.layout.half - 2;
    const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
    k.from.set(clamp(pp.x - nx * 15), 0, clamp(pp.z - nz * 15));
    k.to.set(clamp(pp.x + nx * 15), 0, clamp(pp.z + nz * 15));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const p = Vector3.Lerp(k.from, k.to, i / (n - 1));
      k.markers.push(ctx.tele.marker(p, OVERSEER.sweepRadius, OVERSEER.sweepCharge + (i / (n - 1)) * OVERSEER.sweepTime, 'red'));
    }
    ctx.alert('PRISM SWEEP · CORE OPEN · DOUBLE DAMAGE', 'blue');
    sfx.play('charge', { pitch: 0.8, volume: 0.9 });
    a.cd.sweep = 15 * cad;
    return;
  }
  if (a.phase >= 2 && a.cd.lances <= 0) {
    const k = start(a, 'lances', OVERSEER.lanceWindup);
    const pts: Vector3[] = [];
    if (pl.alive) pts.push(new Vector3(pl.position.x, 0, pl.position.z));
    const towers = ctx.towers.filter((t) => !t.building);
    for (let i = 0; i < 2 + (a.phase === 3 ? 1 : 0); i++) {
      if (towers.length && Math.random() < 0.7) {
        const t = towers[Math.floor(Math.random() * towers.length)];
        pts.push(new Vector3(t.pos.x + (Math.random() - 0.5) * 2, t.pos.y, t.pos.z + (Math.random() - 0.5) * 2));
      } else if (pl.alive) pts.push(new Vector3(pl.position.x + (Math.random() - 0.5) * 12, 0, pl.position.z + (Math.random() - 0.5) * 12));
    }
    for (const p of pts) {
      k.points.push(p);
      k.markers.push(ctx.tele.marker(p, OVERSEER.lanceRadius, k.dur, 'violet'));
    }
    sfx.play('charge', { pitch: 1.8, volume: 0.6 });
    a.cd.lances = 9 * cad;
    return;
  }
  if (a.cd.summon <= 0 && a.summons < 2 + Math.ceil(sc.extraSummons / 2)) {
    start(a, 'summon', 1.0);
    a.summons++;
    a.cd.summon = 20 * cad;
    return;
  }
  if (a.cd.orbs <= 0 && pl.alive && ctx.los(c, pl.eye)) {
    const k = start(a, 'orbs', 0.9);
    for (const arm of a.rig.arms) {
      arm.muzzle.computeWorldMatrix(true);
      k.lines.push(ctx.tele.line(arm.muzzle.getAbsolutePosition(), pl.eye, k.dur + 0.6, 'violet', 0.035));
    }
    sfx.play('charge', { pitch: 2.2, volume: 0.5 });
    a.cd.orbs = 4.5 * cad;
  }
}

function run(e: Enemy, a: OverseerAI, adt: number, hdt: number, ctx: EnemyContext, m: EnemyManager, sc: ReturnType<typeof bossScaling>): void {
  const k = a.atk!;
  k.t += adt;
  const pl = ctx.player;
  const rig = a.rig;
  switch (k.kind) {
    case 'redeploy': {
      if (k.t >= k.dur) {
        const n = 3 + sc.variant + (a.phase === 2 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const p = ctx.summon('pylon', new Vector3(e.pos.x, 0, e.pos.z));
          if (!p) break;
          const pa = p.ai as unknown as PylonAI;
          pa.owner = e;
          pa.gen = e.gen;
          pa.angle = (i / n) * Math.PI * 2;
          p.pos.y = e.pos.y;
          a.pylons.push(p);
        }
        a.deployed = a.pylons.length > 0;
        if (!a.deployed) a.cd.redeploy = 5;
        ctx.effects.ring(e.center(new Vector3()), 8, 0.5, new Color3(1.6, 0.5, 3.4), false);
        sfx.play('tacticalOn', { pitch: 0.7, volume: 0.8 });
        a.atk = null;
        a.gcd = 1.5;
      }
      break;
    }
    case 'orbs': {
      for (let i = 0; i < rig.arms.length; i++) {
        rig.arms[i].muzzle.computeWorldMatrix(true);
        ctx.tele.moveLine(k.lines[i], rig.arms[i].muzzle.getAbsolutePosition(), pl.eye, 0.035);
      }
      const per = a.phase === 3 ? 5 : 3;
      const want = k.t < 0.9 ? 0 : Math.min(per * 2, Math.floor((k.t - 0.9) / 0.14) + 1);
      while (k.fired < want && pl.alive) {
        const arm = rig.arms[k.fired % 2];
        arm.muzzle.computeWorldMatrix(true);
        const from = arm.muzzle.getAbsolutePosition().clone();
        const to = pl.eye.add(new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2));
        ctx.ordnance.orb(from, to, 21, e.dmg(16), e.id);
        k.fired++;
        sfx.play('enemyShot', { pitch: 0.7, volume: 0.6 });
      }
      if (k.t >= 0.9 + per * 2 * 0.14) {
        for (const l of k.lines) ctx.tele.cancel(l);
        a.atk = null;
        a.gcd = 0.8;
      }
      break;
    }
    case 'summon': {
      if (k.t >= k.dur) {
        const c = e.center(new Vector3());
        const n = 2 + sc.extraSummons;
        for (let i = 0; i < n; i++) ctx.summon('rusher', new Vector3(c.x + (Math.random() - 0.5) * 6, 0, c.z + (Math.random() - 0.5) * 6), { mods: a.phase === 3 ? ['accelerated'] : [] });
        if (a.phase >= 2) ctx.summon('engineer', new Vector3(c.x, 0, c.z));
        ctx.tele.line(c, new Vector3(c.x, 0, c.z), 0.4, 'violet', 0.25);
        a.atk = null;
        a.gcd = 1;
      }
      break;
    }
    case 'lances': {
      if (k.t >= k.dur) {
        for (const p of k.points) {
          ctx.tele.line(new Vector3(p.x, 30, p.z), p, 0.3, 'violet', 1.1);
          ctx.tele.line(new Vector3(p.x, 30, p.z), p, 0.22, 'white', 0.4);
          ctx.effects.burst('zap', p.add(new Vector3(0, 0.5, 0)), 20, undefined, 1.4);
          ctx.effects.ring(new Vector3(p.x, p.y + 0.1, p.z), OVERSEER.lanceRadius * 1.2, 0.35, new Color3(1.6, 0.5, 3.4), true);
          ctx.hostileBlast(p, OVERSEER.lanceRadius, { player: e.dmg(24), disable: 5, color: 'violet' });
        }
        sfx.play('arc', { volume: 1, pitch: 0.5 });
        sfx.thunder(0.05);
        a.atk = null;
        a.gcd = 1;
      }
      break;
    }
    case 'sweep': {
      const charge = OVERSEER.sweepCharge;
      if (k.t >= charge) {
        const f = Math.min(1, (k.t - charge) / OVERSEER.sweepTime);
        const p = Vector3.Lerp(k.from, k.to, f);
        rig.eye.computeWorldMatrix(true);
        const eye = rig.eye.getAbsolutePosition();
        if (!k.lines.length) k.lines.push(ctx.tele.line(eye, p, OVERSEER.sweepTime + 0.1, 'red', 0.35));
        else ctx.tele.moveLine(k.lines[0], eye, p, 0.35);
        if (Math.random() < hdt * 20) ctx.effects.burst('fire', p.add(new Vector3(0, 0.3, 0)), 2, undefined, 0.9);
        k.hitT -= hdt;
        const pp = pl.position;
        if (k.hitT <= 0 && pl.alive && Math.hypot(pp.x - p.x, pp.z - p.z) < OVERSEER.sweepRadius && pp.y < 3.5) {
          k.hitT = 0.3;
          ctx.hurtPlayer(e.dmg(16), p);
        }
        for (const t of ctx.towers) if (Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < OVERSEER.sweepRadius) t.disable(4);
        if (f >= 1) {
          cancel(a, ctx);
          a.gcd = 1.2;
        }
      }
      break;
    }
    case 'relocate': {
      if (k.t >= 1.1) {
        const f = Math.min(1, (k.t - 1.1) / 2.4);
        const s = f * f * (3 - 2 * f);
        Vector3.LerpToRef(k.from, k.to, s, e.pos);
        e.pos.y += Math.sin(f * Math.PI) * 2;
        if (f >= 1) {
          a.atk = null;
          a.gcd = a.phase === 3 ? 0.1 : 0.6;
          if (a.phase === 3) a.cd.orbs = Math.min(a.cd.orbs, 0);
        }
      }
      break;
    }
    case 'discharge': {
      if (Math.random() < hdt * 12) ctx.effects.burst('zap', e.center(new Vector3()), 3, undefined, 1.2);
      if (k.t >= k.dur) {
        const c = e.center(new Vector3());
        ctx.effects.ring(c, 40, 0.6, new Color3(1.8, 0.6, 3.6), false);
        ctx.effects.ring(new Vector3(c.x, 0.2, c.z), 30, 0.6, new Color3(1.8, 0.6, 3.6), true);
        ctx.effects.flashLight(c, 14, 0.5, new Color3(0.8, 0.5, 1.4));
        ctx.effects.onShake?.(pl.position, 0.6);
        sfx.play('explosion', { volume: 1, pitch: 0.7 });
        if (pl.alive && ctx.los(c, pl.eye)) {
          ctx.tele.line(c, pl.eye, 0.2, 'violet', 0.15);
          ctx.hurtPlayer(e.dmg(44), c);
        }
        const R = ctx.layout.reactor;
        const top = new Vector3(R.x, R.height + 0.5, R.z);
        if (ctx.los(c, top)) {
          ctx.tele.line(c, top, 0.25, 'violet', 0.2);
          ctx.damageReactor(e.dmg(55), top);
        }
        for (const t of ctx.towers) {
          if (Vector3.Distance(t.head, c) < 45 && ctx.los(c, t.head)) {
            t.disable(4);
            ctx.tele.line(c, t.head, 0.15, 'violet', 0.05);
          }
        }
        a.atk = null;
        a.gcd = 1.5;
      }
      break;
    }
  }
  void m;
}

// ============================================================================ Shield emitter (pylon)

interface PylonAI {
  rig: PylonRig;
  owner: Enemy | undefined;
  gen: number;
  angle: number;
  beam: number;
}

export const pylonBehavior: Behavior = {
  create(e, m) {
    const rig = buildPylon(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
  },
  spawn(e) {
    Object.assign(e.ai, { owner: undefined, gen: -1, angle: 0, beam: 0 });
  },
  update(e, hdt, ctx, m) {
    const p = e.ai as unknown as PylonAI;
    const o = p.owner;
    if (!o) {
      // Not attached yet (same frame as the summon).
      return;
    }
    if (!o.alive || o.gen !== p.gen) {
      m.despawn(e, ctx.effects);
      return;
    }
    p.angle += hdt * 0.55;
    const R = OVERSEER.orbitR;
    e.pos.set(o.pos.x + Math.cos(p.angle) * R, o.pos.y - 1.2 + Math.sin(p.angle * 2 + e.id) * 0.6, o.pos.z + Math.sin(p.angle) * R);
    e.remaining = 19;
    e.phase += hdt;
    e.root.position.copyFrom(e.pos);
    p.rig.body.rotation.y += hdt * 1.5;
    p.rig.ring.rotation.x += hdt * 3;
    // Tether beam to the core (refreshed in short segments).
    p.beam -= hdt;
    if (p.beam <= 0) {
      p.beam = 0.1;
      ctx.tele.line(e.center(TMP), o.center(new Vector3()), 0.12, 'violet', 0.05);
    }
  },
};

export type { OverseerAI, PylonAI };
