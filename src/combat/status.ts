import type { Element } from './events';

/**
 * Elemental status model (pure). Three statuses, three reactions.
 *
 *  Burning  (thermal)  - damage over time. Stacks to MAX_BURN_STACKS, each stack adds `dps`;
 *                        duration refreshes. Ticks every BURN_TICK s.
 *  Shocked  (electric) - brief disruption: movement x0.4 for DISRUPT_TIME (internal cooldown
 *                        DISRUPT_CD so it cannot be chain-locked); the shocked mark lasts SHOCK_TIME.
 *  Chilled  (cryo)     - accumulating meter 0..100: slows up to 55%; at 100 the target is Frozen
 *                        (FREEZE_TIME, cannot move, +25% damage taken) then immune to chill for
 *                        FREEZE_IMMUNE s. The meter decays after CHILL_DECAY_DELAY.
 *
 *  Reactions (each consumes the status that fuels it and has a per-target cooldown):
 *   thermal shock  - thermal hit on a target with chill >= 50 (or frozen): burst + removes chill.
 *   overload       - electric hit on a burning target: removes burn, thermal explosion.
 *   superconduct   - electric hit on a target with chill >= 40: -40 chill, +2 chain jumps, shock burst.
 */
export const MAX_BURN_STACKS = 5;
export const BURN_TICK = 0.5;
export const BURN_TIME = 4;
export const SHOCK_TIME = 3;
export const DISRUPT_TIME = 0.5;
export const DISRUPT_CD = 2;
export const CHILL_MAX_SLOW = 0.55;
export const CHILL_DECAY_DELAY = 2.5;
export const CHILL_DECAY = 18;
export const FREEZE_TIME = 1.5;
export const FREEZE_IMMUNE = 5;
export const REACTION_CD: Record<ReactionKind, number> = { thermalShock: 1.5, overload: 2, superconduct: 2.5 };

export type ReactionKind = 'thermalShock' | 'overload' | 'superconduct';
export type StatusKind = 'burn' | 'shock' | 'chill' | 'freeze';

export interface StatusState {
  burnT: number;
  burnStacks: number;
  burnDps: number;
  burnTickT: number;
  shockT: number;
  disruptT: number;
  disruptCd: number;
  chill: number;
  chillDelay: number;
  frozenT: number;
  immuneT: number;
  cd: Record<ReactionKind, number>;
}

export const newStatus = (): StatusState => ({ burnT: 0, burnStacks: 0, burnDps: 0, burnTickT: 0, shockT: 0, disruptT: 0, disruptCd: 0, chill: 0, chillDelay: 0, frozenT: 0, immuneT: 0, cd: { thermalShock: 0, overload: 0, superconduct: 0 } });

export function resetStatus(s: StatusState): void {
  Object.assign(s, newStatus());
}

export const isBurning = (s: StatusState) => s.burnStacks > 0 && s.burnT > 0;
export const isShocked = (s: StatusState) => s.shockT > 0;
export const isFrozen = (s: StatusState) => s.frozenT > 0;
export const isChilled = (s: StatusState, min = 1) => s.frozenT > 0 || s.chill >= min;
export const hasAnyStatus = (s: StatusState) => isBurning(s) || s.shockT > 0 || s.chill > 0 || s.frozenT > 0;

/** Applies burn: +1 stack (cap), refreshes duration; the strongest per-stack dps wins. */
export function applyBurn(s: StatusState, dps: number, duration = BURN_TIME): { stacks: number; fresh: boolean } {
  if (!(dps > 0) || !Number.isFinite(dps)) return { stacks: s.burnStacks, fresh: false };
  const fresh = !isBurning(s);
  if (fresh) {
    s.burnStacks = 0;
    s.burnTickT = BURN_TICK;
  }
  s.burnStacks = Math.min(MAX_BURN_STACKS, s.burnStacks + 1);
  s.burnDps = fresh ? dps : Math.max(s.burnDps, dps);
  s.burnT = Math.max(s.burnT, duration);
  return { stacks: s.burnStacks, fresh };
}

/** Applies shock. `disrupted` is true when a new disruption window opened. */
export function applyShock(s: StatusState, duration = SHOCK_TIME): { fresh: boolean; disrupted: boolean } {
  const fresh = s.shockT <= 0;
  s.shockT = Math.max(s.shockT, duration);
  let disrupted = false;
  if (s.disruptCd <= 0) {
    s.disruptT = DISRUPT_TIME;
    s.disruptCd = DISRUPT_CD;
    disrupted = true;
  }
  return { fresh, disrupted };
}

/** Adds chill. Returns 'freeze' when the meter fills. Frozen / immune targets gain nothing. */
export function applyChill(s: StatusState, amount: number): 'none' | 'chill' | 'freeze' {
  if (!(amount > 0) || s.frozenT > 0 || s.immuneT > 0) return 'none';
  s.chill = Math.min(100, s.chill + amount);
  s.chillDelay = CHILL_DECAY_DELAY;
  if (s.chill >= 100) {
    s.chill = 0;
    s.frozenT = FREEZE_TIME;
    s.immuneT = FREEZE_IMMUNE;
    return 'freeze';
  }
  return 'chill';
}

/** Movement multiplier from statuses (0 = frozen in place). */
export function speedFactor(s: StatusState): number {
  if (s.frozenT > 0) return 0;
  let f = 1 - Math.min(CHILL_MAX_SLOW, (s.chill / 100) * CHILL_MAX_SLOW * 1.1);
  if (s.disruptT > 0) f *= 0.4;
  return f;
}

/** Damage-taken multiplier from statuses (chilled targets are vulnerable). */
export function vulnerability(s: StatusState): number {
  return s.frozenT > 0 ? 1.25 : 1 + s.chill * 0.0015;
}

export interface TickHooks {
  burn(damage: number, stacks: number): void;
  expire(kind: StatusKind): void;
}

/** Advance all timers. Burn damage is delivered through `hooks.burn`. */
export function tickStatus(s: StatusState, dt: number, hooks: TickHooks): void {
  if (!(dt > 0)) return;
  for (const k of Object.keys(s.cd) as ReactionKind[]) if (s.cd[k] > 0) s.cd[k] = Math.max(0, s.cd[k] - dt);
  s.disruptCd = Math.max(0, s.disruptCd - dt);
  s.disruptT = Math.max(0, s.disruptT - dt);
  if (s.burnStacks > 0) {
    s.burnT -= dt;
    s.burnTickT -= dt;
    for (let guard = 0; s.burnTickT <= 0 && s.burnStacks > 0 && guard < 4; guard++) {
      s.burnTickT += BURN_TICK;
      hooks.burn(s.burnDps * s.burnStacks * BURN_TICK, s.burnStacks);
    }
    if (s.burnStacks > 0 && s.burnT <= 0) {
      s.burnStacks = 0;
      s.burnDps = 0;
      s.burnT = 0;
      hooks.expire('burn');
    }
  }
  if (s.shockT > 0) {
    s.shockT -= dt;
    if (s.shockT <= 0) {
      s.shockT = 0;
      hooks.expire('shock');
    }
  }
  if (s.frozenT > 0) {
    s.frozenT -= dt;
    if (s.frozenT <= 0) {
      s.frozenT = 0;
      hooks.expire('freeze');
    }
  } else if (s.chill > 0) {
    s.chillDelay -= dt;
    if (s.chillDelay <= 0) {
      s.chill = Math.max(0, s.chill - CHILL_DECAY * dt);
      if (s.chill === 0) hooks.expire('chill');
    }
  }
  if (s.immuneT > 0) s.immuneT = Math.max(0, s.immuneT - dt);
}

export interface ReactionResult {
  kind: ReactionKind;
  /** Burst damage dealt around the target (already includes the trigger's scaling). */
  damage: number;
  radius: number;
  element: Element;
  /** Extra chain jumps granted to the triggering lightning (superconduct). */
  chainBonus: number;
}

/**
 * Resolve reactions for a hit of `element` (the hit's own damage `amount` is already counted
 * by the caller). Consumes the fuelling status and starts the cooldown. Burn/DoT ticks must
 * not call this (reactions only come from direct hits), so a status can never re-trigger itself.
 */
export function resolveReactions(s: StatusState, element: Element, amount: number): ReactionResult[] {
  const out: ReactionResult[] = [];
  if (!(amount > 0)) return out;
  if (element === 'thermal' && s.cd.thermalShock <= 0 && (s.frozenT > 0 || s.chill >= 50)) {
    const frozen = s.frozenT > 0;
    out.push({ kind: 'thermalShock', damage: amount * (0.9 + (frozen ? 0.6 : (s.chill / 100) * 0.4)), radius: 4, element: 'thermal', chainBonus: 0 });
    s.chill = 0;
    s.frozenT = 0;
    s.cd.thermalShock = REACTION_CD.thermalShock;
  }
  if (element === 'electric') {
    if (s.cd.overload <= 0 && isBurning(s)) {
      const fuel = s.burnDps * s.burnStacks;
      out.push({ kind: 'overload', damage: fuel * 4 + amount * 0.6, radius: 5, element: 'thermal', chainBonus: 0 });
      s.burnStacks = 0;
      s.burnT = 0;
      s.burnDps = 0;
      s.cd.overload = REACTION_CD.overload;
    }
    if (s.cd.superconduct <= 0 && s.frozenT <= 0 && s.chill >= 40) {
      out.push({ kind: 'superconduct', damage: amount * 0.5, radius: 5, element: 'electric', chainBonus: 2 });
      s.chill -= 40;
      s.cd.superconduct = REACTION_CD.superconduct;
    }
  }
  return out;
}
