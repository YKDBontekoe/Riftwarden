// Conditional affixes (M11, pure): a modifier that only counts while its condition holds ("while airborne", "for 2 s
// after a dash", ...). The arena keeps one ConditionTracker per drone, feeds it events and state, and rebuilds the stat
// block when the active set changes; loadout scoring counts conditional modifiers at their expected uptime.
import type { StatModifier } from './stats';

export type CondId = 'airborne' | 'dash' | 'swap' | 'lowhull' | 'kill';
export const COND_IDS: readonly CondId[] = ['airborne', 'dash', 'swap', 'lowhull', 'kill'];

export interface CondDef {
  id: CondId;
  /** Suffix after the stat text: "+12% weapon damage while airborne". */
  text: string;
  /** Short HUD tag. */
  tag: string;
  /** Seconds a triggered condition stays active (event conditions). */
  window?: number;
  /** Expected share of fight time it is active (loadout scoring). */
  uptime: number;
}

export const CONDITIONS: Readonly<Record<CondId, CondDef>> = {
  airborne: { id: 'airborne', tag: 'AIRBORNE', text: 'while airborne', uptime: 0.3 },
  dash: { id: 'dash', tag: 'DASH', text: 'for 2 s after a dash', window: 2, uptime: 0.3 },
  swap: { id: 'swap', tag: 'SWAP', text: 'for 3 s after a weapon swap', window: 3, uptime: 0.15 },
  lowhull: { id: 'lowhull', tag: 'LAST STAND', text: 'below 40% hull', uptime: 0.15 },
  kill: { id: 'kill', tag: 'KILL', text: 'for 3 s after a kill', window: 3, uptime: 0.45 },
};

/** Hull fraction under which `lowhull` holds. */
export const LOW_HULL = 0.4;

export const isCondId = (v: unknown): v is CondId => typeof v === 'string' && (COND_IDS as readonly string[]).includes(v);

type EventCond = 'dash' | 'swap' | 'kill';

/** Active conditions of one drone. `update` returns true when the active set changed (rebuild the stat block). */
export class ConditionTracker {
  readonly active = new Set<CondId>();
  private at: Record<EventCond, number> = { dash: -1e9, swap: -1e9, kill: -1e9 };

  /** An event happened at `now` (seconds on any monotonic clock). */
  note(ev: EventCond, now: number): void {
    this.at[ev] = now;
  }

  update(now: number, s: { airborne: boolean; hullFrac: number; alive: boolean }): boolean {
    const want = new Set<CondId>();
    if (s.alive) {
      if (s.airborne) want.add('airborne');
      if (s.hullFrac < LOW_HULL) want.add('lowhull');
      for (const ev of ['dash', 'swap', 'kill'] as const) if (now - this.at[ev] <= CONDITIONS[ev].window!) want.add(ev);
    }
    let changed = want.size !== this.active.size;
    if (!changed) for (const c of want) if (!this.active.has(c)) changed = true;
    if (changed) {
      this.active.clear();
      for (const c of want) this.active.add(c);
    }
    return changed;
  }

  reset(): void {
    this.active.clear();
    this.at = { dash: -1e9, swap: -1e9, kill: -1e9 };
  }
}

/** Conditional modifiers scaled to their expected uptime (loadout scoring: "what is this worth on average"). */
export function expectedModifiers(mods: readonly StatModifier[]): StatModifier[] {
  return mods.map((m) => {
    if (!m.cond) return m;
    const u = CONDITIONS[m.cond].uptime;
    return { ...m, value: m.op === 'mul' ? Math.pow(1 + m.value, u) - 1 : m.value * u, cond: undefined };
  });
}

export const hasConditional = (mods: readonly StatModifier[]): boolean => mods.some((m) => !!m.cond);

/** Conditions the modifiers depend on, in COND_IDS order (HUD: which conditions to show). */
export const condIdsOf = (mods: readonly StatModifier[]): CondId[] => COND_IDS.filter((c) => mods.some((m) => m.cond === c));

/** HUD rows: every condition the loadout uses and whether it holds right now. */
export const condHud = (ids: readonly CondId[], active: ReadonlySet<CondId>): CondHudRow[] => ids.map((id) => ({ id, tag: CONDITIONS[id].tag, on: active.has(id) }));

export interface CondHudRow {
  id: CondId;
  tag: string;
  on: boolean;
}
