/**
 * M5 gameplay effect bus (pure, engine-free).
 *
 * Everything that reacts to combat (run upgrades, synergies, tower empowerment, ...) is an
 * `Effect` registered here by an owner id (e.g. `upgrade:e_storm_crit`). Gameplay code emits
 * typed events; the bus queues them and `drain()` delivers them to subscribed effects.
 *
 * Safety rules (documented gameplay rules, not silent limits):
 *  - DAMAGE is never dropped: effects apply damage synchronously through the game. Only
 *    TRIGGER PROPAGATION is bounded.
 *  - Every event carries a chain {id, depth}. A root event (player shot, tower attack, status
 *    tick) starts depth 0; anything an effect does in response is depth+1. Events deeper than
 *    MAX_DEPTH are not delivered to effects (their damage already happened).
 *  - An effect may fire at most `chainLimit` times (default 1) inside one chain, so
 *    crit -> lightning -> explosion -> crit -> lightning ... cannot loop. Legitimate repeats
 *    (cascading explosions) opt in with a higher chainLimit, still bounded by depth.
 *  - Per-effect cooldowns and trigger chances are evaluated at delivery.
 *  - The queue is processed with a per-drain budget; the rest carries over to the next frame in
 *    order. The queue is hard-capped (MAX_QUEUE): beyond it new TRIGGER events are refused and
 *    counted in `stats.dropped` (diagnostics) - never damage.
 */
import type { DamageElement } from './elements';

/** 'none' = untyped effect damage (no affinity, no elemental power). */
export type Element = 'none' | DamageElement;
export type SourceKind = 'weapon' | 'tower' | 'status' | 'effect' | 'reaction';

export interface SourceRef {
  kind: SourceKind;
  /** Stable id: weapon family, tower archetype, upgrade id, status name, reaction name. */
  id: string;
  /** Tower instance that (transitively) caused this, for attribution. */
  towerId?: number;
}

export interface ChainInfo {
  id: number;
  depth: number;
}

export interface BusEvent {
  type: string;
  chain: ChainInfo;
  source: SourceRef;
}

export interface EffectApi<E extends BusEvent> {
  bus: EffectBus<E>;
  rng: () => number;
  /** Seconds of bus time. */
  time: number;
  /** Chain info for events caused by `ev`. */
  child(ev: E): ChainInfo;
}

export interface Effect<E extends BusEvent> {
  id: string;
  /** Who registered it (`upgrade:<id>`, `module:<uid>`...). Used for cleanup. */
  owner: string;
  on: E['type'] | readonly E['type'][];
  /** Seconds between firings (0 = none). */
  cooldown?: number;
  /** Trigger probability 0..1 (default 1). */
  chance?: number;
  /** Max firings per chain (default 1). */
  chainLimit?: number;
  filter?(ev: E): boolean;
  run(ev: E, api: EffectApi<E>): void;
}

export const MAX_DEPTH = 4;
export const MAX_QUEUE = 1500;
export const DEFAULT_BUDGET = 300;

export interface BusStats {
  emitted: number;
  processed: number;
  triggered: number;
  dropped: number;
  depthBlocked: number;
  chainBlocked: number;
  cooldownBlocked: number;
  errors: number;
  /** Triggers in the last second (diagnostics). */
  perSecond: number;
}

export class EffectBus<E extends BusEvent> {
  private effects = new Map<string, Effect<E>>();
  private byType = new Map<string, Effect<E>[]>();
  private queue: E[] = [];
  private head = 0;
  private lastFired = new Map<string, number>();
  private chainCounts = new Map<number, Map<string, number>>();
  private nextChain = 1;
  private recent: number[] = [];
  time = 0;
  stats: BusStats = { emitted: 0, processed: 0, triggered: 0, dropped: 0, depthBlocked: 0, chainBlocked: 0, cooldownBlocked: 0, errors: 0, perSecond: 0 };
  onError: ((e: unknown) => void) | null = null;

  constructor(private rng: () => number = Math.random) {}

  get size(): number {
    return this.queue.length - this.head;
  }
  get effectCount(): number {
    return this.effects.size;
  }
  has(id: string): boolean {
    return this.effects.has(id);
  }

  newChain(): ChainInfo {
    return { id: this.nextChain++, depth: 0 };
  }

  /** Register (or replace, by id): the same effect can never be subscribed twice. */
  register(e: Effect<E>): () => void {
    this.unregister(e.id);
    this.effects.set(e.id, e);
    for (const t of Array.isArray(e.on) ? e.on : [e.on as string]) {
      let l = this.byType.get(t);
      if (!l) this.byType.set(t, (l = []));
      l.push(e);
    }
    return () => this.unregister(e.id);
  }

  unregister(id: string): void {
    const e = this.effects.get(id);
    if (!e) return;
    this.effects.delete(id);
    for (const l of this.byType.values()) {
      const i = l.indexOf(e);
      if (i >= 0) l.splice(i, 1);
    }
    this.lastFired.delete(id);
  }

  unregisterOwner(prefix: string): number {
    let n = 0;
    for (const e of [...this.effects.values()]) {
      if (e.owner === prefix || e.owner.startsWith(prefix)) {
        this.unregister(e.id);
        n++;
      }
    }
    return n;
  }

  /** Queue an event. Returns false when refused (queue full). */
  emit(ev: E): boolean {
    this.stats.emitted++;
    // Events nobody listens to are not queued at all.
    const l = this.byType.get(ev.type);
    if (!l || l.length === 0) return true;
    if (this.size >= MAX_QUEUE) {
      this.stats.dropped++;
      return false;
    }
    this.queue.push(ev);
    return true;
  }

  /** Advance bus time (cooldowns). */
  tick(dt: number): void {
    this.time += dt;
    while (this.recent.length && this.recent[0] < this.time - 1) this.recent.shift();
    this.stats.perSecond = this.recent.length;
  }

  /** Deliver queued events (in order) up to `budget`; the rest waits for the next drain. */
  drain(budget = DEFAULT_BUDGET): number {
    let n = 0;
    const api: EffectApi<E> = { bus: this, rng: this.rng, time: this.time, child: (ev) => ({ id: ev.chain.id, depth: ev.chain.depth + 1 }) };
    while (this.head < this.queue.length && n < budget) {
      const ev = this.queue[this.head++];
      n++;
      this.stats.processed++;
      this.deliver(ev, api);
    }
    if (this.head >= this.queue.length) {
      this.queue.length = 0;
      this.head = 0;
      this.chainCounts.clear();
    } else if (this.head > 512) {
      this.queue.splice(0, this.head);
      this.head = 0;
    }
    return n;
  }

  private deliver(ev: E, api: EffectApi<E>): void {
    if (ev.chain.depth > MAX_DEPTH) {
      this.stats.depthBlocked++;
      return;
    }
    const list = this.byType.get(ev.type);
    if (!list) return;
    api.time = this.time;
    // Snapshot: effects may register/unregister while running.
    for (const e of [...list]) {
      if (!this.effects.has(e.id)) continue;
      if (e.filter && !e.filter(ev)) continue;
      if (e.cooldown) {
        const last = this.lastFired.get(e.id);
        if (last !== undefined && this.time - last < e.cooldown) {
          this.stats.cooldownBlocked++;
          continue;
        }
      }
      if (e.chance !== undefined && e.chance < 1 && this.rng() >= e.chance) continue;
      let counts = this.chainCounts.get(ev.chain.id);
      if (!counts) this.chainCounts.set(ev.chain.id, (counts = new Map()));
      const used = counts.get(e.id) ?? 0;
      if (used >= (e.chainLimit ?? 1)) {
        this.stats.chainBlocked++;
        continue;
      }
      counts.set(e.id, used + 1);
      if (e.cooldown) this.lastFired.set(e.id, this.time);
      this.stats.triggered++;
      this.recent.push(this.time);
      try {
        e.run(ev, api);
      } catch (err) {
        this.stats.errors++;
        this.onError?.(err);
      }
    }
  }

  /** Drop everything (run end / new run). */
  clear(): void {
    this.queue.length = 0;
    this.head = 0;
    this.chainCounts.clear();
    this.lastFired.clear();
    this.recent.length = 0;
  }

  /** Remove all effects and queued events. */
  reset(): void {
    this.effects.clear();
    this.byType.clear();
    this.clear();
    this.time = 0;
    this.stats = { emitted: 0, processed: 0, triggered: 0, dropped: 0, depthBlocked: 0, chainBlocked: 0, cooldownBlocked: 0, errors: 0, perSecond: 0 };
  }
}
