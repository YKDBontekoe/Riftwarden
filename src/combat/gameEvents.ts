import type { Enemy } from '../enemies/EnemyManager';
import type { BusEvent, Element } from './events';
import type { ReactionKind, StatusKind } from './status';

/** Plain-number point (events outlive the Vector3 scratch objects that produced them). */
export interface Pt {
  x: number;
  y: number;
  z: number;
}

export interface HitEv extends BusEvent {
  type: 'hit' | 'crit' | 'kill';
  target: Enemy;
  /** Target spawn generation at emission (pooled enemies are recycled). */
  gen: number;
  /** Damage dealt after crit/vulnerability. */
  amount: number;
  /** Damage before the crit multiplier (what effects scale from). */
  base: number;
  element: Element;
  crit: boolean;
  weak: boolean;
  point: Pt;
  family: string;
  /** Burn status of the target at the moment of the hit / kill. */
  burning: boolean;
  burnDps: number;
  burnStacks: number;
  chilled: boolean;
}

export interface StatusEv extends BusEvent {
  type: 'status';
  target: Enemy;
  gen: number;
  status: StatusKind;
  op: 'apply' | 'expire';
}

export interface ReactionEv extends BusEvent {
  type: 'reaction';
  target: Enemy;
  gen: number;
  reaction: ReactionKind;
  point: Pt;
  damage: number;
}

export interface TowerAttackEv extends BusEvent {
  type: 'towerAttack';
  towerId: number;
  archetype: string;
  point: Pt;
}

export interface SimpleEv extends BusEvent {
  type: 'fire' | 'dash' | 'waveCleared' | 'earlyStart' | 'overheat';
  value: number;
}

export type GameEvent = HitEv | StatusEv | ReactionEv | TowerAttackEv | SimpleEv;
