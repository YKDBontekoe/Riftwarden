import { mulberry32 } from '../combat/damage';
import type { EnemyKind } from '../data/defs';
import type { GateId } from '../world/layout';
import { NO_SCALING, type WaveScaling } from '../progression/tiers';
import type { EliteModId } from '../survival/elites';

export interface SpawnEntry {
  time: number; // seconds after combat starts (hostile time)
  kind: EnemyKind;
  gate: GateId;
  /** M6: elite modifiers. */
  mods?: EliteModId[];
  /** M6: role in the encounter (boss, event target, elite squad, swarm). */
  tag?: 'boss' | 'hvt' | 'squad' | 'swarm';
  /** M6: extra health multiplier for this spawn (swarm, elites, budget overflow). */
  hpMult?: number;
  /** M6: boss encounter index (repeat variations). */
  encounter?: number;
}

export interface WaveDef {
  number: number;
  spawns: SpawnEntry[];
  hpMult: number;
  damageMult: number;
  speedMult: number;
  prepTime: number;
  clearReward: number;
  /** M6: director plan for this wave (theme, event, boss, evolution). Absent for legacy getWave(). */
  plan?: import('../survival/plan').WavePlan;
}

export interface Group {
  kind: EnemyKind;
  count: number;
  gate: GateId;
  start: number;
  interval: number;
}

export function expand(groups: Group[], countMult = 1): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  for (const g of groups) {
    const count = Math.max(1, Math.round(g.count * countMult));
    // Extra spawns from tier scaling keep the group's duration (tighter interval).
    const interval = count > g.count && g.count > 0 ? (g.interval * g.count) / count : g.interval;
    for (let i = 0; i < count; i++) out.push({ time: g.start + i * interval, kind: g.kind, gate: g.gate });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Hand-designed opening waves teach lanes, then rush drones, then multiple fronts. */
export const HAND_WAVES: Group[][] = [
  [
    { kind: 'walker', count: 5, gate: 'north', start: 1, interval: 2.4 },
    { kind: 'walker', count: 4, gate: 'east', start: 10, interval: 2.4 },
  ],
  [
    { kind: 'walker', count: 6, gate: 'west', start: 1, interval: 2.0 },
    { kind: 'rusher', count: 4, gate: 'north', start: 8, interval: 0.7 },
    { kind: 'walker', count: 5, gate: 'north', start: 14, interval: 2.0 },
    { kind: 'rusher', count: 4, gate: 'west', start: 22, interval: 0.6 },
  ],
  [
    { kind: 'walker', count: 6, gate: 'east', start: 1, interval: 1.8 },
    { kind: 'walker', count: 6, gate: 'west', start: 4, interval: 1.8 },
    { kind: 'rusher', count: 5, gate: 'north', start: 10, interval: 0.55 },
    { kind: 'walker', count: 6, gate: 'north', start: 16, interval: 1.6 },
    { kind: 'rusher', count: 5, gate: 'east', start: 22, interval: 0.55 },
    { kind: 'rusher', count: 5, gate: 'west', start: 26, interval: 0.55 },
  ],
];

const GATE_LIST: GateId[] = ['north', 'east', 'west'];

/** Enemy health multiplier: gentle linear ramp plus a mild super-linear term. */
export function hpMultiplier(n: number): number {
  if (n <= 3) return 1 + (n - 1) * 0.05;
  const k = n - 3;
  return 1.1 + 0.11 * k + 0.004 * k * k;
}

export function damageMultiplier(n: number): number {
  return 1 + Math.max(0, n - 1) * 0.045;
}

/**
 * Deterministic generator for waves beyond the hand-designed set. Scales count,
 * health and damage, and mixes in mechanical escalation: Bulwark elites, multi-gate
 * pushes and rush-drone swarms.
 */
function generateGroups(n: number): Group[] {
  const rand = mulberry32(n * 7919 + 17);
  const k = n - 3;
  const groups: Group[] = [];
  const walkers = Math.round(16 + k * 3.2);
  const rushers = Math.round(12 + k * 2.6);
  const bulwarks = Math.floor((n - 2) / 2);
  const activeGates = n >= 6 ? 3 : 2 + (rand() < 0.5 ? 1 : 0);
  const gates = [...GATE_LIST].sort(() => rand() - 0.5).slice(0, activeGates);
  const duration = 30 + Math.min(30, k * 2.5);

  // Walkers distributed in packets across the active gates.
  const packets = Math.max(3, Math.round(walkers / 5));
  for (let i = 0; i < packets; i++) {
    const count = Math.round(walkers / packets);
    groups.push({
      kind: 'walker',
      count,
      gate: gates[i % gates.length],
      start: 1 + (i / packets) * duration,
      interval: Math.max(0.7, 1.8 - k * 0.06),
    });
  }
  // Rush swarms: fewer, larger bursts as waves climb.
  const swarms = Math.max(2, Math.round(rushers / (5 + Math.min(6, k * 0.5))));
  for (let i = 0; i < swarms; i++) {
    groups.push({
      kind: 'rusher',
      count: Math.round(rushers / swarms),
      gate: gates[Math.floor(rand() * gates.length)],
      start: 6 + rand() * duration,
      interval: 0.45,
    });
  }
  for (let i = 0; i < bulwarks; i++) {
    groups.push({
      kind: 'bulwark',
      count: 1,
      gate: gates[i % gates.length],
      start: 8 + (i / Math.max(1, bulwarks)) * duration,
      interval: 0,
    });
  }
  return groups;
}

export function getWave(n: number, scaling: WaveScaling = NO_SCALING): WaveDef {
  if (n < 1) throw new Error('wave numbers start at 1');
  const groups = n <= HAND_WAVES.length ? HAND_WAVES[n - 1] : generateGroups(n);
  return {
    number: n,
    spawns: expand(groups, scaling.countMult),
    hpMult: hpMultiplier(n) * scaling.hpMult,
    damageMult: damageMultiplier(n) * scaling.damageMult,
    speedMult: scaling.speedMult,
    prepTime: n === 1 ? 30 : 18,
    clearReward: 60 + n * 15,
  };
}

/** Rough threat estimate used by tests to verify monotonic escalation. */
export function waveThreat(w: WaveDef): number {
  const base: Partial<Record<EnemyKind, number>> = { walker: 70, rusher: 26 + 25, bulwark: 270, enforcer: 330, artillery: 200, engineer: 220, courier: 800, colossus: 5000, overseer: 4400 };
  return w.spawns.reduce((s, e) => s + (base[e.kind] ?? 100) * (e.hpMult ?? 1), 0) * w.hpMult;
}
