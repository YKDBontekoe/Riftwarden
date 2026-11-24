// Seasons (docs/progression-design.md §11): calendar, the nested seasonal profile, season-tagged replay, the faster
// ladder, journey, board summaries, end-of-month rollover, and the device Profile's seasonal mode.
import { describe, expect, it } from 'vitest';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { emptyRewards } from '@riftwarden/rules/progression/run';
import { runOp } from '@riftwarden/rules/progression/ops';
import { bankRewards, beginRun, createDefaultSave, parseSave, sanitizeSave, serializeSave } from '@riftwarden/rules/progression/save';
import {
  checkpointsNeeded,
  createSeasonDoc,
  JOURNEY,
  journeyDone,
  rolloverSeason,
  ruleOf,
  seasonEnd,
  seasonOf,
  seasonRule,
  seasonStart,
} from '@riftwarden/rules/progression/seasons';
import { replay } from '@riftwarden/rules/progression/sync';
import { checkpointsToUnlock } from '@riftwarden/rules/progression/tiers';
import { Profile } from '@riftwarden/game/progression/Profile';

const NOV = Date.UTC(2026, 10, 24);
const DEC = Date.UTC(2026, 11, 2);

class Mem {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('season calendar and rules', () => {
  it('every calendar month is a season with a rotating rule', () => {
    expect(seasonOf(NOV)).toBe(1);
    expect(seasonOf(DEC)).toBe(2);
    expect(seasonOf(Date.UTC(2027, 10, 1))).toBe(13);
    expect(seasonStart(2)).toBe(Date.UTC(2026, 11, 1));
    expect(seasonEnd(1)).toBe(seasonStart(2));
    expect(seasonRule(1).id).not.toBe(seasonRule(2).id);
    expect(seasonRule(5).id).toBe(seasonRule(1).id);
  });

  it('the seasonal ladder needs one checkpoint fewer (two under Rapid Climb), never below one', () => {
    const perm = createDefaultSave(NOV);
    const s1 = createSeasonDoc('pf_x', 1, perm.tutorial);
    expect(checkpointsNeeded(perm, 10)).toBe(checkpointsToUnlock(10));
    expect(checkpointsNeeded(s1, 10)).toBe(checkpointsToUnlock(10) - (ruleOf(s1) === 'rapidClimb' ? 2 : 1));
    expect(checkpointsNeeded(s1, 1)).toBe(1);
    const rapid = createSeasonDoc('pf_x', [1, 2, 3, 4].find((i) => seasonRule(i).id === 'rapidClimb')!, perm.tutorial);
    expect(checkpointsNeeded(rapid, 10)).toBe(checkpointsToUnlock(10) - 2);
  });
});

describe('the seasonal profile inside the account document', () => {
  it('starts deterministically by op (this month only), takes season-tagged entries, and survives save round trips', () => {
    const d = createDefaultSave(NOV, { profileId: 'pf_s' });
    expect(runOp(d, 'startSeason', [2], 'tx1', NOV).ok).toBe(false);
    expect(runOp(d, 'startSeason', [1], 'tx2', NOV).ok).toBe(true);
    expect(d.seasonal?.id).toBe(1);
    expect(d.seasonal?.doc).toEqual(createSeasonDoc('pf_s', 1, d.tutorial));
    expect(runOp(d, 'startSeason', [1], 'tx3', NOV).ok).toBe(false);
    // A run on the seasonal profile: the permanent one is untouched.
    const r = replay(d, [{ seq: 1, at: NOV, season: 1, run: { kind: 'start', runId: 'rs1', tier: 1, at: NOV, mapSeed: 0, mode: 'defense', select: true } }], NOV);
    expect(r.results[0].ok).toBe(true);
    expect(r.doc.seasonal?.doc.activeRun?.id).toBe('rs1');
    expect(r.doc.activeRun).toBeNull();
    const back = parseSave(serializeSave(r.doc), NOV);
    expect(back.ok && back.data.seasonal?.doc.activeRun?.id).toBe('rs1');
  });

  it('rolls over at the end of the month: gear, resources, XP, mastery and codex move to the permanent profile', () => {
    const d = createDefaultSave(NOV, { profileId: 'pf_r' });
    runOp(d, 'startSeason', [1], 't', NOV);
    const s = d.seasonal!.doc;
    beginRun(s, 'srun', 1, NOV);
    const epic = generateItem({ uid: 'season_epic', seed: 9, level: 30, rarity: 'epic', baseId: 'plasma_repeater', source: 't' });
    bankRewards(s, 'srun', 5, { ...emptyRewards(), credits: 500, xp: 900, items: [epic], mastery: { plasma: 400 } });
    s.activeRun = null;
    const before = { credits: d.resources.credits, xp: d.progress.xp, items: d.items.length };
    expect(rolloverSeason(d, NOV)).toBe(false);
    // The month is over: sanitize (any load, on the server or the device) rolls it over deterministically.
    const after = sanitizeSave(JSON.parse(JSON.stringify(d)), DEC).data;
    expect(after.seasonal).toBeUndefined();
    expect(after.resources.credits).toBe(before.credits + s.resources.credits);
    expect(after.progress.xp).toBe(before.xp + 900);
    expect(after.progress.mastery?.plasma?.xp).toBe(400);
    expect(after.items.some((i) => i.uid === 'season_epic')).toBe(true);
    expect(after.items.length).toBe(before.items + s.items.length);
    expect(after.codex).toEqual(expect.arrayContaining(['rarity:epic']));
    expect(after.seasonsDone?.[0]).toMatchObject({ id: 1, rl: 2 });
    // Late entries for the closed season are refused.
    const late = replay(after, [{ seq: 9, at: DEC, season: 1, op: { name: 'selectTier', args: [1] } }], DEC);
    expect(late.results[0]).toMatchObject({ ok: false, reason: 'that season is over' });
  });

  it('journey goals and board summaries follow the seasonal document', () => {
    const s = createSeasonDoc('pf_j', 1, { done: [], skipped: false });
    expect(journeyDone(s)).toEqual([]);
    s.threat.unlocked = 6;
    expect(journeyDone(s)).toEqual(['rl3', 'rl5']);
    expect(JOURNEY.length).toBe(12);
    beginRun(s, 'b1', 6, NOV);
    s.records['6'] = { ...(s.records['6'] ?? {}), bestWave: 25 } as never;
    bankRewards(s, 'b1', 5, emptyRewards());
    expect(s.board).toMatchObject({ rl: 6, wave: 25, waveRl: 6 });
  });
});

describe('device Profile seasonal mode', () => {
  it('routes rules, ops and journal entries to the seasonal profile and back', () => {
    const p = new Profile(new Mem());
    expect(p.setSeasonMode(true)).toBe(false);
    expect(p.permanentOp('startSeason', [seasonOf(Date.now())]).ok).toBe(true);
    expect(p.setSeasonMode(true)).toBe(true);
    expect(p.seasonActive).toBe(true);
    expect(p.save.seasonId).toBe(seasonOf(Date.now()));
    p.op('selectTier', [1]);
    const last = p.journal.state.entries[p.journal.state.entries.length - 1];
    expect(last.season).toBe(seasonOf(Date.now()));
    expect(p.permanent.seasonal?.doc.profile.id).toBe(p.save.profile.id);
    expect(p.setSeasonMode(false)).toBe(true);
    expect(p.save.seasonId).toBeUndefined();
    p.op('selectTier', [1]);
    expect(p.journal.state.entries[p.journal.state.entries.length - 1].season).toBeUndefined();
  });
});
