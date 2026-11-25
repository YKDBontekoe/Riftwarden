import { describe, expect, it } from 'vitest';
import { applyTrade, creditsAfterTax, offerProblem, tradeEntries, tradeLock, TRADE } from '@riftwarden/rules/economy/trade';
import { createDefaultSave, sanitizeItem, type SaveData } from '@riftwarden/rules/progression/save';
import { generateItem } from '@riftwarden/rules/loot/generate';
import { xpForLevel } from '@riftwarden/rules/progression/level';
import { replay } from '@riftwarden/rules/progression/sync';
import type { ItemInstance } from '@riftwarden/rules/loot/types';

const warden = (id: string, level = 15): SaveData => {
  const d = createDefaultSave(1_000, { profileId: id, starterUid: `starter_${id}` });
  d.progress.xp = xpForLevel(level);
  d.resources.credits = 5_000;
  return d;
};
const give = (d: SaveData, seed: number, o: Partial<Parameters<typeof generateItem>[0]> = {}): ItemInstance => {
  const it = generateItem({ uid: `it_${d.profile.id}_${seed}`, seed, level: 10, rarity: 'rare', category: 'armor', source: 'test', ...o });
  d.items.push(it);
  d.storage.uids.push(it.uid);
  return it;
};
const san = (v: unknown) => sanitizeItem(v);

describe('warden trading', () => {
  it('gates trading on the unlock track and an idle profile', () => {
    const low = warden('low', 3);
    expect(offerProblem(low, { items: [], credits: 0 })).toMatch(/Warden level 15/);
    const ok = warden('ok');
    expect(offerProblem(ok, { items: [], credits: 0 })).toBeNull();
    ok.activeRun = { id: 'r' } as SaveData['activeRun'];
    expect(offerProblem(ok, { items: [], credits: 0 })).toMatch(/operation/);
  });

  it('refuses equipped, locked, missing, duplicated and bound items and unaffordable credits', () => {
    const d = warden('a');
    const it = give(d, 1);
    expect(offerProblem(d, { items: [it.uid], credits: 100 })).toBeNull();
    expect(offerProblem(d, { items: [it.uid, it.uid], credits: 0 })).toMatch(/twice/);
    expect(offerProblem(d, { items: ['nope'], credits: 0 })).toMatch(/no longer own/);
    expect(offerProblem(d, { items: [], credits: 9_999 })).toMatch(/Not enough credits/);
    expect(offerProblem(d, { items: [d.loadout.weapon!], credits: 0 })).toMatch(/equipped/);
    it.locked = true;
    expect(offerProblem(d, { items: [it.uid], credits: 0 })).toMatch(/locked/);
    delete it.locked;
    const asc = give(d, 2, { rarity: 'ascended' });
    expect(tradeLock(asc)).toMatch(/Ascended/);
    const pin = give(d, 3, { rarity: 'legendary', dropSource: 'pinnacle' });
    expect(pin.bound).toBe(true);
    expect(offerProblem(d, { items: [pin.uid], credits: 0 })).toMatch(/Pinnacle/);
    expect(sanitizeItem(structuredClone(pin))!.bound).toBe(true);
  });

  it('swaps items and taxed credits on both sides, conserving every item', () => {
    const a = warden('a');
    const b = warden('b');
    const ia = give(a, 10);
    const ib = give(b, 20, { category: 'shield' });
    const [ea, eb] = tradeEntries('t1', { doc: a, offer: { items: [ia.uid], credits: 1_000 } }, { doc: b, offer: { items: [ib.uid], credits: 0 } });
    expect(applyTrade(a, ea, san)).toBeNull();
    expect(applyTrade(b, eb, san)).toBeNull();
    expect(a.items.some((i) => i.uid === ia.uid)).toBe(false);
    expect(a.storage.uids).toContain(ib.uid);
    expect(b.storage.uids).toContain(ia.uid);
    expect(a.resources.credits).toBe(4_000);
    expect(b.resources.credits).toBe(5_000 + creditsAfterTax(1_000));
    expect(creditsAfterTax(1_000)).toBe(1_000 * (1 - TRADE.tax));
  });

  it('a stale or replayed side fails without touching the profile', () => {
    const a = warden('a');
    const b = warden('b');
    const ia = give(a, 10);
    const [ea] = tradeEntries('t2', { doc: a, offer: { items: [ia.uid], credits: 0 } }, { doc: b, offer: { items: [], credits: 0 } });
    expect(applyTrade(a, ea, san)).toBeNull();
    const snap = structuredClone(a);
    expect(applyTrade(a, ea, san)).toMatch(/no longer own/);
    expect(a).toEqual(snap);
  });

  it('refuses incoming items the profile already owns or cannot store', () => {
    const a = warden('a');
    const dup = give(a, 30);
    expect(applyTrade(a, { id: 't', give: [], giveCredits: 0, get: [structuredClone(dup)], getCredits: 0 }, san)).toMatch(/already own/);
    const b = warden('b');
    b.storage.capacity = b.storage.uids.length;
    const other = generateItem({ uid: 'x1', seed: 5, level: 3, rarity: 'common', category: 'armor', source: 't' });
    expect(applyTrade(b, { id: 't', give: [], giveCredits: 0, get: [other], getCredits: 0 }, san)).toMatch(/storage/);
  });

  it('is only accepted as a trusted (server) entry', () => {
    const a = warden('a');
    const entry = { seq: 1, at: 0, trade: { id: 't', give: [], giveCredits: 0, get: [], getCredits: 50 } };
    expect(replay(a, [entry]).results[0]).toMatchObject({ ok: false, reason: 'trades are applied by the server' });
    const r = replay(a, [entry], 0, { trusted: true });
    expect(r.results[0].ok).toBe(true);
    expect(r.doc.resources.credits).toBe(5_050);
  });
});
