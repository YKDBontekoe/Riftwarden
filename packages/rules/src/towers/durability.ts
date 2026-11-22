/**
 * Tower durability on mazing arenas: ground enemies that find a tower in their path breach it.
 * A tower at 0 HP becomes a wreck (no firing, no blocking); repairing restores it for cores, recycling a wreck
 * refunds less. Pure rules; Turret/Game apply them.
 */
export const DURABILITY = {
  baseHp: { standard: 420, bastion: 720, spire: 330 } as Record<string, number>,
  /** +25% max HP per level above 1. */
  perLevel: 0.25,
  /** Repair cost as a share of what was paid into the tower, scaled by the missing HP fraction. */
  repairShare: 0.4,
  /** A wreck costs this much more to repair (rebuild of the chassis). */
  wreckSurcharge: 1.25,
  /** Wreck recycle refund multiplier (on top of the normal refund ratio). */
  wreckRefund: 0.4,
  /** Towers mend this share of max HP when a wave is cleared (not wrecks). */
  clearMend: 0.25,
};

export function towerMaxHp(base: string, level: number, scale = 1): number {
  const hp = (DURABILITY.baseHp[base] ?? DURABILITY.baseHp.standard) * (1 + DURABILITY.perLevel * (Math.max(1, level) - 1));
  return Math.round(hp * (Number.isFinite(scale) && scale > 0 ? scale : 1));
}

export function repairCost(paid: number, hp: number, maxHp: number, wrecked: boolean): number {
  if (!(maxHp > 0)) return 0;
  const missing = wrecked ? 1 : Math.max(0, Math.min(1, 1 - hp / maxHp));
  if (missing <= 0) return 0;
  return Math.max(5, Math.round(paid * DURABILITY.repairShare * missing * (wrecked ? DURABILITY.wreckSurcharge : 1)));
}

export function recycleRefund(paid: number, refundRatio: number, wrecked: boolean): number {
  return Math.round(paid * refundRatio * (wrecked ? DURABILITY.wreckRefund : 1));
}
