import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACEABLES } from '@riftwarden/rules/home/placeables';
import type { ItemInstance } from '@riftwarden/rules/progression/items';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { RunLedger } from '@riftwarden/rules/progression/run';
import {
  BACKUP_KEY,
  CORRUPT_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  bankRewards,
  beginRun,
  createDefaultSave,
  equipFromStorage,
  equippedItem,
  loadSave,
  parseSave,
  recordRun,
  resolveInterruptedRun,
  sanitizeSave,
  selectTier,
  serializeSave,
  storedItems,
  unequipToStorage,
  writeSave,
  type KeyValueStorage,
} from '@riftwarden/rules/progression/save';
import { getTier, isCheckpointWave, nextCheckpoint, THREAT_TIERS } from '@riftwarden/rules/progression/tiers';
import { getWave } from '@riftwarden/rules/waves/waves';

class MemStorage implements KeyValueStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

/** Minimal test fixture standing in for an M2 equipment drop. */
const fixtureItem = (uid: string): ItemInstance => generateItem({ uid, seed: 1, level: 3, rarity: 'rare', baseId: 'plasma_repeater', source: 'test', now: 1 });

describe('save format', () => {
  it('fresh save has the starter weapon equipped and safe defaults', () => {
    const d = createDefaultSave(1000);
    expect(d.version).toBe(SAVE_VERSION);
    expect(equippedItem(d, 'weapon')?.defId).toBe('plasma_repeater');
    expect(d.resources.salvage).toBe(0);
    expect(d.threat).toEqual({ selected: 1, unlocked: 1 });
    expect(d.base.placeables.length).toBe(DEFAULT_PLACEABLES.length);
    expect(d.storage.uids).toEqual([]);
  });

  it('round-trips through storage (survives reload)', () => {
    const s = new MemStorage();
    const d = createDefaultSave(1000);
    d.resources.salvage = 321;
    d.threat.unlocked = 2;
    selectTier(d, 2);
    expect(writeSave(s, d, 2000)).toBe(true);
    const r = loadSave(s, 3000);
    expect(r.status).toBe('loaded');
    expect(r.data.resources.salvage).toBe(321);
    expect(r.data.threat.selected).toBe(2);
    expect(r.data.loadout.weapon).toBe(d.loadout.weapon);
  });

  it('missing save -> new defaults', () => {
    const r = loadSave(new MemStorage());
    expect(r.status).toBe('new');
  });

  it('detects corruption, keeps the raw text and restores the backup', () => {
    const s = new MemStorage();
    const d = createDefaultSave(1000);
    d.resources.salvage = 10;
    writeSave(s, d);
    d.resources.salvage = 20;
    writeSave(s, d); // previous good save rotates into backup
    const good = s.getItem(SAVE_KEY)!;
    s.setItem(SAVE_KEY, good.replace('"salvage":20', '"salvage":99999')); // edited -> checksum mismatch
    const r = loadSave(s);
    expect(r.status).toBe('restored-backup');
    expect(r.data.resources.salvage).toBe(10);
    expect(s.getItem(CORRUPT_KEY)).toContain('99999');
  });

  it('truncated save without backup resets to defaults', () => {
    const s = new MemStorage();
    s.setItem(SAVE_KEY, serializeSave(createDefaultSave()).slice(0, 40));
    const r = loadSave(s);
    expect(r.status).toBe('reset-corrupt');
    expect(equippedItem(r.data, 'weapon')).not.toBeNull();
  });

  it('refuses saves from a newer schema version', () => {
    const body = JSON.stringify(createDefaultSave());
    const r = parseSave(`{"v":${SAVE_VERSION + 1},"sum":"0","data":${body}}`);
    expect(r.ok).toBe(false);
  });

  it('backup is never overwritten by a corrupt primary', () => {
    const s = new MemStorage();
    const d = createDefaultSave();
    writeSave(s, d);
    writeSave(s, d);
    s.setItem(SAVE_KEY, 'garbage');
    const bak = s.getItem(BACKUP_KEY);
    writeSave(s, d);
    expect(s.getItem(BACKUP_KEY)).toBe(bak);
  });

  it('sanitize repairs inconsistent ownership without losing items', () => {
    const d = createDefaultSave();
    const w = d.loadout.weapon!;
    const raw = JSON.parse(JSON.stringify(d));
    raw.items.push(fixtureItem('x1'), fixtureItem('x1'), { junk: true });
    raw.storage.uids = [w, 'missing']; // equipped item also listed in storage
    raw.loadout.armor = 'x1'; // weapon in the armor slot
    raw.threat = { selected: 3, unlocked: 2 };
    raw.resources.salvage = -50;
    raw.base.placeables.push({ uid: 'p', type: 'planter', position: [999, -4, 0], rotationY: 0, scale: 9, props: {} }, { type: 'nuke' });
    const { data, repairs } = sanitizeSave(raw);
    expect(repairs.length).toBeGreaterThan(0);
    expect(data.loadout.weapon).toBe(w);
    expect(data.loadout.armor).toBeNull();
    expect(data.storage.uids).toEqual(['x1']);
    expect(data.items.map((i) => i.uid).sort()).toEqual([w, 'x1'].sort());
    expect(data.threat).toEqual({ selected: 2, unlocked: 2 });
    expect(data.resources.salvage).toBe(0);
    const p = data.base.placeables.find((x) => x.uid === 'p')!;
    expect(p.position[0]).toBeLessThanOrEqual(92);
    expect(p.position[1]).toBe(0);
    expect(p.scale).toBe(3);
    expect(data.base.placeables.some((x) => (x.type as string) === 'nuke')).toBe(false);
  });

  it('re-equips a weapon when the slot is empty', () => {
    const raw = JSON.parse(JSON.stringify(createDefaultSave()));
    raw.loadout.weapon = null;
    const { data } = sanitizeSave(raw);
    expect(equippedItem(data, 'weapon')?.defId).toBe('plasma_repeater');
    expect(data.storage.uids).toEqual([]);
  });

  it('garbage input never throws', () => {
    for (const v of [null, 42, 'x', [], { items: 'no' }, { loadout: 5, storage: { uids: 3 } }]) {
      expect(() => sanitizeSave(v)).not.toThrow();
    }
  });

  it('placeables survive a round trip (HQ layout reconstructible from the save)', () => {
    const s = new MemStorage();
    const d = createDefaultSave();
    d.base.placeables[0].position = [1, 0, 2];
    d.base.placeables[0].props.accent = 'amber';
    writeSave(s, d);
    const r = loadSave(s);
    expect(r.data.base.placeables[0]).toEqual(d.base.placeables[0]);
  });
});

describe('run ledger + banking', () => {
  it('collect -> unsecured, bank at checkpoint -> secured', () => {
    const run = new RunLedger('r1', 1, 0);
    run.collect({ salvage: 30 });
    expect(run.bank(5)).toBeNull(); // wave 5 not cleared yet
    for (let w = 1; w <= 4; w++) run.waveCleared(w);
    expect(run.bank(4)).toBeNull(); // not a checkpoint
    run.waveCleared(5);
    const moved = run.bank(5)!;
    expect(moved.salvage).toBe(30);
    expect(run.secured.salvage).toBe(30);
    expect(run.unsecured.salvage).toBe(0);
    expect(run.atCheckpoint).toBe(true);
    expect(run.bank(5)).toBeNull(); // no double banking
  });

  it('defeat loses unsecured but keeps secured and equipment', () => {
    const d = createDefaultSave();
    const weapon = d.loadout.weapon;
    const run = new RunLedger('r2', 1, 0);
    beginRun(d, run.id, 1);
    run.collect({ salvage: 50, items: [fixtureItem('drop1')] });
    for (let w = 1; w <= 5; w++) run.waveCleared(w);
    const banked = run.bank(5)!;
    expect(bankRewards(d, run.id, 5, banked)).toBe(true);
    run.collect({ salvage: 17, items: [fixtureItem('drop2')] });
    const res = run.finalize('defeat');
    expect(res.salvageSecured).toBe(50);
    expect(res.salvageLost).toBe(17);
    expect(res.itemsLost).toBe(1);
    expect(run.collect({ salvage: 5 })).toBe(false);
    expect(recordRun(d, res)).toBe(true);
    expect(d.resources.salvage).toBe(50);
    expect(storedItems(d).map((i) => i.uid)).toEqual(['drop1']);
    expect(d.loadout.weapon).toBe(weapon);
    expect(d.activeRun).toBeNull();
  });

  it('banking and recording are idempotent (no duplication)', () => {
    const d = createDefaultSave();
    const run = new RunLedger('r3', 1, 0);
    beginRun(d, run.id, 1);
    const rewards = { salvage: 40, items: [fixtureItem('a')] };
    expect(bankRewards(d, run.id, 5, rewards)).toBe(true);
    expect(bankRewards(d, run.id, 5, rewards)).toBe(false);
    expect(bankRewards(d, 'other', 10, rewards)).toBe(false);
    expect(d.resources.salvage).toBe(40);
    expect(d.storage.uids).toEqual(['a']);
    const res = run.finalize('returned');
    expect(run.finalize('defeat')).toBe(res); // first outcome wins
    expect(recordRun(d, res)).toBe(true);
    expect(recordRun(d, res)).toBe(false);
    expect(d.totals.runs).toBe(1);
    expect(d.totals.returned).toBe(1);
    // A finished run cannot bank anymore.
    expect(bankRewards(d, run.id, 10, rewards)).toBe(false);
  });

  it('records are stored per tier and flag new personal bests', () => {
    const d = createDefaultSave();
    const play = (id: string, tier: number, cleared: number) => {
      const r = new RunLedger(id, tier, 0);
      beginRun(d, id, tier);
      for (let w = 1; w <= cleared; w++) r.waveCleared(w);
      r.waveReached(cleared + 1);
      const res = r.finalize('defeat');
      recordRun(d, res);
      return res;
    };
    expect(play('a', 1, 6).newRecord).toBe(true);
    expect(play('b', 1, 4).newRecord).toBe(false);
    expect(play('c', 2, 2).newRecord).toBe(true);
    expect(d.records['1'].bestWave).toBe(6);
    expect(d.records['1'].runs).toBe(2);
    expect(d.records['2'].bestWave).toBe(2);
    expect(d.history[0].id).toBe('c');
  });

  it('first checkpoint unlocks the next tier', () => {
    const d = createDefaultSave();
    expect(selectTier(d, 2)).toBe(false);
    beginRun(d, 'r', 1);
    bankRewards(d, 'r', 5, { salvage: 0, items: [] });
    expect(d.threat.unlocked).toBe(2);
    expect(selectTier(d, 2)).toBe(true);
    expect(selectTier(d, 3)).toBe(false);
  });

  it('an interrupted run (tab closed) is recorded once on next start', () => {
    const d = createDefaultSave();
    beginRun(d, 'lost', 1);
    bankRewards(d, 'lost', 5, { salvage: 12, items: [] });
    const e = resolveInterruptedRun(d)!;
    expect(e.outcome).toBe('interrupted');
    expect(e.salvageSecured).toBe(12);
    expect(resolveInterruptedRun(d)).toBeNull();
    expect(d.resources.salvage).toBe(12);
    expect(d.totals.interrupted).toBe(1);
  });

  it('equipment swaps only between storage and functional slots', () => {
    const d = createDefaultSave();
    const starter = d.loadout.weapon!;
    d.items.push(fixtureItem('w2'));
    d.storage.uids.push('w2');
    expect(unequipToStorage(d, 'weapon')).toBe(false); // weapon is required
    expect(equipFromStorage(d, 'w2')).toBe(true);
    expect(d.loadout.weapon).toBe('w2');
    expect(d.storage.uids).toEqual([starter]);
    beginRun(d, 'r', 1);
    expect(equipFromStorage(d, starter)).toBe(false); // locked while deployed
  });
});

describe('threat tiers', () => {
  it('tiers escalate every scaling knob', () => {
    for (let i = 1; i < THREAT_TIERS.length; i++) {
      const a = THREAT_TIERS[i - 1];
      const b = THREAT_TIERS[i];
      expect(b.hpMult).toBeGreaterThan(a.hpMult);
      expect(b.damageMult).toBeGreaterThan(a.damageMult);
      expect(b.countMult).toBeGreaterThanOrEqual(a.countMult);
    }
    expect(getTier(99).id).toBe(1);
  });

  it('tier scaling is applied by the wave generator', () => {
    for (const n of [1, 3, 6, 12]) {
      const base = getWave(n);
      const hard = getWave(n, getTier(3));
      expect(hard.hpMult).toBeCloseTo(base.hpMult * getTier(3).hpMult);
      expect(hard.damageMult).toBeCloseTo(base.damageMult * getTier(3).damageMult);
      expect(hard.speedMult).toBe(getTier(3).speedMult);
      expect(hard.spawns.length).toBeGreaterThan(base.spawns.length);
      // spawn times stay sorted
      for (let i = 1; i < hard.spawns.length; i++) expect(hard.spawns[i].time).toBeGreaterThanOrEqual(hard.spawns[i - 1].time);
    }
    expect(getWave(4, getTier(1)).spawns.length).toBe(getWave(4).spawns.length);
  });

  it('checkpoints every five waves', () => {
    expect([1, 4, 5, 6, 10, 15].map(isCheckpointWave)).toEqual([false, false, true, false, true, true]);
    expect(nextCheckpoint(1)).toBe(5);
    expect(nextCheckpoint(5)).toBe(5);
    expect(nextCheckpoint(6)).toBe(10);
  });
});
