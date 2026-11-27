// Progression pacing simulation (docs/design/progression-design.md "Validation"): a modelled player plays hours of waves
// through the real wave composer and drop tables, equips what is better, and climbs Rift Levels once their gear
// matches the level. It pins the time-to-first-X targets so later tuning cannot silently speed the chase up again.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { DROP_SOURCES, type DropSource, rollDrops } from '@riftwarden/rules/loot/drops';
import { flatScale } from '@riftwarden/rules/loot/generate';
import { gatedOdds, RARITIES, rarity, rarityCeiling, type RarityId } from '@riftwarden/rules/loot/rarity';
import { nextPity } from '@riftwarden/rules/loot/roll';
import { getTier, isCheckpointWave, itemScale, unlocksNextTier } from '@riftwarden/rules/progression/tiers';
import { SurvivalPlanner } from '@riftwarden/rules/survival/plan';

/** Waves per hour of play: ~30 s fights + 12 s preparation. */
const WAVES_PER_HOUR = 85;
/** A typical run: three map nodes, then extract. */
const RUN_WAVES = 15;
/** Gear slots a player fills (weapon, weapon2, armor, shield, reactor, processor, accessory). */
const SLOTS = 7;
/**
 * The tree, run upgrades, enhancement, mastery and skill are worth this much gear for the average player; the endless
 * tree and mastery keep adding (~+0.4% per hour played).
 */
const handicap = (hours: number) => 0.9 / (1 + 0.004 * hours);

const power = (level: number, r: RarityId) => flatScale(level) * rarity(r).baseMult * (1 + 0.05 * rarity(r).index);

interface SimResult {
  firstHour: Partial<Record<RarityId, number>>;
  rlAt: Record<number, number>;
  drops: number;
}

function simulate(hours: number, seed = 1): SimResult {
  const rand = mulberry32(seed);
  const gear: number[] = Array.from({ length: SLOTS }, () => power(1, 'common'));
  const firstHour: SimResult['firstHour'] = {};
  const rlAt: Record<number, number> = {};
  let rl = 1;
  let unlocked = 1;
  let pity = 0;
  let drops = 0;
  let wavesPlayed = 0;
  const cps: Record<number, number> = {};
  const total = Math.floor(hours * WAVES_PER_HOUR);
  let run = 0;
  while (wavesPlayed < total) {
    run++;
    const planner = new SurvivalPlanner(seed * 1000 + run, getTier(rl), null);
    for (let w = 1; w <= RUN_WAVES && wavesPlayed < total; w++, wavesPlayed++) {
      const hour = wavesPlayed / WAVES_PER_HOUR;
      const ctx = { wave: w, tier: rl, tierLevelBonus: getTier(rl).lootLevelBonus, tierLuck: 1, pity };
      const sources: DropSource[] = [DROP_SOURCES.wave];
      for (const s of planner.compose(w).spawns) {
        if (s.tag === 'hvt') sources.push(DROP_SOURCES.hvt);
        else if (s.kind in DROP_SOURCES) sources.push(DROP_SOURCES[s.kind as keyof typeof DROP_SOURCES]);
        if (s.mods?.length) sources.push({ ...DROP_SOURCES.elite, chance: Math.min(1, 0.3 + 0.12 * s.mods.length), luck: 1.7 + 0.35 * s.mods.length });
      }
      if (isCheckpointWave(w)) sources.push(DROP_SOURCES.checkpoint);
      for (const src of sources) {
        for (const d of rollDrops(src, { ...ctx, pity }, rand)) {
          drops++;
          pity = nextPity(pity, [d]);
          if (firstHour[d.rarity] === undefined) firstHour[d.rarity] = hour;
          // Equip into the weakest slot when better (the player keeps their best gear).
          const p = power(d.level, d.rarity);
          const weakest = gear.indexOf(Math.min(...gear));
          if (p > gear[weakest]) gear[weakest] = p;
        }
      }
      if (isCheckpointWave(w)) {
        cps[rl] = (cps[rl] ?? 0) + 1;
        if (unlocksNextTier(rl, cps[rl]) && unlocked < rl + 1) unlocked = rl + 1;
      }
    }
    // Climb once the loadout can take the next level: damage x toughness (gear^2) against hull x damage of the level.
    const avg = gear.reduce((a, b) => a + b, 0) / SLOTS;
    while (unlocked > rl && avg >= Math.sqrt(getTier(rl + 1).hpMult * getTier(rl + 1).damageMult) * handicap(wavesPlayed / WAVES_PER_HOUR)) {
      rl++;
      rlAt[rl] ??= wavesPlayed / WAVES_PER_HOUR;
    }
  }
  return { firstHour, rlAt, drops };
}

describe('progression pacing', () => {
  it('the tier curve mirrors item stat growth', () => {
    for (const l of [1, 7, 41, 333, 5000]) expect(itemScale(l)).toBeCloseTo(flatScale(l), 9);
  });

  it('rarity is gated by the Rift Level (§3)', () => {
    expect(rarityCeiling(1)).toBe('rare');
    expect(rarityCeiling(3)).toBe('epic');
    expect(rarityCeiling(6)).toBe('epic');
    expect(rarityCeiling(7)).toBe('legendary');
    expect(rarityCeiling(12)).toBe('exotic');
    // Bosses and caches open epics one level early, never legendary or exotic; Ascended is never rolled.
    expect(rarityCeiling(2, 1)).toBe('epic');
    expect(rarityCeiling(6, 1)).toBe('epic');
    expect(rarityCeiling(500, 5)).toBe('exotic');
    const o3 = gatedOdds(3);
    expect(o3.legendary).toBe(0);
    expect(o3.epic).toBeGreaterThan(0.004);
    expect(o3.epic).toBeLessThan(0.01);
    expect(gatedOdds(7).legendary).toBeGreaterThan(0.0003);
    expect(gatedOdds(7).legendary).toBeLessThan(0.001);
    expect(gatedOdds(11).exotic).toBe(0);
    // Ceilings: deep levels never turn drops into a fountain.
    const deep = gatedOdds(400, 3);
    expect(deep.legendary + deep.exotic).toBeLessThan(0.12);
    expect(gatedOdds(400).exotic).toBeLessThan(0.007);
    // Odds sum to one and rise monotonically with the level.
    for (let rl = 1; rl <= 60; rl++) {
      const a = gatedOdds(rl);
      const b = gatedOdds(rl + 1);
      expect(Object.values(a).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
      for (const r of ['epic', 'legendary', 'exotic'] as const) expect(b[r]).toBeGreaterThanOrEqual(a[r]);
    }
  });

  it('a boss floor still rolls on RL 1, and luck stays capped', () => {
    const o = gatedOdds(1, 2.6, 'epic', 1);
    expect(o.epic).toBe(1);
    const lucky = gatedOdds(10, 99);
    expect(lucky.exotic).toBeLessThan(gatedOdds(10).exotic * Math.pow(3, 0.6 * 5) + 1e-9);
    for (const r of RARITIES) expect(Number.isFinite(lucky[r.id])).toBe(true);
  });

  it('bad-luck protection raises legendary odds after a dry spell and resets on a hit', () => {
    const base = gatedOdds(9).legendary;
    expect(gatedOdds(9, 1, 'common', 0, 100).legendary).toBeGreaterThan(base * 1.8);
    expect(gatedOdds(9, 1, 'common', 0, 100000).legendary).toBeLessThan(base * 3.2);
    expect(nextPity(5, [{ rarity: 'rare' }, { rarity: 'epic' }])).toBe(7);
    expect(nextPity(50, [{ rarity: 'rare' }, { rarity: 'legendary' }])).toBe(0);
    expect(nextPity(50, [{ rarity: 'legendary' }, { rarity: 'rare' }])).toBe(1);
  });

  it('meets the time-to-first-X targets for an average player', () => {
    const runs = [1, 2, 3, 4, 5].map((s) => simulate(90, s));
    const median = (f: (r: SimResult) => number | undefined) => {
      const xs = runs.map((r) => f(r) ?? Infinity).sort((a, b) => a - b);
      return xs[2];
    };
    const legendary = median((r) => r.firstHour.legendary);
    const exotic = median((r) => r.firstHour.exotic);
    const ascended = median((r) => r.firstHour.ascended);
    const epic = median((r) => r.firstHour.epic);
    console.log('pacing', JSON.stringify({ epic, legendary, exotic, ascended, dropsPerHour: runs[0].drops / 90, rl: runs.map((r) => Object.entries(r.rlAt).filter(([k]) => +k % 3 === 0 || +k === Math.max(...Object.keys(r.rlAt).map(Number))).map(([k, v]) => `${k}@${v.toFixed(1)}`).join(' ')) }));
    expect(epic).toBeLessThan(1);
    expect(legendary).toBeGreaterThan(1.5);
    expect(legendary).toBeLessThan(4);
    expect(exotic).toBeGreaterThan(6);
    expect(exotic).toBeLessThan(20);
    expect(ascended).toBeGreaterThan(30);
    expect(ascended).toBeLessThan(90);
    // Climb: quick first levels, then a long, never-ending slope (no plateau, no sprint).
    const at = (rl: number) => median((r) => r.rlAt[rl]);
    expect(at(5)).toBeLessThan(1.5);
    expect(at(10)).toBeGreaterThan(1.5);
    expect(at(10)).toBeLessThan(6);
    expect(at(15)).toBeGreaterThan(12);
    expect(at(15)).toBeLessThan(40);
    expect(at(18)).toBeLessThan(90);
    expect(at(30)).toBe(Infinity);
  });
});
