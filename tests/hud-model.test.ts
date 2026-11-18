import { describe, expect, it } from 'vitest';
import { hintFor, type HintState, lootTargetInfo, runHud } from '../src/ui/hudModel';
import { expiresAfterWave } from '../src/loot/lifetime';
import { nextCheckpoint } from '../src/progression/tiers';

/** The inline logic from Game.publishHud this module replaced, kept as the reference. */
function oldHint(s: HintState): string {
  let hint = '';
  if (s.playing) {
    if (s.phase === 'prep' && s.wave === 1) hint = 'Build Sentinel turrets beside the orange enemy lanes (2 / B). Press G to start the wave.';
    else if (s.phase === 'prep') hint = 'Preparation: build and reposition. Press G to start early.';
    else if (s.wave === 1 && s.phase === 'combat' && s.kills < 3) hint = 'Aim for the glowing visors: weakpoints always crit.';
    else if (s.wave === 2 && s.phase === 'combat' && s.tacticalEnergy >= 99 && !s.tacticalActive) hint = 'Q: tactical slow-time lets you place several turrets mid-fight.';
    if (s.canReturnHome) hint = 'Checkpoint secured. Press H to return to HQ, or start the next wave with G.';
  }
  if (!s.playerAlive || s.suppress) hint = '';
  return hint;
}

describe('hintFor', () => {
  it('matches the previous inline logic for every combination of inputs', () => {
    let nonEmpty = 0;
    let n = 0;
    for (const playing of [true, false])
      for (const phase of ['prep', 'combat', 'cleared'] as const)
        for (const wave of [1, 2, 3, 10])
          for (const kills of [0, 2, 3, 50])
            for (const tacticalEnergy of [0, 98.9, 99, 100])
              for (const tacticalActive of [true, false])
                for (const canReturnHome of [true, false])
                  for (const playerAlive of [true, false])
                    for (const suppress of [true, false]) {
                      const s: HintState = { playing, phase, wave, kills, tacticalEnergy, tacticalActive, canReturnHome, playerAlive, suppress };
                      const h = hintFor(s);
                      expect(h, JSON.stringify(s)).toBe(oldHint(s));
                      n++;
                      if (h) nonEmpty++;
                    }
    expect(n).toBe(2 * 3 * 4 * 4 * 4 * 2 * 2 * 2 * 2);
    expect(nonEmpty).toBeGreaterThan(100); // not vacuous
  });

  it('shows nothing while dead, in build mode / tutorial, or with a panel open', () => {
    const base: HintState = { playing: true, phase: 'prep', wave: 1, kills: 0, tacticalEnergy: 0, tacticalActive: false, canReturnHome: false, playerAlive: true, suppress: false };
    expect(hintFor(base)).not.toBe('');
    expect(hintFor({ ...base, playerAlive: false })).toBe('');
    expect(hintFor({ ...base, suppress: true })).toBe('');
    expect(hintFor({ ...base, playing: false })).toBe('');
  });

  it('the checkpoint message wins over every other hint', () => {
    const s: HintState = { playing: true, phase: 'prep', wave: 1, kills: 0, tacticalEnergy: 100, tacticalActive: false, canReturnHome: true, playerAlive: true, suppress: false };
    expect(hintFor(s)).toMatch(/Checkpoint secured/);
  });
});

describe('lootTargetInfo', () => {
  const item = { uid: 'u1', name: 'Rail Lancer', rarity: 'epic', level: 12, category: 'weapon' };
  const cur = { name: 'Old Repeater', level: 9, rarity: 'rare' };

  it('compares against the slot occupant and carries the lifetime rule', () => {
    const r = lootTargetInfo({ item, droppedWave: 6, expiring: true, cargoFull: false, equipped: cur });
    expect(r).toMatchObject({ uid: 'u1', name: 'Rail Lancer', rarity: 'epic', level: 12, category: 'weapon', expiring: true, cargoFull: false, equippedName: 'Old Repeater', equippedLevel: 9, equippedRarity: 'rare' });
    expect(r.expiresAfterWave).toBe(expiresAfterWave(6));
  });

  it('modules have no slot comparison name, an empty slot reports level 0', () => {
    const mod = lootTargetInfo({ item: { ...item, category: 'module' }, droppedWave: 1, expiring: false, cargoFull: true, equipped: cur });
    expect(mod.equippedName).toBeNull();
    const empty = lootTargetInfo({ item, droppedWave: 1, expiring: false, cargoFull: false, equipped: null });
    expect(empty).toMatchObject({ equippedName: null, equippedLevel: 0, equippedRarity: null });
  });
});

describe('runHud', () => {
  it('maps secured vs unsecured rewards and the next checkpoint', () => {
    const view = { unsecured: { salvage: 5, credits: 6, components: 7 }, secured: { salvage: 1, credits: 2, components: 3 }, wavesCleared: 4, lastBankedWave: 0, kills: 40, duration: 99 };
    expect(runHud(3, view, true)).toEqual({
      tier: 3,
      salvageUnsecured: 5, creditsUnsecured: 6, componentsUnsecured: 7,
      salvageSecured: 1, creditsSecured: 2, componentsSecured: 3,
      nextCheckpoint: nextCheckpoint(5),
      checkpointOpen: true,
      lastBankedWave: 0,
      kills: 40,
      duration: 99,
    });
  });
});
