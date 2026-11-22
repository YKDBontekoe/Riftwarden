import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { sfx } from '../../audio/Sfx';
import { speedFactor } from '@riftwarden/rules/combat/status';
import { BOSSES, bossPhase, bossScaling } from '@riftwarden/rules/survival/bosses';
import { buildColossus, COLOSSUS_HULL_Y, COLOSSUS_SCALE, type ColossusRig } from '../../visuals/bossModels';
import type { Behavior, Enemy, EnemyContext } from '../EnemyManager';
import { turnTowards } from '../EnemyManager';

type AttackKind = 'volley' | 'stomp' | 'mortar' | 'missiles' | 'summon' | 'beam';

interface Attack {
  kind: AttackKind;
  t: number;
  dur: number;
  marker: number;
  lines: number[];
  target: Vector3;
  fired: number;
}

interface ColossusAI {
  rig: ColossusRig;
  phase: 1 | 2 | 3;
  transT: number;
  atk: Attack | null;
  gcd: number;
  cd: Record<AttackKind, number>;
  walk: number;
  summons: number;
  doorT: number;
  door: number;
  atReactor: boolean;
  taken: number;
  stagger: number;
  recoil: number;
  lift: number;
  interrupts: number;
  attacks: Partial<Record<AttackKind, number>>;
  coreBox: import('@babylonjs/core/Meshes/mesh').Mesh | null;
  pitch: number;
}

/** Tuning (base numbers; damage is multiplied by the wave/tier/boss damage scaling through e.dmg). */
export const COLOSSUS = {
  stompRadius: 10,
  stompHeight: 1.6,
  volleyAim: 1.3,
  shellFlight: 1.05,
  shellRadius: 3.2,
  coreMult: 2.5,
  doorOpen: 4.5,
  beamCharge: 3.0,
  beamInterrupt: 0.06,
  beamReactor: 110,
  transition: 1.8,
} as const;

const TMP = new Vector3();
const PHASE_NAMES = ['', 'ASSAULT', 'ARSENAL UNLOCKED', 'SIEGE MODE'];
const ATTACK_NAMES: Record<AttackKind, string> = { volley: 'CANNON VOLLEY', stomp: 'SEISMIC STOMP', mortar: 'MORTAR STRIKE', missiles: 'MISSILE SALVO', summon: 'DEPLOYING DRONES', beam: 'SIEGE BEAM → REACTOR' };

function ai(e: Enemy): ColossusAI {
  return e.ai as unknown as ColossusAI;
}

export const colossusBehavior: Behavior = {
  create(e, m) {
    const rig = buildColossus(m.kit, m.P);
    rig.root.parent = e.root;
    e.ai.rig = rig;
    m.addHitbox(e, rig.hull, 0, 0, 3.0, false);
    m.addHitbox(e, rig.hull, 1.2, -0.5, 2.1, false);
    // Sensor head: small, always exposed (precision reward).
    m.addHitbox(e, rig.head, 0, 0.55, 0.75, true, 'head');
    // Rear reactor core: only pickable while the compartment is open.
    e.ai.coreBox = m.addHitbox(e, rig.hull, 0.15, -3.45, 1.05, true, 'core');
  },
  spawn(e) {
    const a = ai(e);
    Object.assign(a, { phase: 1, transT: 0, atk: null, gcd: 3, cd: { volley: 1, stomp: 4, mortar: 6, missiles: 8, summon: 4, beam: 6 }, walk: 0, summons: 0, doorT: 0, door: 0, atReactor: false, taken: 0, stagger: 0, recoil: 0, lift: 0, interrupts: 0, attacks: {}, pitch: 0 });
    for (const p of a.rig.plates) p.setEnabled(true);
    for (const v of a.rig.vents) v.setEnabled(false);
    if (a.coreBox) a.coreBox.isPickable = false;
  },
  update(e, hdt, ctx, m) {
    const a = ai(e);
    const rig = a.rig;
    const sc = bossScaling(e.encounter, 1);
    const sf = Math.max(0.35, speedFactor(e.status));
    const adt = hdt * sf * e.rateMult;
    // ---- phase transitions
    const want = bossPhase(BOSSES.colossus, e.hp / e.maxHp);
    if (want > a.phase) {
      a.phase = want;
      a.transT = COLOSSUS.transition;
      a.summons = 0;
      cancel(a, ctx);
      ctx.alert(`SIEGE COLOSSUS · PHASE ${a.phase} · ${PHASE_NAMES[a.phase]}`, 'red');
      sfx.play('bossRoar', { volume: 1, pitch: a.phase === 3 ? 0.8 : 1 });
      if (a.phase === 2) {
        for (const p of rig.plates) {
          p.computeWorldMatrix(true);
          ctx.effects.debrisBurst(p.getAbsolutePosition(), 4, 7, 1.6);
          p.setEnabled(false);
        }
      }
      if (a.phase === 3) for (const v of rig.vents) v.setEnabled(true);
      ctx.effects.burst('sparks', e.center(TMP), 40, undefined, 2);
      ctx.effects.burst('smoke', e.center(TMP), 10, undefined, 2);
    }
    if (a.transT > 0) {
      a.transT -= hdt;
      rig.hull.position.y = COLOSSUS_HULL_Y - 0.3 + Math.sin(a.transT * 30) * 0.05;
      rig.hull.rotation.z = Math.sin(a.transT * 22) * 0.04;
      if (Math.random() < hdt * 8) ctx.effects.burst('sparks', e.center(TMP).addInPlaceFromFloats((Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4), 6);
      e.root.position.copyFrom(e.pos);
      return;
    }
    if (a.stagger > 0) {
      a.stagger -= hdt;
      rig.hull.rotation.x = -0.12 * Math.sin(a.stagger * 6);
      e.root.position.copyFrom(e.pos);
      return;
    }
    for (const k of Object.keys(a.cd) as AttackKind[]) a.cd[k] -= adt;
    a.gcd -= adt;
    if (a.doorT > 0) a.doorT -= hdt;
    // ---- movement (stops while performing an attack)
    const before = TMP.copyFrom(e.pos);
    const bx = before.x;
    const bz = before.z;
    if (!a.atk && !a.atReactor) {
      const speed = e.def.speed * e.moveMult * sf * (a.phase === 1 ? 1 : a.phase === 2 ? 1.25 : 1.45);
      a.atReactor = m.follow(e, speed, hdt, 0.8);
    } else if (a.atReactor) e.yaw = turnTowards(e.yaw, Math.atan2(-e.pos.x, -e.pos.z), hdt * 0.8);
    const moved = Math.hypot(e.pos.x - bx, e.pos.z - bz);
    a.walk += moved * 0.85;

    // ---- choose an attack
    if (!a.atk && a.gcd <= 0) choose(e, a, ctx, sc);
    if (a.atk) run(e, a, adt, ctx, sc);

    // ---- animation
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
    const stepping = moved > 0.0005;
    for (const leg of rig.legs) {
      const off = leg.side === leg.front ? 0 : Math.PI;
      const s = Math.sin(a.walk + off);
      const swing = stepping ? s * 0.22 : 0;
      const lift = stepping ? Math.max(0, Math.cos(a.walk + off)) * 0.18 : 0;
      const stompLift = leg.front > 0 ? a.lift * 0.45 : -a.lift * 0.1;
      leg.hip.rotation.x = -swing - stompLift;
      leg.hip.rotation.z = leg.side * lift;
    }
    const bob = stepping ? Math.abs(Math.sin(a.walk)) * 0.14 : 0;
    a.pitch += ((a.atk?.kind === 'stomp' ? -0.16 * a.lift / 0.9 : 0) - a.pitch) * Math.min(1, hdt * 6);
    rig.hull.position.y = COLOSSUS_HULL_Y + bob + a.lift * 0.5;
    rig.hull.rotation.x = a.pitch + e.flinch * 0.02;
    rig.hull.rotation.z = stepping ? Math.sin(a.walk) * 0.025 : 0;
    // Cannons track the drone.
    const pp = ctx.player.position;
    for (const c of rig.cannons) {
      const local = Math.atan2(pp.x - e.pos.x, pp.z - e.pos.z) - e.yaw;
      const want2 = Math.max(-0.8, Math.min(0.8, Math.atan2(Math.sin(local), Math.cos(local))));
      c.mount.rotation.y += (want2 - c.mount.rotation.y) * Math.min(1, hdt * 2);
      c.barrel.position.z = 0.4 - a.recoil * 0.5;
    }
    a.recoil = Math.max(0, a.recoil - hdt * 3);
    // Core compartment
    const open = a.doorT > 0 || a.atk?.kind === 'beam' ? 1 : 0;
    a.door += (open - a.door) * Math.min(1, hdt * 5);
    for (let i = 0; i < rig.doors.length; i++) rig.doors[i].position.x = (i ? 1 : -1) * (0.7 + a.door * 0.8);
    if (a.coreBox) a.coreBox.isPickable = a.door > 0.5;
    rig.core.scaling.set(1.15 + a.door * 0.15 + 0.05 * Math.sin(ctx.time * 9), 0.5, 1.15 + a.door * 0.15);
    const podOpen = a.atk?.kind === 'missiles' || a.phase >= 2 ? 1 : 0;
    for (const p of rig.pods) p.cover.rotation.x += (-1.4 * podOpen - p.cover.rotation.x) * Math.min(1, hdt * 4);
    rig.hatch.position.y = -1.5 - (a.atk?.kind === 'summon' ? 0.4 : 0);
  },
  damageMod(e, amount, info) {
    const a = ai(e);
    if (a.transT > 0) return amount * 0.15;
    let out = amount;
    if (info.weak && a.door > 0.5 && info.point.y < e.pos.y + (COLOSSUS_HULL_Y + 1.4) * COLOSSUS_SCALE && isRear(e, info.point)) out *= COLOSSUS.coreMult;
    if (a.atk?.kind === 'beam') a.taken += out;
    return out;
  },
  death(e, ctx) {
    const a = ai(e);
    cancel(a, ctx);
    ctx.alert('SIEGE COLOSSUS · STRUCTURAL FAILURE', 'white');
    sfx.play('bossRoar', { volume: 1, pitch: 0.6 });
    return 3.4;
  },
  dying(e, dt, t, ctx) {
    const a = ai(e);
    const rig = a.rig;
    // Collapse: legs buckle, hull sinks and tilts, chained explosions, final detonation.
    for (const leg of rig.legs) leg.hip.rotation.z = leg.side * Math.min(0.9, t * 0.5);
    rig.hull.position.y = COLOSSUS_HULL_Y - Math.min(2.6, t * t * 0.4);
    rig.hull.rotation.x = Math.min(0.25, t * 0.08);
    rig.hull.rotation.z = Math.sin(t * 2) * 0.05;
    if (Math.floor(t / 0.3) !== Math.floor((t - dt) / 0.3) && t < 3) {
      const p = e.center(new Vector3()).addInPlaceFromFloats((Math.random() - 0.5) * 5, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 6);
      ctx.effects.explode(p, { scale: 1 + Math.random() * 0.6, debris: 6, style: Math.random() < 0.35 ? 'electric' : 'fire' });
      sfx.play('explosion', { volume: ctx.panFor(p).volume * 0.8, pitch: 0.8 + Math.random() * 0.3, pan: ctx.panFor(p).pan });
    }
    if (t >= 3.2 && t - dt < 3.2) {
      const c = e.center(new Vector3());
      // The hull comes apart: legs, plates, cannons and pods are thrown as real pieces.
      ctx.effects.shatter(e.root, c, 13, 22, 1);
      ctx.effects.explode(c, { scale: 4.2, debris: 20, color: new Color3(3.2, 1.2, 0.3), style: 'heavy' });
      ctx.effects.ring(new Vector3(c.x, 0.2, c.z), 16, 0.7, new Color3(3, 1.2, 0.3), true);
      ctx.effects.flashLight(c, 16, 1.2, new Color3(1, 0.6, 0.3));
      sfx.play('explosion', { volume: 1, pitch: 0.45 });
    }
  },
  release(e) {
    const a = ai(e);
    a.atk = null;
    const rig = a.rig;
    rig.hull.position.y = COLOSSUS_HULL_Y;
    rig.hull.rotation.set(0, 0, 0);
    for (const leg of rig.legs) leg.hip.rotation.set(0, 0, 0);
  },
  hud(e) {
    const a = ai(e);
    return {
      title: BOSSES.colossus.title,
      phase: a.phase,
      ticks: [...BOSSES.colossus.phases],
      state: a.transT > 0 ? 'RECONFIGURING' : a.stagger > 0 ? 'STAGGERED' : a.door > 0.5 ? 'CORE EXPOSED · REAR COMPARTMENT' : PHASE_NAMES[a.phase],
      immune: a.transT > 0,
      attack: a.atk ? ATTACK_NAMES[a.atk.kind] : '',
    };
  },
};

function isRear(e: Enemy, p: Vector3): boolean {
  const dx = p.x - e.pos.x;
  const dz = p.z - e.pos.z;
  return dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw) < -1.5;
}

function cancel(a: ColossusAI, ctx: EnemyContext): void {
  if (!a.atk) return;
  ctx.tele.cancel(a.atk.marker);
  for (const l of a.atk.lines) ctx.tele.cancel(l);
  a.atk = null;
  a.lift = 0;
  for (const p of a.rig.pods) for (const g of p.glow) g.setEnabled(false);
  a.rig.lanceTip.scaling.setAll(0.36);
}

function start(a: ColossusAI, kind: AttackKind, dur: number): Attack {
  a.atk = { kind, t: 0, dur, marker: 0, lines: [], target: new Vector3(), fired: 0 };
  a.attacks[kind] = (a.attacks[kind] ?? 0) + 1;
  return a.atk;
}

function choose(e: Enemy, a: ColossusAI, ctx: EnemyContext, sc: ReturnType<typeof bossScaling>): void {
  const pl = ctx.player;
  const pp = pl.position;
  const dPlayer = Math.hypot(pp.x - e.pos.x, pp.z - e.pos.z);
  const c = e.center(TMP);
  const R = ctx.layout.reactor;
  const dReactor = Math.hypot(R.x - e.pos.x, R.z - e.pos.z);
  const towersNear = ctx.towers.filter((t) => !t.building && Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z) < COLOSSUS.stompRadius);
  const towersFar = ctx.towers.filter((t) => !t.building && !t.disabled && Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z) < 42);
  const cad = sc.cadence * (a.phase === 3 ? 0.75 : 1);
  if (a.phase === 3 && a.cd.beam <= 0 && dReactor < 46) {
    const k = start(a, 'beam', COLOSSUS.beamCharge);
    a.taken = 0;
    k.target.set(R.x + ((e.pos.x - R.x) / Math.max(1, dReactor)) * R.radius, 3.5, R.z + ((e.pos.z - R.z) / Math.max(1, dReactor)) * R.radius);
    k.marker = ctx.tele.marker(new Vector3(k.target.x, 0, k.target.z), 3.2, k.dur, 'red');
    a.rig.lanceTip.computeWorldMatrix(true);
    k.lines.push(ctx.tele.line(a.rig.lanceTip.getAbsolutePosition(), k.target, k.dur, 'red', 0.12));
    ctx.alert('SIEGE BEAM CHARGING · REACTOR TARGETED · HIT THE EXPOSED CORE TO INTERRUPT', 'red');
    sfx.play('charge', { pitch: 0.4, volume: 1 });
    a.cd.beam = 16 * cad;
    return;
  }
  if (a.cd.stomp <= 0 && ((pl.alive && dPlayer < COLOSSUS.stompRadius) || towersNear.length || a.atReactor)) {
    const k = start(a, 'stomp', 1.5);
    k.target.set(e.pos.x, 0, e.pos.z);
    k.marker = ctx.tele.marker(k.target, COLOSSUS.stompRadius, k.dur, 'orange', () => (e.alive ? new Vector3(e.pos.x, 0, e.pos.z) : null));
    ctx.alert('SEISMIC STOMP · JUMP OR CLEAR THE RING', 'orange');
    sfx.play('charge', { pitch: 0.35, volume: 0.9 });
    a.cd.stomp = 9 * cad;
    a.gcd = 0.6;
    return;
  }
  if ((a.phase >= 2 || sc.variant >= 1) && a.cd.missiles <= 0 && pl.alive) {
    start(a, 'missiles', 1.1);
    ctx.alert('MISSILE SALVO · BREAK LINE OF SIGHT', 'orange');
    for (const p of a.rig.pods) for (const g of p.glow) g.setEnabled(true);
    sfx.play('alarm', { volume: 0.5 });
    a.cd.missiles = 12 * cad;
    return;
  }
  if (a.phase >= 2 && a.cd.summon <= 0 && a.summons < 1 + Math.ceil(sc.extraSummons / 2)) {
    start(a, 'summon', 1.3);
    ctx.alert('COLOSSUS DEPLOYING DRONES', 'orange');
    a.summons++;
    a.cd.summon = 18 * cad;
    return;
  }
  if (a.cd.mortar <= 0 && towersFar.length) {
    const t = towersFar[Math.floor(Math.random() * towersFar.length)];
    const k = start(a, 'mortar', 0.8);
    k.target.set(t.pos.x, t.pos.y, t.pos.z);
    a.cd.mortar = 8 * cad;
    return;
  }
  if (a.cd.volley <= 0 && pl.alive && dPlayer < 70 && ctx.los(c.clone().addInPlaceFromFloats(0, 1.5, 0), pl.eye)) {
    const k = start(a, 'volley', COLOSSUS.volleyAim);
    for (const cn of a.rig.cannons) {
      cn.muzzle.computeWorldMatrix(true);
      k.lines.push(ctx.tele.line(cn.muzzle.getAbsolutePosition(), pl.eye, k.dur, 'orange', 0.05));
    }
    sfx.play('charge', { pitch: 1.2, volume: 0.6 });
    a.cd.volley = 6 * cad;
  }
}

function run(e: Enemy, a: ColossusAI, adt: number, ctx: EnemyContext, sc: ReturnType<typeof bossScaling>): void {
  const k = a.atk!;
  k.t += adt;
  const f = Math.min(1, k.t / k.dur);
  const pl = ctx.player;
  const rig = a.rig;
  // Face the relevant target while winding up.
  const face = k.kind === 'volley' || k.kind === 'missiles' ? pl.position : k.kind === 'beam' || k.kind === 'mortar' ? k.target : null;
  if (face) e.yaw = turnTowards(e.yaw, Math.atan2(face.x - e.pos.x, face.z - e.pos.z), adt * 0.9);
  switch (k.kind) {
    case 'volley': {
      for (let i = 0; i < rig.cannons.length; i++) {
        rig.cannons[i].muzzle.computeWorldMatrix(true);
        ctx.tele.moveLine(k.lines[i], rig.cannons[i].muzzle.getAbsolutePosition(), pl.eye, 0.05);
      }
      if (f >= 1) {
        const per = a.phase === 3 ? 3 : 2;
        const pp = pl.position;
        for (const cn of rig.cannons) {
          cn.muzzle.computeWorldMatrix(true);
          const from = cn.muzzle.getAbsolutePosition().clone();
          for (let i = 0; i < per; i++) {
            const to = new Vector3(pp.x + (Math.random() - 0.5) * 7, Math.max(0, pp.y - 1.2), pp.z + (Math.random() - 0.5) * 7);
            ctx.ordnance.lob(from, to, COLOSSUS.shellFlight + i * 0.18, { radius: COLOSSUS.shellRadius, damage: e.dmg(22), reactorDamage: 0, disable: 3, owner: e.id }, 'orange');
          }
          ctx.effects.burst('flash', from, 1, undefined, 0.8);
          ctx.effects.burst('smoke', from, 4, undefined, 1.2);
        }
        a.recoil = 1;
        sfx.play('mortar', { volume: 1, pitch: 0.7 });
        a.atk = null;
        a.gcd = a.phase === 3 ? 0.2 : 1.2;
        if (a.phase === 3) a.cd.stomp = Math.min(a.cd.stomp, 0.4);
      }
      break;
    }
    case 'stomp': {
      a.lift = f < 0.85 ? Math.min(1, f / 0.7) * 0.9 : 0.9 * (1 - (f - 0.85) / 0.15);
      if (f >= 1) {
        const c = new Vector3(e.pos.x, 0, e.pos.z);
        const R = COLOSSUS.stompRadius;
        const pp = pl.position;
        const d = Math.hypot(pp.x - c.x, pp.z - c.z);
        if (pl.alive && d < R && pp.y < COLOSSUS.stompHeight + 0.9) {
          ctx.hurtPlayer(e.dmg(38) * (1 - 0.4 * (d / R)), c);
          pl.knockback(new Vector3(pp.x - c.x, 0.4, pp.z - c.z).normalize(), 14);
        }
        ctx.hostileBlast(c, R, { player: 0, reactor: e.dmg(30), disable: 6, owner: e });
        ctx.effects.ring(new Vector3(c.x, 0.15, c.z), R * 1.15, 0.6, new Color3(3, 1.2, 0.3), true);
        ctx.effects.ring(new Vector3(c.x, 0.3, c.z), R * 0.6, 0.4, new Color3(2, 2, 2), true);
        ctx.effects.burst('puff', c, 40, undefined, 2.6);
        ctx.effects.debrisBurst(c.add(new Vector3(0, 0.5, 0)), 10, 6, 1);
        ctx.effects.onShake?.(c, 0.9);
        sfx.play('slam', { volume: 1, pitch: 0.6 });
        a.lift = 0;
        a.atk = null;
        a.gcd = 1.4;
        if (a.phase >= 2) a.doorT = COLOSSUS.doorOpen;
      }
      break;
    }
    case 'mortar': {
      if (f >= 1) {
        const from = e.center(new Vector3()).addInPlaceFromFloats(0, 2.2, 0);
        ctx.ordnance.lob(from, k.target, 2.3, { radius: 4.2, damage: e.dmg(25), reactorDamage: 0, disable: 8, owner: e.id }, 'red', 'bomb');
        sfx.play('mortar', { volume: 0.9, pitch: 0.55 });
        a.atk = null;
        a.gcd = 0.8;
      }
      break;
    }
    case 'missiles': {
      const total = (a.phase === 3 ? 8 : 6) + sc.variant;
      const launchStart = 0.45;
      const want = f < launchStart ? 0 : Math.min(total, Math.floor(((k.t - k.dur * launchStart) / (k.dur * (1 - launchStart))) * total) + 1);
      while (k.fired < want) {
        const pod = rig.pods[k.fired % rig.pods.length];
        pod.muzzle.computeWorldMatrix(true);
        const from = pod.muzzle.getAbsolutePosition().clone();
        const dir = new Vector3((Math.random() - 0.5) * 0.6, 1, (Math.random() - 0.5) * 0.6);
        ctx.ordnance.missile(from, dir, 13, 1.25, e.dmg(12), 2.2, e.id);
        ctx.effects.burst('smoke', from, 2, undefined, 0.8);
        k.fired++;
      }
      if (f >= 1) {
        for (const p of rig.pods) for (const g of p.glow) g.setEnabled(false);
        sfx.play('railFire', { volume: 0.6, pitch: 0.5 });
        a.atk = null;
        a.gcd = 1;
        a.doorT = COLOSSUS.doorOpen;
      }
      break;
    }
    case 'summon': {
      if (f >= 1) {
        rig.hatch.computeWorldMatrix(true);
        const at = rig.hatch.getAbsolutePosition();
        const n = 2 + sc.extraSummons;
        for (let i = 0; i < n; i++) ctx.summon('rusher', new Vector3(at.x + (Math.random() - 0.5) * 3, 0, at.z + (Math.random() - 0.5) * 3));
        ctx.summon(a.phase === 3 ? 'enforcer' : 'engineer', new Vector3(at.x, 0, at.z));
        ctx.effects.burst('smoke', at, 8, undefined, 1.5);
        a.atk = null;
        a.gcd = 1;
      }
      break;
    }
    case 'beam': {
      rig.lanceTip.scaling.setAll(0.36 + f * 0.9 + 0.08 * Math.sin(ctx.time * 40));
      if (Math.random() < adt * 14) {
        rig.lanceTip.computeWorldMatrix(true);
        ctx.effects.burst('zap', rig.lanceTip.getAbsolutePosition(), 2, undefined, 0.8);
      }
      if (a.taken >= COLOSSUS.beamInterrupt * e.maxHp) {
        cancel(a, ctx);
        a.stagger = 2;
        a.doorT = 3;
        a.interrupts++;
        ctx.alert('SIEGE BEAM INTERRUPTED', 'blue');
        ctx.effects.burst('sparks', e.center(new Vector3()), 40, undefined, 2);
        sfx.play('shieldHit', { pitch: 0.4, volume: 1 });
        return;
      }
      if (f >= 1) {
        rig.lanceTip.computeWorldMatrix(true);
        const from = rig.lanceTip.getAbsolutePosition().clone();
        ctx.tele.line(from, k.target, 0.45, 'white', 0.55);
        ctx.tele.line(from, k.target, 0.6, 'red', 0.9);
        ctx.damageReactor(e.dmg(COLOSSUS.beamReactor), k.target);
        ctx.effects.explode(k.target, { scale: 2, debris: 8, color: new Color3(3.2, 0.6, 0.2) });
        ctx.effects.onShake?.(k.target, 0.7);
        sfx.play('railFire', { volume: 1, pitch: 0.3 });
        cancel(a, ctx);
        a.gcd = 1.5;
      }
      break;
    }
  }
}

export type { ColossusAI };
