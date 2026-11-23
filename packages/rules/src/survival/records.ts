import type { SurvivalStats } from '../progression/run';

/** Survival milestones (pure). Evaluated from real run statistics only. */
export interface MilestoneDef {
  id: string;
  label: string;
  test(s: { wavesCleared: number; tier: number; survival: SurvivalStats }): boolean;
}

export const MILESTONES: readonly MilestoneDef[] = [
  { id: 'w10', label: 'Held the line for 10 waves', test: (s) => s.wavesCleared >= 10 },
  { id: 'w25', label: 'Survived 25 waves', test: (s) => s.wavesCleared >= 25 },
  { id: 'w50', label: 'Survived 50 waves', test: (s) => s.wavesCleared >= 50 },
  { id: 'w100', label: 'Survived 100 waves', test: (s) => s.wavesCleared >= 100 },
  { id: 'boss1', label: 'First boss destroyed', test: (s) => s.survival.bossesKilled >= 1 },
  { id: 'colossus', label: 'Siege Colossus destroyed', test: (s) => s.survival.bosses.some((b) => b.startsWith('Siege Colossus')) },
  { id: 'overseer', label: 'Overseer Core destroyed', test: (s) => s.survival.bosses.some((b) => b.startsWith('Overseer Core')) },
  { id: 'bossPair', label: 'Both command machines destroyed in one run', test: (s) => s.survival.bosses.some((b) => b.startsWith('Siege')) && s.survival.bosses.some((b) => b.startsWith('Overseer')) },
  { id: 'elite25', label: '25 elites destroyed in one run', test: (s) => s.survival.elitesKilled >= 25 },
  { id: 'hvt', label: 'Vault Courier intercepted', test: (s) => s.survival.hvtKilled >= 1 },
  { id: 'tier4w10', label: 'Wave 10 on Rift Level 4', test: (s) => s.tier >= 4 && s.wavesCleared >= 10 },
  { id: 'tier5w10', label: 'Wave 10 on Rift Level 5', test: (s) => s.tier >= 5 && s.wavesCleared >= 10 },
];

export function milestoneLabel(id: string): string {
  return MILESTONES.find((m) => m.id === id)?.label ?? id;
}

/** Milestones newly reached (not already in `have`). */
export function newMilestones(s: { wavesCleared: number; tier: number; survival: SurvivalStats }, have: readonly string[]): MilestoneDef[] {
  return MILESTONES.filter((m) => !have.includes(m.id) && m.test(s));
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
