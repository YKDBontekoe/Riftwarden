// Seasons (docs/design/progression-design.md §11): a monthly seasonal profile next to the permanent one. It lives inside the
// account document (`SaveData.seasonal`), starts fresh every month with its own Rift Level ladder (one checkpoint
// fewer per unlock), a rotating season rule and a journey of goals; at the end of the month everything it earned
// moves into the permanent profile (`rolloverSeason`) and a summary is archived. Boards read the `board` summaries
// the rules keep on server-validated documents. Pure: `now` is always injected.
import type { SaveData } from './save/types';
import { createDefaultSave } from './save/defaults';
import { bankMastery } from './mastery';
import { checkpointsToUnlock } from './tiers';
import { levelForXp } from './level';
import { rarity } from '../loot/rarity';

/** Season 1 starts on 1 November 2026 (UTC); every calendar month is a season. */
const EPOCH = { year: 2026, month: 10 } as const;

export function seasonOf(now: number): number {
  const d = new Date(Number.isFinite(now) ? now : 0);
  return Math.max(1, (d.getUTCFullYear() - EPOCH.year) * 12 + (d.getUTCMonth() - EPOCH.month) + 1);
}

export function seasonStart(id: number): number {
  const k = EPOCH.month + Math.max(1, Math.floor(id)) - 1;
  return Date.UTC(EPOCH.year + Math.floor(k / 12), k % 12, 1);
}

export const seasonEnd = (id: number): number => seasonStart(id + 1);

export type SeasonRuleId = 'keyRush' | 'masteryFever' | 'bountiful' | 'rapidClimb';

export interface SeasonRule {
  id: SeasonRuleId;
  name: string;
  blurb: string;
}

/** One rule per season, rotating monthly (the permanent profile never has one). */
export const SEASON_RULES: readonly SeasonRule[] = [
  { id: 'keyRush', name: 'Key Rush', blurb: 'Elites drop pinnacle keys twice as often.' },
  { id: 'masteryFever', name: 'Mastery Fever', blurb: 'Weapon mastery XP +50%.' },
  { id: 'bountiful', name: 'Bountiful Rift', blurb: 'Loot luck +15% on every Rift Level.' },
  { id: 'rapidClimb', name: 'Rapid Climb', blurb: 'Rift Levels unlock with one checkpoint fewer (on top of the seasonal head start).' },
];

export const seasonRule = (id: number): SeasonRule => SEASON_RULES[(Math.max(1, Math.floor(id)) - 1) % SEASON_RULES.length];

/** The active season rule of a document (null on the permanent profile). */
export const ruleOf = (d: Pick<SaveData, 'seasonId'>): SeasonRuleId | null => (d.seasonId ? seasonRule(d.seasonId).id : null);

/** Checkpoints needed to unlock the next level: the seasonal ladder needs one fewer (two under Rapid Climb). */
export function checkpointsNeeded(d: Pick<SaveData, 'seasonId'>, rl: number): number {
  const base = checkpointsToUnlock(rl);
  if (!d.seasonId) return base;
  return Math.max(1, base - (ruleOf(d) === 'rapidClimb' ? 2 : 1));
}

// ------------------------------------------------------------------ the seasonal document

/** A fresh seasonal profile (deterministic: the server and every device build the same one). */
export function createSeasonDoc(profileId: string, id: number, tutorial: SaveData['tutorial']): SaveData {
  const pid = `${profileId.slice(0, 40)}.s${id}`;
  const d = createDefaultSave(seasonStart(id), { profileId: pid, starterUid: `${pid}.st` });
  d.seasonId = id;
  d.tutorial = { done: [...tutorial.done], skipped: tutorial.skipped };
  return d;
}

/** Why a seasonal profile cannot start now (null = it can). */
export function seasonStartBlocker(d: SaveData, id: number, now: number): string | null {
  if (d.seasonId) return 'Already a seasonal profile';
  if (id !== seasonOf(now)) return 'That season is not running';
  if (d.seasonal?.id === id) return 'The season already started';
  if (d.activeRun) return 'Not during an operation';
  return null;
}

/** Start this month's seasonal profile (op `startSeason`). */
export function startSeason(d: SaveData, id: number, now: number): string | null {
  const why = seasonStartBlocker(d, id, now);
  if (why) return why;
  rolloverSeason(d, now);
  d.seasonal = { id, doc: createSeasonDoc(d.profile.id, id, d.tutorial) };
  return null;
}

// ------------------------------------------------------------------ boards (kept by the rules on validated documents)

export interface BoardSummary {
  /** Highest Rift Level unlocked. */
  rl: number;
  /** Deepest wave cleared on any level. */
  wave: number;
  /** Highest Rift Level of the deepest wave (tie-breaker). */
  waveRl: number;
  at: number;
}

/** Refresh a document's board summary from its records (called whenever a checkpoint banks). */
export function updateBoard(d: SaveData, now: number): void {
  let wave = 0;
  let waveRl = 0;
  for (const [k, r] of Object.entries(d.records)) {
    const rl = Number(k);
    if (r.bestWave > wave || (r.bestWave === wave && rl > waveRl)) {
      wave = r.bestWave;
      waveRl = rl;
    }
  }
  const prev = d.board;
  if (prev && prev.rl === d.threat.unlocked && prev.wave === wave) return;
  d.board = { rl: d.threat.unlocked, wave, waveRl, at: now };
}

// ------------------------------------------------------------------ journey (cosmetic goals)

export interface JourneyGoal {
  id: string;
  label: string;
  done: (s: SaveData) => boolean;
}

const hasRarity = (s: SaveData, r: string) => s.items.some((i) => rarity(i.rarity).index >= rarity(r).index);

/** ~12 goals sized for 20-30 hours of a one-month season. */
export const JOURNEY: readonly JourneyGoal[] = [
  { id: 'rl3', label: 'Unlock Rift Level 3', done: (s) => s.threat.unlocked >= 3 },
  { id: 'rl5', label: 'Unlock Rift Level 5', done: (s) => s.threat.unlocked >= 5 },
  { id: 'rl8', label: 'Unlock Rift Level 8', done: (s) => s.threat.unlocked >= 8 },
  { id: 'rl12', label: 'Unlock Rift Level 12', done: (s) => s.threat.unlocked >= 12 },
  { id: 'warden10', label: 'Reach Warden level 10', done: (s) => levelForXp(s.progress.xp) >= 10 },
  { id: 'warden20', label: 'Reach Warden level 20', done: (s) => levelForXp(s.progress.xp) >= 20 },
  { id: 'epic', label: 'Secure an epic item', done: (s) => hasRarity(s, 'epic') },
  { id: 'legendary', label: 'Secure a legendary item', done: (s) => hasRarity(s, 'legendary') },
  { id: 'unique', label: 'Find a unique', done: (s) => s.items.some((i) => !!i.uniqueId) },
  { id: 'mastery10', label: 'Reach mastery rank 10 with any family', done: (s) => Object.values(s.progress.mastery ?? {}).some((m) => (m?.xp ?? 0) >= 13_050) },
  { id: 'pinnacle', label: 'Summon a pinnacle boss', done: (s) => (s.pinnacle?.runs ?? 0) > 0 },
  { id: 'liberate', label: 'Claim a Rift War victory cache', done: (s) => (s.war?.claimed.length ?? 0) > 0 },
];

export const journeyDone = (s: SaveData): string[] => JOURNEY.filter((g) => g.done(s)).map((g) => g.id);

/** Title for a season's journey (cosmetic; archived with the season). */
export const journeyTitle = (id: number, done: number): string | null => (done >= JOURNEY.length ? `Season ${id} Champion` : done >= 6 ? `Season ${id} Veteran` : null);

// ------------------------------------------------------------------ rollover (end of the month)

export interface SeasonArchive {
  id: number;
  rl: number;
  wave: number;
  journey: number;
  title: string | null;
}

/**
 * The month ended: everything the seasonal profile earned moves into the permanent one (gear into storage,
 * resources, Warden XP, mastery, codex, keys) and a summary is archived. Deterministic for a given `now`.
 */
export function rolloverSeason(d: SaveData, now: number): boolean {
  const s = d.seasonal;
  if (!s || s.id >= seasonOf(now) || s.doc.activeRun) return false;
  const doc = s.doc;
  const owned = new Set(d.items.map((i) => i.uid));
  for (const it of doc.items) {
    if (owned.has(it.uid)) continue;
    d.items.push(it);
    d.storage.uids.push(it.uid);
  }
  for (const k of ['salvage', 'credits', 'components', 'shards'] as const) d.resources[k] += doc.resources[k];
  d.progress.xp += doc.progress.xp;
  for (const [f, m] of Object.entries(doc.progress.mastery ?? {})) {
    const merged = bankMastery(d.progress.mastery, { [f]: m?.xp ?? 0 });
    if (merged) d.progress.mastery = merged;
  }
  d.codex = [...new Set([...(d.codex ?? []), ...(doc.codex ?? [])])];
  if (doc.pinnacle?.keys) d.pinnacle = { runs: d.pinnacle?.runs ?? 0, keys: Math.min(99, (d.pinnacle?.keys ?? 0) + doc.pinnacle.keys) };
  const done = journeyDone(doc).length;
  d.seasonsDone = [...(d.seasonsDone ?? []), { id: s.id, rl: doc.threat.unlocked, wave: doc.board?.wave ?? 0, journey: done, title: journeyTitle(s.id, done) }].slice(-60);
  delete d.seasonal;
  return true;
}
