/**
 * Tower durability on mazing arenas (arena side): breach hits, wrecks, repairs and wave-clear mending.
 * Narrow host interface (no Game import): the arena hands in its towers, effects, wallet and alert sink.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { sfx } from '../audio/Sfx';
import type { Turret } from '../defense/Turrets';
import type { NavAgent } from '@riftwarden/rules/enemies/navigation';
import type { Effects } from '../fx/Effects';
import { DURABILITY } from '@riftwarden/rules/towers/durability';

export interface TowerWearHost {
  readonly towers: readonly Turret[];
  readonly fx: Effects;
  spend(cores: number): boolean;
  alert(text: string, tone: 'red' | 'orange' | 'blue' | 'white'): void;
  /** Tower set changed (re-plan navigation, recompose tower stats). */
  changed(): void;
  /** Why tower edits are blocked right now (null = allowed). */
  editReason(): string | null;
}

export class TowerWear {
  wrecks = 0;
  repairs = 0;
  constructor(private h: TowerWearHost) {}

  /** A breaching enemy hits tower `id`. */
  breach(id: number, damage: number, by: NavAgent | null): void {
    const t = this.h.towers.find((x) => x.id === id);
    if (!t) return;
    const at = t.head;
    if (Math.random() < 0.6) this.h.fx.burst('zap', at, 3, undefined, 0.7);
    if (!t.damage(damage)) return;
    this.wrecks++;
    this.h.fx.explode(new Vector3(t.pos.x, t.pos.y + 1, t.pos.z), { scale: 0.9, debris: 8, style: 'electric' });
    sfx.play('explosion', { pitch: 1.2 });
    this.h.alert(`${t.name} WRECKED${by ? ' · LANE BREACHED' : ''}`, 'red');
    this.h.changed();
  }

  /** Repair (key F / panel). Returns a reason on failure. */
  repair(t: Turret): string | null {
    const block = this.h.editReason();
    if (block) return block;
    const cost = t.repairCost;
    if (cost <= 0) return 'Tower is intact';
    if (!this.h.spend(cost)) return `Not enough cores (need ${cost})`;
    const was = t.wrecked;
    t.repair();
    this.repairs++;
    this.h.fx.burst('build', t.head, 30);
    this.h.fx.ring(new Vector3(t.pos.x, t.pos.y + 0.1, t.pos.z), 3, 0.45, new Color3(0.4, 2, 1.2), true);
    sfx.play('build');
    if (was) this.h.changed();
    return null;
  }

  private lastPhase = '';
  /** Per frame: detects the wave-clear transition (mending happens once per cleared wave). */
  tick(phase: string, scale: number): void {
    if (phase === 'cleared' && this.lastPhase !== 'cleared') this.waveCleared(scale);
    this.lastPhase = phase;
  }

  /** Wave cleared: intact towers mend a share; every tower follows the hostile damage scale. */
  waveCleared(scale: number): void {
    for (const t of this.h.towers) {
      t.rescaleHp(scale);
      t.mend(DURABILITY.clearMend);
    }
  }
}
