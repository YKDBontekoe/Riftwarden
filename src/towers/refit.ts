// Tower refit / build-template rules as pure functions: the arena applies the result (spend, rebuild model, effects).
// Everything the rules need is passed in, so they are testable without a scene and shared by every Game flavour.
import { canInstall, levelCost, MAX_TOWER_LEVEL, partDef, swapCost, type TowerConfig, type TowerSlot } from './components';

export interface RefitInput {
  /** Why editing is unavailable right now (phase / tactical rule); null = allowed. */
  phaseBlock: string | null;
  exists: boolean;
  building: boolean;
  config: TowerConfig;
  level: number;
  what: 'level' | TowerSlot;
  id?: string;
  /** Researched blueprints (`slot:id`). */
  tech: ReadonlySet<string>;
  cores: number;
  /** Stats `buildCostMult`. */
  costMult: number;
}

export type RefitPlan = { ok: true; cost: number; config: TowerConfig; level: number } | { ok: false; reason: string };

const no = (reason: string): RefitPlan => ({ ok: false, reason });

/** Validate a level-up or component swap and compute its cost and resulting configuration. Never mutates. */
export function planRefit(i: RefitInput): RefitPlan {
  if (i.phaseBlock) return no(i.phaseBlock);
  if (!i.exists) return no('Tower no longer exists');
  if (i.building) return no('Tower is still deploying');
  let cost: number;
  let config = i.config;
  let level = i.level;
  if (i.what === 'level') {
    if (i.level >= MAX_TOWER_LEVEL) return no('Tower is at maximum level');
    cost = levelCost(i.config, i.level, i.costMult);
    level = i.level + 1;
  } else {
    if (i.what === 'base') return no('The base is fixed once built');
    const part = i.id ? partDef(i.what, i.id) : null;
    if (!i.id || !part) return no('Unknown component');
    if (i.config[i.what] === i.id) return no('Already installed');
    if (part.tech && !i.tech.has(`${i.what}:${i.id}`)) return no('Blueprint not researched (HQ tower technology)');
    const bad = canInstall(i.config, i.what, i.id);
    if (bad) return no(bad);
    cost = swapCost(i.config, i.what, i.id, i.costMult);
    config = { ...i.config, [i.what]: i.id };
  }
  if (i.cores < cost) return no(`Not enough cores (need ${cost})`);
  return { ok: true, cost, config, level };
}

export type TemplatePlan = { ok: true; config: TowerConfig } | { ok: false; reason: string };

/**
 * Choose a component for the build template (towers built from now on). Incompatible dependants reset to defaults
 * (weapon -> core/modifier, base -> weapon/core/modifier) so the template is always valid.
 */
export function planBuildConfig(current: TowerConfig, slot: TowerSlot, id: string, tech: ReadonlySet<string>): TemplatePlan {
  const def = partDef(slot, id);
  if (!def) return { ok: false, reason: 'Unknown component' };
  if (def.tech && !tech.has(`${slot}:${id}`)) return { ok: false, reason: 'Blueprint not researched' };
  let cfg: TowerConfig = { ...current, [slot]: id };
  for (let n = 0; n < 3; n++) {
    const bad = canInstall(cfg, slot, id);
    if (!bad) break;
    if (!bad.includes('cannot mount') && slot === 'weapon') {
      if (bad.includes(partDef('core', cfg.core)?.name ?? '#')) cfg = { ...cfg, core: 'standard_core' };
      if (bad.includes(partDef('modifier', cfg.modifier)?.name ?? '#')) cfg = { ...cfg, modifier: 'none' };
    } else if (slot === 'base') cfg = { ...cfg, weapon: 'autocannon', core: 'standard_core', modifier: 'none' };
    else return { ok: false, reason: bad };
  }
  const left = canInstall(cfg, slot, id);
  if (left) return { ok: false, reason: left };
  return { ok: true, config: cfg };
}
