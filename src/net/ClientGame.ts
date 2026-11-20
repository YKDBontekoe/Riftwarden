import { traceShot } from '../arena/shotTrace';
import type { WeaponSlot } from '../arena/WeaponSlots';
import { shotOutcome } from '../arena/PlayerCombat';
import { Color3, type Engine, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { SfxName } from '../audio/Sfx';
import { type ArenaConfig, Game } from '../core/Game';
import type { Input } from '../core/Input';
import type { Settings } from '../core/settings';
import type { WeaponFamily, EnemyKind } from '../data/defs';
import type { Turret } from '../defense/Turrets';
import { type Enemy, type EnemyContext } from '../enemies/EnemyManager';
import type { Effects } from '../fx/Effects';
import type { Pickup } from '../loot/LootField';
import { RunInventory } from '../loot/runInventory';
import type { ItemInstance } from '../loot/types';
import type { SlotId } from '../progression/items';
import { upgradeDef, type UpgradeDef } from '../roguelite/upgrades';
import type { EliteModId } from '../survival/elites';
import { configCost, type TowerSlot } from '../towers/components';
import { hudStore, uiEvents } from '../ui/store';
import { buildWardenDrone, type DroneRig, SLOT_CSS } from '../visuals/droneModel';
import type { GateId } from '../world/layout';
import type { ActMsg, ShotClaim } from './protocol';
import { INPUT_HZ } from './protocol';
import { spawnFor } from './ServerGame';
import { dec, vec } from './wire';
import { parseEvent, type ReplicatedEvent } from './events';
import { isFxCall, isOrdnanceCall, isWfxCall, replay } from './replicated';
import type { ShotOutcome, ShotRequest } from '../combat/Weapon';
import { MOVE, type Player } from '../player/Player';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';

/** Connection used by the replica (implemented by NetClient). */
export interface NetLink {
  send(msg: Record<string, unknown>): void;
  act(a: ActMsg): Promise<{ ok: boolean; reason?: string }>;
  readonly rtt: number;
}

export interface TeamMember {
  id: string;
  name: string;
  slot: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  alive: boolean;
  respawnIn: number;
  connected: boolean;
  vote: -1 | 0 | 1;
  family: string;
  self: boolean;
  color: string;
  /** Screen position for the name tag (null = off-screen) and distance. */
  screen: { x: number; y: number } | null;
  dist: number;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch?: number;
}

/** Two-sample interpolation buffer per entity (server time). */
class Track {
  a: Sample | null = null;
  b: Sample | null = null;
  push(s: Sample): void {
    this.a = this.b;
    this.b = s;
  }
  at(t: number, out: Sample): Sample | null {
    const { a, b } = this;
    if (!b) return null;
    if (!a || t >= b.t) {
      // Bounded extrapolation (at most 120 ms past the newest sample).
      if (a && t > b.t) {
        const k = Math.min(0.12, t - b.t) / Math.max(0.001, b.t - a.t);
        out.x = b.x + (b.x - a.x) * k;
        out.y = b.y + (b.y - a.y) * k;
        out.z = b.z + (b.z - a.z) * k;
        out.yaw = b.yaw;
        out.pitch = b.pitch;
        return out;
      }
      Object.assign(out, b);
      return out;
    }
    const f = Math.max(0, Math.min(1, (t - a.t) / Math.max(0.001, b.t - a.t)));
    out.x = a.x + (b.x - a.x) * f;
    out.y = a.y + (b.y - a.y) * f;
    out.z = a.z + (b.z - a.z) * f;
    out.yaw = lerpAngle(a.yaw, b.yaw, f);
    out.pitch = a.pitch !== undefined && b.pitch !== undefined ? a.pitch + (b.pitch - a.pitch) * f : b.pitch;
    return out;
  }
}

interface Remote {
  id: string;
  name: string;
  slot: number;
  rig: DroneRig;
  track: Track;
  alive: boolean;
  firing: boolean;
  family: string;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  respawnT: number;
  connected: boolean;
  vote: -1 | 0 | 1;
  heat: number;
  bob: number;
}

const INTERP_DELAY = 0.1;

/**
 * Co-op replica of the arena. The scene, local drone, weapon, effects and every model are the
 * normal Game; the simulation of shared state is the server's. Enemies keep running their own
 * behaviour code purely as an animation driver (all of its gameplay side effects are routed to
 * no-ops and its presentation is suppressed), while position, health, statuses and behaviour
 * state are corrected from 20 Hz snapshots. Damage, kills, towers, loot and rewards only change
 * when the server says so.
 */
export class ClientGame extends Game {
  readonly coop = true;
  readonly you: string;
  private link: NetLink;
  private byNet = new Map<number, Enemy>();
  private tracks = new Map<number, Track>();
  private remotes = new Map<string, Remote>();
  private towerById = new Map<number, Turret>();
  private teleMap = new Map<number, number>();
  private ordMap = new Map<number, number>();
  private pickupMap = new Map<number, Pickup>();
  private pendingShots: ShotClaim[] = [];
  private inputT = 0;
  private seq = 0;
  private serverT = 0;
  private lastSnapAt = 0;
  private svHud: ReturnType<Game['survival']['hud']> | null = null;
  private bossData: unknown = 0;
  private dashFlag = false;
  private kitRef: Kit;
  private palRef: Palette;
  /** Team state for the HUD. */
  team: TeamMember[] = [];
  /** Upgrade offer chooser (null = you or nobody), checkpoint vote. */
  offerChooser: string | null = null;
  offerChooserName = '';
  offerLeft = 0;
  private sendingUpgrade = false;
  voteOpen = false;
  voteLeft = 0;
  myVote: boolean | null = null;
  defeatedByServer = false;
  /** Diagnostics. */
  netStats = { snaps: 0, events: 0, corrections: 0, rejected: 0, bytes: 0, badEvents: 0 };
  readonly puppet: EnemyContext;

  constructor(engine: Engine, canvas: HTMLCanvasElement, havok: unknown, settings: Settings, input: Input, cfg: ArenaConfig & { you: string; slot: number; players: { id: string; name: string; slot: number }[] }, link: NetLink) {
    super(engine, canvas, havok, settings, input, cfg);
    this.you = cfg.you;
    this.link = link;
    this.kitRef = (this as unknown as { kit: Kit }).kit;
    this.palRef = (this as unknown as { pal: Palette }).pal;
    this.player.vitalsLocal = false;
    // Replicas never path or breach: the server owns navigation and tower damage. Hazards only render here
    // and slow the local drone; their trails arrive as 'hz' events.
    this.enemies.nav = null;
    if (this.hazards) this.hazards.affectEnemies = false;
    // Local drone starts at its team slot.
    const sp = spawnFor(cfg.slot, this.layout);
    (this.player as unknown as { spawn: Vector3 }).spawn.set(sp.x, 0.95, sp.z);
    this.player.reset();
    for (const p of cfg.players) if (p.id !== this.you) this.addRemote(p.id, p.name, p.slot);
    // Puppet context: enemy behaviour code runs for animation only. Everything with gameplay
    // consequences is a no-op; telegraphs/ordnance/projectiles come from the server.
    const real = this.enemyCtx;
    const self = this;
    const nullFx = makeFilteredFx(this.fx);
    const nullTele = { marker: () => 0, line: () => 0, moveLine: () => {}, cancel: () => {}, update: () => {}, reset: () => {} };
    const nullOrd = { lob: () => false, orb: () => false, missile: () => false };
    this.puppet = {
      ...real,
      effects: nullFx,
      tele: nullTele as unknown as EnemyContext['tele'],
      ordnance: nullOrd as unknown as EnemyContext['ordnance'],
      damageReactor: () => {},
      hurtPlayer: () => {},
      hostileBlast: () => {},
      summon: () => null,
      alert: () => {},
      escaped: () => {},
      get time() {
        return self.hostileT;
      },
      player: this.player,
      towers: this.turrets.turrets,
    } as EnemyContext;
    // Turrets animate locally; firing and its effects are the server's.
    this.turretCtx.attack = () => {};
    // Arena hazards: the server decides and shows them.
    const hooks = (this.dynamics as unknown as { hooks: { ventTick: unknown; ventFx: unknown; movePlayer: unknown } }).hooks;
    hooks.ventTick = () => {};
    hooks.ventFx = () => {};
    // Survival HUD comes from the server.
    this.survival.hud = () => this.svHud ?? emptySurvivalHud(this);
  }

  // ------------------------------------------------------------------ remotes

  private addRemote(id: string, name: string, slot: number): Remote {
    const rig = buildWardenDrone(this.scene, this.kitRef, this.palRef, slot);
    const r: Remote = { id, name, slot, rig, track: new Track(), alive: true, firing: false, family: 'plasma', hp: 100, maxHp: 100, shield: 0, maxShield: 0, respawnT: 0, connected: true, vote: -1, heat: 0, bob: Math.random() * 10 };
    const sp = spawnFor(slot, this.layout);
    rig.root.position.set(sp.x, 1, sp.z);
    this.remotes.set(id, r);
    return r;
  }

  private removeRemote(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.rig.root.dispose(false, false);
    r.rig.accent.dispose();
    this.remotes.delete(id);
  }

  // ------------------------------------------------------------------ actions -> server

  private request(a: ActMsg, onFail = true): Promise<boolean> {
    return this.link.act(a).then((r) => {
      if (!r.ok && onFail) {
        this.towerNote = { text: r.reason ?? 'Refused', t: 3 };
        sfx.play('buildDeny');
        this.netStats.rejected++;
      }
      return r.ok;
    });
  }

  /** Swaps are predicted locally (instant) and confirmed by the server, which validates claims by family. */
  override swapWeapon(slot?: WeaponSlot): boolean {
    const before = this.weaponSlots.active;
    if (!super.swapWeapon(slot)) return false;
    void this.request({ a: 'swap', slot: this.weaponSlots.active }).then((ok) => {
      if (!ok && this.weaponSlots.active !== before) super.swapWeapon(before);
    });
    return true;
  }

  override startWave(): void {
    void this.request({ a: 'startWave' });
  }

  protected override toggleTactical(): void {
    void this.request({ a: 'tactical' }).then((ok) => {
      if (ok && !this.tactical.active) this.setBuildMode(true);
    });
  }

  protected override tryPlace(): void {
    const c = this.construction;
    const cost = configCost(this.buildConfig, this.stats.buildCostMult);
    if (!c.valid || this.wallet.cores < cost) {
      sfx.play('buildDeny');
      return;
    }
    const p = c.point;
    void this.request({ a: 'place', cfg: { ...this.buildConfig }, p: [p.x, p.y, p.z], yaw: this.player.yaw }).then((ok) => ok && sfx.play('build'));
    if (!this.tactical.active) this.setBuildMode(false);
  }

  override modifyTower(t: Turret, what: 'level' | TowerSlot, id?: string): { ok: true; cost: number } | { ok: false; reason: string } {
    const phase = this.towerEditReason();
    if (phase) return { ok: false, reason: phase };
    if (what === 'base') return { ok: false, reason: 'The base is fixed once built' };
    const sid = this.serverTowerId(t);
    if (sid === null) return { ok: false, reason: 'Tower no longer exists' };
    void this.request({ a: 'modify', tower: sid, what, part: id }).then((ok) => {
      if (ok) {
        sfx.play('equip', { pitch: 1.1 });
        this.towerNote = { text: `${t.name} refit requested`, t: 2 };
      }
    });
    return { ok: true, cost: 0 };
  }

  private serverTowerId(t: Turret): number | null {
    for (const [id, x] of this.towerById) if (x === t) return id;
    return null;
  }

  override collectPickup(p: Pickup): boolean {
    let sid = -1;
    for (const [id, x] of this.pickupMap) if (x === p) sid = id;
    if (sid < 0 || !this.loot.landed(p) || !this.player.alive) return false;
    void this.request({ a: 'collect', pickup: sid }).then((ok) => {
      if (!ok) return;
      sfx.play('pickup', { pitch: 1.1 });
    });
    return true;
  }

  override chooseUpgrade(id: string): boolean {
    if (this.sendingUpgrade || this.offerChooser !== this.you || !this.offer?.some(u => u.id === id)) return false;
    this.sendingUpgrade = true;
    void this.request({ a: 'upgrade', pick: id }).finally(() => { this.sendingUpgrade = false; });
    return true;
  }

  vote(home: boolean): void {
    this.myVote = home;
    void this.request({ a: 'vote', home });
  }

  override equip(uid: string, slot?: SlotId): boolean {
    if (!this.equipAllowed) {
      sfx.play('buildDeny');
      return false;
    }
    void this.request({ a: 'equip', uid, slot }).then((ok) => ok && sfx.play('equip'));
    return true;
  }

  override unequip(slot: SlotId): boolean {
    void this.request({ a: 'unequip', slot }).then((ok) => ok && sfx.play('ui'));
    return true;
  }

  override discard(uid: string): boolean {
    void this.request({ a: 'discard', uid }).then((ok) => ok && sfx.play('recycle'));
    return true;
  }

  override get canReturnHome(): boolean {
    return this.voteOpen && this.screen !== 'defeat';
  }

  /** Recycle (hold X) and repair (F) are server requests; inspection stays local. */
  protected override recycleTower(t: Turret): void {
    const sid = this.serverTowerId(t);
    if (sid !== null) void this.request({ a: 'recycle', tower: sid });
  }

  protected override repairTower(t: Turret): void {
    const sid = this.serverTowerId(t);
    if (sid !== null) void this.request({ a: 'repair', tower: sid });
  }

  /** Local hit resolution for responsiveness; the server re-validates and applies damage. */
  protected override shoot = (r: ShotRequest): ShotOutcome => {
    const { struck, wall } = traceShot(this.scene, this.enemies.active, r, (e) => !!e.netId);
    const out = shotOutcome(r, struck, wall, false);
    const claim: ShotClaim = { f: r.family, o: [r.origin.x, r.origin.y, r.origin.z], d: [r.dir.x, r.dir.y, r.dir.z], pw: r.family === 'rail' ? Math.min(1, r.damage / Math.max(1, this.weapon.def.damage * this.stats.weaponDamageMult)) : 1, h: this.weapon.heat / 100, hits: [] };
    for (const s of struck) claim.hits.push([s.enemy.netId, s.weak ? 1 : 0, round2(s.point.x), round2(s.point.y), round2(s.point.z)]);
    if (this.pendingShots.length < 24) this.pendingShots.push(claim);
    return out;
  };

  override async closePanel(): Promise<void> {
    if (this.screen === 'upgrade') {
      sfx.play('ui');
      this.setScreen('paused');
      await this.resume();
      return;
    }
    return super.closePanel();
  }

  // The replica never applies damage or rewards itself.
  override hurtPlayer(): void {}
  override hostileBlast(): void {}
  protected override ventTick(): void {}
  override targets(): readonly Player[] {
    return [];
  }
  override onEnemyKilled(): void {}
  protected override onDefeat(): void {}
  override openUpgrade(): void {}
  protected override watchBoss(): void {
    if (this.hudT <= 0) this.watchIntel();
  }

  // ------------------------------------------------------------------ frame

  protected override update(dt: number): void {
    const input = this.input;
    const playing = this.screen === 'playing';
    const controls = playing && input.captured;
    if (controls) {
      if (input.pressed('F3')) this.togglePerf();
      if (input.pressed('KeyG')) this.startWave();
      if (input.pressed('KeyQ')) this.toggleTactical();
      if (input.pressed('Digit2') || input.pressed('KeyB')) this.setBuildMode(!this.construction.active);
      if (input.pressed('Digit1')) {
        this.setBuildMode(false);
        this.swapWeapon('weapon');
      }
      if (input.pressed('KeyZ')) this.swapWeapon();
      if (this.construction.active && input.mousePressed(2)) this.setBuildMode(false);
      if (input.pressed('KeyH') && this.voteOpen) this.openCheckpoint();
      if (input.pressed('KeyI') || input.pressed('Tab')) return this.openInventory();
      if (input.pressed('KeyU')) return this.openBuildOverview();
      if (input.pressed('KeyT') && this.towerPanelAllowed) return this.openTowerPanel();
      if (input.pressed('KeyY') && this.offer) {
        this.setScreen('upgrade');
        this.input.releaseLock();
        return;
      }
      this.towers.keys(input);
    }
    const hdt = dt * this.tactical.hostileScale;
    this.runTime += dt;
    this.hazards?.decay(hdt, this.hostileT);
    this.hazards?.affectPlayer(0);
    this.player.update(dt, input, this.stats.moveSpeedMult * (this.hazards?.playerSpeed ?? 1), controls);
    if (this.player.dashedThisFrame) {
      this.player.dashedThisFrame = false;
      this.dashFlag = true;
    }
    if (this.construction.active) {
      this.construction.update(this.player, this.wallet.cores, this.turrets.turrets, this.stats);
      if (controls && input.mousePressed(0)) this.tryPlace();
    }
    const trigger = controls && input.mouse(0) && !this.construction.active;
    this.weapon.update(dt, trigger, this.stats, this.shoot, this.weaponFx);
    this.wfx.update(dt, this.player.camera.position);
    this.updateInspect(dt, controls);
    this.updateLootTarget(controls);
    this.loot.update(dt);

    // Replicated world.
    this.applyTracks();
    this.hostileT += hdt;
    sfx.suppress++;
    try {
      this.enemies.update(hdt, this.puppet, dt);
    } finally {
      sfx.suppress--;
    }
    this.applyTracks(true);
    this.ordnance.update(hdt, this.ordCtx, this.hostileT);
    this.tele.update(hdt);
    this.dynamics.update(dt, hdt);
    this.turrets.update(dt, this.turretCtx);
    this.applyTowerPoses();
    this.updateRemotes(dt);
    this.updateProjectiles(hdt);
    this.fx.update(dt);
    this.updateReactor(dt, true);
    const k = this.tactical.active ? 1 : 0;
    const flash = this.updateSky(dt);
    this.hurtFx = Math.max(this.player.hurtFlash, this.player.alive ? 0 : 0.8);
    this.mood.update(dt, this.moodInput());
    this.motionFx();
    this.post.update(dt, k, this.hurtFx, flash);
    this.updateArenaVisuals(dt, hdt);
    if (this.screen === 'defeat') this.defeatT += dt;

    // Input upstream (30 Hz): movement state + shot claims.
    this.inputT -= dt;
    if (this.inputT <= 0 || this.pendingShots.length >= 8) {
      this.inputT = 1 / INPUT_HZ;
      const p = this.player.position;
      const fl = (this.player.dashing ? 1 : 0) | (this.player.sprinting ? 2 : 0) | (trigger ? 4 : 0) | (this.construction.active ? 8 : 0) | (this.dashFlag ? 16 : 0);
      this.dashFlag = false;
      this.link.send({ t: 'input', seq: ++this.seq, p: [round2(p.x), round2(p.y), round2(p.z)], yaw: round3(this.player.yaw), pitch: round3(this.player.pitch), sp: round2(this.player.speed), fl, heat: round2(this.weapon.heat / 100), shots: this.pendingShots.length ? this.pendingShots : undefined });
      this.pendingShots = [];
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 1 / 20;
      this.watchIntel();
      this.publishHud();
      this.publishTeam();
    }
  }

  private ordCtx = {
    player: () => (this.player.alive ? this.player.eye : null),
    ray: (a: Vector3, b: Vector3) => {
      const hit = this.los(a, b);
      return hit ? null : b.clone();
    },
    impact: () => {},
    trail: (kind: string, pos: Vector3) => {
      if (kind === 'shell' || kind === 'bomb') this.fx.burst('embers', pos, 1);
      else if (kind === 'missile') this.fx.burst('smoke', pos, 1, undefined, 0.4);
      else this.fx.burst('zap', pos, 1, undefined, 0.5);
    },
  };

  private get renderT(): number {
    return this.serverT + (performance.now() - this.lastSnapAt) / 1000 - INTERP_DELAY;
  }

  /** Place every replicated enemy at its interpolated server pose. */
  private applyTracks(after = false): void {
    const t = this.renderT;
    const s: Sample = { t: 0, x: 0, y: 0, z: 0, yaw: 0 };
    for (const [id, e] of this.byNet) {
      if (!e.alive) continue;
      const tr = this.tracks.get(id);
      if (!tr || !tr.at(t, s)) continue;
      e.pos.set(s.x, s.y, s.z);
      e.yaw = s.yaw;
      if (after) {
        e.root.position.copyFrom(e.pos);
        e.root.rotation.y = e.yaw;
      }
    }
  }

  private towerPose = new Map<number, [number, number, number, number, number]>();
  private applyTowerPoses(): void {
    for (const [id, t] of this.towerById) {
      const p = this.towerPose.get(id);
      if (!p || t.building) continue;
      t.yaw = lerpAngle(t.yaw, p[0], 0.35);
      t.pitch += (p[1] - t.pitch) * 0.35;
      t.rig.yaw.rotation.y = t.yaw;
      t.rig.pitch.rotation.x = t.pitch;
      if (p[2] && !t.disabled) t.disable(0.3);
      t.empowerT = p[3] ? Math.max(t.empowerT, 0.3) : t.empowerT;
    }
  }

  private updateRemotes(dt: number): void {
    const t = this.renderT;
    const s: Sample = { t: 0, x: 0, y: 0, z: 0, yaw: 0 };
    for (const r of this.remotes.values()) {
      const rig = r.rig;
      const show = r.connected;
      if (rig.root.isEnabled() !== show) rig.root.setEnabled(show);
      if (!show) continue;
      if (r.track.at(t, s)) {
        rig.root.position.set(s.x, s.y + 0.55, s.z);
        rig.root.rotation.y = s.yaw;
        rig.pod.rotation.x = (s.pitch ?? 0) * 0.9;
      }
      r.bob += dt;
      rig.body.position.y = Math.sin(r.bob * 2.2) * 0.05 - (r.alive ? 0 : 0.35);
      rig.body.rotation.z = r.alive ? Math.sin(r.bob * 1.3) * 0.04 : 0.5;
      rig.ring.rotation.y += dt * (r.alive ? 6 : 1);
      for (const th of rig.thrusters) th.scaling.y = r.alive ? 0.18 + 0.06 * Math.sin(r.bob * 30) : 0.02;
    }
  }

  // ------------------------------------------------------------------ server messages

  onSnapshot(s: Record<string, unknown>): void {
    this.netStats.snaps++;
    this.serverT = s.t as number;
    this.lastSnapAt = performance.now();
    const w = s.w as [number, string, number, number, number];
    const waves = this.waves as unknown as { number: number; phase: string; timer: number; spawned?: number };
    waves.number = w[0];
    waves.phase = w[1];
    waves.timer = w[2];
    (this as unknown as { netEnemiesLeft: number }).netEnemiesLeft = w[3];
    this.reactorHp = s.r as number;
    this.wallet.cores = s.c as number;
    const tac = s.tac as [number, number, number];
    const wasTac = this.tactical.active;
    this.tactical.energy = tac[0];
    this.tactical.active = !!tac[1];
    this.tactical.hostileScale = tac[2];
    if (this.tactical.active !== wasTac) {
      sfx.play(this.tactical.active ? 'tacticalOn' : 'tacticalOff');
      sfx.setTactical(this.tactical.active);
    }
    this.hostileT = Math.max(this.hostileT, (s.ht as number) - INTERP_DELAY);
    // Enemies
    for (const row of s.e as unknown[][]) {
      const id = row[0] as number;
      const e = this.byNet.get(id);
      if (!e || !e.alive) continue;
      let tr = this.tracks.get(id);
      if (!tr) this.tracks.set(id, (tr = new Track()));
      tr.push({ t: this.serverT, x: row[1] as number, y: row[2] as number, z: row[3] as number, yaw: row[4] as number });
      e.hp = row[5] as number;
      e.maxHp = row[6] as number;
      const shield = row[7] as number;
      if (shield <= 0 && e.shield > 0 && e.walker?.shield) e.walker.shield.setEnabled(false);
      if (shield > 0 && e.shield <= 0 && e.walker?.shield) e.walker.shield.setEnabled(true);
      e.shield = shield;
      if ((row[8] as number) <= 0 && e.armor > 0) this.dropArmor(e);
      e.armor = row[8] as number;
      e.state = row[9] ? 'attack' : 'move';
      e.chargeT = row[10] as number;
      e.buffT = row[11] as number;
      e.boostT = row[12] as number;
      e.dischargeWind = row[13] as number;
      const st = row[14] as number[];
      e.status.burnStacks = st[0];
      e.status.burnT = st[0] > 0 ? Math.max(e.status.burnT, 0.6) : 0;
      e.status.chill = st[1];
      e.status.frozenT = st[2] ? Math.max(e.status.frozenT, 0.3) : 0;
      e.status.shockT = st[3] ? Math.max(e.status.shockT, 0.3) : 0;
      if (row[15]) Object.assign(e.ai, row[15] as Record<string, unknown>);
      e.seg = row[16] as number;
    }
    // Enemies the server no longer has (escaped, despawned) disappear quietly.
    const live = new Set((s.e as unknown[][]).map((r) => r[0] as number));
    for (const [id, e] of this.byNet) {
      if (!live.has(id) && e.alive && performance.now() - e.spawnedAt > 1500) {
        this.enemies.despawn(e, null);
        this.byNet.delete(id);
        this.tracks.delete(id);
      }
    }
    // Drones
    const team = new Set<string>();
    for (const row of s.a as unknown[][]) {
      const id = row[0] as string;
      team.add(id);
      const [x, y, z, yaw, pitch, hp, maxHp, shield, maxShield, alive, respawnT, respawns, flags, heat, family, connected, , vote, name] = row.slice(1) as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, string, number, number, number, string];
      if (id === this.you) {
        const was = this.player.alive;
        this.player.setVitals(hp, maxHp, shield, maxShield, !!alive, respawnT);
        if (respawns !== this.player.respawns) {
          this.player.respawns = respawns;
          this.player.reset();
          this.player.setVitals(hp, maxHp, shield, maxShield, !!alive, respawnT);
        }
        if (was && !alive) uiEvents.emit('banner', { title: 'DRONE DESTROYED', sub: `Respawning in ${Math.ceil(respawnT)} s · the reactor is still under attack`, tone: 'red' });
        continue;
      }
      let r = this.remotes.get(id);
      if (!r) r = this.addRemote(id, name, this.remotes.size + 1);
      r.track.push({ t: this.serverT, x, y, z, yaw, pitch });
      Object.assign(r, { hp, maxHp, shield, maxShield, alive: !!alive, respawnT, firing: !!(flags & 4), heat, family, connected: !!connected, vote: vote as -1 | 0 | 1, name });
    }
    for (const id of [...this.remotes.keys()]) if (!team.has(id)) this.removeRemote(id);
    // Towers
    for (const row of s.tw as number[][]) {
      this.towerPose.set(row[0], [row[1], row[2], row[3], row[4], row[5]]);
      const t = this.towerById.get(row[0]);
      if (t) {
        t.kills = row[6];
        t.damageDealt = row[7];
        if (row.length > 10) {
          t.maxHp = row[9];
          if (row[10] && !t.wrecked) t.damage(t.hp + 1);
          else if (!row[10] && t.wrecked) t.repair();
          t.hp = row[8];
        }
      }
    }
    for (const [sid, x, y, z] of s.tl as number[][]) {
      const lid = this.teleMap.get(sid);
      if (lid) this.tele.moveMarker(lid, x, y, z);
    }
    const ordLive = new Set<number>();
    for (const [sid, x, y, z] of s.or as number[][]) {
      ordLive.add(sid);
      const lid = this.ordMap.get(sid);
      if (lid) this.ordnance.correct(lid, x, y, z);
    }
    for (const [sid, lid] of this.ordMap) {
      if (!ordLive.has(sid) && this.ordnance.activeIds().includes(lid)) this.ordnance.drop(lid);
      if (!ordLive.has(sid)) this.ordMap.delete(sid);
    }
    this.svHud = dec(s.sv) as ReturnType<Game['survival']['hud']>;
    this.bossData = s.boss;
    const cp = s.cp as number[];
    this.checkpointOpen = !!cp[0];
    const voteWas = this.voteOpen;
    this.voteOpen = !!cp[2];
    this.voteLeft = cp[3];
    if (voteWas && !this.voteOpen && this.screen === 'checkpoint') this.setScreen('paused');
    const of = s.of as 0 | [string[], string | null, number];
    if (of) {
      const ids = of[0].join();
      if (!this.offer || this.offer.map((u) => u.id).join() !== ids) this.offer = of[0].map((id) => upgradeDef(id)).filter((u): u is UpgradeDef => !!u);
      this.offerChooser = of[1];
      this.offerLeft = of[2];
    } else if (this.offer) {
      this.offer = null;
      this.offerChooser = null;
      if (this.screen === 'upgrade') this.setScreen('paused');
    }
    const me = s.me as Record<string, unknown> | undefined;
    if (me) this.applyPersonal(me);
  }

  private dropArmor(e: Enemy): void {
    (this.enemies as unknown as { breakArmor(e: Enemy, fx: Effects): void }).breakArmor(e, this.fx);
  }

  private applyPersonal(me: Record<string, unknown>): void {
    const r = me.run as Record<string, number>;
    const run = this.cfg.run;
    run.unsecured.salvage = r.su;
    run.secured.salvage = r.ss;
    run.unsecured.credits = r.cu;
    run.secured.credits = r.cs;
    run.unsecured.components = r.ku;
    run.secured.components = r.ks;
    run.xpReplica = true;
    run.secured.xp = r.xs ?? 0;
    run.unsecured.xp = r.xu ?? 0;
    run.wavesCleared = r.wc;
    run.lastBankedWave = r.lb;
    run.kills = r.k;
    run.duration = r.d;
    const inv = me.inv as { loadout: Record<SlotId, string | null>; items: ItemInstance[]; status: Record<string, string> } | undefined;
    if (inv) {
      const byUid = new Map(inv.items.map((i) => [i.uid, i]));
      run.unsecured.items = inv.items.filter((i) => inv.status[i.uid] === 'unsecured');
      run.secured.items = inv.items.filter((i) => inv.status[i.uid] === 'secured');
      const loadout = Object.fromEntries(Object.entries(inv.loadout).map(([k, uid]) => [k, uid ? byUid.get(uid) ?? null : null])) as Partial<Record<SlotId, ItemInstance | null>>;
      const carried = Object.fromEntries(Object.entries(loadout).filter(([, i]) => i && inv.status[i.uid] === 'carried'));
      const ri = new RunInventory(carried, run);
      for (const [slot, it] of Object.entries(loadout)) if (it && inv.status[it.uid] !== 'carried') (ri.loadout as Record<string, string | null>)[slot] = it.uid;
      (this as { inventory: RunInventory }).inventory = ri;
      this.refreshEquipment();
    }
  }

  /** Apply a batch of replicated events in order. */
  onEvents(list: unknown[][]): void {
    for (const raw of list) {
      this.netStats.events++;
      const ev = parseEvent(raw);
      if (!ev) {
        this.netStats.badEvents++;
        continue;
      }
      try {
        this.applyEvent(ev);
      } catch (err) {
        console.warn('event failed', ev[0], err);
      }
    }
  }

  private applyEvent(ev: ReplicatedEvent): void {
    switch (ev[0]) {
      case 'f': {
        const m = ev[1];
        const args = dec(ev[2]) as unknown[];
        if (m === 'spawnProjectile') this.fx.spawnProjectile(args[0] as Vector3, args[1] as Vector3, 0);
        else if (isFxCall(m)) replay(this.fx, m, args);
        return;
      }
      case 'w': {
        const m = ev[1];
        if (isWfxCall(m)) replay(this.wfx, m, dec(ev[2]) as unknown[]);
        return;
      }
      case 's': {
        const o = ev[2] ?? {};
        const pos = ev[3];
        if (pos) {
          const a = this.panFor(vec(pos));
          sfx.play(ev[1] as SfxName, { ...o, volume: (o.volume ?? 1) * a.volume, pan: a.pan });
        } else sfx.play(ev[1] as SfxName, o);
        return;
      }
      case 'u': {
        const payload = dec(ev[2]);
        // Personal kill confirmations keep the local (client-predicted) drone's dash topped up, as in single player.
        if (ev[1] === 'hit' && payload === 'kill') this.player.refundDash(MOVE.killDashRefund);
        (uiEvents.emit as (k: string, v: unknown) => void)(ev[1], payload);
        return;
      }
      case 't': {
        const op = ev[1];
        const sid = ev[2];
        const args = dec(ev[3]) as unknown[];
        if (op === 'marker') this.teleMap.set(sid, this.tele.marker(args[0] as Vector3, args[1] as number, args[2] as number, args[3] as never));
        else if (op === 'line') this.teleMap.set(sid, this.tele.line(args[0] as Vector3, args[1] as Vector3, args[2] as number, args[3] as never, args[4] as number | undefined));
        else if (op === 'moveLine') {
          const lid = this.teleMap.get(sid);
          if (lid) this.tele.moveLine(lid, args[0] as Vector3, args[1] as Vector3, args[2] as number | undefined);
        } else if (op === 'cancel') {
          const lid = this.teleMap.get(sid);
          if (lid) this.tele.cancel(lid);
        }
        if (this.teleMap.size > 400) for (const key of [...this.teleMap.keys()].slice(0, 200)) this.teleMap.delete(key);
        return;
      }
      case 'o': {
        const op = ev[1];
        const args = dec(ev[3]) as unknown[];
        if (isOrdnanceCall(op) && replay(this.ordnance, op, args)) {
          this.ordMap.set(ev[2], this.ordnance.lastId);
          if (op === 'lob') sfx.play('enemyShot', { pitch: 0.6, ...this.panFor(args[0] as Vector3) });
        }
        return;
      }
      case 'es':
        return this.spawnReplica(ev);
      case 'ek': {
        const e = this.byNet.get(ev[1]);
        if (!e || !e.alive) return;
        this.enemies.kill(e, this.fx, this.puppet, !!ev[2]);
        this.byNet.delete(ev[1]);
        this.tracks.delete(ev[1]);
        return;
      }
      case 'er': {
        const e = this.byNet.get(ev[1]);
        if (e && e.alive) this.enemies.despawn(e, null);
        this.byNet.delete(ev[1]);
        this.tracks.delete(ev[1]);
        return;
      }
      case 'ed': {
        const e = this.byNet.get(ev[1]);
        if (!e) return;
        e.flinch = Math.min(1, e.flinch + 0.35);
        // The event carries no source: lean away from this warden (the usual shooter); small fixed kick.
        if (e.alive) this.enemies.react(e, this.player.position.x, this.player.position.z, 0.06);
        if (ev[2]) e.shieldFlash = 1;
        this.enemies.flash(e, ev[2] ? [0.25, 0.7, 1] : [1, 0.92, 0.8]);
        e.lastHit = performance.now();
        return;
      }
      case 'T+': {
        const [, id, cfg, pos, yaw, , ownerName] = ev;
        if (this.towerById.has(id)) return;
        const t = this.turrets.add(vec(pos), yaw, this.turretCtx, cfg);
        this.towerById.set(id, t);
        if (ownerName && ownerName !== this.myName) this.towerNote = { text: `${ownerName} deployed ${t.name}`, t: 2 };
        return;
      }
      case 'hz':
        this.hazards?.add(ev[1], ev[2], ev[3], ev[4], ev[5]);
        break;
      case 'T-': {
        const t = this.towerById.get(ev[1]);
        if (!t) return;
        this.turrets.remove(t);
        this.towerById.delete(ev[1]);
        this.towers.forget(t);
        return;
      }
      case 'Tc': {
        const t = this.towerById.get(ev[1]);
        if (t) t.refit(ev[2], ev[3], this.turretCtx);
        return;
      }
      case 'L+': {
        const [, id, item, at, ground, wave] = ev;
        if (this.pickupMap.has(id)) return;
        const p = this.loot.spawn(item, vec(at), vec(ground), wave);
        this.pickupMap.set(id, p);
        this.dropsSpawned++;
        return;
      }
      case 'L-': {
        const p = this.pickupMap.get(ev[1]);
        if (!p) return;
        if (!ev[2]) this.fx.burst('build', p.focus, 18);
        this.loot.remove(p);
        if (this.lootTarget === p) this.lootTarget = null;
        this.pickupMap.delete(ev[1]);
        this.inventoryVersion++;
        return;
      }
      case 'ev': {
        const id = ev[1];
        const instant = !!ev[2];
        if (id === 'routes') {
          this.dynamics.openSouth(instant);
          this.openGate('south');
        } else this.dynamics.activateInstability(instant);
        return;
      }
      case 'up':
        this.director.takeUpgrade(ev[1]);
        return;
      case 'offer': {
        this.offer = ev[1].map((id) => upgradeDef(id)).filter((u): u is UpgradeDef => !!u);
        this.offerChooser = ev[2];
        this.offerChooserName = ev[3];
        if (this.screen === 'playing' || this.screen === 'paused') {
          this.setBuildMode(false);
          this.setScreen('upgrade');
          this.input.releaseLock();
        }
        sfx.play('bank', { pitch: 1.4, volume: 0.6 });
        return;
      }
      case 'vote':
        if (ev[1]) {
          this.voteOpen = true;
          this.myVote = null;
          this.openCheckpoint();
        } else {
          this.voteOpen = false;
          if (this.screen === 'checkpoint') void this.continueRun();
        }
        return;
      case 'bank': {
        const [, wave, ok, salvage, credits, components, items] = ev;
        sfx.play('bank');
        uiEvents.emit('banner', ok ? { title: 'CHECKPOINT SECURED', sub: `Wave ${wave} · ${salvage} salvage · ${credits} cr · ${components} comp${items ? ` · ${items} item${items === 1 ? '' : 's'}` : ''} banked to your HQ`, tone: 'cyan' } : { title: 'CHECKPOINT · NOT BANKED', sub: 'The server could not commit this checkpoint', tone: 'red' });
        this.inventoryVersion++;
        return;
      }
      case 'h': {
        const from = ev[3] ? vec(ev[3]) : null;
        this.player.feelHit(ev[1], !!ev[2], from);
        return;
      }
      case 'k':
        this.player.knockback(vec(ev[1]), ev[2]);
        return;
      case 'mv': {
        this.netStats.corrections++;
        const p = vec(ev[1]);
        this.player.controller.setPosition(p);
        this.player.controller.setVelocity(Vector3.Zero());
        return;
      }
      case 'def':
        this.defeatedByServer = true;
        this.setScreen('defeat');
        this.setBuildMode(false);
        this.fx.explode(new Vector3(0, 4, 0), { scale: 4, color: new Color3(0.6, 1.6, 2.2), debris: 30 });
        sfx.play('explosion', { volume: 1, pitch: 0.5 });
        hudStore.set({ stats: this.runStats });
        return;
      case 'left':
        this.removeRemote(ev[1]);
        uiEvents.emit('alert', { text: `${String(ev[2]).toUpperCase()} LEFT THE OPERATION`, tone: 'orange' });
        return;
      case 'shot':
        return this.remoteShot(ev);
      default: {
        // Exhaustiveness: a new ReplicatedEvent tag without a handler fails to compile here.
        const unhandled: never = ev;
        void unhandled;
      }
    }
  }

  myName = '';

  private spawnReplica(ev: Extract<ReplicatedEvent, readonly ['es', ...unknown[]]>): void {
    const [, id, kind, mods, tag, encounter, maxHp, maxShield, x, z, yaw, seg, gate] = ev as readonly [string, number, EnemyKind, EliteModId[], string | null, number, number, number, number, number, number, number, GateId];
    if (this.byNet.has(id)) return;
    const e = this.enemies.spawn(kind, gate in this.layout.routes ? gate : 'north', this.layout, 1, 1, 1, { mods, tag: (tag ?? undefined) as Enemy['tag'], encounter, ctx: this.puppet });
    e.netId = id;
    e.maxHp = e.hp = maxHp;
    e.maxShield = e.shield = maxShield;
    e.pos.set(x, 0, z);
    e.yaw = yaw;
    e.seg = Math.max(1, Math.min(e.path.length - 1, seg));
    e.root.position.copyFrom(e.pos);
    e.motion?.reset(e.pos, e.yaw);
    this.byNet.set(id, e);
    this.arenaVisuals.gateSpawned(gate, { x, z });
  }

  private remoteShot(ev: Extract<ReplicatedEvent, readonly ['shot', ...unknown[]]>): void {
    const r = this.remotes.get(ev[1]);
    if (!r) return;
    const family = ev[2] as WeaponFamily;
    const to = vec(ev[3]);
    r.rig.muzzle.computeWorldMatrix(true);
    const from = r.rig.muzzle.getAbsolutePosition().clone();
    const a = this.panFor(from);
    if (family === 'plasma') this.wfx.bolt(from, to, 140, 0.3, null);
    else if (family === 'rail') this.wfx.rail(from, to, 1);
    else this.fx.tracer(from, to, 1, 0.06, 0.06);
    sfx.play(family === 'rail' ? 'railFire' : 'shoot', { volume: a.volume * 0.5, pan: a.pan, pitch: family === 'beam' ? 0.7 : 1 });
  }

  // ------------------------------------------------------------------ HUD

  private publishTeam(): void {
    const team: TeamMember[] = [];
    const p = this.player;
    team.push({ id: this.you, name: this.myName || 'You', slot: 0, hp: p.hp, maxHp: p.maxHp, shield: p.shield, maxShield: p.maxShield, alive: p.alive, respawnIn: p.respawnT, connected: true, vote: this.myVote === null ? -1 : this.myVote ? 1 : 0, family: this.weapon.def.family, self: true, color: SLOT_CSS[0], screen: null, dist: 0 });
    for (const r of this.remotes.values()) {
      const pos = r.rig.root.position;
      const dist = Vector3.Distance(pos, p.position);
      team.push({ id: r.id, name: r.name, slot: r.slot, hp: r.hp, maxHp: r.maxHp, shield: r.shield, maxShield: r.maxShield, alive: r.alive, respawnIn: r.respawnT, connected: r.connected, vote: r.vote, family: r.family, self: false, color: SLOT_CSS[r.slot % SLOT_CSS.length], screen: r.connected ? this.project(pos.x, pos.y + 1.1, pos.z) : null, dist });
    }
    this.team = team;
    hudStore.set({ coop: { team, voteOpen: this.voteOpen, voteLeft: this.voteLeft, offerChooser: this.offerChooser === this.you ? null : this.offerChooserName || this.offerChooser, offerLeft: this.offerLeft, rtt: Math.round(this.link.rtt) } });
  }

  override bossHud(e: Enemy) {
    const b = this.bossData as Record<string, unknown> | 0;
    if (!b) return super.bossHud(e);
    return { ...super.bossHud(e), ...(b as object), hp: e.hp, max: e.maxHp };
  }

  get enemiesLeftNet(): number {
    return (this as unknown as { netEnemiesLeft?: number }).netEnemiesLeft ?? this.enemies.count;
  }

  override dispose(): void {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    super.dispose();
  }
}

/** Effects proxy for replica enemy behaviours: cosmetic bursts only (the server authored the rest). */
function makeFilteredFx(fx: Effects): Effects {
  return new Proxy(fx, {
    get(target, prop, recv) {
      // Bursts and damage states are local presentation of replicated state (HP comes with the snapshots).
      if (prop === 'burst' || prop === 'wound' || prop === 'shatter') return target[prop].bind(target);
      const v = Reflect.get(target, prop, recv);
      if (typeof v === 'function') return () => {};
      return v;
    },
  });
}

function emptySurvivalHud(g: Game) {
  return { ...(Object.getPrototypeOf(g.survival).hud.call(g.survival) as object) } as ReturnType<Game['survival']['hud']>;
}

function lerpAngle(a: number, b: number, f: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
