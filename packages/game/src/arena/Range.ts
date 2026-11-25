// Firing range: training dummies (frozen, immortal machines) in front of the drone and a DPS readout.
// A range arena is a throwaway development session (no waves, no loot, nothing banked); the HQ opens it from the
// deploy terminal. Narrow host interface (no Game import), like DevTools.
import type { EnemyKind } from '@riftwarden/rules/data/defs';
import type { EliteModId } from '@riftwarden/rules/survival/elites';
import { DpsMeter, type DpsReadout } from '@riftwarden/rules/combat/dpsMeter';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import type { Enemy, EnemyManager } from '../enemies/EnemyManager';
import type { EffectBus } from '@riftwarden/rules/combat/events';
import type { GameEvent } from '../combat/gameEvents';
import { Store } from '../ui/store';

/** Targets the range offers (frames with distinct defences). */
export const RANGE_TARGETS = [
  { id: 'walker', kind: 'walker', name: 'Walker', note: 'light frame, shoot-off parts' },
  { id: 'bulwark', kind: 'bulwark', name: 'Bulwark', note: 'heavy plating (corrosive x1.25)' },
  { id: 'enforcer', kind: 'enforcer', name: 'Enforcer', note: 'frontal shield, rear generator' },
  { id: 'skimmer', kind: 'skimmer', name: 'Skimmer', note: 'small airborne target' },
] as const satisfies readonly { id: string; kind: EnemyKind; name: string; note: string }[];
export type RangeTargetId = (typeof RANGE_TARGETS)[number]['id'];

/** Defensive modifiers a dummy can wear. */
export const RANGE_MODS = [
  { id: 'none', name: 'Bare', mods: [] },
  { id: 'armored', name: 'Armored', mods: ['armored'] },
  { id: 'shielded', name: 'Barrier', mods: ['shielded'] },
] as const satisfies readonly { id: string; name: string; mods: readonly EliteModId[] }[];
export type RangeModId = (typeof RANGE_MODS)[number]['id'];

/** Faction the dummies count as (affinities); null = neutral. */
export const RANGE_FACTIONS = [
  { id: null, name: 'Neutral' },
  { id: 'scrap', name: 'Scrapline' },
  { id: 'rime', name: 'Rime' },
  { id: 'crucible', name: 'Crucible' },
] as const;

export interface RangeSetup {
  target: RangeTargetId;
  mod: RangeModId;
  /** One dummy at `distance`, or a pack of three (area weapons). */
  pack: boolean;
  distance: 15 | 25 | 40;
  faction: string | null;
}

export interface RangeHud extends DpsReadout {
  setup: RangeSetup;
}

export const rangeStore = new Store<{ range: RangeHud | null }>({ range: null });

export interface RangeHost {
  readonly enemies: EnemyManager;
  readonly layout: ArenaLayout;
  readonly director: { readonly bus: EffectBus<GameEvent>; readonly dealt: { player: number }; setFaction(id: string | null): void };
}

/** Hull multiplier of a dummy (it is refilled before it can die). */
const DUMMY_HP = 40;
/** Dummies refill after this long without damage (so a fresh volley starts on a full target). */
const IDLE_RESET = 3;
/** Where the drone stands and which way the dummies line up (north lane of the classic arena: open floor). */
export const RANGE_STAND = { x: 10, z: -2, yaw: 0 };

export class Range {
  readonly meter = new DpsMeter();
  setup: RangeSetup = { target: 'walker', mod: 'none', pack: false, distance: 15, faction: null };
  private dummies: { e: Enemy; gen: number; x: number; z: number }[] = [];
  private lastDealt = 0;
  private lastHitAt = -Infinity;
  private t = 0;
  private published = 0;
  private readonly off: () => void;

  constructor(private readonly host: RangeHost) {
    this.off = host.director.bus.register({
      id: 'range:hits',
      owner: 'range',
      on: 'hit',
      chainLimit: 1e9,
      filter: (ev) => ev.source.kind === 'weapon',
      run: (ev) => this.meter.hit(!!(ev as { crit?: boolean }).crit),
    });
  }

  /** Spawn the configured dummies (replaces the current ones) and put the drone on its mark. */
  configure(patch: Partial<RangeSetup> = {}): void {
    this.setup = { ...this.setup, ...patch };
    const s = this.setup;
    this.clear();
    this.host.director.setFaction(s.faction);
    const kind = RANGE_TARGETS.find((t) => t.id === s.target)?.kind ?? 'walker';
    const mods = [...(RANGE_MODS.find((m) => m.id === s.mod)?.mods ?? [])];
    const spots = s.pack ? [-2.2, 0, 2.2].map((dx, i) => ({ x: RANGE_STAND.x + dx, z: RANGE_STAND.z + s.distance + (i === 1 ? 1.5 : 0) })) : [{ x: RANGE_STAND.x, z: RANGE_STAND.z + s.distance }];
    for (const p of spots) {
      const e = this.host.enemies.spawn(kind, 'north', this.host.layout, DUMMY_HP, 0, 0, { mods });
      this.dummies.push({ e, gen: e.gen, x: p.x, z: p.z });
      this.place(e, p.x, p.z);
    }
    this.meter.reset();
    this.lastDealt = this.host.director.dealt.player;
    this.publish(true);
  }

  private place(e: Enemy, x: number, z: number): void {
    e.pos.x = x;
    e.pos.z = z;
    e.path = [{ x, z }, { x, z: z - 0.01 }];
    e.seg = 1;
    e.yaw = Math.PI;
    e.root.position.copyFrom(e.pos);
    e.root.rotation.y = Math.PI;
  }

  /** Range keys: J target, K defences, L distance, P pack, O faction, Backspace clears the meter. */
  keys(input: { pressed(code: string): boolean }): void {
    const next = <T,>(list: readonly T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length];
    const s = this.setup;
    if (input.pressed('KeyJ')) this.configure({ target: next(RANGE_TARGETS.map((t) => t.id), s.target) });
    if (input.pressed('KeyK')) this.configure({ mod: next(RANGE_MODS.map((m) => m.id), s.mod) });
    if (input.pressed('KeyL')) this.configure({ distance: next([15, 25, 40] as const, s.distance) });
    if (input.pressed('KeyP')) this.configure({ pack: !s.pack });
    if (input.pressed('KeyO')) this.configure({ faction: next(RANGE_FACTIONS.map((f) => f.id as string | null), s.faction) });
    if (input.pressed('Backspace')) this.resetMeter();
  }

  /** Clear the meter (Backspace). */
  resetMeter(): void {
    this.meter.reset();
    this.refill(true);
    this.publish(true);
  }

  private refill(full: boolean): void {
    for (const d of this.dummies) {
      const e = d.e;
      if (!e.alive || e.gen !== d.gen) continue;
      // Immortal: hull never falls under a third; shields and plating come back after a pause.
      if (full || e.hp < e.maxHp * 0.35) e.hp = e.maxHp;
      if (full) {
        e.shield = e.maxShield;
        e.limbsLost = 0;
        e.limbDmg.fill(0);
      }
    }
  }

  /** Real-time tick (hostile time is frozen in the range). */
  update(dt: number): void {
    this.t += dt;
    const dealt = this.host.director.dealt.player;
    if (dealt > this.lastDealt) {
      this.meter.add(this.t, dealt - this.lastDealt);
      this.lastHitAt = this.t;
    }
    this.lastDealt = dealt;
    this.refill(this.t - this.lastHitAt > IDLE_RESET && this.lastHitAt > -Infinity);
    if (this.t - this.lastHitAt > IDLE_RESET) this.lastHitAt = -Infinity;
    // A dummy that still died (an execute effect) comes back on its mark.
    if (this.dummies.some((d) => !d.e.alive || d.e.gen !== d.gen)) this.configure();
    this.publish(false);
  }

  private publish(now: boolean): void {
    if (!now && this.t - this.published < 0.1) return;
    this.published = this.t;
    rangeStore.set({ range: { ...this.meter.read(this.t), setup: { ...this.setup } } });
  }

  /** Dummies currently on the range (tests). */
  get targets(): readonly Enemy[] {
    return this.dummies.map((d) => d.e);
  }

  private clear(): void {
    for (const d of this.dummies) if (d.e.alive && d.e.gen === d.gen) this.host.enemies.despawn(d.e);
    this.dummies = [];
  }

  dispose(): void {
    this.off();
    this.clear();
    rangeStore.set({ range: null });
  }
}
