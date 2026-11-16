import { useSyncExternalStore } from 'react';

export type Screen = 'loading' | 'menu' | 'playing' | 'paused' | 'defeat';
export type WavePhase = 'prep' | 'combat' | 'cleared';

export interface InspectInfo {
  name: string;
  kills: number;
  damage: number;
  refund: number;
  recycle: number; // 0..1 hold progress
}

export interface HudState {
  screen: Screen;
  wave: number;
  phase: WavePhase;
  phaseTimer: number;
  enemiesLeft: number;
  reactorHp: number;
  reactorMax: number;
  reactorUnderAttack: boolean;
  playerHp: number;
  playerMax: number;
  respawnIn: number; // 0 when alive
  cores: number;
  weaponName: string;
  heat: number; // 0..1
  overheated: boolean;
  dashCharges: number;
  dashMax: number;
  dashRecharge: number; // 0..1 progress of next charge
  tactical: number; // 0..1
  tacticalActive: boolean;
  tacticalMin: number; // 0..1 activation threshold
  buildMode: boolean;
  buildValid: boolean;
  buildMessage: string;
  buildCost: number;
  inspect: InspectInfo | null;
  hint: string;
  spread: number; // crosshair gap in px
  stats: { kills: number; time: number; wave: number; coresEarned: number; turretsBuilt: number };
  perf: { fps: number; enemies: number; draws: number; particles: number } | null;
}

export const initialHud: HudState = {
  screen: 'loading',
  wave: 1,
  phase: 'prep',
  phaseTimer: 0,
  enemiesLeft: 0,
  reactorHp: 1,
  reactorMax: 1,
  reactorUnderAttack: false,
  playerHp: 100,
  playerMax: 100,
  respawnIn: 0,
  cores: 0,
  weaponName: '',
  heat: 0,
  overheated: false,
  dashCharges: 2,
  dashMax: 2,
  dashRecharge: 1,
  tactical: 1,
  tacticalActive: false,
  tacticalMin: 0.25,
  buildMode: false,
  buildValid: false,
  buildMessage: '',
  buildCost: 0,
  inspect: null,
  hint: '',
  spread: 0,
  stats: { kills: 0, time: 0, wave: 0, coresEarned: 0, turretsBuilt: 0 },
  perf: null,
};

type Listener = () => void;

/** Minimal external store: the game pushes snapshots, React components subscribe. */
export class Store<T extends object> {
  private listeners = new Set<Listener>();
  constructor(private state: T) {}
  get = (): T => this.state;
  set(patch: Partial<T>): void {
    let changed = false;
    for (const k in patch) {
      if (!Object.is(patch[k], this.state[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const hudStore = new Store<HudState>(initialHud);

export function useHud<S>(select: (s: HudState) => S): S {
  return useSyncExternalStore(hudStore.subscribe, () => select(hudStore.get()));
}

// ---- Instant feedback events (hitmarkers, damage numbers, banners) ----

export type HitKind = 'hit' | 'crit' | 'shield' | 'kill';

export interface DamageNumberEvent {
  x: number;
  y: number;
  z: number;
  amount: number;
  kind: HitKind;
  player: boolean;
}

export interface BannerEvent {
  title: string;
  sub?: string;
  tone: 'cyan' | 'orange' | 'red' | 'white';
}

type EventMap = {
  hit: HitKind;
  damageNumber: DamageNumberEvent;
  banner: BannerEvent;
  hurt: number; // 0..1 severity
  coresGained: number;
};

class Emitter {
  private map = new Map<keyof EventMap, Set<(v: never) => void>>();
  on<K extends keyof EventMap>(k: K, fn: (v: EventMap[K]) => void): () => void {
    if (!this.map.has(k)) this.map.set(k, new Set());
    this.map.get(k)!.add(fn as (v: never) => void);
    return () => this.map.get(k)!.delete(fn as (v: never) => void);
  }
  emit<K extends keyof EventMap>(k: K, v: EventMap[K]): void {
    this.map.get(k)?.forEach((fn) => (fn as (v: EventMap[K]) => void)(v));
  }
}

export const uiEvents = new Emitter();
