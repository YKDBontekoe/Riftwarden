// The shared Rift War as a stored document plus pure steps (architecture v2 step 6). The gateway holds the
// document, the rules worker runs these steps: sample the population, advance the war in hourly steps, apply a
// secured-node report. No I/O, no clock: everything is passed in.
import { isCombatKind } from '../runmap/defs';
import { regionLayout } from './regions';
import { newWar, playable, sanitizeWar, secureNode, type SecureResult, tickWar, type WarState } from './state';

/** Online samples: one per 10 minutes, the last 24 hours. */
export const SAMPLE_MS = 10 * 60_000;
export const SAMPLES = 144;

export interface StoredWar {
  war: WarState;
  /** Players online, one sample per 10 minutes. */
  samples: number[];
  lastSample: number;
}

/** A stored document (or a brand-new war for `seed` when there is none). */
export function openWar(raw: unknown, now: number, seed: number): StoredWar {
  const r = (raw ?? {}) as { war?: unknown; samples?: unknown; lastSample?: unknown };
  const war = sanitizeWar(r.war) ?? newWar(seed, now);
  const samples = Array.isArray(r.samples) ? (r.samples as unknown[]).filter((x): x is number => typeof x === 'number' && x >= 0).slice(-SAMPLES) : [];
  const lastSample = typeof r.lastSample === 'number' && Number.isFinite(r.lastSample) ? r.lastSample : 0;
  return { war, samples, lastSample };
}

/** Average players online over the last day (at least 1), counting the live value. */
export function avgOnline(w: StoredWar, live: number): number {
  const all = [...w.samples, live];
  return Math.max(1, all.reduce((a, b) => a + b, 0) / all.length);
}

/** Sample the population (every 10 minutes) and advance the war. Returns true when the document changed. */
export function stepWar(w: StoredWar, now: number, live: number): boolean {
  let changed = false;
  if (now - w.lastSample >= SAMPLE_MS) {
    w.lastSample = now;
    w.samples.push(Math.max(0, live));
    if (w.samples.length > SAMPLES) w.samples.splice(0, w.samples.length - SAMPLES);
    changed = true;
  }
  const before = w.war.avgOnline;
  w.war.avgOnline = avgOnline(w, live);
  if (tickWar(w.war, now, w.war.avgOnline)) changed = true;
  return changed || before !== w.war.avgOnline;
}

export interface WarReport {
  node: string;
  mode: 'defense' | 'survival';
  /** Wardens who secured it (trusted co-op reports); solo reports count as one. */
  players: number;
  trusted: boolean;
}

/** Apply a secured-node report (rate limits are the caller's: the gateway keeps them in Redis). */
export function reportWar(w: StoredWar, rep: WarReport, now: number, live: number): SecureResult {
  const fail = (reason: string): SecureResult => ({ ok: false, reason, gain: 0, lib: 0, messages: [] });
  if (typeof rep.node !== 'string' || !playable(w.war, rep.node)) return fail('Unknown or locked node');
  const k = Number(/^r(\d+)/.exec(rep.node)![1]);
  const node = regionLayout(w.war.seed, k).nodes.find((n) => n.id === rep.node);
  if (!node || !isCombatKind(node.kind)) return fail('Only combat sectors can be secured');
  stepWar(w, now, live);
  const players = rep.trusted ? Math.max(1, Math.min(4, Math.floor(rep.players))) : 1;
  return secureNode(w.war, { node: rep.node, mode: rep.mode === 'survival' ? 'survival' : 'defense', players }, now);
}
