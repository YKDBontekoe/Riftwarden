import { Color3, type Scene, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { rollDamage } from '../combat/damage';
import type { Director } from '../combat/Director';
import type { CombatStats } from '../combat/stats';
import { isChilled, speedFactor } from '../combat/status';
import type { ShotOutcome, ShotRequest, SurfaceImpact, Weapon, WeaponFxHooks } from '../combat/Weapon';
import type { WeaponFamily } from '../data/defs';
import type { Enemy, EnemyManager } from '../enemies/EnemyManager';
import type { Turret } from '../defense/Turrets';
import type { Effects } from '../fx/Effects';
import type { WeaponFx } from '../fx/WeaponFx';
import { MOVE, type Player } from '../player/Player';
import { hasLost, LIMB_IDS } from '../enemies/limbs';
import { UP } from '../roguelite/upgrades';
import { uiEvents } from '../ui/store';
import { arenaDeckWetness } from '../visuals/textures';
import { traceShot } from './shotTrace';

/** Seconds between kills that keep a kill chain going. */
export const KILL_CHAIN_WINDOW = 2.5;
/** Arc Conductor reach (m): enemies on the lanes are spread a few metres apart. */
export const ARC_RANGE = 12;
/** Pulse Capacitor splash radius (m). */
export const PULSE_SPLASH = 3;

/** What the player's weapon combat needs from the arena (no Game import). */
export interface CombatHost {
  readonly scene: Scene;
  readonly enemies: EnemyManager;
  readonly director: Director;
  readonly fx: Effects;
  readonly wfx: WeaponFx;
  readonly weapon: Weapon;
  readonly player: Player;
  readonly stats: CombatStats;
  /** Run clock (s), for kill chains. */
  readonly runTime: number;
  /** Signature of the weapon firing right now (co-op server: the shooter's). */
  signature(): string | null;
  /** Heat of the weapon firing right now (0..1). */
  heat(): number;
  /** Current drone speed (m/s); dashes count as fast. */
  droneSpeed(): number;
  hitstop(seconds: number, scale: number): void;
  /** Re-enter the (overridable) damage entry, used by Arc Conductor jumps. */
  damageEnemy(source: 'player' | 'turret', e: Enemy, base: number, point: Vector3, weak: boolean, turret?: Turret, family?: WeaponFamily | 'arc', from?: Vector3): void;
}

const KILL_AT = new Vector3();
const KILL_LIGHT = new Color3(1.6, 1.5, 1.35);

export type DamageSource = 'player' | 'turret';

/**
 * The player's weapon in the arena: hitscan resolution, legacy damage entry (crit, situational upgrades,
 * signatures, Arc Conductor), kill feel (hitstop, chain, dash refund) and per-family world visuals.
 * Damage itself goes through `Director.deal`; this class decides what a weapon hit is worth and how it looks.
 */
export class PlayerCombat {
  /** Arc Conductor procs this run (automation/tests). */
  arcs = 0;
  private beamFxT = 0;
  private sigHits = 0;

  constructor(private h: CombatHost) {}

  /** Resolve a shot from the camera ray and apply its damage immediately (`fxHooks` only visualise it). */
  shoot(r: ShotRequest): ShotOutcome {
    const h = this.h;
    h.director.bus.emit({ type: 'fire', chain: h.director.bus.newChain(), source: { kind: 'weapon', id: r.family }, value: 1 });
    const { struck, wall } = traceShot(h.scene, h.enemies.active, r);
    // Read the outcome before damage lands (a shot that breaks a shield still shows the shield impact).
    const out = shotOutcome(r, struck, wall);
    let dmg = r.damage;
    for (const s of struck) {
      if (s.assisted) {
        h.damageEnemy('player', s.enemy, dmg, s.point, false, undefined, 'beam');
        break;
      }
      h.damageEnemy('player', s.enemy, dmg, s.point, s.weak, undefined, r.family);
      if (h.weapon.def.mechanism === 'pulse') this.pulseSplash(s.point, dmg, s.enemy);
      dmg *= 0.85;
    }
    return out;
  }

  /** World-space shot visuals and impacts per family (presentation only). */
  readonly fxHooks: WeaponFxHooks = {
    shot: (family, from, out, power, speed) => {
      const { wfx, fx, weapon } = this.h;
      if (power < 0) {
        // Pulse Capacitor: bright streak + detonation at the impact.
        wfx.rail(from, out.point, 0.7);
        if (out.target !== 'none') {
          fx.explode(out.point, { scale: 0.45, debris: 1, color: weapon.rig.energyBase.scale(1.4), style: 'plasma' });
          fx.ring(out.point, PULSE_SPLASH, 0.22, weapon.rig.energyBase.scale(0.8), false);
        }
        return;
      }
      const impact = () => this.impactFx(family, out, power);
      if (family === 'plasma') {
        wfx.bolt(from, out.point, speed, 0.34, out.target === 'none' ? null : impact);
      } else if (family === 'rail') {
        wfx.rail(from, out.point, power);
        fx.ring(from, 0.22 + 0.18 * power, 0.12, weapon.rig.energyBase.scale(0.5), false);
        impact();
      } else {
        // Beam ticks: throttle contact particles (the beam itself is continuous).
        this.beamFxT -= 1 / 15;
        if (this.beamFxT <= 0) {
          this.beamFxT = 0.12;
          impact();
        }
      }
    },
    beam: (on, from, to, intensity, contact) => this.h.wfx.beam(on, from, to, intensity, contact),
  };

  impactFx(family: WeaponFamily, out: ShotOutcome, power: number): void {
    const { fx, weapon } = this.h;
    const p = out.point;
    if (out.target === 'surface' && out.normal) {
      const pos = p.add(out.normal.scale(0.03));
      fx.impact(pos, out.normal, out.surface, family === 'beam');
      if (family === 'rail') {
        fx.burst('sparks', pos, Math.round(8 + 10 * power), out.normal, 0.7);
        fx.ring(pos, 1.6 * power + 0.6, 0.25, weapon.rig.energyBase.scale(0.5), false);
        fx.flashLight(pos, 3 * power, 0.18, weapon.rig.energyBase.scale(0.4));
      }
    } else if (out.target === 'shield') {
      fx.burst('shield', p, family === 'rail' ? 24 : 8, undefined, family === 'rail' ? 1.5 : 1);
      if (family === 'rail') fx.ring(p, 2.4, 0.25, new Color3(2.6, 0.9, 0.2), false);
    } else if (out.target === 'enemy') {
      if (family === 'rail') {
        fx.burst('sparks', p, 14, undefined, 0.8);
        fx.debrisBurst(p, 3, 5, 0.6);
      } else if (family === 'beam') fx.burst('enemySpark', p, 4, undefined, 0.8);
    }
  }

  /**
   * Legacy damage entry (player weapon, Sentinel-style tower hits, debug): rolls crit, then hands the hit to the
   * director's shared pipeline (statuses, reactions, events, kill handling) and plays direct-hit feedback.
   */
  damage(source: DamageSource, e: Enemy, base: number, point: Vector3, weakpoint: boolean, turret?: Turret, family?: WeaponFamily | 'arc', from?: Vector3): void {
    if (!e.alive) return;
    const h = this.h;
    const build = h.director.build;
    const stats = h.stats;
    const player = source === 'player';
    const prec = build.count('s_precision');
    const crit = player && prec && (isChilled(e.status, 1) || speedFactor(e.status) < 0.95) ? { critChance: stats.critChance + UP.precision.crit(prec), critMultiplier: stats.critMultiplier + UP.precision.critDmg(prec) } : stats;
    // Run upgrades that scale weapon hits from the situation.
    if (player) {
      const ex = build.count('w_exec');
      if (ex && e.hp < e.maxHp * UP.exec.hp) base *= 1 + UP.exec.bonus(ex);
      const mo = build.count('m_momentum');
      if (mo && h.droneSpeed() > UP.momentum.speed) base *= 1 + UP.momentum.bonus(mo);
      // Legendary / exotic signatures (damage shaping).
      const sig = family !== 'arc' ? h.signature() : null;
      if (sig === 'overdrive' && h.heat() > 0.7) base *= 1.35;
      if (sig === 'phase' && (e.shield > 0 || e.armor > 0 || e.kind === 'enforcer' || e.kind === 'crawler')) base *= 1.8;
    }
    const roll = rollDamage(base, crit, weakpoint, Math.random, 'energy', source);
    const partsBefore = e.limbsLost;
    // Arc Conductor: a player hit may jump to the nearest other enemy (no chains of arcs).
    if (player && family !== 'arc' && stats.arcChance > 0 && Math.random() < stats.arcChance) this.arcFrom(e, point, roll.amount * stats.arcDamage);
    const src = family === 'arc' ? { kind: 'effect' as const, id: 'arc_conductor' } : player ? { kind: 'weapon' as const, id: family ?? 'plasma' } : { kind: 'tower' as const, id: 'sentinel', towerId: turret?.id };
    const res = h.director.deal({ target: e, amount: roll.amount, base, crit: roll.crit, weak: weakpoint, element: 'none', source: src, chain: h.director.bus.newChain(), point, family: family ?? (player ? 'plasma' : 'tower'), from: from ?? (player ? h.player.eye : undefined) });
    if (!player) return;
    if (e.limbsLost !== partsBefore) {
      const lost = LIMB_IDS.find((l) => hasLost(e.limbsLost, l) && !hasLost(partsBefore, l));
      if (lost) uiEvents.emit('limb', lost);
    }
    if (family !== 'arc') this.signatureAfterHit(e, point, roll.amount, roll.crit, res);
    const kind = res.kind;
    if (res.killed && family !== 'arc') this.kill(e);
    uiEvents.emit('hit', kind);
    // Beam ticks are frequent: lighter per-tick feedback (the beam contact carries the rest).
    const beam = family === 'beam';
    if (kind === 'crit') h.fx.burst('crit', point, beam ? 3 : 10);
    else if (kind === 'hit' && !beam) h.fx.burst('enemySpark', point, 6);
    if (kind === 'kill') sfx.play('kill', { pitch: 1 + Math.min(0.45, (h.player.chain - 1) * 0.045) });
    else if (!beam || kind === 'crit') sfx.play(kind === 'crit' ? 'crit' : kind === 'shield' ? 'shieldHit' : 'hit');
    else sfx.play('hit', { volume: 0.35 });
  }

  /**
   * A kill by the current drone's weapon: hitstop (heavier for elites / big chassis), kill chain (kills within
   * `KILL_CHAIN_WINDOW` s stack) and a dash refund, so aggressive play keeps the drone fast.
   */
  kill(e: Enemy): void {
    const heavy = e.elite || e.def.role === 'boss' || e.def.role === 'hvt' || e.def.hp >= 150;
    this.h.hitstop(heavy ? 0.1 : 0.045, heavy ? 0.04 : 0.2);
    const p = this.h.player;
    p.refundDash(MOVE.killDashRefund * (heavy ? 2 : 1));
    p.chain = this.h.runTime - p.chainAt <= KILL_CHAIN_WINDOW ? p.chain + 1 : 1;
    p.chainAt = this.h.runTime;
    if (p.chain >= 2) uiEvents.emit('chain', p.chain);
    if (heavy) p.addTrauma(0.2);
    // Kill flash: a white star and a short light where the machine dies.
    const c = e.center(KILL_AT);
    this.h.fx.burst('flash', c, 1, undefined, heavy ? 0.7 : 0.45);
    this.h.fx.flashLight(c, heavy ? 5 : 2.8, 0.07, KILL_LIGHT);
  }

  /** Pulse Capacitor: every pulse detonates (60% damage in PULSE_SPLASH m). */
  pulseSplash(point: Vector3, dmg: number, hit: Enemy | null): void {
    const d = this.h.director;
    d.blast(point, PULSE_SPLASH, dmg * 0.6, 'none', { kind: 'weapon', id: 'beam' }, d.bus.newChain(), { falloff: 0.4, exclude: hit, family: 'splash' });
  }

  /** Signatures that react to a landed hit. */
  private signatureAfterHit(e: Enemy, point: Vector3, amount: number, crit: boolean, res: { dealt: number; killed: boolean }): void {
    const sig = this.h.signature();
    if (!sig) return;
    const { director: d, player } = this.h;
    const src = { kind: 'effect' as const, id: `sig:${sig}` };
    if (sig === 'chain_reaction' && res.killed) {
      d.blast(point, 3.5, amount * 0.6, 'thermal', src, d.bus.newChain(), { falloff: 0.35, exclude: e });
      d.explosionFx(point, 3.5, 'thermal');
    } else if (sig === 'stormcaller' && ++this.sigHits % 6 === 0 && e.alive) {
      const sky = point.add(new Vector3(0, 9, 0));
      this.h.wfx.arc(sky, point);
      d.chainLightning({ from: point, first: e, count: 3, amount: amount * 2, falloff: 0.7, source: src, chain: d.bus.newChain(), shock: true });
      sfx.play('arc', { volume: 0.9, pitch: 0.7 });
    } else if (sig === 'siphon' && res.dealt > 0 && player.maxShield > 0) {
      player.shield = Math.min(player.maxShield, player.shield + res.dealt * 0.03);
    } else if (sig === 'rift_echo' && crit) {
      for (const o of d.enemiesNear(point, 4)) d.inflict(o, { chill: 40 }, src, d.bus.newChain(), o.center(new Vector3()));
      this.h.fx.ring(point, 4, 0.4, new Color3(1.6, 0.5, 3.0), false);
    }
  }

  /** Arc to the nearest other living enemy within ARC_RANGE of the struck one. */
  private arcFrom(src: Enemy, point: Vector3, amount: number): void {
    if (amount <= 0) return;
    let best: Enemy | null = null;
    let bestD = ARC_RANGE * ARC_RANGE;
    for (const o of this.h.enemies.active) {
      if (o === src || !o.alive) continue;
      const d = Vector3.DistanceSquared(o.pos, src.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return;
    const to = best.center(new Vector3());
    this.arcs++;
    this.h.wfx.arc(point, to);
    this.h.fx.burst('impact', to, 8);
    sfx.play('arc', { volume: 0.7 });
    this.h.damageEnemy('player', best, amount, to, false, undefined, 'arc');
  }
}

/** The visible outcome of a traced shot: first enemy struck, else the wall, else the end of range. */
export function shotOutcome(r: ShotRequest, struck: readonly { enemy: Enemy; point: Vector3 }[], wall: ReturnType<typeof traceShot>['wall'], wetDeck = true): ShotOutcome {
  if (struck.length) {
    const s = struck[0];
    return { point: s.point, normal: null, target: s.enemy.shield > 0 ? 'shield' : 'enemy', enemyId: s.enemy.id };
  }
  if (wall) {
    const n = wall.getNormal(true, true) ?? Vector3.Up();
    const point = wall.pickedPoint!.clone();
    const meta = wall.pickedMesh!.metadata as { surface: string; impact?: SurfaceImpact };
    const surface: SurfaceImpact = !wetDeck ? 'alloy' : meta.surface === 'floor' && arenaDeckWetness(point.x, point.z) > 0.48 ? 'wetDeck' : meta.impact ?? 'alloy';
    return { point, normal: n, target: 'surface', surface, enemyId: null };
  }
  return { point: r.origin.add(r.dir.scale(r.range)), normal: null, target: 'none', enemyId: null };
}
