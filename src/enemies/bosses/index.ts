import type { EnemyKind } from '../../data/defs';
import type { Behavior } from '../EnemyManager';

/** Boss behaviours (Siege Colossus, Overseer Core). */
export const BOSS_BEHAVIORS: Partial<Record<EnemyKind, Behavior>> = {};
