import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Scene } from '@babylonjs/core/scene';
import { sfx } from '../audio/Sfx';
import { rollDamage } from '@riftwarden/rules/combat/damage';
import { elementPayload, procWeight } from '@riftwarden/rules/combat/elements';
import type { Director } from '../combat/Director';
import type { CombatStats } from '@riftwarden/rules/combat/stats';
import { isBurning, isChilled, isFrozen, speedFactor } from '@riftwarden/rules/combat/status';
import type { ShotOutcome, ShotRequest, SurfaceImpact, Weapon, WeaponFxHooks } from '../combat/Weapon';
import type { WeaponDef, WeaponFamily } from '@riftwarden/rules/data/defs';
import type { Enemy, EnemyManager } from '../enemies/EnemyManager';
import type { Turret } from '../defense/Turrets';
import type { BurstKind, Effects } from '../fx/Effects';
import type { ExplosionStyle } from '../fx/explosionStyles';
import { trackSeeker, type WeaponFx } from '../fx/WeaponFx';
import { MOVE, type Player } from '../player/Player';
import { hasLost, LIMB_IDS } from '@riftwarden/rules/enemies/limbs';
import { UP } from '@riftwarden/rules/roguelite/upgrades';
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
  /** Equipped unique gear effects of the drone firing right now (loot/uniques.ts `gear` ids). */
  uniques(): ReadonlySet<string>;
  /** Add a fraction (0..1) of a full ultimate charge to the drone firing right now. */
  chargeUlt(fraction: number): void;
  hitstop(seconds: number, scale: number): void;
  /** A weapon kill by the drone firing right now (weapon-family mastery XP). */
  masteryKill(e: Enemy): void;
  /** Re-enter the (overridable) damage entry, used by Arc Conductor jumps. */
  damageEnemy(source: 'player' | 'turret', e: Enemy, base: number, point: Vector3, weak: boolean, turret?: Turret, family?: WeaponFamily | 'arc', from?: Vector3): void;
}

const KILL_AT = new Vector3();
const TMP_C = new Vector3();

/** Particle burst that draws a flamer stream per element (a cryo flamer is a frost spray). */
const FLAME_KIND: Partial<Record<WeaponDef['element'], BurstKind>> = { thermal: 'fire', cryo: 'frost', corrosive: 'oil', electric: 'zap', void: 'plasma', kinetic: 'puff' };

/** Explosion look of a rocket per element. */
function explosionStyleFor(element: WeaponDef['element']): ExplosionStyle {
  return element === 'cryo' ? 'cryo' : element === 'electric' ? 'electric' : element === 'void' ? 'plasma' : element === 'thermal' ? 'heavy' : 'fire';
}
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
  private uHits = 0;

  constructor(private h: CombatHost) {}

  /** Resolve a shot from the camera ray and apply its damage immediately (`fxHooks` only visualise it). */
  shoot(r: ShotRequest): ShotOutcome {
    const h = this.h;
    h.director.bus.emit({ type: 'fire', chain: h.director.bus.newChain(), source: { kind: 'weapon', id: r.family }, value: 1 });
    const { struck, wall } = traceShot(h.scene, h.enemies.active, r);
    // Read the outcome before damage lands (a shot that breaks a shield still shows the shield impact).
    const out = shotOutcome(r, struck, wall);
    if (r.family === 'flamer') {
      // The stream reaches every machine in its cone for the full tick (no falloff, never a weakpoint).
      for (const s of struck) h.damageEnemy('player', s.enemy, r.damage, s.point, false, undefined, 'flamer');
      return out;
    }
    if (r.family === 'launcher') {
      const hit = struck[0];
      const at = hit?.point ?? wall?.pickedPoint ?? null;
      if (at) this.launch(at, hit?.enemy ?? null, hit?.weak ?? false, r.damage, h.weapon.muzzleWorld(), h.weapon.def);
      return out;
    }
    let dmg = r.damage;
    for (const s of struck) {
      if (s.assisted) {
        h.damageEnemy('player', s.enemy, dmg, s.point, false, undefined, 'beam');
        break;
      }
      h.damageEnemy('player', s.enemy, dmg, s.point, s.weak, undefined, r.family);
      if (h.weapon.def.mechanism === 'pulse') this.pulseSplash(s.point, dmg, s.enemy);
      // Ninth Gate: pierced machines strengthen the slug instead of weakening it.
      dmg *= h.signature() === 'u_ninthgate' ? 1.2 : 0.85;
    }
    return out;
  }

  /**
   * Launcher: the rocket flies to `at` at the weapon's rocket speed and detonates there (damage lands on arrival).
   * Blast radius, cluster payload and element are taken from `def` at launch. `wrap` runs the detonation in the
   * shooter's context (the co-op server swaps avatars); it may drop it (the shooter left).
   */
  launch(at: Vector3, direct: Enemy | null, weak: boolean, dmg: number, from: Vector3, def: WeaponDef, wrap: (fn: () => void) => void = (fn) => fn()): void {
    const eta = Math.min(2.5, Vector3.Distance(from, at) / Math.max(10, def.boltSpeed));
    const gen = direct?.gen;
    const o = { splash: Math.max(0.5, def.splash), cluster: def.mechanism === 'cluster', element: def.element };
    const point = at.clone();
    this.h.director.later(eta, () => wrap(() => this.detonate(point, direct && direct.alive && direct.gen === gen ? direct : null, weak, dmg, o)));
  }

  /** Rocket impact: full damage to a direct hit, a falloff blast around it, cluster bomblets; splash kills count for mastery. */
  detonate(point: Vector3, direct: Enemy | null, weak: boolean, dmg: number, o: { splash: number; cluster: boolean; element: WeaponDef['element'] }): void {
    const h = this.h;
    const d = h.director;
    const near = h.enemies.active.filter((e) => e.alive && e !== direct && Vector3.Distance(e.center(TMP_C), point) <= o.splash * 1.6 + e.def.bodyR);
    if (direct?.alive) h.damageEnemy('player', direct, dmg, point, weak, undefined, 'launcher');
    const src = { kind: 'weapon' as const, id: 'launcher' };
    const apply = elementPayload(o.element, dmg * 0.6, this.procWeight(), Math.random());
    d.blast(point, o.splash, dmg * 0.75, o.element, src, d.bus.newChain(), { falloff: 0.55, exclude: direct, family: 'splash', apply });
    if (o.cluster) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random();
        const q = point.add(new Vector3(Math.cos(a) * o.splash * 0.65, 0, Math.sin(a) * o.splash * 0.65));
        d.later(0.12 + i * 0.07, () => d.blast(q, o.splash * 0.5, dmg * 0.3, o.element, src, d.bus.newChain(), { falloff: 0.4, family: 'splash' }));
      }
    }
    for (const e of near) if (!e.alive) h.masteryKill(e);
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
      if (family === 'launcher') {
        const def = weapon.def;
        this.rocketFx(from, out, speed, { splash: def.splash, cluster: def.mechanism === 'cluster', element: def.element, color: weapon.rig.energyBase });
        return;
      }
      if (family === 'flamer') {
        this.flameFx(from, out.point, weapon.def.element);
        return;
      }
      if (family === 'swarm') {
        const enemy = out.enemyId === null ? undefined : this.h.enemies.active.find((e) => e.id === out.enemyId);
        wfx.seeker(from, out.point, speed, out.target === 'none' ? null : (point) => this.impactFx(family, { ...out, point }, power), trackSeeker(enemy, out.point));
      } else if (family === 'plasma') {
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

  /** Rocket: a glowing projectile with a smoke trail; the explosion (and cluster bomblets) on arrival. */
  rocketFx(from: Vector3, out: ShotOutcome, speed: number, o: { splash: number; cluster: boolean; element: WeaponDef['element']; color: Color3 }): void {
    rocketFx(this.h.wfx, this.h.fx, from, out, speed, o);
  }

  /** Flamer tick: puffs of the element along the stream toward its end. */
  flameFx(from: Vector3, to: Vector3, element: WeaponDef['element']): void {
    flameFx(this.h.fx, from, to, element);
  }

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
      else if (family === 'swarm') {
        // Seeker detonation: a small energy pop on the hull.
        fx.burst('sparks', p, 6, undefined, 0.55);
        fx.burst('flash', p, 1, undefined, 0.22);
      }
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
      if (family !== 'arc') base *= uniqueHitMult(sig, h.uniques(), { weak: weakpoint, chilled: isChilled(e.status, 1), heat: h.heat(), dist: Vector3.Distance(h.player.eye, e.pos) });
    }
    const wasFrozen = isFrozen(e.status);
    const roll = rollDamage(base, crit, weakpoint, Math.random, 'energy', source);
    const partsBefore = e.limbsLost;
    // Arc Conductor: a player hit may jump to the nearest other enemy (no chains of arcs).
    if (player && family !== 'arc' && stats.arcChance > 0 && Math.random() < stats.arcChance) this.arcFrom(e, point, roll.amount * stats.arcDamage);
    const src = family === 'arc' ? { kind: 'effect' as const, id: 'arc_conductor' } : player ? { kind: 'weapon' as const, id: family ?? 'plasma' } : { kind: 'tower' as const, id: 'sentinel', towerId: turret?.id };
    // The weapon's element: its hits carry the element's status (weighted by hits per second).
    const element = family === 'arc' ? 'none' : player ? h.weapon.def.element : 'kinetic';
    const apply = player && family !== 'arc' ? elementPayload(element, roll.amount, this.procWeight(), Math.random()) : undefined;
    const res = h.director.deal({ target: e, amount: roll.amount, base, crit: roll.crit, weak: weakpoint, element, apply, source: src, chain: h.director.bus.newChain(), point, family: family ?? (player ? 'plasma' : 'tower'), from: from ?? (player ? h.player.eye : undefined) });
    if (!player) return;
    if (e.limbsLost !== partsBefore) {
      const lost = LIMB_IDS.find((l) => hasLost(e.limbsLost, l) && !hasLost(partsBefore, l));
      if (lost) uiEvents.emit('limb', lost);
    }
    if (family !== 'arc') {
      this.signatureAfterHit(e, point, roll.amount, roll.crit, res);
      this.uniqueAfterHit(e, point, roll.amount, roll.crit, weakpoint, wasFrozen, res);
    }
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
    this.h.masteryKill(e);
    const p = this.h.player;
    p.refundDash(MOVE.killDashRefund * (heavy ? 2 : 1));
    p.chain = this.h.runTime - p.chainAt <= KILL_CHAIN_WINDOW ? p.chain + 1 : 1;
    p.chainAt = this.h.runTime;
    if (p.chain >= 2) uiEvents.emit('chain', p.chain);
    if (heavy) p.addTrauma(0.2);
    // Unique gear: kill rewards.
    const gear = this.h.uniques();
    if (gear.has('u_mantle')) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.04);
    if (gear.has('u_tailwind')) p.refundDash(0.5);
    // Kill flash: a white star and a short light where the machine dies.
    const c = e.center(KILL_AT);
    this.h.fx.burst('flash', c, 1, undefined, heavy ? 0.7 : 0.45);
    this.h.fx.flashLight(c, heavy ? 5 : 2.8, 0.07, KILL_LIGHT);
  }

  /** Status weight per hit of the weapon in hand (hits per second incl. pellets). */
  procWeight(): number {
    const d = this.h.weapon.def;
    const pellets = Math.max(1, Math.floor(this.h.stats.projectiles || 1));
    return procWeight(d.fireRate * this.h.stats.fireRateMult * pellets);
  }

  /** Pulse Capacitor: every pulse detonates (60% damage in PULSE_SPLASH m). */
  pulseSplash(point: Vector3, dmg: number, hit: Enemy | null): void {
    const d = this.h.director;
    d.blast(point, PULSE_SPLASH, dmg * 0.6, this.h.weapon.def.element, { kind: 'weapon', id: 'beam' }, d.bus.newChain(), { falloff: 0.4, exclude: hit, family: 'splash' });
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

  /** Unique mechanics that react to a landed weapon hit (weapon signatures + equipped gear). */
  private uniqueAfterHit(e: Enemy, point: Vector3, amount: number, crit: boolean, weak: boolean, wasFrozen: boolean, res: { dealt: number; killed: boolean }): void {
    const { director: d, player } = this.h;
    const sig = this.h.signature();
    const gear = this.h.uniques();
    if (gear.has('u_lattice') && crit) this.h.chargeUlt(0.015);
    if (gear.has('u_frostaegis') && res.dealt > 0 && isChilled(e.status, 1) && player.maxShield > 0) player.shield = Math.min(player.maxShield, player.shield + player.maxShield * 0.01);
    if (!sig?.startsWith('u_')) return;
    const src = { kind: 'effect' as const, id: `sig:${sig}` };
    if (sig === 'u_heartbreaker' && weak && e.alive) {
      for (let i = 0; i < 2; i++) d.inflict(e, { corrode: amount * 0.08 }, src, d.bus.newChain(), point);
    } else if (sig === 'u_prismgaze' && ++this.uHits % 8 === 0) {
      d.chainLightning({ from: point, first: null, skip: [e], count: 3, amount: amount * 1.2, falloff: 0.85, source: src, chain: d.bus.newChain(), shock: false });
    } else if (sig === 'u_choir' && isBurning(e.status)) {
      for (const o of d.enemiesNear(point, 3.5)) if (o !== e) d.inflict(o, { burn: Math.max(1, amount * 0.15) }, src, d.bus.newChain(), o.center(new Vector3()));
      this.h.fx.ring(point, 3.5, 0.25, new Color3(3, 1.1, 0.2), false);
    } else if (sig === 'u_juryrig' && this.h.heat() > 0.5 && Math.random() < 0.25) {
      d.chainLightning({ from: point, first: null, skip: [e], count: 2, amount: amount * 0.6, falloff: 0.8, source: src, chain: d.bus.newChain() });
    } else if (sig === 'u_rimebreath' && res.killed && wasFrozen) {
      d.blast(point, 4, amount * 0.8, 'cryo', src, d.bus.newChain(), { falloff: 0.35, exclude: e, apply: { chill: 40 } });
      d.explosionFx(point, 4, 'cryo');
    } else if (sig === 'u_hivemother' && res.killed) {
      const near = d.enemiesNear(point, 14).filter((o) => o !== e).sort((a, b) => Vector3.DistanceSquared(a.pos, point) - Vector3.DistanceSquared(b.pos, point)).slice(0, 2);
      for (const o of near) {
        const c = o.center(new Vector3());
        this.h.wfx.seeker(point, c, 34, null, trackSeeker(o, c));
        d.deal({ target: o, amount: amount * 0.5, base: amount * 0.5, element: this.h.weapon.def.element, source: src, chain: d.bus.newChain(), point: c, from: point.clone() });
      }
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

/**
 * Damage multiplier of unique mechanics on one weapon hit (pure): Heartbreaker weakpoints, Rime Warden's Breath on
 * chilled targets, Colossus Reactor Heart above 60% heat, Marksman's Monocle beyond 30 m.
 */
export function uniqueHitMult(sig: string | null, gear: ReadonlySet<string>, c: { weak: boolean; chilled: boolean; heat: number; dist: number }): number {
  let k = 1;
  if (sig === 'u_heartbreaker' && c.weak) k *= 1.7;
  if (sig === 'u_rimebreath' && c.chilled) k *= 1.4;
  if (gear.has('u_reactorheart') && c.heat > 0.6) k *= 1.3;
  if (gear.has('u_monocle') && c.dist > 30) k *= 1.35;
  return k;
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

/** Rocket visual: projectile + smoke puffs released along the path; explosion (and cluster bomblets) on arrival. */
export function rocketFx(wfx: WeaponFx, fx: Effects, from: Vector3, out: ShotOutcome, speed: number, o: { splash: number; cluster: boolean; element: WeaponDef['element']; color: Color3 }): void {
  const to = out.point.clone();
  const dist = Vector3.Distance(from, to);
  const splash = Math.max(0.5, o.splash);
  const style = explosionStyleFor(o.element);
  const color = o.color.clone();
  const v = Math.max(10, speed);
  wfx.bolt(from, to, v, 0.55, out.target !== 'none' ? () => {
    fx.explode(to, { scale: 0.45 + splash * 0.16, debris: 2, color, style });
    fx.ring(to, splash, 0.3, color.scale(0.6), true);
    if (o.cluster) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random();
        const q = to.add(new Vector3(Math.cos(a) * splash * 0.65, 0, Math.sin(a) * splash * 0.65));
        wfx.later(0.12 + i * 0.07, () => fx.explode(q, { scale: 0.3 + splash * 0.06, debris: 1, color, style }));
      }
    }
  } : null);
  const steps = Math.min(14, Math.floor(dist / 3));
  for (let i = 1; i <= steps; i++) {
    const f = i / (steps + 1);
    const p = Vector3.Lerp(from, to, f);
    wfx.later((dist * f) / v, () => fx.burst('smoke', p, 2, undefined, 0.45));
  }
}

/** Flamer tick visual: puffs of the element (fire, frost, acid, sparks...) along the stream toward its end. */
export function flameFx(fx: Effects, from: Vector3, to: Vector3, element: WeaponDef['element']): void {
  const dir = to.subtract(from);
  const len = dir.length();
  if (len < 0.2) return;
  dir.scaleInPlace(1 / len);
  const kind = FLAME_KIND[element] ?? 'fire';
  for (const f of [0.18, 0.45, 0.75, 1]) fx.burst(kind, from.add(dir.scale(len * f)), f === 1 ? 2 : 3, dir, 0.45 + f * 0.9);
  if (Math.random() < 0.35) fx.burst(kind === 'fire' ? 'embers' : 'mist', to, 2, undefined, 0.8);
}
