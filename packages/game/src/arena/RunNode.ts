import '../babylonSideEffects';
import { music } from '../audio/Music';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Scene } from '@babylonjs/core/scene';
import { sfx } from '../audio/Sfx';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import type { StatModifier } from '@riftwarden/rules/combat/stats';
import { DROP_SOURCES, type DropSource } from '@riftwarden/rules/loot/drops';
import type { RarityId } from '@riftwarden/rules/loot/rarity';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import type { RunLedger } from '@riftwarden/rules/progression/run';
import type { RunBuild } from '@riftwarden/rules/roguelite/upgrades';
import { carryStats, endAct, purgeCurse, type RunCarry, towerRefund } from '@riftwarden/rules/runmap/carry';
import { ANOMALIES, FORGE, FORGE_IDS, type ForgeId, isCombatKind, NODE_KINDS, REST, REST_IDS, type RestId, SERVICES, SERVICE_IDS, type ServiceId } from '@riftwarden/rules/runmap/defs';
import { forgePrice, GUARDIAN, merchantStock, resolveAnomaly, type StockOffer } from '@riftwarden/rules/runmap/hub';
import { h32, type MapNode, nodeInfo, SEGMENT, type SegmentEffect } from '@riftwarden/rules/runmap/map';
import type { NodeHud, StationOption, StationPanel } from '@riftwarden/rules/runmap/view';
import type { SurvivalPlanner } from '@riftwarden/rules/survival/plan';
import { uiEvents } from '../ui/store';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';
import { buildStation, type StationKind, type StationRig } from '../visuals/nodeProps';
import type { SpawnEntry, WaveDef } from '@riftwarden/rules/waves/waves';
import type { WaveManager } from '../waves/WaveManager';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { pickInteractable } from '../home/interaction';

/** Node state mirrored to co-op replicas. */
export interface NodeNet {
  c: number;
  g: number | null;
  sold: string[];
  r: number;
  e: number;
  v: 'sealed' | 'open' | 'looted';
  f: Partial<Record<ForgeId, number>>;
  cu: string[];
  bl: string[];
  n: string;
}

/** One map node as configured by the session flow. */
export interface NodeSetup {
  node: MapNode;
  mapSeed: number;
  /** State carried in from the previous node (null = the run's first node). */
  carry: RunCarry | null;
  /** Combined segment effect (kind + modifiers + act curses/blessings). */
  effect: SegmentEffect;
}

/** What a node needs from the arena (narrow host; no Game import). */
export interface NodeHost {
  readonly scene: Scene;
  readonly kit: Kit;
  readonly pal: Palette;
  readonly layout: ArenaLayout;
  readonly waves: WaveManager;
  readonly planner: SurvivalPlanner;
  readonly run: RunLedger;
  readonly build: RunBuild;
  /** Item level of drops at a wave of this node's Rift Level (tiers `lootLevel`). */
  lootLevelAt(wave: number): number;
  /** Rift Level the node plays at (merchant rarity gate). */
  readonly riftLevel: number;
  cores: number;
  reactorHp: number;
  readonly reactorMax: number;
  ult: number;
  lootCounter: number;
  dropChanceMult: number;
  readonly dealt: { player: number; tower: number };
  playerEye(): Vector3;
  playerDir(): Vector3;
  playerPos(): Vector3;
  towers(): { paid: number; wrecked?: boolean }[];
  loadout(): Record<string, string | null>;
  pickupsLeft(): number;
  rebuildStats(): void;
  rebuildEffects(): void;
  spawnEntry(s: SpawnEntry, w: WaveDef): void;
  enemiesAlive(): number;
  dropFrom(src: DropSource, at: Vector3): void;
  makeItem(offer: StockOffer, level: number): ItemInstance;
  /** Co-op replica: send a station action to the server (its result arrives as node state). */
  sendStation(station: string, opt: string): void;
  grantItem(item: ItemInstance): boolean;
  openUpgrade(): void;
  openMap(): void;
  openPanel(): void;
  screenPlaying(): boolean;
  tacticalRefill(): void;
  /** Survival mode: no reactor, no towers (stations adapt). */
  readonly survival: boolean;
  /** Restore the drone's hull and shield (survival rest). */
  healDrone(): void;
  /** An act boss fell (curses lift; the flow advances the act). */
  actCleared(act: number): void;
  /** A combat sector was secured (the Rift War counts it). */
  secured(nodeId: string): void;
}

/**
 * The arena side of one run-map node: restores the carry, plays the node's wave segment (combat kinds) or
 * runs its stations (hubs), completes it, opens the map and exports the carry for the next node.
 */
export class RunNode {
  readonly node: MapNode;
  /** Run state carried forward (mutated by stations; exported at travel). */
  readonly carry: RunCarry;
  readonly from: number;
  readonly to: number;
  complete: boolean;
  /** The map should open at the next chance (node just completed). */
  mapDue = false;
  private stations: { kind: StationKind; rig: StationRig; at: Vector3; used: boolean }[] = [];
  private target: (typeof this.stations)[number] | null = null;
  panelStation: StationKind | null = null;
  private note = '';
  private stock: { offer: StockOffer; item: ItemInstance; sold: boolean }[] = [];
  private restUsed = false;
  private eventUsed = false;
  private vaultState: 'sealed' | 'open' | 'looted' = 'sealed';
  private guard: { spawns: SpawnEntry[]; wave: WaveDef; elapsed: number; cursor: number; reward: 'vault' | 'ambush'; items: { source: 'eliteCache' | 'checkpoint' | 'boss'; minRarity: RarityId }[] } | null = null;
  private rand: () => number;
  private t = 0;
  private exitShown = false;

  /** Mirrored server state (co-op replicas). */
  private net: NodeNet | null = null;

  constructor(private h: NodeHost, readonly setup: NodeSetup, readonly replica = false) {
    this.node = setup.node;
    this.carry = setup.carry ? structuredClone(setup.carry) : { wave: 0, cores: 0, reactorHp: 0, ult: 0, build: { stacks: [], picks: [], offers: 0 }, loadout: {}, curses: [], blessings: [], forge: {}, runTech: [], picks: 0, lootCounter: 0, dealt: { player: 0, tower: 0 } };
    this.from = this.carry.wave + 1;
    this.to = this.carry.wave + SEGMENT;
    this.complete = !isCombatKind(this.node.kind);
    this.rand = mulberry32(h32(this.node.seed, 0xa70));
  }

  get combat(): boolean {
    return isCombatKind(this.node.kind);
  }

  get noTowers(): boolean {
    return this.setup.effect.noTowers;
  }

  /** Run-only stat modifiers (curses, blessings, forge tempering, node core income). */
  mods(): StatModifier[] {
    const out: StatModifier[] = carryStats(this.carry);
    if (this.setup.effect.cores !== 1) out.push({ stat: 'coreIncomeMult', op: 'mul', value: this.setup.effect.cores - 1, source: 'node:cores' });
    return out;
  }

  /** Called after the arena reset: carry in, plan the segment, jump to its first wave. */
  begin(): void {
    const h = this.h;
    const c = this.carry;
    if (this.replica) {
      // The server plays the node; the replica shows its stations and announces it.
      if (!this.combat) this.buildStations();
      if (this.node.kind === 'merchant') this.stockMerchant();
      this.announce();
      return;
    }
    h.planner.setSegment({ from: this.from, to: this.to, boss: this.node.boss, event: this.setup.effect.event ?? null, cores: this.setup.effect.cores });
    h.dropChanceMult *= this.setup.effect.drops;
    if (this.setup.carry) {
      h.cores = c.cores;
      if (c.reactorHp > 0) h.reactorHp = Math.min(h.reactorMax, c.reactorHp);
      h.ult = c.ult;
      h.lootCounter = Math.max(h.lootCounter, c.lootCounter);
      const b = h.build;
      b.stacks.clear();
      for (const [id, n] of c.build.stacks) b.stacks.set(id, n);
      b.picks.length = 0;
      b.picks.push(...c.build.picks);
      b.offers = c.build.offers;
      h.rebuildEffects();
    }
    h.rebuildStats();
    // Hubs hold the wave clock for the whole visit; combat nodes start the segment's first wave.
    h.waves.hold = !this.combat;
    h.waves.jumpTo(this.from);
    if (!this.combat) this.buildStations();
    if (this.node.kind === 'merchant') this.stockMerchant();
    this.announce();
  }

  private announce(): void {
    const k = NODE_KINDS[this.node.kind];
    const info = nodeInfo(this.node);
    uiEvents.emit('banner', {
      title: `${this.node.actBoss ? 'ACT BOSS · ' : ''}${k.name.toUpperCase()}`,
      sub: this.combat ? `${info.name} · waves ${this.from}-${this.to} · ${info.faction}` : `${info.name} · ${k.blurb}`,
      tone: this.node.kind === 'boss' ? 'red' : this.combat ? 'orange' : 'cyan',
    });
  }

  /** A wave of the segment was cleared (after the arena's own wave-clear rewards and banking). */
  waveCleared(n: number): void {
    if (!this.combat || this.complete || n < this.to) return;
    this.complete = true;
    this.mapDue = true;
    this.h.waves.hold = true;
    this.h.secured(this.node.id);
    const at = new Vector3(this.h.layout.reactor.x, 3, this.h.layout.reactor.z + 5);
    if (this.node.kind === 'elite') this.h.dropFrom(DROP_SOURCES.eliteCache, at);
    const shards = this.setup.effect.shards + (this.node.actBoss ? 3 : 0);
    if (shards > 0 && this.h.run.collect({ shards })) uiEvents.emit('alert', { text: `+${shards} RIFT SHARDS`, tone: 'blue' });
    if (this.node.actBoss) {
      this.h.dropFrom(DROP_SOURCES.eliteCache, at);
      this.h.dropFrom({ ...DROP_SOURCES.eliteCache, minRarity: 'epic', rolls: 1 }, at);
      endAct(this.carry);
      this.h.rebuildStats();
      this.h.actCleared(this.node.act);
      uiEvents.emit('banner', { title: `ACT ${this.node.act} CLEARED`, sub: 'Act chest dropped at the reactor · curses lifted · the next act is harder', tone: 'orange' });
      sfx.play('bank', { pitch: 0.8 });
    } else uiEvents.emit('alert', { text: 'NODE SECURED · OPEN THE MAP (H) WHEN READY', tone: 'blue' });
    this.showExit();
  }

  /** Carry for the next node (towers are refunded into cores). */
  exportCarry(): RunCarry {
    const h = this.h;
    const c = structuredClone(this.carry);
    c.wave = Math.max(c.wave, this.combat ? this.to : c.wave);
    c.cores = h.cores + towerRefund(h.towers());
    c.reactorHp = h.reactorHp;
    c.ult = h.ult;
    c.build = { stacks: [...h.build.stacks], picks: h.build.picks.map((p) => ({ ...p })), offers: h.build.offers };
    c.loadout = { ...h.loadout() };
    c.lootCounter = h.lootCounter;
    c.dealt = { player: c.dealt.player + h.dealt.player, tower: c.dealt.tower + h.dealt.tower };
    return c;
  }

  /** Statistics continue across arenas: damage dealt in earlier nodes. */
  get dealtBefore(): { player: number; tower: number } {
    return this.carry.dealt;
  }

  // ------------------------------------------------------------------ stations

  private stationSpot(i: number, n: number): Vector3 {
    const L = this.h.layout;
    const sp = L.playerSpawn;
    const base = Math.atan2(sp.x - L.reactor.x, sp.z - L.reactor.z);
    const a = base + (n === 1 ? 0 : (i - (n - 1) / 2) * 0.62);
    return new Vector3(L.reactor.x + Math.sin(a) * 11, 0, L.reactor.z + Math.cos(a) * 11);
  }

  private addStation(kind: StationKind, at: Vector3): void {
    const rig = buildStation(this.h.scene, this.h.kit, this.h.pal, kind);
    rig.root.position.copyFrom(at);
    const L = this.h.layout;
    rig.root.rotation.y = Math.atan2(L.reactor.x - at.x, L.reactor.z - at.z) + Math.PI;
    this.stations.push({ kind, rig, at, used: false });
  }

  private buildStations(): void {
    const kind = this.node.kind as StationKind;
    this.addStation(kind, this.stationSpot(0, 1));
    this.showExit();
  }

  private showExit(): void {
    if (this.exitShown) return;
    this.exitShown = true;
    const L = this.h.layout;
    const sp = L.playerSpawn;
    const dx = sp.x - L.reactor.x;
    const dz = sp.z - L.reactor.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = Math.min(d - 3, 17);
    this.addStation('exit', new Vector3(L.reactor.x + (dx / d) * r + (dz / d) * 5, 0, L.reactor.z + (dz / d) * r - (dx / d) * 5));
  }

  private stockMerchant(): void {
    const s = merchantStock(this.node.seed, this.from, this.h.riftLevel);
    // Item level from the segment start (not the live wave), so the server and every replica show the same items.
    this.stock = s.items.map((offer) => ({ offer, item: this.h.makeItem(offer, this.h.lootLevelAt(this.from) + 2), sold: false }));
  }

  private servicePrices(): Record<ServiceId, number> {
    return merchantStock(this.node.seed, this.from, this.h.riftLevel).services;
  }

  /** Per-frame: station animation, targeting, E to use, guardian spawning, owed upgrade picks. */
  update(dt: number, hdt: number, controls: boolean, pressedE: boolean): void {
    this.t += dt;
    for (const s of this.stations) s.rig.update(this.t);
    if (this.replica) {
      this.target = this.pick(controls);
      if (pressedE && this.target) this.use(this.target.kind);
      return;
    }
    if (this.guard) this.updateGuard(hdt);
    if (this.carry.picks > 0 && this.h.screenPlaying() && this.h.waves.phase === 'prep' && !this.guard) {
      this.carry.picks--;
      this.h.openUpgrade();
      return;
    }
    this.target = this.pick(controls);
    if (pressedE && this.target) this.use(this.target.kind);
  }

  private pick(controls: boolean): (typeof this.stations)[number] | null {
    if (!controls) return null;
    const cands = this.stations.map((s, i) => ({ id: String(i), point: { x: s.at.x, y: s.at.y + s.rig.focusY, z: s.at.z }, range: 6.5 }));
    const hit = pickInteractable(cands, this.h.playerEye(), this.h.playerDir(), { maxAngle: 0.5, targetRadius: 1.4 });
    return hit ? this.stations[Number(hit.id)] : null;
  }

  private use(kind: StationKind): void {
    if (kind === 'exit') {
      if (this.guard) return void uiEvents.emit('alert', { text: 'DEFEAT THE GUARDIANS FIRST', tone: 'orange' });
      if (!this.complete) return void uiEvents.emit('alert', { text: 'SECURE THE NODE FIRST', tone: 'orange' });
      sfx.play('ui');
      this.h.openMap();
      return;
    }
    this.panelStation = kind;
    this.note = '';
    sfx.play('ui');
    this.h.openPanel();
  }

  /** Station prompt + node progress for the HUD. */
  hud(): NodeHud {
    const k = NODE_KINDS[this.node.kind];
    const t = this.target;
    let prompt: NodeHud['prompt'] = null;
    if (t) {
      const title = t.kind === 'exit' ? 'RIFT EXIT' : t.kind === 'event' ? ANOMALIES[this.node.anomaly ?? 'siphon'].name.toUpperCase() : NODE_KINDS[t.kind].name.toUpperCase();
      const sub = t.kind === 'exit' ? (this.complete ? 'Open the run map · travel or extract' : 'Secure the node first') : t.kind === 'vault' && this.vaultState !== 'sealed' ? (this.vaultState === 'open' ? 'Guardians active' : 'Looted') : NODE_KINDS[t.kind].blurb;
      prompt = { title, sub, used: t.used };
    }
    return {
      id: this.node.id,
      act: this.node.act,
      row: this.node.row,
      kind: this.node.kind,
      name: `${this.node.actBoss ? 'Act Boss · ' : ''}${k.name}`,
      glyph: k.glyph,
      waves: this.combat ? [this.from, this.to] : null,
      complete: this.complete,
      mods: [...this.node.mods],
      curses: [...this.carry.curses],
      blessings: [...this.carry.blessings],
      noTowers: this.noTowers,
      prompt,
      guardians: this.replica ? this.net?.g ?? null : this.guard ? this.guard.spawns.length - this.guard.cursor + this.h.enemiesAlive() : null,
    };
  }

  // ------------------------------------------------------------------ co-op replication

  /** Node state replicas mirror (snapshot field `nd`). */
  netState(): NodeNet {
    return {
      c: this.complete ? 1 : 0,
      g: this.guard ? this.guard.spawns.length - this.guard.cursor + this.h.enemiesAlive() : null,
      sold: this.stock.filter((x) => x.sold).map((x) => x.offer.key),
      r: this.restUsed ? 1 : 0,
      e: this.eventUsed ? 1 : 0,
      v: this.vaultState,
      f: { ...this.carry.forge },
      cu: [...this.carry.curses],
      bl: [...this.carry.blessings],
      n: this.note,
    };
  }

  /** Replica: adopt the server's node state. */
  applyNet(n: NodeNet): void {
    this.net = n;
    const was = this.complete;
    this.complete = !!n.c;
    if (this.complete && !was && this.combat) this.showExit();
    for (const s of this.stock) s.sold = n.sold.includes(s.offer.key);
    this.restUsed = !!n.r;
    this.eventUsed = !!n.e;
    this.vaultState = n.v;
    this.carry.forge = { ...n.f };
    this.carry.curses = [...n.cu] as RunCarry['curses'];
    this.carry.blessings = [...n.bl] as RunCarry['blessings'];
    if (n.n) this.note = n.n;
    if (this.restUsed) this.markUsed('rest');
    if (this.eventUsed) this.markUsed('event');
    if (this.vaultState !== 'sealed') this.markUsed('vault');
  }

  // ------------------------------------------------------------------ station panels

  panel(): StationPanel | null {
    const st = this.panelStation;
    if (!st || st === 'exit') return null;
    const cores = this.h.cores;
    const afford = (p: number) => (cores >= p ? null : 'Not enough cores');
    const base = { cores, note: this.note };
    switch (st) {
      case 'merchant': {
        const sp = this.servicePrices();
        const items: StationOption[] = this.stock.map((s) => ({ id: s.offer.key, label: s.item.name, text: `${s.offer.rarity} ${s.offer.category} · level ${s.item.level}`, price: s.offer.price, disabled: s.sold ? 'Sold' : afford(s.offer.price), item: s.item }));
        const services: StationOption[] = SERVICE_IDS.map((id) => ({
          id: `svc:${id}`,
          label: SERVICES[id].name,
          text: SERVICES[id].text,
          price: sp[id],
          disabled: id === 'purge' && !this.carry.curses.length ? 'No curse to purge' : id === 'repair' && this.h.survival ? 'No reactor in survival' : id === 'repair' && this.h.reactorHp >= this.h.reactorMax ? 'Reactor intact' : afford(sp[id]),
        }));
        return { ...base, station: st, title: 'RIFT MERCHANT', lore: 'Cores spend here; items land in your cargo and bank when you leave the node.', options: [...items, ...services], used: false };
      }
      case 'forge':
        return {
          ...base,
          station: st,
          title: 'FIELD FORGE',
          lore: 'Tempering lasts for this run only.',
          options: FORGE_IDS.map((id) => {
            const n = this.carry.forge[id] ?? 0;
            const p = forgePrice(id, this.from, n);
            return { id, label: `${FORGE[id].name} ${n ? `(${n}/${FORGE[id].max})` : ''}`.trim(), text: FORGE[id].text, price: p, disabled: id === 'calibrate' && this.h.survival ? 'No towers in survival' : n >= FORGE[id].max ? 'Maxed' : afford(p) };
          }),
          used: false,
        };
      case 'rest':
        return {
          ...base,
          station: st,
          title: 'SAFE HARBOUR',
          lore: 'Choose one. The harbour seals once you have rested.',
          options: REST_IDS.map((id) => ({ id, label: REST[id].name, text: id === 'repair' && this.h.survival ? 'Drone hull and shield to full, a fresh tactical charge.' : REST[id].text, price: null, disabled: this.restUsed ? 'Already rested' : id === 'purge' && !this.carry.curses.length ? 'No curse to purge' : null })),
          used: this.restUsed,
        };
      case 'event': {
        const a = ANOMALIES[this.node.anomaly ?? 'siphon'];
        return { ...base, station: st, title: a.name.toUpperCase(), lore: a.lore, options: a.choices.map((c) => ({ id: c.id, label: c.label, text: c.text, price: null, disabled: this.eventUsed ? 'The anomaly is spent' : null })), used: this.eventUsed };
      }
      case 'vault':
        return {
          ...base,
          station: st,
          title: 'SEALED VAULT',
          lore: 'Cracking the seal wakes its guardians. They go for the reactor.',
          options: [{ id: 'open', label: 'Crack the seal', text: `Elite guardians attack · vault cache + ${GUARDIAN.cacheShards} shards`, price: null, disabled: this.vaultState === 'sealed' ? null : this.vaultState === 'open' ? 'Guardians active' : 'Looted' }],
          used: this.vaultState !== 'sealed',
        };
    }
    return null;
  }

  /** Use a panel option. Returns a refusal reason or null. */
  act(id: string): string | null {
    const st = this.panelStation;
    if (this.replica) {
      if (!st || st === 'exit') return 'Nothing to use';
      this.h.sendStation(st, id);
      this.note = 'Request sent…';
      return null;
    }
    const h = this.h;
    const pay = (p: number): boolean => {
      if (h.cores < p) return false;
      h.cores -= p;
      return true;
    };
    let why: string | null = null;
    switch (st) {
      case 'merchant': {
        const s = this.stock.find((x) => x.offer.key === id);
        if (s) {
          if (s.sold) return 'Sold';
          if (h.cores < s.offer.price) return 'Not enough cores';
          if (!h.grantItem(s.item)) return 'Cargo hold full';
          pay(s.offer.price);
          s.sold = true;
          this.note = `${s.item.name} added to cargo.`;
          break;
        }
        const svc = id.startsWith('svc:') ? (id.slice(4) as ServiceId) : null;
        if (!svc || !SERVICES[svc]) return 'Unknown offer';
        const p = this.servicePrices()[svc];
        if (svc === 'purge' && !this.carry.curses.length) return 'No curse to purge';
        if (svc === 'repair' && h.survival) return 'No reactor in survival';
        if (svc === 'repair' && h.reactorHp >= h.reactorMax) return 'Reactor intact';
        if (!pay(p)) return 'Not enough cores';
        if (svc === 'repair') h.reactorHp = h.reactorMax;
        if (svc === 'upgrade') this.carry.picks++;
        if (svc === 'purge') this.purge();
        this.note = `${SERVICES[svc].name} done.`;
        break;
      }
      case 'forge': {
        const f = id as ForgeId;
        if (!FORGE[f]) return 'Unknown option';
        const n = this.carry.forge[f] ?? 0;
        if (n >= FORGE[f].max) return 'Maxed';
        if (f === 'calibrate' && h.survival) return 'No towers in survival';
        if (!pay(forgePrice(f, this.from, n))) return 'Not enough cores';
        this.carry.forge[f] = n + 1;
        h.rebuildStats();
        this.note = `${FORGE[f].name}: ${FORGE[f].text}.`;
        break;
      }
      case 'rest': {
        const r = id as RestId;
        if (this.restUsed) return 'Already rested';
        if (!REST[r]) return 'Unknown option';
        if (r === 'purge' && !this.carry.curses.length) return 'No curse to purge';
        this.restUsed = true;
        if (r === 'repair') {
          if (h.survival) h.healDrone();
          else h.reactorHp = h.reactorMax;
          h.tacticalRefill();
        }
        if (r === 'reflect') this.carry.picks++;
        if (r === 'purge') this.purge();
        this.note = `${REST[r].name}: ${REST[r].text}`;
        this.markUsed('rest');
        break;
      }
      case 'event':
        why = this.resolveEvent(id);
        break;
      case 'vault':
        if (this.vaultState !== 'sealed') return 'Vault already open';
        this.vaultState = 'open';
        this.markUsed('vault');
        this.startGuardians('vault', [{ source: 'eliteCache', minRarity: 'rare' }]);
        this.note = 'The seal breaks. Guardians inbound.';
        break;
      default:
        return 'Nothing to use';
    }
    if (!why) sfx.play('equip', { pitch: 1.2 });
    return why;
  }

  private purge(): void {
    const c = purgeCurse(this.carry);
    if (c) this.h.rebuildStats();
  }

  private markUsed(kind: StationKind): void {
    for (const s of this.stations) if (s.kind === kind) (s.used = true), s.rig.setUsed(true);
  }

  private resolveEvent(choice: string): string | null {
    if (this.eventUsed) return 'The anomaly is spent';
    const id = this.node.anomaly ?? 'siphon';
    const out = resolveAnomaly(id, choice, this.carry, { cores: this.h.cores }, this.rand);
    if (!out) return 'Unknown choice';
    this.eventUsed = true;
    this.markUsed('event');
    const h = this.h;
    h.cores = Math.max(0, h.cores + out.cores);
    if (out.shards) h.run.collect({ shards: out.shards });
    this.carry.picks += out.picks;
    const at = this.stations.find((s) => s.kind === 'event')?.at.add(new Vector3(0, 3, 0)) ?? new Vector3(0, 3, 0);
    if (out.ambush) this.startGuardians('ambush', out.items);
    else for (const it of out.items) h.dropFrom({ ...DROP_SOURCES[it.source], minRarity: it.minRarity, rolls: 1, chance: 1 }, at);
    if (out.curse || out.purged || out.blessing) h.rebuildStats();
    const extra = [out.curse ? `Curse: ${out.curse}` : '', out.blessing ? `Blessing: ${out.blessing}` : '', out.purged ? `Purged: ${out.purged}` : ''].filter(Boolean).join(' · ');
    this.note = `${out.text}${extra ? ` (${extra})` : ''}`;
    uiEvents.emit('alert', { text: out.text.toUpperCase(), tone: out.tone === 'bad' ? 'red' : out.tone === 'good' ? 'blue' : 'orange' });
    return null;
  }

  // ------------------------------------------------------------------ guardians (vault, ambush)

  private startGuardians(reward: 'vault' | 'ambush', items: { source: 'eliteCache' | 'checkpoint' | 'boss'; minRarity: RarityId }[]): void {
    const base = this.h.waves.wave;
    const wave: WaveDef = { ...base, hpMult: base.hpMult * GUARDIAN.budget };
    this.guard = { spawns: base.spawns.slice(0, 40), wave, elapsed: 0, cursor: 0, reward, items };
    this.complete = false;
    uiEvents.emit('banner', { title: reward === 'vault' ? 'VAULT GUARDIANS' : 'AMBUSH', sub: `${this.guard.spawns.length} hostiles · defend the reactor`, tone: 'red' });
    sfx.play('waveStart');
    music.sting('waveStart');
  }

  private updateGuard(hdt: number): void {
    const g = this.guard!;
    g.elapsed += hdt;
    while (g.cursor < g.spawns.length && g.spawns[g.cursor].time <= g.elapsed && this.h.enemiesAlive() < 42) this.h.spawnEntry(g.spawns[g.cursor++], g.wave);
    if (g.cursor < g.spawns.length || this.h.enemiesAlive() > 0) return;
    this.guard = null;
    this.complete = true;
    if (g.reward === 'vault') this.vaultState = 'looted';
    const at = this.stations.find((s) => s.kind === (g.reward === 'vault' ? 'vault' : 'event'))?.at.add(new Vector3(0, 3, 0)) ?? new Vector3(0, 3, 0);
    for (const it of g.items) this.h.dropFrom({ ...DROP_SOURCES[it.source], minRarity: it.minRarity }, at);
    const credits = GUARDIAN.credits(this.from);
    this.h.run.collect({ shards: g.reward === 'vault' ? GUARDIAN.cacheShards : 1, credits });
    uiEvents.emit('banner', { title: g.reward === 'vault' ? 'VAULT CRACKED' : 'AMBUSH REPELLED', sub: `Cache dropped · +${credits} cr · shards secured when you leave`, tone: 'cyan' });
    sfx.play('waveClear');
    music.sting('waveClear');
  }

  get guardiansActive(): boolean {
    return this.replica ? this.net?.g != null : !!this.guard;
  }

  dispose(): void {
    for (const s of this.stations) s.rig.dispose();
    this.stations = [];
  }
}
