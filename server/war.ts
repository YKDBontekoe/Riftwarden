import { randomInt } from 'node:crypto';
import { regionLayout } from '../src/war/regions';
import { newWar, playable, sanitizeWar, secureNode, type SecureResult, tickWar, type WarState } from '../src/war/state';
import { isCombatKind } from '../src/runmap/defs';

/** Persistence the war needs (ProfileStore implements it; tests can pass a fake). */
export interface WarStore {
  loadWar(): Promise<unknown | null>;
  saveWar(data: unknown): Promise<void>;
}

/** Online samples: one per 10 minutes, the last 24 hours. */
const SAMPLE_MS = 10 * 60_000;
const SAMPLES = 144;
/** Report rate limits per reporter (a secured node takes minutes of play). */
const REPORT_GAP_MS = Number(process.env.RIFT_WAR_GAP_MS ?? 45_000);
const REPORTS_PER_HOUR = 40;

/**
 * The shared Rift War on the server: one state for every player (solo and co-op). Advanced in real time (hourly
 * steps), fed by secured-node reports (solo clients over HTTP, co-op operations directly), persisted in
 * PostgreSQL, and published as JSON at GET /war. The average players online is sampled every 10 minutes over a
 * day, so liberation per report scales with the population (see src/war/state.ts).
 */
export class WarService {
  state: WarState;
  private samples: number[] = [];
  private lastSample = 0;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private json = '';
  private readonly reporters = new Map<string, number[]>();

  private constructor(private store: WarStore, private online: () => number, private log: (m: string) => void, state: WarState, samples: number[]) {
    this.state = state;
    this.samples = samples;
  }

  static async create(store: WarStore, online: () => number, log: (m: string) => void, now = Date.now()): Promise<WarService> {
    const raw = (await store.loadWar()) as { war?: unknown; samples?: unknown } | null;
    let state = raw ? sanitizeWar(raw.war) : null;
    const samples = Array.isArray(raw?.samples) ? (raw!.samples as unknown[]).filter((x): x is number => typeof x === 'number' && x >= 0).slice(-SAMPLES) : [];
    if (!state) {
      const seed = Number(process.env.RIFT_WAR_SEED ?? randomInt(1, 2 ** 31));
      state = newWar(seed, now);
      log(`war: new Rift War (seed ${seed})`);
    }
    const s = new WarService(store, online, log, state, samples);
    s.tick(now);
    s.dirty = true;
    await s.flush();
    return s;
  }

  /** Average players online over the last day (at least 1). */
  get avgOnline(): number {
    const live = this.online();
    const all = [...this.samples, live];
    return Math.max(1, all.reduce((a, b) => a + b, 0) / all.length);
  }

  /** Sample the population and advance the war (call every ~30 s). */
  tick(now = Date.now()): void {
    if (now - this.lastSample >= SAMPLE_MS) {
      this.lastSample = now;
      this.samples.push(this.online());
      if (this.samples.length > SAMPLES) this.samples.splice(0, this.samples.length - SAMPLES);
      this.dirty = true;
    }
    this.state.avgOnline = this.avgOnline;
    if (tickWar(this.state, now, this.state.avgOnline)) {
      this.dirty = true;
      this.json = '';
    }
    void this.flush();
  }

  /** The war as JSON for GET /war (cached until something changes). */
  snapshot(): string {
    if (!this.json) this.json = JSON.stringify({ war: this.state, online: this.online(), now: Date.now() });
    return this.json;
  }

  /**
   * A secured node. `who` identifies the reporter for rate limiting (solo: address + identity; co-op: the
   * operation). Co-op reports skip the rate limit (the server played the node itself).
   */
  report(rep: { node: string; mode: 'defense' | 'survival'; players: number }, who: string, trusted = false, now = Date.now()): SecureResult {
    const fail = (reason: string): SecureResult => ({ ok: false, reason, gain: 0, lib: 0, messages: [] });
    if (typeof rep.node !== 'string' || !playable(this.state, rep.node)) return fail('Unknown or locked node');
    const k = Number(/^r(\d+)/.exec(rep.node)![1]);
    const node = regionLayout(this.state.seed, k).nodes.find((n) => n.id === rep.node);
    if (!node || !isCombatKind(node.kind)) return fail('Only combat sectors can be secured');
    if (!trusted) {
      const times = (this.reporters.get(who) ?? []).filter((t) => now - t < 3_600_000);
      if (times.length && now - times[times.length - 1] < REPORT_GAP_MS) return fail('Too soon: a sector takes five waves');
      if (times.length >= REPORTS_PER_HOUR) return fail('Report limit reached for this hour');
      times.push(now);
      this.reporters.set(who, times);
      if (this.reporters.size > 5000) this.reporters.clear();
    }
    this.tick(now);
    const res = secureNode(this.state, { node: rep.node, mode: rep.mode === 'survival' ? 'survival' : 'defense', players: trusted ? rep.players : 1 }, now);
    if (res.ok) {
      this.dirty = true;
      this.json = '';
      void this.flush();
      for (const m of res.messages) if (m === 'Region liberated' || m === 'War order complete') this.log(`war: ${m} (${rep.node})`);
    }
    return res;
  }

  /** Persist when changed (one write in flight). */
  async flush(): Promise<void> {
    if (!this.dirty || this.saving) return this.saving ?? undefined;
    this.dirty = false;
    this.saving = this.store
      .saveWar({ war: this.state, samples: this.samples })
      .catch((e: Error) => {
        this.dirty = true;
        this.log(`war: save failed: ${e.message}`);
      })
      .finally(() => {
        this.saving = null;
        // A change that arrived while this write was in flight is written right after it.
        if (this.dirty) void this.flush();
      });
    return this.saving;
  }
}
