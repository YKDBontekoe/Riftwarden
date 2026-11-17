import {
  type AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  type Engine,
  HavokPlugin,
  Matrix,
  type PhysicsEngineV2,
  PhysicsRaycastResult,
  CascadedShadowGenerator,
  PointLight,
  Ray,
  Scene,
  SceneInstrumentation,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { mulberry32, rollDamage } from '../combat/damage';
import { BASE_STATS, type CombatStats, computeStats, type StatModifier } from '../combat/stats';
import { type ShotOutcome, type ShotRequest, Weapon, type WeaponFxHooks } from '../combat/Weapon';
import type { WeaponFamily } from '../data/defs';
import { WeaponFx } from '../fx/WeaponFx';
import { ECONOMY, SENTINEL, towerCost } from '../data/defs';
import { pickInteractable } from '../home/interaction';
import { DROP_SOURCES, type DropSourceId, rollDrops } from '../loot/drops';
import { equipmentModifiers, weaponDefFor } from '../loot/equipment';
import { flatScale, generateItem, hashSeed } from '../loot/generate';
import { convertsToSalvage, expiresAfterWave, LootField, type Pickup, PICKUP_RANGE } from '../loot/LootField';
import { rarity } from '../loot/rarity';
import { scrapValue } from '../loot/economy';
import { RunInventory } from '../loot/runInventory';
import type { ItemInstance } from '../loot/types';
import type { SlotId } from '../progression/items';
import { Construction } from '../defense/Construction';
import { type Turret, type TurretContext, type TurretHitboxMeta, TurretManager } from '../defense/Turrets';
import { type Enemy, type EnemyContext, type EnemyHitboxMeta, EnemyManager } from '../enemies/EnemyManager';
import { Effects } from '../fx/Effects';
import { Player } from '../player/Player';
import { type HitKind, hudStore, type LootTargetInfo, type Screen, uiEvents } from '../ui/store';
import type { Rewards, RunLedger } from '../progression/run';
import { isCheckpointWave, nextCheckpoint, type ThreatTier } from '../progression/tiers';
import { ArenaBuilder } from '../visuals/arena';
import { Atmosphere } from '../visuals/atmosphere';
import { PostFx } from '../visuals/postfx';
import { Kit } from '../visuals/kit';
import { createPalette, type Palette } from '../visuals/materials';
import { buildReactor, type ReactorRig } from '../visuals/models';
import { WaveManager } from '../waves/WaveManager';
import { ARENA } from '../world/layout';
import { ENV_QUERY } from '../world/physicsGroups';
import type { Input } from './Input';
import { type Settings, saveSettings } from './settings';
import { TacticalEnergy, Wallet } from './tactical';

const TMP = new Vector3();
/** Sun intensity (directional, range-free). */
const SUN = 3.4;
const TMP2 = new Vector3();

/** Callbacks into the session flow (persistence and scene transitions live there). */
export interface ArenaHooks {
  /** A checkpoint wave was cleared and these rewards were just secured by the run. Returns true once persisted. */
  bank(wave: number, rewards: Rewards): boolean;
  /** Checkpoint preparation started: offer continue / return home. */
  checkpoint(): void;
  /** Reactor destroyed. */
  defeat(): void;
}

export interface ArenaConfig {
  tier: ThreatTier;
  /** Equipment the drone deploys with (owned by the profile: can never be lost). */
  loadout: Partial<Record<SlotId, ItemInstance | null>>;
  run: RunLedger;
  hooks: ArenaHooks;
}

/**
 * One survival run in the arena. Built fresh for every deployment and disposed when
 * the run ends, so no towers, enemies, wave or effect state can leak between runs.
 */
export class Game {
  readonly scene: Scene;
  private pal: Palette;
  private kit: Kit;
  readonly player: Player;
  readonly weapon: Weapon;
  readonly fx: Effects;
  readonly wfx: WeaponFx;
  /** Arc Conductor procs this run (automation/tests). */
  arcs = 0;
  readonly enemies: EnemyManager;
  readonly turrets: TurretManager;
  readonly construction: Construction;
  readonly waves: WaveManager;
  readonly tactical = new TacticalEnergy();
  readonly wallet = new Wallet(ECONOMY.startingCores);
  private reactor: ReactorRig;
  private reactorLight: PointLight;
  reactorHp: number = ECONOMY.reactorMaxHp;
  private reactorHitT = 0;
  private reactorSfxT = 0;
  private post: PostFx;
  private atmosphere: Atmosphere;
  private moon: DirectionalLight;
  private hurtFx = 0;
  private lastFlash = 0;
  private animated: { node: { rotation: Vector3 }; spin: Vector3 }[] = [];

  /** Extra modifiers (future run upgrades); equipment modifiers are derived from the run loadout. */
  modifiers: StatModifier[] = [];
  stats: CombatStats = { ...BASE_STATS };

  /** Run inventory + loadout (ownership rules live in RunInventory/RunLedger). */
  readonly inventory: RunInventory;
  readonly loot: LootField;
  private lootRand: () => number;
  private lootCounter = 0;
  lootTarget: Pickup | null = null;
  /** Bumped on every inventory/loadout change so UI can refresh without polling. */
  inventoryVersion = 0;
  /** Items granted by the most recent checkpoint cache (checkpoint panel). */
  lastCache: ItemInstance[] = [];
  /** Whether the most recent checkpoint was written to storage successfully. */
  lastBankSaved = true;
  /** Debug/automation: multiplies every source's drop chance (1 = normal). */
  dropChanceMult = 1;
  dropsSpawned = 0;
  dropsConverted = 0;
  dropsExpired = 0;
  private screenBeforeInventory: Screen = 'playing';

  screen: Screen = 'loading';
  private runTime = 0;
  private kills = 0;
  private turretsBuilt = 0;
  private defeatT = 0;
  private hudT = 0;
  private inspected: Turret | null = null;
  private recycleT = 0;
  private perfOn = false;
  private instrumentation: SceneInstrumentation | null = null;
  private fpsSmooth = 60;

  private shotRay = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private physResult = new PhysicsRaycastResult();
  private enemyCtx: EnemyContext;
  private turretCtx: TurretContext;

  /** Return-home window: open from checkpoint prep until the next wave starts. */
  checkpointOpen = false;
  private disposed = false;

  constructor(
    private engine: Engine,
    private canvas: HTMLCanvasElement,
    havok: unknown,
    public settings: Settings,
    readonly input: Input,
    readonly cfg: ArenaConfig,
  ) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.55, 0.55, 0.56, 1);
    scene.ambientColor = new Color3(0.04, 0.045, 0.05);
    scene.skipPointerMovePicking = true;
    scene.enablePhysics(new Vector3(0, -26, 0), new HavokPlugin(true, havok));

    this.pal = createPalette(scene);
    this.kit = new Kit(scene);
    const high = settings.quality === 'high';

    // Night-time storm: sky, haze, lamps, embers. PBR ambient comes from the captured environment.
    this.atmosphere = new Atmosphere(scene, this.pal, ARENA);
    this.atmosphere.setQuality(high);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0042;
    scene.fogColor = this.atmosphere.fogColor;

    // Lighting: low golden-hour sun (key), sky IBL (fill), cyan reactor glow, orange rift light at the gates.
    const moon = new DirectionalLight('sun', this.atmosphere.sunDir.scale(-1), scene);
    moon.position = this.atmosphere.sunDir.scale(120);
    moon.intensity = SUN;
    moon.diffuse = new Color3(1, 0.84, 0.66);
    moon.specular = new Color3(1, 0.9, 0.75);
    this.moon = moon;
    this.reactorLight = new PointLight('reactorLight', new Vector3(0, 5, 0), scene);
    this.reactorLight.diffuse = new Color3(0.3, 0.9, 1);
    this.reactorLight.specular = new Color3(0.3, 0.9, 1);
    this.reactorLight.intensity = 3;
    this.reactorLight.range = 30;

    // Arena
    const arena = new ArenaBuilder(scene, this.pal, ARENA);
    arena.build();
    this.animated.push(...arena.animated);
    this.atmosphere.adoptPortals();
    this.reactor = buildReactor(scene, this.pal);

    this.player = new Player(scene, ARENA.playerSpawn);
    scene.activeCamera = this.player.camera;
    const weaponDef = weaponDefFor(cfg.loadout.weapon);
    if (!weaponDef) throw new Error('deployment requires an equipped weapon');
    this.weapon = new Weapon(scene, weaponDef, this.player, cfg.loadout.weapon);
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);

    this.fx = new Effects(scene, this.kit, this.pal, ARENA);
    this.wfx = new WeaponFx(scene);
    this.wfx.setColor(this.weapon.rig.energyBase);
    this.fx.onShake = (pos, strength) => {
      const d = Vector3.Distance(pos, this.player.position);
      const k = strength * Math.max(0, 1 - d / 38);
      if (k <= 0.01) return;
      this.player.addTrauma(k * 0.7);
      this.post.kick(k * 0.8);
    };
    // Shadows (high quality only); enemies & turrets register as casters via the kit.
    {
      // Cascaded shadows: crisp contact shadows near the player, coverage across the arena.
      const sg = high ? new CascadedShadowGenerator(2048, moon) : new ShadowGenerator(1024, moon);
      if (sg instanceof CascadedShadowGenerator) {
        sg.numCascades = 4;
        sg.lambda = 0.82;
        sg.stabilizeCascades = true;
        sg.shadowMaxZ = 140;
        sg.cascadeBlendPercentage = 0.08;
        sg.autoCalcDepthBounds = false;
      } else {
        moon.shadowMinZ = 1;
        moon.shadowMaxZ = 260;
      }
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = high ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_LOW;
      sg.bias = 0.004;
      sg.normalBias = 0.025;
      sg.darkness = 0;
      for (const m of arena.shadowCasters) sg.addShadowCaster(m);
      for (const m of this.reactor.root.getChildMeshes()) sg.addShadowCaster(m);
      this.kit.shadowSink = (m) => sg.addShadowCaster(m);
    }
    this.enemies = new EnemyManager(scene, this.kit, this.pal);
    this.turrets = new TurretManager(scene, this.kit, this.pal);
    this.construction = new Construction(scene, this.kit, this.pal, ARENA);
    this.loot = new LootField(scene, this.kit, this.pal);
    this.loot.onLand = (p) => this.onLootLanded(p);
    this.inventory = new RunInventory(cfg.loadout, cfg.run);
    this.lootRand = mulberry32(hashSeed(cfg.run.id));

    // Reflections/ambient: capture the finished static scene once into a prefiltered cube map.
    this.atmosphere.captureEnvironment([...arena.meshes, ...this.reactor.root.getChildMeshes()], this.pal.lit);

    this.post = new PostFx(scene, engine, this.player.camera, high);

    this.enemyCtx = {
      player: this.player,
      effects: this.fx,
      layout: ARENA,
      damageReactor: (a, at) => this.damageReactor(a, at),
      los: (a, b) => this.los(a, b),
      panFor: (p) => this.panFor(p),
    };
    this.turretCtx = {
      enemies: this.enemies.active,
      effects: this.fx,
      stats: this.stats,
      los: (a, b) => this.los(a, b),
      hitEnemy: (t, e, dmg, pt) => this.damageEnemy('turret', e, dmg, pt, false, t),
      panFor: (p) => this.panFor(p),
    };

    const run = cfg.run;
    this.waves = new WaveManager({
      spawn: (s, w) => this.enemies.spawn(s.kind, s.gate, ARENA, w.hpMult, w.damageMult, w.speedMult),
      aliveCount: () => this.enemies.count,
      onWaveStart: (w) => {
        this.checkpointOpen = false;
        // Armor is measured against the incoming wave's level.
        this.player.applyStats(this.stats, this.attackerScale);
        sfx.play('waveStart');
        uiEvents.emit('banner', { title: `WAVE ${w.number}`, sub: `${w.spawns.length} hostiles inbound`, tone: 'orange' });
      },
      onWaveCleared: (w) => {
        this.wallet.earn(w.clearReward);
        uiEvents.emit('coresGained', w.clearReward);
        this.reactorHp = Math.min(ECONOMY.reactorMaxHp, this.reactorHp + ECONOMY.reactorMaxHp * ECONOMY.reactorRepairPerWave);
        sfx.play('waveClear');
        const salvage = Math.round((ECONOMY.salvageWaveBase + w.number * ECONOMY.salvagePerWave) * cfg.tier.salvageMult);
        run.collect({ salvage });
        uiEvents.emit('salvageGained', salvage);
        run.waveCleared(w.number);
        // Wave reward drop lands on the reactor apron.
        this.dropLoot('wave', new Vector3(0, 3, -4.2), w.number);
        // Lifetime rule: uncollected loot from wave N expires once wave N+2 is cleared.
        const expired = this.loot.expire(w.number);
        if (expired.length) {
          this.dropsExpired += expired.length;
          if (this.lootTarget && expired.includes(this.lootTarget)) this.lootTarget = null;
          uiEvents.emit('loot', { kind: 'expired', count: expired.length, name: expired.length === 1 ? expired[0].item.name : `${expired.length} uncollected drops`, rarity: expired.reduce((m, p) => (rarity(p.item.rarity).index > rarity(m).index ? p.item.rarity : m), expired[0].item.rarity), level: 0, category: '' });
        }
        let banked = null;
        if (isCheckpointWave(w.number)) {
          // Milestone cache: granted with the checkpoint and banked together with everything collected.
          this.lastCache = this.rollItems('checkpoint', w.number);
          run.collect({ items: this.lastCache });
          banked = run.bank(w.number);
        }
        if (banked) {
          this.lastBankSaved = cfg.hooks.bank(w.number, banked);
          this.inventoryVersion++;
          const n = banked.items.length;
          if (this.lastBankSaved) {
            sfx.play('bank');
            uiEvents.emit('banner', { title: 'CHECKPOINT SECURED', sub: `Wave ${w.number} cleared · ${banked.salvage} salvage${n ? ` · ${n} item${n === 1 ? '' : 's'}` : ''} banked to HQ`, tone: 'cyan' });
          } else uiEvents.emit('banner', { title: 'CHECKPOINT · SAVE FAILED', sub: 'Rewards are held by the run but could not be written to storage yet', tone: 'red' });
        } else uiEvents.emit('banner', { title: `WAVE ${w.number} CLEARED`, sub: `+${w.clearReward} cores · +${salvage} salvage · reactor repaired`, tone: 'cyan' });
      },
      onPrepStart: (w) => {
        run.waveReached(w.number);
        if (w.number > 1 && run.atCheckpoint) {
          this.checkpointOpen = true;
          this.openCheckpoint();
        }
      },
    }, cfg.tier);

    this.player.onHurt = (amount, from) => {
      let angle: number | null = null;
      if (from) {
        const pp = this.player.position;
        angle = Math.atan2(from.x - pp.x, from.z - pp.z) - this.player.yaw;
      }
      uiEvents.emit('hurt', { severity: Math.min(1, amount / 30), angle });
      this.post.kick(Math.min(0.6, amount / 40));
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.screen === 'playing') this.setScreen('paused');
    };
    this.applySettings(settings);
    this.refreshEquipment();
  }

  // ---------------------------------------------------------------- lifecycle

  setScreen(s: Screen): void {
    this.screen = s;
    this.weapon.setVisible(s !== 'menu' && s !== 'loading');
    hudStore.set({ screen: s, location: 'arena' });
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.player.sensitivity = s.sensitivity;
    // User FOV is horizontal at 16:9; convert to the vertical FOV Babylon uses.
    const h = (s.fov * Math.PI) / 180;
    this.player.baseFov = 2 * Math.atan(Math.tan(h / 2) / (16 / 9));
    sfx.setVolume(s.volume);
    saveSettings(s);
  }

  /** Enemy level scale for armor (same growth as flat item stats at this wave/tier). */
  get attackerScale(): number {
    return flatScale(this.waves.number + this.cfg.tier.lootLevelBonus);
  }

  /**
   * Recompute every derived stat from the run loadout. Called only when equipment
   * changes (never per frame); replacing an item removes its old modifiers by
   * construction because the list is rebuilt from scratch.
   */
  refreshEquipment(): void {
    const s = computeStats([...equipmentModifiers(this.inventory.equippedItems()), ...this.modifiers]);
    Object.assign(this.stats, s);
    const item = this.inventory.equipped('weapon');
    const w = weaponDefFor(item);
    if (w) {
      this.weapon.setItem(item, w);
      this.wfx.setColor(this.weapon.rig.energyBase);
    }
    this.player.applyStats(this.stats, this.attackerScale);
    this.tactical.rechargeMult = this.stats.tacticalRechargeMult;
    this.inventoryVersion++;
  }

  /** Equipment changes are allowed only between waves (preparation phase). */
  get equipAllowed(): boolean {
    return this.waves.phase === 'prep' && !this.cfg.run.ended && this.screen !== 'defeat';
  }

  equip(uid: string, slot?: SlotId): boolean {
    const r = this.inventory.equip(uid, this.equipAllowed, slot);
    if (r !== 'ok') {
      sfx.play('buildDeny');
      return false;
    }
    this.refreshEquipment();
    sfx.play('equip');
    return true;
  }

  unequip(slot: SlotId): boolean {
    const r = this.inventory.unequip(slot, this.equipAllowed);
    if (r !== 'ok') {
      sfx.play('buildDeny');
      return false;
    }
    this.refreshEquipment();
    sfx.play('ui');
    return true;
  }

  /** Discard an unsecured item (preparation only). */
  discard(uid: string): boolean {
    if (!this.inventory.discard(uid, this.equipAllowed)) {
      sfx.play('buildDeny');
      return false;
    }
    this.inventoryVersion++;
    sfx.play('recycle');
    return true;
  }

  // ---------------------------------------------------------------- loot

  private lootContext(wave: number) {
    return { wave, tierLevelBonus: this.cfg.tier.lootLevelBonus, tierLuck: this.cfg.tier.lootLuck };
  }

  /** Roll a source's drops and generate the items (deterministic per run seed). */
  rollItems(source: DropSourceId, wave = this.waves.number): ItemInstance[] {
    const src = DROP_SOURCES[source];
    const table = this.dropChanceMult === 1 ? src : { ...src, chance: Math.min(1, src.chance * this.dropChanceMult) };
    const run = this.cfg.run;
    return rollDrops(table, this.lootContext(wave), this.lootRand).map((d) =>
      generateItem({ uid: `${run.id}.${++this.lootCounter}`, seed: d.seed, level: d.level, rarity: d.rarity, category: d.category, baseId: d.baseId, allowExclusive: d.baseId ? [d.baseId] : [], source: run.id }),
    );
  }

  /** Roll drops for a source and place them physically around `at`. */
  dropLoot(source: DropSourceId, at: Vector3, wave = this.waves.number): Pickup[] {
    const out: Pickup[] = [];
    for (const item of this.rollItems(source, wave)) {
      const p = this.spawnPickup(item, at, wave);
      if (p) out.push(p);
    }
    return out;
  }

  /** Place one generated item in the world (or convert it under the saturation rule). */
  spawnPickup(item: ItemInstance, at: Vector3, wave = this.waves.number): Pickup | null {
    if (convertsToSalvage(this.loot.count, item.rarity)) {
      const v = scrapValue(item);
      this.cfg.run.collect({ salvage: v });
      uiEvents.emit('salvageGained', v);
      this.dropsConverted++;
      return null;
    }
    const ground = this.groundPoint(at);
    const p = this.loot.spawn(item, at, ground, wave);
    this.dropsSpawned++;
    return p;
  }

  /** A walkable landing point near `at` (Havok ray down; never on top of tall geometry). */
  private groundPoint(at: Vector3): Vector3 {
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = attempt === 5 ? 0 : 1 + Math.random() * 1.8;
      const x = at.x + Math.cos(a) * d;
      const z = at.z + Math.sin(a) * d;
      if (!physics) return new Vector3(x, 0, z);
      physics.raycastToRef(TMP.set(x, Math.max(at.y, 0) + 2.5, z), TMP2.set(x, -3, z), this.physResult, ENV_QUERY);
      if (!this.physResult.hasHit) continue;
      const y = this.physResult.hitPointWorld.y;
      if (y > at.y + 1.2 || this.physResult.hitNormalWorld.y < 0.7) continue;
      // Not inside a wall: the hologram's focus must be visible from slightly above.
      return new Vector3(x, y, z);
    }
    return new Vector3(at.x, 0, at.z);
  }

  private onLootLanded(p: Pickup): void {
    const r = rarity(p.item.rarity);
    const c = LootField.color(p.item.rarity);
    this.fx.ring(p.ground.add(new Vector3(0, 0.08, 0)), 1.2 + r.index * 0.5, 0.45 + r.index * 0.08, c.scale(0.8), true);
    if (r.index >= 2) {
      this.fx.flashLight(p.focus, 1.5 + r.index, 0.5 + r.index * 0.12, c.scale(0.4));
      const a = this.panFor(p.ground);
      sfx.play('lootDrop', { pitch: 0.8 + r.index * 0.12, volume: Math.max(0.5, a.volume), pan: a.pan });
    }
    uiEvents.emit('loot', { kind: 'drop', name: p.item.name, rarity: p.item.rarity, level: p.item.level, category: p.item.category, count: 1 });
    if (r.index >= 4) uiEvents.emit('banner', { title: `${r.label.toUpperCase()} SIGNAL`, sub: p.item.name, tone: r.index >= 5 ? 'red' : 'orange' });
  }

  /** Pick up a pickup: into the run cargo (unsecured), or refuse when the hold is full. */
  collectPickup(p: Pickup): boolean {
    if (!this.loot.landed(p) || !this.player.alive) return false;
    if (!this.inventory.collect(p.item)) {
      sfx.play('buildDeny');
      uiEvents.emit('loot', { kind: 'full', name: p.item.name, rarity: p.item.rarity, level: p.item.level, category: p.item.category, count: 1 });
      return false;
    }
    const r = rarity(p.item.rarity);
    const c = LootField.color(p.item.rarity);
    this.fx.burst('build', p.focus, 14 + r.index * 8);
    this.fx.ring(p.ground.add(new Vector3(0, 0.1, 0)), 2 + r.index * 0.6, 0.35, c, true);
    if (r.index >= 3) this.fx.flashLight(p.focus, 2 + r.index, 0.35, c.scale(0.5));
    sfx.play('pickup', { pitch: 1 + r.index * 0.1, volume: 0.8 + r.index * 0.05 });
    this.loot.remove(p);
    if (this.lootTarget === p) this.lootTarget = null;
    this.inventoryVersion++;
    uiEvents.emit('loot', { kind: 'pickup', name: p.item.name, rarity: p.item.rarity, level: p.item.level, category: p.item.category, count: 1 });
    return true;
  }

  private updateLootTarget(controls: boolean): void {
    this.lootTarget = null;
    if (!this.player.alive || this.construction.active || this.loot.count === 0) return;
    const eye = this.player.eye;
    const dir = this.player.forward(TMP);
    // Distance prefilter first: only pickups within reach go through the cone/occlusion test.
    const r2 = (PICKUP_RANGE + 0.5) * (PICKUP_RANGE + 0.5);
    const cands: { id: string; point: Vector3; range: number; p: Pickup }[] = [];
    for (const p of this.loot.pickups) {
      if (!this.loot.landed(p)) continue;
      const dx = p.focus.x - eye.x;
      const dz = p.focus.z - eye.z;
      if (dx * dx + dz * dz <= r2) cands.push({ id: '', point: p.focus, range: PICKUP_RANGE, p });
    }
    if (!cands.length) return;
    const hit = pickInteractable(cands, eye, dir, { maxAngle: 0.42, targetRadius: 0.6 }, (c) => !this.los(eye, c.point));
    this.lootTarget = hit?.p ?? null;
    if (controls && this.lootTarget && this.input.pressed('KeyE')) this.collectPickup(this.lootTarget);
  }

  /** Arena inventory (I / Tab). Inspection is always allowed; changes only in preparation. */
  openInventory(): void {
    if (this.screen !== 'playing') return;
    this.screenBeforeInventory = this.screen;
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.setScreen('inventory');
    this.publishHud(true);
    this.input.releaseLock();
  }

  async closeInventory(): Promise<void> {
    if (this.screen !== 'inventory') return;
    sfx.play('ui');
    this.setScreen(this.screenBeforeInventory === 'playing' ? 'paused' : this.screenBeforeInventory);
    await this.resume();
  }

  recomputeStats(): void {
    this.refreshEquipment();
  }

  /** Enter the arena: fresh run state, preparation phase of wave 1. */
  start(): void {
    this.newRun();
    this.setScreen(this.input.captured || this.input.isLockedNow() ? 'playing' : 'paused');
    this.canvas.focus();
  }

  async resume(): Promise<void> {
    sfx.init();
    await this.input.requestLock();
    if (this.input.captured) this.setScreen('playing');
  }

  /** Checkpoint choice: release the mouse and freeze the (prep-phase) simulation. */
  openCheckpoint(): void {
    if (!this.checkpointOpen || this.screen === 'defeat') return;
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.setScreen('checkpoint');
    this.publishHud(true);
    this.input.releaseLock();
  }

  /** Continue survival from the checkpoint (return option stays available during prep). */
  async continueRun(): Promise<void> {
    if (this.screen !== 'checkpoint') return;
    sfx.play('ui');
    await this.resume();
    if (this.screen === 'checkpoint') this.setScreen('paused');
  }

  get canReturnHome(): boolean {
    return this.checkpointOpen && this.cfg.run.atCheckpoint && this.waves.phase === 'prep' && this.screen !== 'defeat';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.onLockChange = () => {};
    sfx.setTactical(false);
    sfx.beamLoop(false);
    this.scene.dispose();
  }

  private newRun(): void {
    this.enemies.clear();
    this.turrets.clear();
    this.fx.reset();
    this.wfx.reset();
    this.player.reset();
    this.weapon.reset();
    this.tactical.reset();
    this.wallet.reset();
    this.loot.clear();
    this.lootTarget = null;
    this.modifiers = [];
    this.refreshEquipment();
    this.player.reset();
    this.reactorHp = ECONOMY.reactorMaxHp;
    this.runTime = 0;
    this.kills = 0;
    this.turretsBuilt = 0;
    this.defeatT = 0;
    this.inspected = null;
    this.construction.setActive(false);
    this.weapon.setHolstered(false);
    this.waves.reset();
    sfx.setTactical(false);
    this.publishHud(true);
  }

  // ---------------------------------------------------------------- frame

  /** Advance one frame of simulation (rendering is done by the flow). */
  step(dt: number, fps = 60): void {
    if (this.disposed) return;
    if (Number.isFinite(fps)) this.fpsSmooth += (fps - this.fpsSmooth) * 0.05;
    if (this.screen === 'playing' || this.screen === 'defeat') this.update(dt);
    else this.idleAnimate(dt);
  }

  private idleAnimate(dt: number): void {
    const flash = this.updateSky(dt);
    this.post.update(dt, 0, 0, flash);
    this.updateReactor(dt, false);
    for (const a of this.animated) a.node.rotation.addInPlace(a.spin.scale(dt));
  }

  private update(dt: number): void {
    const input = this.input;
    const playing = this.screen === 'playing';
    const controls = playing && input.captured;

    // ---- global keys
    if (controls) {
      if (input.pressed('F3')) this.togglePerf();
      if (input.pressed('KeyG')) this.waves.startNow();
      if (input.pressed('KeyQ')) this.toggleTactical();
      if (input.pressed('Digit2') || input.pressed('KeyB')) this.setBuildMode(!this.construction.active);
      if (input.pressed('Digit1')) this.setBuildMode(false);
      if (this.construction.active && input.mousePressed(2)) this.setBuildMode(false);
      if (input.pressed('KeyH') && this.canReturnHome) this.openCheckpoint();
      if (input.pressed('KeyI') || input.pressed('Tab')) {
        this.openInventory();
        return;
      }
    }

    this.tactical.update(dt);
    if (!this.tactical.active && this.wasTactical) {
      this.wasTactical = false;
      sfx.play('tacticalOff');
      sfx.setTactical(false);
    }
    const hdt = this.screen === 'defeat' ? dt * 0.15 : dt * this.tactical.hostileScale;

    if (playing) {
      this.runTime += dt;
      this.cfg.run.tick(dt);
    }
    this.player.update(dt, input, this.stats.moveSpeedMult, controls);

    // ---- building
    if (this.construction.active) {
      this.construction.update(this.player, this.wallet.cores, this.turrets.turrets, this.stats);
      if (controls && input.mousePressed(0)) this.tryPlace();
    }

    // ---- shooting
    const trigger = controls && input.mouse(0) && !this.construction.active;
    this.weapon.update(dt, trigger, this.stats, this.shoot, this.weaponFx);
    this.wfx.update(dt, this.player.camera.position);

    // ---- inspect / recycle, loot
    this.updateInspect(dt, controls);
    this.updateLootTarget(controls);
    this.loot.update(dt);

    // ---- simulation (hostile time)
    if (this.screen === 'playing') this.waves.update(dt, hdt);
    this.enemies.update(hdt, this.enemyCtx);
    this.turretCtx.stats = this.stats;
    this.turrets.update(dt, this.turretCtx);
    this.updateProjectiles(hdt);
    this.fx.update(dt);
    this.updateReactor(dt, true);

    // Atmosphere and grade: tactical desaturates/cools, damage punches the lens.
    const k = (1 - this.tactical.hostileScale) / (1 - TacticalEnergy.HOSTILE_SCALE);
    const flash = this.updateSky(dt);
    this.hurtFx = Math.max(this.player.hurtFlash, this.player.alive ? 0 : 0.8);
    this.post.update(dt, k, this.hurtFx, flash);

    for (const a of this.animated) a.node.rotation.addInPlace(a.spin.scale(hdt));

    if (this.screen === 'defeat') {
      this.defeatT += dt;
      if (this.defeatT > 2.2 && this.input.locked) this.input.releaseLock();
    }

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 1 / 20;
      this.publishHud();
    }
  }

  /** Storm: sky lightning brightens the moonlight and rolls thunder. */
  private updateSky(dt: number): number {
    const flash = this.atmosphere.update(dt, this.player.camera.position);
    if (flash > 0.9 && this.lastFlash < 0.5) sfx.thunder(0.4 + Math.random() * 1.2);
    this.lastFlash = flash;
    this.moon.intensity = SUN + flash * 0.4;
    return flash;
  }

  togglePerf(on = !this.perfOn): void {
    this.perfOn = on;
    if (on && !this.instrumentation) this.instrumentation = new SceneInstrumentation(this.scene);
  }

  get drawCalls(): number {
    return Math.round(this.instrumentation?.drawCallsCounter.current ?? 0);
  }

  private wasTactical = false;
  private toggleTactical(): void {
    if (this.tactical.toggle()) {
      if (this.tactical.active) {
        this.wasTactical = true;
        sfx.play('tacticalOn');
        sfx.setTactical(true);
        this.setBuildMode(true);
      }
    } else sfx.play('buildDeny');
  }

  private setBuildMode(on: boolean): void {
    if (on === this.construction.active) return;
    this.construction.setActive(on);
    this.weapon.setHolstered(on);
    sfx.play('ui');
  }

  private tryPlace(): void {
    const c = this.construction;
    const cost = towerCost(SENTINEL, this.stats.buildCostMult);
    if (!c.valid || !this.wallet.spend(cost)) {
      sfx.play('buildDeny');
      return;
    }
    this.turrets.add(c.point, this.player.yaw).paid = cost;
    this.turretsBuilt++;
    this.fx.burst('build', c.point.add(new Vector3(0, 0.5, 0)), 40);
    // Rapid multi-placement while tactical mode is active.
    if (!this.tactical.active) this.setBuildMode(false);
  }

  private updateInspect(dt: number, controls: boolean): void {
    let t: Turret | null = null;
    if (controls && !this.construction.active) {
      const cam = this.player.camera;
      this.shotRay.origin.copyFrom(cam.position);
      cam.getDirectionToRef(Vector3.Forward(), this.shotRay.direction);
      this.shotRay.length = 30;
      const hit = this.scene.pickWithRay(this.shotRay, (m) => (!!m.metadata?.turret || !!m.metadata?.surface) && m.isEnabled());
      const meta = hit?.pickedMesh?.metadata as TurretHitboxMeta | undefined;
      if (meta?.turret && !meta.turret.building) t = meta.turret;
    }
    if (t !== this.inspected) this.recycleT = 0;
    this.inspected = t;
    this.construction.showInspect(t, this.stats);
    if (t && this.input.isDown('KeyX')) {
      this.recycleT += dt / 0.6;
      if (this.recycleT >= 1) {
        const refund = Math.round(t.paid * t.def.refundRatio);
        this.wallet.earn(refund);
        uiEvents.emit('coresGained', refund);
        this.fx.burst('build', t.head, 30);
        this.fx.debrisBurst(t.head, 6, 4, 0.8);
        this.turrets.remove(t);
        sfx.play('recycle');
        this.inspected = null;
        this.recycleT = 0;
      }
    } else this.recycleT = 0;
  }

  // ---------------------------------------------------------------- combat

  /**
   * Player hitscan: level surfaces and enemy hitboxes (turrets are see-through).
   * Rail slugs continue through `pierce` further enemies (15% less damage each) until a
   * surface stops them; beams get an aim-assist radius (`width`) around their axis.
   * Damage is applied here, immediately; `weaponFx` only visualises the outcome.
   */
  private shoot = (r: ShotRequest): ShotOutcome => {
    // Hitboxes must reflect this frame's enemy poses, not last frame's render.
    for (const e of this.enemies.active) {
      e.root.computeWorldMatrix(true);
      for (const h of e.hitboxes) h.computeWorldMatrix(true);
    }
    this.shotRay.origin.copyFrom(r.origin);
    this.shotRay.direction.copyFrom(r.dir);
    this.shotRay.length = r.range;
    const hits = this.scene.multiPickWithRay(this.shotRay, (m: AbstractMesh) => (!!m.metadata?.surface || !!m.metadata?.enemy) && m.isEnabled()) ?? [];
    hits.sort((a, b) => a.distance - b.distance);
    const wallIdx = hits.findIndex((h) => !!(h.pickedMesh!.metadata as { surface?: string }).surface);
    const wall = wallIdx >= 0 ? hits[wallIdx] : null;
    const maxDist = wall ? wall.distance : r.range;
    const struck: Enemy[] = [];
    let first: { point: Vector3; target: 'enemy' | 'shield' } | null = null;
    let dmg = r.damage;
    for (const h of hits) {
      if (h.distance > maxDist) break;
      const meta = h.pickedMesh!.metadata as Partial<EnemyHitboxMeta>;
      const e = meta.enemy;
      if (!e || struck.includes(e) || !e.alive) continue;
      let weak = !!meta.weak;
      if (!weak) {
        // Weakpoint overlapping the body sphere still counts if the ray passes through it.
        const w = hits.find((x) => (x.pickedMesh!.metadata as EnemyHitboxMeta | null)?.enemy === e && (x.pickedMesh!.metadata as EnemyHitboxMeta).weak);
        if (w && w.distance - h.distance < 0.6) weak = true;
      }
      const shielded = e.shield > 0;
      struck.push(e);
      const point = h.pickedPoint!.clone();
      if (!first) first = { point, target: shielded ? 'shield' : 'enemy' };
      this.damageEnemy('player', e, dmg, point, weak, undefined, r.family);
      if (struck.length > r.pierce) break;
      dmg *= 0.85;
    }
    // Beam aim assist: nearest enemy body within `width` of the axis, in front of the wall.
    if (!first && r.width > 0) {
      let best: Enemy | null = null;
      let bestT = Infinity;
      for (const e of this.enemies.active) {
        if (!e.alive) continue;
        const c = e.center(TMP);
        const t = (c.x - r.origin.x) * r.dir.x + (c.y - r.origin.y) * r.dir.y + (c.z - r.origin.z) * r.dir.z;
        if (t <= 0 || t > maxDist || t >= bestT) continue;
        const px = r.origin.x + r.dir.x * t - c.x;
        const py = r.origin.y + r.dir.y * t - c.y;
        const pz = r.origin.z + r.dir.z * t - c.z;
        const rr = e.def.bodyR * e.def.scale + r.width;
        if (px * px + py * py + pz * pz <= rr * rr) {
          best = e;
          bestT = t;
        }
      }
      if (best) {
        const point = r.origin.add(r.dir.scale(bestT - best.def.bodyR * 0.6));
        first = { point, target: best.shield > 0 ? 'shield' : 'enemy' };
        struck.push(best);
        this.damageEnemy('player', best, dmg, point, false, undefined, 'beam');
      }
    }
    if (first) return { point: first.point, normal: null, target: first.target, enemyId: struck[0].id };
    if (wall) {
      const n = wall.getNormal(true, true) ?? Vector3.Up();
      return { point: wall.pickedPoint!.clone(), normal: n, target: 'surface', enemyId: null };
    }
    return { point: r.origin.add(r.dir.scale(r.range)), normal: null, target: 'none', enemyId: null };
  };

  /** World-space shot visuals and impacts per family (presentation only). */
  private beamFxT = 0;
  private weaponFx: WeaponFxHooks = {
    shot: (family, from, out, power, speed) => {
      const impact = () => this.impactFx(family, out, power);
      if (family === 'plasma') {
        this.wfx.bolt(from, out.point, speed, 0.34, out.target === 'none' ? null : impact);
      } else if (family === 'rail') {
        this.wfx.rail(from, out.point, power);
        this.fx.ring(from, 0.22 + 0.18 * power, 0.12, this.weapon.rig.energyBase.scale(0.5), false);
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
    beam: (on, from, to, intensity, contact) => this.wfx.beam(on, from, to, intensity, contact),
  };

  private impactFx(family: WeaponFamily, out: ShotOutcome, power: number): void {
    const p = out.point;
    if (out.target === 'surface' && out.normal) {
      const pos = p.add(out.normal.scale(0.03));
      if (family === 'rail') {
        this.fx.impact(pos, out.normal);
        this.fx.burst('sparks', pos, Math.round(8 + 10 * power), out.normal, 0.7);
        this.fx.ring(pos, 1.6 * power + 0.6, 0.25, this.weapon.rig.energyBase.scale(0.5), false);
        this.fx.flashLight(pos, 3 * power, 0.18, this.weapon.rig.energyBase.scale(0.4));
      } else if (family === 'beam') {
        this.fx.burst('impact', pos, 3, out.normal);
        this.fx.burst('puff', pos, 1, out.normal);
      } else this.fx.impact(pos, out.normal);
    } else if (out.target === 'shield') {
      this.fx.burst('shield', p, family === 'rail' ? 24 : 8, undefined, family === 'rail' ? 1.5 : 1);
      if (family === 'rail') this.fx.ring(p, 2.4, 0.25, new Color3(2.6, 0.9, 0.2), false);
    } else if (out.target === 'enemy') {
      if (family === 'rail') {
        this.fx.burst('sparks', p, 14, undefined, 0.8);
        this.fx.debrisBurst(p, 3, 5, 0.6);
      } else if (family === 'beam') this.fx.burst('enemySpark', p, 4, undefined, 0.8);
    }
  }

  damageEnemy(source: 'player' | 'turret', e: Enemy, base: number, point: Vector3, weakpoint: boolean, turret?: Turret, family?: WeaponFamily | 'arc'): void {
    const roll = rollDamage(base, this.stats, weakpoint, Math.random, 'energy', source);
    // Arc Conductor: a player hit may jump to the nearest other enemy (no chains of arcs).
    if (source === 'player' && family !== 'arc' && this.stats.arcChance > 0 && Math.random() < this.stats.arcChance) this.arcFrom(e, point, roll.amount * this.stats.arcDamage);
    const res = this.enemies.damage(e, roll.amount, 'energy', point, this.fx);
    if (!res) return;
    let kind: HitKind = res.toHp === 0 && res.toShield > 0 ? 'shield' : roll.crit ? 'crit' : 'hit';
    if (turret) turret.damageDealt += roll.amount;
    if (res.killed) {
      kind = 'kill';
      if (turret) turret.kills++;
      this.onEnemyKilled(e);
    }
    if (source === 'player') {
      uiEvents.emit('hit', kind);
      // Beam ticks are frequent: lighter per-tick feedback (the beam contact carries the rest).
      const beam = family === 'beam';
      if (kind === 'crit') this.fx.burst('crit', point, beam ? 3 : 10);
      else if (kind === 'hit' && !beam) this.fx.burst('enemySpark', point, 6);
      if (!beam || kind === 'kill' || kind === 'crit') sfx.play(kind === 'kill' ? 'kill' : kind === 'crit' ? 'crit' : kind === 'shield' ? 'shieldHit' : 'hit');
      else sfx.play('hit', { volume: 0.35 });
    }
    // Turret numbers far from the player are noise; kills always show.
    if (source === 'player' || kind === 'kill' || Vector3.DistanceSquared(point, this.player.position) < 25 * 25) {
      uiEvents.emit('damageNumber', { x: point.x, y: point.y, z: point.z, amount: Math.round(roll.amount), kind, player: source === 'player' });
    }
  }

  /** Arc to the nearest other living enemy within 8 m of the struck one. */
  private arcFrom(src: Enemy, point: Vector3, amount: number): void {
    if (amount <= 0) return;
    let best: Enemy | null = null;
    let bestD = 8 * 8;
    for (const o of this.enemies.active) {
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
    this.wfx.arc(point, to);
    this.fx.burst('impact', to, 8);
    sfx.play('arc', { volume: 0.7 });
    this.damageEnemy('player', best, amount, to, false, undefined, 'arc');
  }

  private onEnemyKilled(e: Enemy): void {
    this.kills++;
    this.wallet.earn(e.def.reward);
    uiEvents.emit('coresGained', e.def.reward);
    const salvage = Math.round(e.def.salvage * this.cfg.tier.salvageMult);
    if (this.cfg.run.collect({ salvage })) uiEvents.emit('salvageGained', salvage);
    this.cfg.run.addKill();
    this.dropLoot(e.kind as DropSourceId, e.center().clone());
    this.enemies.kill(e, this.fx, this.enemyCtx);
  }

  /** Automation hook: same path as enemy attacks. */
  debugDamageReactor(amount: number): void {
    this.damageReactor(amount, new Vector3(0, 2, 0));
  }

  private damageReactor(amount: number, at: Vector3): void {
    if (this.reactorHp <= 0) return;
    this.reactorHp = Math.max(0, this.reactorHp - amount);
    this.reactorHitT = 1;
    if (this.reactorSfxT <= 0) {
      this.reactorSfxT = 0.25;
      const a = this.panFor(at);
      sfx.play('reactorHit', { volume: Math.max(0.5, a.volume), pan: a.pan });
    }
    if (this.reactorHp <= 0) this.onDefeat();
  }

  private onDefeat(): void {
    if (this.screen !== 'playing') return;
    this.setScreen('defeat');
    this.defeatT = 0;
    this.tactical.deactivate();
    this.setBuildMode(false);
    const c = new Vector3(0, 4, 0);
    this.fx.explode(c, { scale: 4, color: new Color3(0.6, 1.6, 2.2), debris: 30 });
    this.fx.burst('explosion', c, 160, undefined, 3);
    this.fx.flashLight(c, 14, 1.8, new Color3(0.4, 0.9, 1));
    sfx.play('explosion', { volume: 1, pitch: 0.5 });
    hudStore.set({ stats: { kills: this.kills, time: this.runTime, wave: this.waves.number, coresEarned: this.wallet.earned, turretsBuilt: this.turretsBuilt } });
    this.cfg.hooks.defeat();
  }

  /** Run statistics shown on the summary screens. */
  get runStats() {
    return { kills: this.kills, time: this.runTime, wave: this.waves.number, coresEarned: this.wallet.earned, turretsBuilt: this.turretsBuilt };
  }

  private updateProjectiles(hdt: number): void {
    if (hdt <= 0) return;
    const player = this.player;
    const pc = TMP2.copyFrom(player.eye);
    pc.y -= 0.3;
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
    for (const p of this.fx.projectiles) {
      if (!p.active) continue;
      const next = TMP.copyFrom(p.vel).scaleInPlace(hdt).addInPlace(p.pos);
      // Player (segment vs sphere)
      if (player.alive && segmentSphere(p.pos, next, pc, 0.8)) {
        player.damage(p.damage, p.pos.subtract(p.vel));
        this.fx.burst('enemySpark', next, 10);
        this.fx.killProjectile(p);
        continue;
      }
      if (physics) {
        physics.raycastToRef(p.pos, next, this.physResult, ENV_QUERY);
        if (this.physResult.hasHit) {
          this.fx.burst('enemySpark', this.physResult.hitPointWorld, 8, this.physResult.hitNormalWorld);
          this.fx.killProjectile(p);
          continue;
        }
      }
      p.pos.copyFrom(next);
      p.mesh.position.copyFrom(next);
      p.life -= hdt;
      if (p.life <= 0) this.fx.killProjectile(p);
    }
  }

  private updateReactor(dt: number, live: boolean): void {
    this.reactorHitT = Math.max(0, this.reactorHitT - dt * 2.5);
    this.reactorSfxT -= dt;
    const f = live ? this.reactorHp / ECONOMY.reactorMaxHp : 1;
    for (let i = 0; i < this.reactor.rings.length; i++) this.reactor.rings[i].rotation.y += dt * (0.4 + i * 0.3) * (i % 2 ? -1 : 1) * (0.5 + f);
    this.reactor.update(dt, f);
    // Integrity colour: cyan -> amber -> red, flashing white-orange when struck.
    const danger = 1 - f;
    const flicker = f < 0.3 ? 0.75 + 0.25 * Math.sin(performance.now() * 0.02) : 1;
    const h = this.reactorHitT;
    const core = this.reactor.coreMat.emissiveColor;
    core.set(
      (0.3 + danger * 2.2 + h * 1.5) * flicker,
      (2.0 - danger * 1.4 + h * 0.4) * flicker,
      (2.4 - danger * 2.3) * flicker,
    );
    this.reactorLight.diffuse.set(0.3 + danger * 0.7, 0.9 - danger * 0.5, 1 - danger * 0.8);
    this.reactorLight.intensity = (3 + h * 2.5 + Math.sin(performance.now() * 0.004) * 0.2) * flicker;
    this.reactor.beamMat.alpha = 0.18 + 0.2 * f;
  }

  // ---------------------------------------------------------------- queries

  private los(a: Vector3, b: Vector3): boolean {
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
    if (!physics) return true;
    physics.raycastToRef(a, b, this.physResult, ENV_QUERY);
    return !this.physResult.hasHit;
  }

  panFor(p: Vector3): { pan: number; volume: number } {
    const pp = this.player.position;
    const dx = p.x - pp.x;
    const dz = p.z - pp.z;
    const dist = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz) - this.player.yaw;
    return { pan: dist < 1 ? 0 : Math.sin(ang) * 0.8, volume: Math.max(0.12, Math.min(1, 1.15 - dist / 60)) };
  }

  /** World -> screen pixels (CSS) for UI overlays. Returns null if behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const cam = this.player.camera;
    const view = cam.getViewMatrix();
    const local = Vector3.TransformCoordinates(TMP.set(x, y, z), view);
    if (local.z <= 0.1) return null;
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const p = Vector3.Project(TMP.set(x, y, z), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const scale = this.canvas.clientWidth / w;
    return { x: p.x * scale, y: p.y * scale };
  }

  // ---------------------------------------------------------------- HUD

  private publishHud(force = false): void {
    const w = this.waves;
    const c = this.construction;
    const t = this.inspected;
    let hint = '';
    if (this.screen === 'playing') {
      if (w.phase === 'prep' && w.number === 1) hint = 'Build Sentinel turrets beside the orange enemy lanes (2 / B). Press G to start the wave.';
      else if (w.phase === 'prep') hint = 'Preparation: build and reposition. Press G to start early.';
      else if (w.number === 1 && w.phase === 'combat' && this.kills < 3) hint = 'Aim for the glowing visors: weakpoints always crit.';
      else if (w.number === 2 && w.phase === 'combat' && this.tactical.energy >= 99 && !this.tactical.active) hint = 'Q: tactical slow-time lets you place several turrets mid-fight.';
      if (this.canReturnHome) hint = 'Checkpoint secured. Press H to return to HQ, or start the next wave with G.';
    }
    if (!this.player.alive || c.active) hint = '';
    const run = this.cfg.run;
    const lt = this.lootTarget;
    let lootTarget: LootTargetInfo | null = null;
    if (lt && this.screen === 'playing') {
      const cur = this.inventory.equipped(this.inventory.targetSlot(lt.item) ?? 'weapon');
      lootTarget = {
        uid: lt.item.uid,
        name: lt.item.name,
        rarity: lt.item.rarity,
        level: lt.item.level,
        category: lt.item.category,
        expiresAfterWave: expiresAfterWave(lt.droppedWave),
        expiring: lt.expiring,
        cargoFull: this.inventory.cargoFull,
        equippedName: lt.item.category === 'module' ? null : (cur?.name ?? null),
        equippedLevel: cur?.level ?? 0,
        equippedRarity: cur?.rarity ?? null,
      };
    }
    hudStore.set({
      lootTarget,
      cargo: this.inventory.cargoUsed,
      cargoMax: this.inventory.cargoCapacity,
      equipAllowed: this.equipAllowed,
      inventoryVersion: this.inventoryVersion,
      playerShield: this.player.shield,
      playerShieldMax: this.player.maxShield,
      location: 'arena',
      run: {
        tier: this.cfg.tier.id,
        salvageUnsecured: run.unsecured.salvage,
        salvageSecured: run.secured.salvage,
        nextCheckpoint: nextCheckpoint(run.wavesCleared + 1),
        checkpointOpen: this.canReturnHome,
        lastBankedWave: run.lastBankedWave,
        kills: run.kills,
        duration: run.duration,
      },
      wave: w.number,
      phase: w.phase,
      phaseTimer: Math.max(0, w.timer),
      enemiesLeft: w.enemiesLeft,
      reactorHp: this.reactorHp,
      reactorMax: ECONOMY.reactorMaxHp,
      reactorUnderAttack: this.reactorHitT > 0,
      playerHp: this.player.hp,
      playerMax: this.player.maxHp,
      respawnIn: this.player.alive ? 0 : this.player.respawnT,
      cores: this.wallet.cores,
      weaponName: this.weapon.def.name,
      heat: this.weapon.heat / 100,
      overheated: this.weapon.overheated,
      dashCharges: this.player.dashCharges,
      dashMax: 2,
      dashRecharge: this.player.dashRecharge,
      tactical: this.tactical.energy / TacticalEnergy.MAX,
      tacticalActive: this.tactical.active,
      tacticalMin: TacticalEnergy.MIN_TO_ACTIVATE / TacticalEnergy.MAX,
      buildMode: c.active,
      buildValid: c.valid,
      buildMessage: c.message,
      buildCost: towerCost(SENTINEL, this.stats.buildCostMult),
      inspect: t ? { name: t.def.name, kills: t.kills, damage: Math.round(t.damageDealt), refund: Math.round(t.paid * t.def.refundRatio), recycle: this.recycleT } : null,
      hint,
      spread: 6 + this.weapon.spread * 900,
      perf: this.perfOn
        ? { fps: Math.round(this.fpsSmooth), enemies: this.enemies.count, draws: this.drawCalls, particles: this.fx.particleCount }
        : null,
    });
    void force;
  }

  /** Compact state for automation/debugging. */
  snapshot() {
    return {
      screen: this.screen,
      wave: this.waves.number,
      phase: this.waves.phase,
      enemies: this.enemies.count,
      reactorHp: this.reactorHp,
      cores: this.wallet.cores,
      turrets: this.turrets.turrets.length,
      kills: this.kills,
      playerPos: this.player.position.asArray(),
      playerHp: this.player.hp,
      tactical: this.tactical.energy,
      hostileScale: this.tactical.hostileScale,
      fps: Math.round(this.fpsSmooth),
      checkpointOpen: this.checkpointOpen,
      canReturnHome: this.canReturnHome,
      salvageUnsecured: this.cfg.run.unsecured.salvage,
      salvageSecured: this.cfg.run.secured.salvage,
      tier: this.cfg.tier.id,
      wavesCleared: this.cfg.run.wavesCleared,
      pickups: this.loot.count,
      lootTarget: this.lootTarget?.item.uid ?? null,
      cargo: this.inventory.cargoUsed,
      itemsUnsecured: this.cfg.run.unsecured.items.length,
      itemsSecured: this.cfg.run.secured.items.length,
      equipped: Object.fromEntries(Object.entries(this.inventory.loadout)),
      playerShield: this.player.shield,
      playerMaxShield: this.player.maxShield,
      playerMaxHp: this.player.maxHp,
      weaponDamage: this.weapon.def.damage,
      stats: { ...this.stats },
    };
  }
}

function segmentSphere(a: Vector3, b: Vector3, c: Vector3, r: number): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - c.x;
  const dy = a.y + aby * t - c.y;
  const dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz < r * r;
}
