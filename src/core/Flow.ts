import { type Engine, type Scene, Vector3 } from '@babylonjs/core';
import { buildWeaponModel } from '../weapons/model';
import { rarity } from '../loot/rarity';
import { generateItem } from '../loot/generate';
import type { RarityId } from '../loot/rarity';
import type { Category, ItemInstance } from '../loot/types';
import { sfx } from '../audio/Sfx';
import { HomeBase } from '../home/HomeBase';
import { newUid, SLOT_IDS } from '../progression/items';
import { Profile } from '../progression/Profile';
import { RunLedger, type RunOutcome } from '../progression/run';
import * as TX from '../economy/transactions';
import type { SaveData } from '../progression/save';
import { equipFromStorage, uninstallModule } from '../progression/save';
import { applyLoadout, bankRewards, beginRun, deployBlocker, equippedItem, recordRun, selectTier } from '../progression/save';
import { getTier } from '../progression/tiers';
import { hudStore, type Location, uiEvents } from '../ui/store';
import { Game } from './Game';
import { Input } from './Input';
import { type Settings, saveSettings } from './settings';

/** A loaded location. Exactly one exists at a time. */
interface World {
  readonly scene: Scene;
  step(dt: number, fps: number): void;
  dispose(): void;
  applySettings(s: Settings): void;
}

const nextPaint = () =>
  new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120); // rAF is paused in background tabs
  });

/**
 * Session controller: owns the engine loop, the single Input instance, the persistent
 * Profile and whichever world is loaded (HQ or arena). Transitions dispose the old
 * Babylon scene completely before building the next, so repeated deploy/return cycles
 * cannot accumulate meshes, textures, physics bodies, observers or update loops.
 *
 * Run lifecycle:
 *   HQ --deploy(tier)--> arena (fresh Game + RunLedger, save.activeRun set)
 *   arena: kills/waves -> unsecured salvage; every 5th cleared wave -> bank -> save
 *   checkpoint prep --returnHome--> record run (returned) -> HQ + summary
 *   reactor destroyed --> record run (defeat, unsecured lost) -> defeat screen -> HQ
 *   pause --abandon--> record run (abandoned, unsecured lost) -> HQ + summary
 */
export class Flow {
  readonly input: Input;
  readonly profile: Profile;
  home: HomeBase | null = null;
  arena: Game | null = null;
  run: RunLedger | null = null;
  location: Location = 'home';
  busy = false;
  /** True while the old scene is being torn down and the next built (nothing to render). */
  private building = false;
  transitions = 0;
  /** Timing of the most recent scene swap (profiling aid, also shown in automation). */
  lastTransition: { disposeMs: number; buildMs: number; readyMs: number; timedOut: boolean } | null = null;
  private loopStopped = false;
  private renderQuality: Settings['quality'];

  constructor(
    readonly engine: Engine,
    readonly canvas: HTMLCanvasElement,
    private havok: unknown,
    public settings: Settings,
  ) {
    this.renderQuality = settings.quality;
    this.input = new Input(canvas);
    this.profile = new Profile();
  }

  get world(): World | null {
    return this.arena ?? this.home;
  }

  resize(): void {
    const cinematic = this.renderQuality === 'high';
    const { clientWidth, clientHeight } = this.canvas;
    const pixels = Math.max(1, clientWidth * clientHeight);
    // Keep HiDPI output sharp while bounding the cost of the full-resolution G-buffer and HDR passes.
    const pixelBudget = cinematic ? 2560 * 1440 : 1920 * 1080;
    const scale = Math.min(cinematic ? Math.min(window.devicePixelRatio || 1, 2) : 1, Math.sqrt(pixelBudget / pixels));
    this.engine.setHardwareScalingLevel(1 / scale);
  }

  /** Build the HQ behind the title screen. */
  boot(): void {
    this.buildHome();
    this.home!.setScreen('menu');
    const st = this.profile.loadStatus;
    if (st === 'restored-backup' || st === 'reset-corrupt') {
      setTimeout(
        () =>
          uiEvents.emit('banner', {
            title: st === 'restored-backup' ? 'SAVE RESTORED FROM BACKUP' : 'SAVE DATA UNREADABLE',
            sub: st === 'restored-backup' ? 'The latest save was damaged; the previous one was loaded.' : 'A fresh profile was created. The damaged data was kept aside.',
            tone: 'orange',
          }),
        600,
      );
    }
  }

  frame(): void {
    const w = this.world;
    if (!w || this.building) return;
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 1 / 20);
    // While a new scene warms up behind the transit overlay it renders but does not simulate.
    if (!this.busy) w.step(dt, this.engine.getFps());
    w.scene.render();
    this.input.endFrame();
  }

  applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    saveSettings(s);
    this.world?.applySettings(s);
    // Graphics quality is applied when a scene is built: rebuild the HQ right away.
    if (qualityChanged && this.home && !this.busy) {
      const screen = this.home.screen;
      this.buildHome();
      this.home!.setScreen(screen);
    }
  }

  // ------------------------------------------------------------------ HQ

  async enterHq(): Promise<void> {
    if (!this.home || this.busy) return;
    sfx.init();
    sfx.play('ui');
    await this.home.takeControl();
  }

  selectTier(tier: number): boolean {
    return this.profile.mutate((d) => selectTier(d, tier));
  }

  // ------------------------------------------------------------------ runs

  /** Start a fresh run on the selected tier. Callable from HQ or after a defeat. */
  async deploy(tierId = this.profile.save.threat.selected): Promise<boolean> {
    if (this.busy || (this.run && !this.run.ended)) return false;
    const save = this.profile.save;
    if (tierId < 1 || tierId > save.threat.unlocked) return false;
    if (deployBlocker(save)) return false;
    // The arena gets its own copies: run-side changes can never touch profile objects.
    const loadout = Object.fromEntries(SLOT_IDS.map((slot) => [slot, structuredClone(equippedItem(save, slot))]));
    sfx.init();
    sfx.play('ui');
    // Request pointer lock inside the click gesture; the canvas keeps it across scenes.
    void this.input.requestLock();
    const tier = getTier(tierId);
    const runId = newUid('run');
    this.profile.mutate((d) => {
      selectTier(d, tierId);
      beginRun(d, runId, tierId);
    });
    await this.transition(`DEPLOYING · THREAT TIER ${tier.roman}`, `Sector 07 reactor · ${tier.name}`, () => {
      const run = new RunLedger(runId, tierId, Date.now());
      this.run = run;
      this.renderQuality = this.settings.quality;
      this.resize();
      this.arena = new Game(this.engine, this.canvas, this.havok, this.settings, this.input, {
        tier,
        loadout,
        run,
        hooks: {
          // Reported as secured only once the write succeeded.
          bank: (wave, rewards) => this.profile.mutate((d) => bankRewards(d, run.id, wave, rewards)) && this.profile.lastWriteOk,
          checkpoint: () => {},
          defeat: () => this.endRun('defeat'),
        },
      });
      this.location = 'arena';
      return this.arena.scene;
    });
    this.arena!.start();
    return true;
  }

  /** Record the current run exactly once and publish its result. */
  private endRun(outcome: RunOutcome) {
    const run = this.run;
    if (!run) return null;
    const first = !run.ended;
    const result = run.finalize(outcome);
    // Record the run, then let the profile adopt the run loadout for items it owns
    // (unsecured items were just lost, so their slots keep the previous secured gear).
    const owned = this.arena?.inventory.ownedLoadout() ?? {};
    if (first)
      this.profile.mutate((d) => {
        const recorded = recordRun(d, result);
        applyLoadout(d, owned, { ignoreActiveRun: true });
        return recorded;
      });
    hudStore.set({ lastRun: { ...result } });
    return result;
  }

  /** Checkpoint extraction: secured rewards are already in the save. */
  async returnHome(): Promise<boolean> {
    const a = this.arena;
    if (this.busy || !a || !a.canReturnHome) return false;
    sfx.play('ui');
    this.endRun('returned');
    await this.toHome('summary');
    return true;
  }

  /** Pause-menu forfeit: unsecured rewards are lost, secured ones stay banked. */
  async abandonRun(): Promise<boolean> {
    if (this.busy || !this.arena || !this.run || this.run.ended) return false;
    this.endRun('abandoned');
    await this.toHome('summary');
    return true;
  }

  /** From the defeat screen. */
  async leaveArena(): Promise<boolean> {
    if (this.busy || !this.arena || !this.run?.ended) return false;
    sfx.play('ui');
    void this.input.requestLock();
    await this.toHome('control');
    return true;
  }

  /** Defeat screen shortcut: fresh run on the same tier. */
  async redeploy(): Promise<boolean> {
    if (this.busy || !this.run?.ended) return false;
    return this.deploy(this.run.tier);
  }

  private async toHome(then: 'summary' | 'control'): Promise<void> {
    await this.transition('RETURNING TO HQ', 'Drone recovery in progress', () => {
      this.buildHome(true);
      this.location = 'home';
      return this.home!.scene;
    });
    this.run = null;
    if (then === 'summary') this.home!.setScreen('summary');
    else await this.home!.takeControl(false);
  }

  // ------------------------------------------------------------------ scenes

  private disposeWorld(): void {
    this.arena?.dispose();
    this.arena = null;
    this.home?.dispose();
    this.home = null;
    hudStore.set({ prompt: null, terminal: null, run: null, perf: null, hint: '' });
  }

  private buildHome(skipDispose = false): void {
    if (!skipDispose) this.disposeWorld();
    this.renderQuality = this.settings.quality;
    this.resize();
    this.home = new HomeBase(this.engine, this.canvas, this.havok, this.settings, this.input, this.profile, {
      deploy: () => void this.deploy(),
    });
    if (this.loopStopped) this.home.scene.useConstantAnimationDeltaTime = true;
  }

  /**
   * Swap worlds behind the transit overlay: paint the overlay, dispose the old scene,
   * build the next one, wait until its shaders are ready (bounded), then reveal.
   */
  private async transition(title: string, sub: string, build: () => Scene): Promise<void> {
    this.busy = true;
    hudStore.set({ screen: 'transit', transit: { title, sub } });
    try {
      await nextPaint();
      const t0 = performance.now();
      this.building = true;
      this.disposeWorld();
      const t1 = performance.now();
      const scene = build();
      this.building = false;
      if (this.loopStopped) scene.useConstantAnimationDeltaTime = true;
      this.transitions++;
      const t2 = performance.now();
      const ready = await Promise.race([
        Promise.all([scene.whenReadyAsync(), this.arena?.loot.warmup]).then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
      ]);
      this.lastTransition = { disposeMs: Math.round(t1 - t0), buildMs: Math.round(t2 - t1), readyMs: Math.round(performance.now() - t2), timedOut: !ready };
    } finally {
      this.building = false;
      this.busy = false;
      hudStore.set({ transit: null });
    }
  }

  // ------------------------------------------------------------------ automation

  /** Debug/test surface (window.__rift in ?test mode). */
  debugApi() {
    const flow = this;
    const stepOnce = () => {
      const w = flow.world;
      if (!w || flow.busy) return;
      w.step(1 / 60, 60);
      flow.input.endFrame();
    };
    return {
      flow,
      profile: this.profile,
      get game() {
        return flow.arena;
      },
      get home() {
        return flow.home;
      },
      state: () => ({
        ...(flow.arena ? flow.arena.snapshot() : flow.home ? flow.home.snapshot() : {}),
        location: flow.location,
        screen: hudStore.get().screen,
        busy: flow.busy,
        transitions: flow.transitions,
        salvage: flow.profile.save.resources.salvage,
        tierSelected: flow.profile.save.threat.selected,
        tierUnlocked: flow.profile.save.threat.unlocked,
        runs: flow.profile.save.totals.runs,
        activeRun: flow.profile.save.activeRun?.id ?? null,
      }),
      /** Run the simulation at a fixed 60 Hz for `seconds` without rendering. */
      advance: (seconds: number) => {
        const n = Math.round(seconds * 60);
        for (let i = 0; i < n; i++) stepOnce();
      },
      stopLoop: () => {
        flow.engine.stopRenderLoop();
        flow.loopStopped = true;
        if (flow.world) flow.world.scene.useConstantAnimationDeltaTime = true;
      },
      render: (frames = 1) => {
        for (let i = 0; i < frames; i++) flow.world?.scene.render();
      },
      look: (yaw: number, pitch: number) => {
        const p = flow.arena?.player ?? flow.home?.player;
        if (p) {
          p.yaw = yaw;
          p.pitch = pitch;
        }
      },
      /** Kill every active enemy through the real damage pipeline (salvage, kills, feedback). */
      killAll: () => {
        const a = flow.arena;
        if (!a) return 0;
        const list = [...a.enemies.active];
        for (const e of list) a.damageEnemy('player', e, 1e6, e.center(), false);
        return list.length;
      },
      /** Move the player (arena or HQ) to x/z on the floor. */
      teleport: (x: number, z: number, y = 1) => {
        const p = flow.arena?.player ?? flow.home?.player;
        if (!p) return;
        p.controller.setPosition(new Vector3(x, y, z));
        p.controller.setVelocity(Vector3.Zero());
      },
      /** Spawn a generated drop at x/z (arena). Returns the item uid. */
      spawnLoot: (o: { x?: number; z?: number; rarity?: RarityId; category?: Category; baseId?: string; level?: number; seed?: number } = {}) => {
        const a = flow.arena;
        if (!a) return null;
        const item = generateItem({
          uid: `${a.cfg.run.id}.dbg${Math.floor(Math.random() * 1e9)}`,
          seed: o.seed ?? Math.floor(Math.random() * 4294967296),
          level: o.level ?? a.waves.number + a.cfg.tier.lootLevelBonus,
          rarity: o.rarity ?? 'rare',
          category: o.category ?? 'weapon',
          baseId: o.baseId,
          allowExclusive: o.baseId ? [o.baseId] : [],
          source: a.cfg.run.id,
        });
        const p = a.spawnPickup(item, new Vector3(o.x ?? 0, 1.5, o.z ?? -12), a.waves.number);
        return p ? item.uid : null;
      },
      /** Generate an item without placing it (tests search seeds for specific affixes). */
      makeItem: (o: { seed: number; rarity?: RarityId; category?: Category; baseId?: string; level?: number; fixedRoll?: number }) =>
        generateItem({ uid: `dbg_${o.seed}_${Math.floor(Math.random() * 1e9)}`, seed: o.seed, level: o.level ?? 5, rarity: o.rarity ?? 'rare', category: o.category, baseId: o.baseId, source: flow.arena?.cfg.run.id ?? 'debug', fixedRoll: o.fixedRoll }),
      /** Put an item straight into the run cargo (as if picked up). */
      grant: (item: ReturnType<typeof generateItem>) => {
        const a = flow.arena;
        if (!a || !a.inventory.collect(item)) return false;
        a.inventoryVersion++;
        return true;
      },
      /** Damage the reactor through the real path (defeat when it reaches 0). */
      damageReactor: (amount: number) => flow.arena?.debugDamageReactor(amount),
      /** Pickups currently in the arena (id, uid, rarity, distance to the player, landed). */
      pickups: () => {
        const a = flow.arena;
        if (!a) return [];
        const pp = a.player.position;
        return a.loot.pickups.map((p) => ({ id: p.id, uid: p.item.uid, name: p.item.name, rarity: p.item.rarity, category: p.item.category, droppedWave: p.droppedWave, x: p.ground.x, z: p.ground.z, dist: Math.hypot(p.ground.x - pp.x, p.ground.z - pp.z), landed: a.loot.landed(p), expiring: p.expiring }));
      },
      /** Stand next to a pickup and face its hologram. */
      approach: (id: number) => {
        const a = flow.arena;
        const p = a?.loot.pickups.find((q) => q.id === id);
        if (!a || !p) return false;
        const pl = a.player;
        const x = p.ground.x;
        const z = p.ground.z - 2;
        pl.controller.setPosition(new Vector3(x, p.ground.y + 1, z));
        pl.controller.setVelocity(Vector3.Zero());
        pl.yaw = Math.atan2(p.focus.x - x, p.focus.z - z);
        pl.pitch = 0.05;
        return true;
      },
      /**
       * Visual QA: show weapon models for `items` in front of the camera (rendering group 1),
       * stacked vertically, 3/4 side view. Returns a disposer.
       */
      lab: (items: ItemInstance[], o: { yaw?: number; pitch?: number; scale?: number; spacing?: number; x?: number } = {}) => {
        const sc = flow.world?.scene;
        const cam = sc?.activeCamera;
        if (!sc || !cam) return null;
        const rigs = items.map((it, i) => {
          const rig = buildWeaponModel(sc, it.build!, it.socketed, { renderingGroupId: 1, name: 'lab', mount: false }, rarity(it.rarity).index);
          rig.root.parent = cam;
          const sp = o.spacing ?? 0.3;
          rig.root.position.set(o.x ?? 0, ((items.length - 1) / 2 - i) * sp - 0.04, 1.25);
          rig.root.rotation.set(o.pitch ?? 0.12, -Math.PI / 2 + (o.yaw ?? 0.45), 0);
          rig.root.scaling.setAll(o.scale ?? 1);
          rig.root.position.x -= ((rig.front + rig.rear) / 2) * (o.scale ?? 1) * 0;
          return rig;
        });
        if (flow.arena) flow.arena.weapon.setVisible(false);
        document.body.classList.add('lab');
        return () => rigs.forEach((r) => r.dispose());
      },
      /**
       * M4 economy: run a transaction from economy/transactions.ts through Profile.transact
       * (validated, persisted, rolled back on failed writes), e.g. econ('buyItem', 'equipment', id).
       */
      econ: (name: keyof typeof TX, ...args: unknown[]) => {
        const fn = TX[name] as unknown as (d: SaveData, ...a: unknown[]) => { ok: boolean };
        return flow.profile.transact((d) => fn(d, ...args));
      },
      econPure: TX,
      equipFromStorage,
      uninstallModule,
      /** Resource counters for leak checks across transitions. */
      leakStats: () => {
        const sc = flow.world?.scene;
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return {
          scenes: flow.engine.scenes.length,
          textures: flow.engine.getLoadedTexturesCache().length,
          meshes: sc?.meshes.length ?? 0,
          materials: sc?.materials.length ?? 0,
          lights: sc?.lights.length ?? 0,
          particleSystems: sc?.particleSystems.length ?? 0,
          postProcesses: sc?.postProcesses.length ?? 0,
          hudListeners: hudStore.listenerCount,
          uiListeners: uiEvents.listenerCount(),
          profileListeners: flow.profile.store.listenerCount,
          heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        };
      },
    };
  }
}
