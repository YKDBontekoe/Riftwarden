import type { EnemyKind } from '@riftwarden/rules/data/defs';
import type { Behavior } from '../EnemyManager';
import { colossusBehavior } from './colossus';
import { overseerBehavior, pylonBehavior } from './overseer';

/** Boss behaviours (Siege Colossus, Overseer Core + its shield emitters). */
export const BOSS_BEHAVIORS: Partial<Record<EnemyKind, Behavior>> = {
  colossus: colossusBehavior,
  overseer: overseerBehavior,
  pylon: pylonBehavior,
};
