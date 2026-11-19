// HUD view-model pieces as pure functions of plain data. The arena gathers the inputs; nothing here touches a scene,
// the store or `Game`, so every branch is unit-testable and the same rules serve every Game flavour.
import { DEFAULT_SETTINGS, keyLabel, type Settings } from '../core/settings';
import { expiresAfterWave } from '../loot/lifetime';
import type { LootTargetInfo, RunHud, WavePhase } from './store';
import { nextCheckpoint } from '../progression/tiers';

export interface HintState {
  /** The arena screen is `playing` (no panel/pause open). */
  playing: boolean;
  phase: WavePhase;
  wave: number;
  kills: number;
  tacticalEnergy: number;
  tacticalActive: boolean;
  /** Checkpoint secured: the return-home window is open. */
  canReturnHome: boolean;
  playerAlive: boolean;
  /** Build mode or the tutorial card already explains things: show no hint. */
  suppress: boolean;
}

/** The one-line contextual hint under the HUD ('' = none). */
export function hintFor(s: HintState, keys: Settings['keys'] = DEFAULT_SETTINGS.keys): string {
  if (!s.playing || !s.playerAlive || s.suppress) return '';
  if (s.canReturnHome) return `Checkpoint secured. Press ${keyLabel(keys.checkpoint)} to return to HQ, or start the next wave with ${keyLabel(keys.wave)}.`;
  if (s.phase === 'prep' && s.wave === 1) return `Build Sentinel turrets beside the orange enemy lanes (2 / ${keyLabel(keys.build)}). Press ${keyLabel(keys.wave)} to start the wave.`;
  if (s.phase === 'prep') return `Preparation: build and reposition. Press ${keyLabel(keys.wave)} to start early.`;
  if (s.wave === 1 && s.phase === 'combat' && s.kills < 3) return 'Aim for the glowing visors: weakpoints always crit.';
  if (s.wave === 2 && s.phase === 'combat' && s.tacticalEnergy >= 99 && !s.tacticalActive) return `${keyLabel(keys.tactical)}: tactical slow-time lets you place several turrets mid-fight.`;
  return '';
}

export interface LootTargetInput {
  item: { uid: string; name: string; rarity: string; level: number; category: string };
  droppedWave: number;
  expiring: boolean;
  cargoFull: boolean;
  /** Item currently in the slot this would go to. */
  equipped: { name: string; level: number; rarity: string } | null;
}

/** Prompt card for the pickup the drone is aiming at (modules have no slot, so no comparison). */
export function lootTargetInfo(i: LootTargetInput): LootTargetInfo {
  const cmp = i.item.category === 'module' ? null : i.equipped;
  return {
    uid: i.item.uid,
    name: i.item.name,
    rarity: i.item.rarity,
    level: i.item.level,
    category: i.item.category,
    expiresAfterWave: expiresAfterWave(i.droppedWave),
    expiring: i.expiring,
    cargoFull: i.cargoFull,
    equippedName: cmp?.name ?? null,
    equippedLevel: i.equipped?.level ?? 0,
    equippedRarity: i.equipped?.rarity ?? null,
  };
}

export interface RunLedgerView {
  unsecured: { salvage: number; credits: number; components: number };
  secured: { salvage: number; credits: number; components: number; xp?: number };
  /** XP earned so far (secured + at risk). */
  xpEarned?: number;
  wavesCleared: number;
  lastBankedWave: number;
  kills: number;
  duration: number;
}

/** The run block of the HUD (secured vs. at-risk rewards, next checkpoint). */
export function runHud(tier: number, run: RunLedgerView, checkpointOpen: boolean): RunHud {
  return {
    tier,
    salvageUnsecured: run.unsecured.salvage,
    salvageSecured: run.secured.salvage,
    creditsUnsecured: run.unsecured.credits,
    creditsSecured: run.secured.credits,
    componentsUnsecured: run.unsecured.components,
    componentsSecured: run.secured.components,
    xpSecured: run.secured.xp ?? 0,
    xpUnsecured: Math.max(0, (run.xpEarned ?? 0) - (run.secured.xp ?? 0)),
    nextCheckpoint: nextCheckpoint(run.wavesCleared + 1),
    checkpointOpen,
    lastBankedWave: run.lastBankedWave,
    kills: run.kills,
    duration: run.duration,
  };
}
