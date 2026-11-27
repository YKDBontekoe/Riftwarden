import '../babylonSideEffects';
import { Ray } from '@babylonjs/core/Culling/ray.core';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
import { type PhysicsEngine as PhysicsEngineV2 } from '@babylonjs/core/Physics/v2/physicsEngine';
import { type Scene } from '@babylonjs/core/scene';
import {
  ABILITIES,
  type AbilityDef,
  type AbilityHudRow,
  type AbilitySlot,
  abilityCooldown,
  abilityPower,
  abilityRadius,
  AEGIS,
  blinkDistance,
  ORBITAL_DELAY,
  OVERDRIVE,
  THROW,
  throwStep,
  ultChargeNeeded,
  ultGain,
} from '@riftwarden/rules/abilities/defs';
import { sfx } from '../audio/Sfx';
import type { Director } from '../combat/Director';
import type { CombatStats } from '@riftwarden/rules/combat/stats';
import type { Deployables } from './Deployables';
import type { Weapon } from '../combat/Weapon';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { Effects } from '../fx/Effects';
import type { WeaponFx } from '../fx/WeaponFx';
import { baseDef } from '@riftwarden/rules/loot/bases';
import type { RunInventory } from '@riftwarden/rules/loot/runInventory';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import type { Player } from '../player/Player';
import { uiEvents } from '../ui/store';
import { ENV_QUERY } from '../world/physicsGroups';
import { metadataPicker } from '../world/pickCandidates';

/** What abilities need from the arena (no Game import). */
export interface AbilityHost {
  readonly scene: Scene;
  readonly player: Player;
  readonly director: Director;
  readonly enemies: EnemyManager;
  readonly fx: Effects;
  readonly wfx: WeaponFx;
  readonly weapon: Weapon;
  readonly inventory: RunInventory;
  readonly stats: CombatStats;
  /** Co-op server: the avatar id, so Aegis / Overdrive buff only their owner (null = single player). */
  readonly owner?: string;
  /** Shield wall / decoy / mini-sentry placement (shared world objects). */
  readonly deployables: Deployables;
  /** Abilities work only while the drone is in play (not in build mode, menus, defeat). */
  canAct(): boolean;
}


interface Charge {
  def: AbilityDef;
  pos: Vector3;
  vel: Vector3;
  fuse: number;
  power: number;
  radius: number;
}

interface Strike {
  at: Vector3;
  t: number;
  power: number;
  radius: number;
  pulse: number;
}

const FWD = new Vector3();
const TO = new Vector3();
const PREV = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Ability slots in the arena: two cooldown abilities and an ultimate charged by damage dealt (Director.deal calls
 * `charge`). Thrown charges fly ballistically and burst on level geometry, enemies or their fuse; blink moves the
 * drone's controller; aegis / overdrive are timed director buffs; the orbital lance marks the aim point and strikes
 * after a delay. Damage goes through the director pipeline (source kind 'effect', id 'ability:<kind>').
 */
export class Abilities {
  /** Seconds until each cooldown slot is ready. */
  readonly cd: Record<'ability' | 'ability2', number> = { ability: 0, ability2: 0 };
  /** Ultimate charge 0..1. */
  ult = 0;
  overdriveT = 0;
  aegisT = 0;
  /** Uses this run (automation/tests). */
  used = 0;
  private charges: Charge[] = [];
  private strikes: Strike[] = [];
  private nextDeniedAt = 0;
  private ray = new PhysicsRaycastResult();
  private pickRay = new Ray(Vector3.Zero(), Vector3.Forward(), 140);

  constructor(private h: AbilityHost) {}

  item(slot: AbilitySlot): ItemInstance | null {
    return this.h.inventory.equipped(slot);
  }

  def(slot: AbilitySlot): AbilityDef | null {
    const it = this.item(slot);
    const k = it ? baseDef(it.defId)?.ability : undefined;
    const d = k ? ABILITIES[k] : null;
    return d && d.category === (slot === 'ultimate' ? 'ultimate' : 'ability') ? d : null;
  }

  reset(): void {
    this.cd.ability = 0;
    this.cd.ability2 = 0;
    this.ult = 0;
    this.overdriveT = 0;
    this.aegisT = 0;
    this.charges.length = 0;
    this.strikes.length = 0;
  }

  /** Damage dealt by the drone (weapon, its effects, abilities) charges the ultimate. */
  charge(damage: number): void {
    if (this.ult >= 1 || this.overdriveT > 0) return;
    const d = this.def('ultimate');
    const item = this.item('ultimate');
    if (!d || !item) return;
    const before = this.ult;
    this.ult = Math.min(1, this.ult + ultGain(damage, ultChargeNeeded(d, item), this.h.stats));
    if (before < 1 && this.ult >= 1) {
      sfx.play('abilityReady', { pitch: 0.8 });
      uiEvents.emit('notice', { text: `${d.name.toUpperCase()} READY`, tone: 'blue' });
    }
  }

  /** Why a slot cannot be used right now (null = ready). */
  blocked(slot: AbilitySlot): string | null {
    if (!this.def(slot)) return 'No ability equipped in that slot';
    if (!this.h.canAct()) return 'Not available right now';
    if (slot === 'ultimate') return this.ult >= 1 ? null : 'Ultimate is still charging';
    return this.cd[slot] > 0 ? 'Still on cooldown' : null;
  }

  reportBlocked(slot: AbilitySlot, why: string): void {
    if (why === 'Not available right now' || !this.h.canAct()) return;
    const now = performance.now();
    if (now < this.nextDeniedAt) return;
    this.nextDeniedAt = now + 650;
    const name = this.def(slot)?.name ?? (slot === 'ultimate' ? 'Ultimate' : slot === 'ability2' ? 'Ability II' : 'Ability I');
    const state = why === 'No ability equipped in that slot' ? 'empty slot' : slot === 'ultimate' ? `${Math.floor(this.ult * 100)}% charged` : `${Math.ceil(this.cd[slot] * 10) / 10}s remaining`;
    sfx.play('abilityDenied');
    uiEvents.emit('notice', { text: `${name} · ${state}`, tone: 'orange' });
  }

  /** Use a slot from the drone's eye along its aim. */
  use(slot: AbilitySlot, origin?: Vector3, dir?: Vector3): boolean {
    const why = this.blocked(slot);
    const d = this.def(slot);
    const item = this.item(slot);
    if (why || !d || !item) {
      if (why) this.reportBlocked(slot, why);
      return false;
    }
    const st = this.h.stats;
    const eye = (origin ?? this.h.player.eye).clone();
    const aim = (dir ?? this.h.player.forward(FWD)).clone().normalize();
    const power = abilityPower(d, item, st);
    const radius = abilityRadius(d, st);
    switch (d.kind) {
      case 'frag':
      case 'cryo':
        this.throwCharge(d, eye, aim, power, radius);
        break;
      case 'emp':
        this.pulse(d, power, radius);
        break;
      case 'blink':
        this.blink(aim, power);
        break;
      case 'aegis':
        this.aegis(power);
        break;
      case 'wall':
      case 'decoy':
      case 'sentry':
        this.h.deployables.deploy(d.kind, eye, aim, power, radius, this.h.player.yaw);
        break;
      case 'orbital':
        this.mark(eye, aim, power, radius);
        break;
      case 'overdrive':
        this.overdrive(power);
        break;
    }
    if (slot === 'ultimate') this.ult = 0;
    else this.cd[slot] = abilityCooldown(d, st);
    this.used++;
    return true;
  }

  /** Co-op replica: the server ran the ability; mirror its cooldown / timers locally (HUD, overdrive heat). */
  mirrorUse(slot: AbilitySlot): void {
    const d = this.def(slot);
    const item = this.item(slot);
    if (!d || !item) return;
    if (slot === 'ultimate') this.ult = 0;
    else this.cd[slot] = abilityCooldown(d, this.h.stats);
    if (d.kind === 'aegis') this.aegisT = AEGIS.seconds;
    if (d.kind === 'overdrive') this.overdriveT = abilityPower(d, item, this.h.stats);
    this.used++;
  }

  update(dt: number, localAudio = true): void {
    for (const slot of ['ability', 'ability2'] as const) {
      const previous = this.cd[slot];
      this.cd[slot] = Math.max(0, previous - dt);
      if (localAudio && previous > 0 && this.cd[slot] === 0 && this.h.player.alive && this.def(slot)) {
        sfx.play('abilityReady', { pitch: slot === 'ability2' ? 1.15 : 1, volume: 0.65 });
      }
    }
    if (this.aegisT > 0) this.aegisT = Math.max(0, this.aegisT - dt);
    if (this.overdriveT > 0) {
      this.overdriveT = Math.max(0, this.overdriveT - dt);
      // No weapon heat while overdriven.
      this.h.weapon.heat = 0;
      this.h.weapon.overheated = false;
    }
    this.updateCharges(dt);
    this.updateStrikes(dt);
  }

  hud(): AbilityHudRow[] {
    const out: AbilityHudRow[] = [];
    for (const slot of ['ability', 'ability2'] as const) {
      const d = this.def(slot);
      if (!d) continue;
      const max = abilityCooldown(d, this.h.stats);
      out.push({ slot, name: d.name, kind: d.kind, cd: this.cd[slot], max, ready: this.cd[slot] <= 0, active: d.kind === 'aegis' ? this.aegisT : 0 });
    }
    const u = this.def('ultimate');
    if (u) out.push({ slot: 'ultimate', name: u.name, kind: u.kind, cd: this.ult, max: 1, ready: this.ult >= 1, active: this.overdriveT });
    return out;
  }

  // ---------------------------------------------------------------- abilities

  private throwCharge(d: AbilityDef, eye: Vector3, aim: Vector3, power: number, radius: number): void {
    const pos = eye.add(aim.scale(0.7));
    const vel = aim.scale(THROW.speed).addInPlace(UP.scale(THROW.lift));
    this.charges.push({ def: d, pos, vel, fuse: THROW.fuse, power, radius });
    // The visual rides in the replicated fx stream so co-op clients see the charge fly.
    this.h.fx.thrown(pos, vel, THROW.fuse + 0.2, d.kind === 'cryo');
    sfx.play('dash', { pitch: 1.6, volume: 0.5 });
  }

  private updateCharges(dt: number): void {
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i];
      PREV.copyFrom(c.pos);
      throwStep(c.pos, c.vel, dt);
      c.fuse -= dt;
      let burst = c.fuse <= 0;
      const hit = this.cast(PREV, c.pos);
      if (hit) {
        c.pos.copyFrom(hit);
        burst = true;
      }
      if (!burst) for (const e of this.h.enemies.active) if (e.alive && !e.hidden && Vector3.DistanceSquared(e.center(TO), c.pos) < (e.def.bodyR * e.def.scale + 0.4) ** 2) burst = true;
      if (burst) {
        this.h.fx.thrownEnd(c.pos);
        this.detonate(c);
        this.charges.splice(i, 1);
      }
    }
  }

  private detonate(c: Charge): void {
    const { director: dir, fx } = this.h;
    const src = { kind: 'effect' as const, id: `ability:${c.def.kind}` };
    if (c.def.kind === 'cryo') {
      dir.blast(c.pos, c.radius, c.power, 'cryo', src, dir.bus.newChain(), { falloff: 0.2, apply: { chill: 85 * this.h.stats.abilityPowerMult } });
      fx.explode(c.pos, { scale: c.radius / 4.5, style: 'cryo', debris: 2 });
    } else {
      dir.blast(c.pos, c.radius, c.power, 'thermal', src, dir.bus.newChain(), { falloff: 0.35, apply: { burn: c.power * 0.06 } });
      fx.explode(c.pos, { scale: c.radius / 4, debris: 6 });
    }
    fx.ring(c.pos.add(new Vector3(0, 0.15, 0)), c.radius, 0.35, c.def.kind === 'cryo' ? new Color3(0.6, 1.6, 2.6) : new Color3(2.6, 1.2, 0.35), true);
  }

  private pulse(d: AbilityDef, power: number, radius: number): void {
    const { director: dir, fx, player } = this.h;
    const at = player.position.add(new Vector3(0, 0.9, 0));
    const src = { kind: 'effect' as const, id: `ability:${d.kind}` };
    const chain = dir.bus.newChain();
    // Triple damage to shields: a shielded target takes two more shares that its shield soaks first.
    for (const e of dir.enemiesNear(at, radius)) if (e.shield > 0) dir.deal({ target: e, amount: Math.min(e.shield, power * 2), base: power, element: 'electric', source: src, chain, point: e.center().clone(), noReact: true });
    dir.blast(at, radius, power, 'electric', src, chain, { falloff: 0.25, shock: true });
    fx.explode(at, { scale: radius / 6, style: 'electric', debris: 0, scorch: false });
    fx.ring(player.position.add(new Vector3(0, 0.2, 0)), radius, 0.3, new Color3(0.8, 1.6, 3.2), true);
    for (const e of dir.enemiesNear(at, radius).slice(0, 6)) this.h.wfx.arc(at, e.center(new Vector3()));
    sfx.play('arc', { volume: 1, pitch: 0.8 });
  }

  private blink(aim: Vector3, dist: number): void {
    const p = this.h.player;
    const from = p.position.clone();
    const flat = new Vector3(aim.x, Math.max(-0.35, aim.y), aim.z).normalize();
    const wall = this.castDistance(from.add(new Vector3(0, 0.6, 0)), flat, dist + 1);
    const d = blinkDistance(dist, wall);
    const to = from.add(flat.scale(d));
    to.y = Math.max(from.y - 0.5, to.y);
    this.h.fx.burst('zap', from.add(new Vector3(0, 0.8, 0)), 14);
    p.controller.setPosition(to);
    this.h.fx.burst('zap', to.add(new Vector3(0, 0.8, 0)), 18);
    this.h.fx.ring(to.add(new Vector3(0, 0.1, 0)), 1.6, 0.25, new Color3(0.6, 1.6, 3), true);
    p.punch(0.06, 0);
    sfx.play('dash', { pitch: 0.7 });
  }

  private aegis(power: number): void {
    this.aegisT = AEGIS.seconds;
    this.h.director.addBuff(`ability:aegis${this.h.owner ?? ''}`, 'Aegis', AEGIS.seconds, () => [
      { stat: 'shieldCapacity', op: 'add', value: power },
      { stat: 'damageResist', op: 'add', value: AEGIS.resist },
    ], 1, this.h.owner);
    const p = this.h.player;
    p.shield = p.maxShield;
    this.h.fx.ring(p.position.add(new Vector3(0, 0.2, 0)), 3, 0.4, new Color3(0.5, 1.4, 3), true);
    this.h.fx.burst('shield', p.eye.add(this.h.player.forward(FWD).scale(1.2)), 14);
    sfx.play('shieldHit', { pitch: 1.4 });
  }

  private overdrive(seconds: number): void {
    this.overdriveT = seconds;
    this.h.director.addBuff(`ult:overdrive${this.h.owner ?? ''}`, 'Overdrive', seconds, () => [
      { stat: 'fireRateMult', op: 'pct', value: OVERDRIVE.fireRate },
      { stat: 'moveSpeedMult', op: 'pct', value: OVERDRIVE.move },
    ], 1, this.h.owner);
    const p = this.h.player;
    this.h.fx.ring(p.position.add(new Vector3(0, 0.2, 0)), 5, 0.5, new Color3(3, 1.2, 0.4), true);
    uiEvents.emit('banner', { title: 'OVERDRIVE', sub: `${seconds.toFixed(1)} s · fire rate +60% · no heat`, tone: 'orange' });
    sfx.play('tacticalOn', { pitch: 1.3 });
  }

  private mark(eye: Vector3, aim: Vector3, power: number, radius: number): void {
    this.pickRay.origin.copyFrom(eye);
    this.pickRay.direction.copyFrom(aim);
    const hit = metadataPicker(this.h.scene).pickWithRay(this.pickRay, (m) => !!m.metadata?.surface && m.isEnabled());
    const at = hit?.pickedPoint ? hit.pickedPoint.clone() : eye.add(aim.scale(40));
    at.y = Math.max(0, at.y);
    this.strikes.push({ at, t: ORBITAL_DELAY, power, radius, pulse: 0 });
    this.h.fx.ring(at.add(new Vector3(0, 0.12, 0)), radius, ORBITAL_DELAY, new Color3(2.4, 0.6, 3.2), true);
    uiEvents.emit('alert', { text: 'ORBITAL LANCE · STRIKE INBOUND', tone: 'blue' });
    sfx.play('alarm', { volume: 0.6, pitch: 1.4 });
  }

  private updateStrikes(dt: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t -= dt;
      s.pulse -= dt;
      if (s.pulse <= 0 && s.t > 0) {
        s.pulse = 0.3;
        this.h.fx.ring(s.at.add(new Vector3(0, 0.12, 0)), s.radius * (0.4 + 0.6 * (1 - s.t / ORBITAL_DELAY)), 0.3, new Color3(2.6, 0.8, 3.4), true);
      }
      if (s.t > 0) continue;
      const { director: dir, fx } = this.h;
      dir.blast(s.at.add(new Vector3(0, 1, 0)), s.radius, s.power, 'none', { kind: 'effect', id: 'ability:orbital' }, dir.bus.newChain(), { falloff: 0.3 });
      this.h.wfx.rail(s.at.add(new Vector3(0, 60, 0)), s.at, 1);
      // Replicated beam core (the rail trail above is local presentation only).
      this.h.fx.tracer(s.at.add(new Vector3(0, 60, 0)), s.at, 0, 0.9, 0.35);
      fx.explode(s.at, { scale: s.radius / 3.2, style: 'heavy', debris: 10 });
      fx.flashLight(s.at.add(new Vector3(0, 3, 0)), 14, 0.5, new Color3(2.4, 1, 3));
      this.strikes.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- helpers

  /** First level hit on the segment a -> b (Havok, ignores the drone), or null. */
  private cast(a: Vector3, b: Vector3): Vector3 | null {
    const physics = this.h.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
    if (!physics) return b.y <= 0.05 ? new Vector3(b.x, 0.05, b.z) : null;
    physics.raycastToRef(a, b, this.ray, ENV_QUERY);
    return this.ray.hasHit ? this.ray.hitPointWorld.clone() : null;
  }

  private castDistance(from: Vector3, dir: Vector3, max: number): number | null {
    const hit = this.cast(from, from.add(dir.scale(max)));
    return hit ? Vector3.Distance(from, hit) : null;
  }

}
