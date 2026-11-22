// Hostile area-blast rules as a pure function: who is hit, for how much, and what is suppressed.
// The arena applies the plan (damage the drone, hit the reactor, disable towers, hurt machines).

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export interface BlastOptions {
  /** Peak damage to drones (0 = none). */
  player: number;
  reactor?: number;
  /** Tower suppression seconds (towers are never destroyed). */
  disable?: number;
  /** Damage to machines through the shared pipeline. */
  enemies?: number;
}

export interface BlastWorld {
  drones: readonly { alive: boolean; pos: Pt }[];
  /** Cover test from just above the blast to drone `index` (true = clear line). Only called for drones in range. */
  clearShot(index: number): boolean;
  towers: readonly { pos: Pt }[];
  reactor: { x: number; z: number; radius: number };
}

export interface BlastPlan {
  droneHits: { index: number; amount: number }[];
  reactorDamage: number;
  disableTowers: number[];
  disableSeconds: number;
  machineDamage: number;
}

/** Drones this far above the blast centre are out of its reach (jumped over it). */
export const BLAST_MAX_RISE = 3.2;
/** Edge damage is 55% of the peak. */
export const BLAST_EDGE_FALLOFF = 0.45;

export function planBlast(center: Pt, radius: number, o: BlastOptions, w: BlastWorld): BlastPlan {
  const plan: BlastPlan = { droneHits: [], reactorDamage: 0, disableTowers: [], disableSeconds: 0, machineDamage: 0 };
  if (o.player > 0) {
    w.drones.forEach((d, index) => {
      if (!d.alive) return;
      const dist = Math.hypot(d.pos.x - center.x, d.pos.z - center.z);
      const rise = d.pos.y - center.y;
      if (dist < radius && rise < BLAST_MAX_RISE && w.clearShot(index)) plan.droneHits.push({ index, amount: o.player * (1 - BLAST_EDGE_FALLOFF * (dist / radius)) });
    });
  }
  if (o.reactor && o.reactor > 0 && Math.hypot(center.x - w.reactor.x, center.z - w.reactor.z) < radius + w.reactor.radius) plan.reactorDamage = o.reactor;
  if (o.disable && o.disable > 0) {
    plan.disableSeconds = o.disable;
    w.towers.forEach((t, i) => {
      if ((t.pos.x - center.x) ** 2 + (t.pos.z - center.z) ** 2 < radius * radius) plan.disableTowers.push(i);
    });
  }
  if (o.enemies && o.enemies > 0) plan.machineDamage = o.enemies;
  return plan;
}
