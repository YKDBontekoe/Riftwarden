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
  Vector3,
} from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { Input } from '../core/Input';
import type { Settings } from '../core/settings';
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
import { PostFx } from '../visuals/postfx';
import { canvas, rng, toTexture } from '../visuals/textures';
import { ENV_QUERY } from '../world/physicsGroups';
import { HqBuilder, type HqMaterials } from './HqBuilder';
import { pickInteractable } from './interaction';
import { areaAt, HQ_SPAWN, HQ_STATIONS, type Station } from './layout';
import {
  type Animator,
  buildPlaceable,
  commandTable,
  consoleDesk,
  drawScreenFrame,
  droneCradle,
  launchRing,
  makeScreen,
  makeSign,
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
  /** Lights whose intensity breathes slightly (subtle "alive" feel). */
  private pulseLights: { light: PointLight; base: number; phase: number }[] = [];
  /** Transaction feedback per station (1 -> 0 over PULSE_TIME). */
  private pulses = new Map<string, number>();
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
    this.kit = new Kit(scene);

    // HQ material set: brighter, cleaner interior variants of the shared palette.
    // Interior composites: panel detail from the shared wall set, but dielectric and
    // fairly rough so they read as light surfaces without a bright sky to reflect.
    const composite = (name: string, albedo: [number, number, number], rough: number, coat: number) => {
      const m = new PBRMaterial(name, scene);
      m.albedoTexture = pal.panel.albedoTexture;
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
    const wall = composite('hqWall', [0.95, 0.96, 0.97], 0.62, 0.15);
    const ceiling = composite('hqCeiling', [0.8, 0.82, 0.84], 0.85, 0);
    ceiling.albedoTexture = null; // plain acoustic panels: keeps the vents for walls/floor
    ceiling.bumpTexture = null;
    const glass = new PBRMaterial('hqGlass', scene);
    glass.albedoColor = new Color3(0.02, 0.06, 0.08);
    glass.metallic = 0;
    glass.roughness = 0.03;
    glass.alpha = 0.12;
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
    const plant = plain('hqPlant', [0.12, 0.42, 0.3], 0, 0.7);
    const screenFrame = plain('hqScreenFrame', [0.03, 0.035, 0.04], 0.6, 0.35);
    for (const m of [floor, ceiling, wall, plant, screenFrame]) m.environmentIntensity = 1.2;
    const M: HqMaterials & { plant: PBRMaterial; screenFrame: PBRMaterial } = {
      floor,
      wall,
      white: pal.white,
      graphite: pal.graphite,
      metal: pal.metal,
      ceiling,
      glass,
      cyan: pal.cyanGlow,
      cyanDim: pal.cyanDim,
      teal: unlit(scene, 'hqTeal', [0.15, 1.5, 1.1]),
      amber: unlit(scene, 'hqAmber', [2.2, 1.0, 0.12]),
      amberDim: unlit(scene, 'hqAmberDim', [0.5, 0.22, 0.03]),
      lamp: unlit(scene, 'hqLamp', [1.7, 1.85, 2.0]),
      plant,
      screenFrame,
    };
    const lit = [ceiling, wall, plant, screenFrame, ...pal.lit];

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
    const save = profile.save;
    this.buildStations(ctx, save);
    for (const p of save.base.placeables) buildPlaceable(ctx, p);
    builder.finish();
    this.buildBackdrop();
    this.buildSignage(ctx);

    // ---- lighting: cool fill, moonlight through the window, cyan/teal accents, warm workshop
    const hemi = new HemisphericLight('hqFill', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.65;
    hemi.diffuse = new Color3(0.86, 0.93, 1);
    hemi.groundColor = new Color3(0.5, 0.53, 0.56);
    hemi.specular = Color3.Black();
    const moon = new DirectionalLight('hqMoon', new Vector3(-0.25, -0.55, 1).normalize(), scene);
    moon.position = new Vector3(8, 18, -40);
    moon.intensity = 1.4;
    moon.diffuse = new Color3(0.7, 0.82, 1);
    moon.specular = new Color3(0.7, 0.85, 1);
    const point = (name: string, pos: [number, number, number], color: [number, number, number], intensity: number, range: number, pulse = false) => {
      const l = new PointLight(name, new Vector3(...pos), scene);
      l.diffuse = new Color3(...color);
      l.specular = new Color3(...color);
      l.intensity = intensity;
      l.range = range;
      if (pulse) this.pulseLights.push({ light: l, base: intensity, phase: pos[0] + pos[2] });
      return l;
    };
    point('hqCommand', [0, 6.2, -2], [0.9, 0.97, 1], 2.65, 26);
    point('hqHolo', [0, 2.2, 0], [0.25, 0.85, 1], 0.95, 8, true);
    point('hqLaunch', [0, 6.5, 16.5], [0.45, 0.9, 1], 3.0, 18, true);
    point('hqBay', [-16.5, 4.4, 0], [0.55, 1, 0.95], 2.6, 13);
    point('hqStorage', [17, 4.4, 4.5], [0.9, 0.95, 1], 2.5, 12);
    point('hqWorkshop', [17, 4.4, -5], [1, 0.84, 0.66], 2.5, 12);
    point('hqMarket', [30, 5.2, 0], [0.86, 0.94, 1], 2.8, 14);
    point('hqReclaim', [-27, 5.2, 0], [1, 0.8, 0.55], 2.6, 13, true);
    // Ten lights in total: let the interior materials see all of them.
    for (const m of lit) m.maxSimultaneousLights = 10;

    if (high) {
      const sg = new ShadowGenerator(2048, moon);
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
    // Interior grade: calmer than the arena (less bloom spread, grain and aberration).
    this.post.pipeline.bloomWeight = 0.22;
    this.post.pipeline.bloomKernel = high ? 64 : 48;
    this.post.baseGrain = 0.7;
    this.post.baseExposure = 0.92;

    this.input.onLockChange = (locked) => {
      if (!locked && this.screen === 'home') this.setScreen('paused');
    };
    this.unsubProfile = profile.store.subscribe(() => this.refreshScreens());
    this.unsubEcon = uiEvents.on('econ', (e) => this.stationFx(e.station, e.kind));
    this.applySettings(settings);
  }

  // ------------------------------------------------------------------ construction

  private buildStations(ctx: EconCtx, save: Readonly<SaveData>): void {
    for (const st of HQ_STATIONS) {
      let screen: ScreenTex | null = null;
      switch (st.id) {
        case 'deploy':
          screen = makeScreen(this.scene, st.id);
          consoleDesk(ctx, st, screen, 1.7);
          launchRing(ctx);
          break;
        case 'command':
          commandTable(ctx);
          break;
        case 'loadout':
          screen = makeScreen(this.scene, st.id);
          consoleDesk(ctx, st, screen);
          droneCradle(ctx, [-18.2, 0]);
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
    for (const [s, x] of [[left, -7.6], [right, 7.6]] as const) {
      // Unrotated: CreatePlane's visible side faces -z, i.e. into the command deck.
      const frame = ctx.kit.node('wallScreen', null, [x, 3.6, 10.62]);
      ctx.kit.part('box', ctx.M.screenFrame, frame, { pos: [0, 0, -0.04], scale: [5.0, 2.95, 0.1] });
      ctx.kit.part('box', ctx.M.cyan, frame, { pos: [0, -1.52, -0.06], scale: [5.0, 0.04, 0.04] });
      const plane = planeBuilder(this.scene, 'wallScreenPlane', 4.8, 2.7);
      plane.material = s.mat;
      plane.parent = frame;
      plane.position.z = -0.1;
      plane.rotation.y = Math.PI;
    }
    this.refreshScreens();
  }

  /** Night sky, rift tear and distant city beyond the observation window. */
  private buildBackdrop(): void {
    const W = 2048;
    const H = 768;
    const { c, ctx } = canvas(W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#02060c');
    g.addColorStop(0.55, '#0a1d2a');
    g.addColorStop(0.78, '#123446');
    g.addColorStop(1, '#05090c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = rng(77);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(220,240,255,${0.2 + r() * 0.6})`;
      const s = r() < 0.08 ? 2 : 1;
      ctx.fillRect(r() * W, r() * H * 0.6, s, s);
    }
    // Rift tear: a jagged orange-white wound in the clouds.
    ctx.save();
    ctx.translate(W * 0.62, H * 0.3);
    ctx.rotate(-0.35);
    for (let pass = 0; pass < 3; pass++) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 260 - pass * 70);
      glow.addColorStop(0, pass === 2 ? 'rgba(255,240,210,0.9)' : 'rgba(255,120,30,0.35)');
      glow.addColorStop(1, 'rgba(255,80,10,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(0, 0, 300 - pass * 80, 40 - pass * 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // City silhouette with lit windows.
    let x = 0;
    while (x < W) {
      const bw = 30 + r() * 90;
      const bh = 60 + r() * 220 * (0.4 + 0.6 * Math.sin((x / W) * Math.PI));
      ctx.fillStyle = '#03070a';
      ctx.fillRect(x, H - bh - 40, bw, bh + 40);
      for (let wy = H - bh - 30; wy < H - 50; wy += 9)
        for (let wx = x + 4; wx < x + bw - 4; wx += 7)
          if (r() < 0.1) {
            ctx.fillStyle = r() < 0.7 ? `rgba(255,${170 + r() * 50},90,${0.4 + r() * 0.5})` : `rgba(120,230,255,${0.4 + r() * 0.5})`;
            ctx.fillRect(wx, wy, 3, 4);
          }
      if (r() < 0.3) {
        ctx.fillStyle = 'rgba(255,60,40,0.9)';
        ctx.fillRect(x + bw / 2, H - bh - 44, 3, 3);
      }
      x += bw + r() * 6;
    }
    const tex = toTexture('hqBackdrop', c, this.scene, { aniso: 4 });
    tex.wrapU = tex.wrapV = 0;
    const mat = unlit(this.scene, 'hqBackdropMat', [1.1, 1.1, 1.1], { tex });
    const plane = planeBuilder(this.scene, 'hqBackdrop', 190, 72);
    plane.material = mat;
    plane.position.set(0, 18, -62);
    plane.applyFog = false;
  }

  private buildSignage(ctx: EconCtx): void {
    makeSign(ctx, 'LAUNCH BAY', [0, 6.5, 10.68], Math.PI, 5.2);
    makeSign(ctx, 'DRONE BAY', [-10.68, 4.75, 0], Math.PI / 2, 4.2);
    makeSign(ctx, 'STORAGE · WORKSHOP', [10.68, 4.75, 0], -Math.PI / 2, 5.6);
    makeSign(ctx, 'MARKET CONCOURSE', [22.68, 4.75, 0], -Math.PI / 2, 5.0, '#9ef7ff');
    makeSign(ctx, 'RECLAMATION', [-21.32, 4.75, 0], Math.PI / 2, 4.2, '#ffd59a');
    makeSign(ctx, 'EQUIPMENT EXCHANGE', [30, 5.15, 7.38], Math.PI, 5.2);
    makeSign(ctx, 'MODULE BROKER', [30, 4.6, -7.6], 0, 4.4);
    makeSign(ctx, 'DISMANTLING', [-32.7, 4.6, 0], Math.PI / 2, 3.6, '#ffd59a');
    makeSign(ctx, 'DEPLOYMENT', [0, 7.35, 18.7], Math.PI, 5.0, '#9ef7ff');
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
      drawScreenFrame(left, 'SERVICE RECORD');
      screenLine(left, 110, 'OPERATIONS', String(save.totals.runs));
      screenLine(left, 160, 'EXTRACTIONS', String(save.totals.returned));
      screenLine(left, 210, 'HOSTILES DESTROYED', String(save.totals.kills));
      THREAT_TIERS.forEach((t, i) => {
        const r = save.records[String(t.id)];
        const locked = t.id > save.threat.unlocked;
        screenLine(left, 270 + i * 50, `TIER ${t.roman} BEST WAVE`, locked ? 'LOCKED' : r ? String(r.bestWave) : '—', locked ? '#6b7c85' : '#9ef7ff');
      });
      left.tex.update(false);
      drawScreenFrame(right, 'SALVAGE RESERVE', '#ffb547');
      const ctx = right.ctx;
      ctx.font = `700 120px ${SCREEN_FONT}`;
      ctx.fillStyle = '#ffd59a';
      ctx.fillText(String(save.resources.salvage), 40, 170);
      ctx.font = `500 20px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(205,225,235,0.7)';
      ctx.fillText('SECURED AT CHECKPOINTS · SURVIVES DEFEAT', 42, 250);
      // Recent operations sparkline (waves cleared per run, newest right).
      const hist = [...save.history].reverse().slice(-12);
      const max = Math.max(5, ...hist.map((h) => h.wavesCleared));
      hist.forEach((h, i) => {
        const bh = (h.wavesCleared / max) * 110;
        ctx.fillStyle = h.outcome === 'returned' ? '#4fe6f5' : h.outcome === 'defeat' ? '#ff6a4a' : '#8a9aa3';
        ctx.fillRect(42 + i * 56, 400 - bh, 40, Math.max(2, bh));
      });
      ctx.font = `500 16px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(205,225,235,0.5)';
      ctx.fillText(hist.length ? 'RECENT OPERATIONS · WAVES CLEARED' : 'NO OPERATIONS ON RECORD', 42, 288);
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
    sfx.setVolume(s.volume);
  }

  /** Give the player control (pointer lock); falls back to the pause overlay. */
  async takeControl(sound = true): Promise<void> {
    sfx.init();
    if (sound) sfx.play('ui');
    this.setScreen('home');
    await this.input.requestLock();
    if (!this.disposed && this.screen === 'home' && !this.input.captured && !this.input.isLockedNow()) this.setScreen('paused');
    this.canvas.focus();
  }

  openTerminal(id: TerminalId): void {
    if (this.screen !== 'home') return;
    sfx.play('ui');
    this.screen = 'terminal';
    hudStore.set({ screen: 'terminal', terminal: id, prompt: null });
    this.input.releaseLock();
  }

  async closeTerminal(): Promise<void> {
    if (this.screen !== 'terminal') return;
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
    else this.player.update(dt, input, 1, controls);

    if (controls && input.pressed('F3')) this.togglePerf();
    this.updateTarget(controls);
    if (controls && this.target && input.pressed('KeyE')) this.openTerminal(this.target.station.id);

    for (const [k, v] of this.pulses) this.pulses.set(k, Math.max(0, v - dt / PULSE_TIME));
    for (const a of this.animators) a(dt, this.time);
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
      prompt: t && this.screen === 'home' ? { key: 'E', title: t.title, action: t.action } : null,
      perf: this.perfOn
        ? { fps: Math.round(this.fpsSmooth), enemies: 0, draws: Math.round(this.instrumentation?.drawCallsCounter.current ?? 0), particles: 0 }
        : null,
    });
  }

  dispose(): void {
    if (this.disposed) return;
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
