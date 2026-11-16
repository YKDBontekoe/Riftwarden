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
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { rollDamage } from '../combat/damage';
import { BASE_STATS, type CombatStats, computeStats, type StatModifier } from '../combat/stats';
import { type ShotOutcome, type ShotRequest, Weapon } from '../combat/Weapon';
import { ECONOMY, PLASMA_REPEATER, SENTINEL } from '../data/defs';
import { Construction } from '../defense/Construction';
import { type Turret, type TurretContext, type TurretHitboxMeta, TurretManager } from '../defense/Turrets';
import { type Enemy, type EnemyContext, type EnemyHitboxMeta, EnemyManager } from '../enemies/EnemyManager';
import { Effects } from '../fx/Effects';
import { Player } from '../player/Player';
import { type HitKind, hudStore, type Screen, uiEvents } from '../ui/store';
import { ArenaBuilder } from '../visuals/arena';
import { Atmosphere } from '../visuals/atmosphere';
import { PostFx } from '../visuals/postfx';
import { Kit } from '../visuals/kit';
import { createPalette, type Palette } from '../visuals/materials';
import { buildReactor, type ReactorRig } from '../visuals/models';
import { WaveManager } from '../waves/WaveManager';
import { ARENA } from '../world/layout';
import { ENV_QUERY } from '../world/physicsGroups';
import { Input } from './Input';
import { type Settings, saveSettings } from './settings';
import { TacticalEnergy, Wallet } from './tactical';

const TMP = new Vector3();
const TMP2 = new Vector3();

export class Game {
  readonly scene: Scene;
  readonly input: Input;
  private pal: Palette;
  private kit: Kit;
  readonly player: Player;
  readonly weapon: Weapon;
  readonly fx: Effects;
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

  /** Modifier list; future equipment and run upgrades push into this. */
  modifiers: StatModifier[] = [];
  stats: CombatStats = { ...BASE_STATS };

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

  constructor(private engine: Engine, private canvas: HTMLCanvasElement, havok: unknown, public settings: Settings) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.02, 0.025, 0.035, 1);
    scene.ambientColor = new Color3(0.04, 0.045, 0.05);
    scene.skipPointerMovePicking = true;
    scene.enablePhysics(new Vector3(0, -26, 0), new HavokPlugin(true, havok));

    this.input = new Input(canvas);
    this.pal = createPalette(scene);
    this.kit = new Kit(scene);
    const high = settings.quality === 'high';

    // Night-time storm: sky, haze, lamps, embers. PBR ambient comes from the captured environment.
    this.atmosphere = new Atmosphere(scene, this.pal, ARENA);
    this.atmosphere.setQuality(high);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0078;
    scene.fogColor = this.atmosphere.fogColor;

    // Lighting: cold moonlight key through the storm, cyan reactor glow, orange rift light at the gates.
    const moon = new DirectionalLight('moon', new Vector3(-0.45, -1, 0.35), scene);
    moon.position = new Vector3(45, 90, -35);
    moon.intensity = 1.5;
    moon.diffuse = new Color3(0.62, 0.74, 1);
    moon.specular = new Color3(0.7, 0.8, 1);
    this.moon = moon;
    this.reactorLight = new PointLight('reactorLight', new Vector3(0, 5, 0), scene);
    this.reactorLight.diffuse = new Color3(0.3, 0.9, 1);
    this.reactorLight.specular = new Color3(0.3, 0.9, 1);
    this.reactorLight.intensity = 2.2;
    this.reactorLight.range = 34;

    // Arena
    const arena = new ArenaBuilder(scene, this.pal, ARENA);
    arena.build();
    this.animated.push(...arena.animated);
    this.atmosphere.adoptPortals();
    this.reactor = buildReactor(scene, this.pal);

    this.player = new Player(scene, ARENA.playerSpawn);
    scene.activeCamera = this.player.camera;
    this.weapon = new Weapon(scene, this.pal, PLASMA_REPEATER, this.player);
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);

    this.fx = new Effects(scene, this.kit, this.pal);
    this.fx.onShake = (pos, strength) => {
      const d = Vector3.Distance(pos, this.player.position);
      const k = strength * Math.max(0, 1 - d / 38);
      if (k <= 0.01) return;
      this.player.addTrauma(k * 0.7);
      this.post.kick(k * 0.8);
    };
    // Shadows (high quality only); enemies & turrets register as casters via the kit.
    if (high) {
      const sg = new ShadowGenerator(2048, moon);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.0015;
      sg.normalBias = 0.02;
      sg.darkness = 0.15;
      moon.shadowMinZ = 1;
      moon.shadowMaxZ = 220;
      for (const m of arena.shadowCasters) sg.addShadowCaster(m);
      for (const m of this.reactor.root.getChildMeshes()) sg.addShadowCaster(m);
      this.kit.shadowSink = (m) => sg.addShadowCaster(m);
    }
    this.enemies = new EnemyManager(scene, this.kit, this.pal);
    this.turrets = new TurretManager(scene, this.kit, this.pal);
    this.construction = new Construction(scene, this.kit, this.pal, ARENA);

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

    this.waves = new WaveManager({
      spawn: (s, w) => this.enemies.spawn(s.kind, s.gate, ARENA, w.hpMult, w.damageMult),
      aliveCount: () => this.enemies.count,
      onWaveStart: (w) => {
        sfx.play('waveStart');
        uiEvents.emit('banner', { title: `WAVE ${w.number}`, sub: `${w.spawns.length} hostiles inbound`, tone: 'orange' });
      },
      onWaveCleared: (w) => {
        this.wallet.earn(w.clearReward);
        uiEvents.emit('coresGained', w.clearReward);
        this.reactorHp = Math.min(ECONOMY.reactorMaxHp, this.reactorHp + ECONOMY.reactorMaxHp * ECONOMY.reactorRepairPerWave);
        sfx.play('waveClear');
        uiEvents.emit('banner', { title: `WAVE ${w.number} CLEARED`, sub: `+${w.clearReward} cores · reactor repaired`, tone: 'cyan' });
      },
      onPrepStart: () => {},
    });

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
    this.recomputeStats();
    this.setScreen('menu');
  }

  // ---------------------------------------------------------------- lifecycle

  setScreen(s: Screen): void {
    this.screen = s;
    this.weapon.setVisible(s !== 'menu' && s !== 'loading');
    hudStore.set({ screen: s });
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

  recomputeStats(): void {
    const s = computeStats(this.modifiers);
    Object.assign(this.stats, s);
    this.player.maxHp = ECONOMY.playerMaxHp + s.maxHealthBonus;
  }

  async deploy(): Promise<void> {
    sfx.init();
    await this.input.requestLock();
    this.newRun();
    this.setScreen('playing');
    this.canvas.focus();
  }

  async resume(): Promise<void> {
    sfx.init();
    await this.input.requestLock();
    if (this.input.captured) this.setScreen('playing');
  }

  newRun(): void {
    this.enemies.clear();
    this.turrets.clear();
    this.fx.reset();
    this.player.reset();
    this.weapon.reset();
    this.tactical.reset();
    this.wallet.reset();
    this.modifiers = [];
    this.recomputeStats();
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

  restart(): void {
    sfx.play('ui');
    void this.deploy();
  }

  // ---------------------------------------------------------------- frame

  frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 1 / 20);
    const fps = this.engine.getFps();
    if (Number.isFinite(fps)) this.fpsSmooth += (fps - this.fpsSmooth) * 0.05;
    this.step(dt);
    this.scene.render();
  }

  private step(dt: number): void {
    if (this.screen === 'playing' || this.screen === 'defeat') this.update(dt);
    else this.idleAnimate(dt);
    this.input.endFrame();
  }

  private idleAnimate(dt: number): void {
    const flash = this.updateSky(dt);
    this.post.update(dt, 0, 0, flash);
    this.updateReactor(dt, false);
    for (const a of this.animated) a.node.rotation.addInPlace(a.spin.scale(dt));
    if (this.screen === 'menu') {
      // Slow cinematic orbit behind the menu, low over the deck so reflections read.
      const t = performance.now() * 0.00006;
      const a = 2.45 + Math.sin(t) * 0.35;
      const cam = this.player.camera;
      cam.position.set(Math.sin(a) * 21, 3.4 + Math.sin(t * 1.7) * 0.5, Math.cos(a) * 21);
      cam.setTarget(new Vector3(-6, 5.5, 4));
      cam.fov = 0.9;
    }
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
    }
    if (this.screen === 'defeat' && input.pressed('KeyR')) this.restart();

    this.tactical.update(dt);
    if (!this.tactical.active && this.wasTactical) {
      this.wasTactical = false;
      sfx.play('tacticalOff');
      sfx.setTactical(false);
    }
    const hdt = this.screen === 'defeat' ? dt * 0.15 : dt * this.tactical.hostileScale;

    if (playing) this.runTime += dt;
    this.player.update(dt, input, this.stats.moveSpeedMult, controls);

    // ---- building
    if (this.construction.active) {
      this.construction.update(this.player, this.wallet.cores, this.turrets.turrets, this.stats);
      if (controls && input.mousePressed(0)) this.tryPlace();
    }

    // ---- shooting
    const trigger = controls && input.mouse(0) && !this.construction.active;
    this.weapon.update(dt, trigger, this.stats, this.shoot);
    if (this.weapon.lastShot) this.fx.tracer(this.weapon.lastShot.from, this.weapon.lastShot.to, 0, 0.045, 0.06);

    // ---- inspect / recycle
    this.updateInspect(dt, controls);

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
    this.moon.intensity = 1.5 + flash * 1.6;
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
    if (!c.valid || !this.wallet.spend(SENTINEL.cost)) {
      sfx.play('buildDeny');
      return;
    }
    this.turrets.add(c.point, this.player.yaw);
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
        const refund = Math.round(t.def.cost * t.def.refundRatio);
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

  /** Player hitscan: nearest of level surfaces and enemy hitboxes (turrets are see-through). */
  private shoot = (r: ShotRequest): ShotOutcome => {
    // Hitboxes must reflect this frame's enemy poses, not last frame's render.
    for (const e of this.enemies.active) {
      e.root.computeWorldMatrix(true);
      for (const h of e.hitboxes) h.computeWorldMatrix(true);
    }
    this.shotRay.origin.copyFrom(r.origin);
    this.shotRay.direction.copyFrom(r.dir);
    this.shotRay.length = r.range;
    const hits = this.scene.multiPickWithRay(this.shotRay, (m: AbstractMesh) => (!!m.metadata?.surface || !!m.metadata?.enemy) && m.isEnabled());
    if (!hits || hits.length === 0) return { point: r.origin.add(r.dir.scale(r.range)) };
    hits.sort((a, b) => a.distance - b.distance);
    const first = hits[0];
    const point = first.pickedPoint!.clone();
    const meta = first.pickedMesh!.metadata as Partial<EnemyHitboxMeta> & { surface?: string };
    if (meta.enemy) {
      let weak = !!meta.weak;
      if (!weak) {
        // Weakpoint overlapping the body sphere still counts if the ray passes through it.
        const w = hits.find((h) => (h.pickedMesh!.metadata as EnemyHitboxMeta | null)?.enemy === meta.enemy && (h.pickedMesh!.metadata as EnemyHitboxMeta).weak);
        if (w && w.distance - first.distance < 0.6) weak = true;
      }
      this.damageEnemy('player', meta.enemy, r.damage, point, weak);
    } else {
      const n = first.getNormal(true, true) ?? Vector3.Up();
      this.fx.impact(point.add(n.scale(0.03)), n);
    }
    return { point };
  };

  damageEnemy(source: 'player' | 'turret', e: Enemy, base: number, point: Vector3, weakpoint: boolean, turret?: Turret): void {
    const roll = rollDamage(base, this.stats, weakpoint, Math.random, 'energy', source);
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
      if (kind === 'crit') this.fx.burst('crit', point, 10);
      else if (kind === 'hit') this.fx.burst('enemySpark', point, 6);
      sfx.play(kind === 'kill' ? 'kill' : kind === 'crit' ? 'crit' : kind === 'shield' ? 'shieldHit' : 'hit');
    }
    // Turret numbers far from the player are noise; kills always show.
    if (source === 'player' || kind === 'kill' || Vector3.DistanceSquared(point, this.player.position) < 25 * 25) {
      uiEvents.emit('damageNumber', { x: point.x, y: point.y, z: point.z, amount: Math.round(roll.amount), kind, player: source === 'player' });
    }
  }

  private onEnemyKilled(e: Enemy): void {
    this.kills++;
    this.wallet.earn(e.def.reward);
    uiEvents.emit('coresGained', e.def.reward);
    this.enemies.kill(e, this.fx, this.enemyCtx);
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
    this.reactorLight.intensity = (2.2 + h * 2 + Math.sin(performance.now() * 0.004) * 0.15) * flicker;
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
    }
    if (!this.player.alive || c.active) hint = '';
    hudStore.set({
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
      buildCost: SENTINEL.cost,
      inspect: t ? { name: t.def.name, kills: t.kills, damage: Math.round(t.damageDealt), refund: Math.round(t.def.cost * t.def.refundRatio), recycle: this.recycleT } : null,
      hint,
      spread: 6 + this.weapon.spread * 900,
      perf: this.perfOn
        ? { fps: Math.round(this.fpsSmooth), enemies: this.enemies.count, draws: this.drawCalls, particles: this.fx.particleCount }
        : null,
    });
    void force;
  }

  /** Debug/test surface (used by automated browser checks). */
  debugApi() {
    return {
      game: this,
      state: () => ({
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
      }),
      /** Run the simulation at a fixed 60 Hz for `seconds` without rendering. */
      advance: (seconds: number) => {
        const n = Math.round(seconds * 60);
        for (let i = 0; i < n; i++) this.step(1 / 60);
      },
      /** Stop the free-running render loop (screenshots in slow software GL). */
      stopLoop: () => {
        this.engine.stopRenderLoop();
        // Particles/animations advance a fixed 1/60 s per rendered frame (deterministic captures).
        this.scene.useConstantAnimationDeltaTime = true;
      },
      /** Render `frames` frames without advancing the simulation. */
      render: (frames = 1) => {
        for (let i = 0; i < frames; i++) this.scene.render();
      },
      look: (yaw: number, pitch: number) => {
        this.player.yaw = yaw;
        this.player.pitch = pitch;
      },
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
