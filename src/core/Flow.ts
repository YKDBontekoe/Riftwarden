import { type Engine, type Scene, Vector3 } from '@babylonjs/core';
import { buildWeaponModel } from '../weapons/model';
import { rarity } from '../loot/rarity';
import { generateUnique, uniqueDef } from '../loot/uniques';
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
import { applyLoadout, bankRewards, beginRun, deployBlocker, equippedItem, itemByUid, recordRun, resolveInterruptedRun, selectTier } from '../progression/save';
import { fitsSlot } from '../progression/items';
import { MapSession } from './mapSession';
import { findNode, type MapNode, mapSeedFor } from '../runmap/map';
import { NODE_KINDS } from '../runmap/defs';
import { newMapState, resumable } from '../runmap/state';
import { type RunCarry, sanitizeCarry } from '../runmap/carry';
import { nodeBrief } from '../runmap/brief';
import { getTier, THREAT_TIERS, type ThreatTier } from '../progression/tiers';
import { hudStore, type Location, uiEvents } from '../ui/store';
import type { DevTools } from '../arena/DevTools';
import { type ArenaConfig, Game } from './Game';
import { SurvivalPlanner } from '../survival/plan';
import { tutorialActive } from '../progression/tutorial';
import { Input } from './Input';
import { ClientGame } from '../net/ClientGame';
import { NetClient } from '../net/NetClient';
import type { RunStart } from '../net/protocol';
import type { RunResult } from '../progression/run';
import { keyRemap, type Settings, saveSettings } from './settings';
import { FrameClock } from './frameClock';
import { hashRunSeed } from '../roguelite/upgrades';
import { generateArena } from '../world/arenaGen';
import { ARENA, type ArenaLayout } from '../world/layout';
import type { TransitInfo } from '../ui/store';
import { setRarityPalette } from '../loot/rarity';

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
/** Debug ids/seeds from the browser's CSPRNG (Web Crypto; `crypto` from Node is not available in the bundle). */
const randomU32 = (): number => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];

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
  /** Debug/test: seed for the next run's upgrade offers (cleared once used). */
  nextUpgradeSeed: number | null = null;
  /** Arena for solo runs: a new procedural sector per run, or the hand-built classic arena (legacy suites). */
  arenaMode: 'procedural' | 'classic' = 'procedural';
  /** Automation: force the next procedural arena seed. */
  nextArenaSeed: number | null = null;

  /** Arena seed for a run (0 = classic). Independent of the upgrade/planner seed. */
  arenaSeedFor(runId: string): number {
    if (this.arenaMode === 'classic') return 0;
    if (this.nextArenaSeed !== null) return this.nextArenaSeed >>> 0 || 1;
    return ((hashRunSeed(runId) ^ 0x2545f491) >>> 0) || 1;
  }

  /** Layout for an arena seed (0 = classic). */
  static layoutFor(seed: number): ArenaLayout {
    return seed ? generateArena(seed) : ARENA;
  }
  /** Automation: legacy suites skip the mandatory upgrade screen. */
  skipUpgrades = false;
  /** M6: development tools available (URL ?dev or ?test). Never shown in the ordinary player experience. */
  devTools = false;
  private renderQuality: Settings['quality'];
  /** M7: walking the lobby host's headquarters (co-op visit). */
  visiting = false;
  private presenceT = 0;

  /** Visit (or leave) the lobby host's HQ. Guests see the host's layout read-only and use their own terminals. */
  async visitHostHq(on: boolean): Promise<void> {
    const net = this.net;
    if (!net || this.busy || this.location !== 'home') return;
    if (on) {
      net.store.set({ hostHq: null });
      net.send({ t: 'visit', on: true });
      for (let i = 0; i < 40 && !net.state.hostHq; i++) await new Promise((r) => setTimeout(r, 50));
      if (!net.state.hostHq) return;
    } else net.send({ t: 'visit', on: false });
    this.visiting = on;
    await this.transition(on ? 'VISITING HOST HQ' : 'RETURNING TO YOUR HQ', on ? 'Co-op lobby · read-only headquarters' : 'Own headquarters', () => {
      this.buildHome(true);
      this.location = 'home';
      return this.home!.scene;
    }, { kind: on ? 'visit' : 'hq' });
    await this.home!.takeControl(false);
  }

  /** Automation: show onboarding even in ?test mode. */
  forceTutorial = false;
  /** M7 co-op session (null = single player). */
  net: NetClient | null = null;
  /** Co-op run in progress (server run id). */
  coopRun: RunStart | null = null;
  private netQueue: { snaps: Record<string, unknown>[]; events: unknown[][] } = { snaps: [], events: [] };

  constructor(
    readonly engine: Engine,
    readonly canvas: HTMLCanvasElement,
    private havok: unknown,
    public settings: Settings,
  ) {
    this.renderQuality = settings.quality;
    this.input = new Input(canvas);
    applyGlobalSettings(settings, this.input);
    this.profile = new Profile();
    // Ctrl slides: Ctrl+W (close tab) cannot be intercepted outside fullscreen keyboard lock, so a run asks first.
    window.addEventListener('beforeunload', (e) => {
      if (!this.arena || this.input.forceCapture) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  get world(): World | null {
    return this.arena ?? this.home;
  }

  resize(): void {
    const q = this.renderQuality;
    const { clientWidth, clientHeight } = this.canvas;
    const pixels = Math.max(1, clientWidth * clientHeight);
    // Render at the display's native resolution (device pixel ratio) so ultrawide and HiDPI screens stay sharp,
    // bounding the cost of the HDR passes per preset. The render-scale setting still applies on top.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ratio = q === 'low' ? 1 : dpr;
    const pixelBudget = q === 'high' ? 3840 * 2160 : q === 'medium' ? 3440 * 1440 : 1920 * 1080;
    const scale = Math.min(ratio, Math.sqrt(pixelBudget / pixels)) * (this.settings.renderScale ?? 1);
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

  /** Smoothed frame delta (jitter filter; hitches still clamp to 1/20 s). */
  private readonly clock = new FrameClock(1 / 20);

  frame(): void {
    const w = this.world;
    if (!w || this.building) return;
    const dt = this.clock.next(this.engine.getDeltaTime() / 1000);
    this.coopPresence(dt);
    // While a new scene warms up behind the transit overlay it renders but does not simulate.
    if (!this.busy) w.step(dt, this.engine.getFps());
    // Warm the HQ and its reflections once behind the opaque title artwork.
    if (w !== this.home || this.home.screen !== 'menu' || !w.scene.environmentTexture || this.busy) w.scene.render();
    this.input.endFrame();
  }

  applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality || s.shadows !== this.settings.shadows;
    this.settings = s;
    saveSettings(s);
    applyGlobalSettings(s, this.input);
    this.resize();
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
    return this.profile.op('selectTier', [tier]).ok;
  }

  // ------------------------------------------------------------------ runs

  /** Start a fresh run on the selected tier. Callable from HQ or after a defeat. Map runs may name an entry node. */
  async deploy(tierId = this.profile.save.threat.selected, entryNode?: string): Promise<boolean> {
    if (this.busy || (this.run && !this.run.ended)) return false;
    // Online profiles deploy through the co-op lobby only (the server owns their progression).
    if (this.profile.online) return false;
    const save = this.profile.save;
    if (tierId < 1 || (tierId > save.threat.unlocked && !this.devNext) || tierId > THREAT_TIERS.length) return false;
    if (deployBlocker(save)) return false;
    // The arena gets its own copies: run-side changes can never touch profile objects.
    const loadout = Object.fromEntries(SLOT_IDS.map((slot) => [slot, structuredClone(equippedItem(save, slot))]));
    sfx.init();
    sfx.play('ui');
    // Request pointer lock inside the click gesture; the canvas keeps it across scenes.
    void this.input.requestLock();
    const tier = getTier(tierId);
    const runId = this.pendingRunId ?? newUid('run');
    this.pendingRunId = null;
    const mapSeed = this.mapMode ? Flow.mapSeedOf(runId) : 0;
    this.profile.mutate((d) => {
      if (!this.devNext) selectTier(d, tierId);
      beginRun(d, runId, tierId, Date.now(), { mapSeed });
    });
    const run = new RunLedger(runId, tierId, Date.now());
    this.run = run;
    if (this.devNext) run.survival.dev = true;
    if (mapSeed) {
      this.map = new MapSession(this.profile, run, structuredClone(this.profile.save.activeRun!.map!), loadout);
      await this.playNode(this.map.entry(entryNode), null);
      return true;
    }
    this.map = null;
    const layout = Flow.layoutFor(this.arenaSeedFor(runId));
    await this.launchArena(`DEPLOYING · THREAT TIER ${tier.roman}`, `${layout.name ?? 'Sector 07 reactor'} · ${tier.name}`, layout, tier, { loadout });
    return true;
  }

  /** Map seed of a run id (the HQ previews it before deploying). */
  static mapSeedOf(runId: string): number {
    return mapSeedFor(hashRunSeed(runId));
  }

  /** Map seed the next deployment will use (HQ preview). */
  mapSeedPreview(): number {
    return Flow.mapSeedOf(this.previewRunId());
  }

  /** Co-op map screen: vote for a node (or 'home' to extract). */
  mapVote(choice: string): void {
    if (this.arena instanceof ClientGame) this.arena.mapVote(choice);
  }

  /** Run id the next deployment will use (so the HQ can preview its map). Map runs only. */
  previewRunId(): string {
    return (this.pendingRunId ??= newUid('run'));
  }
  private pendingRunId: string | null = null;
  /** Co-op run map (what the replica knows about the team's path). */
  coopMap: { seed: number; path: string[]; cleared: number; acts: number } | null = null;
  /** Run map session of the current solo run (null = classic endless run). */
  map: MapSession | null = null;
  /** Solo runs use the branching run map (?test defaults to the classic endless flow; ?map opts in). */
  mapMode = true;

  /** Build one arena for the current run ledger (classic runs and every map node). */
  private async launchArena(title: string, sub: string, layout: ArenaLayout, tier: ThreatTier, extra: Partial<ArenaConfig> & Pick<ArenaConfig, 'loadout'>, players?: number): Promise<void> {
    const run = this.run!;
    const save = this.profile.save;
    await this.transition(title, sub, () => {
      this.renderQuality = this.settings.quality;
      this.resize();
      this.arena = new Game(this.engine, this.canvas, this.havok, this.settings, this.input, {
        tier,
        run,
        seed: this.nextUpgradeSeed ?? undefined,
        towerTech: [...save.towers.unlocked],
        milestones: [...save.milestones],
        tree: { seed: save.progress.tree.seed, allocated: [...save.progress.tree.allocated] },
        layout,
        tutorial: this.tutorialHost(),
        hooks: {
          // Reported as secured only once the write succeeded.
          // Development sessions (M6 dev tools used) never commit permanent rewards.
          bank: (wave, rewards) => !run.survival.dev && this.profile.mutate((d) => bankRewards(d, run.id, wave, rewards, { bosses: run.survival.bossesKilled })) && this.profile.lastWriteOk,
          checkpoint: () => {},
          defeat: () => this.endRun('defeat'),
          mapOpened: () => this.publishMap(),
          actCleared: () => this.map?.actCleared(),
        },
        ...extra,
      });
      this.arena.devTools = this.devTools;
      this.arena.skipUpgrades = this.skipUpgrades || !!(globalThis as { __skipUpgrades?: boolean }).__skipUpgrades;
      this.location = 'arena';
      return this.arena.scene;
    }, { kind: 'arena', sector: { name: layout.name ?? 'Sector 07 Reactor', code: layout.code ?? 'CLASSIC', layout, tier: tier.roman, tierName: tier.name, players, node: extra.node ? nodeBrief(extra.node.node, run.wavesCleared) : undefined } });
    this.arena!.start();
  }

  /** Enter a map node: a fresh arena for its sector with the carried run state. */
  private async playNode(node: MapNode, carry: RunCarry | null): Promise<void> {
    const map = this.map!;
    const run = this.run!;
    const base = getTier(run.tier);
    const { tier, setup } = map.configFor(node, carry, base);
    map.entered(node);
    const layout = Flow.layoutFor(this.arenaMode === 'classic' ? 0 : node.seed);
    const kind = NODE_KINDS[node.kind];
    const save = this.profile.save;
    const tech = [...new Set([...save.towers.unlocked, ...(carry?.runTech ?? [])])];
    const title = `ACT ${node.act} · ${node.actBoss ? 'ACT BOSS' : kind.name.toUpperCase()} · TIER ${base.roman}`;
    await this.launchArena(title, `${layout.name ?? 'Sector 07 reactor'} · ${kind.blurb}`, layout, tier, { loadout: map.carried, node: setup, towerTech: tech });
  }

  /** Map screen: travel to a reachable node (banks what the current node still holds, then swaps arenas). */
  async travel(nodeId: string): Promise<boolean> {
    const a = this.arena;
    const map = this.map;
    if (this.busy || !a || !map || !a.canReturnHome || this.coopRun) return false;
    const next = map.reachable().find((n) => n.id === nodeId);
    if (!next) return false;
    sfx.play('ui');
    void this.input.requestLock();
    const carry = map.leave(a, next.id);
    await this.playNode(next, carry);
    return true;
  }

  /** Resume a run closed after a completed node: the chosen next node starts over with the stored carry. */
  async resumeRun(): Promise<boolean> {
    if (this.busy || this.profile.online || (this.run && !this.run.ended)) return false;
    const a = this.profile.save.activeRun;
    const m = a?.map;
    if (!a || !m || !resumable(m) || deployBlocker(this.profile.save)) return false;
    const next = findNode(m.seed, m.next!);
    if (!next) return false;
    sfx.init();
    sfx.play('ui');
    void this.input.requestLock();
    const run = new RunLedger(a.id, a.tier, a.startedAt);
    if (m.ledger) run.restore(m.ledger);
    this.run = run;
    const save = this.profile.save;
    // Run gear banked into the save is now profile-owned: it deploys as carried gear.
    const loadout = Object.fromEntries(SLOT_IDS.map((slot) => {
      const uid = m.carry!.loadout[slot];
      const it = (uid && itemByUid(save, uid)) || equippedItem(save, slot);
      return [slot, it && fitsSlot(it, slot) ? structuredClone(it) : null];
    }));
    this.map = new MapSession(this.profile, run, structuredClone(m), loadout, a.nodeBank ?? 0);
    await this.playNode(next, m.carry);
    return true;
  }

  /** End a suspended (resumable) run from the HQ: recorded as interrupted, banked rewards stay. */
  endSuspendedRun(): boolean {
    if (this.run && !this.run.ended) return false;
    return !!this.profile.mutate((d) => resolveInterruptedRun(d) !== null);
  }

  /** Publish the map screen's view of the current run. */
  publishMap(): void {
    if (this.map) hudStore.set({ runMap: this.map.view(this.arena) });
  }

  /** Record the current run exactly once and publish its result. */
  private endRun(outcome: RunOutcome) {
    const run = this.run;
    if (!run) return null;
    const first = !run.ended;
    if (first) this.arena?.syncStats();
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

  /** Development: deploy on any tier, marked as a development session (no records, no banking, unlocks untouched). */
  devDeploy(tierId: number): Promise<boolean> {
    if (tierId < 1 || tierId > THREAT_TIERS.length) return Promise.resolve(false);
    this.devNext = true;
    return this.deploy(tierId).finally(() => (this.devNext = false));
  }
  private devNext = false;

  /** Checkpoint extraction: secured rewards are already in the save. */
  async returnHome(): Promise<boolean> {
    const a = this.arena;
    if (this.busy || !a || !a.canReturnHome || this.coopRun) return false;
    sfx.play('ui');
    // Map runs bank what the node still holds and count it before extracting.
    this.map?.leave(a, null);
    this.endRun('returned');
    this.map = null;
    await this.toHome('summary');
    return true;
  }

  /** Pause-menu forfeit: unsecured rewards are lost, secured ones stay banked. */
  async abandonRun(): Promise<boolean> {
    if (this.coopRun && this.net) {
      // Leaving a co-op operation: the server records it (secured rewards stay) and the team continues.
      this.net.send({ t: 'leave' });
      return true;
    }
    if (this.busy || !this.arena || !this.run || this.run.ended) return false;
    this.endRun('abandoned');
    this.map = null;
    await this.toHome('summary');
    return true;
  }

  /** From the defeat screen. */
  async leaveArena(): Promise<boolean> {
    if (this.coopRun) return false;
    if (this.busy || !this.arena || !this.run?.ended) return false;
    sfx.play('ui');
    void this.input.requestLock();
    await this.toHome('control');
    return true;
  }

  /** Defeat screen shortcut: fresh run on the same tier. */
  async redeploy(): Promise<boolean> {
    if (this.busy || !this.run?.ended) return false;
    this.map = null;
    return this.deploy(this.run.tier);
  }

  private async toHome(then: 'summary' | 'control'): Promise<void> {
    await this.transition('RETURNING TO HQ', 'Drone recovery in progress', () => {
      this.buildHome(true);
      this.location = 'home';
      return this.home!.scene;
    }, { kind: 'hq' });
    this.run = null;
    if (then === 'summary') this.home!.setScreen('summary');
    else await this.home!.takeControl(false);
  }

  /** Onboarding persistence (the profile op validates and saves each completed step). */
  private tutorialHost() {
    return {
      done: () => this.profile.save.tutorial.done,
      active: () => (this.forceTutorial || (!this.skipUpgrades && !this.devTools)) && tutorialActive(this.profile.save),
      mark: (id: string) => void this.profile.op('tutorialStep', [id]),
      skip: () => void this.profile.op('tutorialSkip', []),
    };
  }

  // ------------------------------------------------------------------ M7 co-op

  /** Connect to the co-op server (identity is a local secret; the server stores only its hash). */
  async coopConnect(name?: string, url?: string): Promise<boolean> {
    if (!this.net) {
      this.net = new NetClient(url);
      this.wireNet(this.net);
    } else if (url) this.net.url = url;
    if (name) this.net.setName(name);
    sfx.init();
    return this.net.connect();
  }

  /** Lobby presence: publish our HQ position, show the others who share this HQ (10 Hz). */
  coopPresence(dt: number): void {
    const net = this.net;
    if (!net || !this.home || this.location !== 'home' || this.busy) return;
    // The session ended or we became the host: go back to our own HQ.
    const lobby = net.state.lobby;
    if (this.visiting && (!lobby || lobby.hostId === net.state.playerId || net.state.status !== 'online')) {
      void this.visitHostHq(false);
      return;
    }
    if (!lobby) return;
    this.presenceT -= dt;
    if (this.presenceT > 0) return;
    this.presenceT = 0.1;
    const p = this.home.player.position;
    net.send({ t: 'presence', p: [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100], yaw: Math.round(this.home.player.yaw * 1000) / 1000 });
    const host = lobby.hostId === net.state.playerId;
    this.home.setPresence(host || this.visiting ? net.state.presence : []);
  }

  private wireNet(net: NetClient): void {
    net.handlers = {
      welcome: (m) => {
        if (m.hasProfile && m.profile) this.adoptOnline(m.profile);
      },
      profile: (save) => this.adoptOnline(save),
      opResult: (m) => {
        if (!m.ok) uiEvents.emit('banner', { title: 'SERVER REFUSED', sub: m.reason ?? 'Operation rejected', tone: 'red' });
      },
      runStart: (run) => void this.coopRunStart(run),
      hostHq: () => {
        if (this.visiting && this.home && this.location === 'home' && !this.busy) this.home.applyHostBase();
      },
      snap: (s) => {
        if (this.arena instanceof ClientGame && !this.busy) this.arena.onSnapshot(s);
        else if (this.coopRun) this.netQueue.snaps = [s];
      },
      events: (e) => {
        if (this.arena instanceof ClientGame && !this.busy) this.arena.onEvents(e);
        else if (this.coopRun) this.netQueue.events.push(...e);
      },
      runEnd: (result, save) => void this.coopRunEnd(result as RunResult, save),
      lost: () => {
        if (this.coopRun) uiEvents.emit('banner', { title: 'CONNECTION LOST', sub: 'Reconnecting… your run slot is held for two minutes', tone: 'orange' });
      },
      error: (code, msg) => {
        if (code !== 'malformed') uiEvents.emit('alert', { text: msg.toUpperCase(), tone: 'orange' });
      },
    };
  }

  /** Mirror the server-owned profile (the single-player save is kept aside, untouched). */
  private adoptOnline(save: unknown): void {
    const first = !this.profile.online;
    if (first) this.profile.attachRemote({ send: (name, args, tx) => this.net?.send({ t: 'op', name, args, tx }), label: this.net?.url ?? '' }, save);
    else this.profile.adoptRemote(save);
    if (first && this.home && !this.busy && this.location === 'home') this.rebuildHomeKeepScreen();
  }

  coopProfileInit(): void {
    this.net?.send({ t: 'profileInit' });
  }

  /** Disconnect and return to the single-player profile. */
  coopDisconnect(): void {
    if (this.coopRun) return;
    this.net?.close();
    if (this.profile.online) {
      this.profile.detachRemote();
      if (this.home && !this.busy) this.rebuildHomeKeepScreen();
    }
  }

  private rebuildHomeKeepScreen(): void {
    const screen = this.home!.screen;
    const pos = this.home!.player.position.clone();
    const yaw = this.home!.player.yaw;
    this.buildHome();
    const h = this.home!;
    h.player.controller.setPosition(pos);
    h.player.yaw = yaw;
    if (screen === 'construct') h.enterConstruction();
    else h.setScreen(screen);
  }

  private async coopRunStart(run: RunStart): Promise<void> {
    // Rejoining the operation this client is still showing: keep the scene, resync from events.
    if (run.rejoin && this.coopRun?.runId === run.runId && this.arena instanceof ClientGame) {
      uiEvents.emit('banner', { title: 'RECONNECTED', sub: 'Back in the operation', tone: 'cyan' });
      return;
    }
    this.coopRun = run;
    this.visiting = false;
    this.netQueue = { snaps: [], events: [] };
    const tier = getTier(run.tier);
    void this.input.requestLock();
    const me = run.players.find((p) => p.id === run.you);
    const net = this.net!;
    const layout = Flow.layoutFor(run.arena ?? 0);
    // Run map: the node this arena plays (the server sends the carry it was entered with).
    const mapNode = run.node ? findNode(run.node.map, run.node.id) : null;
    const carry = run.node?.carry ? sanitizeCarry(run.node.carry) : null;
    const nodeCfg = mapNode && run.node ? new MapSession(this.profile, new RunLedger(run.runId, run.tier, 0), { ...newMapState(run.node.map), current: run.node.id }, {}).configFor(mapNode, carry, tier) : null;
    if (nodeCfg) this.coopMap = { seed: run.node!.map, path: [...run.node!.path], cleared: run.node!.cleared, acts: run.node!.acts };
    await this.transition(`CO-OP DEPLOYMENT · THREAT TIER ${tier.roman}`, `${run.players.length} wardens · ${layout.name ?? 'Sector 07 reactor'}`, () => {
      const ledger = new RunLedger(run.runId, run.tier, Date.now());
      this.run = ledger;
      this.renderQuality = this.settings.quality;
      this.resize();
      const g = new ClientGame(
        this.engine,
        this.canvas,
        this.havok,
        this.settings,
        this.input,
        {
          tier,
          loadout: run.loadout as never,
          ...(nodeCfg ? { tier: nodeCfg.tier, node: nodeCfg.setup } : {}),
          run: ledger,
          seed: run.seed,
          layout,
          towerTech: run.towerTech,
          milestones: run.milestones,
          tree: { seed: this.profile.save.progress.tree.seed, allocated: [...this.profile.save.progress.tree.allocated] },
          hooks: { bank: () => true, checkpoint: () => {}, defeat: () => {} },
          you: run.you,
          slot: me?.slot ?? 0,
          players: run.players,
        },
        { send: (m) => net.send(m), act: (a) => net.act(a), get rtt() { return net.rtt; } },
      );
      g.myName = me?.name ?? 'You';
      if (run.node) g.mapInfo = { path: [...run.node.path], cleared: run.node.cleared, acts: run.node.acts };
      Object.defineProperty(g, 'devTools', { value: false });
      this.arena = g;
      this.location = 'arena';
      return g.scene;
    }, { kind: 'arena', sector: { name: layout.name ?? 'Sector 07 Reactor', code: layout.code ?? 'CLASSIC', layout, tier: tier.roman, tierName: tier.name, players: run.players.length, node: mapNode ? nodeBrief(mapNode, carry?.wave ?? 0) : undefined } });
    const g = this.arena as ClientGame;
    g.start();
    g.onEvents(this.netQueue.events);
    for (const s of this.netQueue.snaps) g.onSnapshot(s);
    this.netQueue = { snaps: [], events: [] };
  }

  private async coopRunEnd(result: RunResult, save: unknown): Promise<void> {
    if (save) this.profile.adoptRemote(save);
    hudStore.set({ lastRun: { ...result } });
    this.coopRun = null;
    if (this.run && !this.run.ended) this.run.finalize(result.outcome);
    // Let the defeat moment play before leaving.
    if (this.arena instanceof ClientGame && this.arena.defeatedByServer) await new Promise((r) => setTimeout(r, 2500));
    await this.toHome('summary');
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
      // Station relocations rebuild the HQ shell; construction mode resumes where it was.
      rebuild: () => setTimeout(() => this.home && !this.busy && this.rebuildHomeKeepScreen(), 0),
      tutorial: this.tutorialHost(),
      hostBase: () => (this.visiting ? (this.net?.state.hostHq?.base as SaveData['base']) ?? null : null),
    });
    if (this.loopStopped) this.home.scene.useConstantAnimationDeltaTime = true;
  }

  /**
   * Swap worlds behind the transit overlay: paint the overlay, dispose the old scene,
   * build the next one, wait until its shaders are ready (bounded), then reveal.
   */
  private async transition(title: string, sub: string, build: () => Scene, info: Omit<TransitInfo, 'title' | 'sub'> = {}): Promise<void> {
    this.busy = true;
    const shown = performance.now();
    const stage = (n: number) => hudStore.set({ screen: 'transit', transit: { title, sub, ...info, stage: n } });
    stage(0);
    try {
      await nextPaint();
      // Let the loading screen paint its "building" stage before the synchronous scene build blocks the thread.
      stage(1);
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
      stage(2);
      const ready = await Promise.race([
        Promise.all([scene.whenReadyAsync(), this.arena?.loot.warmup, this.arena?.shaderWarmup]).then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((r) => setTimeout(r, 8000, false)),
      ]);
      this.lastTransition = { disposeMs: Math.round(t1 - t0), buildMs: Math.round(t2 - t1), readyMs: Math.round(performance.now() - t2), timedOut: !ready };
      stage(3);
      // Arena deployments hold the sector briefing on screen for a moment (not in automation).
      const hold = info.kind === 'arena' && !this.input.forceCapture ? 1400 - (performance.now() - shown) : 0;
      if (hold > 0) await new Promise((r) => setTimeout(r, hold));
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
      /** Show the loading screen for an arena seed without loading anything (screenshots / visual checks). */
      previewLoading: (seed: number, stage = 1) => {
        const layout = Flow.layoutFor(seed);
        hudStore.set({ screen: 'transit', transit: { title: 'DEPLOYING · THREAT TIER II', sub: `${layout.name} · Hardened`, kind: 'arena', stage, sector: { name: layout.name ?? '', code: layout.code ?? '', layout, tier: 'II', tierName: 'HARDENED' } } });
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
          uid: `${a.cfg.run.id}.dbg${randomU32()}`,
          seed: o.seed ?? randomU32(),
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
        generateItem({ uid: `dbg_${o.seed}_${randomU32()}`, seed: o.seed, level: o.level ?? 5, rarity: o.rarity ?? 'rare', category: o.category, baseId: o.baseId, source: flow.arena?.cfg.run.id ?? 'debug', fixedRoll: o.fixedRoll }),
      /** A hand-made unique (loot/uniques.ts) at a level. */
      makeUnique: (id: string, seed = 1, level = 5) => {
        const def = uniqueDef(id);
        return def ? generateUnique(def, { uid: `dbg_u_${id}_${randomU32()}`, seed, level, source: flow.arena?.cfg.run.id ?? 'debug' }) : null;
      },
      /** Put an item straight into the run cargo (as if picked up). */
      grant: (item: ReturnType<typeof generateItem>) => {
        const a = flow.arena;
        if (!a || !a.inventory.collect(item)) return false;
        a.inventoryVersion++;
        return true;
      },
      V3: Vector3,
      /** Encounter plan a run with upgrade seed `seed` on `tier` will follow (same derivation as Game). */
      planFor: (seed: number, tier: number, n: number) => new SurvivalPlanner((seed >>> 0) ^ 0x6d2b79f5, tier).plan(n),
      /** M6 development tools (every call marks the run as non-record-eligible). */
      dev: {
        jump: (n: number) => flow.arena?.dev.jump(n),
        spawn: (kind: Parameters<DevTools['spawn']>[0], mods: Parameters<DevTools['spawn']>[1] = [], gate: Parameters<DevTools['spawn']>[2] = 'north') => flow.arena?.dev.spawn(kind, mods, gate) ?? null,
        force: (o: Parameters<DevTools['force']>[0]) => flow.arena?.dev.force(o),
        evolve: (id: Parameters<DevTools['evolve']>[0]) => flow.arena?.dev.evolve(id),
        reset: () => flow.arena?.dev.reset(),
        /** Deploy on any tier (ignores unlocks) as a development session. */
        deploy: (tier: number) => flow.devDeploy(tier),
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

/** Settings that live outside any world: key remapping, interface scale, colour accessibility. */
export function applyGlobalSettings(s: Settings, input: Input): void {
  input.remap = keyRemap(s);
  hudStore.set({ bindings: s.keys });
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    document.documentElement.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  }
  setRarityPalette(s.colorblind);
}
