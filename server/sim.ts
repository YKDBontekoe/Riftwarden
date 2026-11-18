import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { NullEngine } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { hashRunSeed } from '../src/roguelite/upgrades';
import { type ClientMsg, type RunStart, SIM_HZ, SNAP_HZ } from '../src/net/protocol';
import { type Avatar, ServerGame, type ServerPlayerInit } from '../src/net/ServerGame';
import { newUid, SLOT_IDS } from '../src/progression/items';
import { RunLedger, type RunOutcome } from '../src/progression/run';
import { applyLoadout, bankRewards, beginRun, equippedItem, recordRun } from '../src/progression/save';
import { getTier } from '../src/progression/tiers';
import type { ProfileStore } from './profiles';
import type { Peer, Room } from './room';

export async function loadHavok(): Promise<unknown> {
  const req = createRequire(import.meta.url);
  let dir = dirname(req.resolve('@babylonjs/havok'));
  while (!dir.endsWith('havok') && dir.length > 1) dir = dirname(dir);
  const wasm = readFileSync(join(dir, 'lib/esm/HavokPhysics.wasm'));
  return HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
}

/**
 * One authoritative co-op operation: owns the headless ServerGame, the fixed-step loop, the
 * per-player event/snapshot streams and every persistent consequence (banking into each player's
 * own server profile, run records, loadout adoption). Persistence rules are the single-player
 * rules (bankRewards / recordRun / applyLoadout), applied to server-owned profiles only.
 */
export class CoopSim {
  readonly game: ServerGame;
  readonly runId = newUid('run');
  private engine: NullEngine;
  private timer: NodeJS.Timeout | null = null;
  private acc = 0;
  private last = performance.now();
  private snapAcc = 0;
  private ended = false;
  private endT = 0;
  private pendingEnd: RunOutcome | null = null;
  /** State replicas need when (re)joining mid-run. */
  private evolutions: [string, number][] = [];
  private upgrades: string[] = [];
  readonly seed: number;
  /** Diagnostics. */
  private whyT = 0;
  private whyLast = '{}';
  stats = { ticks: 0, simMs: 0, maxMs: 0, bytes: 0, snaps: 0, events: 0 };

  constructor(
    private room: Room,
    private store: ProfileStore,
    havok: unknown,
    private log: (m: string) => void,
  ) {
    this.engine = new NullEngine();
    const tier = getTier(room.tier);
    this.seed = hashRunSeed(this.runId);
    const players: ServerPlayerInit[] = [];
    const tech = new Set<string>();
    let milestones = null as Set<string> | null;
    let slot = 0;
    for (const m of room.connected) {
      const p = store.get(m.id)!;
      store.mutate(p, (d) => beginRun(d, this.runId, tier.id));
      p.inRun = this.runId;
      for (const t of p.data.towers.unlocked) tech.add(t);
      const ms = new Set<string>(p.data.milestones);
      milestones = milestones ? new Set<string>([...milestones].filter((x: string) => ms.has(x))) : ms;
      const loadout = Object.fromEntries(SLOT_IDS.map((s) => [s, structuredClone(equippedItem(p.data, s))]));
      players.push({ id: m.id, name: m.name, slot: slot++, loadout, ledger: new RunLedger(this.runId, tier.id, Date.now()) });
    }
    this.game = new ServerGame(
      this.engine,
      havok,
      players,
      { tier, runId: this.runId, seed: this.seed, towerTech: [...tech], milestones: [...(milestones ?? [])] },
      {
        bank: (id, wave, rewards, bosses) => {
          const p = this.store.get(id);
          if (!p) return false;
          const ok = this.store.mutate(p, (d) => bankRewards(d, this.runId, wave, rewards, { bosses }));
          this.log(`run ${this.runId.slice(-6)}: banked wave ${wave} for ${id.slice(0, 6)} (${rewards.items.length} items, ok=${ok})`);
          return ok;
        },
        defeat: () => this.finish('defeat', 3),
        extract: () => this.finish('returned', 1.5),
      },
    );
    const g = this.game;
    g.testMode = process.env.RIFT_TEST === '1';
    g.within(() => g.start());
    // Remember what late joiners must reproduce.
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
    for (const a of g.avatars) this.sendStart(a, false);
    this.timer = setInterval(() => this.loop(), 1000 / SIM_HZ);
    this.log(`room ${room.code}: operation ${this.runId.slice(-6)} started (tier ${tier.id}, ${players.length} players)`);
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
      you: a.id,
      players: g.avatars.filter((x) => !x.left).map((x) => ({ id: x.id, name: x.name, slot: x.slot })),
      loadout: a.inventory.loadout && Object.fromEntries(SLOT_IDS.map((s) => [s, a.inventory.equipped(s)])),
      towerTech: [...g.towerTech],
      milestones: [...(g.cfg.milestones ?? [])],
      rejoin,
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
      if (this.endT <= 0) this.endRun(this.pendingEnd);
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
    this.stats.bytes += JSON.stringify(msg).length;
    peer.send(msg);
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
    if (!a || a.left) return;
    this.game.syncStats();
    this.closeFor(a, 'abandoned');
    void why;
    a.left = true;
    a.connected = false;
    a.player.alive = false;
    a.player.controller.setPosition(a.player.position.add(a.player.position.scale(0)).set(0, -60, 0));
    this.game.rebuildStats();
    this.game.within(() => this.game.rec.push(['left', a.id, a.name]));
    if (!this.game.avatars.some((x) => !x.left)) this.endRun('abandoned');
  }

  /** Record one player's run on their profile (idempotent per run id) and adopt owned gear. */
  private closeFor(a: Avatar, outcome: RunOutcome): void {
    const p = this.store.get(a.id);
    const result = a.run.finalize(outcome);
    if (p) {
      const owned = a.inventory.ownedLoadout();
      this.store.mutate(p, (d) => {
        const recorded = recordRun(d, result);
        applyLoadout(d, owned, { ignoreActiveRun: true });
        return recorded;
      });
      p.inRun = null;
    }
    const peer = this.peer(a.id);
    peer?.send({ t: 'runEnd', result, save: p?.data ?? null });
    this.log(`run ${this.runId.slice(-6)}: ${a.name} ${outcome} (wave ${result.finalWave}, ${result.itemsSecured} items secured, ${result.itemsLost} lost)`);
  }

  private finish(outcome: RunOutcome, delay: number): void {
    if (this.pendingEnd || this.ended) return;
    this.pendingEnd = outcome;
    this.endT = delay;
  }

  endRun(outcome: RunOutcome): void {
    if (this.ended) return;
    this.ended = true;
    this.flushEvents();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.game.syncStats();
    for (const a of this.game.avatars) if (!a.left) this.closeFor(a, a.connected ? outcome : outcome === 'returned' ? 'returned' : outcome);
    this.log(`run ${this.runId.slice(-6)}: ended (${outcome}) at wave ${this.wave}; sim avg ${this.stats.simMs.toFixed(2)} ms/frame, ${(this.stats.bytes / 1024).toFixed(0)} KiB sent`);
    try {
      this.game.dispose();
      this.engine.dispose();
    } catch (e) {
      this.log(`dispose: ${(e as Error).message}`);
    }
    this.room.runEnded();
  }

  shutdown(reason: 'empty' | 'server'): void {
    if (!this.ended) this.endRun('abandoned');
    void reason;
  }
}
