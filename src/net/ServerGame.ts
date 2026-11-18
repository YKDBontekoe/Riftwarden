import { type Engine, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { mulberry32 } from '../combat/damage';
import { BASE_STATS, type CombatStats, computeStats, STAT_DEFS, type StatModifier } from '../combat/stats';
import { type ArenaConfig, Game } from '../core/Game';
import type { Input } from '../core/Input';
import type { Settings } from '../core/settings';
import type { WeaponDef, WeaponFamily } from '../data/defs';
import { type Enemy, type EnemyHitboxMeta } from '../enemies/EnemyManager';
import { DROP_SOURCES, type DropSource, type DropSourceId, rollDrops } from '../loot/drops';
import { equipmentModifiers, weaponDefFor } from '../loot/equipment';
import { generateItem, hashSeed } from '../loot/generate';
import { convertsToSalvage, expiresAfterWave, PICKUP_RANGE, type Pickup } from '../loot/LootField';
import { scrapValue } from '../loot/economy';
import { RunInventory } from '../loot/runInventory';
import type { ItemInstance } from '../loot/types';
import { Player } from '../player/Player';
import { SLOT_IDS, type SlotId } from '../progression/items';
import { type Rewards, RunLedger } from '../progression/run';
import { isCheckpointWave } from '../progression/tiers';
import { upgradeDef } from '../roguelite/upgrades';
import { canInstall, configCost, partDef, type TowerConfig } from '../towers/components';
import type { Turret } from '../defense/Turrets';
import { uiEvents } from '../ui/store';
import { ARENA } from '../world/layout';
import type { ActMsg, InputMsg, ShotClaim } from './protocol';
import { arr, enc } from './wire';

/** Replicated event (tuple, see ClientGame for the decoder). `to` restricts delivery to one player. */
export interface NetEvent {
  e: unknown[];
  to?: string;
  /** Everyone except this player (presentation the actor already showed locally). */
  not?: string;
}

/**
 * Presentation recorder for the headless server: effects, sounds and HUD events produced by the
 * authoritative simulation are captured and streamed to the replicas. `pause` silences paths the
 * replicas reproduce on their own (enemy deaths, shield hits) so nothing is shown twice.
 */
export class Recorder {
  out: NetEvent[] = [];
  /** Player that owns the presentation currently being produced (shots, hits): personal events go only to them. */
  owner: string | null = null;
  paused = 0;
  /** Last world position asked for panning: attached to the next sound (positional audio on replicas). */
  panPos: Vector3 | null = null;

  push(e: unknown[], to?: string | null): void {
    if (this.paused > 0) return;
    this.out.push(to ? { e, to } : { e });
  }
  pushExcept(e: unknown[], not: string): void {
    if (this.paused > 0) return;
    this.out.push({ e, not });
  }
  quiet<T>(fn: () => T): T {
    this.paused++;
    try {
      return fn();
    } finally {
      this.paused--;
    }
  }
  take(): NetEvent[] {
    const o = this.out;
    this.out = [];
    return o;
  }
}

/** Sounds and HUD events emitted while this recorder is current (one simulation runs at a time). */
let current: Recorder | null = null;
const PERSONAL_UI = new Set(['hit', 'damageNumber', 'hurt', 'loot']);
let patched = false;
function patchGlobals(): void {
  if (patched) return;
  patched = true;
  const play = sfx.play.bind(sfx);
  sfx.play = ((name: string, o: Record<string, unknown> = {}) => {
    const r = current;
    if (r && r.paused === 0) {
      const pos = r.panPos;
      r.panPos = null;
      r.push(['s', name, enc({ ...o, pan: undefined }), pos ? arr(pos) : null], r.owner);
    }
    void play;
  }) as typeof sfx.play;
  const emit = uiEvents.emit.bind(uiEvents);
  uiEvents.emit = ((k: string, v: unknown) => {
    const r = current;
    if (r && r.paused === 0) {
      const personal = PERSONAL_UI.has(k);
      if (!personal || r.owner) r.push(['u', k, enc(v)], personal ? r.owner : null);
    }
    void emit;
  }) as typeof uiEvents.emit;
}

export interface ServerPlayerInit {
  id: string;
  name: string;
  slot: number;
  loadout: Partial<Record<SlotId, ItemInstance | null>>;
  ledger: RunLedger;
}

interface ServerPickup {
  id: number;
  owner: string;
  item: ItemInstance;
  ground: Vector3;
  wave: number;
  readyAt: number;
}

/** One deployed drone on the server. */
export class Avatar {
  readonly player: Player;
  readonly inventory: RunInventory;
  stats: CombatStats = { ...BASE_STATS };
  weaponDef: WeaponDef;
  rand: () => number;
  lootCounter = 0;
  connected = true;
  left = false;
  lastSeq = -1;
  lastT = 0;
  readonly lastPos = new Vector3();
  /** Shot budget (token bucket refilled at the weapon's rate). */
  budget = 4;
  heat = 0;
  flags = 0;
  speed = 0;
  pitch = 0;
  vote: boolean | null = null;
  readonly pickups = new Map<number, ServerPickup>();
  kills = 0;
  damage = 0;
  deaths = 0;
  /** Beam ramp tracking (server-side, the client cannot claim a ramp). */
  beamTarget = 0;
  beamT = 0;
  inventoryDirty = true;
  wasAlive = true;
  dashCharges = 2;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly slot: number,
    game: Game,
    loadout: Partial<Record<SlotId, ItemInstance | null>>,
    readonly run: RunLedger,
  ) {
    const sp = spawnFor(slot);
    this.player = new Player(game.scene, sp);
    this.player.camera.position.set(sp.x, 1.5, sp.z);
    this.inventory = new RunInventory(loadout, run);
    this.weaponDef = weaponDefFor(this.inventory.equipped('weapon'))!;
    this.rand = mulberry32(hashSeed(`${run.id}:${id}`));
    this.lastPos.copyFrom(this.player.position);
  }

  get active(): boolean {
    return this.connected && !this.left;
  }
}

/** Spawn points fan out beside the solo spawn so drones never overlap. */
export function spawnFor(slot: number): { x: number; z: number; yaw: number } {
  const s = ARENA.playerSpawn;
  const off = [0, 2.2, -2.2, 4.4][slot] ?? 0;
  return { x: s.x + Math.cos(s.yaw) * off, z: s.z - Math.sin(s.yaw) * off, yaw: s.yaw };
}

/** Run ledger shared by the team: every collected resource is mirrored to each player's own ledger. */
class TeamLedger extends RunLedger {
  members: () => RunLedger[] = () => [];
  collect(r: Partial<Rewards>): boolean {
    const res = super.collect({ salvage: r.salvage, credits: r.credits, components: r.components });
    for (const m of this.members()) m.collect({ salvage: r.salvage, credits: r.credits, components: r.components });
    return res;
  }
  tick(dt: number): void {
    super.tick(dt);
    for (const m of this.members()) m.tick(dt);
  }
  addKill(): void {
    super.addKill();
    for (const m of this.members()) m.addKill();
  }
  waveReached(n: number): void {
    super.waveReached(n);
    for (const m of this.members()) m.waveReached(n);
  }
  waveCleared(n: number): void {
    super.waveCleared(n);
    for (const m of this.members()) m.waveCleared(n);
  }
}

export interface ServerHooks {
  /** Persist a player's banked rewards. Returns true once written. */
  bank(playerId: string, wave: number, rewards: Rewards, bosses: number): boolean;
  /** Reactor destroyed. */
  defeat(): void;
  /** Unanimous extraction vote at a checkpoint. */
  extract(): void;
}

const MAX_SPEED = 46;
const TOWER_KEYS = new Set(Object.values(STAT_DEFS).filter((d) => d.group === 'tower').map((d) => d.key as string).concat(['coreIncomeMult', 'tacticalRechargeMult']));

/**
 * Authoritative co-op arena: the real Game simulation (waves, AI, bosses, events, towers, statuses,
 * director, loot rules) with one server-side drone per player. Clients send movement state and
 * shot claims; damage is computed here from each player's own server-known loadout and stats.
 */
export class ServerGame extends Game {
  readonly rec = new Recorder();
  readonly avatars: Avatar[] = [];
  readonly team: TeamLedger;
  private pickupSeq = 1;
  private sh: ServerHooks;
  /** Pending upgrade offer (rotating chooser) and the extraction vote. */
  offerChooser: string | null = null;
  offerDeadline = 0;
  voteOpen = false;
  voteDeadline = 0;
  clock = 0;
  defeated = false;
  /** Statistics: rejected claims (tests / diagnostics). */
  rejected = { shots: 0, hits: 0, moves: 0, acts: 0 };

  constructor(engine: Engine, havok: unknown, players: ServerPlayerInit[], cfg: Omit<ArenaConfig, 'hooks' | 'loadout' | 'run'> & { runId: string }, hooks: ServerHooks) {
    patchGlobals();
    const team = new TeamLedger(cfg.runId, cfg.tier.id, Date.now());
    const canvas = { focus() {}, clientWidth: 1280, clientHeight: 720 } as unknown as HTMLCanvasElement;
    const input = { onLockChange: null, captured: false, locked: false, pressed: () => false, isDown: () => false, mouse: () => false, mousePressed: () => false, mouseDx: 0, mouseDy: 0, releaseLock() {}, requestLock: async () => true, isLockedNow: () => false } as unknown as Input;
    const settings = { quality: 'low', sensitivity: 1, fov: 90, volume: 0 } as unknown as Settings;
    const prev = current;
    const rec = new Recorder();
    current = rec;
    rec.paused++;
    const box: { g?: ServerGame } = {};
    try {
      super(engine, canvas, havok, settings, input, {
        ...cfg,
        loadout: players[0].loadout,
        run: team,
        hooks: { bank: () => true, checkpoint: () => {}, defeat: () => box.g?.serverDefeat() },
      });
    } finally {
      current = prev;
    }
    box.g = this;
    (this as { rec: Recorder }).rec = rec;
    // Wave clears: per-player loot lifetime and banking after the shared rewards were mirrored.
    const wh = (this.waves as unknown as { hooks: { onWaveCleared(w: { number: number }): void } }).hooks;
    const cleared = wh.onWaveCleared;
    wh.onWaveCleared = (w) => {
      cleared(w);
      this.expireLoot(w.number);
      if (isCheckpointWave(w.number)) this.bankAll(w.number);
    };
    this.team = team;
    this.sh = hooks;
    // The server's own camera body is never a target.
    this.player.alive = false;
    this.player.respawnT = Infinity;
    this.player.controller.setPosition(new Vector3(0, -50, 0));
    for (const p of players) this.addAvatar(p);
    team.members = () => this.avatars.filter((a) => !a.left).map((a) => a.run);
    // Enemy lifecycle -> replication.
    this.enemies.hooks = {
      spawned: (e) => this.rec.push(['es', e.id, e.kind, e.mods, e.tag ?? null, e.encounter, e.maxHp, e.maxShield, Math.round(e.pos.x * 100) / 100, Math.round(e.pos.z * 100) / 100, Math.round(e.yaw * 1000) / 1000, e.seg, laneOf(e)]),
      killed: (e, det) => this.rec.push(['ek', e.id, det ? 1 : 0]),
      released: (e) => this.rec.push(['er', e.id]),
    };
    this.enemyCtx.focus = (e) => this.focus(e);
    this.wrapPresentation();
    // Headless: nothing renders, so world matrices of the static level are computed once here (picking needs them).
    for (const m of this.scene.meshes) m.computeWorldMatrix(true);
    this.setScreen('playing');
    this.rec.paused = 0;
  }

  addAvatar(p: ServerPlayerInit): Avatar {
    const a = new Avatar(p.id, p.name, p.slot, this, p.loadout, p.ledger);
    a.player.vitalsLocal = true;
    a.player.onHurt = (amount, from) => {
      const h = a.player.lastHit;
      this.rec.push(['h', Math.round(amount * 10) / 10, h.toHull > 0 ? 1 : 0, from ? arr(from) : null], a.id);
    };
    a.player.knockback = (dir: Vector3, strength: number) => this.rec.push(['k', arr(dir), strength], a.id);
    this.avatars.push(a);
    this.rebuildStats();
    return a;
  }

  avatar(id: string): Avatar | undefined {
    return this.avatars.find((a) => a.id === id);
  }

  // ------------------------------------------------------------------ presentation capture

  /** Route the game's presentation objects into the recorder (the headless server renders nothing). */
  private wrapPresentation(): void {
    const rec = this.rec;
    const fx = this.fx as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ['burst', 'explode', 'impact', 'ring', 'tracer', 'flashLight', 'debrisBurst', 'shieldRipple']) {
      fx[m] = (...args: unknown[]) => rec.push(['f', m, enc(args)]);
    }
    const spawnProjectile = fx.spawnProjectile.bind(this.fx);
    fx.spawnProjectile = (...args: unknown[]) => {
      rec.push(['f', 'spawnProjectile', enc([args[0], args[1], 0])]);
      return rec.quiet(() => spawnProjectile(...args));
    };
    const wfx = this.wfx as unknown as Record<string, (...a: unknown[]) => unknown>;
    wfx.arc = (...args: unknown[]) => rec.push(['w', 'arc', enc(args)]);
    wfx.rail = () => {};
    wfx.bolt = () => {};
    wfx.beam = () => {};
    const tele = this.tele as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ['marker', 'line']) {
      const orig = tele[m].bind(this.tele);
      tele[m] = (...args: unknown[]) => {
        const id = orig(...args) as number;
        rec.push(['t', m, id, enc(args)]);
        return id;
      };
    }
    for (const m of ['moveLine', 'cancel']) {
      const orig = tele[m].bind(this.tele);
      tele[m] = (...args: unknown[]) => {
        rec.push(['t', m, args[0], enc(args.slice(1))]);
        return orig(...args);
      };
    }
    const ord = this.ordnance as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ['lob', 'orb', 'missile']) {
      const orig = ord[m].bind(this.ordnance);
      ord[m] = (...args: unknown[]) => {
        const ok = rec.quiet(() => orig(...args));
        if (ok) rec.push(['o', m, this.ordnance.lastId, enc(args)]);
        return ok;
      };
    }
    // Enemy-internal presentation (deaths, shield/armor hits) is reproduced by the replicas themselves.
    const kill = this.enemies.kill.bind(this.enemies);
    this.enemies.kill = (e, fx2, ctx, det) => {
      if (e.alive) this.enemies.hooks.killed?.(e, !!det);
      const h = this.enemies.hooks.killed;
      this.enemies.hooks.killed = undefined;
      try {
        rec.quiet(() => kill(e, fx2, ctx, det));
      } finally {
        this.enemies.hooks.killed = h;
      }
    };
    const damage = this.enemies.damage.bind(this.enemies);
    this.enemies.damage = (e, ...rest) => {
      const res = rec.quiet(() => damage(e, ...rest));
      if (res && res.toShield + res.toHp > 0) rec.push(['ed', e.id, res.toShield > 0 ? 1 : 0]);
      return res;
    };
    // Evolution / gates.
    const evo = this.survival.applyEvolution.bind(this.survival);
    this.survival.applyEvolution = (id, instant) => {
      rec.push(['ev', id, instant ? 1 : 0]);
      return evo(id, instant);
    };
  }

  get enemyFx() {
    return this.fx;
  }

  panFor(p: Vector3): { pan: number; volume: number } {
    this.rec.panPos = p.clone();
    return { pan: 0, volume: 1 };
  }

  /** Run `fn` with a player's presentation ownership and combat identity (stats, body). */
  private as<T>(a: Avatar, fn: () => T): T {
    const prevPlayer = this.player;
    const prevStats = this.stats;
    const prevOwner = this.rec.owner;
    const prevDef = this.weapon.def;
    (this as { player: Player }).player = a.player;
    this.stats = a.stats;
    this.rec.owner = a.id;
    this.weapon.def = a.weaponDef;
    try {
      return fn();
    } finally {
      (this as { player: Player }).player = prevPlayer;
      this.stats = prevStats;
      this.rec.owner = prevOwner;
      this.weapon.def = prevDef;
    }
  }

  // ------------------------------------------------------------------ targeting

  targets(): readonly Player[] {
    return this.avatars.filter((a) => a.active).map((a) => a.player);
  }

  /** Each enemy hunts the nearest living drone (sticky for a few seconds so it does not dither). */
  private focus(e: Enemy): void {
    let tgt = this.avatars.find((a) => a.id === e.ai.__target && a.active && a.player.alive && (e.ai.__targetT as number) > this.clock);
    if (!tgt) {
      let bd = Infinity;
      for (const a of this.avatars) {
        if (!a.active || !a.player.alive) continue;
        const d = (a.player.position.x - e.pos.x) ** 2 + (a.player.position.z - e.pos.z) ** 2;
        if (d < bd) {
          bd = d;
          tgt = a;
        }
      }
      if (tgt) {
        e.ai.__target = tgt.id;
        e.ai.__targetT = this.clock + 3;
      }
    }
    const body = tgt?.player ?? this.player;
    this.enemyCtx.player = body;
    (this as { player: Player }).player = body;
  }

  hurtPlayer(amount: number, from: Vector3, target: Player = this.player): void {
    const a = this.avatars.find((x) => x.player === target);
    if (!a || !a.active) return;
    this.rec.quiet(() => super.hurtPlayer(amount, from, target));
  }

  // ------------------------------------------------------------------ stats

  rebuildStats(): void {
    if (!this.avatars) {
      super.rebuildStats();
      return;
    }
    const shared = [...this.modifiers, ...this.director.build.modifiers(), ...this.director.buffModifiers()];
    const live = this.avatars.filter((a) => !a.left);
    const n = Math.max(1, live.length);
    // Towers are shared: each player's tower gear contributes 1/n (a full team of tower builds = one full build).
    const towerGear: StatModifier[] = [];
    for (const a of live) {
      for (const m of equipmentModifiers(a.inventory.equippedItems())) {
        if (!TOWER_KEYS.has(m.stat)) continue;
        towerGear.push({ ...m, value: m.op === 'mul' ? Math.pow(1 + m.value, 1 / n) - 1 : m.value / n });
      }
    }
    Object.assign(this.stats, computeStats([...towerGear, ...shared]));
    for (const a of this.avatars) {
      a.stats = computeStats([...equipmentModifiers(a.inventory.equippedItems()), ...shared]);
      a.player.applyStats(a.stats, this.attackerScale);
      a.weaponDef = weaponDefFor(a.inventory.equipped('weapon')) ?? a.weaponDef;
    }
    this.player.applyStats(this.stats, this.attackerScale);
    this.tactical.rechargeMult = this.stats.tacticalRechargeMult;
    this.statsVersion++;
    this.turretCtx.statsVersion = this.statsVersion;
  }

  refreshEquipment(): void {
    this.rebuildStats();
    this.inventoryVersion++;
  }

  // ------------------------------------------------------------------ loot (individual ownership)

  rollItems(source: DropSourceId, wave = this.waves.number): ItemInstance[] {
    // Checkpoint caches: one per player, straight into that player's run (banked with the checkpoint).
    for (const a of this.avatars) {
      if (a.left) continue;
      const items = this.rollFor(a, DROP_SOURCES[source], wave);
      a.run.collect({ items });
      if (items.length) this.rec.push(['u', 'loot', { kind: 'cache', name: items.length === 1 ? items[0].name : `${items.length} items`, rarity: items[0].rarity, level: items[0].level, category: items[0].category, count: items.length }], a.id);
      a.inventoryDirty = true;
    }
    return [];
  }

  private rollFor(a: Avatar, src: DropSource, wave: number): ItemInstance[] {
    const table = this.dropChanceMult === 1 ? src : { ...src, chance: Math.min(1, src.chance * this.dropChanceMult) };
    const ctx = { wave, tierLevelBonus: this.cfg.tier.lootLevelBonus, tierLuck: this.cfg.tier.lootLuck };
    return rollDrops(table, ctx, a.rand).map((d) =>
      generateItem({ uid: `${this.team.id}.${a.slot}.${++a.lootCounter}`, seed: d.seed, level: d.level, rarity: d.rarity, category: d.category, baseId: d.baseId, allowExclusive: d.baseId ? [d.baseId] : [], source: this.team.id }),
    );
  }

  dropLoot(source: DropSourceId, at: Vector3, wave = this.waves.number): Pickup[] {
    this.dropFrom(DROP_SOURCES[source], at, wave);
    return [];
  }

  dropFrom(src: DropSource, at: Vector3, wave = this.waves.number): Pickup[] {
    for (const a of this.avatars) {
      if (a.left) continue;
      for (const item of this.rollFor(a, src, wave)) this.placeFor(a, item, at, wave);
    }
    return [];
  }

  private placeFor(a: Avatar, item: ItemInstance, at: Vector3, wave: number): void {
    if (convertsToSalvage(a.pickups.size, item.rarity)) {
      const v = scrapValue(item);
      a.run.collect({ salvage: v });
      this.rec.push(['u', 'salvageGained', v], a.id);
      this.dropsConverted++;
      return;
    }
    const ground = this.groundPoint(at);
    const p: ServerPickup = { id: this.pickupSeq++, owner: a.id, item, ground, wave, readyAt: this.clock + 0.9 };
    a.pickups.set(p.id, p);
    this.dropsSpawned++;
    this.rec.push(['L+', p.id, item, arr(at), arr(ground), wave], a.id);
  }

  /** Lifetime rule per player (same as solo): drops from wave N expire when N+2 is cleared. */
  private expireLoot(cleared: number): void {
    for (const a of this.avatars) {
      for (const p of [...a.pickups.values()]) {
        if (expiresAfterWave(p.wave) <= cleared) {
          a.pickups.delete(p.id);
          this.dropsExpired++;
          this.rec.push(['L-', p.id, 1], a.id);
        }
      }
    }
  }

  // ------------------------------------------------------------------ input from clients

  /** Movement state (client-predicted, server-validated). */
  onInput(a: Avatar, m: InputMsg): void {
    if (m.seq <= a.lastSeq) return;
    a.lastSeq = m.seq;
    const to = new Vector3(m.p[0], m.p[1], m.p[2]);
    const dt = Math.max(1 / 60, this.clock - a.lastT);
    a.lastT = this.clock;
    a.player.yaw = m.yaw;
    a.pitch = m.pitch;
    a.heat = Math.max(0, Math.min(1, m.heat));
    a.flags = m.fl;
    a.speed = m.sp;
    if (a.player.alive) {
      const inside = Math.abs(to.x) < 140 && Math.abs(to.z) < 140 && to.y > -6 && to.y < 40;
      const d = Vector3.Distance(to, a.lastPos);
      if (!inside || d > MAX_SPEED * dt + 2.5) {
        this.rejected.moves++;
        this.rec.push(['mv', arr(a.lastPos)], a.id);
      } else {
        a.lastPos.copyFrom(to);
        a.player.controller.setPosition(to);
      }
      a.player.camera.position.set(a.lastPos.x, a.lastPos.y + 0.55, a.lastPos.z);
      a.player.camera.rotation.set(a.pitch, a.player.yaw, 0);
      if (m.fl & 16) this.as(a, () => this.director.bus.emit({ type: 'dash', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: 'dash' }, value: 1 }));
    }
    for (const s of m.shots ?? []) this.shot(a, s);
  }

  /**
   * A shot claim: the client says where it fired and which enemies its ray met. The server checks
   * timing (fire-rate budget), origin, range, line of sight and that each claimed point is on that
   * enemy (with a latency allowance), then computes damage itself from the player's loadout.
   */
  shot(a: Avatar, s: ShotClaim): void {
    const def = a.weaponDef;
    if (!a.player.alive || s.f !== def.family) {
      this.rejected.shots++;
      return;
    }
    if (a.budget < 1) {
      this.rejected.shots++;
      return;
    }
    a.budget -= 1;
    const o = new Vector3(s.o[0], s.o[1], s.o[2]);
    const eye = a.player.camera.position;
    if (Vector3.Distance(o, eye) > 3.5) {
      this.rejected.shots++;
      return;
    }
    const st = a.stats;
    const range = def.range * st.rangeMult;
    const thermal = 1 + st.heatDamage * Math.max(0, Math.min(1, s.h));
    const power = def.family === 'rail' ? Math.max(0.3, Math.min(1, s.pw)) : 1;
    let dmg = def.damage * st.weaponDamageMult * power * thermal;
    const maxHits = def.family === 'rail' ? 1 + def.pierce + Math.floor(st.pierce) : def.family === 'beam' ? 1 : 1 + Math.floor(st.pierce);
    this.as(a, () => {
      this.director.bus.emit({ type: 'fire', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: def.family }, value: 1 });
      const end = s.hits.length ? [s.hits[0][2], s.hits[0][3], s.hits[0][4]] : arr(o.add(new Vector3(s.d[0], s.d[1], s.d[2]).scale(Math.min(range, 60))));
      if (def.family !== 'beam' || (this.clock * 15) % 3 < 1) this.rec.pushExcept(['shot', a.id, def.family, end], a.id);
      let n = 0;
      for (const h of s.hits) {
        if (n >= maxHits) break;
        const e = this.enemies.active.find((x) => x.id === h[0]);
        const point = new Vector3(h[2], h[3], h[4]);
        if (!e || !e.alive || !this.validHit(a, e, o, point, range, h[1] === 1)) {
          this.rejected.hits++;
          continue;
        }
        let amount = dmg;
        if (def.family === 'beam') {
          // Server-side ramp: sustained contact on one target.
          if (a.beamTarget === e.id && this.clock - a.beamT < 0.25) a.beamT = this.clock;
          else {
            a.beamTarget = e.id;
            a.beamT = this.clock;
            e.ai.__rampStart = this.clock;
          }
          const held = this.clock - ((e.ai.__rampStart as number) ?? this.clock);
          amount *= Math.min(def.rampMax || 1, 1 + held * 0.6 * st.chargeRateMult);
        }
        const before = this.director.dealt.player;
        this.damageEnemy('player', e, amount, point, h[1] === 1 && this.weakAt(e, point), undefined, def.family as WeaponFamily, o);
        a.damage += this.director.dealt.player - before;
        dmg *= 0.85;
        n++;
      }
    });
  }

  private validHit(a: Avatar, e: Enemy, o: Vector3, p: Vector3, range: number, _weak: boolean): boolean {
    if (Vector3.Distance(o, p) > range + 2) return false;
    const c = e.center(new Vector3());
    const reach = e.def.bodyR * e.def.scale + e.def.radius + 2.2 + e.def.speed * e.moveMult * 0.35;
    if (Vector3.Distance(c, p) > Math.max(reach, e.def.topY + 1.5)) return false;
    // Line of sight from the muzzle to just short of the point.
    const dir = p.subtract(o);
    const len = dir.length();
    if (len > 1.2 && !this.los(o, o.add(dir.scale((len - 1) / len)))) return false;
    void a;
    return true;
  }

  private weakAt(e: Enemy, p: Vector3): boolean {
    for (const h of e.hitboxes) {
      const meta = h.metadata as EnemyHitboxMeta | null;
      if (!meta?.weak) continue;
      h.computeWorldMatrix(true);
      const r = h.getBoundingInfo().boundingSphere.radiusWorld;
      if (Vector3.Distance(h.getAbsolutePosition(), p) <= r + 0.7) return true;
    }
    return false;
  }

  /** Actions (towers, tactical, loot, upgrades, votes, run equipment). Returns a reason on refusal. */
  act(a: Avatar, m: ActMsg): string | null {
    const why = this.as(a, () => this.actInner(a, m));
    if (why) this.rejected.acts++;
    return why;
  }

  /** Test servers only (RIFT_TEST=1). */
  testMode = false;

  private actInner(a: Avatar, m: ActMsg): string | null {
    if (this.defeated) return 'The operation is over';
    switch (m.a) {
      case 'test': {
        if (!this.testMode) return 'Not a test server';
        if (m.op === 'killAll') {
          for (const e of [...this.enemies.active]) if (e.alive && e.def.role !== 'boss') this.damageEnemy('player', e, 1e7, e.center(), false, undefined, 'plasma', a.player.eye);
        } else if (m.op === 'clear') {
          // Finish the wave: spawn everything left, then kill it all through the real pipeline.
          for (let i = 0; i < 400 && this.waves.phase === 'combat'; i++) {
            this.waves.update(1, 1);
            for (const e of [...this.enemies.active]) if (e.alive) this.damageEnemy('player', e, 1e9, e.center(), false, undefined, 'plasma', a.player.eye);
          }
        } else if (m.op === 'jump') this.devJump(m.n ?? 5);
        else if (m.op === 'boss') this.devForce({ boss: 'colossus' });
        else if (m.op === 'reactor') this.debugDamageReactor(m.n ?? 100);
        return null;
      }
      case 'place': {
        const cfg = m.cfg as TowerConfig;
        for (const slot of ['base', 'weapon', 'core', 'modifier'] as const) {
          const d = partDef(slot, cfg[slot]);
          if (!d) return 'Unknown component';
          if (d.tech && !this.towerTech.has(`${slot}:${cfg[slot]}`)) return 'Blueprint not researched';
          if (slot !== 'base' && canInstall(cfg, slot, cfg[slot])) return canInstall(cfg, slot, cfg[slot]);
        }
        if (!a.player.alive) return 'Destroyed drones cannot build';
        const v = this.construction.validateAt(m.p[0], m.p[2], cfg, a.player.position, this.wallet.cores, this.turrets.turrets, this.stats);
        if (v.reason !== 'ok') return placementText(v.reason);
        const cost = configCost(cfg, this.stats.buildCostMult);
        if (!this.wallet.spend(cost)) return `Not enough cores (need ${cost})`;
        const t = this.turrets.add(v.point, m.yaw, this.turretCtx, cfg);
        t.paid = cost;
        (t as Turret & { owner?: string }).owner = a.id;
        this.turretsBuilt++;
        this.rec.push(['T+', t.id, cfg, arr(t.pos), Math.round(m.yaw * 1000) / 1000, a.id, a.name]);
        this.fx.burst('build', v.point.add(new Vector3(0, 0.5, 0)), 40);
        return null;
      }
      case 'recycle': {
        const t = this.turrets.byId(m.tower);
        if (!t) return 'Tower no longer exists';
        if (Vector3.Distance(t.pos, a.player.position) > 34) return 'Too far away';
        const refund = Math.round(t.paid * t.refundRatio);
        this.wallet.earn(refund);
        this.fx.burst('build', t.head, 30);
        this.fx.debrisBurst(t.head, 6, 4, 0.8);
        this.turrets.remove(t);
        this.rec.push(['T-', t.id]);
        this.rec.push(['u', 'coresGained', refund], a.id);
        sfx.play('recycle');
        return null;
      }
      case 'modify': {
        const t = this.turrets.byId(m.tower);
        if (!t) return 'Tower no longer exists';
        const r = this.modifyTower(t, m.what, m.id);
        if (!r.ok) return r.reason;
        this.rec.push(['Tc', t.id, t.config, t.level]);
        return null;
      }
      case 'tactical': {
        const was = this.tactical.active;
        if (!this.tactical.toggle()) return 'Tactical energy too low';
        if (this.tactical.active && !was) {
          sfx.play('tacticalOn');
          this.rec.push(['u', 'alert', { text: `TACTICAL TIME · ${a.name.toUpperCase()}`, tone: 'blue' }]);
        } else sfx.play('tacticalOff');
        return null;
      }
      case 'startWave':
        if (this.waves.phase !== 'prep') return 'The wave is already under way';
        if (this.offer) return 'Choose the team upgrade first';
        if (this.voteOpen) return 'The checkpoint vote is still open';
        this.startWave();
        return null;
      case 'collect': {
        const p = a.pickups.get(m.pickup);
        if (!p) return 'Not your pickup';
        if (this.clock < p.readyAt) return 'Still landing';
        if (!a.player.alive) return 'Drone destroyed';
        if (Vector3.Distance(p.ground, a.player.position) > PICKUP_RANGE + 2.5) return 'Too far away';
        if (!a.inventory.collect(p.item)) return 'Cargo hold full';
        a.pickups.delete(p.id);
        a.inventoryDirty = true;
        this.rec.push(['L-', p.id, 0], a.id);
        this.rec.push(['u', 'loot', { kind: 'pickup', name: p.item.name, rarity: p.item.rarity, level: p.item.level, category: p.item.category, count: 1 }], a.id);
        return null;
      }
      case 'upgrade': {
        if (!this.offer) return 'No upgrade on offer';
        if (this.offerChooser !== a.id) return 'Another warden is choosing this upgrade';
        if (!this.offer.some((u) => u.id === m.id)) return 'Not on offer';
        this.applyTeamUpgrade(m.id, a.name);
        return null;
      }
      case 'vote':
        if (!this.voteOpen) return 'No vote open';
        a.vote = m.home;
        this.rec.push(['u', 'alert', { text: `${a.name.toUpperCase()} VOTES ${m.home ? 'RETURN TO HQ' : 'CONTINUE'}`, tone: 'white' }]);
        this.checkVote();
        return null;
      case 'equip':
      case 'unequip':
      case 'discard': {
        const allowed = this.waves.phase === 'prep';
        if (m.a === 'discard') {
          if (!a.inventory.discard(m.uid, allowed)) return 'Only unsecured items, during preparation';
        } else if (m.a === 'equip') {
          const slot = m.slot && (SLOT_IDS as readonly string[]).includes(m.slot) ? (m.slot as SlotId) : undefined;
          const r = a.inventory.equip(m.uid, allowed, slot);
          if (r !== 'ok') return 'Cannot equip now (preparation only)';
        } else {
          if (!(SLOT_IDS as readonly string[]).includes(m.slot)) return 'Unknown slot';
          const r = a.inventory.unequip(m.slot as SlotId, allowed);
          if (r !== 'ok') return 'Cannot unequip now';
        }
        a.inventoryDirty = true;
        this.rebuildStats();
        return null;
      }
    }
  }

  // ------------------------------------------------------------------ team upgrades + checkpoint vote

  /** Between waves: one shared offer, the choice rotates between connected players (30 s, then auto). */
  openUpgrade(): void {
    this.upgradeDue = false;
    const offer = this.director.build.nextOffer(this.offerContext);
    if (!offer.length) return this.openVoteIfCheckpoint();
    this.offer = offer;
    const live = this.avatars.filter((a) => a.active);
    const chooser = live.length ? live[(this.waves.number - 2 + live.length * 10) % live.length] : null;
    this.offerChooser = chooser?.id ?? null;
    this.offerDeadline = this.clock + 30;
    this.rec.push(['offer', offer.map((u) => u.id), this.offerChooser, chooser?.name ?? '', 30]);
    sfx.play('bank', { pitch: 1.4, volume: 0.6 });
  }

  private applyTeamUpgrade(id: string, by: string): void {
    const def = upgradeDef(id)!;
    if (!this.director.takeUpgrade(id)) return;
    this.offer = null;
    this.offerChooser = null;
    this.rec.push(['up', id, by]);
    uiEvents.emit('banner', { title: def.name.toUpperCase(), sub: `${by} chose · ${def.text(this.director.build.count(id))}`, tone: def.rarity === 'legendary' ? 'orange' : 'cyan' });
    this.openVoteIfCheckpoint();
  }

  private openVoteIfCheckpoint(): void {
    if (!this.checkpointOpen || !this.team.atCheckpoint) return;
    this.voteOpen = true;
    this.voteDeadline = this.clock + 45;
    for (const a of this.avatars) a.vote = null;
    this.rec.push(['vote', 1]);
  }

  /** Unanimous "return home" among connected players extracts; any "continue" (or the timeout) continues. */
  private checkVote(): void {
    const live = this.avatars.filter((a) => a.active);
    if (!live.length) return;
    if (live.some((a) => a.vote === false)) return this.closeVote(false);
    if (live.every((a) => a.vote === true)) this.closeVote(true);
  }

  private closeVote(home: boolean): void {
    if (!this.voteOpen) return;
    this.voteOpen = false;
    this.rec.push(['vote', 0, home ? 1 : 0]);
    if (home) this.sh.extract();
    else uiEvents.emit('banner', { title: 'OPERATION CONTINUES', sub: 'The team stays deployed', tone: 'cyan' });
  }

  // ------------------------------------------------------------------ simulation

  /** One authoritative step (60 Hz). */
  tick(dt: number): void {
    const prev = current;
    current = this.rec;
    try {
      this.clock += dt;
      this.serverUpdate(dt);
    } finally {
      current = prev;
    }
  }

  /** Run a message handler with this game's recorder current (presentation stays in this room). */
  within<T>(fn: () => T): T {
    const prev = current;
    current = this.rec;
    try {
      return fn();
    } finally {
      current = prev;
    }
  }

  private serverUpdate(dt: number): void {
    if (this.defeated) return;
    this.tactical.update(dt);
    const hdt = dt * this.tactical.hostileScale;
    this.cfg.run.tick(dt);
    // Bodies: vitals, respawns, shot budget refill.
    for (const a of this.avatars) {
      const pl = a.player;
      if (!a.active) continue;
      const was = pl.alive;
      pl.tickVitals(dt);
      if (was && !pl.alive) {
        a.deaths++;
        this.team.survival.deaths++;
        a.run.survival.deaths++;
        this.rec.push(['u', 'alert', { text: `${a.name.toUpperCase()} DOWN · RESPAWNING`, tone: 'red' }]);
      }
      if (!was && pl.alive) {
        a.lastPos.copyFrom(pl.position);
        this.rec.push(['mv', arr(pl.position)], a.id);
      }
      const rate = a.weaponDef.mechanism === 'beam' ? 16 : a.weaponDef.fireRate * a.stats.fireRateMult * Math.max(1, Math.floor(a.stats.projectiles)) * (a.weaponDef.mechanism === 'burst' ? 1.6 : 1.25) + 0.5;
      a.budget = Math.min(rate * 0.6 + 3, a.budget + rate * dt);
    }
    // Offers / votes hold the preparation countdown (never the combat).
    if (this.offer && this.clock > this.offerDeadline) this.applyTeamUpgrade(this.offer[0].id, 'Auto-select');
    if (this.voteOpen && this.clock > this.voteDeadline) this.closeVote(false);
    const hold = this.waves.phase === 'prep' && (!!this.offer || this.voteOpen);
    if (!hold) this.waves.update(dt, hdt);
    this.hostileT += hdt;
    this.enemies.update(hdt, this.enemyCtx, dt);
    this.ordnance.update(hdt, this.ordnanceCtx, this.hostileT);
    this.tele.update(hdt);
    this.dynamics.update(dt, hdt);
    this.survival.update(dt, hdt);
    this.watchBoss();
    this.turretCtx.stats = this.stats;
    this.turrets.update(dt, this.turretCtx);
    this.director.update(dt, hdt);
    this.updateProjectiles(hdt);
  }

  openCheckpoint(): void {
    this.openVoteIfCheckpoint();
  }

  onEnemyKilled(e: Enemy): void {
    const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
    if (a) a.kills++;
    super.onEnemyKilled(e);
  }

  /** Checkpoint: bank every player's own ledger into their own profile. */
  bankAll(wave: number): void {
    for (const a of this.avatars) {
      if (a.left) continue;
      const moved = a.run.bank(wave);
      if (!moved) continue;
      const ok = this.cfg.run.survival.dev ? false : this.sh.bank(a.id, wave, moved, this.team.survival.bossesKilled);
      a.inventoryDirty = true;
      this.rec.push(['bank', wave, ok ? 1 : 0, moved.salvage, moved.credits, moved.components, moved.items.length], a.id);
    }
  }

  private serverDefeat(): void {
    if (this.defeated) return;
    this.defeated = true;
    this.rec.push(['def']);
    this.sh.defeat();
  }

  /** Per-player result statistics folded into each ledger before finalize. */
  syncStats(): void {
    super.syncStats();
    for (const a of this.avatars) {
      const s = a.run.survival;
      const t = this.team.survival;
      Object.assign(s, { ...t, deaths: a.deaths, bosses: [...t.bosses], events: [...t.events], milestones: [...t.milestones], playerDamage: Math.round(a.damage), towerDamage: t.towerDamage });
    }
  }

  // ------------------------------------------------------------------ snapshots

  private lastAi = new Map<number, Record<string, unknown>>();

  /** Shared world state (20 Hz). Enemy AI fields are sent as deltas; `full` resends everything. */
  netSnapshot(full = false): Record<string, unknown> {
    const w = this.waves;
    const enemies: unknown[] = [];
    const seen = new Set<number>();
    for (const e of this.enemies.active) {
      seen.add(e.id);
      const st = e.status;
      const prev = full ? undefined : this.lastAi.get(e.id);
      const ai: Record<string, unknown> = {};
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e.ai)) {
        if (k.startsWith('__') || !(typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) continue;
        const q = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
        next[k] = q;
        if (!prev || prev[k] !== q) ai[k] = q;
      }
      this.lastAi.set(e.id, next);
      enemies.push([
        e.id,
        Math.round(e.pos.x * 100) / 100,
        Math.round(e.pos.y * 100) / 100,
        Math.round(e.pos.z * 100) / 100,
        Math.round(e.yaw * 1000) / 1000,
        Math.round(e.hp),
        Math.round(e.maxHp),
        Math.round(e.shield),
        Math.round(e.armor),
        e.state === 'attack' ? 1 : 0,
        Math.round(e.chargeT * 100) / 100,
        Math.round(e.buffT * 10) / 10,
        Math.round(e.boostT * 10) / 10,
        Math.round(e.dischargeWind * 100) / 100,
        [st.burnStacks, Math.round(st.chill), st.frozenT > 0 ? 1 : 0, st.shockT > 0 ? 1 : 0],
        Object.keys(ai).length ? ai : 0,
        e.seg,
      ]);
    }
    for (const id of [...this.lastAi.keys()]) if (!seen.has(id)) this.lastAi.delete(id);
    return {
      t: Math.round(this.clock * 1000) / 1000,
      w: [w.number, w.phase, Math.round(Math.max(0, w.timer) * 10) / 10, w.enemiesLeft, w.remainingToSpawn],
      r: Math.round(this.reactorHp),
      c: this.wallet.cores,
      tac: [Math.round(this.tactical.energy), this.tactical.active ? 1 : 0, Math.round(this.tactical.hostileScale * 100) / 100],
      e: enemies,
      a: this.avatars.filter((a) => !a.left).map((a) => [
        a.id,
        ...arr(a.player.position),
        Math.round(a.player.yaw * 1000) / 1000,
        Math.round(a.pitch * 1000) / 1000,
        Math.round(a.player.hp),
        Math.round(a.player.maxHp),
        Math.round(a.player.shield),
        Math.round(a.player.maxShield),
        a.player.alive ? 1 : 0,
        Math.round(a.player.respawnT * 10) / 10,
        a.player.respawns,
        a.flags,
        Math.round(a.heat * 100) / 100,
        a.weaponDef.family,
        a.connected ? 1 : 0,
        Math.round(a.speed * 10) / 10,
        a.vote === null ? -1 : a.vote ? 1 : 0,
        a.name,
      ]),
      tw: this.turrets.turrets.map((t) => [t.id, Math.round(t.yaw * 1000) / 1000, Math.round(t.pitch * 1000) / 1000, t.disabled ? 1 : 0, t.empowered ? 1 : 0, t.building ? 1 : 0, t.kills, Math.round(t.damageDealt)]),
      tl: this.tele.followed().map((x) => x.map((v) => Math.round(v * 100) / 100)),
      or: this.ordnance.positions().map((x) => x.map((v) => Math.round(v * 100) / 100)),
      sv: enc(this.survival.hud()),
      boss: this.bossHudData(),
      cp: [this.checkpointOpen ? 1 : 0, this.team.atCheckpoint ? 1 : 0, this.voteOpen ? 1 : 0, Math.round(Math.max(0, this.voteDeadline - this.clock))],
      of: this.offer ? [this.offer.map((u) => u.id), this.offerChooser, Math.round(Math.max(0, this.offerDeadline - this.clock))] : 0,
      ups: this.director.build.total,
      ht: Math.round(this.hostileT * 100) / 100,
    };
  }

  private bossHudData(): unknown {
    const b = this.enemies.active.find((e) => e.def.role === 'boss' && e.alive);
    return b ? enc(this.bossHud(b)) : 0;
  }

  /** Personal state for one player (inventory/ledger only when changed). */
  personal(a: Avatar): Record<string, unknown> {
    const out: Record<string, unknown> = { seq: a.lastSeq, run: ledgerView(a.run) };
    if (a.inventoryDirty) {
      a.inventoryDirty = false;
      out.inv = { loadout: a.inventory.loadout, items: a.inventory.entries().map((e) => e.item), status: Object.fromEntries(a.inventory.entries().map((e) => [e.item.uid, e.status])), cargo: a.inventory.cargoUsed, cap: a.inventory.cargoCapacity };
      out.st = a.stats;
    }
    return out;
  }
}

function laneOf(e: Enemy): string {
  for (const [gate, r] of Object.entries(ARENA.routes)) {
    const p = r.points[r.points.length - 1];
    const q = e.path[e.path.length - 1];
    if (q && Math.hypot(p.x - q.x, p.z - q.z) < 3) return gate;
  }
  return 'north';
}

export function ledgerView(r: RunLedger) {
  return {
    su: r.unsecured.salvage,
    ss: r.secured.salvage,
    cu: r.unsecured.credits,
    cs: r.secured.credits,
    ku: r.unsecured.components,
    ks: r.secured.components,
    iu: r.unsecured.items.length,
    is: r.secured.items.length,
    wc: r.wavesCleared,
    lb: r.lastBankedWave,
    k: r.kills,
    d: Math.round(r.duration),
  };
}

function placementText(reason: string): string {
  const map: Record<string, string> = {
    'no-surface': 'No buildable surface there',
    lane: 'Too close to an enemy lane',
    overlap: 'Overlaps another tower',
    reactor: 'Too close to the reactor',
    range: 'Out of build range',
    cores: 'Not enough cores',
    slope: 'Surface too steep',
    uneven: 'Uneven ground',
    reserved: 'Reserved facility area',
  };
  return map[reason] ?? `Cannot build here (${reason})`;
}

export { isCheckpointWave };
