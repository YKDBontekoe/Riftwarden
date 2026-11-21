/**
 * Enemy navigation on procedural (mazing) arenas, plugged into EnemyManager as an optional strategy.
 *
 *  - Ground enemies path on a NavGrid whose towers are expensive (re-planned whenever a tower is built,
 *    wrecked, repaired or recycled), flyers on the terrain-only grid (they pass over towers).
 *  - Spawns use either the gate tunnel or one of the gate's forward rifts, so first contact stays fast on a
 *    200 m map.
 *  - Breaching: when the next step of a ground enemy would enter a blocking tower, it stops and hits the tower
 *    at its reactor cadence until the tower is wrecked (the field then re-plans and the lane opens).
 *
 * No Babylon values: towers are read through a narrow host interface.
 */
import type { EnemyKind } from '../data/defs';
import type { ArenaLayout, GateId, Vec2 } from '../world/layout';
import { NavGrid } from '../world/navgrid';

/** Kinds that fly over towers (rush drones, jammers, artillery, the courier, the overseer and its emitters). */
export const FLYERS: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['rusher', 'jammer', 'artillery', 'courier', 'overseer', 'pylon', 'skimmer']);

/** Kinds that ignore towers on the ground field: flyers and the tunnelling burrower. */
export const PASS_TOWERS: ReadonlySet<EnemyKind> = new Set<EnemyKind>([...FLYERS, 'skimmer', 'burrower']);

export const NAV_TUNING = {
  /** Share of spawns that come out of a forward rift (when the gate has any). */
  riftShare: 0.55,
  /** Field re-sync interval (s); building a tower forces an immediate sync. */
  syncEvery: 0.25,
  /** Breach damage per hit = (base + reactor damage x scale) x wave damage multiplier (walker ~32, a pack of five
   *  wrecks a standard tower in ~4 s, a lone walker needs ~20 s). */
  breachBase: 8,
  breachScale: 4,
  /** Minimum time between breach hits (s). */
  breachMin: 0.7,
};

export interface NavTower {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Live, built towers block; wrecks and towers under construction do not. */
  readonly blocking: boolean;
}

export interface NavHost {
  towers(): readonly NavTower[];
  /** A breaching enemy hits a tower. */
  breach(towerId: number, damage: number, by: NavAgent): void;
}

/** The parts of an Enemy the navigator reads and writes. */
export interface NavAgent {
  kind: EnemyKind;
  path: Vec2[];
  seg: number;
  pos: { x: number; z: number };
  def: { radius: number; reactorDamage: number; attackInterval: number; role: string };
  damageMult: number;
  navV: number;
  breachT: number;
  breachId: number;
  alive: boolean;
}

export class EnemyNavigator {
  readonly ground: NavGrid;
  readonly air: NavGrid;
  private syncT = 0;
  /** Breach hits dealt this run (statistics / tests). */
  breaches = 0;

  constructor(readonly layout: ArenaLayout, private host: NavHost, private rand: () => number = Math.random) {
    this.ground = new NavGrid(layout, true);
    this.air = new NavGrid(layout, false);
  }

  grid(kind: EnemyKind): NavGrid {
    return PASS_TOWERS.has(kind) ? this.air : this.ground;
  }

  /** Re-read tower footprints (cheap when nothing changed). Returns true when the ground field changed. */
  sync(): boolean {
    const obs = this.host.towers().filter((t) => t.blocking).map((t) => ({ x: t.x, z: t.z, r: t.radius }));
    return this.ground.setObstacles(obs);
  }

  /** Where a new enemy of this gate enters: the tunnel or one of its forward rifts. */
  spawnPoint(gate: GateId, role: string): Vec2 {
    const rifts = (this.layout.rifts ?? []).filter((r) => r.gate === gate);
    // Bosses and couriers always make an entrance through the gate.
    if (rifts.length && role !== 'boss' && role !== 'hvt' && this.rand() < NAV_TUNING.riftShare) {
      const r = rifts[Math.floor(this.rand() * rifts.length)];
      const a = this.rand() * Math.PI * 2;
      const d = this.rand() * 1.6;
      return { x: r.x + Math.cos(a) * d, z: r.z + Math.sin(a) * d };
    }
    return this.layout.routes[gate].points[0];
  }

  /** Path from `from` for this kind; falls back to the lane when the field has no answer. */
  pathFrom(kind: EnemyKind, from: Vec2, gate: GateId): Vec2[] {
    const pts = this.grid(kind).pathFrom(from.x, from.z);
    return pts.length >= 2 ? pts : this.layout.routes[gate].points;
  }

  /** Survival: both fields flow to the living drones (re-plans every agent through the version bump). */
  hunt(goals: readonly Vec2[]): void {
    this.ground.retarget(goals);
    this.air.retarget(goals);
  }

  /** Per-frame bookkeeping (hostile time). */
  tick(hdt: number): void {
    this.syncT -= hdt;
    if (this.syncT <= 0) {
      this.syncT = NAV_TUNING.syncEvery;
      this.sync();
    }
  }

  /** Re-plan an agent whose field changed since its path was made. Returns true when the path was replaced. */
  refresh(e: NavAgent): boolean {
    const g = this.grid(e.kind);
    if (e.navV === g.version) return false;
    e.navV = g.version;
    if (e.seg >= e.path.length) return false; // already at the reactor
    const pts = g.pathFrom(e.pos.x, e.pos.z);
    if (pts.length < 2) return false;
    e.path = pts;
    e.seg = 1;
    return true;
  }

  /**
   * Called before a ground agent steps toward (nx, nz). Returns true when a live tower blocks the step: the
   * agent stays put and breaches it at its attack cadence.
   */
  blocked(e: NavAgent, nx: number, nz: number, hdt: number): boolean {
    if (PASS_TOWERS.has(e.kind)) return false;
    let hit: NavTower | null = null;
    for (const t of this.host.towers()) {
      if (!t.blocking) continue;
      const min = t.radius + e.def.radius * 0.6;
      const dn = Math.hypot(nx - t.x, nz - t.z);
      if (dn >= min) continue;
      // Only towers ahead count (an enemy pushed into one by separation can still walk out).
      if (dn >= Math.hypot(e.pos.x - t.x, e.pos.z - t.z)) continue;
      hit = t;
      break;
    }
    if (!hit) {
      e.breachId = 0;
      return false;
    }
    if (e.breachId !== hit.id) {
      e.breachId = hit.id;
      e.breachT = 0.35;
    }
    e.breachT -= hdt;
    if (e.breachT <= 0) {
      e.breachT = Math.max(NAV_TUNING.breachMin, e.def.attackInterval || 1);
      const dmg = (NAV_TUNING.breachBase + e.def.reactorDamage * NAV_TUNING.breachScale) * e.damageMult * (e.def.role === 'boss' ? 4 : 1);
      this.breaches++;
      this.host.breach(hit.id, dmg, e);
    }
    return true;
  }
}
