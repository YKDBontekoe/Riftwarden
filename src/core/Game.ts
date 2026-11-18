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
  PointLight,
  Ray,
  Scene,
  SceneInstrumentation,
  Vector3,
} from '@babylonjs/core';
import { type Emitter, sfx } from '../audio/Sfx';
import { mulberry32, rollDamage } from '../combat/damage';
import { Director } from '../combat/Director';
import { isChilled, speedFactor } from '../combat/status';
import { hashRunSeed, type OfferContext, UP, type UpgradeDef, upgradeDef } from '../roguelite/upgrades';
import { availableParts, configCost, DEFAULT_CONFIG, levelCost, MAX_TOWER_LEVEL, partDef, STARTER_TECH, swapCost, type TowerConfig, type TowerSlot } from '../towers/components';
import { BASE_STATS, type CombatStats, computeStats, type StatModifier } from '../combat/stats';
import { type ShotOutcome, type ShotRequest, type SurfaceImpact, Weapon, type WeaponFxHooks } from '../combat/Weapon';
import type { WeaponFamily } from '../data/defs';
import { WeaponFx } from '../fx/WeaponFx';
import { ECONOMY } from '../data/defs';
import { DevTools } from '../arena/DevTools';
import { planBlast } from '../combat/blast';
import { hintFor, lootTargetInfo, runHud } from '../ui/hudModel';
import { planBuildConfig, planRefit } from '../towers/refit';
import { rollLoot } from '../loot/roll';
import { createSunShadows } from '../arena/shadows';
import { CORE_BEHAVIORS } from '../enemies/coreBehaviors';
import { pickInteractable } from '../home/interaction';
import { DROP_SOURCES, type DropSourceId } from '../loot/drops';
import { equipmentModifiers, weaponDefFor } from '../loot/equipment';
import { flatScale, hashSeed } from '../loot/generate';
import { convertsToSalvage, LootField, type Pickup, PICKUP_RANGE } from '../loot/LootField';
import { rarity } from '../loot/rarity';
import { scrapValue } from '../loot/economy';
import { RUN_INCOME } from '../economy/config';
import { RunInventory } from '../loot/runInventory';
import type { ItemInstance } from '../loot/types';
import type { SlotId } from '../progression/items';
import { Construction } from '../defense/Construction';
import { type Turret, type TurretContext, type TurretHitboxMeta, TurretManager } from '../defense/Turrets';
import { type Behavior, type Enemy, type EnemyContext, type EnemyHitboxMeta, EnemyManager } from '../enemies/EnemyManager';
import { Effects } from '../fx/Effects';
import { MOVE, Player } from '../player/Player';
import { type HitKind, hudStore, type LootTargetInfo, type Screen, uiEvents } from '../ui/store';
import type { Rewards, RunLedger } from '../progression/run';
import { isCheckpointWave, type ThreatTier } from '../progression/tiers';
import { ArenaBuilder } from '../visuals/arena';
import { Atmosphere } from '../visuals/atmosphere';
import { PostFx } from '../visuals/postfx';
import { Kit } from '../visuals/kit';
import { createPalette, type Palette } from '../visuals/materials';
import { buildReactor, type ReactorRig } from '../visuals/models';
import { arenaDeckWetness } from '../visuals/textures';
import { WaveManager } from '../waves/WaveManager';
import { ARENA, type ArenaLayout, type GateId } from '../world/layout';
import { ENV_QUERY } from '../world/physicsGroups';
import { type Impact, Ordnance, Telegraphs } from '../fx/Hostile';
import { M6_BEHAVIORS } from '../enemies/behaviors';
import { JAMMER_CRAWLER_BEHAVIORS } from '../enemies/jammerCrawlerBehaviors';
import { BOSS_BEHAVIORS } from '../enemies/bosses';
import { bossMults, SurvivalPlanner } from '../survival/plan';
import { SurvivalRuntime } from '../survival/SurvivalRuntime';
import { ArenaDynamics } from '../world/ArenaDynamics';
import type { DropSource } from '../loot/drops';
import type { BossHud } from '../ui/store';
import type { EnemyKind } from '../data/defs';
import type { EliteModId } from '../survival/elites';
import type { Input } from './Input';
import { type Settings, saveSettings } from './settings';
import { TacticalEnergy, Wallet } from './tactical';
import { type TutorialHost, TutorialDirector } from './TutorialDirector';

const TMP = new Vector3();
/** Sun intensity (directional, range-free). */
const SUN = 2.65;
const TMP2 = new Vector3();
/** Arc Conductor reach (m): enemies on the lanes are spread a few metres apart. */
export const ARC_RANGE = 12;
/** M7: Pulse Capacitor splash radius (m). */
export const PULSE_SPLASH = 3;

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
  /** Upgrade-offer seed (debug/reproducibility). Defaults to a hash of the run id. */
  seed?: number;
  /** Permanently researched tower blueprints (`slot:id`), snapshotted at deployment. */
  towerTech?: readonly string[];
  /** M6: milestones already reached on this profile (first-time milestone rewards). */
  milestones?: readonly string[];
  /** M7: onboarding host (solo runs of profiles that have not finished the tutorial). */
  tutorial?: TutorialHost;
}

/**
 * One survival run in the arena. Built fresh for every deployment and disposed when
 * the run ends, so no towers, enemies, wave or effect state can leak between runs.
 */
export class Game {
  readonly scene: Scene;
  protected pal: Palette;
  protected kit: Kit;
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
  protected reactor: ReactorRig;
  protected reactorLight: PointLight;
  reactorHp: number = ECONOMY.reactorMaxHp;
  protected reactorHitT = 0;
  protected reactorSfxT = 0;
  protected post: PostFx;
  protected atmosphere: Atmosphere;
  protected moon: DirectionalLight;
  protected hurtFx = 0;
  protected lastFlash = 0;
  protected arenaVisuals: ArenaBuilder;

  /** Extra modifiers (debug); equipment, run upgrades and temporary buffs are composed in rebuildStats. */
  modifiers: StatModifier[] = [];
  stats: CombatStats = { ...BASE_STATS };
  /** M5: combat director (effect bus, damage pipeline, run build). One per run, disposed with the Game. */
  readonly director: Director;
  /** Bumped whenever derived stats change: towers recompose lazily. */
  statsVersion = 0;
  /** Upgrade choice currently on screen (mandatory selection after a wave). */
  offer: UpgradeDef[] | null = null;
  protected upgradeDue = false;
  /** Automation only: legacy milestone suites fight many waves without choosing upgrades. */
  skipUpgrades = false;
  /** M6: development panel (F4) available. Set by Flow from the URL (?dev / ?test). */
  devTools = false;
  /** Configuration new towers are built with (chosen in the tower panel / build mode). */
  buildConfig: TowerConfig = { ...DEFAULT_CONFIG };
  /** Researched blueprints for this run. */
  readonly towerTech: ReadonlySet<string>;
  /** Last tower-edit result message (HUD). */
  towerNote = { text: '', t: 0 };
  towerPanelFocus: number | null = null;
  /** Cost of the next tower from the build template (UI). */
  get nextTowerCost(): number {
    return configCost(this.buildConfig, this.stats.buildCostMult);
  }

  /** Run inventory + loadout (ownership rules live in RunInventory/RunLedger). */
  readonly inventory: RunInventory;
  readonly loot: LootField;
  protected lootRand: () => number;
  protected lootCounter = 0;
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
  protected screenBeforeInventory: Screen = 'playing';

  screen: Screen = 'loading';
  protected runTime = 0;
  protected kills = 0;
  protected turretsBuilt = 0;
  protected defeatT = 0;
  protected hudT = 0;
  protected inspected: Turret | null = null;
  protected recycleT = 0;
  protected perfOn = false;
  protected instrumentation: SceneInstrumentation | null = null;
  protected fpsSmooth = 60;

  protected shotRay = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  protected physResult = new PhysicsRaycastResult();
  protected enemyCtx: EnemyContext;
  turretCtx: TurretContext;

  /** Return-home window: open from checkpoint prep until the next wave starts. */
  checkpointOpen = false;

  // ---- M6 survival
  /** Resolves once every M6 shader (enemy/boss/telegraph/ordnance/arena-machinery) is compiled. */
  readonly shaderWarmup: Promise<unknown>;
  readonly tele: Telegraphs;
  readonly ordnance: Ordnance;
  readonly dynamics: ArenaDynamics;
  readonly planner: SurvivalPlanner;
  readonly survival: SurvivalRuntime;
  /** Development lab actions (F4 panel / `__rift.dev`); every action taints the run. */
  readonly dev: DevTools;
  readonly layout: ArenaLayout = ARENA;
  /** Hostile time since the run started (enemy animation phase). */
  protected hostileT = 0;
  protected playerWasAlive = true;
  /** Boss entrance announced (enemy id). */
  protected bossSeen = 0;
  protected disposed = false;
  /** M7 onboarding. */
  protected tut: TutorialDirector | null = null;
  /** M7 positional ambience loops (disposed with the scene). */
  protected emitters: Emitter[] = [];
  private tutTrack = { dist: 0, x: 0, z: 0, air: false, dash: false, tactical: false };

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

    const high = settings.quality === 'high';
    this.pal = createPalette(scene, high);
    this.kit = new Kit(scene);

    // Dusk sky, haze, lamps and embers. PBR ambient comes from the captured environment.
    this.atmosphere = new Atmosphere(scene, this.pal, ARENA);
    this.atmosphere.setQuality(high);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0053;
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
    this.arenaVisuals = arena;
    this.atmosphere.adoptPortals();
    this.reactor = buildReactor(scene, this.pal);

    this.player = new Player(scene, ARENA.playerSpawn);
    scene.activeCamera = this.player.camera;
    const weaponDef = weaponDefFor(cfg.loadout.weapon);
    if (!weaponDef) throw new Error('deployment requires an equipped weapon');
    this.weapon = new Weapon(scene, weaponDef, this.player, cfg.loadout.weapon);
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);
    this.post = new PostFx(scene, engine, this.player.camera, high);

    this.fx = new Effects(scene, this.kit, this.pal, ARENA, high);
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
    const sg = createSunShadows(moon, settings.shadows ?? (high ? 'high' : 'low'), high, [...arena.shadowCasters, ...this.reactor.root.getChildMeshes()]);
    if (sg) this.kit.shadowSink = (m) => sg.addShadowCaster(m);
    this.enemies = new EnemyManager(scene, this.kit, this.pal);
    for (const [kind, b] of Object.entries({ ...CORE_BEHAVIORS, ...M6_BEHAVIORS, ...JAMMER_CRAWLER_BEHAVIORS, ...BOSS_BEHAVIORS })) if (b) this.enemies.register(kind as EnemyKind, b as Behavior);
    this.tele = new Telegraphs(scene);
    this.ordnance = new Ordnance(scene, this.tele);
    this.dynamics = new ArenaDynamics(scene, this.pal, ARENA, {
      playerPos: () => this.player.position,
      movePlayer: (to) => {
        this.player.controller.setPosition(to);
        this.player.controller.setVelocity(Vector3.Zero());
      },
      ventTick: (at, r) => this.ventTick(at, r),
      ventFx: (at, stage) => {
        if (stage === 'warn') sfx.play('vent', { volume: this.panFor(at).volume * 0.8, pan: this.panFor(at).pan, pitch: 0.7 });
        else {
          this.fx.burst('fire', at.add(new Vector3(0, 0.6, 0)), 16, undefined, 1.6);
          this.fx.burst('smoke', at.add(new Vector3(0, 2, 0)), 4, undefined, 1.4);
          sfx.play('explosion', { volume: this.panFor(at).volume * 0.45, pitch: 1.6, pan: this.panFor(at).pan });
        }
      },
      clearZone: (b) => {
        for (const p of this.loot.pickups) {
          if (p.ground.x > b.min[0] - 0.5 && p.ground.x < b.max[0] + 0.5 && p.ground.z > b.min[2] - 0.5 && p.ground.z < b.max[2] + 0.5) {
            p.ground.x = p.ground.x < (b.min[0] + b.max[0]) / 2 ? b.min[0] - 1.5 : b.max[0] + 1.5;
          }
        }
      },
      shake: (pos, k) => this.fx.onShake?.(pos, k),
    });
    this.shaderWarmup = this.warmShaders();
    this.planner = new SurvivalPlanner(((cfg.seed ?? hashRunSeed(cfg.run.id)) >>> 0) ^ 0x6d2b79f5, cfg.tier);
    this.survival = new SurvivalRuntime(this);
    this.turrets = new TurretManager(scene, this.kit, this.pal);
    this.construction = new Construction(scene, (cfg, u) => this.turrets.build(cfg, 1, u), this.pal, ARENA);
    this.loot = new LootField(scene, this.kit, this.pal);
    this.loot.onLand = (p) => this.onLootLanded(p);
    this.inventory = new RunInventory(cfg.loadout, cfg.run);
    this.lootRand = mulberry32(hashSeed(cfg.run.id));
    this.towerTech = new Set([...STARTER_TECH, ...(cfg.towerTech ?? [])]);
    this.director = new Director(this, cfg.seed ?? hashRunSeed(cfg.run.id));

    // Reflections/ambient: capture the finished static scene once into a prefiltered cube map.
    this.atmosphere.captureEnvironment([...arena.meshes, ...this.reactor.root.getChildMeshes()], this.pal.lit, high);

    const game = this;
    this.enemyCtx = {
      player: this.player,
      effects: this.fx,
      layout: ARENA,
      damageReactor: (a, at) => this.damageReactor(a, at),
      los: (a, b) => this.los(a, b),
      panFor: (p) => this.panFor(p),
      towers: this.turrets.turrets,
      tele: this.tele,
      ordnance: this.ordnance,
      hurtPlayer: (a, from) => this.hurtPlayer(a, from),
      hostileBlast: (c, r, o) => this.hostileBlast(c, r, o),
      summon: (kind, at, o) => this.summon(kind, at, o),
      alert: (text, tone) => uiEvents.emit('alert', { text, tone }),
      escaped: (e) => this.survival.onEscape(e),
      get time() {
        return game.hostileT;
      },
    };
    this.turretCtx = {
      enemies: this.enemies.active,
      effects: this.fx,
      stats: this.stats,
      statsVersion: 0,
      los: (a, b) => this.los(a, b),
      input: (t) => this.director.towerInput(t),
      attack: (t, e, mult) => this.director.towerFire(t, e, mult),
      panFor: (p) => this.panFor(p),
    };

    const run = cfg.run;
    this.waves = new WaveManager({
      spawn: (s, w) => {
        let hp = w.hpMult * (s.hpMult ?? 1);
        let dmg = w.damageMult;
        if (s.tag === 'boss') {
          const b = bossMults(s.encounter ?? 1, cfg.tier);
          hp *= b.hp;
          dmg *= b.damage;
        }
        this.enemies.spawn(s.kind, s.gate, ARENA, hp, dmg, w.speedMult, { mods: s.mods, tag: s.tag, encounter: s.encounter, ctx: this.enemyCtx });
        this.arenaVisuals.gateSpawned(s.gate);
      },
      aliveCount: () => this.enemies.count,
      onWaveStart: (w) => {
        this.checkpointOpen = false;
        this.survival.start(w);
        // Armor is measured against the incoming wave's level.
        this.player.applyStats(this.stats, this.attackerScale);
        sfx.play('waveStart');
        if (!w.plan?.event && !w.plan?.boss) uiEvents.emit('banner', { title: `WAVE ${w.number}`, sub: `${w.spawns.length} hostiles inbound${w.plan && w.number > 3 ? ` · ${this.survival.hud().theme.toLowerCase()}` : ''}`, tone: 'orange' });
      },
      onWaveCleared: (w) => {
        this.survival.cleared(w);
        this.upgradeDue = true;
        this.director.bus.emit({ type: 'waveCleared', chain: this.director.bus.newChain(), source: { kind: 'effect', id: 'wave' }, value: w.number });
        this.wallet.earn(w.clearReward);
        uiEvents.emit('coresGained', w.clearReward);
        this.reactorHp = Math.min(ECONOMY.reactorMaxHp, this.reactorHp + ECONOMY.reactorMaxHp * ECONOMY.reactorRepairPerWave);
        sfx.play('waveClear');
        const salvage = Math.round((ECONOMY.salvageWaveBase + w.number * ECONOMY.salvagePerWave) * cfg.tier.salvageMult);
        const credits = Math.round(RUN_INCOME.waveCredits(w.number) * cfg.tier.salvageMult);
        run.collect({ salvage, credits });
        uiEvents.emit('salvageGained', salvage);
        uiEvents.emit('creditsGained', credits);
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
          // Milestone: credits and advanced components (tier scaled).
          const cpCredits = Math.round(RUN_INCOME.checkpointCredits(w.number) * cfg.tier.salvageMult);
          const cpComponents = RUN_INCOME.checkpointComponents(w.number, cfg.tier.id);
          run.collect({ items: this.lastCache, credits: cpCredits, components: cpComponents });
          uiEvents.emit('creditsGained', cpCredits);
          uiEvents.emit('componentsGained', cpComponents);
          banked = run.bank(w.number);
        }
        if (banked) {
          this.lastBankSaved = cfg.hooks.bank(w.number, banked);
          this.inventoryVersion++;
          const n = banked.items.length;
          if (this.lastBankSaved) {
            sfx.play('bank');
            uiEvents.emit('banner', { title: 'CHECKPOINT SECURED', sub: `Wave ${w.number} cleared · ${banked.salvage} salvage · ${banked.credits} cr · ${banked.components} comp${n ? ` · ${n} item${n === 1 ? '' : 's'}` : ''} banked to HQ`, tone: 'cyan' });
          } else if (cfg.run.survival.dev) uiEvents.emit('banner', { title: 'CHECKPOINT · DEVELOPMENT SESSION', sub: 'Development tools were used this run: nothing is banked to HQ', tone: 'white' });
          else uiEvents.emit('banner', { title: 'CHECKPOINT · SAVE FAILED', sub: 'Rewards are held by the run but could not be written to storage yet', tone: 'red' });
        } else uiEvents.emit('banner', { title: `WAVE ${w.number} CLEARED`, sub: `+${w.clearReward} cores · +${salvage} salvage · +${credits} cr · reactor repaired`, tone: 'cyan' });
      },
      onPrepStart: (w) => {
        this.arenaVisuals.prepareWave(w.spawns.map((entry) => entry.gate));
        this.survival.prep(w);
        run.waveReached(w.number);
        if (w.number > 1 && run.atCheckpoint) this.checkpointOpen = true;
        // Mandatory upgrade choice first (the prep countdown is frozen while it is open), then the checkpoint choice.
        if (this.skipUpgrades) this.upgradeDue = false;
        if (this.upgradeDue && w.number > 1) this.openUpgrade();
        else if (this.checkpointOpen) this.openCheckpoint();
      },
    }, cfg.tier, (n) => this.planner.compose(n));
    this.arenaVisuals.setSealed('south', true);
    this.atmosphere.setGateOpen(3, false);

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
    // M7 spatial ambience: reactor core hum and machinery at the rift gates.
    const em = (k: Parameters<typeof sfx.emitter>[0], x: number, y: number, z: number, g: number, ref?: number) => {
      const e = sfx.emitter(k, x, y, z, g, ref);
      if (e) this.emitters.push(e);
    };
    em('reactor', ARENA.reactor.x, 3, ARENA.reactor.z, 1, 6);
    for (const gate of ['north', 'east', 'west'] as const) {
      const p = ARENA.routes[gate].points[0];
      em('machine', p.x, 2, p.z, 0.8, 5);
    }
    if (cfg.tutorial) this.tut = new TutorialDirector('arena', cfg.tutorial, { available: (id) => this.tutAvailable(id), complete: (id, t) => this.tutComplete(id, t) });
    this.dev = new DevTools({
      cfg: this.cfg,
      enemies: this.enemies,
      ordnance: this.ordnance,
      tele: this.tele,
      survival: this.survival,
      waves: this.waves,
      planner: this.planner,
      turrets: this.turrets,
      enemyCtx: this.enemyCtx,
      restoreReactor: () => { this.reactorHp = ECONOMY.reactorMaxHp; },
      resetToPlayable: () => {
        this.offer = null;
        this.upgradeDue = false;
        this.checkpointOpen = false;
        if (this.screen !== 'playing' && this.screen !== 'defeat') this.setScreen('playing');
      },
    });
  }

  // ---------------------------------------------------------------- M7 onboarding

  private tutAvailable(id: string): boolean {
    const w = this.waves;
    const play = this.screen === 'playing';
    switch (id) {
      case 'move':
      case 'dash':
      case 'reactor':
        return play;
      case 'tower':
        return play && w.phase === 'prep';
      case 'wave':
        return play && w.phase === 'prep' && this.turrets.turrets.length > 0;
      case 'shoot':
        return play && w.phase === 'combat';
      case 'heat':
        return play && this.weapon.heat > 45;
      case 'loot':
        return play && this.loot.count > 0;
      case 'upgrade':
        return this.screen === 'upgrade';
      case 'tactical':
        return play && w.number >= 2 && this.tactical.energy >= 99;
      case 'bank':
        return this.screen === 'checkpoint' || this.canReturnHome;
    }
    return false;
  }

  private tutComplete(id: string, t: number): boolean {
    const k = this.tutTrack;
    switch (id) {
      case 'move':
        return k.dist > 8 && k.air;
      case 'dash':
        return k.dash;
      case 'reactor':
        return t > 7;
      case 'tower':
        return this.turrets.turrets.length > 0;
      case 'wave':
        return this.waves.phase === 'combat';
      case 'shoot':
        return this.kills >= 3;
      case 'heat':
        return this.weapon.overheated || t > 7;
      case 'loot':
        return this.inventory.cargoUsed > 0 || t > 20;
      case 'upgrade':
        return this.director.build.total > 0 || this.screen !== 'upgrade';
      case 'tactical':
        return k.tactical || t > 25;
      case 'bank':
        return t > 9 || this.screen === 'playing';
    }
    return t > 10;
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
    this.player.reduceMotion = s.reduceMotion;
    this.player.shakeScale = s.shake;
    this.weapon.anim.reduceMotion = s.reduceMotion;
    this.fx.setDensity(s.particles);
    this.post.setOptions({ bloom: s.bloom, reduceMotion: s.reduceMotion });
    sfx.setVolume(s.volume);
    sfx.setMix(s.sfxVolume, s.uiVolume, s.ambienceVolume);
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
    this.rebuildStats();
    const item = this.inventory.equipped('weapon');
    const w = weaponDefFor(item);
    if (w) {
      this.weapon.setItem(item, w);
      this.wfx.setColor(this.weapon.rig.energyBase);
    }
    this.inventoryVersion++;
  }

  /**
   * Recompute derived stats from scratch: equipment + debug modifiers + run upgrades + temporary buffs.
   * Event-driven (equipment change, upgrade picked, buff gained/expired), never per frame.
   */
  rebuildStats(): void {
    const mods = [...equipmentModifiers(this.inventory.equippedItems()), ...this.modifiers, ...this.director.build.modifiers(), ...this.director.buffModifiers()];
    Object.assign(this.stats, computeStats(mods));
    this.player.applyStats(this.stats, this.attackerScale);
    this.tactical.rechargeMult = this.stats.tacticalRechargeMult;
    this.statsVersion++;
    this.turretCtx.statsVersion = this.statsVersion;
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

  /** Roll a source's drops and generate the items (deterministic per run seed). */
  rollItems(source: DropSourceId, wave = this.waves.number): ItemInstance[] {
    return this.rollFrom(DROP_SOURCES[source], wave);
  }

  /** The run's own loot stream (single player): one place that knows the uid scheme and the debug chance multiplier. */
  private rollFrom(src: DropSource, wave: number): ItemInstance[] {
    const run = this.cfg.run;
    return rollLoot({ source: src, wave, tier: this.cfg.tier, rand: this.lootRand, nextUid: () => `${run.id}.${++this.lootCounter}`, originId: run.id, chanceMult: this.dropChanceMult });
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
  protected groundPoint(at: Vector3): Vector3 {
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

  protected onLootLanded(p: Pickup): void {
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

  protected updateLootTarget(controls: boolean): void {
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


  // ---------------------------------------------------------------- M5: run upgrades

  get offerContext(): OfferContext {
    const ts = this.turrets.turrets;
    return { wave: this.waves.number, family: this.weapon.def.family, towers: ts.length, towerArchetypes: [...new Set(ts.map((t) => t.archetype))] };
  }

  /** Mandatory three-choice selection between waves. Freezes the simulation (and the prep countdown) until chosen. */
  openUpgrade(): void {
    if (this.screen === 'defeat') return;
    this.upgradeDue = false;
    const offer = this.director.build.nextOffer(this.offerContext);
    if (!offer.length) {
      if (this.checkpointOpen) this.openCheckpoint();
      return;
    }
    this.offer = offer;
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.setScreen('upgrade');
    this.publishHud(true);
    this.input.releaseLock();
    sfx.play('bank', { pitch: 1.4, volume: 0.6 });
  }

  /** Pick one of the offered upgrades: applied immediately (stats + effects), then play resumes. */
  chooseUpgrade(id: string): boolean {
    if (this.screen !== 'upgrade' || !this.offer || !this.offer.some((u) => u.id === id)) return false;
    const def = upgradeDef(id)!;
    if (!this.director.takeUpgrade(id)) return false;
    this.offer = null;
    sfx.play('equip', { pitch: 1.3 });
    uiEvents.emit('banner', { title: def.name.toUpperCase(), sub: `${def.rarity} upgrade · ${def.text(this.director.build.count(id))}`, tone: def.rarity === 'legendary' ? 'orange' : def.rarity === 'epic' ? 'white' : 'cyan' });
    void this.afterUpgrade();
    return true;
  }

  protected async afterUpgrade(): Promise<void> {
    if (this.checkpointOpen && this.cfg.run.atCheckpoint) {
      this.openCheckpoint();
      return;
    }
    await this.resume();
    if (this.screen === 'upgrade') this.setScreen('paused');
  }

  /** Development panel (F4, dev builds only). */
  openDevPanel(): void {
    if (this.screen !== 'playing' || !this.devTools) return;
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.setScreen('dev');
    this.publishHud(true);
    this.input.releaseLock();
  }

  /** Run build overview (U): upgrades, stacks, active buffs and key stats. */
  openBuildOverview(): void {
    if (this.screen !== 'playing') return;
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.setScreen('build');
    this.publishHud(true);
    this.input.releaseLock();
  }

  get towerPanelAllowed(): boolean {
    return this.screen === 'playing' && this.waves.phase !== 'combat';
  }

  /** Tower configuration panel (T): preparation / between waves; combat edits use the tactical hotkeys. */
  openTowerPanel(): void {
    if (!this.towerPanelAllowed) return;
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.towerPanelFocus = this.inspected?.id ?? null;
    this.setScreen('towers');
    this.publishHud(true);
    this.input.releaseLock();
  }

  async closePanel(): Promise<void> {
    if (this.screen !== 'build' && this.screen !== 'towers' && this.screen !== 'dev') return;
    sfx.play('ui');
    this.setScreen('paused');
    await this.resume();
  }

  /** G / early start. Rapid Deployment pays for the preparation time skipped. */
  startWave(): void {
    if (this.waves.phase !== 'prep') return;
    const remaining = Math.max(0, this.waves.timer);
    this.waves.startNow();
    if (remaining > 0.5) this.director.bus.emit({ type: 'earlyStart', chain: this.director.bus.newChain(), source: { kind: 'effect', id: 'earlyStart' }, value: remaining });
  }

  grantCores(n: number): void {
    this.wallet.earn(n);
    uiEvents.emit('coresGained', n);
  }

  // ---------------------------------------------------------------- M5: tower engineering

  /** Why tower modifications are unavailable right now (null = allowed). */
  towerEditReason(): string | null {
    if (this.screen !== 'playing' && this.screen !== 'towers') return 'Not available right now';
    if (this.waves.phase === 'combat' && !this.tactical.active) return 'Activate tactical mode (Q) to modify towers during a wave';
    return null;
  }

  protected towerFail(text: string): { ok: false; reason: string } {
    this.towerNote = { text, t: 3 };
    sfx.play('buildDeny');
    return { ok: false, reason: text };
  }

  /**
   * Upgrade a tower's level or swap its weapon / core / modifier. Validates phase, compatibility, research and
   * resources first, then spends, recomposes numbers from scratch, rebuilds the model and resets attack state.
   */
  modifyTower(t: Turret, what: 'level' | TowerSlot, id?: string): { ok: true; cost: number } | { ok: false; reason: string } {
    const plan = planRefit({
      phaseBlock: this.towerEditReason(),
      exists: this.turrets.turrets.includes(t),
      building: t.building,
      config: t.config,
      level: t.level,
      what,
      id,
      tech: this.towerTech,
      cores: this.wallet.cores,
      costMult: this.stats.buildCostMult,
    });
    if (!plan.ok) return this.towerFail(plan.reason);
    if (!this.wallet.spend(plan.cost)) return this.towerFail(`Not enough cores (need ${plan.cost})`);
    t.paid += plan.cost;
    t.refit(plan.config, plan.level, this.turretCtx);
    this.bumpStats();
    this.fx.burst('build', t.head, 24);
    this.fx.ring(new Vector3(t.pos.x, t.pos.y + 0.1, t.pos.z), 3, 0.4, new Color3(0.4, 1.8, 2.2), true);
    sfx.play('equip', { pitch: 1.1 });
    this.towerNote = { text: `${t.name} refit${what === 'level' ? ` · level ${plan.level}` : ''}${plan.cost ? ` · -${plan.cost} cores` : ''}`, t: 3 };
    this.inventoryVersion++;
    return { ok: true, cost: plan.cost };
  }

  /** Choose the configuration for towers built from now on (no cost). Incompatible dependants reset to defaults. */
  setBuildConfig(slot: TowerSlot, id: string): { ok: true } | { ok: false; reason: string } {
    const plan = planBuildConfig(this.buildConfig, slot, id, this.towerTech);
    if (!plan.ok) return plan;
    this.buildConfig = plan.config;
    this.construction.setTemplate(plan.config);
    this.inventoryVersion++;
    return { ok: true };
  }

  /** Cycle helper for hotkeys: next owned+compatible component of a slot. */
  protected nextPart(cfg: TowerConfig, slot: TowerSlot): string | null {
    const list = availableParts(cfg, slot, this.towerTech);
    if (list.length < 2) return null;
    const i = list.findIndex((p) => p.id === cfg[slot]);
    return list[(i + 1) % list.length].id;
  }

  /** In-world tower hotkeys: while aiming at a tower (refit) or in build mode (template). R level, C weapon, V core, N modifier, M base. */
  protected towerKeys(input: Input): void {
    const t = this.inspected;
    const slots: [string, TowerSlot][] = [['KeyC', 'weapon'], ['KeyV', 'core'], ['KeyN', 'modifier'], ['KeyM', 'base']];
    if (this.construction.active) {
      for (const [key, slot] of slots) {
        if (!input.pressed(key)) continue;
        const nxt = this.nextPart(this.buildConfig, slot);
        const r = nxt ? this.setBuildConfig(slot, nxt) : { ok: false as const, reason: 'No other compatible blueprint owned' };
        this.towerNote = { text: r.ok ? `Build template: ${partDef(slot, nxt!)?.name} · ${configCost(this.buildConfig, this.stats.buildCostMult)} cores` : r.reason, t: 2.5 };
        sfx.play(r.ok ? 'ui' : 'buildDeny');
      }
      return;
    }
    if (!t) return;
    if (input.pressed('KeyR')) this.modifyTower(t, 'level');
    for (const [key, slot] of slots) {
      if (!input.pressed(key) || slot === 'base') continue;
      const nxt = this.nextPart(t.config, slot);
      if (!nxt) this.towerFail('No other compatible blueprint owned');
      else this.modifyTower(t, slot, nxt);
    }
  }

  /** Floating damage number with a per-frame budget (kills always show). */
  showNumber(p: Vector3, amount: number, kind: HitKind, player: boolean, allowed: boolean): void {
    if (!allowed && kind !== 'kill') return;
    if (player || kind === 'kill' || Vector3.DistanceSquared(p, this.player.position) < 25 * 25) {
      uiEvents.emit('damageNumber', { x: p.x, y: p.y, z: p.z, amount: Math.round(amount), kind, player });
    }
  }

  /** Inspect card data for HUD / panel. */
  towerInfo(t: Turret) {
    const mult = this.stats.buildCostMult;
    const slots = (['weapon', 'core', 'modifier'] as const).map((slot) => {
      const nxt = this.nextPart(t.config, slot);
      return { slot, id: t.config[slot], name: partDef(slot, t.config[slot])?.name ?? '?', next: nxt ? partDef(slot, nxt)?.name ?? null : null, nextCost: nxt ? swapCost(t.config, slot, nxt, mult) : 0 };
    });
    return { id: t.id, name: t.name, base: partDef('base', t.config.base)?.name ?? '', level: t.level, maxLevel: MAX_TOWER_LEVEL, levelCost: t.level < MAX_TOWER_LEVEL ? levelCost(t.config, t.level, mult) : 0, slots, st: { ...t.st }, empowered: t.empowered, kills: t.kills, damage: Math.round(t.damageDealt) };
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
    // The pointerlockchange event (which updates `captured`) can lag the
    // requestPointerLock promise. Query the lock directly so resuming from the
    // pause menu doesn't leave us stuck on a menu with an already-locked mouse.
    if (!this.disposed && (this.input.captured || this.input.isLockedNow())) this.setScreen('playing');
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
    this.tut?.dispose();
    for (const e of this.emitters) e.dispose();
    this.emitters = [];
    this.disposed = true;
    this.input.onLockChange = () => {};
    this.director.bus.reset();
    sfx.setTactical(false);
    sfx.beamLoop(false);
    this.scene.dispose();
  }

  protected newRun(): void {
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
    this.tele.reset();
    this.ordnance.reset();
    this.survival.endEvent();
    this.hostileT = 0;
    this.modifiers = [];
    this.director.reset(this.cfg.seed ?? hashRunSeed(this.cfg.run.id));
    this.offer = null;
    this.upgradeDue = false;
    this.buildConfig = { ...DEFAULT_CONFIG };
    this.construction.setTemplate(this.buildConfig);
    this.towerNote = { text: '', t: 0 };
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
    const t0 = performance.now();
    if (this.screen === 'playing' || this.screen === 'defeat') this.update(dt);
    else this.idleAnimate(dt);
    const cam = this.player.camera.position;
    sfx.listen(cam.x, cam.y, cam.z, this.player.yaw);
    if (this.tut) {
      const p = this.player.position;
      this.tutTrack.dist += Math.min(2, Math.hypot(p.x - this.tutTrack.x, p.z - this.tutTrack.z));
      this.tutTrack.x = p.x;
      this.tutTrack.z = p.z;
      if (!this.player.grounded) this.tutTrack.air = true;
      if (this.player.dashing) this.tutTrack.dash = true;
      if (this.tactical.active) this.tutTrack.tactical = true;
      this.tut.update(dt, this.input.pressed('F10'));
    }
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.05;
  }
  /** Smoothed simulation cost per frame (ms, diagnostics). */
  frameMs = 0;

  protected idleAnimate(dt: number): void {
    this.dynamics.update(dt, 0);
    const flash = this.updateSky(dt);
    this.post.update(dt, 0, 0, flash);
    this.updateReactor(dt, false);
    this.updateArenaVisuals(dt, dt);
  }

  protected update(dt: number): void {
    const input = this.input;
    const playing = this.screen === 'playing';
    const controls = playing && input.captured;

    // ---- global keys
    if (controls) {
      if (input.pressed('F3')) this.togglePerf();
      if (input.pressed('KeyG')) this.startWave();
      if (input.pressed('KeyQ')) this.toggleTactical();
      if (input.pressed('Digit2') || input.pressed('KeyB')) this.setBuildMode(!this.construction.active);
      if (input.pressed('Digit1')) this.setBuildMode(false);
      if (this.construction.active && input.mousePressed(2)) this.setBuildMode(false);
      if (input.pressed('KeyH') && this.canReturnHome) this.openCheckpoint();
      if (input.pressed('KeyI') || input.pressed('Tab')) {
        this.openInventory();
        return;
      }
      if (input.pressed('KeyU')) {
        this.openBuildOverview();
        return;
      }
      if (input.pressed('F4') && this.devTools) {
        this.openDevPanel();
        return;
      }
      if (input.pressed('KeyT') && this.towerPanelAllowed) {
        this.openTowerPanel();
        return;
      }
      this.towerKeys(input);
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
    if (this.player.dashedThisFrame) {
      this.player.dashedThisFrame = false;
      this.director.bus.emit({ type: 'dash', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: 'dash' }, value: 1 });
    }

    // ---- building
    if (this.construction.active) {
      this.construction.update(this.player, this.wallet.cores, this.turrets.turrets, this.stats);
      if (controls && input.mousePressed(0)) this.tryPlace();
    }

    // ---- shooting
    const trigger = controls && input.mouse(0) && !this.construction.active;
    this.weapon.update(dt, trigger, this.stats, this.shoot, this.weaponFx);
    if (this.weapon.overheated && !this.wasOverheated) this.director.bus.emit({ type: 'overheat', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: 'heat' }, value: 1 });
    this.wasOverheated = this.weapon.overheated;
    this.wfx.update(dt, this.player.camera.position);

    // ---- inspect / recycle, loot
    this.updateInspect(dt, controls);
    this.updateLootTarget(controls);
    this.loot.update(dt);

    // ---- simulation (hostile time)
    if (this.screen === 'playing') this.waves.update(dt, hdt);
    this.hostileT += hdt;
    this.enemies.update(hdt, this.enemyCtx, dt);
    this.ordnance.update(hdt, this.ordnanceCtx, this.hostileT);
    this.tele.update(hdt);
    this.dynamics.update(dt, hdt);
    this.survival.update(dt, hdt);
    this.watchBoss();
    if (this.playerWasAlive && !this.player.alive) this.cfg.run.survival.deaths++;
    this.playerWasAlive = this.player.alive;
    this.turretCtx.stats = this.stats;
    this.turrets.update(dt, this.turretCtx);
    this.director.update(dt, this.screen === 'playing' ? hdt : 0);
    if (this.towerNote.t > 0) this.towerNote.t -= dt;
    this.updateProjectiles(hdt);
    this.fx.update(dt);
    this.updateReactor(dt, true);

    // Atmosphere and grade: tactical desaturates/cools, damage punches the lens.
    const k = (1 - this.tactical.hostileScale) / (1 - TacticalEnergy.HOSTILE_SCALE);
    const flash = this.updateSky(dt);
    this.hurtFx = Math.max(this.player.hurtFlash, this.player.alive ? 0 : 0.8);
    this.post.update(dt, k, this.hurtFx, flash);

    this.updateArenaVisuals(dt, hdt);

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

  protected updateArenaVisuals(dt: number, hostileDt: number): void {
    const phase = this.waves.phase;
    const warning = this.screen === 'defeat' || phase === 'cleared' ? 0 : phase === 'combat' ? 1 : 0.5;
    this.arenaVisuals.update(dt, hostileDt, warning);
  }

  gateActivity(gate: GateId): number {
    return this.arenaVisuals.gateActivity(gate);
  }

  /** Storm: sky lightning brightens the moonlight and rolls thunder. */
  protected updateSky(dt: number): number {
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

  protected wasTactical = false;
  protected toggleTactical(): void {
    if (this.tactical.toggle()) {
      if (this.tactical.active) {
        this.wasTactical = true;
        sfx.play('tacticalOn');
        sfx.setTactical(true);
        this.setBuildMode(true);
      }
    } else sfx.play('buildDeny');
  }

  protected setBuildMode(on: boolean): void {
    if (on === this.construction.active) return;
    this.construction.setActive(on);
    this.weapon.setHolstered(on);
    sfx.play('ui');
  }

  protected tryPlace(): void {
    const c = this.construction;
    const cost = configCost(this.buildConfig, this.stats.buildCostMult);
    if (!c.valid || !this.wallet.spend(cost)) {
      sfx.play('buildDeny');
      return;
    }
    this.turrets.add(c.point, this.player.yaw, this.turretCtx, this.buildConfig).paid = cost;
    this.turretsBuilt++;
    this.bumpStats();
    this.fx.burst('build', c.point.add(new Vector3(0, 0.5, 0)), 40);
    // Rapid multi-placement while tactical mode is active.
    if (!this.tactical.active) this.setBuildMode(false);
  }

  protected updateInspect(dt: number, controls: boolean): void {
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
    this.construction.showInspect(t);
    if (t && this.input.isDown('KeyX')) {
      this.recycleT += dt / 0.6;
      if (this.recycleT >= 1) {
        const refund = Math.round(t.paid * t.refundRatio);
        this.wallet.earn(refund);
        uiEvents.emit('coresGained', refund);
        this.fx.burst('build', t.head, 30);
        this.fx.debrisBurst(t.head, 6, 4, 0.8);
        this.turrets.remove(t);
        this.bumpStats();
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
  protected shoot = (r: ShotRequest): ShotOutcome => {
    this.director.bus.emit({ type: 'fire', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: r.family }, value: 1 });
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
      if (this.weapon.def.mechanism === 'pulse') this.pulseSplash(point, dmg, e);
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
      const point = wall.pickedPoint!.clone();
      const meta = wall.pickedMesh!.metadata as { surface: string; impact?: SurfaceImpact };
      const surface = meta.surface === 'floor' && arenaDeckWetness(point.x, point.z) > 0.48 ? 'wetDeck' : meta.impact ?? 'alloy';
      return { point, normal: n, target: 'surface', surface, enemyId: null };
    }
    return { point: r.origin.add(r.dir.scale(r.range)), normal: null, target: 'none', enemyId: null };
  };

  /** World-space shot visuals and impacts per family (presentation only). */
  protected beamFxT = 0;
  protected weaponFx: WeaponFxHooks = {
    shot: (family, from, out, power, speed) => {
      if (power < 0) {
        // M7 Pulse Capacitor: bright streak + detonation at the impact.
        this.wfx.rail(from, out.point, 0.7);
        if (out.target !== 'none') {
          this.fx.explode(out.point, { scale: 0.45, debris: 1, color: this.weapon.rig.energyBase.scale(1.4) });
          this.fx.ring(out.point, PULSE_SPLASH, 0.22, this.weapon.rig.energyBase.scale(0.8), false);
        }
        return;
      }
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

  protected impactFx(family: WeaponFamily, out: ShotOutcome, power: number): void {
    const p = out.point;
    if (out.target === 'surface' && out.normal) {
      const pos = p.add(out.normal.scale(0.03));
      this.fx.impact(pos, out.normal, out.surface, family === 'beam');
      if (family === 'rail') {
        this.fx.burst('sparks', pos, Math.round(8 + 10 * power), out.normal, 0.7);
        this.fx.ring(pos, 1.6 * power + 0.6, 0.25, this.weapon.rig.energyBase.scale(0.5), false);
        this.fx.flashLight(pos, 3 * power, 0.18, this.weapon.rig.energyBase.scale(0.4));
      }
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

  /**
   * Legacy damage entry (player weapon, Sentinel-style tower hits, debug): rolls crit, then hands the hit to the
   * director's shared pipeline (statuses, reactions, events, kill handling) and plays direct-hit feedback.
   */
  damageEnemy(source: 'player' | 'turret', e: Enemy, base: number, point: Vector3, weakpoint: boolean, turret?: Turret, family?: WeaponFamily | 'arc', from?: Vector3): void {
    if (!e.alive) return;
    const player = source === 'player';
    const prec = this.director.build.count('s_precision');
    const crit = player && prec && (isChilled(e.status, 1) || speedFactor(e.status) < 0.95) ? { critChance: this.stats.critChance + UP.precision.crit(prec), critMultiplier: this.stats.critMultiplier + UP.precision.critDmg(prec) } : this.stats;
    // M7 run upgrades that scale weapon hits from the situation.
    if (player) {
      const ex = this.director.build.count('w_exec');
      if (ex && e.hp < e.maxHp * UP.exec.hp) base *= 1 + UP.exec.bonus(ex);
      const mo = this.director.build.count('m_momentum');
      if (mo && this.droneSpeed() > UP.momentum.speed) base *= 1 + UP.momentum.bonus(mo);
      // M7 legendary / exotic signatures (damage shaping).
      const sig = family !== 'arc' ? this.weaponSignature() : null;
      if (sig === 'overdrive' && this.weaponHeat() > 0.7) base *= 1.35;
      if (sig === 'phase' && (e.shield > 0 || e.armor > 0 || e.kind === 'enforcer' || e.kind === 'crawler')) base *= 1.8;
    }
    const roll = rollDamage(base, crit, weakpoint, Math.random, 'energy', source);
    // Arc Conductor: a player hit may jump to the nearest other enemy (no chains of arcs).
    if (player && family !== 'arc' && this.stats.arcChance > 0 && Math.random() < this.stats.arcChance) this.arcFrom(e, point, roll.amount * this.stats.arcDamage);
    const src = family === 'arc' ? { kind: 'effect' as const, id: 'arc_conductor' } : player ? { kind: 'weapon' as const, id: family ?? 'plasma' } : { kind: 'tower' as const, id: 'sentinel', towerId: turret?.id };
    const res = this.director.deal({ target: e, amount: roll.amount, base, crit: roll.crit, weak: weakpoint, element: 'none', source: src, chain: this.director.bus.newChain(), point, family: family ?? (player ? 'plasma' : 'tower'), from: from ?? (player ? this.player.eye : undefined) });
    if (player && family !== 'arc') this.signatureAfterHit(e, point, roll.amount, roll.crit, res);
    if (player) {
      const kind = res.kind;
      uiEvents.emit('hit', kind);
      // Beam ticks are frequent: lighter per-tick feedback (the beam contact carries the rest).
      const beam = family === 'beam';
      if (kind === 'crit') this.fx.burst('crit', point, beam ? 3 : 10);
      else if (kind === 'hit' && !beam) this.fx.burst('enemySpark', point, 6);
      if (!beam || kind === 'kill' || kind === 'crit') sfx.play(kind === 'kill' ? 'kill' : kind === 'crit' ? 'crit' : kind === 'shield' ? 'shieldHit' : 'hit');
      else sfx.play('hit', { volume: 0.35 });
    }
  }

  /** M7 Pulse Capacitor: every pulse detonates (60% damage in PULSE_SPLASH m). */
  protected pulseSplash(point: Vector3, dmg: number, hit: Enemy | null): void {
    this.director.blast(point, PULSE_SPLASH, dmg * 0.6, 'none', { kind: 'weapon', id: 'beam' }, this.director.bus.newChain(), { falloff: 0.4, exclude: hit, family: 'splash' });
  }

  private wasOverheated = false;
  private sigHits = 0;

  /** Signature of the weapon firing right now (co-op server: the shooter's). */
  protected weaponSignature(): string | null {
    return this.inventory.equipped('weapon')?.signature ?? null;
  }
  protected weaponHeat(): number {
    return this.weapon.heat / 100;
  }

  /** M7 signatures that react to a landed hit. */
  private signatureAfterHit(e: Enemy, point: Vector3, amount: number, crit: boolean, res: { dealt: number; killed: boolean }): void {
    const sig = this.weaponSignature();
    if (!sig) return;
    const d = this.director;
    const src = { kind: 'effect' as const, id: `sig:${sig}` };
    if (sig === 'chain_reaction' && res.killed) {
      d.blast(point, 3.5, amount * 0.6, 'thermal', src, d.bus.newChain(), { falloff: 0.35, exclude: e });
      d.explosionFx(point, 3.5, 'thermal');
    } else if (sig === 'stormcaller' && ++this.sigHits % 6 === 0 && e.alive) {
      const sky = point.add(new Vector3(0, 9, 0));
      this.wfx.arc(sky, point);
      d.chainLightning({ from: point, first: e, count: 3, amount: amount * 2, falloff: 0.7, source: src, chain: d.bus.newChain(), shock: true });
      sfx.play('arc', { volume: 0.9, pitch: 0.7 });
    } else if (sig === 'siphon' && res.dealt > 0 && this.player.maxShield > 0) {
      this.player.shield = Math.min(this.player.maxShield, this.player.shield + res.dealt * 0.03);
    } else if (sig === 'rift_echo' && crit) {
      for (const o of d.enemiesNear(point, 4)) d.inflict(o, { chill: 40 }, src, d.bus.newChain(), o.center(new Vector3()));
      this.fx.ring(point, 4, 0.4, new Color3(1.6, 0.5, 3.0), false);
    }
  }
  /** Current drone speed (m/s); dashes count as fast. The co-op server reports the shooter's. */
  protected droneSpeed(): number {
    return this.player.dashing ? 40 : this.player.speed;
  }

  /** Arc to the nearest other living enemy within ARC_RANGE of the struck one. */
  protected arcFrom(src: Enemy, point: Vector3, amount: number): void {
    if (amount <= 0) return;
    let best: Enemy | null = null;
    let bestD = ARC_RANGE * ARC_RANGE;
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

  onEnemyKilled(e: Enemy): void {
    this.kills++;
    this.survival.onKill(e);
    const eliteK = 1 + 0.6 * e.mods.length;
    const reward = Math.round(e.def.reward * eliteK * this.stats.coreIncomeMult);
    this.wallet.earn(reward);
    uiEvents.emit('coresGained', reward);
    const salvage = Math.round(e.def.salvage * eliteK * this.cfg.tier.salvageMult);
    if (this.cfg.run.collect({ salvage })) uiEvents.emit('salvageGained', salvage);
    // M4 income: credits per kill (elites pay well) and a chance of an advanced component from elites.
    const credits = Math.round((RUN_INCOME.killCredits[e.kind] ?? e.def.credits) * eliteK * this.cfg.tier.salvageMult);
    const boss = e.def.role === 'boss';
    const components = boss
      ? 3 + e.encounter + Math.floor(this.cfg.tier.id / 2)
      : (e.kind === 'bulwark' || e.elite) && this.lootRand() < RUN_INCOME.eliteComponentChance + 0.1 * e.mods.length ? 1 : 0;
    if (this.cfg.run.collect({ credits, components })) {
      if (credits) uiEvents.emit('creditsGained', credits);
      if (components) uiEvents.emit('componentsGained', components);
    }
    this.cfg.run.addKill();
    const at = e.center().clone();
    if (boss) at.y = Math.min(at.y, 6);
    if (e.kind in DROP_SOURCES && e.def.role !== 'hvt' && e.tag !== 'summon') this.dropLoot(e.kind as DropSourceId, at);
    if (e.elite) this.dropFrom(this.survival.eliteSource(e), at);
    this.enemies.kill(e, this.enemyFx, this.enemyCtx);
  }

  // ---------------------------------------------------------------- M6: hostile mechanics

  /** Every hostile hit on the drone goes through here. */
  hurtPlayer(amount: number, from: Vector3, target: Player = this.player): void {
    if (!target.alive || !(amount > 0) || !Number.isFinite(amount)) return;
    target.damage(amount, from);
  }

  /** Drones hostile area effects and projectiles can hit (co-op: every deployed drone). */
  targets(): readonly Player[] {
    return [this.player];
  }

  /** Living drone nearest to `p` (co-op ordnance and direct hits). */
  nearestTarget(p: Vector3): Player | null {
    let best: Player | null = null;
    let bd = Infinity;
    for (const t of this.targets()) {
      if (!t.alive) continue;
      const d = Vector3.DistanceSquared(t.position, p);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** Effects sink for enemy-internal presentation (deaths, shield hits). The co-op server silences it. */
  get enemyFx(): Effects {
    return this.fx;
  }

  /**
   * Area damage from hostile sources. The drone takes falloff damage unless geometry shields it (cover works);
   * the reactor takes damage if the blast overlaps it; towers inside are suppressed (never destroyed);
   * `enemies` > 0 also damages machines (volatile chains, grid strikes) through the shared pipeline.
   */
  hostileBlast(center: Vector3, radius: number, o: { player: number; reactor?: number; disable?: number; enemies?: number; owner?: Enemy | null; color?: 'orange' | 'blue' | 'red' | 'violet'; shock?: boolean }): void {
    const drones = this.targets();
    const lift = TMP.copyFrom(center);
    lift.y += 0.6;
    const plan = planBlast(center, radius, o, {
      drones: drones.map((d) => ({ alive: d.alive, pos: d.position })),
      clearShot: (i) => this.los(lift, drones[i].eye),
      towers: this.turrets.turrets,
      reactor: ARENA.reactor,
    });
    for (const h of plan.droneHits) this.hurtPlayer(h.amount, center, drones[h.index]);
    if (plan.reactorDamage > 0) this.damageReactor(plan.reactorDamage, center);
    for (const i of plan.disableTowers) this.turrets.turrets[i].disable(plan.disableSeconds);
    if (plan.machineDamage > 0) {
      this.director.blast(center, radius, plan.machineDamage, 'none', { kind: 'effect', id: 'hazard' }, this.director.bus.newChain(), { falloff: 0.4, exclude: o.owner ?? null, shock: o.shock });
    }
  }

  /** A plasma-vent eruption tick: burns the drone and every machine standing in it. */
  protected ventTick(at: Vector3, r: number): void {
    const w = this.waves.wave;
    this.hostileBlast(at, r, { player: 9 * w.damageMult, enemies: 0, color: 'orange' });
    const chain = this.director.bus.newChain();
    for (const e of [...this.enemies.active]) {
      if (!e.alive || e.pos.y > 2 || (e.pos.x - at.x) ** 2 + (e.pos.z - at.z) ** 2 > r * r) continue;
      this.director.deal({ target: e, amount: 10 * w.hpMult, element: 'thermal', source: { kind: 'effect', id: 'hazard' }, chain, point: e.center(), apply: { burn: 4 * w.hpMult }, quiet: true });
    }
  }

  /**
   * Compile M6 materials before the arena is revealed: enemy/boss hull + glow materials (instanced variants, as the
   * kit renders them), telegraphs, ordnance and the hidden arena machinery. Avoids hitches and late pop-in the first
   * time a boss, elite or event appears.
   */
  protected warmShaders(): Promise<unknown> {
    // One of every rig (and all elite hardware) so every (shape, material) template exists, then compile them all.
    this.enemies.prebuild(['walker', 'rusher', 'bulwark', 'enforcer', 'artillery', 'engineer', 'courier', 'colossus', 'overseer', 'pylon', 'jammer', 'crawler']);
    const jobs: Promise<unknown>[] = [this.tele.warm(), this.ordnance.warm(), this.kit.warmAll()];
    for (const m of this.scene.meshes) {
      if (m.isEnabled() || !m.material || !/^(dynPart|ventPlume|ventWarn|volatileCharge)/.test(m.name)) continue;
      jobs.push(m.material.forceCompilationAsync(m).catch(() => {}));
    }
    return Promise.all(jobs);
  }

  /** Reinforcements summoned by bosses (bounded by the active-enemy cap). */
  summon(kind: EnemyKind, at: Vector3, o: { mods?: EliteModId[]; gate?: GateId } = {}): Enemy | null {
    if (this.enemies.count >= 46) return null;
    const w = this.waves.wave;
    let gate: GateId = o.gate ?? 'north';
    if (!o.gate) {
      // Join the lane whose path passes closest to the summon point.
      let best = Infinity;
      for (const g of this.survival.plan?.gates ?? ['north', 'east', 'west']) {
        const p = ARENA.routes[g].points[2];
        const d = (p.x - at.x) ** 2 + (p.z - at.z) ** 2;
        if (d < best) {
          best = d;
          gate = g;
        }
      }
    }
    const e = this.enemies.spawn(kind, gate, ARENA, w.hpMult, w.damageMult, w.speedMult, { mods: o.mods, tag: 'summon', ctx: this.enemyCtx });
    // Start at the summon point, heading for the nearest waypoint of that lane.
    let seg = 1;
    let bd = Infinity;
    for (let i = 1; i < e.path.length; i++) {
      const d = (e.path[i].x - at.x) ** 2 + (e.path[i].z - at.z) ** 2;
      if (d < bd) {
        bd = d;
        seg = i;
      }
    }
    e.pos.set(at.x, 0, at.z);
    e.seg = seg;
    e.motion?.reset(e.pos, e.yaw);
    this.fx.burst('build', e.center(), 20);
    return e;
  }

  protected ordnanceCtx = {
    player: (at?: Vector3) => {
      const t = at ? this.nearestTarget(at) : this.player.alive ? this.player : null;
      return t ? t.eye : null;
    },
    ray: (a: Vector3, b: Vector3) => {
      const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
      if (!physics) return null;
      physics.raycastToRef(a, b, this.physResult, ENV_QUERY);
      return this.physResult.hasHit ? this.physResult.hitPointWorld.clone() : null;
    },
    impact: (i: Impact) => this.ordnanceImpact(i),
    trail: (kind: Impact['kind'], pos: Vector3) => {
      if (kind === 'shell' || kind === 'bomb') this.fx.burst('embers', pos, 1);
      else if (kind === 'missile') this.fx.burst('smoke', pos, 1, undefined, 0.4);
      else this.fx.burst('zap', pos, 1, undefined, 0.5);
    },
  };

  protected ordnanceImpact(i: Impact): void {
    const p = i.pos;
    if (i.direct) {
      const t = this.nearestTarget(p);
      if (t) this.hurtPlayer(i.damage, p, t);
      this.fx.burst(i.kind === 'orb' ? 'zap' : 'enemySpark', p, 12);
      return;
    }
    if (i.kind === 'orb') {
      this.fx.burst('zap', p, 8);
      return;
    }
    const big = i.kind === 'bomb' ? 1.6 : i.kind === 'shell' ? 1.1 : 0.6;
    this.fx.explode(p, { scale: big, debris: i.kind === 'missile' ? 2 : 6, color: i.kind === 'bomb' ? new Color3(1.6, 0.6, 3.2) : undefined });
    sfx.play('explosion', { volume: this.panFor(p).volume * 0.8, pitch: i.kind === 'missile' ? 1.4 : 0.9, pan: this.panFor(p).pan });
    this.hostileBlast(p, i.radius, { player: i.damage, reactor: i.reactorDamage, disable: i.disable });
  }

  /** Roll an arbitrary drop source (elites, events, HVT) and place the items. */
  dropFrom(src: DropSource, at: Vector3, wave = this.waves.number): Pickup[] {
    const out: Pickup[] = [];
    for (const item of this.rollFrom(src, wave)) {
      const p = this.spawnPickup(item, at, wave);
      if (p) out.push(p);
    }
    return out;
  }

  /** Towers recompose their numbers (arena state changed their fire-rate boost). */
  bumpStats(): void {
    this.statsVersion++;
    this.turretCtx.statsVersion = this.statsVersion;
  }

  towerFireBoost(t: Turret): number {
    return this.survival ? this.survival.towerBoost(t) : 1;
  }

  /** Open a sealed gate (arena evolution): lane lights, rift light and embers. */
  openGate(gate: GateId): void {
    this.arenaVisuals.setSealed(gate, false);
    if (gate === 'south') this.atmosphere.setGateOpen(3, true);
  }

  /** Boss health bar data (behaviour supplies phase/state). */
  bossHud(e: Enemy): BossHud {
    const extra = e.behavior?.hud?.(e) ?? {};
    return { name: e.def.name.toUpperCase(), title: '', hp: e.hp, max: e.maxHp, phase: 1, ticks: [], state: '', immune: false, attack: '', encounter: e.encounter, ...extra };
  }

  /** First sighting of each M6 archetype / elite modifier this run: one line of counterplay intel. */
  protected seenKinds = new Set<string>();
  protected static readonly INTEL: Record<string, string> = {
    enforcer: 'NEW THREAT · SHIELDED ENFORCER · frontal shield: flank it, hit the rear generator, or shock it',
    artillery: 'NEW THREAT · ARTILLERY DRONE · interrupt its charge with burst damage before the shell lands',
    jammer: 'NEW THREAT · JAMMER DRONE · it locks onto towers and shuts them down: shoot its dish or shock it to break the beam',
    crawler: 'NEW THREAT · SIEGE CRAWLER · armoured prow: hit the rear pods; it releases rush drones when damaged',
    engineer: 'NEW THREAT · SUPPORT ENGINEER · repairs and empowers allies: eliminate it first',
    overcharged: 'ELITE · OVERCHARGED · blue ring = discharge incoming: back off or freeze/shock it',
    armored: 'ELITE · ARMORED · plating absorbs body hits: aim for weakpoints',
    accelerated: 'ELITE · ACCELERATED · fast with thruster boosts: intercept early',
    volatile: 'ELITE · VOLATILE · detonates 1.4 s after death: keep your distance',
  };

  protected watchIntel(): void {
    for (const e of this.enemies.active) {
      const keys = [e.kind as string, ...e.mods];
      for (const k of keys) {
        if (this.seenKinds.has(k) || !Game.INTEL[k]) continue;
        this.seenKinds.add(k);
        uiEvents.emit('alert', { text: Game.INTEL[k], tone: e.mods.includes(k as EliteModId) ? 'white' : 'orange' });
      }
    }
  }

  /** Boss entrance: camera shake, roar, banner (once per boss). */
  protected watchBoss(): void {
    if (this.hudT <= 0) this.watchIntel();
    for (const e of this.enemies.active) {
      if (e.def.role !== 'boss' || !e.alive || e.id === this.bossSeen) continue;
      this.bossSeen = e.id;
      sfx.play('bossRoar', { volume: 1 });
      this.fx.onShake?.(this.player.position, 0.5);
      uiEvents.emit('alert', { text: `${e.def.name.toUpperCase()} HAS ENTERED THE FACILITY`, tone: 'red' });
    }
  }

  /** Copy measured damage totals into the run ledger (before the run is finalized/recorded). */
  syncStats(): void {
    const sv = this.cfg.run.survival;
    sv.playerDamage = this.director.dealt.player;
    sv.towerDamage = this.director.dealt.tower;
  }

  /** Automation hook: same path as enemy attacks. */
  debugDamageReactor(amount: number): void {
    this.damageReactor(amount, new Vector3(0, 2, 0));
  }

  protected damageReactor(amount: number, at: Vector3): void {
    if (this.reactorHp <= 0 || !(amount > 0)) return;
    this.cfg.run.survival.reactorDamage += Math.min(this.reactorHp, amount);
    this.reactorHp = Math.max(0, this.reactorHp - amount);
    this.reactorHitT = 1;
    if (this.reactorSfxT <= 0) {
      this.reactorSfxT = 0.25;
      const a = this.panFor(at);
      sfx.play('reactorHit', { volume: Math.max(0.5, a.volume), pan: a.pan });
    }
    if (this.reactorHp <= 0) this.onDefeat();
  }

  protected onDefeat(): void {
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

  protected updateProjectiles(hdt: number): void {
    if (hdt <= 0) return;
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
    const targets = this.targets();
    outer: for (const p of this.fx.projectiles) {
      if (!p.active) continue;
      const next = TMP.copyFrom(p.vel).scaleInPlace(hdt).addInPlace(p.pos);
      // Drones (segment vs sphere)
      for (const player of targets) {
        if (!player.alive || p.damage <= 0) continue;
        const pc = TMP2.copyFrom(player.eye);
        pc.y -= 0.3;
        if (segmentSphere(p.pos, next, pc, 0.8)) {
          this.hurtPlayer(p.damage, p.pos.subtract(p.vel), player);
          this.fx.burst('enemySpark', next, 10);
          this.fx.killProjectile(p);
          continue outer;
        }
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

  protected updateReactor(dt: number, live: boolean): void {
    this.reactorHitT = Math.max(0, this.reactorHitT - dt * 2.5);
    this.reactorSfxT -= dt;
    const f = live ? this.reactorHp / ECONOMY.reactorMaxHp : 1;
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
    this.reactor.update(dt, f, h);
  }

  // ---------------------------------------------------------------- queries

  los(a: Vector3, b: Vector3): boolean {
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

  protected perfHud() {
    const d = this.director.diag();
    let projectiles = this.wfx.liveBolts;
    for (const p of this.fx.projectiles) if (p.active) projectiles++;
    return {
      fps: Math.round(this.fpsSmooth), enemies: this.enemies.count, draws: this.drawCalls, particles: this.fx.particleCount,
      towers: this.turrets.turrets.length, projectiles, pending: d.pending, statuses: d.statuses, triggers: d.triggersPerSec,
      dpsPlayer: Math.round(d.dps.weapon), dpsTower: Math.round(d.dps.tower), effects: d.effects, dropped: d.dropped,
      frameMs: Math.round(this.frameMs * 100) / 100, aiMs: Math.round(this.enemies.aiAvg * 100) / 100, telegraphs: this.tele.active, ordnance: this.ordnance.live,
      wave: this.waves.number, tier: this.cfg.tier.id, event: this.survival.event ?? '-', boss: this.enemies.active.find((e) => e.def.role === 'boss')?.def.name ?? '-',
      budget: Math.round(this.waves.wave.plan?.budget ?? 0), hpMult: Math.round(this.waves.wave.hpMult * 100) / 100, dmgMult: Math.round(this.waves.wave.damageMult * 100) / 100,
      spawnQueue: this.waves.remainingToSpawn, elites: this.enemies.active.filter((e) => e.elite).length, dev: this.cfg.run.survival.dev,
    };
  }

  protected towerHud() {
    const dir = this.director;
    const ts = this.turrets.turrets;
    return {
      upgrades: dir.build.total,
      buffs: dir.buffs.map((b) => ({ name: b.name, t: b.t, stacks: b.stacks })),
      network: dir.networkCharge,
      grid: dir.gridCharge,
      empowered: ts.filter((t) => t.empowered).length,
      towers: ts.length,
      note: this.towerNote.t > 0 ? this.towerNote.text : '',
      template: `${partDef('weapon', this.buildConfig.weapon)?.name} · ${partDef('core', this.buildConfig.core)?.name} · ${partDef('modifier', this.buildConfig.modifier)?.name}`,
      templateCost: configCost(this.buildConfig, this.stats.buildCostMult),
    };
  }

  // ---------------------------------------------------------------- HUD

  protected publishHud(force = false): void {
    const w = this.waves;
    const c = this.construction;
    const t = this.inspected;
    const hint = hintFor({
      playing: this.screen === 'playing',
      phase: w.phase,
      wave: w.number,
      kills: this.kills,
      tacticalEnergy: this.tactical.energy,
      tacticalActive: this.tactical.active,
      canReturnHome: this.canReturnHome,
      playerAlive: this.player.alive,
      suppress: c.active || !!this.tut?.showing,
    });
    const run = this.cfg.run;
    const lt = this.lootTarget;
    let lootTarget: LootTargetInfo | null = null;
    if (lt && this.screen === 'playing') {
      const cur = this.inventory.equipped(this.inventory.targetSlot(lt.item) ?? 'weapon');
      lootTarget = lootTargetInfo({
        item: lt.item,
        droppedWave: lt.droppedWave,
        expiring: lt.expiring,
        cargoFull: this.inventory.cargoFull,
        equipped: cur ? { name: cur.name, level: cur.level, rarity: cur.rarity } : null,
      });
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
      run: runHud(this.cfg.tier.id, run, this.canReturnHome),
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
      dashMax: MOVE.dashCharges,
      dashRecharge: this.player.dashRecharge,
      tactical: this.tactical.energy / TacticalEnergy.MAX,
      tacticalActive: this.tactical.active,
      tacticalMin: TacticalEnergy.MIN_TO_ACTIVATE / TacticalEnergy.MAX,
      buildMode: c.active,
      buildValid: c.valid,
      buildMessage: c.message,
      buildCost: configCost(this.buildConfig, this.stats.buildCostMult),
      m5: this.towerHud(),
      inspect: t ? { name: t.name, kills: t.kills, damage: Math.round(t.damageDealt), refund: Math.round(t.paid * t.refundRatio), recycle: this.recycleT, card: this.towerInfo(t), edit: this.towerEditReason() } : null,
      hint,
      spread: 6 + this.weapon.spread * 900,
      perf: this.perfOn
        ? this.perfHud()
        : null,
      m6: this.survival.hud(),
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
      creditsUnsecured: this.cfg.run.unsecured.credits,
      creditsSecured: this.cfg.run.secured.credits,
      componentsUnsecured: this.cfg.run.unsecured.components,
      componentsSecured: this.cfg.run.secured.components,
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
