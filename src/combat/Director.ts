import { Color3, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { Enemy } from '../enemies/EnemyManager';
import { RunBuild, UP, upgradeDef } from '../roguelite/upgrades';
import { MAX_TOWER_LEVEL, type TowerRunInput } from '../towers/components';
import type { Game } from '../core/Game';
import type { Turret } from '../defense/Turrets';
import type { DamageType } from './damage';
import { type ChainInfo, type Effect, EffectBus, type Element, type SourceKind, type SourceRef } from './events';
import type { GameEvent, HitEv } from './gameEvents';
import type { StatModifier } from './stats';
import { applyBurn, applyChill, applyShock, hasAnyStatus, isBurning, isChilled, isFrozen, type ReactionKind, resolveReactions, tickStatus, vulnerability } from './status';
import type { HitKind } from '../ui/store';

/** Chain lightning reach between jumps (m). */
export const JUMP_RANGE = 10;
/** Visual budgets per frame: logic is never skipped, only its presentation (documented rule). */
const HEAVY_FX_PER_FRAME = 3;
const ARCS_PER_FRAME = 28;
const NUMBERS_PER_FRAME = 16;

export interface StatusPayload {
  /** Burn damage per second per stack. */
  burn?: number;
  /** Chill meter added. */
  chill?: number;
  shock?: boolean;
}

export interface DamageReq {
  target: Enemy;
  /** Final damage (crit already applied). */
  amount: number;
  /** Damage before the crit multiplier. */
  base?: number;
  crit?: boolean;
  weak?: boolean;
  element: Element;
  source: SourceRef;
  chain: ChainInfo;
  point: Vector3;
  family?: string;
  /** Status effects applied by this hit (also trigger reactions as contact elements). */
  apply?: StatusPayload;
  /** Damage-over-time tick: no hit events, no reactions, no statuses. */
  dot?: boolean;
  noReact?: boolean;
  noStatus?: boolean;
  /** Suppress damage numbers. */
  quiet?: boolean;
}

export interface HitResult {
  dealt: number;
  killed: boolean;
  kind: HitKind;
}

interface Buff {
  id: string;
  name: string;
  t: number;
  dur: number;
  stacks: number;
  mods: (stacks: number) => StatModifier[];
  max: number;
}

const DMG_TYPE: Record<Element, DamageType> = { none: 'energy', electric: 'energy', thermal: 'explosive', cryo: 'kinetic' };
const COLOR: Record<Element, Color3> = { none: new Color3(1.4, 2, 2.4), electric: new Color3(0.6, 1.6, 4), thermal: new Color3(3.4, 1.2, 0.2), cryo: new Color3(1.6, 2.6, 3.2) };
const TMP = new Vector3();
const TMP2 = new Vector3();

/**
 * Per-run combat director. Owns the effect bus, run build (temporary upgrades), temporary buffs and the
 * shared damage pipeline for ALL sources (weapon, towers, statuses, effects, reactions):
 *   deal() -> vulnerability/elemental scaling -> EnemyManager.damage -> attribution -> reactions + statuses
 *          -> kill handling -> typed events on the bus.
 * Effects registered by upgrades react to those events (see `effectsFor`). Disposed with the Game, so
 * nothing can leak into another run.
 */
export class Director {
  readonly bus: EffectBus<GameEvent>;
  readonly build: RunBuild;
  buffs: Buff[] = [];
  networkCharge = 0;
  gridCharge = 0;
  /** Diagnostics. */
  damageBy: Record<SourceKind, number> = { weapon: 0, tower: 0, status: 0, effect: 0, reaction: 0 };
  dps: Record<SourceKind, number> = { weapon: 0, tower: 0, status: 0, effect: 0, reaction: 0 };
  reactions: Record<ReactionKind, number> = { thermalShock: 0, overload: 0, superconduct: 0 };
  statusApplied = { burn: 0, shock: 0, chill: 0, freeze: 0 };
  kills = 0;
  lightning = 0;
  explosions = 0;
  discharges = 0;
  private dpsT = 0;
  private dpsAcc: Record<SourceKind, number> = { weapon: 0, tower: 0, status: 0, effect: 0, reaction: 0 };
  private heavyFx = 0;
  private arcs = 0;
  private numbers = 0;
  private list: Enemy[] = [];

  constructor(private g: Game, seed: number) {
    this.bus = new EffectBus<GameEvent>(Math.random);
    this.bus.onError = (e) => console.error('effect error', e);
    this.build = new RunBuild(seed);
  }

  // ------------------------------------------------------------------ run state

  /** New run: nothing from a previous run may survive. */
  reset(seed: number): void {
    this.bus.reset();
    this.build.reset(seed);
    this.buffs = [];
    this.networkCharge = 0;
    this.gridCharge = 0;
    this.damageBy = { weapon: 0, tower: 0, status: 0, effect: 0, reaction: 0 };
    this.dps = { weapon: 0, tower: 0, status: 0, effect: 0, reaction: 0 };
    this.dpsAcc = { weapon: 0, tower: 0, status: 0, effect: 0, reaction: 0 };
    this.reactions = { thermalShock: 0, overload: 0, superconduct: 0 };
    this.statusApplied = { burn: 0, shock: 0, chill: 0, freeze: 0 };
    this.kills = this.lightning = this.explosions = this.discharges = 0;
    this.rebuildEffects();
  }

  /** Register effects for every owned upgrade from scratch (never duplicates). */
  rebuildEffects(): void {
    this.bus.unregisterOwner('upgrade:');
    for (const [id, n] of this.build.stacks) for (const e of effectsFor(this, id, n)) this.bus.register(e);
  }

  /** Take an upgrade: apply stats + effects immediately. */
  takeUpgrade(id: string): boolean {
    if (!this.build.take(id, this.g.waves.number)) return false;
    this.rebuildEffects();
    this.g.rebuildStats();
    return true;
  }

  buffModifiers(): StatModifier[] {
    const out: StatModifier[] = [];
    for (const b of this.buffs) out.push(...b.mods(b.stacks).map((m) => ({ ...m, source: `buff:${b.id}` })));
    return out;
  }

  addBuff(id: string, name: string, dur: number, mods: (stacks: number) => StatModifier[], max = 1): void {
    let b = this.buffs.find((x) => x.id === id);
    if (b) {
      b.stacks = Math.min(max, b.stacks + 1);
      b.t = dur;
    } else {
      b = { id, name, t: dur, dur, stacks: 1, mods, max };
      this.buffs.push(b);
    }
    this.g.rebuildStats();
  }

  /** Weapon damage per hit with current stats (scale for effects). */
  weaponBase(): number {
    return this.g.weapon.def.damage * this.g.stats.weaponDamageMult;
  }

  towerInput(t: Turret): TowerRunInput {
    const s = this.g.stats;
    const par = this.build.count('t_parallel');
    const inf = this.build.count('t_infuse');
    return {
      damageMult: s.turretDamageMult,
      fireRateMult: s.turretFireRateMult,
      rangeMult: s.turretRangeMult,
      extraTargets: par ? UP.parallel.extra(par) : 0,
      extraChain: par ? UP.parallel.extra(par) : 0,
      burnFrac: inf ? UP.infuse.burn(inf) : 0,
      empowered: t.empowerT > 0,
    };
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, hdt: number): void {
    this.heavyFx = 0;
    this.arcs = 0;
    this.numbers = 0;
    this.bus.tick(dt);
    // Statuses (hostile time): burn ticks etc.
    const act = this.g.enemies.active;
    if (act.length) {
      this.list.length = 0;
      for (const e of act) this.list.push(e);
      for (const e of this.list) {
        if (!e.alive || !hasAnyStatus(e.status) && e.status.disruptCd <= 0 && e.status.immuneT <= 0 && e.status.cd.thermalShock <= 0 && e.status.cd.overload <= 0 && e.status.cd.superconduct <= 0) continue;
        const gen = e.gen;
        tickStatus(e.status, hdt, {
          burn: (dmg, stacks) => {
            if (!e.alive || e.gen !== gen) return;
            this.deal({ target: e, amount: dmg, element: 'thermal', source: { kind: 'status', id: 'burn' }, chain: this.bus.newChain(), point: e.center(TMP), dot: true, quiet: true });
            if (e.alive && stacks > 0 && Math.random() < 0.25) this.g.fx.burst('embers', e.center(TMP), 1);
          },
          expire: (kind) => {
            if (e.alive) this.bus.emit({ type: 'status', chain: this.bus.newChain(), source: { kind: 'status', id: kind }, target: e, gen: e.gen, status: kind, op: 'expire' });
          },
        });
      }
    }
    this.g.enemies.updateMarks(performance.now() * 0.001);
    // Temporary buffs.
    let changed = false;
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      this.buffs[i].t -= dt;
      if (this.buffs[i].t <= 0) {
        this.buffs.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this.g.rebuildStats();
    this.bus.drain();
    // dps window
    this.dpsT += dt;
    if (this.dpsT >= 1) {
      for (const k of Object.keys(this.dpsAcc) as SourceKind[]) {
        this.dps[k] = this.dpsAcc[k] / this.dpsT;
        this.dpsAcc[k] = 0;
      }
      this.dpsT = 0;
    }
  }

  // ------------------------------------------------------------------ damage pipeline

  /** Apply one damage instance from any source. Never dropped; only trigger propagation is bounded. */
  deal(r: DamageReq): HitResult {
    const e = r.target;
    const none: HitResult = { dealt: 0, killed: false, kind: 'hit' };
    if (!e.alive || !(r.amount > 0) || !Number.isFinite(r.amount)) return none;
    const gen = e.gen;
    let amount = r.amount * vulnerability(e.status);
    if (r.element !== 'none') amount *= this.g.stats.elementalPower;
    // Snapshot the target's state before damage (reactions/kill events need it).
    const st = e.status;
    const burning = isBurning(st);
    const burnDps = st.burnDps;
    const burnStacks = st.burnStacks;
    const chilled = isChilled(st, 1);

    const res = this.g.enemies.damage(e, amount, DMG_TYPE[r.element], r.point, this.g.fx);
    if (!res) return none;
    const dealt = res.toHp + res.toShield;
    this.damageBy[r.source.kind] += dealt;
    this.dpsAcc[r.source.kind] += dealt;
    if (r.source.towerId !== undefined) {
      const t = this.g.turrets.byId(r.source.towerId);
      if (t) t.damageDealt += amount;
    }
    let kind: HitKind = res.toHp === 0 && res.toShield > 0 ? 'shield' : r.crit ? 'crit' : 'hit';

    const pt = { x: r.point.x, y: r.point.y, z: r.point.z };
    const mkHit = (type: 'hit' | 'crit' | 'kill', killed: boolean): HitEv => ({
      type, chain: r.chain, source: r.source, target: e, gen, amount, base: r.base ?? r.amount, element: r.element, crit: !!r.crit, weak: !!r.weak, point: pt, family: r.family ?? r.source.id, burning, burnDps, burnStacks, chilled, ...(killed ? {} : {}),
    });

    if (!res.killed && !r.dot) {
      if (!r.noReact || (!r.noStatus && r.apply)) this.contact(r, amount, e);
    }
    if (!r.dot) {
      this.bus.emit(mkHit('hit', false));
      if (r.crit) this.bus.emit(mkHit('crit', false));
    }
    if (res.killed) {
      kind = 'kill';
      this.kills++;
      if (r.source.towerId !== undefined) {
        const t = this.g.turrets.byId(r.source.towerId);
        if (t) t.kills++;
      }
      this.bus.emit(mkHit('kill', true));
      this.g.onEnemyKilled(e);
    }
    if (!r.quiet && !r.dot) this.g.showNumber(r.point, amount, kind, r.source.kind === 'weapon', this.numbers++ < NUMBERS_PER_FRAME);
    return { dealt, killed: res.killed, kind };
  }

  /** Reactions + statuses for a hit. Contact elements = hit element plus any status the hit applies. */
  private contact(r: DamageReq, amount: number, e: Enemy): void {
    const els = new Set<Element>();
    if (r.element !== 'none') els.add(r.element);
    if (r.apply?.burn) els.add('thermal');
    if (r.apply?.shock) els.add('electric');
    if (!r.noReact) for (const el of els) for (const rx of resolveReactions(e.status, el, amount)) this.runReaction(rx.kind, rx.damage, rx.radius, rx.element, rx.chainBonus, e, r);
    if (!r.noStatus && r.apply && e.alive) this.inflict(e, r.apply, r.source, r.chain, r.point);
  }

  /** Apply statuses (elemental power scales magnitude). Used by hits and by effects directly. */
  inflict(e: Enemy, p: StatusPayload, source: SourceRef, chain: ChainInfo, point: Vector3, react = true): void {
    if (!e.alive) return;
    const ep = this.g.stats.elementalPower;
    if (react && (p.burn || p.shock)) {
      const els: Element[] = [];
      if (p.burn) els.push('thermal');
      if (p.shock) els.push('electric');
      for (const el of els) for (const rx of resolveReactions(e.status, el, Math.max(p.burn ?? 0, 1) * (el === 'thermal' ? 4 : 8))) this.runReaction(rx.kind, rx.damage, rx.radius, rx.element, rx.chainBonus, e, { source, chain, point } as DamageReq);
      if (!e.alive) return;
    }
    const emit = (status: 'burn' | 'shock' | 'chill' | 'freeze') => {
      this.statusApplied[status]++;
      this.bus.emit({ type: 'status', chain, source, target: e, gen: e.gen, status, op: 'apply' });
    };
    if (p.burn && p.burn > 0) {
      const b = applyBurn(e.status, p.burn * ep);
      if (b.fresh) emit('burn');
      if (b.fresh && Math.random() < 0.6) this.g.fx.burst('embers', e.center(TMP), 3);
    }
    if (p.shock) {
      const s = applyShock(e.status);
      if (s.fresh) emit('shock');
      if (s.disrupted) this.g.fx.burst('zap', e.center(TMP), 4);
    }
    if (p.chill && p.chill > 0) {
      const c = applyChill(e.status, p.chill * ep);
      if (c === 'freeze') {
        emit('freeze');
        this.g.fx.burst('frost', e.center(TMP), 18, undefined, 1.3);
        this.g.fx.ring(e.center(TMP), 2.4, 0.3, COLOR.cryo, false);
        sfx.play('shieldHit', { pitch: 1.6, volume: 0.5 });
      } else if (c === 'chill' && !e.markKind) emit('chill');
    }
  }

  private runReaction(kind: ReactionKind, damage: number, radius: number, element: Element, chainBonus: number, e: Enemy, r: Pick<DamageReq, 'source' | 'chain' | 'point'>): void {
    this.reactions[kind]++;
    const center = e.center(new Vector3());
    const chain = { id: r.chain.id, depth: r.chain.depth + 1 };
    const src: SourceRef = { kind: 'reaction', id: kind, towerId: r.source.towerId };
    this.bus.emit({ type: 'reaction', chain, source: src, target: e, gen: e.gen, reaction: kind, point: { x: center.x, y: center.y, z: center.z }, damage });
    // Burst damage hits everything near (the target takes it in full). Reaction damage cannot trigger reactions again.
    this.blast(center, radius, damage, element, src, chain, { falloff: 0.5, noReact: true, noStatus: true, shock: kind === 'superconduct', include: e });
    if (kind === 'thermalShock') {
      this.g.fx.burst('frost', center, 30, undefined, 1.8);
      this.g.fx.burst('sparks', center, 14, undefined, 0.9);
      this.g.fx.ring(center, radius * 1.1, 0.4, new Color3(2.2, 2.8, 3.4), false);
      this.g.fx.flashLight(center, 4, 0.25, new Color3(0.8, 1.2, 1.4));
      sfx.play('shieldHit', { pitch: 0.55, volume: 0.9 });
    } else if (kind === 'overload') {
      this.explosionFx(center, radius, 'thermal');
    } else {
      this.g.fx.burst('zap', center, 24, undefined, 1.4);
      this.g.fx.ring(center, radius, 0.3, COLOR.electric, false);
      this.g.fx.flashLight(center, 4, 0.2, new Color3(0.4, 0.8, 1.6));
      sfx.play('arc', { volume: 0.9, pitch: 0.7 });
      if (chainBonus > 0 && e.alive) this.chainLightning({ from: center, first: null, skip: [e], count: chainBonus, amount: damage * 0.8, falloff: 0.8, source: src, chain });
    }
  }

  // ------------------------------------------------------------------ area / chain primitives

  /** Damage everything within `radius` of `center` (distance falloff). */
  blast(center: Vector3, radius: number, amount: number, element: Element, source: SourceRef, chain: ChainInfo, o: { falloff?: number; apply?: StatusPayload; noReact?: boolean; noStatus?: boolean; shock?: boolean; include?: Enemy | null; exclude?: Enemy | null; family?: string } = {}): number {
    let n = 0;
    const r2 = radius * radius;
    const fall = o.falloff ?? 0.4;
    this.list.length = 0;
    for (const e of this.g.enemies.active) this.list.push(e);
    const snap = [...this.list];
    for (const e of snap) {
      if (!e.alive || e === o.exclude) continue;
      const c = e.center(TMP2);
      const d2 = (c.x - center.x) ** 2 + (c.y - center.y) ** 2 + (c.z - center.z) ** 2;
      if (d2 > r2 && e !== o.include) continue;
      const f = e === o.include ? 1 : 1 - fall * Math.sqrt(d2 / r2);
      const apply: StatusPayload | undefined = o.apply || o.shock ? { ...o.apply, shock: o.shock || o.apply?.shock } : undefined;
      this.deal({ target: e, amount: amount * f, base: amount, element, source, chain, point: c.clone(), apply, noReact: o.noReact, noStatus: o.noStatus, quiet: n > 6, family: o.family });
      n++;
    }
    return n;
  }

  /**
   * Lightning: optionally hits `first` for the full amount, then jumps to the nearest unvisited enemy within
   * JUMP_RANGE, multiplying damage by `falloff` per jump. `count` = total enemies hit (including first).
   * All jumps share `chain`: depth only grows through effect -> effect causation.
   */
  chainLightning(o: { from: Vector3; first: Enemy | null; skip?: Enemy[]; count: number; amount: number; falloff: number; source: SourceRef; chain: ChainInfo; shock?: boolean; apply?: StatusPayload; crit?: boolean }): number {
    const visited: Enemy[] = [...(o.skip ?? [])];
    const pos = o.from.clone();
    let amt = o.amount;
    let hits = 0;
    const apply: StatusPayload = { ...o.apply, shock: o.shock ?? o.apply?.shock ?? true };
    for (let i = 0; i < o.count; i++) {
      let next: Enemy | null = null;
      if (i === 0 && o.first && o.first.alive) next = o.first;
      else {
        let best = JUMP_RANGE * JUMP_RANGE;
        for (const e of this.g.enemies.active) {
          if (!e.alive || visited.includes(e)) continue;
          const c = e.center(TMP);
          const d = (c.x - pos.x) ** 2 + (c.y - pos.y) ** 2 + (c.z - pos.z) ** 2;
          if (d < best) {
            best = d;
            next = e;
          }
        }
      }
      if (!next) break;
      const c = next.center(new Vector3());
      this.arcFx(pos, c);
      visited.push(next);
      this.lightning++;
      this.deal({ target: next, amount: amt, base: o.amount, element: 'electric', source: o.source, chain: o.chain, point: c, apply, crit: o.crit });
      hits++;
      pos.copyFrom(c);
      amt *= o.falloff;
    }
    return hits;
  }

  private arcFx(a: Vector3, b: Vector3): void {
    if (this.arcs++ >= ARCS_PER_FRAME) return;
    this.g.wfx.arc(a, b);
    this.g.fx.burst('zap', b, 5);
    if (this.arcs <= 3) sfx.play('arc', { volume: 0.55, pan: this.g.panFor(b).pan });
  }

  /** Presentation of a blast. Heavy particle explosions are budgeted per frame; light ones are not. */
  explosionFx(center: Vector3, radius: number, element: Element): void {
    this.explosions++;
    const heavy = this.heavyFx++ < HEAVY_FX_PER_FRAME;
    const fx = this.g.fx;
    if (element === 'thermal') {
      if (heavy) fx.explode(center, { scale: Math.min(1.6, radius / 4), color: new Color3(3, 0.9, 0.15), debris: 0, scorch: false });
      else {
        fx.burst('fire', center, 5, undefined, 0.8);
        fx.ring(center, radius * 1.3, 0.3, new Color3(3, 1.1, 0.2), false);
      }
    } else if (element === 'electric') {
      fx.burst('zap', center, heavy ? 26 : 8, undefined, 1.5);
      fx.ring(center, radius * 1.4, 0.3, COLOR.electric, false);
      if (heavy) fx.flashLight(center, 5, 0.25, new Color3(0.4, 0.8, 1.8));
    } else {
      fx.burst('frost', center, heavy ? 22 : 6, undefined, 1.4);
      fx.ring(center, radius * 1.3, 0.35, COLOR.cryo, false);
    }
    if (heavy) sfx.play('explosion', { volume: 0.6, pitch: element === 'thermal' ? 1 : 1.5, pan: this.g.panFor(center).pan });
  }

  // ------------------------------------------------------------------ towers

  /** Archetype attack of a tower (called when its cooldown allows or by synergy effects). */
  towerFire(t: Turret, target: Enemy | null, mult = 1): void {
    const st = t.st;
    const chain = this.bus.newChain();
    const src: SourceRef = { kind: 'tower', id: t.config.weapon, towerId: t.id };
    const muzzle = t.nextMuzzle();
    muzzle.computeWorldMatrix(true);
    const from = muzzle.getAbsolutePosition().clone();
    const crit = this.g.stats.critMultiplier;
    this.bus.emit({ type: 'towerAttack', chain, source: src, towerId: t.id, archetype: st.archetype, point: { x: from.x, y: from.y, z: from.z } });
    const a = this.g.panFor(from);

    if (st.archetype === 'cryo') {
      this.g.fx.ring(new Vector3(t.pos.x, t.pos.y + 0.1, t.pos.z), st.range * 0.55, 0.45, new Color3(1.2, 2, 2.6), true);
      if (t.empowered) this.g.fx.ring(new Vector3(t.pos.x, t.pos.y + 0.12, t.pos.z), st.range * 0.9, 0.5, new Color3(2.2, 3, 3.4), true);
      sfx.play('tacticalOn', { volume: a.volume * 0.25, pan: a.pan, pitch: 1.8 });
      const r2 = st.range * st.range;
      this.list.length = 0;
      for (const e of this.g.enemies.active) this.list.push(e);
      let shown = 0;
      for (const e of [...this.list]) {
        if (!e.alive) continue;
        const dx = e.pos.x - t.pos.x;
        const dz = e.pos.z - t.pos.z;
        if (dx * dx + dz * dz > r2) continue;
        const c = e.center(new Vector3());
        if (shown++ < 4) this.g.fx.burst('frost', c, 4);
        this.deal({ target: e, amount: st.damage * mult, element: 'cryo', source: src, chain, point: c, apply: { chill: st.chill * mult }, quiet: true, family: 'cryo' });
      }
      return;
    }
    if (!target || !target.alive) return;
    const to = target.center(new Vector3());
    if (st.archetype === 'arc') {
      const dmg = st.damage * mult;
      this.arcFx(from, to);
      sfx.play('arc', { volume: a.volume * 0.6, pan: a.pan, pitch: 1.1 });
      const apply: StatusPayload | undefined = st.burnFrac > 0 || st.chill > 0 ? { burn: st.burnFrac > 0 ? dmg * st.burnFrac : undefined, chill: st.chill > 0 ? st.chill : undefined } : undefined;
      const isCrit = Math.random() < st.critChance;
      this.chainLightning({ from, first: target, count: 1 + st.chain, amount: isCrit ? dmg * crit : dmg, falloff: st.chainFalloff, source: src, chain, shock: true, apply, crit: isCrit });
      return;
    }
    // ballistic: primary + extra targets
    const picks: Enemy[] = [target];
    const extra = st.targets + (mult > 1 ? 2 : 0);
    if (extra > 0) {
      const r2 = st.range * st.range;
      const cands: { e: Enemy; d: number }[] = [];
      for (const e of this.g.enemies.active) {
        if (!e.alive || e === target) continue;
        const dx = e.pos.x - t.pos.x;
        const dz = e.pos.z - t.pos.z;
        const d = dx * dx + dz * dz;
        if (d <= r2) cands.push({ e, d });
      }
      cands.sort((p, q) => p.d - q.d);
      for (const c of cands) {
        if (picks.length > extra) break;
        if (this.g.los(t.head, c.e.center(TMP))) picks.push(c.e);
      }
    }
    sfx.play('turretShot', { volume: a.volume * 0.7, pan: a.pan });
    this.g.fx.burst('impact', from, 3);
    const dmg = st.damage * mult;
    for (const e of picks) {
      if (!e.alive) continue;
      const p = e.center(new Vector3());
      p.y += (Math.random() - 0.5) * 0.4;
      this.g.fx.tracer(from, p, st.element === 'thermal' ? 2 : 1, 0.07, 0.08);
      this.g.fx.burst(st.element === 'thermal' ? 'enemySpark' : 'spark', p, 5);
      const isCrit = Math.random() < st.critChance;
      const amount = isCrit ? dmg * crit : dmg;
      const apply: StatusPayload | undefined = st.burnFrac > 0 || st.chill > 0 ? { burn: st.burnFrac > 0 ? dmg * st.burnFrac : undefined, chill: st.chill > 0 ? st.chill : undefined } : undefined;
      const res = this.deal({ target: e, amount, base: dmg, crit: isCrit, element: st.element, source: src, chain, point: p, apply, family: 'ballistic' });
      if (st.splash > 0) {
        this.blast(p, st.splash, amount * 0.5, st.element, src, chain, { falloff: 0.3, noReact: true, noStatus: true, exclude: e, family: 'splash' });
        this.g.fx.burst('fire', p, 3, undefined, 0.5);
        this.g.fx.ring(p, st.splash * 1.2, 0.2, new Color3(3, 1.5, 0.4), false);
      }
      void res;
    }
  }

  /** Empower towers within radius of a point (synergy). */
  empowerTowers(center: Vector3, radius: number, dur: number): number {
    let n = 0;
    for (const t of this.g.turrets.turrets) {
      if (t.building) continue;
      if (Vector3.DistanceSquared(t.pos, center) > radius * radius) continue;
      if (t.empowerT <= 0) this.g.fx.ring(new Vector3(t.pos.x, t.pos.y + 0.15, t.pos.z), 3.4, 0.5, COLOR.electric, true);
      t.empowerT = Math.max(t.empowerT, dur);
      n++;
    }
    return n;
  }

  /** Towers within radius, nearest first. */
  towersNear(center: Vector3, radius: number): Turret[] {
    return this.g.turrets.turrets.filter((t) => !t.building && Vector3.DistanceSquared(t.pos, center) <= radius * radius).sort((a, b) => Vector3.DistanceSquared(a.pos, center) - Vector3.DistanceSquared(b.pos, center));
  }

  // ------------------------------------------------------------------ misc

  /** Nearest living enemy to a point, excluding some. */
  nearest(p: Vector3, radius: number, skip: Enemy[] = []): Enemy | null {
    let best: Enemy | null = null;
    let bd = radius * radius;
    for (const e of this.g.enemies.active) {
      if (!e.alive || skip.includes(e)) continue;
      const c = e.center(TMP);
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2 + (c.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Diagnostics snapshot. */
  diag() {
    let statuses = 0;
    for (const e of this.g.enemies.active) if (hasAnyStatus(e.status)) statuses++;
    const b = this.bus.stats;
    return { pending: this.bus.size, effects: this.bus.effectCount, triggersPerSec: b.perSecond, triggered: b.triggered, dropped: b.dropped, depthBlocked: b.depthBlocked, chainBlocked: b.chainBlocked, errors: b.errors, statuses, dps: { ...this.dps } };
  }
}

// ======================================================================== upgrade effects

const live = (ev: HitEv): Enemy | null => (ev.target.alive && ev.target.gen === ev.gen ? ev.target : null);
const vec = (p: { x: number; y: number; z: number }) => new Vector3(p.x, p.y, p.z);
const fromWeapon = (ev: GameEvent) => ev.source.kind === 'weapon';

/** Effect definitions for upgrade `id` at `n` stacks. IDs are stable so re-registration replaces, never duplicates. */
export function effectsFor(d: Director, id: string, n: number): Effect<GameEvent>[] {
  const owner = `upgrade:${id}`;
  const g = d['g'] as Game;
  const eff = (e: Omit<Effect<GameEvent>, 'id' | 'owner'>, suffix = ''): Effect<GameEvent> => ({ id: `${owner}${suffix}`, owner, ...e });
  const src = (kind: 'effect' = 'effect', towerId?: number): SourceRef => ({ kind, id, towerId });
  const hit = (ev: GameEvent) => ev as HitEv;

  switch (id) {
    case 'e_static':
      return [eff({ on: 'hit', chance: UP.static.chance(n), cooldown: 0.05, filter: fromWeapon, run: (ev, api) => {
        const h = hit(ev);
        d.chainLightning({ from: vec(h.point), first: null, skip: [h.target], count: UP.static.jumps, amount: h.base * UP.static.dmg, falloff: 0.85, source: src(), chain: api.child(ev), shock: true });
      } })];
    case 'e_stormcrit':
      return [eff({ on: 'crit', cooldown: 0.08, filter: fromWeapon, run: (ev, api) => {
        const h = hit(ev);
        d.chainLightning({ from: vec(h.point), first: null, skip: [h.target], count: UP.stormCrit.jumps(n), amount: h.base * UP.stormCrit.dmg(n), falloff: 1, source: src(), chain: api.child(ev), shock: true });
      } })];
    case 'e_ignite':
      return [eff({ on: 'hit', chance: UP.ignite.chance(n), filter: fromWeapon, run: (ev, api) => {
        const h = hit(ev);
        const t = live(h);
        if (t) d.inflict(t, { burn: h.base * UP.ignite.dps(n) }, src(), api.child(ev), vec(h.point));
      } })];
    case 'e_cryo':
      return [eff({ on: 'hit', filter: fromWeapon, chainLimit: 2, run: (ev, api) => {
        const h = hit(ev);
        const t = live(h);
        if (t) d.inflict(t, { chill: UP.cryo.chill(n) }, src(), api.child(ev), vec(h.point));
      } })];
    case 'e_conductive':
      return [eff({ on: 'hit', chainLimit: 3, cooldown: 0.1, filter: (ev) => hit(ev).element === 'electric' && ev.source.id !== id, run: (ev, api) => {
        const h = hit(ev);
        const t = live(h);
        if (!t) return;
        const burning = isBurning(t.status);
        const chilled = isChilled(t.status, 5) && !isFrozen(t.status);
        if (!burning && !chilled) return;
        const dps = t.status.burnDps;
        const skip: Enemy[] = [t];
        for (let i = 0; i < UP.conductive.targets(n); i++) {
          const o = d.nearest(t.center(new Vector3()), UP.conductive.radius, skip);
          if (!o) break;
          skip.push(o);
          d.inflict(o, { burn: burning ? dps : undefined, chill: chilled ? UP.conductive.chill : undefined }, src(), api.child(ev), o.center(new Vector3()));
          g.wfx.arc(t.center(new Vector3()), o.center(new Vector3()));
        }
      } })];
    case 'e_ember':
      return [eff({ on: 'kill', chainLimit: 4, filter: (ev) => hit(ev).burning, run: (ev, api) => {
        const h = hit(ev);
        const c = vec(h.point);
        const dmg = d.weaponBase() * UP.ember.hit + h.burnDps * h.burnStacks * UP.ember.burn;
        d.blast(c, UP.ember.radius, dmg, 'thermal', src(), api.child(ev), { falloff: 0.4, apply: { burn: Math.max(h.burnDps, d.weaponBase() * 0.3) }, exclude: h.target });
        d.explosionFx(c, UP.ember.radius, 'thermal');
      } })];
    case 'l_stormfall':
      return [eff({ on: 'kill', chainLimit: 3, chance: UP.stormfall.chance, filter: (ev) => hit(ev).element === 'electric', run: (ev, api) => {
        const h = hit(ev);
        const c = vec(h.point);
        const ch = api.child(ev);
        d.blast(c, UP.stormfall.radius, d.weaponBase() * UP.stormfall.dmg, 'electric', src(), ch, { falloff: 0.4, shock: true, exclude: h.target });
        d.explosionFx(c, UP.stormfall.radius, 'electric');
        const near = d.nearest(c, UP.stormfall.radius + 6, [h.target]);
        if (near) d.chainLightning({ from: c, first: near, count: UP.stormfall.jumps, amount: d.weaponBase() * UP.stormfall.jdmg, falloff: 0.9, source: src(), chain: ch, shock: true });
      } })];
    case 'd_barrier':
      return [eff({ on: 'crit', cooldown: 0.2, filter: fromWeapon, run: () => {
        const p = g.player;
        if (p.alive && p.maxShield > 0) p.shield = Math.min(p.maxShield, p.shield + UP.leech.shield(n));
      } })];
    case 'm_surge':
      return [eff({ on: 'kill', chainLimit: 99, run: () => d.addBuff('surge', 'Adrenal Surge', UP.surge.dur, () => [
        { stat: 'moveSpeedMult', op: 'pct', value: UP.surge.move(n) },
        { stat: 'fireRateMult', op: 'pct', value: UP.surge.rate(n) },
      ]) })];
    case 'm_shockdash':
      return [eff({ on: 'dash', cooldown: 0.3, run: (ev, api) => {
        const c = g.player.position.clone();
        c.y += 1;
        d.blast(c, UP.shockdash.radius, d.weaponBase() * UP.shockdash.dmg, 'electric', src(), api.child(ev), { falloff: 0.3, shock: true });
        g.fx.ring(c, UP.shockdash.radius, 0.35, COLOR.electric, true);
        g.fx.ring(c, UP.shockdash.radius * 0.6, 0.25, new Color3(1.5, 2.5, 4), false);
        g.fx.burst('zap', c, 30, undefined, 1.6);
        sfx.play('arc', { volume: 0.9, pitch: 0.6 });
      } })];
    case 'x_rush':
      return [eff({ on: 'earlyStart', run: (ev) => {
        const v = (ev as { value: number }).value;
        const cores = Math.min(UP.rush.cap, Math.round(v * UP.rush.perSec(n)));
        if (cores > 0) g.grantCores(cores);
      } })];
    case 's_sync':
      return [eff({ on: 'hit', cooldown: 0.4, filter: (ev) => ev.source.id === 'e_stormcrit', run: (ev) => {
        const h = hit(ev);
        const k = d.empowerTowers(g.player.position, UP.sync.radius, UP.sync.dur(n));
        if (k > 0) g.wfx.arc(g.player.eye.add(new Vector3(0, -0.4, 0)), vec(h.point));
      } })];
    case 's_detonate':
      return [eff({ on: 'hit', cooldown: 0.05, chainLimit: 1, filter: (ev) => ev.source.kind === 'tower' && hit(ev).burning, run: (ev, api) => {
        const h = hit(ev);
        const c = vec(h.point);
        d.blast(c, UP.detonate.radius, h.base * UP.detonate.mult(n), 'thermal', { kind: 'effect', id, towerId: ev.source.towerId }, api.child(ev), { falloff: 0.3, noStatus: true });
        d.explosionFx(c, UP.detonate.radius, 'thermal');
      } })];
    case 's_feedback':
      return [eff({ on: 'kill', chainLimit: 99, filter: (ev) => ev.source.towerId !== undefined, run: () => d.addBuff('feedback', 'Feedback Loop', UP.feedback.dur, () => [
        { stat: 'coolRateMult', op: 'pct', value: UP.feedback.cool(n) },
        { stat: 'heatEfficiency', op: 'pct', value: 0.1 * n },
      ]) })];
    case 's_mentor':
      return [eff({ on: 'kill', chainLimit: 99, filter: (ev) => ev.source.towerId !== undefined, run: () => d.addBuff('mentor', 'Battle Network', UP.mentor.dur, (s) => [{ stat: 'weaponDamageMult', op: 'pct', value: UP.mentor.per(n) * s }], UP.mentor.max) })];
    case 's_network':
      return [eff({ on: 'hit', chainLimit: 1, filter: fromWeapon, run: (ev) => {
        const h = hit(ev);
        d.networkCharge += h.family === 'beam' ? 0.25 : 1;
        if (d.networkCharge < UP.network.need) return;
        d.networkCharge = 0;
        let fired = 0;
        for (const t of d.towersNear(g.player.position, UP.network.radius)) if (t.forceFire(g.turretCtx, UP.network.mult)) fired++;
        if (fired) {
          d.discharges++;
          g.fx.ring(g.player.position.add(new Vector3(0, 0.1, 0)), UP.network.radius * 0.5, 0.5, COLOR.electric, true);
          sfx.play('arc', { volume: 0.8, pitch: 0.5 });
        }
      } })];
    case 'l_conductor':
      return [eff({ on: 'crit', chance: UP.conductor.chance, cooldown: 0.5, filter: fromWeapon, run: () => {
        let k = 0;
        for (const t of d.towersNear(g.player.position, UP.conductor.radius)) {
          if (k >= UP.conductor.towers) break;
          if (t.forceFire(g.turretCtx, 1)) {
            k++;
            g.wfx.arc(g.player.eye.add(new Vector3(0, -0.4, 0)), new Vector3(t.head.x, t.head.y + 0.4, t.head.z));
          }
        }
        if (k) d.discharges++;
      } })];
    case 'l_grid':
      return [eff({ on: 'towerAttack', chainLimit: 1, run: (ev, api) => {
        d.gridCharge += 1;
        if (d.gridCharge < UP.grid.need) return;
        d.gridCharge = 0;
        d.discharges++;
        const eye = g.player.eye.add(new Vector3(0, -0.4, 0));
        const skip: Enemy[] = [];
        const ch = api.child(ev);
        for (let i = 0; i < UP.grid.jumps; i++) {
          const e = d.nearest(g.player.position, 70, skip);
          if (!e) break;
          skip.push(e);
          const c = e.center(new Vector3());
          g.wfx.arc(eye, c);
          d.lightning++;
          d.deal({ target: e, amount: d.weaponBase() * UP.grid.dmg, base: d.weaponBase() * UP.grid.dmg, element: 'electric', source: src(), chain: ch, point: c, apply: { shock: true } });
        }
        g.fx.ring(g.player.position.add(new Vector3(0, 0.1, 0)), 6, 0.4, COLOR.electric, true);
        sfx.play('arc', { volume: 1, pitch: 0.45 });
      } })];
    case 'w_fission':
      return [eff({ on: 'hit', cooldown: 0.12, filter: fromWeapon, run: (ev, api) => {
        const h = hit(ev);
        const t = live(h);
        if (!t) return;
        const c = vec(h.point);
        const ch = api.child(ev);
        const skip: Enemy[] = [t];
        for (let i = 0; i < UP.fission.frags; i++) {
          const o = d.nearest(c, UP.fission.radius, skip);
          if (!o) break;
          skip.push(o);
          const p = o.center(new Vector3());
          g.fx.tracer(c, p, 0, 0.05, 0.08);
          d.deal({ target: o, amount: h.base * UP.fission.dmg, base: h.base * UP.fission.dmg, element: h.element, source: src(), chain: ch, point: p, quiet: true });
        }
      } })];
    default:
      return [];
  }
}

export { COLOR as ELEMENT_COLOR, upgradeDef, MAX_TOWER_LEVEL };
