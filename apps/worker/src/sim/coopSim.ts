import { generateArena } from '@riftwarden/rules/world/arenaGen';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { hashRunSeed } from '@riftwarden/rules/roguelite/upgrades';
import { type ClientMsg, type RunStart, SIM_HZ, SNAP_HZ } from '@riftwarden/protocol/protocol';
import { type Avatar, ServerGame, type ServerPlayerInit } from '@riftwarden/game/net/ServerGame';
import { newUid, SLOT_IDS } from '@riftwarden/rules/progression/items';
import { RunLedger, type RunOutcome } from '@riftwarden/rules/progression/run';
import { equippedItem } from '@riftwarden/rules/progression/save';
import { emptyRewards } from '@riftwarden/rules/progression/run';
import { getTier, type ThreatTier } from '@riftwarden/rules/progression/tiers';
import { actEffects, type RunCarry } from '@riftwarden/rules/runmap/carry';
import { combineEffects, type MapNode, nodeEffect, segmentTier } from '@riftwarden/rules/runmap/map';
import { defaultEntry, findNode, liveNode, nodePlayable, pathCode, reachable } from '@riftwarden/rules/war/world';
import { buffEffect } from '@riftwarden/rules/war/state';
import type { SimWar } from './war';
import { MODE_EFFECT } from '@riftwarden/rules/runmap/defs';
import { newMapState, type RunMapState } from '@riftwarden/rules/runmap/state';
import type { SlotId } from '@riftwarden/rules/progression/items';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import type { OnlineProfile, SimStore } from './store';
import type { Peer, Room } from './room';

/** Havok's wasm: next to the production bundle (apps/worker/build.mjs copies it), else from node_modules. */
export async function loadHavok(): Promise<unknown> {
  const bundled = process.env.RIFT_HAVOK_WASM ?? join(dirname(fileURLToPath(import.meta.url)), 'HavokPhysics.wasm');
  let file = bundled;
  if (!existsSync(file)) {
    const req = createRequire(import.meta.url);
    let dir = dirname(req.resolve('@babylonjs/havok'));
    while (!dir.endsWith('havok') && dir.length > 1) dir = dirname(dir);
    file = join(dir, 'lib/esm/HavokPhysics.wasm');
  }
  const wasm = readFileSync(file);
  return HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
}

/**
 * One authoritative co-op operation: owns the headless ServerGame, the fixed-step loop, the
 * per-player event/snapshot streams and every persistent consequence (banking into each player's
 * own server profile, run records, loadout adoption). Persistence rules are the single-player
 * rules (bankRewards / recordRun / applyLoadout), applied to server-owned profiles only.
 */
/** Co-op operations use the run map unless RIFT_MAP=0 (test servers: only with RIFT_MAP=1). */
export const coopMapMode = (): boolean => (process.env.RIFT_MAP ?? (process.env.RIFT_TEST === '1' ? '0' : '1')) === '1';

export class CoopSim {
  game: ServerGame;
  private engine: NullEngine;
  private timer: NodeJS.Timeout | null = null;
  private acc = 0;
  private last = performance.now();
  private snapAcc = 0;
  private ended = false;
  private endT = 0;
  private pendingEnd: RunOutcome | null = null;
  private ending: Promise<void> | null = null;
  private readonly closingPlayers: Promise<void>[] = [];
  /** State replicas need when (re)joining mid-run. */
  private evolutions: [string, number][] = [];
  private upgrades: string[] = [];
  readonly seed: number;
  arenaSeed: number;
  /** Run map progress (null = classic endless operation). */
  readonly mapState: RunMapState | null;
  private readonly tier: ThreatTier;
  private readonly classicArena: boolean;
  private readonly tech: string[];
  private readonly milestones: string[];
  /** Deploy-time loadouts (profile-owned gear carried by every node) and skill trees. */
  private readonly carried = new Map<string, Partial<Record<SlotId, ItemInstance | null>>>();
  private readonly trees = new Map<string, { seed: number; allocated: readonly string[] }>();
  private traveling = false;
  /** Defense or survival (fixed for the operation). */
  private readonly mode: 'defense' | 'survival';
  private nodeStep = 0;
  /** Diagnostics. */
  private whyT = 0;
  private whyLast = '{}';
  stats = { ticks: 0, simMs: 0, maxMs: 0, bytes: 0, snaps: 0, events: 0 };

  static async create(room: Room, store: SimStore, havok: unknown, log: (m: string) => void, war: SimWar): Promise<CoopSim> {
    const players = room.connected.map((m) => ({ id: m.id, name: m.name, profile: store.get(m.id)! }));
    const runId = newUid('run');
    const mapSeed = coopMapMode() ? war.state.seed : 0;
    if (!await store.startRun(players.map((p) => p.profile), runId, room.tier, mapSeed, room.mode)) throw new Error('Could not save operation start');
    try {
      return new CoopSim(room, store, havok, log, runId, players, war);
    } catch (error) {
      await Promise.all(players.map(async ({ profile }) => {
        await store.run(profile, { kind: 'interrupt', at: Date.now() });
        profile.inRun = null;
      }));
      throw error;
    }
  }

  private constructor(
    private room: Room,
    private store: SimStore,
    private havok: unknown,
    private log: (m: string) => void,
    readonly runId: string,
    members: { id: string; name: string; profile: OnlineProfile }[],
    /** The shared Rift War (map operations play on it and report secured sectors). */
    private war: SimWar,
  ) {
    this.engine = new NullEngine();
    this.tier = getTier(room.tier);
    this.mode = room.mode;
    this.seed = hashRunSeed(this.runId);
    // Procedural sector per operation; test servers keep the classic arena unless RIFT_ARENA=procedural.
    const mode = process.env.RIFT_ARENA ?? (process.env.RIFT_TEST === '1' ? 'classic' : 'procedural');
    this.classicArena = mode === 'classic';
    this.arenaSeed = this.classicArena ? 0 : ((this.seed ^ 0x2545f491) >>> 0) || 1;
    this.mapState = coopMapMode() ? newMapState(war.state.seed) : null;
    const players: ServerPlayerInit[] = [];
    const tech = new Set<string>();
    let milestones = null as Set<string> | null;
    let slot = 0;
    for (const { id, name, profile: p } of members) {
      for (const t of p.data.towers.unlocked) tech.add(t);
      const ms = new Set<string>(p.data.milestones);
      milestones = milestones ? new Set<string>([...milestones].filter((x: string) => ms.has(x))) : ms;
      const loadout = Object.fromEntries(SLOT_IDS.map((s) => [s, structuredClone(equippedItem(p.data, s))]));
      this.carried.set(id, loadout);
      this.trees.set(id, structuredClone(p.data.progress.tree));
      const ledger = new RunLedger(this.runId, this.tier.id, Date.now());
      ledger.survivalMode = this.mode === 'survival';
      players.push({ id, name, slot: slot++, loadout: structuredClone(loadout), ledger, tree: structuredClone(p.data.progress.tree) });
    }
    this.tech = [...tech];
    this.milestones = [...(milestones ?? [])];
    // The host picks the deployment node on the war map (any unlocked sector); default: the front's landing.
    const first = this.mapState ? findNode(this.mapState.seed, room.node && nodePlayable(war.state, room.node) ? room.node : defaultEntry(war.state)) : null;
    this.game = this.createGame(first, null, players);
    for (const a of this.game.avatars) {
      if (this.peer(a.id)) this.sendStart(a, false);
      else this.playerDisconnected(a.id);
    }
    this.timer = setInterval(() => this.loop(), 1000 / SIM_HZ);
    this.log(`room ${room.code}: operation ${this.runId.slice(-6)} started (tier ${this.tier.id}, ${players.length} players${this.mapState ? ', run map' : ''})`);
  }

  /** Build the authoritative game for the operation's arena (classic) or a map node. */
  private createGame(node: MapNode | null, carry: RunCarry | null, players: ServerPlayerInit[]): ServerGame {
    let tier = this.mode === 'survival' ? segmentTier(this.tier, combineEffects(MODE_EFFECT.survival)) : this.tier;
    let setup = undefined;
    const ms = this.mapState;
    if (node && ms) {
      // Live war modifiers and order buffs at the moment the team enters.
      node = liveNode(ms.seed, this.war.state, node.id) ?? node;
      const effect = nodeEffect(node, [...actEffects(carry ?? { curses: [], blessings: [] }), MODE_EFFECT[this.mode], buffEffect(this.war.state, Date.now())]);
      tier = segmentTier(this.tier, effect);
      setup = { node, mapSeed: ms.seed, carry, effect };
      this.arenaSeed = this.classicArena ? 0 : node.seed;
      ms.current = node.id;
      ms.act = node.act;
      if (ms.path[ms.path.length - 1] !== node.id) ms.path.push(node.id);
    }
    const towerTech = [...new Set([...this.tech, ...(carry?.runTech ?? [])])];
    const g = new ServerGame(
      this.engine,
      this.havok,
      players,
      { tier, runId: this.runId, seed: this.seed, layout: this.arenaSeed ? generateArena(this.arenaSeed) : undefined, towerTech, milestones: this.milestones, node: setup, mode: this.mode },
      {
        bank: async (id, wave, rewards, bosses) => {
          const p = this.store.get(id);
          if (!p) return false;
          const ok = await this.store.run(p, { kind: 'bank', runId: this.runId, wave, rewards: { ...emptyRewards(), ...rewards }, bosses, loot: [] });
          this.log(`run ${this.runId.slice(-6)}: banked wave ${wave} for ${id.slice(0, 6)} (${rewards.items.length} items, ok=${ok})`);
          return ok;
        },
        defeat: () => this.finish('defeat', 3),
        extract: () => {
          // Leaving a secured node counts it.
          if (this.mapState) this.mapState.cleared++;
          this.finish('returned', 1.5);
        },
        travel: (id, home) => void this.travel(id, home),
        actCleared: () => {
          if (this.mapState) this.mapState.actsCleared++;
        },
        reachable: () => (this.mapState ? reachable(this.mapState.seed, this.war.state, this.mapState.current).map((n) => n.id) : []),
        secured: (id) => {
          // The server played the sector itself: a trusted report, one share per warden still in.
          const players = this.game.avatars.filter((a) => !a.left).length;
          const r = this.war.report({ node: id, mode: this.mode, players }, `coop:${this.runId}`, true);
          if (r.ok) this.game.within(() => this.game.rec.push(['u', 'alert', { text: `RIFT WAR · +${r.gain.toFixed(1)}% LIBERATION${r.messages.length ? ` · ${r.messages.join(' · ').toUpperCase()}` : ''}`, tone: 'blue' }]));
        },
        hostId: () => this.room.hostId,
      },
    );
    g.testMode = process.env.RIFT_TEST === '1';
    g.within(() => g.start());
    // Remember what late joiners must reproduce.
    this.evolutions = [];
    this.upgrades = [];
    const evo = g.survival.applyEvolution.bind(g.survival);
    g.survival.applyEvolution = (id, instant) => {
      this.evolutions.push([id, instant ? 1 : 0]);
      return evo(id, instant);
    };
    const take = g.director.takeUpgrade.bind(g.director);
    g.director.takeUpgrade = (id: string) => {
      const ok = take(id);
      if (ok) this.upgrades.push(id);
      return ok;
    };
    return g;
  }

  /** Map summary every ledger carries into its run result. */
  private mapSummary() {
    const ms = this.mapState!;
    return { act: ms.act, nodes: ms.cleared, actsCleared: ms.actsCleared, path: pathCode(ms.path, ms.seed) };
  }

  /** Bank what a warden's ledger still holds after the node's checkpoint (hub rewards, late pickups). */
  private async bankLeftovers(a: Avatar): Promise<void> {
    const moved = a.run.bankNode();
    const p = this.store.get(a.id);
    if (!moved || !p || this.game.cfg.run.survival.dev) return;
    if (!moved.items.length && !moved.salvage && !moved.credits && !moved.components && !moved.shards && !moved.xp) return;
    const step = ++this.nodeStep;
    await this.store.run(p, { kind: 'nodeBank', runId: this.runId, step, rewards: { ...emptyRewards(), ...moved }, loot: [] });
    a.inventoryDirty = true;
  }

  /** The team travels to the next node: bank, carry, rebuild the authoritative game, restart every replica. */
  private async travel(nodeId: string, home: string[]): Promise<void> {
    const ms = this.mapState;
    if (!ms || this.traveling || this.ended || this.pendingEnd) return;
    const next = findNode(ms.seed, nodeId);
    if (!next) return;
    this.traveling = true;
    try {
      const g = this.game;
      await g.settleBanking();
      g.syncStats();
      ms.cleared++;
      // Home voters close with the path as it stands (the next node is not theirs).
      const summary = this.mapSummary();
      for (const id of home) {
        const a = g.avatar(id);
        if (!a || a.left) continue;
        a.left = true;
        this.closingPlayers.push(this.closeFor(a, 'returned', summary));
      }
      const stay = g.avatars.filter((a) => !a.left);
      if (!stay.length) {
        this.traveling = false;
        return void this.endRun('returned');
      }
      for (const a of stay) await this.bankLeftovers(a);
      const carry = g.node!.exportCarry();
      const inits: ServerPlayerInit[] = stay.map((a) => ({
        id: a.id,
        name: a.name,
        slot: a.slot,
        loadout: structuredClone(this.carried.get(a.id) ?? {}),
        ledger: a.run,
        tree: this.trees.get(a.id),
        restore: { ...a.inventory.loadout },
        ult: a.abilities.ult,
      }));
      const connected = new Map(stay.map((a) => [a.id, a.connected]));
      ms.carry = carry;
      ms.next = next.id;
      const teamState = g.team.exportState();
      g.dispose();
      this.game = this.createGame(next, carry, inits);
      // The team ledger (waves, checkpoints, survival statistics) continues across arenas.
      this.game.team.restore(teamState);
      for (const a of this.game.avatars) {
        a.connected = connected.get(a.id) ?? false;
        a.run.map = this.mapSummary();
        if (a.connected && this.peer(a.id)) this.sendStart(a, false);
      }
      this.log(`run ${this.runId.slice(-6)}: travelled to ${next.id} (${next.kind}), ${home.length} extracted`);
    } finally {
      this.traveling = false;
    }
  }

  get wave(): number {
    return this.game.waves.number;
  }

  private peer(id: string): Peer | null {
    return this.room.members.get(id)?.peer ?? null;
  }

  private sendStart(a: Avatar, rejoin: boolean): void {
    const peer = this.peer(a.id);
    if (!peer) return;
    const g = this.game;
    const run: RunStart = {
      runId: this.runId,
      tier: g.cfg.tier.id,
      seed: this.seed,
      arena: this.arenaSeed,
      you: a.id,
      players: g.avatars.filter((x) => !x.left).map((x) => ({ id: x.id, name: x.name, slot: x.slot })),
      loadout: a.inventory.loadout && Object.fromEntries(SLOT_IDS.map((s) => [s, a.inventory.equipped(s)])),
      towerTech: [...g.towerTech],
      milestones: [...(g.cfg.milestones ?? [])],
      rejoin,
      mode: this.mode,
      node: this.mapState && g.node ? { id: g.node.node.id, map: this.mapState.seed, path: [...this.mapState.path], cleared: this.mapState.cleared, acts: this.mapState.actsCleared, carry: g.node.setup.carry ? { ...g.node.setup.carry, loadout: { ...a.inventory.loadout }, ult: a.abilities.ult } : null } : null,
    };
    peer.send({ t: 'runStart', run });
    // Everything a replica needs to reproduce the current world.
    const join: unknown[][] = [];
    for (const [id, inst] of this.evolutions) join.push(['ev', id, 1 || inst]);
    for (const id of this.upgrades) join.push(['up', id, '']);
    for (const e of g.enemies.active) join.push(['es', e.id, e.kind, e.mods, e.tag ?? null, e.encounter, e.maxHp, e.maxShield, e.pos.x, e.pos.z, e.yaw, e.seg, 'north']);
    for (const t of g.turrets.turrets) join.push(['T+', t.id, t.config, [t.pos.x, t.pos.y, t.pos.z], t.yaw, (t as { owner?: string }).owner ?? '', '']), join.push(['Tc', t.id, t.config, t.level]);
    for (const p of a.pickups.values()) join.push(['L+', p.id, p.item, [p.ground.x, p.ground.y + 2, p.ground.z], [p.ground.x, p.ground.y, p.ground.z], p.wave]);
    a.inventoryDirty = true;
    peer.send({ t: 'ev', e: join });
    peer.send({ t: 'snap', s: { ...g.netSnapshot(true), me: g.personal(a) } });
  }

  // ------------------------------------------------------------------ messages

  onMessage(id: string, msg: ClientMsg): void {
    if (this.ended) return;
    const a = this.game.avatar(id);
    if (!a || a.left) return;
    const g = this.game;
    g.within(() => {
      if (msg.t === 'input') g.onInput(a, msg);
      else if (msg.t === 'act') {
        const { id: reqId, t: _t, ...act } = msg;
        void _t;
        const why = g.act(a, act as never);
        this.peer(id)?.send({ t: 'actResult', id: reqId, ok: !why, reason: why ?? undefined });
      }
    });
  }

  // ------------------------------------------------------------------ loop

  private loop(): void {
    const now = performance.now();
    let elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const step = 1 / SIM_HZ;
    this.acc += elapsed;
    const t0 = performance.now();
    let n = 0;
    if (this.traveling) return;
    while (this.acc >= step && n < 6) {
      this.acc -= step;
      this.game.tick(step);
      n++;
      this.stats.ticks++;
    }
    if (n === 6) this.acc = 0;
    const ms = performance.now() - t0;
    this.stats.simMs = this.stats.simMs * 0.95 + ms * 0.05;
    this.stats.maxMs = Math.max(this.stats.maxMs * 0.999, ms);
    this.flushEvents();
    if (this.game.testMode) {
      this.whyT += elapsed;
      const why = JSON.stringify(this.game.why);
      if (this.whyT > 3 && why !== this.whyLast) {
        this.whyT = 0;
        this.whyLast = why;
        this.log(`run ${this.runId.slice(-6)}: rejected ${why}`);
      }
    }
    this.snapAcc += elapsed;
    if (this.snapAcc >= 1 / SNAP_HZ) {
      this.snapAcc = 0;
      this.sendSnapshots();
    }
    if (this.pendingEnd) {
      this.endT -= elapsed;
      if (this.endT <= 0) void this.endRun(this.pendingEnd);
    }
    elapsed = 0;
  }

  private flushEvents(): void {
    const evs = this.game.rec.take();
    if (!evs.length) return;
    this.stats.events += evs.length;
    for (const a of this.game.avatars) {
      if (a.left) continue;
      const peer = this.peer(a.id);
      if (!peer) continue;
      const mine = evs.filter((x) => (!x.to || x.to === a.id) && x.not !== a.id).map((x) => x.e);
      if (mine.length) this.send(peer, { t: 'ev', e: mine });
    }
  }

  private sendSnapshots(): void {
    const g = this.game;
    const shared = g.netSnapshot();
    this.stats.snaps++;
    for (const a of g.avatars) {
      if (a.left) continue;
      const peer = this.peer(a.id);
      if (peer) this.send(peer, { t: 'snap', s: { ...shared, me: g.personal(a) } });
    }
  }

  private send(peer: Peer, msg: Parameters<Peer['send']>[0]): void {
    this.stats.bytes += peer.send(msg);
  }

  // ------------------------------------------------------------------ membership

  playerDisconnected(id: string): void {
    const a = this.game.avatar(id);
    if (!a || a.left) return;
    a.connected = false;
    this.game.within(() => this.game.rec.push(['u', 'alert', { text: `${a.name.toUpperCase()} LOST CONNECTION`, tone: 'orange' }]));
    if (this.game.voteOpen) this.game.within(() => (this.game as unknown as { checkVote(): void }).checkVote());
    this.log(`run ${this.runId.slice(-6)}: ${a.name} disconnected`);
    if (!this.game.avatars.some((x) => x.active)) this.log(`run ${this.runId.slice(-6)}: nobody connected, holding for reconnect`);
  }

  playerReconnected(id: string, peer: Peer): void {
    const a = this.game.avatar(id);
    if (!a || a.left || this.ended) return;
    a.connected = true;
    a.lastSeq = -1;
    void peer;
    this.game.within(() => this.game.rec.push(['u', 'alert', { text: `${a.name.toUpperCase()} RECONNECTED`, tone: 'blue' }]));
    this.sendStart(a, true);
    this.log(`run ${this.runId.slice(-6)}: ${a.name} rejoined at wave ${this.wave}`);
  }

  /** A player left for good (or their reconnect window expired): their run ends with only secured rewards. */
  playerLeft(id: string, why: 'left' | 'timeout'): void {
    const a = this.game.avatar(id);
    if (!a || a.left || this.ended) return;
    this.game.syncStats();
    this.closingPlayers.push(this.closeFor(a, 'abandoned'));
    void why;
    a.left = true;
    a.connected = false;
    a.player.alive = false;
    a.player.controller.setPosition(a.player.position.add(a.player.position.scale(0)).set(0, -60, 0));
    this.game.rebuildStats();
    this.game.within(() => this.game.rec.push(['left', a.id, a.name]));
    if (!this.game.avatars.some((x) => !x.left)) void this.endRun('abandoned');
  }

  /** Record one player's run on their profile (idempotent per run id) and adopt owned gear. */
  private async closeFor(a: Avatar, outcome: RunOutcome, summary?: ReturnType<CoopSim['mapSummary']>): Promise<void> {
    const p = this.store.get(a.id);
    const peer = this.peer(a.id);
    await this.game.settleBanking();
    if (this.mapState) {
      if (outcome === 'returned') await this.bankLeftovers(a);
      a.run.map = summary ?? this.mapSummary();
    }
    const result = a.run.finalize(outcome);
    if (p) {
      const owned = a.inventory.ownedLoadout();
      const saved = await this.store.run(p, { kind: 'end', result, loadout: owned });
      p.inRun = null;
      if (!saved) (this.peer(a.id) ?? peer)?.send({ t: 'error', code: 'save', msg: 'The operation summary could not be saved' });
    }
    (this.peer(a.id) ?? peer)?.send({ t: 'runEnd', result });
    this.log(`run ${this.runId.slice(-6)}: ${a.name} ${outcome} (wave ${result.finalWave}, ${result.itemsSecured} items secured, ${result.itemsLost} lost)`);
  }

  private finish(outcome: RunOutcome, delay: number): void {
    if (this.pendingEnd || this.ended) return;
    this.pendingEnd = outcome;
    this.endT = delay;
  }

  private endRun(outcome: RunOutcome): Promise<void> {
    this.ending ??= this.finishRun(outcome);
    return this.ending;
  }

  private async finishRun(outcome: RunOutcome): Promise<void> {
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.game.settleBanking();
    this.flushEvents();
    this.game.syncStats();
    for (const a of this.game.avatars) if (!a.left) this.closingPlayers.push(this.closeFor(a, outcome));
    await Promise.all(this.closingPlayers);
    this.log(`run ${this.runId.slice(-6)}: ended (${outcome}) at wave ${this.wave}; sim avg ${this.stats.simMs.toFixed(2)} ms/frame, ${(this.stats.bytes / 1024).toFixed(0)} KiB sent`);
    try {
      this.game.dispose();
      this.engine.dispose();
    } catch (e) {
      this.log(`dispose: ${(e as Error).message}`);
    }
    this.room.runEnded();
  }

  shutdown(): Promise<void> {
    return this.endRun('abandoned');
  }
}
