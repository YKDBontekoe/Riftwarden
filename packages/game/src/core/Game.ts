import { PINNACLE, pinnacleBoss } from '@riftwarden/rules/progression/spikes';
import { gearPower } from '@riftwarden/rules/progression/riftLevel';
import { type LootVerdictHost, LootVerdicts } from '../arena/LootVerdicts';
import { baseDef } from '@riftwarden/rules/loot/bases';
import { killMastery, masteryModifiers, type MasteryState } from '@riftwarden/rules/progression/mastery';
import '../babylonSideEffects';
import { sectorAffinity } from '@riftwarden/rules/combat/elements';
import { Ray } from '@babylonjs/core/Culling/ray.core';
import { type AbstractEngine as Engine } from '@babylonjs/core/Engines/abstractEngine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
import { type PhysicsEngine as PhysicsEngineV2 } from '@babylonjs/core/Physics/v2/physicsEngine';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { Scene } from '@babylonjs/core/scene';
import { treeModifiers, treeRules } from '@riftwarden/rules/progression/skilltree';
import { type Emitter, sfx } from '../audio/Sfx';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { Director } from '../combat/Director';
import { hashRunSeed, type OfferContext, type UpgradeDef, upgradeDef } from '@riftwarden/rules/roguelite/upgrades';
import { configCost, DEFAULT_CONFIG, partDef, STARTER_TECH, type TowerConfig, type TowerSlot } from '@riftwarden/rules/towers/components';
import { BASE_STATS, type CombatStats, computeStats, type StatModifier } from '@riftwarden/rules/combat/stats';
import { type ShotOutcome, type ShotRequest, Weapon, type WeaponFxHooks } from '../combat/Weapon';
import type { WeaponFamily } from '@riftwarden/rules/data/defs';
import { WeaponFx } from '../fx/WeaponFx';
import { ECONOMY } from '@riftwarden/rules/data/defs';
import { DevTools } from '../arena/DevTools';
import { type CombatHost, PlayerCombat } from '../arena/PlayerCombat';
import { type WeaponSlot, WeaponSlots, type WeaponSlotsHost } from '../arena/WeaponSlots';
import { Abilities, type AbilityHost } from '../arena/Abilities';
import { Movement, type MovementHost } from '../arena/Movement';
import { type DeployHost, Deployables } from '../arena/Deployables';
import type { AbilitySlot } from '@riftwarden/rules/abilities/defs';
import { type LootHost, LootPickups } from '../arena/LootPickups';
import { type TowerEdit, type TowerHost, TowerControl } from '../arena/TowerControl';
import { planBlast } from '@riftwarden/rules/combat/blast';
import { hintFor, lootTargetInfo, runHud } from '../ui/hudModel';
import { nextPity, rollLoot } from '@riftwarden/rules/loot/roll';
import { gearUniques } from '@riftwarden/rules/loot/uniques';
import { loadoutScore } from '@riftwarden/rules/loot/loadoutScore';
import { contactShadow } from '../visuals/grounding';
import { enemyContacts } from '../visuals/EnemyContacts';
import { createSunShadows } from '../arena/shadows';
import { CORE_BEHAVIORS } from '../enemies/coreBehaviors';
import { DROP_SOURCES, type DropSourceId } from '@riftwarden/rules/loot/drops';
import { equipmentModifiers, weaponDefFor } from '@riftwarden/rules/loot/equipment';
import { flatScale, generateItem, hashSeed } from '@riftwarden/rules/loot/generate';
import { convertsToSalvage, LootField, type Pickup } from '../loot/LootField';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { scrapValue } from '@riftwarden/rules/loot/economy';
import { RUN_INCOME } from '@riftwarden/rules/economy/config';
import { RunInventory } from '@riftwarden/rules/loot/runInventory';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { SLOT_IDS, type SlotId } from '@riftwarden/rules/progression/items';
import { Construction } from '../defense/Construction';
import { type Turret, type TurretContext, TurretManager } from '../defense/Turrets';
import { type Behavior, type Enemy, type EnemyContext, EnemyManager } from '../enemies/EnemyManager';
import { Effects } from '../fx/Effects';
import { MOVE, Player } from '../player/Player';
import { type HitKind, hudStore, type LootTargetInfo, type Screen, uiEvents } from '../ui/store';
import type { Rewards, RunLedger } from '@riftwarden/rules/progression/run';
import { isCheckpointWave, lootLevel, type ThreatTier } from '@riftwarden/rules/progression/tiers';
import { ArenaBuilder } from '../visuals/arena';
import { Atmosphere } from '../visuals/atmosphere';
import { PostFx } from '../visuals/postfx';
import { MoodDirector } from '../visuals/moodDirector';
import { Kit } from '../visuals/kit';
import { createPalette, type Palette } from '../visuals/materials';
import { buildReactor, type ReactorRig } from '../visuals/models';
import { WaveManager } from '../waves/WaveManager';
import type { SpawnEntry, WaveDef } from '@riftwarden/rules/waves/waves';
import { earlyCallBonus } from '@riftwarden/rules/waves/pace';
import { ARENA, type ArenaLayout, type GateId } from '@riftwarden/rules/world/layout';
import { EnemyNavigator } from '@riftwarden/rules/enemies/navigation';
import { TowerWear } from '../arena/TowerWear';
import { Hazards } from '../arena/Hazards';
import { biomeOf } from '@riftwarden/rules/world/biomes';
import { tintPalette } from '../visuals/biomeLook';
import { ENV_QUERY } from '../world/physicsGroups';
import { type NodeHost, type NodeSetup, RunNode } from '../arena/RunNode';
import { HUNT, Hunt } from '@riftwarden/rules/arena/Hunt';
import type { RunMode } from '@riftwarden/rules/runmap/defs';
import { type Impact, Ordnance, Telegraphs } from '../fx/Hostile';
import { M6_BEHAVIORS } from '../enemies/behaviors';
import { JAMMER_CRAWLER_BEHAVIORS } from '../enemies/jammerCrawlerBehaviors';
import { FACTION_BEHAVIORS } from '../enemies/factionBehaviors';
import { BOSS_BEHAVIORS } from '../enemies/bosses';
import { bossMults, SurvivalPlanner } from '@riftwarden/rules/survival/plan';
import { SurvivalRuntime } from '../survival/SurvivalRuntime';
import { ArenaDynamics } from '../world/ArenaDynamics';
import type { DropSource } from '@riftwarden/rules/loot/drops';
import type { BossHud } from '../ui/store';
import type { EnemyKind } from '@riftwarden/rules/data/defs';
import type { EliteModId } from '@riftwarden/rules/survival/elites';
import type { Input } from './Input';
import { type Settings, keyLabel, saveSettings } from './settings';
import { TacticalEnergy, Wallet } from '@riftwarden/rules/core/tactical';
import { type TutorialHost, TutorialDirector } from './TutorialDirector';

const TMP = new Vector3();
/** Sun intensity (directional, range-free). */
const SUN = 2.15;
const TMP2 = new Vector3();

/** Callbacks into the session flow (persistence and scene transitions live there). */
export interface ArenaHooks {
  /** A checkpoint wave was cleared and these rewards were just secured by the run. Returns true once persisted. */
  bank(wave: number, rewards: Rewards): boolean;
  /** Checkpoint preparation started: offer continue / return home. */
  checkpoint(): void;
  /** Reactor destroyed. */
  defeat(): void;
  /** Run map: the map screen opened (the flow publishes the map view). */
  mapOpened?(): void;
  /** Run map: an act boss fell. */
  actCleared?(act: number): void;
  /** Run map: a combat sector was secured (counts in the Rift War). */
  nodeSecured?(nodeId: string): void;
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
  /** Warden skill tree (seed + allocated nodes), snapshotted at deployment. */
  tree?: { seed: number; allocated: readonly string[] };
  /** Staged-unlock loot locks at deployment (`progression/unlocks` `lootLocks`; recorded with every loot roll). */
  locks?: readonly string[];
  /** Slots the warden has not unlocked (run equips refuse them). */
  lockedSlots?: readonly SlotId[];
  /** Weapon-family mastery at deployment (rank damage, perks, finishes). */
  mastery?: MasteryState;
  /** Best owned item power per kind at deployment (loot/feedback `bestPowers`): NEW BEST on pickups. */
  ownedBest?: ReadonlyMap<string, number>;
  /** A pinnacle run (a key was spent): the pinnacle boss leads wave 1 and drops the pinnacle table. */
  pinnacle?: boolean;
  /** Arena layout for this run (procedural from the run seed); defaults to the classic hand-built arena. */
  layout?: ArenaLayout;
  /** Run map node this arena plays (absent = classic endless run with checkpoint choices). */
  node?: NodeSetup;
  /** Game mode: defense (hold the reactor, build towers) or survival (no towers, every machine hunts the drone, one life). */
  mode?: RunMode;
}

export type { RunMode };

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
  protected mood: MoodDirector;
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
  /** Permanent skill tree modifiers (snapshotted at deployment). */
  protected treeMods: StatModifier[] = [];
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
  /** Rift shard rolls: their own stream, so loot rolls of a run seed never shift. */
  protected shardRand: () => number;
  protected lootCounter = 0;
  /** Values drawn from the loot stream (recorded with each roll for the server's re-roll). */
  protected lootDraws = 0;
  lootTarget: Pickup | null = null;
  /** Loot placement, landing/pickup presentation and targeting. */
  protected readonly pickups = new LootPickups(this.lootHost());
  /** NEW BEST / verdict / item level of the targeted pickup (cached per item). */
  readonly verdicts = new LootVerdicts(this.verdictHost());
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
  /**
   * Kill feel: a short hitstop dilates hostile time only (the drone keeps full control). Off on the co-op server,
   * whose hostile clock is shared by every player.
   */
  hitstopEnabled = true;
  protected hitstopT = 0;
  protected hitstopScale = 1;
  private wasOverheated = false;
  /** The player's weapon combat (hit resolution, damage entry, kill feel, shot visuals). */
  protected readonly combat = new PlayerCombat(this.combatHost());
  /** Primary + secondary weapon: which one is in hand, the holstered one's heat. */
  readonly weaponSlots = new WeaponSlots(this.weaponSlotsHost());
  /** Ability I/II and the ultimate (the co-op server keeps one per avatar and swaps it in with `as`). */
  abilities = new Abilities(this.abilityHost());
  /** Shield walls, the holo decoy and mini-sentries placed by abilities (shared world objects). */
  readonly deployables = new Deployables(this.deployHost());
  /** Slide / wall-run / grapple / ground pound: grapple input, pound blasts, grapple line. */
  readonly movement = new Movement(this.movementHost());
  protected kills = 0;
  protected turretsBuilt = 0;
  protected defeatT = 0;
  protected hudT = 0;
  /** Tower inspection, recycle/repair, refit hotkeys and the build template. */
  protected readonly towers = new TowerControl(this.towerHost());
  protected perfOn = false;
  protected instrumentation: SceneInstrumentation | null = null;
  protected fpsSmooth = 60;

  protected shotRay = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  protected physResult = new PhysicsRaycastResult();
  protected enemyCtx: EnemyContext;
  turretCtx: TurretContext;

  /** Return-home window: open from checkpoint prep until the next wave starts. */
  checkpointOpen = false;
  /** Run map node (segment, hub stations, carry); null on classic endless runs. */
  node: RunNode | null = null;
  /** Survival mode: the machines hunt the drone (null in defense). */
  hunt: Hunt | null = null;

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
  /** This run's arena (procedural from the run seed, or the classic hand-built arena). */
  get layout(): ArenaLayout {
    return this.cfg.layout ?? ARENA;
  }
  /** M10: biome ground hazards (frost fields, slag pools, slag trails). */
  hazards: Hazards | null = null;
  /** Tower durability (breaches, wrecks, repairs) on mazing arenas. */
  readonly wear: TowerWear;
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
    scene.clearColor = new Color4(0.2, 0.2, 0.22, 1);
    scene.ambientColor = new Color3(0.04, 0.045, 0.05);
    scene.skipPointerMovePicking = true;
    scene.enablePhysics(new Vector3(0, -26, 0), new HavokPlugin(true, havok));

    const high = settings.quality === 'high';
    this.pal = tintPalette(createPalette(scene, high, false, this.layout), biomeOf(this.layout));
    this.kit = new Kit(scene);

    // Alpine horizon, haze, lamps and embers. PBR ambient comes from the captured environment.
    this.atmosphere = new Atmosphere(scene, this.pal, this.layout);
    this.atmosphere.setQuality(high);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = biomeOf(this.layout).fogDensity;
    scene.fogColor = this.atmosphere.fogColor;

    // Low warm key against the mountain sky. Sky fill also keeps shaded enemies readable.
    const moon = new DirectionalLight('sun', this.atmosphere.sunDir.scale(-1), scene);
    moon.position = this.atmosphere.sunDir.scale(120);
    moon.intensity = SUN * biomeOf(this.layout).sunMul;
    moon.diffuse = new Color3(...biomeOf(this.layout).sun);
    moon.specular = new Color3(1, 0.86, 0.70);
    this.moon = moon;
    this.reactorLight = new PointLight('reactorLight', new Vector3(0, 5, 0), scene);
    this.reactorLight.diffuse = new Color3(0.3, 0.9, 1);
    this.reactorLight.specular = new Color3(0.12, 0.4, 0.52);
    this.reactorLight.intensity = 2.5;
    this.reactorLight.range = 24;

    // Arena
    const arena = new ArenaBuilder(scene, this.pal, this.layout);
    arena.build();
    this.atmosphere.lightYard(arena.meshes);
    this.arenaVisuals = arena;
    this.atmosphere.adoptPortals();
    this.reactor = buildReactor(scene, this.pal, high);
    contactShadow(scene, this.layout.reactor.x, this.layout.reactor.z, 9.4, 9.4);

    this.player = new Player(scene, this.layout.playerSpawn);
    scene.activeCamera = this.player.camera;
    const weaponDef = weaponDefFor(cfg.loadout.weapon);
    if (!weaponDef) throw new Error('deployment requires an equipped weapon');
    this.weapon = new Weapon(scene, weaponDef, this.player, cfg.loadout.weapon);
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);
    this.post = new PostFx(scene, engine, this.player.camera, high, true);
    Object.assign(this.post, { baseContrast: 1.13, baseExposure: 1.06 }); // retain shadow detail under the directional key
    this.mood = new MoodDirector(scene, this.moon, this.post);

    this.fx = new Effects(scene, this.kit, this.pal, this.layout, high);
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
    const reactorCasters = this.reactor.root.getChildMeshes().filter((m) => m.material && !m.material.needAlphaBlendingForMesh(m));
    const sg = createSunShadows(moon, settings.shadows ?? (high ? 'high' : 'low'), high, [...arena.shadowCasters, ...reactorCasters]);
    if (sg) this.kit.shadowSink = (m) => sg.addShadowCaster(m);
    this.enemies = new EnemyManager(scene, this.kit, this.pal);
    if (!sg) enemyContacts(scene, this.enemies, this.player.camera.position);
    if (cfg.mode === 'survival') this.hunt = new Hunt(this.layout);
    this.wear = this.setupMazing();
    for (const [kind, b] of Object.entries({ ...CORE_BEHAVIORS, ...M6_BEHAVIORS, ...JAMMER_CRAWLER_BEHAVIORS, ...FACTION_BEHAVIORS, ...BOSS_BEHAVIORS })) if (b) this.enemies.register(kind as EnemyKind, b as Behavior);
    this.tele = new Telegraphs(scene);
    this.ordnance = new Ordnance(scene, this.tele);
    this.dynamics = new ArenaDynamics(scene, this.pal, this.layout, {
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
    this.planner = new SurvivalPlanner(((cfg.seed ?? hashRunSeed(cfg.run.id)) >>> 0) ^ 0x6d2b79f5, cfg.tier, this.layout.biome ? biomeOf(this.layout).faction : null);
    this.survival = new SurvivalRuntime(this);
    this.turrets = new TurretManager(scene, this.kit, this.pal);
    this.construction = new Construction(scene, (cfg, u) => this.turrets.build(cfg, 1, u), this.pal, this.layout);
    this.loot = new LootField(scene, this.kit, this.pal);
    this.loot.onLand = (p) => this.pickups.landed(p);
    this.inventory = new RunInventory(cfg.loadout, cfg.run);
    this.inventory.lockedSlots = cfg.lockedSlots ?? [];
    cfg.run.powerAtStart ??= gearPower(Object.values(cfg.loadout));
    this.weapon.finishFor = (f) => cfg.mastery?.[f]?.finish;
    if (cfg.node?.carry) this.inventory.adoptLoadout(cfg.node.carry.loadout);
    // Every map node rolls its own loot stream (a new arena must not replay the previous node's drops).
    const nodeSalt = cfg.node?.node.seed ?? 0;
    const lootStream = mulberry32((hashSeed(cfg.run.id) ^ nodeSalt) >>> 0);
    this.lootRand = () => (this.lootDraws++, lootStream());
    this.shardRand = mulberry32((hashSeed(cfg.run.id) ^ 0x51ed27a3 ^ nodeSalt) >>> 0);
    this.towerTech = new Set([...STARTER_TECH, ...(cfg.towerTech ?? [])]);
    this.applyTree(cfg.tree);
    this.director = new Director(this, cfg.seed ?? hashRunSeed(cfg.run.id));

    // Reflections/ambient: capture the finished static scene once into a prefiltered cube map.
    this.atmosphere.captureEnvironment([...arena.meshes, ...this.reactor.root.getChildMeshes()], this.pal.lit, high);

    const game = this;
    this.enemyCtx = {
      player: this.player,
      effects: this.fx,
      layout: this.hunt?.layout ?? this.layout,
      damageReactor: (a, at) => this.damageReactor(a, at),
      los: (a, b) => this.los(a, b),
      panFor: (p) => this.panFor(p),
      towers: this.turrets.turrets,
      tele: this.tele,
      ordnance: this.ordnance,
      hurtPlayer: (a, from) => this.hurtPlayer(a, from, this.enemyCtx.player),
      focus: (e) => {
        this.enemyCtx.player = this.deployables.decoyFor(e.pos) ?? this.player;
        this.hunt?.aim(this.enemyCtx.player.position);
      },
      hostileBlast: (c, r, o) => this.hostileBlast(c, r, o),
      summon: (kind, at, o) => this.summon(kind, at, o),
      alert: (text, tone) => uiEvents.emit('alert', { text, tone }),
      escaped: (e) => this.survival.onEscape(e),
      get time() { return game.hostileT; }, // prettier-ignore
      hazard: (x, z, r, kind, life) => this.hazards?.add(x, z, r, kind, life),
      damageTower: (t, amount) => this.wear.breach(t.id, amount, null),
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

    this.waves = new WaveManager({
      spawn: (s, w) => this.spawnEntry(s, w),
      aliveCount: () => this.enemies.count,
      onWaveStart: (w) => this.waveStarted(w),
      onWaveCleared: (w) => this.waveCleared(w),
      onPrepStart: (w) => this.prepStarted(w),
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
    em('reactor', this.layout.reactor.x, 3, this.layout.reactor.z, 1, 6);
    for (const gate of ['north', 'east', 'west'] as const) {
      const p = this.layout.routes[gate].points[0];
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
    if (cfg.node) this.node = new RunNode(this.nodeHost(), cfg.node, this.nodeReplica);
  }

  /** Spawn one wave entry (waves, vault guardians, ambushes). */
  protected spawnEntry(s: SpawnEntry, w: WaveDef): void {
    let hp = w.hpMult * (s.hpMult ?? 1);
    let dmg = w.damageMult;
    if (s.tag === 'boss') {
      const b = bossMults(s.encounter ?? 1, this.cfg.tier);
      hp *= b.hp;
      dmg *= b.damage;
    }
    // The gate (or the forward rift the enemy came out of) flares.
    this.arenaVisuals.gateSpawned(s.gate, this.enemies.spawn(s.kind, s.gate, this.layout, hp, dmg, w.speedMult, { mods: s.mods, tag: s.tag, encounter: s.encounter, ctx: this.enemyCtx }).path[0]);
  }

  /** Sustained weapon DPS of the current run loadout (gear only; node intel on the run map). */
  firepower(): number {
    return loadoutScore(this.inventory.equippedItems()).dps;
  }

  /** Survival rest: every drone back to full hull and shield (co-op: the whole team). */
  protected healDrones(): void {
    for (const p of this.targets()) if (p.alive) p.setVitals(p.maxHp, p.maxHp, p.maxShield, p.maxShield, true, 0);
  }

  /** Co-op replicas show the node; the server plays it. */
  protected get nodeReplica(): boolean {
    return false;
  }

  /** A node station hands an item to the player (co-op server: the acting avatar). */
  protected nodeGrant(item: ItemInstance): boolean {
    if (!this.inventory.collect(item)) return false;
    this.inventoryVersion++;
    return true;
  }

  /** A node asks for the run map (exit rift); the co-op server opens a vote instead. */
  protected nodeOpenMap(): void {
    this.checkpointOpen = true;
    this.openCheckpoint();
  }

  /** A node opened a station panel (local UI). */
  protected nodeOpenPanel(): void {
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.setScreen('station');
    this.input.releaseLock();
  }

  /** Co-op replica: a station action goes to the server. */
  protected nodeStation(_station: string, _opt: string): void {}

  /** Narrow host for the run-map node (see arena/RunNode). */
  protected nodeHost(): NodeHost {
    const g = this;
    return {
      get scene() { return g.scene; }, // prettier-ignore
      get kit() { return g.kit; }, // prettier-ignore
      get pal() { return g.pal; }, // prettier-ignore
      get layout() { return g.layout; }, // prettier-ignore
      get waves() { return g.waves; }, // prettier-ignore
      get planner() { return g.planner; }, // prettier-ignore
      get run() { return g.cfg.run; }, // prettier-ignore
      get build() { return g.director.build; }, // prettier-ignore
      lootLevelAt: (wave: number) => lootLevel(g.cfg.tier, wave),
      get riftLevel() { return g.cfg.tier.id; }, // prettier-ignore
      get cores() { return g.wallet.cores; }, // prettier-ignore
      set cores(v: number) { g.wallet.cores = Math.max(0, Math.floor(v)); }, // prettier-ignore
      get reactorHp() { return g.reactorHp; }, // prettier-ignore
      set reactorHp(v: number) { g.reactorHp = v; }, // prettier-ignore
      reactorMax: ECONOMY.reactorMaxHp,
      get ult() { return g.abilities.ult; }, // prettier-ignore
      set ult(v: number) { g.abilities.ult = v; }, // prettier-ignore
      get lootCounter() { return g.lootCounter; }, // prettier-ignore
      set lootCounter(v: number) { g.lootCounter = v; }, // prettier-ignore
      get dropChanceMult() { return g.dropChanceMult; }, // prettier-ignore
      set dropChanceMult(v: number) { g.dropChanceMult = v; }, // prettier-ignore
      get dealt() { return g.director.dealt; }, // prettier-ignore
      playerEye: () => g.player.camera.position,
      playerDir: () => g.player.camera.getDirection(Vector3.Forward()),
      playerPos: () => g.player.position,
      towers: () => g.turrets.turrets.filter((t) => !t.temporary).map((t) => ({ paid: t.paid, wrecked: t.wrecked })),
      loadout: () => ({ ...g.inventory.loadout }),
      pickupsLeft: () => g.loot.count,
      rebuildStats: () => g.rebuildStats(),
      rebuildEffects: () => g.director.rebuildEffects(),
      spawnEntry: (s, w) => g.spawnEntry(s, w),
      enemiesAlive: () => g.enemies.count,
      dropFrom: (src, at) => void g.dropFrom(src, at),
      makeItem: (o, level) => generateItem({ uid: `${g.cfg.run.id}.m${o.seed.toString(36)}`, seed: o.seed, level, rarity: o.rarity, category: o.category, source: g.cfg.run.id }),
      sendStation: (st, opt) => g.nodeStation(st, opt),
      grantItem: (item) => g.nodeGrant(item),
      openUpgrade: () => g.openUpgrade(),
      openMap: () => g.nodeOpenMap(),
      openPanel: () => g.nodeOpenPanel(),
      screenPlaying: () => g.screen === 'playing',
      tacticalRefill: () => (g.tactical.energy = TacticalEnergy.MAX),
      get survival() { return !!g.hunt; }, // prettier-ignore
      healDrone: () => g.healDrones(),
      actCleared: (act) => g.cfg.hooks.actCleared?.(act),
      secured: (id) => g.cfg.hooks.nodeSecured?.(id),
    };
  }

  // ---------------------------------------------------------------- wave lifecycle

  protected waveStarted(w: WaveDef): void {
    this.checkpointOpen = false;
    this.survival.start(w);
    // Armor is measured against the incoming wave's level.
    this.player.applyStats(this.stats, this.attackerScale);
    sfx.play('waveStart');
    if (!w.plan?.event && !w.plan?.boss) uiEvents.emit('banner', { title: `WAVE ${w.number}`, sub: `${w.spawns.length} hostiles inbound${w.plan && w.number > 3 ? ` · ${this.survival.hud().theme.toLowerCase()}` : ''}`, tone: 'orange' });
  }

  /** Wave cleared: rewards, reactor repair, wave drop, loot lifetime, checkpoint banking. */
  protected waveCleared(w: WaveDef): void {
    this.survival.cleared(w);
    this.upgradeDue = true;
    this.director.bus.emit({ type: 'waveCleared', chain: this.director.bus.newChain(), source: { kind: 'effect', id: 'wave' }, value: w.number });
    this.wallet.earn(w.clearReward);
    uiEvents.emit('coresGained', w.clearReward);
    this.reactorHp = Math.min(ECONOMY.reactorMaxHp, this.reactorHp + ECONOMY.reactorMaxHp * ECONOMY.reactorRepairPerWave);
    sfx.play('waveClear');
    const salvage = Math.round((ECONOMY.salvageWaveBase + w.number * ECONOMY.salvagePerWave) * this.cfg.tier.salvageMult);
    const credits = Math.round(RUN_INCOME.waveCredits(w.number) * this.cfg.tier.salvageMult);
    this.cfg.run.collect({ salvage, credits });
    uiEvents.emit('salvageGained', salvage);
    uiEvents.emit('creditsGained', credits);
    this.cfg.run.waveCleared(w.number);
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
      const cpCredits = Math.round(RUN_INCOME.checkpointCredits(w.number) * this.cfg.tier.salvageMult);
      const cpComponents = RUN_INCOME.checkpointComponents(w.number, this.cfg.tier.id);
      const cpShards = RUN_INCOME.checkpointShards(w.number, this.cfg.tier.id);
      this.cfg.run.collect({ items: this.lastCache, credits: cpCredits, components: cpComponents, shards: cpShards });
      uiEvents.emit('creditsGained', cpCredits);
      uiEvents.emit('componentsGained', cpComponents);
      banked = this.cfg.run.bank(w.number);
    }
    if (banked) {
      this.lastBankSaved = this.cfg.hooks.bank(w.number, banked);
      this.inventoryVersion++;
      const n = banked.items.length;
      if (this.lastBankSaved) {
        sfx.play('bank');
        uiEvents.emit('banner', { title: 'CHECKPOINT SECURED', sub: `Wave ${w.number} cleared · ${banked.salvage} salvage · ${banked.credits} cr · ${banked.components} comp${banked.shards ? ` · ${banked.shards} shards` : ''}${n ? ` · ${n} item${n === 1 ? '' : 's'}` : ''} banked to HQ`, tone: 'cyan' });
      } else if (this.cfg.run.survival.dev) uiEvents.emit('banner', { title: 'CHECKPOINT · DEVELOPMENT SESSION', sub: 'Development tools were used this run: nothing is banked to HQ', tone: 'white' });
      else uiEvents.emit('banner', { title: 'CHECKPOINT · SAVE FAILED', sub: 'Rewards are held by the run but could not be written to storage yet', tone: 'red' });
    } else uiEvents.emit('banner', { title: `WAVE ${w.number} CLEARED`, sub: `+${w.clearReward} cores · +${salvage} salvage · +${credits} cr · reactor repaired`, tone: 'cyan' });
    this.node?.waveCleared(w.number);
  }

  protected prepStarted(w: WaveDef): void {
    this.arenaVisuals.prepareWave(w.spawns.map((entry) => entry.gate));
    this.survival.prep(w);
    this.cfg.run.waveReached(w.number);
    // Run map: the map (not the checkpoint panel) opens once the node's segment is complete.
    if (this.node) this.checkpointOpen = this.node.complete;
    else if (w.number > 1 && this.cfg.run.atCheckpoint) this.checkpointOpen = true;
    // Mandatory upgrade choice first (the prep countdown is frozen while it is open), then the checkpoint choice.
    if (this.skipUpgrades) this.upgradeDue = false;
    if (this.upgradeDue && w.number > 1) this.openUpgrade();
    else if (this.checkpointOpen && (!this.node || this.node.mapDue)) this.openCheckpoint();
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
    this.atmosphere.setDensity(s.particles === 'low' ? 0.45 : s.particles === 'medium' ? 0.75 : 1, s.reduceMotion);
    this.post.setOptions({ bloom: s.bloom, reduceMotion: s.reduceMotion });
    sfx.setVolume(s.volume);
    sfx.setMix(s.sfxVolume, s.uiVolume, s.ambienceVolume);
    saveSettings(s);
  }

  /** Enemy level scale for armor (same growth as flat item stats at this wave/tier). */
  get attackerScale(): number {
    return flatScale(lootLevel(this.cfg.tier, this.waves.number));
  }

  /**
   * Recompute every derived stat from the run loadout. Called only when equipment
   * changes (never per frame); replacing an item removes its old modifiers by
   * construction because the list is rebuilt from scratch.
   */
  refreshEquipment(): void {
    this.rebuildStats();
    const { item, def: w } = this.weaponSlots.sync();
    if (w) {
      this.weapon.setItem(item, w);
      this.wfx.setColor(this.weapon.rig.energyBase);
    }
    this.inventoryVersion++;
  }

  /** Permanent skill tree: stat modifiers, XP multiplier and starting cores (keystone rules). */
  private applyTree(tree: ArenaConfig['tree']): void {
    if (!tree) return;
    this.treeMods = treeModifiers(tree.seed, tree.allocated);
    const rules = treeRules(tree.seed, tree.allocated);
    this.cfg.run.xpMult = rules.xpMult;
    this.wallet.cores += rules.startCores;
  }

  /**
   * Recompute derived stats from scratch: equipment + debug modifiers + run upgrades + temporary buffs.
   * Event-driven (equipment change, upgrade picked, buff gained/expired), never per frame.
   */
  rebuildStats(): void {
    this.gearEffects = gearUniques(this.inventory.equippedItems(this.weaponSlots.inactive));
    const mods = [...equipmentModifiers(this.inventory.equippedItems(this.weaponSlots.inactive)), ...this.treeMods, ...masteryModifiers(this.cfg.mastery, this.handFamily()), ...this.modifiers, ...this.director.build.modifiers(), ...this.director.buffModifiers(), ...(this.node?.mods() ?? [])];
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
    const t = this.cfg.tier;
    const pity = run.pity;
    const locks = this.cfg.locks?.length ? [...this.cfg.locks] : undefined;
    if (this.dropChanceMult === 1) run.lootJournal.push({ node: this.cfg.node?.node.id ?? null, draw: this.lootDraws, counter: this.lootCounter, source: src, wave, tier: { lootLevelBonus: t.lootLevelBonus, lootLuck: t.lootLuck, id: t.id }, faction: this.director.faction, pity, locks });
    const items = rollLoot({ source: src, wave, tier: this.cfg.tier, rand: this.lootRand, nextUid: () => `${run.id}.${++this.lootCounter}`, originId: run.id, chanceMult: this.dropChanceMult, faction: this.director.faction, pity, locks });
    run.pity = nextPity(pity, items);
    return items;
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

  private verdictHost(): LootVerdictHost {
    const g = this;
    return {
      get ownedBest() { return g.cfg.ownedBest ?? new Map<string, number>(); }, // prettier-ignore
      runItems: () => g.inventory.entries().map((e) => e.item),
      equippedList: () => SLOT_IDS.map((s) => g.inventory.equipped(s)),
      replaced: (it) => g.inventory.equipped(g.inventory.targetSlot(it) ?? 'weapon'),
      baseline: (wave) => lootLevel(g.cfg.tier, wave),
    };
  }

  private lootHost(): LootHost {
    const g = this;
    return {
      get scene() { return g.scene; }, // prettier-ignore
      get loot() { return g.loot; }, // prettier-ignore
      get fx() { return g.fx; }, // prettier-ignore
      blocked: (a, b) => !this.los(a, b),
      panFor: (p) => this.panFor(p),
    };
  }

  /** A walkable landing point near `at` (Havok ray down; never on top of tall geometry). */
  protected groundPoint(at: Vector3): Vector3 {
    return this.pickups.groundPoint(at);
  }

  /** Pick up a pickup: into the run cargo (unsecured), or refuse when the hold is full. */
  collectPickup(p: Pickup): boolean {
    if (!this.loot.landed(p) || !this.player.alive) return false;
    if (!this.inventory.collect(p.item)) {
      this.pickups.refused(p);
      return false;
    }
    const v = this.verdicts.of(p.item, p.droppedWave);
    this.pickups.collected(p);
    if (v.newBest) uiEvents.emit('alert', { text: `NEW BEST · ${p.item.name.toUpperCase()}`, tone: 'orange' });
    this.verdicts.reset();
    if (this.lootTarget === p) this.lootTarget = null;
    this.inventoryVersion++;
    return true;
  }

  protected updateLootTarget(controls: boolean): void {
    const free = this.player.alive && !this.construction.active;
    this.lootTarget = free ? this.pickups.target(this.player.eye, (o) => this.player.forward(o)) : null;
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
    const abilities = (['ability', 'ability2', 'ultimate'] as const).filter((s) => this.abilities.def(s)).length;
    return { wave: this.waves.number, family: this.weapon.def.family, towers: ts.length, towerArchetypes: [...new Set(ts.map((t) => t.archetype))], abilities };
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
    // The mouse stays captured: 1/2/3 picks and drops straight back into the fight (Esc frees the cursor to click).
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
    if (this.checkpointOpen && this.cfg.run.atCheckpoint && (!this.node || this.node.mapDue)) {
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
    return this.screen === 'playing' && this.waves.phase !== 'combat' && !this.hunt;
  }

  /** Tower configuration panel (T): preparation / between waves; combat edits use the tactical hotkeys. */
  openTowerPanel(): void {
    if (!this.towerPanelAllowed) return;
    this.setBuildMode(false);
    this.tactical.deactivate();
    this.towerPanelFocus = this.towers.inspected?.id ?? null;
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

  /** G / early start. Every skipped second pays a few cores (fast play is rewarded); Rapid Deployment adds more. */
  startWave(): void {
    if (this.waves.phase !== 'prep') return;
    const remaining = Math.max(0, this.waves.timer);
    this.waves.startNow();
    const bonus = earlyCallBonus(remaining);
    if (bonus > 0) {
      this.grantCores(bonus);
      uiEvents.emit('alert', { text: `EARLY CALL · +${bonus} CORES`, tone: 'blue' });
    }
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
    if (this.waves.phase === 'combat' && !this.tactical.active) return `Activate tactical mode (${keyLabel(this.settings.keys.tactical)}) to modify towers during a wave`;
    return null;
  }

  protected towerFail(text: string): { ok: false; reason: string } {
    return this.towers.fail(text);
  }

  /** Upgrade a tower's level or swap a part (rules in towers/refit; the co-op replica sends a request instead). */
  modifyTower(t: Turret, what: 'level' | TowerSlot, id?: string): TowerEdit {
    return this.towers.refitLocal(t, what, id);
  }

  /** Choose the configuration for towers built from now on (no cost). Incompatible dependants reset to defaults. */
  setBuildConfig(slot: TowerSlot, id: string): { ok: true } | { ok: false; reason: string } {
    return this.towers.setBuildConfig(slot, id);
  }

  /** Hold-X recycle of the inspected tower (the co-op replica sends a request instead). */
  protected recycleTower(t: Turret): void {
    this.towers.recycleLocal(t);
  }

  /** F repair of the inspected tower on mazing arenas (the co-op replica sends a request instead). */
  protected repairTower(t: Turret): void {
    this.towers.repairLocal(t);
  }

  private towerHost(): TowerHost {
    const g = this;
    return {
      get scene() { return g.scene; }, // prettier-ignore
      get player() { return g.player; }, // prettier-ignore
      get input() { return g.input; }, // prettier-ignore
      get construction() { return g.construction; }, // prettier-ignore
      get turrets() { return g.turrets; }, // prettier-ignore
      get wallet() { return g.wallet; }, // prettier-ignore
      get fx() { return g.fx; }, // prettier-ignore
      get stats() { return g.stats; }, // prettier-ignore
      get turretCtx() { return g.turretCtx; }, // prettier-ignore
      get towerTech() { return g.towerTech; }, // prettier-ignore
      get wear() { return g.wear; }, // prettier-ignore
      get mazing() { return !!g.layout.mazing; }, // prettier-ignore
      get buildConfig() { return g.buildConfig; }, // prettier-ignore
      set buildConfig(c) { g.buildConfig = c; }, // prettier-ignore
      editBlock: () => this.towerEditReason(),
      note: (text, t) => { this.towerNote = { text, t }; }, // prettier-ignore
      modify: (t, what, id) => this.modifyTower(t, what, id),
      recycle: (t) => this.recycleTower(t),
      repair: (t) => this.repairTower(t),
      bumpStats: () => this.bumpStats(),
      towerHpScale: () => this.towerHpScale(),
      changed: () => { this.inventoryVersion++; }, // prettier-ignore
    };
  }

  /** Floating damage number with a per-frame budget (kills always show). */
  showNumber(p: Vector3, amount: number, kind: HitKind, player: boolean, allowed: boolean, target?: number, el?: string, aff?: -1 | 0 | 1): void {
    if (!allowed && kind !== 'kill') return;
    if (player || kind === 'kill' || Vector3.DistanceSquared(p, this.player.position) < 25 * 25) {
      uiEvents.emit('damageNumber', { x: p.x, y: p.y, z: p.z, amount: Math.round(amount), kind, player, target, el, aff });
    }
  }

  /** Inspect card data for HUD / panel. */
  towerInfo(t: Turret) {
    return this.towers.info(t);
  }

  /** Enter the arena: fresh run state, preparation phase of wave 1. */
  start(): void {
    this.newRun();
    this.setScreen(this.input.captured || this.input.isLockedNow() ? 'playing' : 'paused');
    this.canvas.focus();
  }

  async resume(): Promise<void> {
    sfx.init();
    // A key that dismissed a panel belongs to the panel, even if the scene ticks immediately.
    this.input.clear();
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
    if (this.node) {
      this.node.mapDue = false;
      this.cfg.hooks.mapOpened?.();
    }
    this.setScreen(this.node ? 'runmap' : 'checkpoint');
    this.publishHud(true);
    this.input.releaseLock();
  }

  /** Continue survival from the checkpoint (return option stays available during prep). */
  async continueRun(): Promise<void> {
    if (this.screen !== 'checkpoint' && this.screen !== 'runmap' && this.screen !== 'station') return;
    const was = this.screen;
    sfx.play('ui');
    if (this.node) this.node.panelStation = null;
    await this.resume();
    if (this.screen === was) this.setScreen('paused');
  }

  get canReturnHome(): boolean {
    if (this.node) return this.node.complete && !this.node.guardiansActive && this.cfg.run.atCheckpoint && this.waves.phase === 'prep' && this.screen !== 'defeat';
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
    this.node?.dispose();
    sfx.setTactical(false);
    sfx.beamLoop(false);
    this.scene.dispose();
  }

  protected newRun(): void {
    this.weaponSlots.reset();
    this.abilities.reset();
    this.deployables.reset();
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
    this.towers.reset();
    this.construction.setActive(false);
    this.weapon.setHolstered(false);
    this.waves.reset();
    // Pinnacle run: the summoned boss commands wave 1 (seed-decided Colossus or Overseer).
    if (this.cfg.pinnacle) {
      this.planner.force(1, { boss: pinnacleBoss(this.cfg.run.id) });
      this.waves.recompose();
    }
    this.node?.begin();
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
      if (input.pressed('Digit1')) {
        this.setBuildMode(false);
        this.swapWeapon('weapon');
      }
      if (input.pressed('KeyZ') || (input.wheel !== 0 && !this.construction.active)) this.swapWeapon();
      if (this.construction.active && input.mousePressed(2)) this.setBuildMode(false);
      else if (input.mousePressed(2)) this.useAbility('ability');
      // F repairs the tower under the crosshair on mazing arenas; otherwise it fires ability II.
      if (input.pressed('KeyF') && !(this.towers.inspected && this.layout.mazing)) this.useAbility('ability2');
      if (input.pressed('KeyT') && this.waves.phase === 'combat') this.useAbility('ultimate');
      if (input.pressed('KeyH') && this.canReturnHome) {
        this.checkpointOpen = true;
        this.openCheckpoint();
      }
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
      this.towers.keys(input);
    }

    this.tactical.update(dt);
    if (!this.tactical.active && this.wasTactical) {
      this.wasTactical = false;
      sfx.play('tacticalOff');
      sfx.setTactical(false);
    }
    if (this.hitstopT > 0) this.hitstopT = Math.max(0, this.hitstopT - dt);
    const stop = this.hitstopT > 0 ? this.hitstopScale : 1;
    const hdt = this.screen === 'defeat' ? dt * 0.15 : dt * this.tactical.hostileScale * stop;

    if (playing) {
      this.runTime += dt;
      this.cfg.run.tick(dt);
    }
    this.player.update(dt, input, this.stats.moveSpeedMult * (this.hazards?.playerSpeed ?? 1), controls);
    this.hunt?.update(dt, this.enemies.nav, this.player.alive ? [this.player.position] : []);
    if (this.player.dashedThisFrame) {
      this.player.dashedThisFrame = false;
      this.director.bus.emit({ type: 'dash', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: 'dash' }, value: 1 });
    }
    this.movement.update();

    // ---- building
    if (this.construction.active) {
      this.construction.update(this.player, this.wallet.cores, this.turrets.turrets, this.stats);
      if (controls && input.mousePressed(0)) this.tryPlace();
    }

    // ---- shooting
    const trigger = controls && input.mouse(0) && !this.construction.active;
    this.weaponSlots.update(dt);
    this.abilities.update(dt);
    this.deployables.update(dt);
    this.weapon.update(dt, trigger, this.stats, this.shoot, this.weaponFx);
    if (this.weapon.overheated && !this.wasOverheated) this.director.bus.emit({ type: 'overheat', chain: this.director.bus.newChain(), source: { kind: 'weapon', id: 'heat' }, value: 1 });
    this.wasOverheated = this.weapon.overheated;
    this.wfx.update(dt, this.player.camera.position);

    // ---- inspect / recycle, loot
    this.updateInspect(dt, controls);
    this.updateLootTarget(controls);
    this.loot.update(dt);
    this.node?.update(dt, hdt, controls, controls && !this.lootTarget && input.pressed('KeyE'));

    // ---- simulation (hostile time)
    if (this.screen === 'playing') this.waves.update(dt, hdt);
    this.hostileT += hdt;
    this.enemies.update(hdt, this.enemyCtx, dt);
    // The holo decoy may have borrowed the enemies' target for a frame.
    if (this.enemyCtx.player !== this.player && this.deployables.isDecoy(this.enemyCtx.player)) this.enemyCtx.player = this.player;
    this.ordnance.update(hdt, this.ordnanceCtx, this.hostileT);
    this.tele.update(hdt);
    this.dynamics.update(dt, hdt);
    this.survival.update(dt, hdt);
    this.watchBoss();
    if (this.playerWasAlive && !this.player.alive) {
      this.cfg.run.survival.deaths++;
      // Survival: one life.
      if (this.hunt) this.onDefeat();
    }
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
    this.mood.update(dt, this.moodInput());
    this.motionFx();
    this.post.update(dt, k, this.hurtFx, flash);

    this.wear.tick(this.waves.phase, this.towerHpScale());
    this.hazards?.update(dt, hdt, this.hostileT);
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

  /** Sense of speed: lens punch when a dash starts, a touch of aberration + vignette while momentum is carried. */
  private wasDashing = false;
  protected motionFx(): void {
    const p = this.player;
    if (p.dashing && !this.wasDashing) this.post.kick(0.22);
    this.wasDashing = p.dashing;
    const over = (p.speed - MOVE.sprintSpeed) / (MOVE.dashCarrySpeed - MOVE.sprintSpeed);
    this.post.speed = p.alive ? Math.max(0, Math.min(1, over)) : 0;
  }

  protected updateArenaVisuals(dt: number, hostileDt: number): void {
    const phase = this.waves.phase;
    const warning = this.screen === 'defeat' || phase === 'cleared' ? 0 : phase === 'combat' ? 1 : 0.5;
    this.arenaVisuals.update(dt, hostileDt, warning, this.settings.reduceMotion);
  }

  gateActivity(gate: GateId): number {
    return this.arenaVisuals.gateActivity(gate);
  }

  /** Situation inputs for the mood director (shared by the replica, which mirrors the same state). */
  protected moodInput(): { tier: number; boss: boolean; event: 'swarm' | 'eliteAssault' | 'instability' | 'hvt' | null; reactorFrac: number; baseFog: [number, number, number] } {
    return {
      baseFog: biomeOf(this.layout).fog,
      tier: this.cfg.tier.id,
      boss: this.enemies.active.some((e) => e.alive && e.def.role === 'boss'),
      event: this.survival.event,
      reactorFrac: this.reactorHp / ECONOMY.reactorMaxHp,
    };
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
    if (on && this.hunt) {
      uiEvents.emit('alert', { text: 'SURVIVAL · NO TOWERS', tone: 'orange' });
      sfx.play('buildDeny');
      return;
    }
    if (on && this.node?.noTowers) {
      uiEvents.emit('alert', { text: 'NULL FIELD · NO TOWER CONSTRUCTION ON THIS NODE', tone: 'orange' });
      sfx.play('buildDeny');
      return;
    }
    this.construction.setActive(on);
    this.weapon.setHolstered(on);
    sfx.play('ui');
  }

  protected tryPlace(): void {
    const built = this.towers.placeLocal();
    if (!built) return;
    this.turretsBuilt++;
    // Rapid multi-placement while tactical mode is active.
    if (!this.tactical.active) this.setBuildMode(false);
  }

  protected updateInspect(dt: number, controls: boolean): void {
    this.towers.inspect(dt, controls);
  }

  // ---------------------------------------------------------------- combat

  /** Player hitscan + damage (PlayerCombat); the co-op replica overrides it with a claim builder. */
  protected shoot = (r: ShotRequest): ShotOutcome => this.combat.shoot(r);
  protected get weaponFx(): WeaponFxHooks {
    return this.combat.fxHooks;
  }
  /** Arc Conductor procs this run (automation/tests). */
  get arcs(): number {
    return this.combat.arcs;
  }

  /** Legacy damage entry (player weapon, Sentinel-style tower hits, debug): see PlayerCombat.damage. */
  damageEnemy(source: 'player' | 'turret', e: Enemy, base: number, point: Vector3, weakpoint: boolean, turret?: Turret, family?: WeaponFamily | 'arc', from?: Vector3): void {
    this.combat.damage(source, e, base, point, weakpoint, turret, family, from);
  }

  /** Dilate hostile time for `seconds` (overlapping stops keep the longest / strongest). */
  hitstop(seconds: number, scale: number): void {
    if (!this.hitstopEnabled || !(seconds > 0)) return;
    this.hitstopScale = this.hitstopT > 0 ? Math.min(this.hitstopScale, scale) : scale;
    this.hitstopT = Math.max(this.hitstopT, seconds);
  }

  /** Pulse Capacitor splash (the co-op server applies validated claims through it). */
  protected pulseSplash(point: Vector3, dmg: number, hit: Enemy | null): void {
    this.combat.pulseSplash(point, dmg, hit);
  }

  /** PlayerCombat's view of the arena (lazy: read when a shot lands, never during construction). */
  private combatHost(): CombatHost {
    const g = this;
    return {
      get scene() { return g.scene; }, // prettier-ignore
      get enemies() { return g.enemies; }, // prettier-ignore
      get director() { return g.director; }, // prettier-ignore
      get fx() { return g.fx; }, // prettier-ignore
      get wfx() { return g.wfx; }, // prettier-ignore
      get weapon() { return g.weapon; }, // prettier-ignore
      get player() { return g.player; }, // prettier-ignore
      get stats() { return g.stats; }, // prettier-ignore
      get runTime() { return g.runTime; }, // prettier-ignore
      signature: () => this.weaponSignature(),
      heat: () => this.weaponHeat(),
      droneSpeed: () => this.droneSpeed(),
      uniques: () => this.equippedUniques(),
      chargeUlt: (f) => {
        this.abilities.ult = Math.min(1, this.abilities.ult + f);
      },
      hitstop: (s, k) => this.hitstop(s, k),
      masteryKill: (e) => this.gainMastery(this.weapon.def.family, killMastery(e.def.role, e.elite)),
      damageEnemy: (...a) => this.damageEnemy(...a),
    };
  }

  /** Weapon-family mastery XP into the run's unsecured pool (the co-op server routes it to the shooter). */
  protected gainMastery(family: WeaponFamily, xp: number): void {
    if (this.cfg.run.collect({ mastery: { [family]: xp } })) uiEvents.emit('mastery', { family, xp });
  }

  /** Family of the weapon in hand (mastery modifiers follow it). */
  protected handFamily(): WeaponFamily | null {
    return baseDef(this.inventory.equipped(this.weaponSlots.active)?.defId ?? '')?.weapon?.family ?? null;
  }

  /** Fire an ability slot (RMB ability I, F ability II, T ultimate in combat). */
  useAbility(slot: AbilitySlot): boolean {
    return this.abilities.use(slot);
  }

  /** Damage dealt by the drone charges its ultimate (the co-op server routes it to the shooter's avatar). */
  chargeUltimate(dealt: number): void {
    this.abilities.charge(dealt);
  }

  private abilityHost(): AbilityHost {
    const g = this;
    return {
      get scene() { return g.scene; }, // prettier-ignore
      get player() { return g.player; }, // prettier-ignore
      get director() { return g.director; }, // prettier-ignore
      get enemies() { return g.enemies; }, // prettier-ignore
      get fx() { return g.fx; }, // prettier-ignore
      get wfx() { return g.wfx; }, // prettier-ignore
      get weapon() { return g.weapon; }, // prettier-ignore
      get inventory() { return g.inventory; }, // prettier-ignore
      get stats() { return g.stats; }, // prettier-ignore
      get deployables() { return g.deployables; }, // prettier-ignore
      canAct: () => this.screen === 'playing' && !this.construction.active && this.player.alive,
    };
  }

  protected deployHost(): DeployHost {
    const g = this;
    return {
      get scene() { return g.scene; }, // prettier-ignore
      get kit() { return g.kit; }, // prettier-ignore
      get pal() { return g.pal; }, // prettier-ignore
      get fx() { return g.fx; }, // prettier-ignore
      get turrets() { return g.turrets; }, // prettier-ignore
      get turretCtx() { return g.turretCtx; }, // prettier-ignore
      probe: (a, b) => this.player.probe(a, b)?.point ?? null,
    };
  }

  private movementHost(): MovementHost {
    const g = this;
    return {
      get scene() { return g.scene; }, // prettier-ignore
      get player() { return g.player; }, // prettier-ignore
      get director() { return g.director; }, // prettier-ignore
      get fx() { return g.fx; }, // prettier-ignore
      get input() { return g.input; }, // prettier-ignore
      get stats() { return g.stats; }, // prettier-ignore
      get attackerScale() { return g.attackerScale; }, // prettier-ignore
      canAct: () => this.screen === 'playing' && this.input.captured && !this.construction.active && this.player.alive,
      grappleKeyFree: () => !this.towers.inspected,
      pound: (at, fall) => this.groundPound(at, fall),
    };
  }

  /** A ground pound landed (co-op clients forward it to the server instead). */
  groundPound(at: Vector3, fall: number): void {
    this.movement.blast(at, fall);
  }

  /** HUD row for the holstered weapon. */
  protected holsterHud(): { name: string; heat: number; overheated: boolean; secondary: boolean; element: string; aff: -1 | 0 | 1 } | null {
    const ws = this.weaponSlots;
    const item = ws.hasSecondary ? ws.item(ws.inactive) : null;
    if (!item) return null;
    const p = ws.parkedHeat;
    const def = weaponDefFor(item);
    const element = def?.element ?? 'kinetic';
    return { name: def?.name ?? item.name, heat: p.heat / 100, overheated: p.overheated, secondary: ws.inactive === 'weapon2', element, aff: sectorAffinity(element, this.director.faction) };
  }

  /** Swap to the other carried weapon (or to `slot`). Out of build mode only. */
  swapWeapon(slot?: WeaponSlot): boolean {
    if (this.construction.active) return false;
    return this.weaponSlots.swap(slot);
  }

  private weaponSlotsHost(): WeaponSlotsHost {
    const g = this;
    return {
      get inventory() { return g.inventory; }, // prettier-ignore
      get weapon() { return g.weapon; }, // prettier-ignore
      get stats() { return g.stats; }, // prettier-ignore
      rebuildStats: () => this.rebuildStats(),
      changed: () => {
        this.wfx.setColor(this.weapon.rig.energyBase);
        this.inventoryVersion++;
      },
    };
  }

  /** Unique gear effects of the drone firing right now (co-op server: the shooter's avatar). */
  protected gearEffects: ReadonlySet<string> = new Set();
  protected equippedUniques(): ReadonlySet<string> {
    return this.gearEffects;
  }

  /** Signature of the weapon firing right now (co-op server: the shooter's). */
  protected weaponSignature(): string | null {
    return this.weaponSlots.item()?.signature ?? null;
  }
  protected weaponHeat(): number {
    return this.weapon.heat / 100;
  }
  /** Current drone speed (m/s); dashes count as fast. The co-op server reports the shooter's. */
  protected droneSpeed(): number {
    return this.player.dashing ? 40 : this.player.speed;
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
    const shards = boss ? RUN_INCOME.bossShards(this.cfg.tier.id) : e.elite && this.shardRand() < RUN_INCOME.eliteShardChance(e.mods.length) ? 1 : 0;
    if (this.cfg.run.collect({ credits, components, shards })) {
      if (credits) uiEvents.emit('creditsGained', credits);
      if (components) uiEvents.emit('componentsGained', components);
      if (shards) uiEvents.emit('alert', { text: `+${shards} RIFT SHARD${shards === 1 ? '' : 'S'}`, tone: 'blue' });
    }
    this.cfg.run.addKill();
    const at = e.center().clone();
    if (boss) at.y = Math.min(at.y, 6);
    if (e.kind in DROP_SOURCES && e.def.role !== 'hvt' && e.tag !== 'summon') this.dropLoot(e.kind as DropSourceId, at);
    if (e.elite) this.dropFrom(this.survival.eliteSource(e), at);
    if (boss && this.cfg.pinnacle) this.dropLoot('pinnacle', at);
    // Pinnacle keys: elites on RL 8+ (own stream, like shards, so loot rolls never shift).
    if (e.elite && this.cfg.tier.id >= PINNACLE.minRl && this.shardRand() < PINNACLE.keyChance(e.mods.length) && this.cfg.run.collect({ keys: 1 })) uiEvents.emit('alert', { text: 'PINNACLE KEY · bank it to summon a pinnacle boss', tone: 'orange' });
    this.enemies.kill(e, this.enemyFx, this.enemyCtx);
  }

  // ---------------------------------------------------------------- M6: hostile mechanics

  /** Every hostile hit on the drone goes through here. */
  hurtPlayer(amount: number, from: Vector3, target: Player = this.player): void {
    if (this.deployables.isDecoy(target)) {
      this.deployables.hurtDecoy(amount);
      return;
    }
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
    const plan = planBlast(center, radius, this.hunt ? { ...o, reactor: 0 } : o, {
      drones: drones.map((d) => ({ alive: d.alive, pos: d.position })),
      clearShot: (i) => this.los(lift, drones[i].eye),
      towers: this.turrets.turrets,
      reactor: this.layout.reactor,
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
    this.enemies.prebuild(['walker', 'rusher', 'bulwark', 'enforcer', 'artillery', 'engineer', 'courier', 'colossus', 'overseer', 'pylon', 'jammer', 'sapper', 'skimmer', 'marksman', 'burrower', 'crawler']);
    const jobs: Promise<unknown>[] = [this.tele.warm(), this.ordnance.warm(), this.kit.warmAll()];
    // The camera-mounted weapon has its own lighting/material variants. Warm those too,
    // so the first revealed arena frame does not show an empty hand.
    for (const mesh of this.weapon.rig.meshes) {
      if (mesh.material) jobs.push(mesh.material.forceCompilationAsync(mesh).catch(() => {}));
    }
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
        const pts = this.layout.routes[g].points;
        const p = pts[Math.min(2, pts.length - 1)];
        const d = (p.x - at.x) ** 2 + (p.z - at.z) ** 2;
        if (d < best) {
          best = d;
          gate = g;
        }
      }
    }
    const e = this.enemies.spawn(kind, gate, this.layout, w.hpMult, w.damageMult, w.speedMult, { mods: o.mods, tag: 'summon', ctx: this.enemyCtx });
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
    e.navV = -1; // procedural arenas: re-plan from the summon point
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
    this.fx.explode(p, { scale: big, debris: i.kind === 'missile' ? 2 : 6, color: i.kind === 'bomb' ? new Color3(1.6, 0.6, 3.2) : undefined, style: i.kind === 'bomb' ? 'plasma' : undefined });
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

  /** Towers recompose their numbers (arena state changed their fire-rate boost); the tower set may have changed. */
  bumpStats(): void {
    this.statsVersion++;
    this.turretCtx.statsVersion = this.statsVersion;
    this.enemies.nav?.sync();
  }

  /** Tower max-HP scale: follows the hostile damage multiplier of the current wave (sqrt: towers stay relevant). */
  towerHpScale(): number {
    const m = this.waves?.wave?.damageMult ?? 1;
    return Math.sqrt(Math.max(1, m));
  }

  /** Procedural arenas: nav-grid pathing for enemies and breachable towers. */
  protected setupMazing(): TowerWear {
    // Getters: the tower manager and effects are created after the enemy manager.
    const game = this;
    const wear = new TowerWear({
      get towers() {
        return game.turrets.turrets;
      },
      get fx() {
        return game.fx;
      },
      spend: (n) => this.wallet.spend(n),
      alert: (text, tone) => uiEvents.emit('alert', { text, tone }),
      changed: () => this.bumpStats(),
      editReason: () => this.towerEditReason(),
    });
    // Biome hazards (frost fields / slag pools) and Molten slag trails.
    this.hazards = new Hazards(
      {
        scene: this.scene,
        enemies: () => game.enemies.active,
        get player() {
          return game.player;
        },
        hurtPlayer: (a, from) => game.hurtPlayer(a, new Vector3(from.x, from.y, from.z)),
        inflict: (e, p) => game.director.inflict(e, p, { kind: 'effect', id: 'hazard' }, game.director.bus.newChain(), e.center(new Vector3())),
      },
      this.layout.hazards ?? [],
    );
    // Survival hunts on a navigation field on every arena (the classic one too); defense only on mazing arenas.
    if (this.layout.mazing || this.hunt) {
      if (this.hunt) this.enemies.huntRange = HUNT.chaseRange;
      this.enemies.nav = new EnemyNavigator(this.hunt?.layout ?? this.layout, {
        // Towers on decks, bridges and container tops stand above the ground lanes: they never block them.
        towers: () => this.turrets.turrets.map((t) => ({ id: t.id, x: t.pos.x, z: t.pos.z, radius: t.radius, blocking: t.blocking && t.pos.y < 1 })),
        breach: (id, dmg, by) => this.wear.breach(id, dmg, by),
      });
    }
    return wear;
  }

  towerFireBoost(t: Turret): number {
    return this.survival ? this.survival.towerBoost(t) : 1;
  }

  /** Open a sealed gate (arena evolution): lane lights, rift light and embers. */
  openGate(gate: GateId): void {
    this.arenaVisuals.setSealed(gate, false);
    this.atmosphere.mist.setSealed(gate, false);
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
    sapper: 'NEW THREAT · SAPPER · it runs for a tower and blows it up: kill it before it plants the charge',
    skimmer: 'NEW THREAT · SKIMMER SWARM · tiny fast flyers that peck at the drone in passes: sweep them',
    marksman: 'NEW THREAT · MARKSMAN · a red laser marks you before the shot: break line of sight',
    burrower: 'NEW THREAT · BURROWER · tunnels under towers and is untouchable while buried: hit it when it surfaces',
    regenerating: 'MUTATION · REGENERATING · heals when left alone: keep the pressure on or burn it',
    splitting: 'MUTATION · SPLITTING · splits into two lesser copies when destroyed',
    shielded: 'MUTATION · SHIELDED · recharging barrier: energy damage breaks it fast',
    blinking: 'MUTATION · BLINKING · phases forward along its route: shock or freeze pins it',
    frostbound: 'MUTATION · FROSTBOUND · immune to chill; its frost nova shorts nearby towers',
    molten: 'MUTATION · MOLTEN · immune to burning; leaves slag pools in its wake',
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
    sv.playerDamage = this.director.dealt.player + (this.node?.dealtBefore.player ?? 0);
    sv.towerDamage = this.director.dealt.tower + (this.node?.dealtBefore.tower ?? 0);
  }

  /** Automation hook: same path as enemy attacks. */
  debugDamageReactor(amount: number): void {
    this.damageReactor(amount, new Vector3(0, 2, 0));
  }

  protected damageReactor(amount: number, at: Vector3): void {
    // Survival: attacks on the "reactor" were aimed at the hunted drone.
    if (this.hunt) {
      const t = this.enemyCtx.player;
      if (amount > 0) this.hurtPlayer(Hunt.hitFor(amount, t.maxHp), at, t);
      return;
    }
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
    const c = this.hunt ? this.player.position.clone() : new Vector3(0, 4, 0);
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
      if (p.damage > 0 && this.deployables.decoyHitBy(p.pos, next)) {
        this.deployables.hurtDecoy(p.damage);
        this.fx.burst('zap', next, 6);
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
      (0.76 + danger * 1.74 + h * 1.5) * flicker,
      (1.96 - danger * 1.36 + h * 0.4) * flicker,
      (1.57 - danger * 1.47) * flicker,
    );
    this.reactorLight.diffuse.set(0.50 + danger * 0.50, 0.93 - danger * 0.53, 0.78 - danger * 0.58);
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
    const t = this.towers.inspected;
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
      survival: !!this.hunt,
    }, this.settings.keys);
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
        ...this.verdicts.of(lt.item, lt.droppedWave),
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
      weaponElement: this.weapon.def.element,
      weaponAff: sectorAffinity(this.weapon.def.element, this.director.faction),
      holster: this.holsterHud(),
      abilities: this.abilities.hud(),
      moves: this.movement.hud(),
      heat: this.weapon.heat / 100,
      overheated: this.weapon.overheated,
      charge: this.weapon.def.mechanism === 'charge' || this.weapon.def.mechanism === 'cycle' || this.weapon.def.mechanism === 'salvo' ? this.weapon.charge : 0,
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
      inspect: t ? { name: t.name, kills: t.kills, damage: Math.round(t.damageDealt), refund: t.recycleValue, recycle: this.towers.recycleT, card: this.towerInfo(t), edit: this.towerEditReason(), hp: this.layout.mazing ? { hp: Math.round(t.hp), max: t.maxHp, wrecked: t.wrecked, repair: t.repairCost } : null } : null,
      hint,
      spread: 6 + this.weapon.spread * 900,
      perf: this.perfOn
        ? this.perfHud()
        : null,
      m6: this.survival.hud(),
      node: this.node?.hud() ?? null,
      mode: this.hunt ? 'survival' : 'defense',
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
