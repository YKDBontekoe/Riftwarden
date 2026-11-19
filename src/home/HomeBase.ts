import { placeScan } from '../visuals/scannedProps';
import { loftData } from '../visuals/sculpt';
import {
  Color3,
  Color4,
  DirectionalLight,
  type Engine,
  HavokPlugin,
  HemisphericLight,
  PBRMaterial,
  type PhysicsEngineV2,
  PhysicsRaycastResult,
  PointLight,
  Scene,
  SceneInstrumentation,
  ShadowGenerator,
  SpotLight,
  Texture,
  Vector3,
} from '@babylonjs/core';
import { type Emitter, sfx } from '../audio/Sfx';
import type { Input } from '../core/Input';
import { keyLabel, type Settings } from '../core/settings';
import { HQ_MOVE, Player } from '../player/Player';
import { SLOT_IDS } from '../progression/items';
import { rarity } from '../loot/rarity';
import type { Profile } from '../progression/Profile';
import { equippedItem, type SaveData } from '../progression/save';
import { getTier, THREAT_TIERS } from '../progression/tiers';
import { hudStore, type Screen, type TerminalId, uiEvents } from '../ui/store';
import { calibrationRing, type EconCtx, equipmentExchange, fabricator, moduleBroker, reclamation } from './economyProps';
import { fabricationLevel } from '../economy/transactions';
import { captureEnvironment } from '../visuals/envCapture';
import { Kit } from '../visuals/kit';
import { createPalette, unlit } from '../visuals/materials';
import { StationFocus } from './StationFocus';
import { AmbientDrones } from './AmbientDrones';
import { buildNav } from './ambientNav';
import { buildHqVista, type HqVista } from './hqVista';
import { PostFx } from '../visuals/postfx';
import hqStormfrontUrl from '../assets/hq-stormfront.webp';
import { ENV_QUERY } from '../world/physicsGroups';
import { HqBuilder, type HqMaterials } from './HqBuilder';
import { ExpansionLayer } from './build/ExpansionLayer';
import { BuildMode } from './build/BuildMode';
import { buildWardenDrone } from '../visuals/droneModel';
import type { Palette } from '../visuals/materials';
import { type TutorialHost, TutorialDirector } from '../core/TutorialDirector';
import { LIMITS } from './build/catalog';
import { pickInteractable } from './interaction';
import { furnitureOccupied } from './build/model';
import { ATRIUM_BED, SURVEY_DESK, areaAt, HQ_PORTALS, HQ_ROOMS, HQ_SPAWN, HQ_STATIONS, type Station } from './layout';
import {
  type Animator,
  commandTable,
  consoleDesk,
  drawScreenFrame,
  droneCradle,
  launchRing,
  makeScreen,
  makeSign,
  stationWayfinding,
  MONO_FONT,
  planeBuilder,
  SCREEN_FONT,
  type ScreenTex,
  screenLine,
  storageRacks,
  workshop,
} from './props';

export interface HomeHooks {
  deploy(): void;
  /** M7: the HQ shell must be rebuilt (station moved, gateway opened/closed). */
  rebuild?(): void;
  /** M7: onboarding host. */
  tutorial?: TutorialHost;
  /** M7 co-op visit: the host's headquarters layout replaces this player's own (read-only). */
  hostBase?: () => SaveData['base'] | null;
}

/** One interactive station in the HQ (data + its live screen). */
interface StationRig {
  station: Station;
  screen: ScreenTex | null;
}

const TMP = new Vector3();
const PULSE_TIME = 1.6;

/**
 * The headquarters: a calm, explorable first-person space. Reuses the arena's
 * Player (Havok character controller), palette, kit and post-processing; adds
 * station interaction. Built fresh on every visit from static layout + the save's
 * placeables, and disposed when deploying.
 */
export class HomeBase {
  readonly scene: Scene;
  readonly player: Player;
  screen: Screen = 'loading';
  private post: PostFx;
  private kit: Kit;
  private rigs: StationRig[] = [];
  private animators: Animator[] = [];
  private target: StationRig | null = null;
  private time = 0;
  private hudT = 0;
  private physResult = new PhysicsRaycastResult();
  private perfOn = false;
  private instrumentation: SceneInstrumentation | null = null;
  private fpsSmooth = 60;
  private unsubProfile: () => void;
  private disposed = false;
  private wallScreens: { left: ScreenTex; right: ScreenTex } | null = null;
  /** M7 construction. */
  layer!: ExpansionLayer;
  build!: BuildMode;
  private layoutSig = '';
  litMaterials: PBRMaterial[] = [];
  /** Visiting someone else's HQ: no construction, no persistent services. */
  readOnly = false;
  private tut: TutorialDirector | null = null;
  private emitters: Emitter[] = [];
  private pal!: Palette;
  private tutDist = 0;
  private tutPos: [number, number] = [0, 0];
  private openedTerminals = new Set<string>();
  /** Lights whose intensity breathes slightly (subtle "alive" feel). */
  private pulseLights: { light: PointLight; base: number; phase: number }[] = [];
  /** Transaction feedback per station (1 -> 0 over PULSE_TIME). */
  private pulses = new Map<string, number>();
  private focus!: StationFocus;
  private ambient!: AmbientDrones;
  private vista!: HqVista;
  private reduceMotion = false;
  private unsubEcon: () => void = () => {};
  private displays: {
    exchange?: ReturnType<typeof equipmentExchange>;
    broker?: ReturnType<typeof moduleBroker>;
    reclaim?: ReturnType<typeof reclamation>;
  } = {};

  constructor(
    engine: Engine,
    private canvas: HTMLCanvasElement,
    havok: unknown,
    public settings: Settings,
    readonly input: Input,
    private profile: Profile,
    private hooks: HomeHooks,
  ) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.02, 0.04, 0.06, 1);
    scene.ambientColor = new Color3(0.03, 0.04, 0.05);
    scene.skipPointerMovePicking = true;
    scene.enablePhysics(new Vector3(0, -26, 0), new HavokPlugin(true, havok));
    const high = settings.quality === 'high';

    const pal = createPalette(scene, high, true);
    this.pal = pal;
    this.kit = new Kit(scene);

    // HQ material set: brighter, cleaner interior variants of the shared palette.
    // Interior composites: panel detail from the shared wall set, but dielectric and
    // fairly rough so they read as light surfaces without a bright sky to reflect.
    const composite = (name: string, albedo: [number, number, number], rough: number, coat: number) => {
      const m = new PBRMaterial(name, scene);
      // Keep the broad ceramic faces clean. The shared normal carries the panel joints.
      m.bumpTexture = pal.panel.bumpTexture;
      m.albedoColor = new Color3(...albedo);
      m.metallic = 0;
      m.roughness = rough;
      m.usePhysicalLightFalloff = false;
      m.maxSimultaneousLights = 8;
      if (coat > 0) {
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = coat;
        m.clearCoat.roughness = 0.1;
      }
      return m;
    };
    const floor = pal.floor;
    const wall = composite('hqWall', [0.76, 0.75, 0.67], 0.63, 0.12);
    const ceiling = composite('hqCeiling', [0.35, 0.37, 0.32], 0.85, 0);
    ceiling.albedoTexture = null; // plain acoustic panels: keeps the vents for walls/floor
    ceiling.bumpTexture = null;
    const glass = new PBRMaterial('hqGlass', scene);
    glass.albedoColor = new Color3(0.02, 0.06, 0.08);
    glass.metallic = 0;
    glass.roughness = 0.03;
    glass.alpha = 0.07;
    glass.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    glass.useRadianceOverAlpha = true;
    glass.useSpecularOverAlpha = true;
    glass.usePhysicalLightFalloff = false;
    glass.backFaceCulling = false;
    // Fresh materials, never clone(): cloning copies DynamicTextures, which come out blank
    // and never report ready (that would stall scene readiness on every transition).
    const plain = (name: string, albedo: [number, number, number], metallic: number, rough: number) => {
      const m = new PBRMaterial(name, scene);
      m.albedoColor = new Color3(...albedo);
      m.metallic = metallic;
      m.roughness = rough;
      m.usePhysicalLightFalloff = false;
      m.maxSimultaneousLights = 8;
      return m;
    };
    const terrazzo = plain('castTerrazzo', [0.59, 0.59, 0.52], 0.04, 0.65);
    const aggregate = new Texture(new URL('../assets/cast-aggregate.webp', import.meta.url).href, scene);
    aggregate.anisotropicFilteringLevel = 8;
    terrazzo.albedoTexture = aggregate;
    const plant = plain('hqPlant', [0.12, 0.42, 0.3], 0, 0.7);
    const bronze = plain('hqBrushedBronze', [0.55, 0.32, 0.17], 0.56, 0.46);
    const screenFrame = plain('hqScreenFrame', [0.03, 0.035, 0.04], 0.6, 0.35);
    for (const m of [floor, terrazzo, ceiling, wall, plant, bronze, screenFrame]) m.environmentIntensity = 1.2;
    const M: HqMaterials & { plant: PBRMaterial; screenFrame: PBRMaterial } = {
      floor, terrazzo,
      wall,
      white: pal.white,
      graphite: pal.graphite,
      metal: pal.metal,
      ceiling,
      bronze,
      glass,
      cyan: pal.cyanGlow,
      cyanDim: pal.cyanDim,
      teal: unlit(scene, 'hqTeal', [0.15, 1.5, 1.1]),
      amber: unlit(scene, 'hqAmber', [2.2, 1.0, 0.12]),
      amberDim: unlit(scene, 'hqAmberDim', [0.5, 0.22, 0.03]),
      lamp: unlit(scene, 'hqLamp', [2.15, 1.89, 1.51]),
      plant,
      screenFrame,
    };
    const lit = [ceiling, wall, plant, bronze, screenFrame, ...pal.lit];

    // ---- static shell + props
    const builder = new HqBuilder(scene, M);
    builder.buildShell();
    const ctx: EconCtx = {
      scene,
      kit: this.kit,
      M,
      collider: (x0, y0, z0, x1, y1, z1) => builder.collider(x0, y0, z0, x1, y1, z1),
      animators: this.animators,
      pulse: (id) => this.pulses.get(id) ?? 0,
    };
    this.readOnly = !!hooks.hostBase?.();
    const save = this.layoutSave();
    this.buildStations(ctx, save);
    builder.finish();
    // M7: player-built modules and every placed object (incremental, own colliders).
    this.layer = new ExpansionLayer(scene, this.kit, ctx, () => this.player?.position ?? Vector3.Zero(), high);
    this.layer.sync(save);
    this.layoutSig = layoutSignature(save);
    this.buildBackdrop();
    this.vista = buildHqVista(scene, this.pal);
    this.buildSignage(ctx);
    stationWayfinding(ctx);

    // ---- lighting: cool fill, sunlight through the window, cyan/teal accents, warm workshop
    const hemi = new HemisphericLight('hqFill', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.54;
    hemi.diffuse = new Color3(0.94, 0.95, 1);
    hemi.groundColor = new Color3(0.5, 0.53, 0.56);
    hemi.specular = Color3.Black();
    const moon = new DirectionalLight('hqMoon', new Vector3(-0.25, -0.55, 1).normalize(), scene);
    moon.position = new Vector3(8, 18, -40);
    moon.intensity = 1.08;
    moon.diffuse = new Color3(1.0, 0.83, 0.64);
    moon.specular = new Color3(1.0, 0.90, 0.74);
    const point = (name: string, pos: [number, number, number], color: [number, number, number], intensity: number, range: number, pulse = false) => {
      const l = new PointLight(name, new Vector3(...pos), scene);
      l.diffuse = new Color3(...color);
      l.specular = new Color3(...color);
      l.intensity = intensity;
      l.range = range;
      if (pulse) this.pulseLights.push({ light: l, base: intensity, phase: pos[0] + pos[2] });
      return l;
    };
    const pendant = new SpotLight('hqCommand', new Vector3(SURVEY_DESK.x, 6.32, SURVEY_DESK.z), new Vector3(0, -1, 0), 2.25, 1.6, scene);
    pendant.diffuse.set(1, 0.87, 0.71);
    pendant.specular.copyFrom(pendant.diffuse);
    pendant.intensity = 3.4;
    pendant.range = 18;
    point('hqLaunch', [0, 6.5, 16.5], [0.65, 0.92, 0.81], 2.7, 18, true);
    point('hqBay', [-16.5, 4.4, 0], [0.42, 1, 0.76], 2.65, 12);
    // Storage + workshop share one light (frees a slot for the player's light budget).
    point('hqWorks', [17, 4.6, 0], [0.98, 0.86, 0.72], 3.0, 16);
    point('hqMarket', [30, 5.2, 0], [0.86, 0.94, 1], 2.8, 14);
    point('hqReclaim', [-27, 5.2, 0], [1, 0.8, 0.55], 2.6, 13, true);
    // Eight fixed lights plus the player's light budget (12 is the portable per-material maximum).
    for (const m of lit) m.maxSimultaneousLights = 8 + LIMITS.lights;
    this.litMaterials = lit;

    if (settings.shadows !== 'off' && (high || settings.shadows === 'high')) {
      const sg = new ShadowGenerator(settings.shadows === 'high' ? 2048 : 1024, moon);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.004;
      sg.normalBias = 0.03;
      sg.darkness = 0.1;
      for (const m of builder.shadowCasters) sg.addShadowCaster(m);
    }

    // ---- player (same controller as the arena)
    this.player = new Player(scene, HQ_SPAWN, HQ_MOVE);
    scene.activeCamera = this.player.camera;
    this.player.camera.maxZ = 260;

    // Reflections: capture the finished static HQ once into a prefiltered cube map.
    captureEnvironment(scene, scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0), lit, new Vector3(0, 2.6, 0), high ? 256 : 128);
    this.post = new PostFx(scene, engine, this.player.camera, high);
    this.focus = new StationFocus(scene, this.player.camera);
    this.ambient = new AmbientDrones({ scene, kit: this.kit, pal: this.pal, playerPosition: () => this.player.position }, buildNav(HQ_ROOMS, HQ_PORTALS, this.rigs.map(rig => rig.station)));
    // Interior grade: calmer than the arena (less bloom spread, grain and aberration).
    this.post.pipeline.bloomWeight = 0.22;
    this.post.pipeline.bloomKernel = high ? 64 : 48;
    this.post.baseGrain = 0.4;
    this.post.baseExposure = 0.91;
    this.post.baseContrast = 1.09;

    this.input.onLockChange = (locked) => {
      if (!locked && this.screen === 'home') this.setScreen('paused');
    };
    this.unsubProfile = profile.store.subscribe(() => {
      this.refreshScreens();
      this.syncConstruction();
    });
    this.build = new BuildMode(scene, canvas, input, () => this.profile.save, (name, args) => this.profile.op(name, args), () => this.layer.realLights);
    this.unsubEcon = uiEvents.on('econ', (e) => this.stationFx(e.station, e.kind));
    this.applySettings(settings);
    if (hooks.tutorial)
      this.tut = new TutorialDirector('hq', hooks.tutorial, {
        available: (id) => this.screen === 'home' && (id !== 'hq_return' || this.profile.save.history.length > 0),
        complete: (id, t) => (id === 'hq_look' ? this.tutDist > 4 || t > 9 : id === 'hq_deploy' ? this.openedTerminals.has('deploy') : this.openedTerminals.has('storage') || t > 12),
      });
  }

  // ------------------------------------------------------------------ construction

  private buildStations(ctx: EconCtx, save: Readonly<SaveData>): void {
    for (const base of HQ_STATIONS) {
      let screen: ScreenTex | null = null;
      const pose = save.base.stations[base.id];
      if (pose) {
        // Relocated: the station's terminal moves on a modular console (same service, same interface).
        const st: Station = { ...base, pos: [pose.x, pose.z], yaw: pose.yaw, focus: [pose.x + Math.sin(pose.yaw) * 0.45, 1.3, pose.z + Math.cos(pose.yaw) * 0.45], area: areaAt(pose.x, pose.z) };
        screen = makeScreen(this.scene, st.id);
        consoleDesk(ctx, st, screen, 1.6);
        this.rigs.push({ station: st, screen });
        continue;
      }
      const st = base;
      switch (st.id) {
        case 'architect':
          screen = makeScreen(this.scene, st.id);
          consoleDesk(ctx, st, screen, 1.6);
          break;
        case 'deploy':
          screen = makeScreen(this.scene, st.id);
          consoleDesk(ctx, st, screen, 1.7);
          launchRing(ctx);
          break;
        case 'command':
          commandTable(ctx, st);
          break;
        case 'loadout':
          screen = makeScreen(this.scene, st.id);
          consoleDesk(ctx, st, screen);
          droneCradle(ctx, this.pal, [-18.2, 0]);
          break;
        case 'storage':
          screen = makeScreen(this.scene, st.id);
          consoleDesk(ctx, st, screen);
          storageRacks(ctx, save.storage.uids.length, save.storage.capacity);
          break;
        case 'workshop':
          screen = makeScreen(this.scene, st.id, 512, 256, [1, 1, 1]);
          workshop(ctx, st, screen);
          calibrationRing(ctx, [17, 1.75, -7.35]);
          break;
        case 'fabricate':
          screen = makeScreen(this.scene, st.id, 512, 230);
          fabricator(ctx, st, screen);
          break;
        case 'merchant':
          screen = makeScreen(this.scene, st.id);
          this.displays.exchange = equipmentExchange(ctx, st, screen);
          break;
        case 'modules':
          screen = makeScreen(this.scene, st.id);
          this.displays.broker = moduleBroker(ctx, st, screen);
          break;
        case 'salvage':
          screen = makeScreen(this.scene, st.id);
          this.displays.reclaim = reclamation(ctx, st, screen);
          break;
      }
      this.rigs.push({ station: st, screen });
    }
    // Large wall displays flanking the launch bay entrance (real profile data).
    const left = makeScreen(this.scene, 'wallLeft', 768, 432);
    const right = makeScreen(this.scene, 'wallRight', 768, 432);
    this.wallScreens = { left, right };
    for (const [s, x, z, yaw] of [[left, -7.7, 10.62, 0], [right, 10.6, 7.3, Math.PI / 2]] as const) {
      // Unrotated: CreatePlane's visible side faces -z, i.e. into the command deck.
      const frame = ctx.kit.node('wallScreen', null, [x, 3.6, z]);
      frame.rotation.y = yaw;
      ctx.kit.part('box', ctx.M.screenFrame, frame, { pos: [0, 0, -0.04], scale: [5.0, 2.95, 0.1] });
      ctx.kit.part('box', ctx.M.cyan, frame, { pos: [0, -1.52, -0.06], scale: [5.0, 0.04, 0.04] });
      const plane = planeBuilder(this.scene, 'wallScreenPlane', 4.8, 2.7);
      plane.material = s.mat;
      plane.parent = frame;
      plane.position.z = -0.1;
      plane.rotation.y = Math.PI;
    }
    if (!furnitureOccupied(ATRIUM_BED, save.base.placeables, save.base.stations)) this.buildAtriumGarden(ctx);
    this.refreshScreens();
  }

  private buildAtriumGarden(ctx: EconCtx): void {
    // A planted wall marks the transition from the command deck to the workshop.
    const garden = ctx.kit.node('atriumGarden', null, [ATRIUM_BED.x, 0, ATRIUM_BED.z]);
    const trough = ctx.kit.sculpt('gardenTrough', () => loftData([
      { t: 0.04, w: 2.22, h: 0.31, n: 5 }, { t: 0.18, w: 2.38, h: 0.43, n: 5 },
      { t: 0.73, w: 2.51, h: 0.48, n: 6 }, { t: 0.81, w: 2.48, h: 0.46, n: 6 },
    ], 'y', 40));
    ctx.kit.part(trough, ctx.M.white, garden);
    const { x, z, halfX, halfZ } = ATRIUM_BED;
    ctx.collider(x - halfX, 0, z - halfZ, x + halfX, 0.81, z + halfZ);
    for (const [offset, size, yaw] of [[-1.55, 1.78, 1.9], [-0.42, 2.18, 4.0], [0.87, 1.65, 0.2], [1.82, 1.58, 3.2]]) {
      placeScan(garden, 'fern', [offset, 0.78, -0.11], yaw, [size, size * 1.65, size * 0.67]);
    }
  }

  /** Distant stormfront behind the parallax geometry on the landing deck. */
  private buildBackdrop(): void {
    const texture = new Texture(hqStormfrontUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    const plane = planeBuilder(this.scene, 'hqBackdrop', 174, 87);
    plane.material = unlit(this.scene, 'hqBackdropMat', [1.05, 1.05, 1.05], { tex: texture });
    plane.position.set(0, 9, -68);
    plane.applyFog = false;
    plane.freezeWorldMatrix();
  }

  private buildSignage(ctx: EconCtx): void {
    makeSign(ctx, 'LAUNCH BAY', [0, 6.55, 10.245], Math.PI, 4.8);
    makeSign(ctx, 'DRONE BAY', [-10.68, 4.75, 0], Math.PI / 2, 4.2);
    makeSign(ctx, 'STORAGE · WORKSHOP', [10.68, 4.75, 0], -Math.PI / 2, 5.6);
    makeSign(ctx, 'MARKET CONCOURSE', [22.68, 4.75, 0], -Math.PI / 2, 5.0, '#9ef7ff');
    makeSign(ctx, 'RECLAMATION', [-21.32, 4.75, 0], Math.PI / 2, 4.2, '#ffd59a');
    makeSign(ctx, 'EQUIPMENT EXCHANGE', [30, 5.15, 7.38], Math.PI, 5.2);
    makeSign(ctx, 'MODULE BROKER', [30, 4.6, -7.6], 0, 4.4);
    makeSign(ctx, 'DISMANTLING', [-32.7, 4.6, 0], Math.PI / 2, 3.6, '#ffd59a');
    makeSign(ctx, 'FABRICATION', [17, 3.75, -8.6], 0, 3.6, '#ffd59a');
    makeSign(ctx, 'SECURE STORAGE', [17.0, 3.65, 7.8], Math.PI, 4.4);
    makeSign(ctx, 'HANGAR · SEALED', [-32.6, 3.9, 0], Math.PI / 2, 3.4, '#ffb547');
    makeSign(ctx, 'TRANSIT · SEALED', [36.6, 3.9, 0], -Math.PI / 2, 3.6, '#ffb547');
    makeSign(ctx, 'QUARTERS · SEALED', [-9.4, 3.9, -10.6], 0, 3.2, '#ffb547');
  }

  /** Redraw station screens from the save (called on every committed profile change). */
  private refreshScreens(): void {
    if (this.disposed) return;
    const save = this.profile.save;
    const tier = getTier(save.threat.selected);
    const rec = save.records[String(tier.id)];
    for (const rig of this.rigs) {
      const s = rig.screen;
      if (!s) continue;
      switch (rig.station.id) {
        case 'deploy':
          drawScreenFrame(s, 'DEPLOYMENT');
          screenLine(s, 100, 'OPERATION', 'SECTOR 07');
          screenLine(s, 150, 'THREAT TIER', `${tier.roman} · ${tier.name}`, '#ffb547');
          screenLine(s, 200, 'BEST WAVE', rec ? String(rec.bestWave) : '—');
          screenLine(s, 250, 'LAUNCH RING', 'READY');
          break;
        case 'loadout': {
          const w = equippedItem(save, 'weapon');
          const gear = SLOT_IDS.filter((id) => save.loadout[id]).length;
          drawScreenFrame(s, 'DRONE CONFIG');
          screenLine(s, 100, 'CHASSIS', 'WARDEN MK-I');
          screenLine(s, 150, 'PRIMARY', (w?.name ?? 'NONE').toUpperCase().slice(0, 22), w ? rarity(w.rarity).color : undefined);
          screenLine(s, 200, 'EQUIPPED', `${gear} / ${SLOT_IDS.length} SLOTS`, '#cdd9df');
          screenLine(s, 250, 'STATUS', 'NOMINAL');
          break;
        }
        case 'storage':
          drawScreenFrame(s, 'STORAGE');
          screenLine(s, 100, 'BAYS IN USE', `${save.storage.uids.length} / ${save.storage.capacity}`, save.storage.uids.length > save.storage.capacity ? '#ff6a55' : undefined);
          screenLine(s, 150, 'SALVAGE', String(save.resources.salvage), '#ffb547');
          screenLine(s, 200, 'ITEMS OWNED', String(save.items.length));
          screenLine(s, 250, 'LOCK', 'SECURED');
          break;
        case 'workshop':
          drawScreenFrame(s, 'ENGINEERING', '#ffb547');
          screenLine(s, 100, 'WEAPONS', String(save.items.filter((i) => i.category === 'weapon').length), '#cdd9df');
          screenLine(s, 150, 'MODULES', String(save.items.filter((i) => i.category === 'module').length), '#cdd9df');
          screenLine(s, 200, 'SALVAGE · COMP', `${save.resources.salvage} · ${save.resources.components}`, '#ffb547');
          break;
        case 'fabricate':
          drawScreenFrame(s, 'FABRICATOR', '#ffb547');
          screenLine(s, 90, 'OUTPUT LEVEL', String(fabricationLevel(save as SaveData)), '#ffd59a');
          screenLine(s, 140, 'CRAFTED', String(save.economy.stats.itemsCrafted), '#cdd9df');
          screenLine(s, 190, 'STATUS', 'READY');
          break;
        case 'merchant': {
          const left = save.market.equipment.filter((e) => !e.sold).length;
          drawScreenFrame(s, 'EXCHANGE');
          screenLine(s, 100, 'CREDITS', String(save.resources.credits), '#9ef7ff');
          screenLine(s, 150, 'IN STOCK', `${left} / ${save.market.equipment.length}`);
          screenLine(s, 200, 'MANIFEST', `#${save.market.rotation}`, '#cdd9df');
          screenLine(s, 250, 'RESTOCK', 'AFTER NEXT OPERATION', '#cdd9df');
          break;
        }
        case 'modules': {
          const left = save.market.modules.filter((e) => !e.sold).length;
          drawScreenFrame(s, 'MODULE BROKER');
          screenLine(s, 100, 'CREDITS', String(save.resources.credits), '#9ef7ff');
          screenLine(s, 150, 'MODULES', `${left} / ${save.market.modules.length}`);
          screenLine(s, 200, 'EXCHANGE', save.market.exchange.map((o) => o.left).join(' · '), '#ffd59a');
          break;
        }
        case 'salvage':
          drawScreenFrame(s, 'RECLAMATION', '#ffb547');
          screenLine(s, 100, 'SALVAGE', String(save.resources.salvage), '#ffb547');
          screenLine(s, 150, 'ADV. COMPONENTS', String(save.resources.components), '#9ef7ff');
          screenLine(s, 200, 'DISMANTLED', String(save.economy.stats.itemsDismantled), '#cdd9df');
          screenLine(s, 250, 'PRESS', 'ARMED');
          break;
      }
      s.tex.update(false);
    }
    this.displays.exchange?.update(save.market.equipment);
    this.displays.broker?.update(save.market.modules, save.market.exchange);
    this.displays.reclaim?.update(save.resources.salvage, save.resources.components);
    if (this.wallScreens) {
      const { left, right } = this.wallScreens;
      drawScreenFrame(left, 'Service record');
      const record = left.ctx;
      const metrics = [['Operations', save.totals.runs], ['Extractions', save.totals.returned], ['Hostiles', save.totals.kills]] as const;
      metrics.forEach(([label, value], i) => {
        const x = 30 + i * 241;
        record.font = `700 69px ${SCREEN_FONT}`;
        record.fillStyle = '#ecedde';
        record.fillText(String(value), x, 136, 216);
        record.font = `500 24px ${SCREEN_FONT}`;
        record.fillStyle = '#b7c8ba';
        record.fillText(label, x, 197);
      });
      record.fillStyle = '#617267';
      record.fillRect(30, 244, 704, 2);
      record.font = `500 21px ${SCREEN_FONT}`;
      record.fillText('Best wave by tier', 30, 273);
      THREAT_TIERS.forEach((t, i) => {
        const value = save.records[String(t.id)]?.bestWave || '—';
        const x = 30 + i * 143;
        record.fillStyle = t.id <= save.threat.unlocked ? '#e9b692' : '#a2afa5';
        record.font = `700 26px ${SCREEN_FONT}`;
        record.fillText(t.roman, x, 319);
        record.font = `500 23px ${SCREEN_FONT}`;
        record.fillText(t.id <= save.threat.unlocked ? String(value) : 'Locked', x, 370);
      });
      left.tex.update(false);
      drawScreenFrame(right, 'Salvage reserve', '#ecaa82');
      const ctx = right.ctx;
      ctx.font = `700 120px ${SCREEN_FONT}`;
      ctx.fillStyle = '#ffd59a';
      ctx.fillText(String(save.resources.salvage), 32, 160, 680);
      ctx.font = `500 20px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(205,225,235,0.7)';
      ctx.fillText('Banked at checkpoints', 38, 230);
      // Recent operations sparkline (waves cleared per run, newest right).
      const hist = [...save.history].reverse().slice(-12);
      const max = Math.max(5, ...hist.map((h) => h.wavesCleared));
      hist.forEach((h, i) => {
        const bh = (h.wavesCleared / max) * 110;
        ctx.fillStyle = h.outcome === 'returned' ? '#4fe6f5' : h.outcome === 'defeat' ? '#ff6a4a' : '#8a9aa3';
        ctx.fillRect(42 + i * 56, 399 - bh, 40, Math.max(2, bh));
      });
      ctx.font = `500 16px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(205,225,235,0.5)';
      ctx.fillText(hist.length ? 'Waves cleared in recent operations' : 'No operations on record', 38, 275);
      right.tex.update(false);
    }
  }

  // ------------------------------------------------------------------ screens & control

  setScreen(s: Screen): void {
    this.screen = s;
    hudStore.set({ screen: s, location: 'home' });
    if (s !== 'terminal') hudStore.set({ terminal: null });
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.player.sensitivity = s.sensitivity;
    const h = (s.fov * Math.PI) / 180;
    this.player.baseFov = 2 * Math.atan(Math.tan(h / 2) / (16 / 9));
    this.player.reduceMotion = s.reduceMotion;
    this.reduceMotion = s.reduceMotion;
    this.player.shakeScale = s.shake;
    this.post?.setOptions({ bloom: s.bloom, reduceMotion: s.reduceMotion });
    sfx.setVolume(s.volume);
    sfx.setMix(s.sfxVolume, s.uiVolume, s.ambienceVolume);
  }

  /** Give the player control (pointer lock); falls back to the pause overlay. */
  async takeControl(sound = true): Promise<void> {
    sfx.init();
    if (sound) sfx.play('ui');
    this.input.clear();
    this.setScreen('home');
    await this.input.requestLock();
    if (!this.disposed && this.screen === 'home' && !this.input.captured && !this.input.isLockedNow()) this.setScreen('paused');
    this.canvas.focus();
  }

  openTerminal(id: TerminalId): void {
    if (this.screen !== 'home') return;
    sfx.play('ui');
    this.screen = 'terminal';
    const rig = this.rigs.find((r) => r.station.id === id);
    if (rig) this.focus.openStation(rig.station);
    this.openedTerminals.add(id);
    hudStore.set({ screen: 'terminal', terminal: id, prompt: null });
    this.input.releaseLock();
  }

  async closeTerminal(): Promise<void> {
    if (this.screen !== 'terminal') return;
    this.focus.closeStation();
    await this.takeControl();
  }

  /** Called from the deployment terminal UI. */
  deploy(): void {
    this.hooks.deploy();
  }

  // ------------------------------------------------------------------ frame

  step(dt: number, fps = 60): void {
    if (this.disposed) return;
    if (Number.isFinite(fps)) this.fpsSmooth += (fps - this.fpsSmooth) * 0.05;
    this.time += dt;
    const input = this.input;
    const controls = this.screen === 'home' && input.captured;
    if (this.screen === 'menu') this.orbit();
    else if (this.screen !== 'construct') this.player.update(dt, input, 1, controls);
    if (this.screen === 'construct') {
      this.build.update(dt);
      if (input.pressed('Escape') || input.pressed('KeyB')) void this.exitConstruction();
    }
    if (this.screen !== 'terminal') this.focus.closeStation();
    this.focus.update(dt, this.reduceMotion);
    this.ambient.update(dt);
    this.layer.update(dt);
    this.animateOthers(dt);
    if (!this.emitters.length && sfx.ready) this.startAmbience();
    {
      const c = this.scene.activeCamera?.globalPosition ?? this.player.camera.position;
      sfx.listen(c.x, c.y, c.z, this.screen === 'construct' ? -this.build.camera.alpha - Math.PI / 2 : this.player.yaw);
    }
    if (this.tut) {
      const p = this.player.position;
      this.tutDist += Math.min(2, Math.hypot(p.x - this.tutPos[0], p.z - this.tutPos[1]));
      this.tutPos = [p.x, p.z];
      this.tut.update(dt, input.pressed('F10'));
    }

    if (controls && input.pressed('F3')) this.togglePerf();
    this.updateTarget(controls);
    if (controls && this.target && input.pressed('KeyE')) this.openTerminal(this.target.station.id);

    for (const [k, v] of this.pulses) this.pulses.set(k, Math.max(0, v - dt / PULSE_TIME));
    for (const a of this.animators) a(dt, this.time);
    this.vista.update(this.time);
    for (const p of this.pulseLights) p.light.intensity = p.base * (0.92 + 0.08 * Math.sin(this.time * 1.3 + p.phase));
    this.post.update(dt, 0, 0, 0);

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 1 / 15;
      this.publishHud();
    }
  }

  /** Slow cinematic orbit behind the title screen. */
  private orbit(): void {
    const t = this.time * 0.05;
    const a = -0.5 + Math.sin(t) * 0.45;
    const cam = this.player.camera;
    cam.position.set(Math.sin(a) * 7.5, 2.4 + Math.sin(t * 1.7) * 0.25, -8.8 + Math.cos(a) * 0.6);
    cam.setTarget(new Vector3(0, 2.6, 8));
    cam.fov = 1.0;
  }

  private updateTarget(controls: boolean): void {
    let next: StationRig | null = null;
    if (controls && this.player.alive) {
      const eye = this.player.eye;
      const dir = this.player.forward(TMP);
      const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
      const cands = this.rigs.map((r) => ({ id: r.station.id, rig: r, point: { x: r.station.focus[0], y: r.station.focus[1], z: r.station.focus[2] }, range: r.station.range }));
      const hit = pickInteractable(cands, eye, dir, undefined, (c) => {
        if (!physics) return false;
        // Stop short of the focus point: it sits on the station's own collider.
        const end = new Vector3(c.point.x, c.point.y, c.point.z);
        const back = end.subtract(eye);
        const len = back.length();
        if (len > 0.45) end.subtractInPlace(back.scaleInPlace(0.4 / len));
        physics.raycastToRef(eye, end, this.physResult, ENV_QUERY);
        return this.physResult.hasHit;
      });
      next = hit?.rig ?? null;
    }
    if (next !== this.target) {
      this.target?.screen?.mat.emissiveColor.setAll(1);
      next?.screen?.mat.emissiveColor.setAll(1.6);
      if (next) sfx.play('ui', { volume: 0.25, pitch: 1.6 });
      this.target = next;
      this.focus.setTarget(next?.station ?? null);
    }
  }

  /** Station feedback for a committed transaction (animation + sound). */
  stationFx(station: string, kind: string): void {
    if (this.disposed) return;
    this.pulses.set(station, 1);
    const sound = ({ buy: 'purchase', sell: 'sell', dismantle: 'press', craft: 'fabricate', enhance: 'enhance', reroll: 'reroll', component: 'install', exchange: 'purchase' } as const)[kind as 'buy'];
    if (sound) sfx.play(sound);
  }

  togglePerf(on = !this.perfOn): void {
    this.perfOn = on;
    if (on && !this.instrumentation) this.instrumentation = new SceneInstrumentation(this.scene);
  }

  private publishHud(): void {
    const p = this.player.position;
    const t = this.target?.station;
    hudStore.set({
      location: 'home',
      area: areaAt(p.x, p.z),
      prompt: t && this.screen === 'home' ? { key: keyLabel(this.settings.keys.use), title: t.title, action: t.action } : null,
      perf: this.perfOn
        ? { fps: Math.round(this.fpsSmooth), enemies: 0, draws: Math.round(this.instrumentation?.drawCallsCounter.current ?? 0), particles: 0 }
        : null,
    });
  }

  /** M7 spatial ambience: launch ring, machinery, ventilation (started once audio is unlocked). */
  private startAmbience(): void {
    for (const [k, x, y, z, g, r] of [
      ['hum', 0, 4, 19.6, 1, 6],
      ['air', 0, 6.5, -2, 0.7, 8],
      ['machine', 21.5, 1.2, -5.2, 0.7, 3],
      ['machine', -27, 1.2, -3.6, 0.8, 3],
      ['hum', 30, 3, 0, 0.6, 5],
      ['air', -16, 4.5, 0, 0.5, 5],
    ] as const) {
      const e = sfx.emitter(k, x, y, z, g, r);
      if (e) this.emitters.push(e);
    }
    this.ambient.startSound();
    this.layer.startSound();
  }

  /** M7: enter construction mode (from the architect console). Owner only. */
  enterConstruction(): void {
    if (this.readOnly) return;
    sfx.play('ui');
    hudStore.set({ terminal: null, prompt: null });
    this.screen = 'construct';
    hudStore.set({ screen: 'construct', location: 'home' });
    this.input.releaseLock();
    this.input.freeKeys = true;
    this.build.enter(this.player.position);
  }

  async exitConstruction(): Promise<void> {
    if (this.screen !== 'construct') return;
    this.build.exit();
    this.input.freeKeys = false;
    await this.takeControl();
  }

  /** The layout shown: this player's own, or the host's while visiting their HQ in a co-op session. */
  private layoutSave(): Readonly<SaveData> {
    const host = this.hooks.hostBase?.();
    return host ? { ...this.profile.save, base: host } : this.profile.save;
  }

  /** Host changed their HQ while we visit: apply it (incremental, or a rebuild for relocated stations). */
  applyHostBase(): void {
    this.syncConstruction();
  }

  // ---------------------------------------------------------------- M7 co-op presence

  private others = new Map<string, { rig: ReturnType<typeof buildWardenDrone>; tx: number; tz: number; ty: number; yaw: number; t: number }>();
  /** Other wardens in this HQ (lobby presence, 10 Hz). */
  setPresence(list: readonly { id: string; name: string; p: [number, number, number]; yaw: number }[]): void {
    const seen = new Set<string>();
    for (const o of list) {
      seen.add(o.id);
      let r = this.others.get(o.id);
      if (!r) {
        const rig = buildWardenDrone(this.scene, this.kit, this.pal, 1 + (this.others.size % 3));
        rig.root.position.set(o.p[0], o.p[1] + 0.55, o.p[2]);
        r = { rig, tx: o.p[0], ty: o.p[1], tz: o.p[2], yaw: o.yaw, t: 0 };
        this.others.set(o.id, r);
      }
      r.tx = o.p[0];
      r.ty = o.p[1];
      r.tz = o.p[2];
      r.yaw = o.yaw;
    }
    for (const [id, r] of this.others) {
      if (seen.has(id)) continue;
      r.rig.root.dispose(false, false);
      r.rig.accent.dispose();
      this.others.delete(id);
    }
  }

  private animateOthers(dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    for (const r of this.others.values()) {
      const p = r.rig.root.position;
      p.x += (r.tx - p.x) * k;
      p.y += (r.ty + 0.55 - p.y) * k;
      p.z += (r.tz - p.z) * k;
      r.rig.root.rotation.y = r.yaw;
      r.t += dt;
      r.rig.body.position.y = Math.sin(r.t * 2.2) * 0.05;
      r.rig.ring.rotation.y += dt * 6;
    }
  }

  get presenceCount(): number {
    return this.others.size;
  }

  /** Re-sync construction after a profile change; structural changes to the shell need a rebuild. */
  private syncConstruction(): void {
    if (this.disposed) return;
    const save = this.layoutSave();
    const sig = layoutSignature(save);
    if (sig !== this.layoutSig) {
      this.layoutSig = sig;
      this.hooks.rebuild?.();
      return;
    }
    this.layer.sync(save);
  }

  dispose(): void {
    if (this.disposed) return;
    this.build?.dispose();
    this.ambient?.dispose();
    this.layer?.dispose();
    this.tut?.dispose();
    for (const e of this.emitters) e.dispose();
    this.emitters = [];
    this.disposed = true;
    this.unsubProfile();
    this.unsubEcon();
    this.input.onLockChange = () => {};
    this.instrumentation?.dispose();
    this.scene.dispose();
  }

  snapshot() {
    return {
      screen: this.screen,
      playerPos: this.player.position.asArray(),
      yaw: this.player.yaw,
      target: this.target?.station.id ?? null,
      area: areaAt(this.player.position.x, this.player.position.z),
      fps: Math.round(this.fpsSmooth),
    };
  }
}

/** Things that need a full HQ rebuild when they change: relocated stations (their rigs are static). */
function layoutSignature(save: Readonly<SaveData>): string {
  return JSON.stringify(save.base.stations);
}
