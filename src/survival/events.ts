/**
 * Dynamic survival events (pure definitions). The planner schedules at most one per wave; the arena
 * runtime (survival/EventRuntime.ts) applies the in-combat mechanics and the reward rules, and cleans
 * everything up when the wave ends.
 */
export type EventId = 'swarm' | 'eliteAssault' | 'instability' | 'hvt';

export interface EventDef {
  id: EventId;
  name: string;
  /** Prep-phase warning banner. */
  warning: string;
  /** What changes (HUD + deploy notes). */
  blurb: string;
  minWave: number;
  /** Relative weight when several events are eligible. */
  weight: number;
  /** Waves before the same event may repeat. */
  repeatGap: number;
  /** Composition: budget multiplier. */
  budgetMult: number;
  /** Rewards on clearing the event wave. */
  reward: { credits: number; salvage: number; components: number; drop: 'wave' | 'eliteCache' | null };
}

export const EVENTS: Record<EventId, EventDef> = {
  swarm: {
    id: 'swarm',
    name: 'Swarm Invasion',
    warning: 'SWARM INVASION INBOUND',
    blurb: 'Massed light machines at reduced durability, arriving faster. +60% wave salvage and credits.',
    minWave: 4,
    weight: 1.2,
    repeatGap: 4,
    budgetMult: 1.35,
    reward: { credits: 0.6, salvage: 0.6, components: 0, drop: 'wave' },
  },
  eliteAssault: {
    id: 'eliteAssault',
    name: 'Elite Assault',
    warning: 'INCOMING ELITE ASSAULT',
    blurb: 'A coordinated squad of multi-modifier elites breaches one gate. Elite cache on clear.',
    minWave: 7,
    weight: 1,
    repeatGap: 5,
    budgetMult: 0.8,
    reward: { credits: 0.4, salvage: 0.3, components: 2, drop: 'eliteCache' },
  },
  instability: {
    id: 'instability',
    name: 'Power Instability',
    warning: 'REACTOR INSTABILITY DETECTED',
    blurb: 'Telegraphed grid discharges strike the deck. Towers are overdriven (+35% fire rate) but can short out. Kills during discharges pay surge credits.',
    minWave: 6,
    weight: 1,
    repeatGap: 4,
    budgetMult: 0.92,
    reward: { credits: 0.3, salvage: 0.2, components: 1, drop: null },
  },
  hvt: {
    id: 'hvt',
    name: 'High-Value Target',
    warning: 'HIGH-VALUE TARGET INCOMING',
    blurb: 'A Vault Courier circles the facility and escapes after 45 s. Destroy it for a guaranteed targeted cache.',
    minWave: 5,
    weight: 1,
    repeatGap: 4,
    budgetMult: 0.85,
    reward: { credits: 0.2, salvage: 0.2, components: 1, drop: null },
  },
};

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

/** Runtime tuning. */
export const EVENT_TUNING = {
  swarmHp: 0.6,
  swarmInterval: 0.6,
  squadSize: [4, 6] as const,
  strikeEvery: 3.6,
  strikeWindup: 2,
  strikeRadius: 3.4,
  strikeDamage: 22,
  towerOverdrive: 0.35,
  towerShortChance: 0.25,
  surgeCredits: 3,
  hvtEscape: 45,
} as const;
