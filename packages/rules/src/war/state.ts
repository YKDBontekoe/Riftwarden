import { mulberry32 } from '../combat/damage';
import { isCombatKind } from '../runmap/defs';
import { h32 } from '../runmap/map';
import { type RegionDef, regionLayout } from './regions';

/**
 * The Rift War (pure): one shared war for every player, solo and co-op, advanced in real time by the server.
 *
 *  - Securing a combat node adds liberation: `baseGain x players / average players online` (24 h average, at
 *    least 1), so a region falls in about a day of normal activity whatever the population.
 *  - Enemy resistance claws back liberation every hour on nodes nobody finished.
 *  - Rift corruption spreads from the region's rift source every few hours; a liberated node is threatened first
 *    (a defense event: secure it in time or it falls). Securing a corrupted node purges it. A region whose combat
 *    nodes are all corrupted falls back: every node becomes a corrupted variant until players push it back.
 *  - Distress calls (double liberation) and rift convoys (a courier moving along the links) appear on timers.
 *  - One war order per active region (a shared objective); completing it buffs every run for a day.
 *  - A region whose combat nodes are all liberated is conquered and the next region unlocks.
 * Hourly steps are seeded by (war seed, hour index), so every server replays the same war from the same reports.
 */

export const WAR = {
  /** Liberation % a secured node gives with one player online. */
  baseGain: 9,
  /** Liberation lost per hour on unfinished nodes. */
  resistPerHour: 1.5,
  /** Hours between corruption steps in a region. */
  corruptEvery: 4,
  /** Hours a threatened liberated node holds out. */
  defenseHours: 6,
  distressEvery: 3,
  distressChance: 0.6,
  distressHours: 6,
  convoyEvery: 8,
  convoyHours: 6,
  orderHours: 24,
  buffHours: 24,
  /** The capital is a stronghold until the region reaches this liberation (%). */
  strongholdBelow: 60,
  logMax: 80,
  /** Catch-up cap after downtime (hours). */
  maxCatchUp: 72,
};

export const HOUR = 3_600_000;

export interface WarNodeState {
  /** Liberation 0..100 (combat nodes; hubs follow their neighbours). */
  lib: number;
  corrupt: boolean;
}

export interface WarRegionState {
  k: number;
  status: 'active' | 'liberated';
  nodes: Record<string, WarNodeState>;
  fallbacks: number;
  liberatedAt?: number;
}

export type WarEventKind = 'distress' | 'defense' | 'convoy';
export interface WarEvent {
  id: string;
  kind: WarEventKind;
  region: number;
  node: string;
  until: number;
}

export type OrderKind = 'secure' | 'elites' | 'survival' | 'purge';
export interface WarOrder {
  id: string;
  region: number;
  kind: OrderKind;
  target: number;
  progress: number;
  until: number;
  reward: 'luck' | 'income';
}

export interface WarBuff {
  kind: 'luck' | 'income';
  mult: number;
  until: number;
}

export type WarLogKind = 'liberated' | 'corrupted' | 'purged' | 'threat' | 'repelled' | 'fell' | 'distress' | 'convoy' | 'convoyDown' | 'order' | 'orderDone' | 'orderFailed' | 'region' | 'fallback' | 'resist';
export interface WarLogEntry {
  t: number;
  kind: WarLogKind;
  region: number;
  node?: string;
  text: string;
}

export interface WarState {
  v: 1;
  seed: number;
  season: number;
  /** Last processed hour index (epoch hours). */
  hour: number;
  regions: WarRegionState[];
  events: WarEvent[];
  order: WarOrder | null;
  buffs: WarBuff[];
  log: WarLogEntry[];
  /** Average players online over the last day (server sampled; >= 1). */
  avgOnline: number;
  /** Secured nodes reported (statistics). */
  secured: number;
  updatedAt: number;
}

const combatIds = (def: RegionDef): string[] => def.nodes.filter((n) => isCombatKind(n.kind)).map((n) => n.id);

function newRegion(seed: number, k: number): WarRegionState {
  const def = regionLayout(seed, k);
  const nodes: Record<string, WarNodeState> = {};
  for (const id of combatIds(def)) nodes[id] = { lib: 0, corrupt: id === def.rift };
  return { k, status: 'active', nodes, fallbacks: 0 };
}

export function newWar(seed: number, now: number, season = 1): WarState {
  return { v: 1, seed: seed >>> 0 || 1, season, hour: Math.floor(now / HOUR), regions: [newRegion(seed, 0)], events: [], order: null, buffs: [], log: [], avgOnline: 1, secured: 0, updatedAt: now };
}

export function regionState(s: WarState, k: number): WarRegionState | null {
  return s.regions.find((r) => r.k === k) ?? null;
}

/** Region liberation 0..100 (mean of its combat nodes; corrupted nodes count 0). */
export function regionLiberation(s: WarState, k: number): number {
  const r = regionState(s, k);
  if (!r) return 0;
  if (r.status === 'liberated') return 100;
  const list = Object.values(r.nodes);
  return list.length ? list.reduce((a, n) => a + (n.corrupt ? 0 : n.lib), 0) / list.length : 0;
}

/** Node liberation (hubs: the mean of their combat neighbours). */
export function nodeLiberation(s: WarState, id: string, def: RegionDef): number {
  const r = regionState(s, def.k);
  if (!r) return 0;
  if (r.status === 'liberated') return 100;
  const own = r.nodes[id];
  if (own) return own.corrupt ? 0 : own.lib;
  const n = def.nodes.find((x) => x.id === id);
  const near = (n?.links ?? []).map((l) => r.nodes[l]).filter((x): x is WarNodeState => !!x);
  return near.length ? near.reduce((a, x) => a + (x.corrupt ? 0 : x.lib), 0) / near.length : 0;
}

function log(s: WarState, now: number, kind: WarLogKind, region: number, text: string, node?: string): void {
  s.log.unshift({ t: now, kind, region, node, text });
  if (s.log.length > WAR.logMax) s.log.length = WAR.logMax;
}

const nodeName = (def: RegionDef, id: string): string => {
  const n = def.nodes.find((x) => x.id === id);
  return n ? `${def.name} ${n.actBoss ? 'capital' : `sector ${n.col + 1}`}` : def.name;
};

/** Advance the war to `now` in whole hours (deterministic per hour index). Returns true when anything changed. */
export function tickWar(s: WarState, now: number, avgOnline = s.avgOnline): boolean {
  s.avgOnline = Math.max(1, avgOnline);
  const target = Math.floor(now / HOUR);
  if (target <= s.hour) return false;
  const from = Math.max(s.hour + 1, target - WAR.maxCatchUp);
  for (let h = from; h <= target; h++) stepHour(s, h, h * HOUR);
  s.hour = target;
  s.updatedAt = now;
  return true;
}

function stepHour(s: WarState, h: number, now: number): void {
  const r = mulberry32(h32(s.seed, h, 0x7a3));
  s.buffs = s.buffs.filter((b) => b.until > now);
  // Expired events: a threatened node that nobody defended falls to the rift.
  for (const e of s.events.filter((x) => x.until <= now)) {
    const reg = regionState(s, e.region);
    const def = regionLayout(s.seed, e.region);
    if (e.kind === 'defense' && reg?.status === 'active' && reg.nodes[e.node]) {
      reg.nodes[e.node] = { lib: 0, corrupt: true };
      log(s, now, 'fell', e.region, `${nodeName(def, e.node)} fell to the rift`, e.node);
    }
  }
  s.events = s.events.filter((x) => x.until > now);
  if (s.order && s.order.until <= now) {
    log(s, now, 'orderFailed', s.order.region, 'War order failed');
    s.order = null;
  }
  for (const reg of s.regions) {
    if (reg.status !== 'active') continue;
    const def = regionLayout(s.seed, reg.k);
    // Resistance: unfinished nodes lose ground.
    for (const n of Object.values(reg.nodes)) if (!n.corrupt && n.lib > 0 && n.lib < 100) n.lib = Math.max(0, n.lib - WAR.resistPerHour);
    // Corruption spreads (offset per region so regions do not all pulse on the same hour).
    if ((h + reg.k) % WAR.corruptEvery === 0) spreadCorruption(s, reg, def, r, now);
    // Fallback: every combat node corrupted.
    if (Object.values(reg.nodes).every((n) => n.corrupt)) {
      reg.fallbacks++;
      for (const n of Object.values(reg.nodes)) (n.lib = 0), (n.corrupt = true);
      s.events = s.events.filter((e) => e.region !== reg.k);
      log(s, now, 'fallback', reg.k, `${def.name} has fallen to the rift: every sector is corrupted`);
    }
    // Distress calls.
    if (h % WAR.distressEvery === 0 && r() < WAR.distressChance && !s.events.some((e) => e.region === reg.k && e.kind === 'distress')) {
      const pool = Object.entries(reg.nodes).filter(([, n]) => !n.corrupt && n.lib < 100).map(([id]) => id);
      if (pool.length) {
        const id = pool[Math.floor(r() * pool.length) % pool.length];
        s.events.push({ id: `d${h}.${reg.k}`, kind: 'distress', region: reg.k, node: id, until: now + WAR.distressHours * HOUR });
        log(s, now, 'distress', reg.k, `Distress call from ${nodeName(def, id)}: double liberation for ${WAR.distressHours} h`, id);
      }
    }
    // Rift convoys: start near the rift source, move one link per hour.
    const convoy = s.events.find((e) => e.region === reg.k && e.kind === 'convoy');
    if (convoy) {
      const at = def.nodes.find((n) => n.id === convoy.node);
      const next = (at?.links ?? []).filter((l) => reg.nodes[l]);
      if (next.length) convoy.node = next[Math.floor(r() * next.length) % next.length];
    } else if ((h + reg.k * 3) % WAR.convoyEvery === 0) {
      s.events.push({ id: `c${h}.${reg.k}`, kind: 'convoy', region: reg.k, node: def.rift, until: now + WAR.convoyHours * HOUR });
      log(s, now, 'convoy', reg.k, `A rift convoy left the ${def.name} rift source`, def.rift);
    }
    // One war order at a time.
    if (!s.order) {
      const kinds: OrderKind[] = ['secure', 'elites', 'survival', 'purge'];
      const kind = kinds[Math.floor(r() * kinds.length) % kinds.length];
      const target = kind === 'secure' ? 6 : kind === 'elites' ? 2 : kind === 'survival' ? 3 : 2;
      s.order = { id: `o${h}`, region: reg.k, kind, target, progress: 0, until: now + WAR.orderHours * HOUR, reward: r() < 0.5 ? 'luck' : 'income' };
      log(s, now, 'order', reg.k, `New war order: ${orderText(s.order)}`);
    }
  }
}

function spreadCorruption(s: WarState, reg: WarRegionState, def: RegionDef, r: () => number, now: number): void {
  // Candidates: combat nodes next to a corrupted node (hubs pass corruption on to their neighbours).
  const corrupted = new Set(Object.entries(reg.nodes).filter(([, n]) => n.corrupt).map(([id]) => id));
  if (!corrupted.size) {
    // A purged region re-seeds at its rift source.
    reg.nodes[def.rift] = { lib: 0, corrupt: true };
    log(s, now, 'corrupted', reg.k, `The ${def.name} rift source tore open again`, def.rift);
    return;
  }
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const cand = new Set<string>();
  for (const id of corrupted) {
    for (const l of byId.get(id)?.links ?? []) {
      const ln = byId.get(l);
      if (!ln) continue;
      if (reg.nodes[l] && !reg.nodes[l].corrupt) cand.add(l);
      else if (!reg.nodes[l]) for (const l2 of ln.links) if (reg.nodes[l2] && !reg.nodes[l2].corrupt) cand.add(l2);
    }
  }
  const list = [...cand].filter((id) => !s.events.some((e) => e.kind === 'defense' && e.node === id));
  if (!list.length) return;
  list.sort((a, b) => reg.nodes[a].lib - reg.nodes[b].lib || (r() < 0.5 ? -1 : 1));
  const id = list[0];
  if (reg.nodes[id].lib >= 100) {
    s.events.push({ id: `t${s.hour}.${id}`, kind: 'defense', region: reg.k, node: id, until: now + WAR.defenseHours * HOUR });
    log(s, now, 'threat', reg.k, `Corruption threatens liberated ${nodeName(def, id)}: defend it within ${WAR.defenseHours} h`, id);
  } else {
    reg.nodes[id] = { lib: 0, corrupt: true };
    log(s, now, 'corrupted', reg.k, `Corruption spread to ${nodeName(def, id)}`, id);
  }
}

export function orderText(o: WarOrder): string {
  const what = o.kind === 'secure' ? 'Secure sectors' : o.kind === 'elites' ? 'Secure elite sectors' : o.kind === 'survival' ? 'Secure sectors in survival mode' : 'Purge corrupted sectors';
  return `${what} (${o.progress}/${o.target}) · reward: ${o.reward === 'luck' ? '+20% loot luck' : '+25% income'} for every warden for ${WAR.buffHours} h`;
}

export interface SecureReport {
  node: string;
  mode: 'defense' | 'survival';
  /** Wardens who secured it (co-op team size). */
  players: number;
}

export interface SecureResult {
  ok: boolean;
  reason?: string;
  gain: number;
  lib: number;
  messages: string[];
}

/** A node was secured (five waves cleared). Applies liberation, purges, repels threats, advances the order. */
export function secureNode(s: WarState, rep: SecureReport, now: number): SecureResult {
  const out: SecureResult = { ok: false, gain: 0, lib: 0, messages: [] };
  const m = /^r(\d+)n(\d+)$/.exec(rep.node);
  const reg = m ? regionState(s, Number(m[1])) : null;
  if (!m || !reg) return { ...out, reason: 'Unknown or locked node' };
  const def = regionLayout(s.seed, reg.k);
  const n = reg.nodes[rep.node];
  if (!n) return { ...out, reason: 'Not a combat sector' };
  if (reg.status === 'liberated') return { ...out, ok: true, lib: 100, reason: 'Region already liberated' };
  const players = Math.max(1, Math.min(4, Math.floor(rep.players)));
  const distress = s.events.find((e) => e.kind === 'distress' && e.node === rep.node);
  let gain = (WAR.baseGain * players) / Math.max(1, s.avgOnline);
  if (distress) gain *= 2;
  const wasCorrupt = n.corrupt;
  if (wasCorrupt) {
    n.corrupt = false;
    n.lib = Math.max(n.lib, 0);
    out.messages.push('Corruption purged');
    log(s, now, 'purged', reg.k, `Wardens purged the corruption at ${nodeName(def, rep.node)}`, rep.node);
  }
  const threat = s.events.find((e) => e.kind === 'defense' && e.node === rep.node);
  if (threat) {
    s.events = s.events.filter((e) => e !== threat);
    out.messages.push('Threat repelled');
    log(s, now, 'repelled', reg.k, `${nodeName(def, rep.node)} held against the rift`, rep.node);
  }
  const convoy = s.events.find((e) => e.kind === 'convoy' && e.node === rep.node);
  if (convoy) {
    s.events = s.events.filter((e) => e !== convoy);
    out.messages.push('Convoy destroyed');
    log(s, now, 'convoyDown', reg.k, `A rift convoy was destroyed at ${nodeName(def, rep.node)}`, rep.node);
  }
  const before = n.lib;
  n.lib = Math.min(100, n.lib + gain);
  if (before < 100 && n.lib >= 100) {
    out.messages.push('Sector liberated');
    log(s, now, 'liberated', reg.k, `${nodeName(def, rep.node)} liberated`, rep.node);
  }
  s.secured++;
  // War order.
  const o = s.order;
  if (o && o.region === reg.k) {
    const kind = def.nodes.find((x) => x.id === rep.node)?.kind;
    const counts = o.kind === 'secure' || (o.kind === 'elites' && kind === 'elite') || (o.kind === 'survival' && rep.mode === 'survival') || (o.kind === 'purge' && wasCorrupt);
    if (counts) {
      o.progress++;
      if (o.progress >= o.target) {
        s.buffs.push({ kind: o.reward, mult: o.reward === 'luck' ? 1.2 : 1.25, until: now + WAR.buffHours * HOUR });
        log(s, now, 'orderDone', reg.k, `War order complete: ${o.reward === 'luck' ? '+20% loot luck' : '+25% income'} for every warden`);
        out.messages.push('War order complete');
        s.order = null;
      }
    }
  }
  // Conquest: every combat node liberated -> the next region opens.
  if (Object.values(reg.nodes).every((x) => !x.corrupt && x.lib >= 100)) {
    reg.status = 'liberated';
    reg.liberatedAt = now;
    s.events = s.events.filter((e) => e.region !== reg.k);
    if (s.order?.region === reg.k) s.order = null;
    log(s, now, 'region', reg.k, `${def.name} liberated: the front moves on`);
    if (!regionState(s, reg.k + 1)) s.regions.push(newRegion(s.seed, reg.k + 1));
    out.messages.push('Region liberated');
  }
  s.updatedAt = now;
  return { ok: true, gain, lib: n.lib, messages: out.messages };
}

/** Live war modifiers on a node. */
export function liveMods(s: WarState, id: string): ('corrupted' | 'stronghold' | 'distress' | 'defense' | 'convoy')[] {
  const m = /^r(\d+)n(\d+)$/.exec(id);
  if (!m) return [];
  const k = Number(m[1]);
  const reg = regionState(s, k);
  if (!reg || reg.status !== 'active') return [];
  const out: ('corrupted' | 'stronghold' | 'distress' | 'defense' | 'convoy')[] = [];
  if (reg.nodes[id]?.corrupt) out.push('corrupted');
  if (regionLayout(s.seed, k).capital === id && regionLiberation(s, k) < WAR.strongholdBelow) out.push('stronghold');
  for (const e of s.events) if (e.node === id) out.push(e.kind);
  return out;
}

/** War-wide buffs as a node effect (order rewards). */
export function buffEffect(s: WarState | null, now: number): { luck?: number; income?: number } {
  const e: { luck?: number; income?: number } = {};
  for (const b of s?.buffs ?? []) if (b.until > now) e[b.kind] = (e[b.kind] ?? 1) * b.mult;
  return e;
}

/** Can a run enter this node (its region is unlocked)? */
export function playable(s: WarState, id: string): boolean {
  const m = /^r(\d+)n(\d+)$/.exec(id);
  return !!m && !!regionState(s, Number(m[1])) && Number(m[2]) < regionLayout(s.seed, Number(m[1])).nodes.length;
}

/** Validate a war state from the network or storage (untrusted). Returns null when unusable. */
export function sanitizeWar(raw: unknown): WarState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number, lo = 0, hi = 1e15) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  if (r.v !== 1 || typeof r.seed !== 'number') return null;
  const regions: WarRegionState[] = [];
  for (const x of Array.isArray(r.regions) ? r.regions.slice(0, 10000) : []) {
    const o = x as Record<string, unknown>;
    if (typeof o?.k !== 'number') continue;
    const nodes: Record<string, WarNodeState> = {};
    for (const [id, v] of Object.entries((o.nodes ?? {}) as Record<string, unknown>)) {
      if (!/^r\d+n\d+$/.test(id) || !v || typeof v !== 'object') continue;
      const nv = v as Record<string, unknown>;
      nodes[id] = { lib: num(nv.lib, 0, 0, 100), corrupt: nv.corrupt === true };
    }
    regions.push({ k: Math.floor(num(o.k, 0, 0, 1e5)), status: o.status === 'liberated' ? 'liberated' : 'active', nodes, fallbacks: Math.floor(num(o.fallbacks, 0)), liberatedAt: typeof o.liberatedAt === 'number' ? o.liberatedAt : undefined });
  }
  if (!regions.length) return null;
  const evKinds: WarEventKind[] = ['distress', 'defense', 'convoy'];
  const events = (Array.isArray(r.events) ? r.events : []).filter((e): e is WarEvent => !!e && evKinds.includes((e as WarEvent).kind) && typeof (e as WarEvent).node === 'string').slice(0, 200);
  const o = r.order as WarOrder | null;
  const order = o && typeof o === 'object' && typeof o.kind === 'string' && typeof o.target === 'number' ? o : null;
  const buffs = (Array.isArray(r.buffs) ? r.buffs : []).filter((b): b is WarBuff => !!b && ((b as WarBuff).kind === 'luck' || (b as WarBuff).kind === 'income')).slice(0, 20);
  const logs = (Array.isArray(r.log) ? r.log : []).filter((l): l is WarLogEntry => !!l && typeof (l as WarLogEntry).text === 'string').slice(0, WAR.logMax);
  return { v: 1, seed: r.seed >>> 0 || 1, season: Math.floor(num(r.season, 1, 1)), hour: Math.floor(num(r.hour, 0)), regions, events, order, buffs, log: logs, avgOnline: num(r.avgOnline, 1, 1, 1e6), secured: Math.floor(num(r.secured, 0)), updatedAt: num(r.updatedAt, 0) };
}
