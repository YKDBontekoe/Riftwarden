import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { useSyncExternalStore } from 'react';
import type { RunResult } from '../progression/run';

/**
 * Screens. HQ: menu (title), home (walking), terminal (station UI open), summary (run
 * report after returning). Arena: playing, checkpoint (bank/continue/return choice),
 * defeat. Shared: loading, transit (scene swap), paused.
 */
export type Screen = 'loading' | 'menu' | 'home' | 'terminal' | 'summary' | 'transit' | 'playing' | 'paused' | 'checkpoint' | 'defeat' | 'inventory' | 'upgrade' | 'build' | 'towers' | 'dev' | 'construct';
export type Location = 'home' | 'arena';
export type TerminalId = 'deploy' | 'loadout' | 'storage' | 'workshop' | 'command' | 'merchant' | 'modules' | 'salvage' | 'fabricate' | 'architect';

export interface PromptInfo {
  key: string;
  title: string;
  action: string;
}

export interface RunHud {
  tier: number;
  salvageUnsecured: number;
  salvageSecured: number;
  creditsUnsecured: number;
  creditsSecured: number;
  componentsUnsecured: number;
  componentsSecured: number;
  nextCheckpoint: number;
  /** Return-home option open (checkpoint preparation phase). */
  checkpointOpen: boolean;
  lastBankedWave: number;
  kills: number;
  duration: number;
}
export type WavePhase = 'prep' | 'combat' | 'cleared';

export interface TowerCard {
  id: number;
  name: string;
  base: string;
  level: number;
  maxLevel: number;
  levelCost: number;
  slots: { slot: 'weapon' | 'core' | 'modifier'; id: string; name: string; next: string | null; nextCost: number }[];
  st: { damage: number; fireRate: number; range: number; dps: number; chain: number; targets: number; element: string; archetype: string };
  empowered: boolean;
  kills: number;
  damage: number;
}

export interface InspectInfo {
  name: string;
  kills: number;
  damage: number;
  refund: number;
  recycle: number; // 0..1 hold progress
  card?: TowerCard;
  /** Why tower edits are unavailable right now (null = allowed). */
  edit?: string | null;
}

export interface M5Hud {
  upgrades: number;
  buffs: { name: string; t: number; stacks: number }[];
  network: number;
  grid: number;
  empowered: number;
  towers: number;
  note: string;
  template: string;
  templateCost: number;
}

/** M6 boss health bar. */
export interface BossHud {
  name: string;
  title: string;
  hp: number;
  max: number;
  phase: number;
  /** Phase thresholds as HP fractions (bar ticks). */
  ticks: number[];
  /** Short state line ("SHIELDED BY 3 EMITTERS", "CORE EXPOSED"...). */
  state: string;
  immune: boolean;
  /** Current telegraphed attack name (empty when idle). */
  attack: string;
  encounter: number;
}

/** M6 survival director state for the HUD. */
export interface SurvivalHud {
  theme: string;
  event: { id: string; name: string; blurb: string } | null;
  /** Prep: what the coming wave holds (boss / event). */
  upcoming: string;
  evolved: string[];
  boss: BossHud | null;
  hvt: { hp: number; shield: number; escapeIn: number; signal: string } | null;
  elites: number;
}

/** The pickup currently targeted in the arena (interaction prompt). */
export interface LootTargetInfo {
  uid: string;
  name: string;
  rarity: string;
  level: number;
  category: string;
  expiresAfterWave: number;
  expiring: boolean;
  cargoFull: boolean;
  /** Item currently in the slot this would go to (quick comparison). */
  equippedName: string | null;
  equippedLevel: number;
  equippedRarity: string | null;
}

/** M7 co-op HUD state (teammates, votes, offers, link quality). */
export interface CoopHud {
  team: import('../net/ClientGame').TeamMember[];
  voteOpen: boolean;
  voteLeft: number;
  /** Name of the teammate choosing the upgrade (null = you choose / none). */
  offerChooser: string | null;
  offerLeft: number;
  rtt: number;
}

export interface HudState {
  bindings: Settings['keys'];
  /** M7 onboarding card. */
  tutorial?: (import('../progression/tutorial').TutorialStep & { index: number; total: number }) | null;
  coop?: CoopHud | null;
  /** M7 HQ construction mode. */
  construct?: import('../home/build/BuildMode').BuildHud | null;
  screen: Screen;
  location: Location;
  terminal: TerminalId | null;
  prompt: PromptInfo | null;
  area: string;
  transit: { title: string; sub: string } | null;
  run: RunHud | null;
  /** Result of the run that just ended (summary / defeat screens). */
  lastRun: RunResult | null;
  wave: number;
  phase: WavePhase;
  phaseTimer: number;
  enemiesLeft: number;
  reactorHp: number;
  reactorMax: number;
  reactorUnderAttack: boolean;
  playerHp: number;
  playerMax: number;
  playerShield: number;
  playerShieldMax: number;
  respawnIn: number; // 0 when alive
  lootTarget: LootTargetInfo | null;
  cargo: number;
  cargoMax: number;
  /** Equipment changes allowed right now (arena: preparation phase). */
  equipAllowed: boolean;
  inventoryVersion: number;
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
  perf: { fps: number; enemies: number; draws: number; particles: number; towers?: number; projectiles?: number; pending?: number; statuses?: number; triggers?: number; dpsPlayer?: number; dpsTower?: number; effects?: number; dropped?: number; frameMs?: number; aiMs?: number; telegraphs?: number; ordnance?: number; wave?: number; tier?: number; event?: string; boss?: string; budget?: number; hpMult?: number; dmgMult?: number; spawnQueue?: number; elites?: number; dev?: boolean } | null;
  m5: M5Hud | null;
  m6: SurvivalHud | null;
}

export const initialHud: HudState = {
  bindings: DEFAULT_SETTINGS.keys,
  screen: 'loading',
  location: 'home',
  terminal: null,
  prompt: null,
  area: '',
  transit: null,
  run: null,
  lastRun: null,
  wave: 1,
  phase: 'prep',
  phaseTimer: 0,
  enemiesLeft: 0,
  reactorHp: 1,
  reactorMax: 1,
  reactorUnderAttack: false,
  playerHp: 100,
  playerMax: 100,
  playerShield: 0,
  playerShieldMax: 0,
  respawnIn: 0,
  lootTarget: null,
  cargo: 0,
  cargoMax: 0,
  equipAllowed: false,
  inventoryVersion: 0,
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
  m5: null,
  m6: null,
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
  get listenerCount(): number {
    return this.listeners.size;
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
  /** severity 0..1; angle = source direction relative to view (radians, 0 = ahead, + = right), null if unknown. */
  hurt: { severity: number; angle: number | null };
  coresGained: number;
  /** Salvage collected (unsecured) during a run. */
  salvageGained: number;
  creditsGained: number;
  componentsGained: number;
  /** HQ: a committed economy transaction (station feedback + resource deltas). */
  econ: { station: string; kind: string; delta: Partial<Record<'credits' | 'salvage' | 'components', number>> };
  /** Loot feed: drops landing, pickups, full cargo, expiry. */
  loot: LootEvent;
  /** M6: short tactical warning line (events, bosses, evolutions, milestones). */
  alert: { text: string; tone: 'red' | 'orange' | 'blue' | 'white' };
};

export interface LootEvent {
  kind: 'drop' | 'pickup' | 'full' | 'expired';
  name: string;
  rarity: string;
  level: number;
  category: string;
  count: number;
}

export class Emitter {
  private map = new Map<keyof EventMap, Set<(v: never) => void>>();
  on<K extends keyof EventMap>(k: K, fn: (v: EventMap[K]) => void): () => void {
    if (!this.map.has(k)) this.map.set(k, new Set());
    this.map.get(k)!.add(fn as (v: never) => void);
    return () => this.map.get(k)!.delete(fn as (v: never) => void);
  }
  /** Listener count (leak checks across scene transitions). */
  listenerCount(): number {
    let n = 0;
    this.map.forEach((s) => (n += s.size));
    return n;
  }
  emit<K extends keyof EventMap>(k: K, v: EventMap[K]): void {
    this.map.get(k)?.forEach((fn) => (fn as (v: EventMap[K]) => void)(v));
  }
}

export const uiEvents = new Emitter();
