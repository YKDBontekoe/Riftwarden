import { Color3, type Mesh, MeshBuilder, type Scene, type TransformNode, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { applyDamage, type DamageResult, type DamageType, type Health } from '../combat/damage';
import { ENEMIES, type EnemyDef, type EnemyKind } from '../data/defs';
import type { Turret } from '../defense/Turrets';
import type { Effects } from '../fx/Effects';
import type { Ordnance, Telegraphs } from '../fx/Hostile';
import type { Player } from '../player/Player';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';
import { hasAnyStatus, isBurning, isChilled, isFrozen, isShocked, newStatus, resetStatus, speedFactor, type StatusState } from '../combat/status';
import { unlit } from '../visuals/materials';
import { buildRusher, buildWalker, type DroneRig, type WalkerRig } from '../visuals/models';
import { buildEliteParts, buildThreatMark, type EliteParts, type ThreatMark } from '../visuals/eliteParts';
import { ELITE, type EliteModId, eliteName, validMods } from '../survival/elites';
import type { ArenaLayout, GateId, Vec2 } from '../world/layout';
import { WalkerMotion } from './walkerMotion';

export interface EnemyContext {
  player: Player;
  effects: Effects;
  layout: ArenaLayout;
  damageReactor(amount: number, at: Vector3): void;
  /** Line of sight against static level geometry. */
  los(a: Vector3, b: Vector3): boolean;
  /** Pan for positional audio. */
  panFor(p: Vector3): { pan: number; volume: number };
  // ---- M6
  towers: readonly Turret[];
  tele: Telegraphs;
  ordnance: Ordnance;
  /** All hostile damage to the drone goes through here (statistics, feedback). */
  hurtPlayer(amount: number, from: Vector3): void;
  /** Hostile area blast: damages the drone (falloff), the reactor if inside, suppresses towers, optionally hurts enemies. */
  hostileBlast(center: Vector3, radius: number, o: { player: number; reactor?: number; disable?: number; enemies?: number; owner?: Enemy | null; color?: 'orange' | 'blue' | 'red' | 'violet' }): void;
  /** Reinforcements (bosses/events). Null when the arena is saturated. */
  summon(kind: EnemyKind, at: Vector3, o?: { mods?: EliteModId[]; gate?: GateId }): Enemy | null;
  /** Short HUD warning (rate limited by the HUD). */
  alert(text: string, tone: 'red' | 'orange' | 'blue' | 'white'): void;
  /** An enemy left the arena alive (escaping high-value target). */
  escaped(e: Enemy): void;
  /** Hostile time since the run started (animation phase). */
  time: number;
  /** M7 co-op: called before each enemy thinks (the server points `player` at that enemy's target drone). */
  focus?(e: Enemy): void;
}

/** M7: lifecycle observers (co-op replication). */
export interface EnemyHooks {
  spawned?(e: Enemy): void;
  killed?(e: Enemy, detonated: boolean): void;
  released?(e: Enemy): void;
}

export interface EnemyHitboxMeta {
  enemy: Enemy;
  weak: boolean;
  /** Named part (boss components). */
  part?: string;
}

/** Context of one damage instance, for behaviours (directional shields, weakpoints, immunity). */
export interface HitInfo {
  weak: boolean;
  /** Where the attack came from (player eye / tower muzzle); null for area, status or reaction damage. */
  from: Vector3 | null;
  point: Vector3;
  dot: boolean;
}

/** Plug-in AI for archetypes beyond the M0 trio (and bosses). Per-enemy state lives in `e.ai`. */
export interface Behavior {
  /** Build the rig (called once per pooled enemy object). */
  create(e: Enemy, m: EnemyManager): void;
  /** Reset per-spawn state. */
  spawn(e: Enemy, ctx: EnemyContext | null, m: EnemyManager): void;
  /** Movement, decisions, attacks and animation (hostile time, already status-scaled where relevant). */
  update(e: Enemy, hdt: number, ctx: EnemyContext, m: EnemyManager): void;
  /** Adjust incoming damage (returns the amount that should apply). */
  damageMod?(e: Enemy, amount: number, info: HitInfo, m: EnemyManager): number;
  /**
   * Death presentation beyond the default explosion. Return true to suppress the default, or a number of
   * seconds to keep the (no longer targetable) wreck animating through `dying` before it is released.
   */
  death?(e: Enemy, ctx: EnemyContext, m: EnemyManager): boolean | number;
  /** Destruction sequence frames (wreck is not in `active`, cannot be hit or targeted). */
  dying?(e: Enemy, dt: number, t: number, ctx: EnemyContext, m: EnemyManager): void;
  /** Released (killed, escaped or cleared): drop telegraphs, children, etc. */
  release?(e: Enemy, m: EnemyManager): void;
  /** Boss health-bar details (phase, state, current attack). */
  hud?(e: Enemy): Partial<import('../ui/store').BossHud>;
}

let nextId = 1;

export class Enemy implements Health {
  readonly id = nextId++;
  /** M7 co-op replicas: the server's id for this enemy (0 = local). */
  netId = 0;
  hp = 0;
  maxHp = 0;
  shield = 0;
  maxShield = 0;
  alive = false;
  state: 'move' | 'attack' = 'move';
  path: Vec2[] = [];
  seg = 1;
  readonly pos = new Vector3();
  yaw = 0;
  attackT = 0;
  shotT = 0;
  chargeT = 0;
  phase = Math.random() * 10;
  flinch = 0;
  stuckT = 0;
  bestDist = Infinity;
  damageMult = 1;
  speedMult = 1;
  /** Remaining path length to the reactor: lower = more dangerous (turret priority). */
  remaining = 0;
  shieldFlash = 0;
  shieldRegenT = 0;
  /** performance.now() of the last damage taken (drives the HUD health bar). */
  lastHit = 0;
  readonly hitboxes: Mesh[] = [];
  /** M5 elemental statuses (reset on spawn and release, so nothing outlives the enemy). */
  readonly status: StatusState = newStatus();
  /** Spawn generation: pooled enemies are reused, queued events compare this to detect a recycled target. */
  gen = 0;
  mark: Mesh | null = null;
  markKind = '';
  readonly motion: WalkerMotion | null;

  // ---- M6
  /** Elite modifiers (empty = regular). */
  mods: EliteModId[] = [];
  /** Built lazily per pooled object, toggled per spawn. */
  readonly eliteParts = new Map<EliteModId, EliteParts>();
  threat: ThreatMark | null = null;
  /** Armored: damage budget the plating still absorbs. */
  armor = 0;
  boostT = 0;
  boostCd = 0;
  dischargeCd = 0;
  dischargeWind = 0;
  dischargeMark = 0;
  /** Engineer empowerment (seconds). */
  buffT = 0;
  /** Encounter role from the wave plan. */
  tag: 'boss' | 'hvt' | 'squad' | 'swarm' | 'summon' | undefined;
  /** Boss repeat-encounter index. */
  encounter = 1;
  /** Behaviour state (new archetypes, bosses). */
  ai: Record<string, unknown> & { rig?: unknown } = {};
  /** Recent damage window (interrupts, repositioning). */
  recentDamage = 0;
  /** Damage taken from the player / towers (statistics are kept by the director; this is per-enemy). */
  spawnedAt = 0;
  /** Recorded so death effects can run without the dead object. */
  displayName = '';

  constructor(
    readonly def: EnemyDef,
    readonly root: TransformNode,
    readonly walker: WalkerRig | null,
    readonly drone: DroneRig | null,
    readonly behavior: Behavior | null,
  ) {
    this.motion = walker ? new WalkerMotion(walker, def.scale) : null;
  }

  get kind(): EnemyKind {
    return this.def.kind;
  }
  get elite(): boolean {
    return this.mods.length > 0;
  }
  has(m: EliteModId): boolean {
    return this.mods.includes(m);
  }
  center(out = new Vector3()): Vector3 {
    return out.set(this.pos.x, this.pos.y + this.def.bodyY, this.pos.z);
  }
  /** Movement multiplier from tier/wave, elites, buffs and boosts (statuses are applied separately). */
  get moveMult(): number {
    return this.speedMult * (this.has('accelerated') ? ELITE.speed : 1) * (this.buffT > 0 ? 1.25 : 1) * (this.boostT > 0 ? ELITE.boostMult : 1);
  }
  /** Attack recovery multiplier (> 1 = faster). */
  get rateMult(): number {
    return (this.has('accelerated') ? ELITE.attackRate : 1) * (this.buffT > 0 ? 1.2 : 1);
  }
  /** Outgoing damage scale. */
  dmg(base: number): number {
    return base * this.damageMult * (this.buffT > 0 ? 1.3 : 1);
  }
}

const TMP = new Vector3();
const TMP2 = new Vector3();

interface PendingBlast {
  pos: Vector3;
  t: number;
  radius: number;
  damage: number;
  marker: number;
  mesh: Mesh;
}

/** Default explosion size per kind (death). */
const BLAST: Partial<Record<EnemyKind, [number, number, number]>> = {
  rusher: [0.8, 6, 1.4],
  walker: [1, 12, 1],
  bulwark: [1.6, 18, 0.75],
  enforcer: [1.7, 20, 0.7],
  artillery: [1.4, 14, 0.85],
  engineer: [1.2, 12, 1.1],
  courier: [2.4, 26, 0.6],
};

export class EnemyManager {
  readonly active: Enemy[] = [];
  private pool = new Map<EnemyKind, Enemy[]>();
  private hitboxTemplate: Mesh;
  private markMats: Record<string, ReturnType<typeof unlit>>;
  private markTemplate: Mesh;
  private behaviors: Partial<Record<EnemyKind, Behavior>> = {};
  private blasts: PendingBlast[] = [];
  /** Pool pre-warm queue: rigs are built ahead of need, one per frame, so spawns never hitch. */
  private warmQueue: EnemyKind[] = [];
  /** Wrecks playing a destruction sequence (bosses). */
  private wrecks: { e: Enemy; t: number; dur: number }[] = [];
  private blastTemplate: Mesh;
  private aiAcc = 0;
  /** Diagnostics: last frame's AI update time (ms) and a smoothed average. */
  aiMs = 0;
  aiAvg = 0;
  /** Statistics for the run (kept by the manager because escapes/volatiles happen here). */
  elitesKilled = 0;
  /** M7: lifecycle observers (replication). */
  hooks: EnemyHooks = {};

  constructor(scene: Scene, readonly kit: Kit, readonly P: Palette) {
    this.markMats = {
      burn: unlit(scene, 'markBurn', [3.2, 0.9, 0.12], { additive: true }),
      shock: unlit(scene, 'markShock', [0.7, 1.8, 4.2], { additive: true }),
      chill: unlit(scene, 'markChill', [1.4, 2.3, 2.8], { additive: true }),
      freeze: unlit(scene, 'markFreeze', [2.4, 3.2, 3.6], { additive: true }),
    };
    this.markTemplate = MeshBuilder.CreateIcoSphere('statusMark', { radius: 0.5, subdivisions: 1, flat: true }, scene);
    this.markTemplate.isVisible = false;
    this.markTemplate.isPickable = false;
    this.markTemplate.setEnabled(false);
    this.hitboxTemplate = MeshBuilder.CreateSphere('hitbox', { diameter: 1, segments: 6 }, scene);
    this.hitboxTemplate.isVisible = false;
    this.hitboxTemplate.isPickable = false;
    this.hitboxTemplate.setEnabled(false);
    this.blastTemplate = MeshBuilder.CreateSphere('volatileCharge', { diameter: 1, segments: 12 }, scene);
    this.blastTemplate.material = unlit(scene, 'volatileChargeMat', [3.2, 0.35, 0.12], { additive: true });
    this.blastTemplate.isPickable = false;
    this.blastTemplate.setEnabled(false);
  }

  /**
   * Make sure the pool can serve `counts` simultaneous enemies per kind without building rigs mid-combat.
   * Work is spread over frames (one object per update call).
   */
  prewarm(counts: Partial<Record<EnemyKind, number>>): void {
    for (const [kind, n] of Object.entries(counts) as [EnemyKind, number][]) {
      const have = (this.pool.get(kind)?.length ?? 0) + this.active.filter((e) => e.kind === kind).length + this.warmQueue.filter((k) => k === kind).length;
      for (let i = have; i < n; i++) this.warmQueue.push(kind);
    }
  }

  /**
   * Build one pooled object of each kind now (arena construction), and attach every elite modifier's hardware to
   * a walker, so all rig templates exist before shaders are compiled behind the deployment transition.
   */
  prebuild(kinds: EnemyKind[]): void {
    for (const kind of kinds) {
      if (this.pool.get(kind)?.length) continue;
      const e = this.create(kind);
      e.root.setEnabled(false);
      if (!this.pool.has(kind)) this.pool.set(kind, []);
      this.pool.get(kind)!.push(e);
      if (kind === 'walker') {
        for (const mod of ['overcharged', 'armored', 'accelerated', 'volatile'] as EliteModId[]) e.eliteParts.set(mod, buildEliteParts(this.kit, this.P, e.root, e.def, mod));
        e.threat = buildThreatMark(this.kit, this.P, e.root, e.def);
      }
    }
  }

  get warming(): number {
    return this.warmQueue.length;
  }

  private warmOne(): void {
    const kind = this.warmQueue.shift();
    if (!kind) return;
    const e = this.create(kind);
    e.root.setEnabled(false);
    if (!this.pool.has(kind)) this.pool.set(kind, []);
    this.pool.get(kind)!.push(e);
  }

  /** Register the AI for an archetype (Game wires every M6 behaviour at construction). */
  register(kind: EnemyKind, b: Behavior): void {
    this.behaviors[kind] = b;
  }

  /** Add a hit sphere (body/weakpoint/boss part) to an enemy. */
  addHitbox(e: Enemy, parent: TransformNode, y: number, z: number, r: number, weak: boolean, part?: string, x = 0): Mesh {
    const h = this.hitboxTemplate.clone('hb', parent)!;
    h.setEnabled(true);
    h.isVisible = false;
    h.isPickable = true;
    h.position.set(x, y, z);
    h.scaling.setAll(r * 2);
    h.metadata = { enemy: e, weak, part } satisfies EnemyHitboxMeta;
    e.hitboxes.push(h);
    return h;
  }

  private create(kind: EnemyKind): Enemy {
    const def = ENEMIES[kind];
    let e: Enemy;
    const b = this.behaviors[kind] ?? null;
    if (b) {
      e = new Enemy(def, this.kit.node(kind, null), null, null, b);
      b.create(e, this);
    } else if (kind === 'rusher') {
      const rig = buildRusher(this.kit, this.P);
      e = new Enemy(def, rig.root, null, rig, null);
    } else {
      const rig = buildWalker(this.kit, this.P, kind === 'bulwark');
      e = new Enemy(def, rig.root, rig, null, null);
    }
    if (!e.hitboxes.length) {
      this.addHitbox(e, e.root, def.bodyY, 0, def.bodyR, false);
      this.addHitbox(e, e.root, def.weakY, def.weakForward, def.weakR, true);
    }
    const mk = this.markTemplate.clone('mark', e.root)!;
    mk.isVisible = true;
    mk.isPickable = false;
    mk.position.set(0, def.weakY + 0.75, 0);
    mk.scaling.setAll(0.34);
    mk.setEnabled(false);
    e.mark = mk;
    return e;
  }

  spawn(kind: EnemyKind, gate: GateId, layout: ArenaLayout, hpMult: number, dmgMult: number, speedMult = 1, o: { mods?: EliteModId[]; tag?: Enemy['tag']; encounter?: number; ctx?: EnemyContext | null } = {}): Enemy {
    const free = this.pool.get(kind);
    const e = free && free.length ? free.pop()! : this.create(kind);
    const def = e.def;
    const hp = Number.isFinite(hpMult) && hpMult > 0 ? hpMult : 1;
    e.maxHp = e.hp = def.hp * hp;
    e.maxShield = e.shield = def.shield * hp;
    e.damageMult = Number.isFinite(dmgMult) && dmgMult > 0 ? dmgMult : 1;
    e.speedMult = speedMult;
    e.alive = true;
    e.gen++;
    resetStatus(e.status);
    e.mark?.setEnabled(false);
    e.markKind = '';
    e.state = 'move';
    e.attackT = def.attackInterval * Math.random();
    e.shotT = def.playerShotInterval * (0.5 + Math.random());
    e.chargeT = 0;
    e.flinch = 0;
    e.stuckT = 0;
    e.bestDist = Infinity;
    e.shieldFlash = 0;
    e.lastHit = 0;
    e.recentDamage = 0;
    e.tag = o.tag;
    e.encounter = o.encounter ?? 1;
    e.buffT = 0;
    e.boostT = 0;
    e.boostCd = ELITE.boostEvery * Math.random();
    e.dischargeCd = 1 + ELITE.dischargeEvery * Math.random();
    e.dischargeWind = 0;
    e.spawnedAt = performance.now();
    this.applyMods(e, o.mods ?? []);
    // Offset lane so groups spread out instead of single-file (heavies and bosses stay central).
    const lateral = (Math.random() * 2 - 1) * (def.role === 'boss' ? 0 : def.radius > 1 ? 0.6 : 1.3);
    e.path = offsetPath(layout.routes[gate].points, lateral);
    const start = e.path[0];
    const dir = { x: e.path[1].x - start.x, z: e.path[1].z - start.z };
    const back = def.role === 'boss' ? 0 : Math.random() * 2;
    const dl = Math.hypot(dir.x, dir.z);
    e.pos.set(start.x - (dir.x / dl) * back, 0, start.z - (dir.z / dl) * back);
    e.seg = 1;
    e.yaw = Math.atan2(dir.x, dir.z);
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
    e.motion?.reset(e.pos, e.yaw);
    e.root.setEnabled(true);
    if (e.walker?.shield) e.walker.shield.setEnabled(e.maxShield > 0);
    e.remaining = pathLength(e.path, 1, e.pos);
    e.displayName = eliteName(def.name, e.mods);
    e.ai = { ...(e.ai.rig ? { rig: e.ai.rig } : {}) };
    e.behavior?.spawn(e, o.ctx ?? null, this);
    this.active.push(e);
    this.hooks.spawned?.(e);
    return e;
  }

  /** Configure elite hardware, threat marker and modifier state for a (re)spawned enemy. */
  private applyMods(e: Enemy, mods: EliteModId[]): void {
    // Keep only compatible modifiers (allowed kind, no contradictions, no duplicates), in order.
    e.mods = [];
    for (const m of mods) if (validMods(e.kind, [...e.mods, m])) e.mods.push(m);
    for (const [id, parts] of e.eliteParts) parts.node.setEnabled(e.mods.includes(id));
    for (const id of e.mods) {
      let parts = e.eliteParts.get(id);
      if (!parts) {
        parts = buildEliteParts(this.kit, this.P, e.root, e.def, id);
        e.eliteParts.set(id, parts);
      }
      parts.node.setEnabled(true);
      for (const p of parts.plates) p.setEnabled(true);
    }
    e.armor = e.has('armored') ? e.maxHp * ELITE.armorBreak : 0;
    const support = e.def.role === 'support' && e.kind !== 'pylon';
    const marked = e.mods.length > 0 || support;
    if (marked && !e.threat) e.threat = buildThreatMark(this.kit, this.P, e.root, e.def);
    if (e.threat) {
      e.threat.node.setEnabled(marked);
      e.threat.diamond.setEnabled(e.mods.length > 0);
      e.threat.support.setEnabled(support);
      for (const [id, pip] of e.threat.pips) pip.setEnabled(e.mods.includes(id));
      e.threat.buff.setEnabled(false);
    }
  }

  /**
   * Apply damage. Returns null if the enemy was already dead. Elite plating and behaviour modifiers (directional
   * shields, phase immunity, boss weakpoints) are resolved here so every source (weapon, towers, statuses,
   * reactions) is treated the same.
   */
  damage(e: Enemy, amount: number, type: DamageType, hitPoint: Vector3, fx: Effects, info: Partial<HitInfo> = {}): DamageResult | null {
    if (!e.alive) return null;
    const hit: HitInfo = { weak: !!info.weak, from: info.from ?? null, point: hitPoint, dot: !!info.dot };
    if (e.behavior?.damageMod) amount = e.behavior.damageMod(e, amount, hit, this);
    if (e.armor > 0 && !hit.weak && !hit.dot) {
      const absorbed = Math.min(e.armor, amount * ELITE.armorAbsorb);
      e.armor -= absorbed;
      amount -= absorbed;
      if (Math.random() < 0.3) fx.burst('sparks', hitPoint, 3, undefined, 0.5);
      if (e.armor <= 0) this.breakArmor(e, fx);
    }
    if (!(amount > 0)) {
      e.lastHit = performance.now();
      return { toShield: 0, toHp: 0, shieldBroken: false, killed: false };
    }
    const res = applyDamage(e, amount, type);
    const heavy = e.def.role === 'boss' ? 0.08 : e.def.radius > 1.1 ? 0.5 : 1;
    e.flinch = Math.min(1, e.flinch + (res.toHp > 0 ? 0.5 : 0.2) * heavy);
    e.shieldRegenT = 4;
    e.lastHit = performance.now();
    e.recentDamage += res.toHp + res.toShield;
    if (res.toShield > 0) {
      e.shieldFlash = 1;
      fx.burst('shield', hitPoint, 6);
      if (e.walker?.shield) {
        const center = e.center(TMP);
        const normal = TMP2.copyFrom(hitPoint).subtractInPlace(center);
        if (normal.lengthSquared() > 0.0001) {
          normal.normalize();
          center.addInPlaceFromFloats(normal.x * 1.83, normal.y * 1.98, normal.z * 1.83);
          fx.shieldRipple(center, normal);
        }
      }
    }
    if (res.shieldBroken) {
      fx.burst('shield', e.center(TMP), 40, undefined, 2);
      sfx.play('shieldHit', { pitch: 0.6 });
      if (e.walker?.shield) e.walker.shield.setEnabled(false);
    }
    return res;
  }

  private breakArmor(e: Enemy, fx: Effects): void {
    const parts = e.eliteParts.get('armored');
    if (parts) for (const p of parts.plates) p.setEnabled(false);
    const c = e.center(TMP);
    fx.debrisBurst(c, 8, 6, 1.1);
    fx.burst('sparks', c, 24, undefined, 1.2);
    sfx.play('shieldHit', { pitch: 0.45, volume: 0.9 });
  }

  /** Heal (engineers). Never above max; never revives. */
  heal(e: Enemy, hp: number, shield = 0): void {
    if (!e.alive) return;
    if (hp > 0) e.hp = Math.min(e.maxHp, e.hp + hp);
    if (shield > 0 && e.maxShield > 0) {
      if (e.shield <= 0 && e.walker?.shield) e.walker.shield.setEnabled(true);
      e.shield = Math.min(e.maxShield, e.shield + shield);
    }
  }

  /** Remove the enemy from play with destruction effects. */
  kill(e: Enemy, fx: Effects, ctx: EnemyContext, detonated = false): void {
    if (!e.alive && !this.active.includes(e)) return;
    this.hooks.killed?.(e, detonated);
    e.alive = false;
    if (e.elite) this.elitesKilled++;
    const c = e.center(new Vector3());
    if (e.has('volatile')) this.armVolatile(e, c, ctx);
    const handled = e.behavior?.death?.(e, ctx, this) ?? false;
    if (typeof handled === 'number' && handled > 0) {
      // Keep the wreck for its destruction sequence; it is already out of play.
      e.alive = false;
      const i = this.active.indexOf(e);
      if (i >= 0) this.active.splice(i, 1);
      for (const h of e.hitboxes) h.isPickable = false;
      this.wrecks.push({ e, t: 0, dur: handled });
      return;
    }
    if (!handled) {
      const [big, debris, pitch] = BLAST[e.kind] ?? [1, 12, 1];
      fx.explode(c, { scale: detonated ? big * 1.25 : big, debris });
      const a = ctx.panFor(c);
      sfx.play('explosion', { volume: a.volume * (detonated ? 1 : 0.8), pan: a.pan, pitch });
    }
    this.release(e);
  }

  /** Volatile: the core goes critical, telegraphed by a swelling sphere and a ground ring, then blasts. */
  private armVolatile(e: Enemy, c: Vector3, ctx: EnemyContext): void {
    const mesh = this.blastTemplate.clone('volatile')!;
    mesh.position.copyFrom(c);
    mesh.setEnabled(true);
    const ground = new Vector3(c.x, Math.max(0, e.pos.y), c.z);
    const marker = ctx.tele.marker(ground, ELITE.volatileRadius, ELITE.volatileDelay, 'red');
    this.blasts.push({ pos: c, t: ELITE.volatileDelay, radius: ELITE.volatileRadius, damage: e.dmg(ELITE.volatileDamage), marker, mesh });
    sfx.play('beep', { pitch: 1.2, pan: ctx.panFor(c).pan });
  }

  /** The enemy leaves the arena alive (no kill rewards). */
  escape(e: Enemy, ctx: EnemyContext): void {
    if (!e.alive) return;
    e.alive = false;
    ctx.escaped(e);
    this.release(e);
  }

  /** Remove without kill rewards (owned parts of a dead boss, debug). */
  despawn(e: Enemy, fx: Effects | null = null): void {
    if (!this.active.includes(e)) return;
    if (fx) fx.burst('sparks', e.center(TMP), 12, undefined, 0.8);
    this.release(e);
  }

  private release(e: Enemy): void {
    e.alive = false;
    this.hooks.released?.(e);
    for (const h of e.hitboxes) h.isPickable = !!(h.metadata as EnemyHitboxMeta | null)?.enemy;
    resetStatus(e.status);
    e.mark?.setEnabled(false);
    e.markKind = '';
    e.behavior?.release?.(e, this);
    e.root.setEnabled(false);
    const i = this.active.indexOf(e);
    if (i >= 0) this.active.splice(i, 1);
    if (!this.pool.has(e.kind)) this.pool.set(e.kind, []);
    this.pool.get(e.kind)!.push(e);
  }

  clear(): void {
    for (const e of [...this.active]) this.release(e);
    for (const w of this.wrecks) this.release(w.e);
    this.wrecks.length = 0;
    for (const b of this.blasts) b.mesh.dispose();
    this.blasts.length = 0;
  }

  /** Status indicator above the head: colour = dominant status (freeze > burn > shock > chill), pulses. */
  updateMarks(t: number): void {
    for (const e of this.active) {
      const m = e.mark;
      if (!m) continue;
      const st = e.status;
      const kind = !hasAnyStatus(st) ? '' : isFrozen(st) ? 'freeze' : isBurning(st) ? 'burn' : isShocked(st) ? 'shock' : isChilled(st) ? 'chill' : '';
      if (kind !== e.markKind) {
        e.markKind = kind;
        if (kind) m.material = this.markMats[kind];
        m.setEnabled(!!kind);
      }
      if (kind) {
        const pulse = kind === 'shock' ? 0.28 + 0.12 * Math.sin(t * 40 + e.id) : kind === 'burn' ? 0.3 + 0.08 * Math.sin(t * 14 + e.id) : 0.3 + 0.04 * Math.sin(t * 5 + e.id);
        m.scaling.setAll(pulse * e.def.scale);
        m.rotation.y = t * 3;
      }
    }
  }

  /** Move along the path at `speed` m/s. Returns true when the end was reached this step. */
  follow(e: Enemy, speed: number, hdt: number, turnRate = 5): boolean {
    const target = e.path[e.seg];
    if (!target) return true;
    const dx = target.x - e.pos.x;
    const dz = target.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    const step = speed * hdt;
    if (dist <= step + 0.05) {
      e.pos.x = target.x;
      e.pos.z = target.z;
      e.seg++;
      e.bestDist = Infinity;
      e.stuckT = 0;
      e.remaining = pathLength(e.path, e.seg, e.pos);
      return e.seg >= e.path.length;
    }
    e.pos.x += (dx / dist) * step;
    e.pos.z += (dz / dist) * step;
    e.yaw = turnTowards(e.yaw, Math.atan2(dx, dz), hdt * turnRate);
    if (dist < e.bestDist - 0.1) {
      e.bestDist = dist;
      e.stuckT = 0;
    } else {
      e.stuckT += hdt;
      if (e.stuckT > 5) {
        e.pos.x = target.x;
        e.pos.z = target.z;
        e.stuckT = 0;
      }
    }
    e.remaining = pathLength(e.path, e.seg, e.pos);
    return false;
  }

  /** Point `back` metres behind the enemy along its own path (retreat/repositioning stays on the lane). */
  pointBehind(e: Enemy, back: number, out = new Vector3()): Vector3 {
    let x = e.pos.x;
    let z = e.pos.z;
    let left = back;
    for (let i = e.seg - 1; i >= 0 && left > 0; i--) {
      const p = e.path[i];
      const d = Math.hypot(p.x - x, p.z - z);
      if (d >= left) {
        x += ((p.x - x) / d) * left;
        z += ((p.z - z) / d) * left;
        left = 0;
        break;
      }
      x = p.x;
      z = p.z;
      left -= d;
    }
    return out.set(x, 0, z);
  }

  /** Step back along the path by `dist` metres at `speed`. Returns true when done. */
  retreat(e: Enemy, speed: number, hdt: number): void {
    const prev = e.path[Math.max(0, e.seg - 1)];
    const dx = prev.x - e.pos.x;
    const dz = prev.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, speed * hdt);
    if (d < 0.05) {
      if (e.seg > 1) e.seg--;
      return;
    }
    e.pos.x += (dx / d) * step;
    e.pos.z += (dz / d) * step;
    e.remaining = pathLength(e.path, e.seg, e.pos);
  }

  update(hdt: number, ctx: EnemyContext, dt = hdt): void {
    const t0 = performance.now();
    if (this.warmQueue.length) this.warmOne();
    this.updateBlasts(hdt, ctx);
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.t += dt;
      w.e.behavior?.dying?.(w.e, dt, w.t, ctx, this);
      if (w.t >= w.dur) {
        this.wrecks.splice(i, 1);
        this.release(w.e);
      }
    }
    if (hdt <= 0) {
      this.aiMs = performance.now() - t0;
      return;
    }
    // Separation (n is small; O(n^2) is cheaper than a spatial structure here). Bosses are immovable.
    const list = this.active;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = a.def.radius + b.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.5 * Math.min(1, hdt * 8);
          const wa = a.def.role === 'boss' ? 0 : b.def.role === 'boss' ? 2 : 1;
          const wb = b.def.role === 'boss' ? 0 : a.def.role === 'boss' ? 2 : 1;
          a.pos.x -= dx * push * wa;
          a.pos.z -= dz * push * wa;
          b.pos.x += dx * push * wb;
          b.pos.z += dz * push * wb;
        }
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.alive) continue;
      const def = e.def;
      ctx.focus?.(e);
      e.flinch = Math.max(0, e.flinch - hdt * 4);
      e.shieldFlash = Math.max(0, e.shieldFlash - hdt * 5);
      e.recentDamage *= Math.exp(-hdt / 2.5);
      if (e.buffT > 0) e.buffT = Math.max(0, e.buffT - hdt);
      if (e.maxShield > 0) {
        e.shieldRegenT -= hdt;
        if (e.shieldRegenT <= 0 && e.shield < e.maxShield) {
          if (e.shield <= 0 && e.walker?.shield) e.walker.shield.setEnabled(true);
          e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.25 * hdt);
        }
      }
      if (e.elite) this.updateElite(e, hdt, ctx);
      if (e.threat) this.animateThreat(e, ctx.time);
      if (!e.alive) continue;

      if (e.behavior) {
        e.behavior.update(e, hdt, ctx, this);
        continue;
      }

      const player = ctx.player;
      const ppos = player.position;
      // Statuses: chill slows, shock disrupts briefly, freeze stops movement, attacks and animation.
      const sf = speedFactor(e.status);
      const adt = hdt * sf * e.rateMult;
      const slow = (1 - e.flinch * 0.5) * sf;
      if (e.state === 'move') {
        const reached = this.follow(e, def.speed * e.moveMult * slow, hdt, e.kind === 'rusher' ? 10 : 5);
        if (reached) {
          if (e.kind === 'rusher') {
            ctx.damageReactor(e.dmg(def.reactorDamage), e.center(TMP2));
            this.kill(e, ctx.effects, ctx, true);
            continue;
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
            this.kill(e, ctx.effects, ctx, true);
            continue;
          }
        }
      } else {
        // Attack the reactor
        const desiredYaw = Math.atan2(ctx.layout.reactor.x - e.pos.x, ctx.layout.reactor.z - e.pos.z);
        e.yaw = turnTowards(e.yaw, desiredYaw, hdt * 4);
        e.attackT -= adt;
        if (e.attackT <= 0) {
          e.attackT = def.attackInterval;
          const muzzle = this.muzzlePos(e, TMP);
          e.motion?.fire();
          ctx.effects.burst('flash', muzzle, 1, undefined, 0.22);
          const target = TMP2.set(ctx.layout.reactor.x, 3, ctx.layout.reactor.z);
          target.subtractInPlace(muzzle).normalize().scaleInPlace(2.2).addInPlace(muzzle);
          ctx.effects.tracer(muzzle, target.set(ctx.layout.reactor.x, 3 + Math.random(), ctx.layout.reactor.z), 2, 0.12, 0.12);
          ctx.effects.burst('enemySpark', target, 8);
          ctx.damageReactor(e.dmg(def.reactorDamage), target);
          const a = ctx.panFor(muzzle);
          sfx.play('enemyShot', { volume: a.volume * 0.6, pan: a.pan });
        }
      }

      // Walkers fire telegraphed plasma bolts at the player when they have line of sight.
      if (e.walker && player.alive && def.playerShotInterval > 0) {
        if (e.chargeT > 0) {
          e.chargeT -= adt;
          if (e.chargeT <= 0) {
            const muzzle = this.muzzlePos(e, TMP);
            const aim = TMP2.copyFrom(player.eye);
            aim.y -= 0.35;
            aim.subtractInPlace(muzzle).normalize().scaleInPlace(e.kind === 'bulwark' ? 24 : 21);
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
            if (d2 < def.playerShotRange * def.playerShotRange && ctx.los(c, player.eye)) e.chargeT = 0.55;
          }
        }
      }

      this.animate(e, adt, ppos, ctx.effects);
    }
    const ms = performance.now() - t0;
    this.aiMs = ms;
    this.aiAcc = this.aiAcc * 0.95 + ms * 0.05;
    this.aiAvg = this.aiAcc;
  }

  /** Elite mechanics shared by every archetype (hostile time). */
  private updateElite(e: Enemy, hdt: number, ctx: EnemyContext): void {
    const sf = speedFactor(e.status);
    // Accelerated: periodic thruster boost (flames flare, short dash along the lane).
    if (e.has('accelerated')) {
      if (e.boostT > 0) e.boostT = Math.max(0, e.boostT - hdt);
      e.boostCd -= hdt * sf;
      if (e.boostCd <= 0 && e.state === 'move' && sf > 0.5) {
        e.boostCd = ELITE.boostEvery;
        e.boostT = ELITE.boostTime;
        ctx.effects.burst('puff', e.center(TMP), 4, undefined, 0.8);
      }
      const parts = e.eliteParts.get('accelerated');
      if (parts) for (const f of parts.flames) f.scaling.set(0.28, (e.boostT > 0 ? 1.6 : 0.6) + 0.15 * Math.sin(ctx.time * 40 + e.id), 0.28);
    }
    // Overcharged: telegraphed electrical discharge at the drone and nearby towers.
    if (e.has('overcharged')) {
      const parts = e.eliteParts.get('overcharged');
      if (parts?.spin) parts.spin.rotation.y += hdt * (e.dischargeWind > 0 ? 14 : 3);
      if (e.dischargeWind > 0) {
        if (isFrozen(e.status) || isShocked(e.status)) {
          // Disrupted mid-charge (elemental counterplay).
          e.dischargeWind = 0;
          ctx.tele.cancel(e.dischargeMark);
          ctx.effects.burst('zap', e.center(TMP), 6);
        } else {
          e.dischargeWind -= hdt;
          if (Math.random() < hdt * 20) ctx.effects.burst('zap', e.center(TMP), 2, undefined, 0.8);
          if (e.dischargeWind <= 0) this.discharge(e, ctx);
        }
      } else {
        e.dischargeCd -= hdt * sf;
        if (e.dischargeCd <= 0) {
          e.dischargeCd = ELITE.dischargeEvery / e.rateMult;
          const c = e.center(TMP);
          const r2 = (ELITE.dischargeRange + 3) ** 2;
          const near = (ctx.player.alive && Vector3.DistanceSquared(c, ctx.player.position) < r2) || ctx.towers.some((t) => !t.building && (t.pos.x - c.x) ** 2 + (t.pos.z - c.z) ** 2 < r2);
          if (near) {
            e.dischargeWind = ELITE.dischargeWindup;
            e.dischargeMark = ctx.tele.marker(new Vector3(e.pos.x, 0, e.pos.z), ELITE.dischargeRange, ELITE.dischargeWindup, 'blue', () => (e.alive ? TMP2.set(e.pos.x, 0, e.pos.z) : null));
            sfx.play('charge', { pitch: 2, volume: 0.6, pan: ctx.panFor(c).pan });
          }
        }
      }
    }
    if (e.has('volatile')) {
      const parts = e.eliteParts.get('volatile');
      const f = e.maxHp > 0 ? e.hp / e.maxHp : 1;
      if (parts?.core) parts.core.scaling.setAll(0.42 + 0.08 * Math.sin(ctx.time * (6 + (1 - f) * 18) + e.id));
    }
  }

  private discharge(e: Enemy, ctx: EnemyContext): void {
    const c = e.center(new Vector3());
    const r = ELITE.dischargeRange;
    const fx = ctx.effects;
    fx.burst('zap', c, 24, undefined, 1.4);
    fx.ring(new Vector3(c.x, 0.15, c.z), r, 0.3, new Color3(0.5, 1.4, 3.6), true);
    sfx.play('arc', { volume: 1, pitch: 0.8, pan: ctx.panFor(c).pan });
    const pe = ctx.player.eye;
    if (ctx.player.alive && Vector3.DistanceSquared(c, ctx.player.position) < r * r && ctx.los(c, pe)) {
      ctx.tele.line(c, pe, 0.12, 'blue', 0.08);
      ctx.hurtPlayer(e.dmg(ELITE.dischargeDamage), c);
    }
    for (const t of ctx.towers) {
      if ((t.pos.x - c.x) ** 2 + (t.pos.z - c.z) ** 2 > r * r || t.building) continue;
      ctx.tele.line(c, t.head, 0.12, 'blue', 0.06);
      t.disable(ELITE.towerShortTime);
    }
  }

  private animateThreat(e: Enemy, t: number): void {
    const m = e.threat!;
    m.node.rotation.y = t * 1.6;
    m.node.position.y = e.def.topY + 0.15 + Math.sin(t * 2.4 + e.id) * 0.08;
    const buffed = e.buffT > 0;
    if (m.buff.isEnabled() !== buffed) m.buff.setEnabled(buffed);
    if (buffed) m.buff.rotation.y = t * 4;
  }

  /** Volatile death charges -> blasts (hostile time). */
  private updateBlasts(hdt: number, ctx: EnemyContext): void {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= hdt;
      const f = 1 - Math.max(0, b.t) / ELITE.volatileDelay;
      b.mesh.scaling.setAll(0.6 + f * 2.2 + 0.2 * Math.sin(f * 40));
      if (b.t > 0) continue;
      b.mesh.dispose();
      this.blasts.splice(i, 1);
      ctx.effects.explode(b.pos, { scale: 1.5, color: new Color3(3.2, 0.6, 0.15), debris: 6 });
      sfx.play('explosion', { volume: 1, pitch: 0.7, pan: ctx.panFor(b.pos).pan });
      ctx.hostileBlast(b.pos, b.radius, { player: b.damage, reactor: b.damage * 0.6, disable: 3, enemies: 0.5 * b.damage, color: 'red' });
    }
  }

  get dyingCount(): number {
    return this.wrecks.length;
  }

  get pendingBlasts(): number {
    return this.blasts.length;
  }

  muzzlePos(e: Enemy, out: Vector3): Vector3 {
    if (e.walker) {
      e.walker.muzzleGlow.computeWorldMatrix(true);
      return out.copyFrom(e.walker.muzzleGlow.getAbsolutePosition());
    }
    return e.center(out);
  }

  private animate(e: Enemy, hdt: number, ppos: Vector3, fx: Effects): void {
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = e.yaw;
    e.phase += hdt;
    if (e.walker) {
      const w = e.walker;
      const dx = ppos.x - e.pos.x;
      const dz = ppos.z - e.pos.z;
      const look = Math.atan2(dx, dz) - e.yaw;
      w.head.rotation.y = clampAngle(look, 0.7);
      const charge = e.chargeT > 0 ? 1 - e.chargeT / 0.55 : 0;
      const aimPitch = e.state === 'attack' ? 0.10 : Math.max(-0.15, Math.min(0.22, (e.pos.y + 1.9 - ppos.y) / Math.max(2, Math.hypot(dx, dz))));
      const planted = e.motion!.pose(e.pos, e.yaw, hdt * (e.boostT > 0 ? 1.6 : 1), e.state === 'move', charge, e.flinch, aimPitch);
      if (planted && (dx * dx + dz * dz) < 18 * 18) fx.burst('puff', planted, e.kind === 'bulwark' ? 3 : 1, undefined, 0.6);
      if (w.shield) {
        const s = e.shieldFlash;
        w.shield.scaling.set(3.6 + s * 0.3, 3.9 + s * 0.3, 3.6 + s * 0.3);
        w.shield.visibility = 0.55 + s * 0.45;
      }
    } else if (e.drone) {
      const d = e.drone;
      d.body.position.y = 1.3 + Math.sin(e.phase * 7) * 0.12;
      d.body.position.x = Math.sin(e.phase * 3.1) * 0.35;
      d.body.rotation.z = Math.cos(e.phase * 3.1) * -0.35 + e.flinch * 0.6;
      d.body.rotation.x = 0.18 + e.flinch * -0.5 + (e.boostT > 0 ? 0.3 : 0);
      d.ring.rotation.y = e.phase * 12;
    }
  }

  /** For HUD/debug: counts by kind. */
  get count(): number {
    return this.active.length;
  }
}

export function turnTowards(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

export function clampAngle(a: number, lim: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.max(-lim, Math.min(lim, a));
}

function offsetPath(pts: Vec2[], lateral: number): Vec2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // The final point stays closer to the lane end so walkers ring the reactor.
    const k = i === pts.length - 1 ? 1.4 : 1;
    return { x: p.x + (dz / l) * lateral * k, z: p.z - (dx / l) * lateral * k };
  });
}

export function pathLength(path: Vec2[], seg: number, pos: Vector3): number {
  if (seg >= path.length) return 0;
  let len = Math.hypot(path[seg].x - pos.x, path[seg].z - pos.z);
  for (let i = seg; i < path.length - 1; i++) len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
  return len;
}
