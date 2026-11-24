import { type RunCarry, sanitizeCarry } from './carry';
import { regionOf } from '../war/world';

/**
 * Persisted run-map progress (on `save.activeRun.map`). `seed` is the Rift War's seed (regions regenerate from it);
 * the save keeps the path, the carry at the last completed node and the node chosen next, so a run
 * closed mid-node resumes at the start of that node.
 */
export interface RunMapState {
  seed: number;
  /** Act of the current node. */
  act: number;
  /** Node being played (or just completed), null before the first. */
  current: string | null;
  /** Visited node ids in order (current included). */
  path: string[];
  /** Nodes completed. */
  cleared: number;
  /** Act bosses defeated. */
  actsCleared: number;
  /** Resume point: the run's state when the last node was completed (null = not resumable yet). */
  carry: RunCarry | null;
  /** Node chosen when the last node was completed (resume target). */
  next: string | null;
  /** Ledger counters at the resume point (kills, waves, secured totals, statistics). */
  ledger: Record<string, unknown> | null;
  /** Rift Surges taken: the run plays at deploy level + surge (optional: absent = 0). */
  surge?: number;
  /** Nodes cleared when the last surge was taken (spacing rule, see `canSurge`). */
  surgeAt?: number;
}

/**
 * Rift Surge (progression design §11): travelling to the next combat node can raise the run's Rift Level by one for
 * the rest of the run. Offered after 2 cleared nodes, then every 3 cleared nodes, never into a boss sector.
 */
export const SURGE = { firstAfter: 2, spacing: 3, max: 50 } as const;

export function canSurge(m: Pick<RunMapState, 'cleared' | 'surge' | 'surgeAt'> | null | undefined): boolean {
  if (!m) return false;
  const n = m.surge ?? 0;
  if (n >= SURGE.max) return false;
  return n === 0 ? m.cleared >= SURGE.firstAfter : m.cleared - (m.surgeAt ?? 0) >= SURGE.spacing;
}

/** Most surges a run with `cleared` nodes can have taken (server plausibility bound). */
export const maxSurges = (cleared: number): number => (cleared < SURGE.firstAfter ? 0 : Math.min(SURGE.max, 1 + Math.floor((cleared - SURGE.firstAfter) / SURGE.spacing)));

export const newMapState = (seed: number): RunMapState => ({ seed: seed >>> 0 || 1, act: 1, current: null, path: [], cleared: 0, actsCleared: 0, carry: null, next: null, ledger: null });

/** A run that can be resumed from its last completed node. */
export const resumable = (m: RunMapState | null | undefined): boolean => !!m && !!m.carry && !!m.next;

const ID = /^r\d{1,5}n\d{1,2}$/;

export function sanitizeMapState(raw: unknown): RunMapState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const seed = typeof r.seed === 'number' && Number.isFinite(r.seed) ? r.seed >>> 0 : 0;
  if (!seed) return null;
  const id = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);
  const path = Array.isArray(r.path) ? r.path.map(id).filter((x): x is string => !!x).slice(-400) : [];
  const current = id(r.current);
  const next = id(r.next);
  const n = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.floor(v))) : 0);
  const ledger = r.ledger && typeof r.ledger === 'object' && !Array.isArray(r.ledger) ? (JSON.parse(JSON.stringify(r.ledger)) as Record<string, unknown>) : null;
  return {
    seed,
    act: Math.max(1, current ? regionOf(current) : n(r.act, 1e6) || 1),
    current,
    path,
    cleared: n(r.cleared, 1e6),
    actsCleared: n(r.actsCleared, 1e6),
    carry: sanitizeCarry(r.carry),
    next,
    ledger,
    ...surgeFields(r, n(r.cleared, 1e6)),
  };
}

function surgeFields(r: Record<string, unknown>, cleared: number): Pick<RunMapState, 'surge' | 'surgeAt'> {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  // A surge is taken when leaving a node, after it counts as cleared (MapSession.leave).
  const surge = Math.min(n(r.surge), maxSurges(cleared));
  return surge ? { surge, surgeAt: Math.min(cleared, n(r.surgeAt)) } : {};
}
