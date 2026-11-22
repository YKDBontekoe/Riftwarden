import { treeModifiers, treeRules } from '@riftwarden/rules/progression/skilltree';
import { TeamLedger } from '@riftwarden/rules/net/teamLedger';
import { SCATTER_PELLETS } from '../combat/Weapon';
import { type AbstractEngine as Engine } from '@babylonjs/core/Engines/abstractEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { sfx } from '../audio/Sfx';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { DAMAGE_PACE } from '@riftwarden/rules/combat/heat';
import { BASE_STATS, type CombatStats, computeStats, STAT_DEFS, type StatModifier } from '@riftwarden/rules/combat/stats';
import { type ArenaConfig, Game } from '../core/Game';
import type { Input } from '../core/Input';
import type { Settings } from '../core/settings';
import type { WeaponDef, WeaponFamily } from '@riftwarden/rules/data/defs';
import { type Enemy, type EnemyHitboxMeta } from '../enemies/EnemyManager';
import { DROP_SOURCES, type DropSource, type DropSourceId } from '@riftwarden/rules/loot/drops';
import { rollLoot } from '@riftwarden/rules/loot/roll';
import { gearUniques } from '@riftwarden/rules/loot/uniques';
import { equipmentModifiers, weaponDefFor } from '@riftwarden/rules/loot/equipment';
import { otherSlot, type WeaponSlot } from '../arena/WeaponSlots';
import { Abilities } from '../arena/Abilities';
import { hashSeed } from '@riftwarden/rules/loot/generate';
import { convertsToSalvage, expiresAfterWave, PICKUP_RANGE, type Pickup } from '../loot/LootField';
import { scrapValue } from '@riftwarden/rules/loot/economy';
import { RunInventory } from '@riftwarden/rules/loot/runInventory';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { MOVE, Player } from '../player/Player';
import { SLOT_IDS, type SlotId } from '@riftwarden/rules/progression/items';
import { type Rewards, RunLedger } from '@riftwarden/rules/progression/run';
import { isCheckpointWave } from '@riftwarden/rules/progression/tiers';
import { upgradeDef } from '@riftwarden/rules/roguelite/upgrades';
import { canInstall, configCost, partDef, type TowerConfig } from '@riftwarden/rules/towers/components';
import type { Turret } from '../defense/Turrets';
import { uiEvents } from '../ui/store';
import { ARENA, type ArenaLayout } from '@riftwarden/rules/world/layout';
import type { ActMsg, InputMsg, ShotClaim } from '@riftwarden/protocol/protocol';
import { capturePresentation, enterRecorder, patchGlobals, Recorder, withRecorder } from './recorder';
export { Recorder, type NetEvent } from './recorder';
import { arr, enc } from './wire';
import { resolveMapVote, voteComplete } from '@riftwarden/rules/net/mapVote';
import { KIT } from '@riftwarden/rules/player/movement';
import { PositionTrail, SAMPLE_S } from '@riftwarden/rules/net/lagComp';

export interface ServerPlayerInit {
  id: string;
  name: string;
  slot: number;
  loadout: Partial<Record<SlotId, ItemInstance | null>>;
  ledger: RunLedger;
  /** The player's skill tree (personal stats; tower stats are shared 1/n like tower gear). */
  tree?: { seed: number; allocated: readonly string[] };
  /** Run map: the run loadout carried from the previous node (uids). */
  restore?: Record<string, string | null>;
  /** Run map: ultimate charge carried from the previous node. */
  ult?: number;
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
  /** Equipped unique gear effects (rebuilt with the stats). */
  uniques: ReadonlySet<string> = new Set();
  weaponDef: WeaponDef;
  /** Weapon in hand: only its affixes/modules count, claims must match its family. */
  activeWeapon: WeaponSlot = 'weapon';
  /** Ability I/II and ultimate (swapped into the game by `as`, so damage charges this player's ultimate). */
  abilities!: Abilities;
  rand: () => number;
  lootCounter = 0;
  connected = true;
  left = false;
  lastSeq = -1;
  lastT = 0;
  readonly lastPos = new Vector3();
  /** Server clock of the last accepted ground pound. */
  lastPound = -99;
  /** Shot budget (token bucket refilled at the weapon's rate). */
  budget = 4;
  heat = 0;
  flags = 0;
  speed = 0;
  pitch = 0;
  vote: boolean | null = null;
  /** Run map vote: a node id or 'home' (null = not voted). */
  mapVote: string | null = null;
  readonly pickups = new Map<number, ServerPickup>();
  kills = 0;
  damage = 0;
  deaths = 0;
  /** Permanent skill tree modifiers of this player. */
  treeMods: StatModifier[] = [];
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
    const sp = spawnFor(slot, game.layout);
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
export function spawnFor(slot: number, layout: ArenaLayout = ARENA): { x: number; z: number; yaw: number } {
  const s = layout.playerSpawn;
  const off = [0, 2.2, -2.2, 4.4][slot] ?? 0;
  return { x: s.x + Math.cos(s.yaw) * off, z: s.z - Math.sin(s.yaw) * off, yaw: s.yaw };
}


export interface ServerHooks {
  /** Persist a player's banked rewards. Returns true once written. */
  bank(playerId: string, wave: number, rewards: Rewards, bosses: number): Promise<boolean>;
  /** Reactor destroyed. */
  defeat(): void;
  /** Unanimous extraction vote at a checkpoint (or a map vote nobody spent on a node). */
  extract(): void;
  /** Run map: the team travels to `node`; `home` wardens extract on their own. */
  travel?(node: string, home: string[]): void;
  /** Run map: an act boss fell. */
  actCleared?(act: number): void;
  /** Run map: nodes the team can travel to now. */
  reachable?(): string[];
  /** Run map: the lobby host (breaks vote ties). */
  hostId?(): string | null;
  /** Run map: a combat sector was secured (the shared war counts it). */
  secured?(nodeId: string): void;
}

/** Fastest legitimate drone speed (a dash) plus slack for jitter; the 2.5 m per-packet allowance covers the rest. */
const MAX_SPEED = MOVE.dashSpeed + 4;
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
  private banking: Promise<void> | null = null;
  voteDeadline = 0;
  clock = 0;
  defeated = false;
  /** Statistics: rejected claims (tests / diagnostics). */
  rejected = { shots: 0, hits: 0, moves: 0, acts: 0 };
  /** Recent positions per hostile (lag compensation of shot claims), keyed by id; `gen` tells pooled reuse apart. */
  private trails = new Map<number, { gen: number; trail: PositionTrail }>();
  private trailT = 0;
  /** Rejection reasons (diagnostics). */
  why: Record<string, number> = {};
  private reject(kind: 'shots' | 'hits' | 'moves', why: string): void {
    this.rejected[kind]++;
    this.why[why] = (this.why[why] ?? 0) + 1;
  }

  constructor(engine: Engine, havok: unknown, players: ServerPlayerInit[], cfg: Omit<ArenaConfig, 'hooks' | 'loadout' | 'run'> & { runId: string }, hooks: ServerHooks) {
    patchGlobals();
    const team = new TeamLedger(cfg.runId, cfg.tier.id, Date.now());
    const canvas = { focus() {}, clientWidth: 1280, clientHeight: 720 } as unknown as HTMLCanvasElement;
    const input = { onLockChange: null, captured: false, locked: false, pressed: () => false, isDown: () => false, mouse: () => false, mousePressed: () => false, mouseDx: 0, mouseDy: 0, releaseLock() {}, requestLock: async () => true, isLockedNow: () => false } as unknown as Input;
    const settings = { quality: 'low', sensitivity: 1, fov: 90, volume: 0 } as unknown as Settings;
    const rec = new Recorder();
    rec.paused++;
    const box: { g?: ServerGame } = {};
    const prev = enterRecorder(rec);
    try {
      super(engine, canvas, havok, settings, input, {
        ...cfg,
        loadout: players[0].loadout,
        run: team,
        hooks: { bank: () => true, checkpoint: () => {}, defeat: () => box.g?.serverDefeat(), actCleared: (n) => box.g?.sh.actCleared?.(n), nodeSecured: (id) => box.g?.sh.secured?.(id) },
      });
    } finally {
      enterRecorder(prev);
    }
    box.g = this;
    (this as { rec: Recorder }).rec = rec;
    // One hostile clock for the whole team: per-kill hitstop would slow the fight for everyone.
    this.hitstopEnabled = false;
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
    // Deployables are shared world objects: replicate them (sentries as towers that the server removes).
    this.deployables.onPlaced = (kind, at, yaw, seconds, size) => this.rec.push(['dp', kind, arr(at), Math.round(yaw * 1000) / 1000, seconds, size]);
    this.deployables.onSentry = (t, added) => {
      if (!added) return this.rec.push(['T-', t.id]);
      const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
      this.rec.push(['T+', t.id, t.config, arr(t.pos), Math.round(t.yaw * 1000) / 1000, a?.id ?? '', a?.name ?? '']);
      this.rec.push(['dp', 'sentry', arr(t.pos), 0, t.expiresT, t.id]);
    };
    capturePresentation(this, this.rec);
    // Headless: nothing renders, so world matrices of the static level are computed once here (picking needs them).
    for (const m of this.scene.meshes) m.computeWorldMatrix(true);
    this.setScreen('playing');
    this.rec.paused = 0;
  }

  addAvatar(p: ServerPlayerInit): Avatar {
    const a = new Avatar(p.id, p.name, p.slot, this, p.loadout, p.ledger);
    if (p.restore) a.inventory.adoptLoadout(p.restore);
    if (p.tree) {
      a.treeMods = treeModifiers(p.tree.seed, p.tree.allocated);
      p.ledger.xpMult = treeRules(p.tree.seed, p.tree.allocated).xpMult;
    }
    a.player.vitalsLocal = true;
    a.player.onHurt = (amount, from) => {
      const h = a.player.lastHit;
      this.rec.push(['h', Math.round(amount * 10) / 10, h.toHull > 0 ? 1 : 0, from ? arr(from) : null], a.id);
    };
    a.player.knockback = (dir: Vector3, strength: number) => this.rec.push(['k', arr(dir), strength], a.id);
    const g = this;
    a.abilities = new Abilities({
      get scene() { return g.scene; }, // prettier-ignore
      player: a.player,
      get director() { return g.director; }, // prettier-ignore
      get enemies() { return g.enemies; }, // prettier-ignore
      get fx() { return g.fx; }, // prettier-ignore
      get wfx() { return g.wfx; }, // prettier-ignore
      get weapon() { return g.weapon; }, // prettier-ignore
      inventory: a.inventory,
      get stats() { return a.stats; }, // prettier-ignore
      get deployables() { return g.deployables; }, // prettier-ignore
      owner: a.id,
      canAct: () => a.active && a.player.alive,
    });
    if (p.ult) a.abilities.ult = p.ult;
    this.avatars.push(a);
    this.rebuildStats();
    return a;
  }

  avatar(id: string): Avatar | undefined {
    return this.avatars.find((a) => a.id === id);
  }

  // ------------------------------------------------------------------ presentation capture

  /** Route the game's presentation objects into the recorder (the headless server renders nothing). */
  override get enemyFx() {
    return this.fx;
  }

  protected override weaponSignature(): string | null {
    const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
    return a ? a.inventory.equipped(a.activeWeapon)?.signature ?? null : null;
  }
  protected override equippedUniques(): ReadonlySet<string> {
    const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
    return a ? a.uniques : new Set();
  }
  protected override weaponHeat(): number {
    const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
    return a ? a.heat : 0;
  }

  protected override droneSpeed(): number {
    const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
    return a ? (a.flags & 1 ? 40 : a.speed) : 0;
  }

  override panFor(p: Vector3): { pan: number; volume: number } {
    this.rec.panPos = p.clone();
    return { pan: 0, volume: 1 };
  }

  /** Run `fn` with a player's presentation ownership and combat identity (stats, body). */
  private as<T>(a: Avatar, fn: () => T): T {
    const prevPlayer = this.player;
    const prevStats = this.stats;
    const prevOwner = this.rec.owner;
    const prevDef = this.weapon.def;
    const prevAbilities = this.abilities;
    this.abilities = a.abilities;
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
      this.abilities = prevAbilities;
    }
  }

  // ------------------------------------------------------------------ targeting

  override targets(): readonly Player[] {
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
    this.enemyCtx.player = this.deployables.decoyFor(e.pos) ?? body;
    (this as { player: Player }).player = body;
    // Survival: this machine's "reactor" is the warden it hunts.
    this.hunt?.aim(this.enemyCtx.player.position);
  }

  override hurtPlayer(amount: number, from: Vector3, target: Player = this.player): void {
    if (this.deployables.isDecoy(target)) return super.hurtPlayer(amount, from, target);
    const a = this.avatars.find((x) => x.player === target);
    if (!a || !a.active) return;
    this.rec.quiet(() => super.hurtPlayer(amount, from, target));
  }

  // ------------------------------------------------------------------ stats

  override rebuildStats(): void {
    if (!this.avatars) {
      super.rebuildStats();
      return;
    }
    const shared = [...this.modifiers, ...this.director.build.modifiers(), ...this.director.buffModifiers(null), ...(this.node?.mods() ?? [])];
    const live = this.avatars.filter((a) => !a.left);
    const n = Math.max(1, live.length);
    // Towers are shared: each player's tower gear contributes 1/n (a full team of tower builds = one full build).
    const towerGear: StatModifier[] = [];
    for (const a of live) {
      for (const m of [...equipmentModifiers(a.inventory.equippedItems(otherSlot(a.activeWeapon))), ...a.treeMods]) {
        if (!TOWER_KEYS.has(m.stat)) continue;
        towerGear.push({ ...m, value: m.op === 'mul' ? Math.pow(1 + m.value, 1 / n) - 1 : m.value / n });
      }
    }
    Object.assign(this.stats, computeStats([...towerGear, ...shared]));
    for (const a of this.avatars) {
      if (a.activeWeapon === 'weapon2' && !weaponDefFor(a.inventory.equipped('weapon2'))) a.activeWeapon = 'weapon';
      a.stats = computeStats([...equipmentModifiers(a.inventory.equippedItems(otherSlot(a.activeWeapon))), ...a.treeMods, ...shared, ...this.director.buffModifiers(a.id)]);
      a.player.applyStats(a.stats, this.attackerScale);
      a.uniques = gearUniques(a.inventory.equippedItems(otherSlot(a.activeWeapon)));
      a.weaponDef = weaponDefFor(a.inventory.equipped(a.activeWeapon)) ?? a.weaponDef;
    }
    this.player.applyStats(this.stats, this.attackerScale);
    this.tactical.rechargeMult = this.stats.tacticalRechargeMult;
    this.statsVersion++;
    this.turretCtx.statsVersion = this.statsVersion;
  }

  override refreshEquipment(): void {
    this.rebuildStats();
    this.inventoryVersion++;
  }

  // ------------------------------------------------------------------ loot (individual ownership)

  override rollItems(source: DropSourceId, wave = this.waves.number): ItemInstance[] {
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
    return rollLoot({ source: src, wave, tier: this.cfg.tier, rand: a.rand, nextUid: () => `${this.team.id}.${a.slot}.${++a.lootCounter}`, originId: this.team.id, chanceMult: this.dropChanceMult, faction: this.director.faction });
  }

  override dropLoot(source: DropSourceId, at: Vector3, wave = this.waves.number): Pickup[] {
    this.dropFrom(DROP_SOURCES[source], at, wave);
    return [];
  }

  override dropFrom(src: DropSource, at: Vector3, wave = this.waves.number): Pickup[] {
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
    const hot = Math.max(0, Math.min(1, m.heat));
    if (hot >= 0.99 && a.heat < 0.99) this.as(a, () => this.director.bus.emit({ type: 'overheat', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: 'heat' }, value: 1 }));
    a.heat = hot;
    a.flags = m.fl;
    a.speed = m.sp;
    if (a.player.alive) {
      const inside = Math.abs(to.x) < 140 && Math.abs(to.z) < 140 && to.y > -6 && to.y < 40;
      const d = Vector3.Distance(to, a.lastPos);
      if (!inside || d > MAX_SPEED * dt + 2.5) {
        this.reject('moves', inside ? 'move-speed' : 'move-bounds');
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
      this.reject('shots', a.player.alive ? `family ${s.f}/${def.family}` : 'dead');
      return;
    }
    if (a.budget < 1) {
      this.reject('shots', 'budget');
      return;
    }
    a.budget -= 1;
    const o = new Vector3(s.o[0], s.o[1], s.o[2]);
    const eye = a.player.camera.position;
    if (Vector3.Distance(o, eye) > 3.5) {
      this.reject('shots', 'origin');
      return;
    }
    const st = a.stats;
    const range = def.range * st.rangeMult;
    const thermal = 1 + st.heatDamage * Math.max(0, Math.min(1, s.h));
    const power = def.family === 'rail' ? Math.max(0.3, Math.min(1, s.pw)) : 1;
    let dmg = def.damage * DAMAGE_PACE * st.weaponDamageMult * power * thermal;
    const maxHits = def.family === 'rail' ? 1 + def.pierce + Math.floor(st.pierce) : def.family === 'beam' || def.family === 'swarm' ? 1 : 1 + Math.floor(st.pierce);
    this.as(a, () => {
      this.director.bus.emit({ type: 'fire', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: def.family }, value: 1 });
      const end = s.hits.length ? [s.hits[0][2], s.hits[0][3], s.hits[0][4]] : arr(o.add(new Vector3(s.d[0], s.d[1], s.d[2]).scale(Math.min(range, 60))));
      if (def.family !== 'swarm' && (def.family !== 'beam' || (this.clock * 15) % 3 < 1)) this.rec.pushExcept(['shot', a.id, def.family, end], a.id);
      let n = 0;
      for (const h of s.hits) {
        if (n >= maxHits) break;
        const e = this.enemies.active.find((x) => x.id === h[0]);
        const point = new Vector3(h[2], h[3], h[4]);
        const bad = !e ? 'hit-unknown' : !e.alive ? 'hit-dead' : this.invalidHit(e, o, point, range);
        if (bad || !e) {
          this.reject('hits', bad ?? 'hit-unknown');
          continue;
        }
        if (def.family === 'swarm') this.rec.pushExcept(['shot', a.id, def.family, arr(point), e.id], a.id);
        let amount = dmg;
        if (def.family === 'beam' && def.mechanism !== 'pulse') {
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
        if (def.mechanism === 'pulse') this.pulseSplash(point, amount, e);
        a.damage += this.director.dealt.player - before;
        dmg *= a.inventory.equipped(a.activeWeapon)?.signature === 'u_ninthgate' ? 1.2 : 0.85;
        n++;
      }
      if (def.family === 'swarm' && !n) this.rec.pushExcept(['shot', a.id, def.family, end], a.id);
    });
  }

  /** Sample every hostile's centre at the snapshot rate (what clients interpolate between). */
  private recordTrails(dt: number): void {
    this.trailT += dt;
    if (this.trailT < SAMPLE_S) return;
    this.trailT = 0;
    const live = new Set<number>();
    const c = new Vector3();
    for (const e of this.enemies.active) {
      live.add(e.id);
      let t = this.trails.get(e.id);
      if (!t || t.gen !== e.gen) this.trails.set(e.id, (t = { gen: e.gen, trail: new PositionTrail() }));
      e.center(c);
      t.trail.push(this.clock, c.x, c.y, c.z);
    }
    for (const id of this.trails.keys()) if (!live.has(id)) this.trails.delete(id);
  }

  private invalidHit(e: Enemy, o: Vector3, p: Vector3, range: number): string | null {
    if (Vector3.Distance(o, p) > range + 2) return 'hit-range';
    const c = e.center(new Vector3());
    // Lag compensation: the claimed point must be on the target where it was within the rewind window.
    const t = this.trails.get(e.id);
    const off = t && t.gen === e.gen ? t.trail.distance(p.x, p.y, p.z, [c.x, c.y, c.z]) : Vector3.Distance(c, p);
    const reach = e.def.bodyR * e.def.scale + e.def.radius + 1.4 + e.def.speed * e.moveMult * SAMPLE_S;
    if (off > Math.max(reach, e.def.topY + 1.5)) return 'hit-reach';
    // Line of sight from the muzzle to just short of the point.
    const dir = p.subtract(o);
    const len = dir.length();
    if (len > 1.2 && !this.los(o, o.add(dir.scale((len - 1) / len)))) return 'hit-los';
    return null;
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
        } else if (m.op === 'jump') this.dev.jump(m.n ?? 5);
        else if (m.op === 'boss') this.dev.force({ boss: 'colossus' });
        else if (m.op === 'reactor') this.debugDamageReactor(m.n ?? 100);
        else if (m.op === 'down') this.hurtPlayer(1e7, a.player.position.add(new Vector3(2, 0, 0)), a.player);
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
        if (this.hunt) return 'Survival: no towers';
        if (!a.player.alive) return 'Destroyed drones cannot build';
        const v = this.construction.validateAt(m.p[0], m.p[2], cfg, a.player.position, this.wallet.cores, this.turrets.turrets, this.stats);
        if (v.reason !== 'ok') return placementText(v.reason);
        const cost = configCost(cfg, this.stats.buildCostMult);
        if (!this.wallet.spend(cost)) return `Not enough cores (need ${cost})`;
        const t = this.turrets.add(v.point, m.yaw, this.turretCtx, cfg);
        t.paid = cost;
        t.rescaleHp(this.towerHpScale());
        (t as Turret & { owner?: string }).owner = a.id;
        this.turretsBuilt++;
        this.bumpStats();
        this.rec.push(['T+', t.id, cfg, arr(t.pos), Math.round(m.yaw * 1000) / 1000, a.id, a.name]);
        this.fx.burst('build', v.point.add(new Vector3(0, 0.5, 0)), 40);
        return null;
      }
      case 'recycle': {
        const t = this.turrets.byId(m.tower);
        if (!t) return 'Tower no longer exists';
        if (t.temporary) return 'Mini-sentries cannot be changed';
        if (Vector3.Distance(t.pos, a.player.position) > 34) return 'Too far away';
        const refund = t.recycleValue;
        this.wallet.earn(refund);
        this.fx.burst('build', t.head, 30);
        this.fx.debrisBurst(t.head, 6, 4, 0.8);
        this.turrets.remove(t);
        this.bumpStats();
        this.rec.push(['T-', t.id]);
        this.rec.push(['u', 'coresGained', refund], a.id);
        sfx.play('recycle');
        return null;
      }
      case 'repair': {
        const t = this.turrets.byId(m.tower);
        if (!t) return 'Tower no longer exists';
        if (t.temporary) return 'Mini-sentries cannot be changed';
        if (Vector3.Distance(t.pos, a.player.position) > 34) return 'Too far away';
        return this.wear.repair(t);
      }
      case 'modify': {
        const t = this.turrets.byId(m.tower);
        if (!t) return 'Tower no longer exists';
        if (t.temporary) return 'Mini-sentries cannot be changed';
        const r = this.modifyTower(t, m.what, m.part);
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
        if (this.banking) return 'The checkpoint is being saved';
        if (this.offer) return 'Choose the team upgrade first';
        if (this.voteOpen) return 'The checkpoint vote is still open';
        if (this.node?.complete) return 'This node is secured: vote on the run map';
        this.startWave();
        return null;
      case 'collect': {
        if (this.banking) return 'The checkpoint is being saved';
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
        if (!this.offer.some((u) => u.id === m.pick)) return 'Not on offer';
        this.applyTeamUpgrade(m.pick, a.name);
        return null;
      }
      case 'mapVote':
        return this.mapVoteAct(a, m.choice);
      case 'station':
        return this.stationAct(a, m.station, m.opt);
      case 'vote':
        if (this.node) return 'Vote on the run map';
        if (!this.voteOpen) return 'No vote open';
        a.vote = m.home;
        this.rec.push(['u', 'alert', { text: `${a.name.toUpperCase()} VOTES ${m.home ? 'RETURN TO HQ' : 'CONTINUE'}`, tone: 'white' }]);
        this.checkVote();
        return null;
      case 'swap': {
        if (m.slot === a.activeWeapon) return null;
        if (!weaponDefFor(a.inventory.equipped(m.slot))) return 'No weapon in that slot';
        a.activeWeapon = m.slot;
        this.rebuildStats();
        return null;
      }
      case 'ability': {
        const why = a.abilities.blocked(m.slot);
        if (why) return why;
        const before = a.player.position.clone();
        const ok = this.as(a, () => a.abilities.use(m.slot, new Vector3(m.o[0], m.o[1], m.o[2]), new Vector3(m.d[0], m.d[1], m.d[2])));
        if (!ok) return 'Ability unavailable';
        // Blink moves the server body: the owner's drone snaps to it.
        if (Vector3.Distance(before, a.player.position) > 0.5) {
          a.lastPos.copyFrom(a.player.position);
          this.rec.push(['mv', arr(a.player.position)], a.id);
        }
        return null;
      }
      case 'pound': {
        if (!a.player.alive) return 'Not in play';
        if (this.clock - a.lastPound < KIT.poundCooldown * 0.8) return 'Ground pound recharging';
        const at = new Vector3(m.p[0], m.p[1], m.p[2]);
        if (Vector3.Distance(at, a.lastPos) > 4) return 'Too far from the drone';
        a.lastPound = this.clock;
        // The fall is the client's claim: clamp it to the arena's height range.
        this.as(a, () => this.movement.blast(at, Math.max(0, Math.min(20, m.f)), a.player));
        return null;
      }
      case 'equip':
      case 'unequip':
      case 'discard': {
        const allowed = this.waves.phase === 'prep';
        if (m.a === 'discard') {
          if (this.banking) return 'The checkpoint is being saved';
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

  // ------------------------------------------------------------------ run map (co-op)

  /** A node station gives an item to the warden using it. */
  protected override nodeGrant(item: ItemInstance): boolean {
    const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
    if (!a || !a.inventory.collect(item)) return false;
    a.inventoryDirty = true;
    return true;
  }

  /** Headless: the map is a team vote (opened by the server), panels are client UI. */
  protected override nodeOpenMap(): void {}
  protected override nodeOpenPanel(): void {}

  /** Map vote opens once the node is secured (no guardians, offer or banking pending). Hubs: from the start. */
  private openMapVote(): void {
    const n = this.node;
    if (!n || this.voteOpen || this.banking || this.offer || this.upgradeDue || !n.complete || n.guardiansActive || (n.combat && !this.team.atCheckpoint)) return;
    this.voteOpen = true;
    // Combat nodes give the team a minute; hubs wait for the first vote (players are shopping).
    this.voteDeadline = n.combat ? this.clock + 60 : Infinity;
    for (const a of this.avatars) a.mapVote = null;
    this.rec.push(['vote', 2]);
  }

  protected mapVoteAct(a: Avatar, choice: string): string | null {
    if (!this.node || !this.voteOpen) return 'No map vote open';
    const reach = this.sh.reachable?.() ?? [];
    if (choice !== 'home' && !reach.includes(choice)) return 'That node is not reachable';
    a.mapVote = choice;
    if (this.voteDeadline === Infinity) this.voteDeadline = this.clock + 45;
    this.rec.push(['u', 'alert', { text: `${a.name.toUpperCase()} VOTES ${choice === 'home' ? 'EXTRACT' : 'TRAVEL'}`, tone: 'white' }]);
    this.checkMapVote(false);
    return null;
  }

  private checkMapVote(timeout: boolean): void {
    if (!this.voteOpen || !this.node || this.node.guardiansActive) return;
    const live = this.avatars.filter((a) => a.active);
    const votes = new Map(live.map((a) => [a.id, a.mapVote] as [string, string | null]));
    if (!timeout && !voteComplete(votes, live.map((a) => a.id))) return;
    const r = resolveMapVote(votes, this.sh.reachable?.() ?? [], this.sh.hostId?.() ?? null);
    this.voteOpen = false;
    this.rec.push(['vote', 0, r.travel ? 0 : 1]);
    if (r.travel) this.sh.travel?.(r.travel, r.home);
    else this.sh.extract();
  }

  protected stationAct(a: Avatar, station: string, opt: string): string | null {
    const n = this.node;
    if (!n) return 'No station here';
    if (!['merchant', 'forge', 'rest', 'event', 'vault'].includes(station) || station !== n.node.kind) return 'No such station on this node';
    if (!a.player.alive) return 'Drone destroyed';
    n.panelStation = station as 'merchant';
    const why = n.act(opt);
    a.inventoryDirty = true;
    return why;
  }

  /** Run map vote state for snapshots: open, seconds left, votes per warden. */
  private mapVoteNet(): unknown {
    if (!this.node) return 0;
    return [this.voteOpen ? 1 : 0, Number.isFinite(this.voteDeadline) ? Math.round(Math.max(0, this.voteDeadline - this.clock)) : -1, this.avatars.filter((a) => !a.left).map((a) => [a.id, a.mapVote ?? ''])];
  }

  // ------------------------------------------------------------------ team upgrades + checkpoint vote

  /** Between waves: one shared offer, the choice rotates between connected players (30 s, then auto). */
  override openUpgrade(): void {
    this.upgradeDue = false;
    // Team offer: per-player ability loadouts differ, so ability upgrades stay eligible (abilities unknown).
    const offer = this.director.build.nextOffer({ ...this.offerContext, abilities: undefined });
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
    if (this.node) return this.openMapVote();
    if (this.banking || this.voteOpen || !this.checkpointOpen || !this.team.atCheckpoint) return;
    this.voteOpen = true;
    this.voteDeadline = this.clock + 45;
    for (const a of this.avatars) a.vote = null;
    this.rec.push(['vote', 1]);
  }

  /** Unanimous "return home" among connected players extracts; any "continue" (or the timeout) continues. */
  private checkVote(): void {
    if (this.node) return this.checkMapVote(false);
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
    withRecorder(this.rec, () => {
      this.clock += dt;
      this.serverUpdate(dt);
    });
  }

  /** Run a message handler with this game's recorder current (presentation stays in this room). */
  within<T>(fn: () => T): T {
    return withRecorder(this.rec, fn);
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
      // Deaths happen anywhere (enemy updates, acts): compare with the state seen on the previous tick.
      const was = a.wasAlive;
      pl.tickVitals(dt);
      if (was && !pl.alive) {
        a.deaths++;
        this.team.survival.deaths++;
        a.run.survival.deaths++;
        // Survival: one life. A downed warden stays out until the team secures the node (revived on travel).
        if (this.hunt) pl.respawnT = Infinity;
        this.rec.push(['u', 'alert', { text: this.hunt ? `${a.name.toUpperCase()} IS DOWN · OUT FOR THIS NODE` : `${a.name.toUpperCase()} DOWN · RESPAWNING`, tone: 'red' }]);
        if (this.hunt && !this.avatars.some((x) => x.active && x.player.alive)) this.serverDefeat();
      }
      this.as(a, () => a.abilities.update(dt));
      if (!was && pl.alive) {
        a.lastPos.copyFrom(pl.position);
        this.rec.push(['mv', arr(pl.position)], a.id);
      }
      a.wasAlive = pl.alive;
      const wd = a.weaponDef;
      // Swarm: every drone is a claim (a full salvo releases up to 3x the launch count at once).
      const swarmK = wd.family === 'swarm' ? Math.max(1, wd.drones) * (wd.mechanism === 'salvo' ? 3 : 1) : 1;
      const rate = wd.mechanism === 'beam' ? 16 : wd.fireRate * a.stats.fireRateMult * Math.max(1, Math.floor(a.stats.projectiles)) * swarmK * (wd.mechanism === 'scatter' ? SCATTER_PELLETS + 2 : 1) * (wd.mechanism === 'burst' ? 1.6 : 1.25) + 0.5;
      a.budget = Math.min(rate * 0.6 + 3 + (wd.mechanism === 'scatter' ? SCATTER_PELLETS * 2 : 0) + (wd.family === 'swarm' ? swarmK * Math.max(1, Math.floor(a.stats.projectiles)) * 2 : 0), a.budget + rate * dt);
    }
    if (this.hunt) this.hunt.update(dt, this.enemies.nav, this.avatars.filter((a) => a.active && a.player.alive).map((a) => a.player.position));
    // Offers / votes hold the preparation countdown (never the combat).
    if (this.offer && this.clock > this.offerDeadline) this.applyTeamUpgrade(this.offer[0].id, 'Auto-select');
    if (this.voteOpen && this.clock > this.voteDeadline) {
      if (this.node) this.checkMapVote(true);
      else this.closeVote(false);
    }
    if (this.node) {
      this.node.update(dt, hdt, false, false);
      if (!this.voteOpen) this.openMapVote();
    }
    const hold = this.waves.phase === 'prep' && (!!this.offer || this.voteOpen || !!this.banking);
    if (!hold) this.waves.update(dt, hdt);
    this.hostileT += hdt;
    this.enemies.update(hdt, this.enemyCtx, dt);
    this.recordTrails(dt);
    // Hazards: patches and enemies once, the drone effects (slag burns) per avatar.
    if (this.hazards) {
      this.hazards.onAdd ??= (x, z, r, kind, life) => this.rec.push(['hz', Math.round(x * 100) / 100, Math.round(z * 100) / 100, r, kind, life]);
      this.hazards.decay(hdt, this.hostileT);
      this.hazards.affectEnemyList(dt);
      for (const a of this.avatars) if (a.active) this.as(a, () => this.hazards!.affectPlayer(dt));
    }
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

  /** Headless: no pointer lock, the simulation is always 'playing' (defeat, refits and offers depend on it). */
  override start(): void {
    this.newRun();
    this.setScreen('playing');
  }

  override openCheckpoint(): void {
    this.openVoteIfCheckpoint();
  }

  override onEnemyKilled(e: Enemy): void {
    const a = this.rec.owner ? this.avatar(this.rec.owner) : undefined;
    if (a) a.kills++;
    super.onEnemyKilled(e);
  }

  /** Checkpoint: bank every player's own ledger into their own profile. */
  bankAll(wave: number): void {
    const dev = this.cfg.run.survival.dev;
    this.syncStats();
    this.banking = Promise.all(this.avatars.filter((a) => !a.left).map(async (a) => {
      a.run.accrueXp();
      const moved = structuredClone(a.run.unsecured);
      const ok = !dev && await this.sh.bank(a.id, wave, moved, this.team.survival.bossesKilled);
      if (ok || dev) a.run.bank(wave);
      a.inventoryDirty = true;
      this.rec.push(['bank', wave, ok ? 1 : 0, moved.salvage, moved.credits, moved.components, moved.items.length], a.id);
    })).then(() => {
      this.banking = null;
      if (!this.offer && !this.upgradeDue) this.within(() => this.openVoteIfCheckpoint());
    });
  }

  async settleBanking(): Promise<void> {
    await this.banking;
  }

  private serverDefeat(): void {
    if (this.defeated) return;
    this.defeated = true;
    this.rec.push(['def']);
    this.sh.defeat();
  }

  /** Per-player result statistics folded into each ledger before finalize. */
  override syncStats(): void {
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
        // JSON has no Infinity: a survival warden who is out sends a long countdown.
        Number.isFinite(a.player.respawnT) ? Math.round(a.player.respawnT * 10) / 10 : 9999,
        a.player.respawns,
        a.flags,
        Math.round(a.heat * 100) / 100,
        a.weaponDef.family,
        a.connected ? 1 : 0,
        Math.round(a.speed * 10) / 10,
        a.vote === null ? -1 : a.vote ? 1 : 0,
        a.name,
      ]),
      tw: this.turrets.turrets.map((t) => [t.id, Math.round(t.yaw * 1000) / 1000, Math.round(t.pitch * 1000) / 1000, t.disabled ? 1 : 0, t.empowered ? 1 : 0, t.building ? 1 : 0, t.kills, Math.round(t.damageDealt), Math.round(t.hp), t.maxHp, t.wrecked ? 1 : 0]),
      tl: this.tele.followed().map((x) => x.map((v) => Math.round(v * 100) / 100)),
      or: this.ordnance.positions().map((x) => x.map((v) => Math.round(v * 100) / 100)),
      sv: enc(this.survival.hud()),
      boss: this.bossHudData(),
      cp: [this.checkpointOpen ? 1 : 0, this.team.atCheckpoint ? 1 : 0, this.voteOpen ? 1 : 0, Math.round(Math.max(0, this.voteDeadline - this.clock))],
      of: this.offer ? [this.offer.map((u) => u.id), this.offerChooser, Math.round(Math.max(0, this.offerDeadline - this.clock))] : 0,
      ups: this.director.build.total,
      nd: this.node ? this.node.netState() : 0,
      mv: this.mapVoteNet(),
      ht: Math.round(this.hostileT * 100) / 100,
    };
  }

  private bossHudData(): unknown {
    const b = this.enemies.active.find((e) => e.def.role === 'boss' && e.alive);
    return b ? enc(this.bossHud(b)) : 0;
  }

  /** Personal state for one player (inventory/ledger only when changed). */
  personal(a: Avatar): Record<string, unknown> {
    const out: Record<string, unknown> = { seq: a.lastSeq, run: ledgerView(a.run), ult: Math.round(a.abilities.ult * 1000) / 1000 };
    if (a.inventoryDirty) {
      a.inventoryDirty = false;
      out.inv = { loadout: a.inventory.loadout, items: a.inventory.entries().map((e) => e.item), status: Object.fromEntries(a.inventory.entries().map((e) => [e.item.uid, e.status])), cargo: a.inventory.cargoUsed, cap: a.inventory.cargoCapacity };
      out.st = a.stats;
    }
    return out;
  }
}

function laneOf(e: Enemy): string {
  // The gate whose wave it belongs to (also for forward-rift spawns).
  return e.gate;
}

export function ledgerView(r: RunLedger) {
  return {
    su: r.unsecured.salvage,
    ss: r.secured.salvage,
    cu: r.unsecured.credits,
    cs: r.secured.credits,
    ku: r.unsecured.components,
    ks: r.secured.components,
    hu: r.unsecured.shards,
    hs: r.secured.shards,
    xs: r.secured.xp,
    xu: Math.max(0, r.xpEarned - r.secured.xp),
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
