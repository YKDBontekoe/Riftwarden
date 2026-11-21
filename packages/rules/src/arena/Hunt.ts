import type { EnemyNavigator } from '../enemies/navigation';
import type { ArenaLayout, Vec2 } from '../world/layout';

/** Survival tuning. */
export const HUNT = {
  /** Field re-seed interval (s) and the distance a drone must move before it is worth one (m). */
  retargetEvery: 0.8,
  retargetMove: 3,
  /** Machines that reached the hunted drone chase again beyond this range (m). */
  chaseRange: 9,
  /** Reactor attacks become hits on the hunted drone: share of the reactor damage, cap per hit (share of max hull). */
  hitShare: 0.8,
  hitCap: 0.4,
};

/**
 * Survival mode ("hunt"): there is no reactor to defend; every machine hunts the drone(s).
 *
 * Enemy behaviours aim at `ctx.layout.reactor`. In survival the enemy context gets a layout whose reactor is a point
 * that follows the drone each enemy is focused on (set per enemy by the arena's focus hook), so walkers shoot it,
 * rushers detonate on it, artillery ranges it and bosses beam it, without touching any behaviour. The navigation
 * fields flow to the living drones instead of the reactor ring (re-seeded when they move).
 */
export class Hunt {
  /** The enemies' layout: the real one with a moving "reactor". */
  readonly layout: ArenaLayout;
  private readonly goal: { x: number; z: number; radius: number; height: number };
  private t = 0;
  private seeded: Vec2[] = [];

  constructor(real: ArenaLayout) {
    this.goal = { x: real.reactor.x, z: real.reactor.z, radius: 0.8, height: 2 };
    this.layout = Object.create(real, { reactor: { value: this.goal, enumerable: true } }) as ArenaLayout;
  }

  /** Point the machines' "reactor" at the drone the current enemy hunts. */
  aim(p: { x: number; z: number }): void {
    this.goal.x = p.x;
    this.goal.z = p.z;
  }

  /** Re-seed the navigation fields on the living drones when they moved far enough (throttled). */
  update(dt: number, nav: EnemyNavigator | null, drones: readonly Vec2[]): boolean {
    this.t -= dt;
    if (!nav || !drones.length || this.t > 0) return false;
    const moved = drones.length !== this.seeded.length || drones.some((d, i) => Math.hypot(d.x - this.seeded[i].x, d.z - this.seeded[i].z) > HUNT.retargetMove);
    if (!moved) return false;
    this.t = HUNT.retargetEvery;
    this.seeded = drones.map((d) => ({ x: d.x, z: d.z }));
    nav.hunt(this.seeded);
    return true;
  }

  /** Damage a hunted drone takes from an attack aimed at the "reactor". */
  static hitFor(reactorDamage: number, maxHull: number): number {
    return Math.min(reactorDamage * HUNT.hitShare, maxHull * HUNT.hitCap);
  }
}
