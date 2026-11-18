// Development lab actions (F4 panel, `__rift.dev`). Every action taints the run: no records, no banking.
// Depends on a narrow host interface instead of `Game`, so it can be tested without a scene.
import { uiEvents } from '../ui/store';
import type { EnemyKind } from '../data/defs';
import type { EnemyContext, EnemyManager, Enemy } from '../enemies/EnemyManager';
import type { Ordnance, Telegraphs } from '../fx/Hostile';
import type { ArenaConfig } from '../core/Game';
import type { WaveManager } from '../waves/WaveManager';
import type { BossId } from '../survival/bosses';
import type { EliteModId } from '../survival/elites';
import type { EventId } from '../survival/events';
import { bossMults, type EvolutionId, type SurvivalPlanner } from '../survival/plan';
import type { SurvivalRuntime } from '../survival/SurvivalRuntime';
import type { TurretManager } from '../defense/Turrets';
import { ARENA, type GateId } from '../world/layout';

export interface DevHost {
  readonly cfg: ArenaConfig;
  readonly enemies: EnemyManager;
  readonly ordnance: Ordnance;
  readonly tele: Telegraphs;
  readonly survival: SurvivalRuntime;
  readonly waves: WaveManager;
  readonly planner: SurvivalPlanner;
  readonly turrets: TurretManager;
  readonly enemyCtx: EnemyContext;
  /** Refill the reactor to its maximum. */
  restoreReactor(): void;
  /** Drop pending upgrade/checkpoint panels and return to the `playing` screen. */
  resetToPlayable(): void;
}

export class DevTools {
  constructor(private readonly host: DevHost) {}

  /** Development tools mark the run: no records, no banking of permanent rewards. */
  mark(): void {
    const sv = this.host.cfg.run.survival;
    if (!sv.dev) {
      sv.dev = true;
      uiEvents.emit('alert', { text: 'DEVELOPMENT SESSION · RECORDS AND BANKING DISABLED', tone: 'white' });
    }
  }

  private clearField(): void {
    const h = this.host;
    h.enemies.clear();
    h.ordnance.reset();
    h.tele.reset();
    h.survival.endEvent();
  }

  /** Jump to the preparation phase of wave n (clears the field; catches up arena evolutions). */
  jump(n: number): void {
    this.mark();
    this.clearField();
    this.host.waves.jumpTo(Math.max(1, Math.floor(n)));
  }

  spawn(kind: EnemyKind, mods: EliteModId[] = [], gate: GateId = 'north'): Enemy {
    this.mark();
    const h = this.host;
    const w = h.waves.wave;
    const enc = 1;
    const boss = kind === 'colossus' || kind === 'overseer';
    const b = boss ? bossMults(enc, h.cfg.tier) : { hp: 1, damage: 1 };
    return h.enemies.spawn(kind, gate, ARENA, w.hpMult * b.hp, w.damageMult * b.damage, w.speedMult, {
      mods,
      tag: boss ? 'boss' : kind === 'courier' ? 'hvt' : undefined,
      encounter: enc,
      ctx: h.enemyCtx,
    });
  }

  /** Force the next wave (or the current prep) to be a boss / event wave. */
  force(o: { boss?: BossId | null; event?: EventId | null }): void {
    this.mark();
    const h = this.host;
    const n = h.waves.phase === 'prep' ? h.waves.number : h.waves.number + 1;
    h.planner.force(n, o);
    if (h.waves.phase === 'prep') {
      h.waves.recompose();
      h.survival.prep(h.waves.wave);
    }
  }

  evolve(id: EvolutionId): void {
    this.mark();
    const h = this.host;
    h.planner.forceEvolution(h.waves.number, id);
    h.survival.applyEvolution(id);
    if (h.waves.phase === 'prep') h.waves.recompose();
  }

  /** Reset the arena: clear machines and hazards, restore the reactor and the drone. */
  reset(): void {
    this.mark();
    const h = this.host;
    this.clearField();
    h.restoreReactor();
    for (const t of h.turrets.turrets) t.disabledT = 0;
    // A long dev session may have reached a checkpoint/upgrade screen.
    h.resetToPlayable();
  }
}
