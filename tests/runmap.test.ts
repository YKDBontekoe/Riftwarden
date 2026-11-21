import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/combat/damage';
import { nodeEffect } from '../src/runmap/map';
import { regionLayout } from '../src/war/regions';
import { actEffects, addCurse, carryStats, emptyCarry, endAct, purgeCurse, sanitizeCarry, towerRefund } from '../src/runmap/carry';
import { ANOMALIES, ANOMALY_IDS, CURSES, MAX_CURSES } from '../src/runmap/defs';
import { forgePrice, merchantStock, resolveAnomaly } from '../src/runmap/hub';
import { newMapState, resumable, sanitizeMapState } from '../src/runmap/state';


describe('node effects', () => {
  it('node effects combine kind, modifiers and act effects', () => {
    const node = { ...regionLayout(1, 1).nodes[2], kind: 'elite' as const, mods: ['fortified' as const, 'scarcity' as const] };
    const e = nodeEffect(node, actEffects({ curses: ['famine'], blessings: ['fortune'] }));
    expect(e.elite).toBeCloseTo(2.4);
    // Act 2: +8% HP, +10% luck on top of the node.
    expect(e.hp).toBeCloseTo(1.25 * 1.08);
    expect(e.cores).toBeCloseTo(0.6 * 0.7);
    expect(e.luck).toBeCloseTo(1.1 * 1.4 * 1.3 * 1.5 * 1.25);
    expect(nodeEffect({ ...node, act: 1, kind: 'combat', mods: [] }).hp).toBe(1);
    expect(e.shards).toBe(2);
  });
});

describe('carry', () => {
  it('refunds half of the paid tower value, wrecks a quarter of that', () => {
    expect(towerRefund([{ paid: 100 }, { paid: 200, wrecked: true }])).toBe(50 + 25);
  });

  it('curses cap, never duplicate, purge oldest, clear at act end', () => {
    const c = emptyCarry();
    expect(addCurse(c, 'brittle')).toBe('brittle');
    expect(addCurse(c, 'brittle')).toBe(null);
    for (const id of Object.keys(CURSES)) addCurse(c, id as never);
    expect(c.curses.length).toBe(MAX_CURSES);
    expect(purgeCurse(c)).toBe('brittle');
    c.blessings.push('aegis');
    endAct(c);
    expect(c.curses).toEqual([]);
    expect(c.blessings).toEqual([]);
  });

  it('carry stats: curses, blessings and forge stacks (capped)', () => {
    const s = carryStats({ curses: ['brittle'], blessings: ['resonance'], forge: { temper: 9 } });
    expect(s.filter((m) => m.source === 'forge:temper')).toHaveLength(4);
    expect(s.find((m) => m.source === 'curse:brittle')?.value).toBe(-0.2);
    expect(s.find((m) => m.source === 'blessing:resonance')?.stat).toBe('elementalPower');
  });

  it('sanitize rejects garbage and keeps valid fields', () => {
    expect(sanitizeCarry(null)).toBe(null);
    const c = sanitizeCarry({ wave: 12.7, cores: -5, ult: 3, curses: ['brittle', 'nope', 'brittle'], forge: { temper: 99, x: 1 }, build: { stacks: [['a_payload', 2], ['bad']], offers: 4 }, loadout: { weapon: 'u1', armor: 7 } })!;
    expect(c.wave).toBe(12);
    expect(c.cores).toBe(0);
    expect(c.ult).toBe(1);
    expect(c.curses).toEqual(['brittle']);
    expect(c.forge).toEqual({ temper: 4 });
    expect(c.build.stacks).toEqual([['a_payload', 2]]);
    expect(c.loadout).toEqual({ weapon: 'u1', armor: null });
  });

  it('map state sanitize + resumable', () => {
    expect(sanitizeMapState({ seed: 0 })).toBe(null);
    const m = newMapState(42);
    expect(resumable(m)).toBe(false);
    const s = sanitizeMapState({ ...m, path: ['r0n0', 'evil', 'r0n2'], current: 'r0n2', next: 'r0n3', carry: emptyCarry() })!;
    expect(s.path).toEqual(['r0n0', 'r0n2']);
    expect(s.act).toBe(1);
    expect(resumable(s)).toBe(true);
  });
});

describe('hub nodes', () => {
  it('merchant stock is seeded, scales with depth and always has a rare+ item', () => {
    const a = merchantStock(99, 10);
    expect(merchantStock(99, 10)).toEqual(a);
    expect(a.items).toHaveLength(3);
    for (let s = 1; s < 200; s++) expect(merchantStock(s, 5).items[0].rarity).not.toBe('uncommon');
    expect(merchantStock(99, 40).services.repair).toBeGreaterThan(a.services.repair);
    expect(forgePrice('temper', 10, 1)).toBeGreaterThan(forgePrice('temper', 10, 0));
  });

  it('every anomaly choice resolves; leave never changes anything', () => {
    for (const id of ANOMALY_IDS) {
      for (const ch of ANOMALIES[id].choices) {
        for (let s = 1; s < 40; s++) {
          const c = emptyCarry();
          const o = resolveAnomaly(id, ch.id, c, { cores: 400 }, mulberry32(s))!;
          expect(o).not.toBe(null);
          expect(o.cores).toBeGreaterThanOrEqual(-400);
          if (ch.id === 'leave') expect(o).toMatchObject({ curse: null, cores: 0, items: [], picks: 0, ambush: false });
          if (o.curse) expect(c.curses).toContain(o.curse);
        }
      }
    }
    expect(resolveAnomaly('siphon', 'bogus', emptyCarry(), { cores: 0 }, mulberry32(1))).toBe(null);
  });

  it('gamble odds are honest (about half the bets win)', () => {
    let wins = 0;
    for (let s = 1; s <= 2000; s++) if (resolveAnomaly('gamble', 'bet', emptyCarry(), { cores: 100 }, mulberry32(s))!.cores > 0) wins++;
    expect(wins / 2000).toBeGreaterThan(0.45);
    expect(wins / 2000).toBeLessThan(0.55);
    expect(resolveAnomaly('gamble', 'bet', emptyCarry(), { cores: 0 }, mulberry32(1))!.cores).toBe(0);
  });

  it('pact grants its blessing and its curse', () => {
    const c = emptyCarry();
    const o = resolveAnomaly('pact', 'sign', c, { cores: 0 }, mulberry32(3))!;
    expect(o.blessing).toBe('resonance');
    expect(c.blessings).toEqual(['resonance']);
    expect(c.curses).toEqual(['brittle']);
  });
});

import { bankNodeRewards, beginRun, createDefaultSave, recordRun, resolveInterruptedRun, saveMapProgress, sanitizeSave } from '../src/progression/save';
import { RunLedger } from '../src/progression/run';

describe('run map persistence', () => {
  it('beginRun with a map seed stores progress; node banking is guarded per step', () => {
    const d = createDefaultSave(1);
    beginRun(d, 'run_a', 1, 2, { mapSeed: 7 });
    expect(d.activeRun?.map?.seed).toBe(7);
    const credits = d.resources.credits;
    expect(bankNodeRewards(d, 'run_a', 1, { salvage: 5, credits: 10, items: [] })).toBe(true);
    expect(bankNodeRewards(d, 'run_a', 1, { salvage: 5, credits: 10, items: [] })).toBe(false);
    expect(bankNodeRewards(d, 'other', 2, { salvage: 5, items: [] })).toBe(false);
    expect(d.resources.credits).toBe(credits + 10);
  });

  it('a resumable run survives load (sanitize + keepResumable) and is recorded as interrupted otherwise', () => {
    const d = createDefaultSave(1);
    beginRun(d, 'run_b', 1, 2, { mapSeed: 9 });
    const m = { ...d.activeRun!.map!, current: 'r0n0', path: ['r0n0'], cleared: 1, carry: emptyCarry(), next: 'r0n4' };
    expect(saveMapProgress(d, 'run_b', m)).toBe(true);
    const back = sanitizeSave(JSON.parse(JSON.stringify(d))).data;
    expect(resumable(back.activeRun?.map)).toBe(true);
    expect(resolveInterruptedRun(back, 3, { keepResumable: true })).toBe(null);
    expect(back.activeRun).not.toBe(null);
    const e = resolveInterruptedRun(back, 3)!;
    expect(e.outcome).toBe('interrupted');
    expect(e.path).toEqual(['1C']);
    expect(back.records['1'].bestNodes).toBe(1);
  });

  it('recordRun keeps map records and the history path', () => {
    const d = createDefaultSave(1);
    beginRun(d, 'run_c', 1, 2, { mapSeed: 11 });
    const led = new RunLedger('run_c', 1, 2);
    led.map = { act: 2, nodes: 8, actsCleared: 1, path: ['1C', '1B*', '2C'] };
    expect(recordRun(d, led.finalize('returned', 5))).toBe(true);
    expect(d.records['1']).toMatchObject({ deepestAct: 2, bestNodes: 8, actsCleared: 1 });
    expect(d.totals.actsCleared).toBe(1);
    expect(d.history[0].path).toEqual(['1C', '1B*', '2C']);
    // Older history entries without map fields serialize unchanged.
    const again = sanitizeSave(JSON.parse(JSON.stringify(d))).data;
    expect(again.history[0].act).toBe(2);
  });

  it('ledger: bankNode only at a checkpoint; export/restore keeps counters', () => {
    const led = new RunLedger('r', 1, 0);
    led.collect({ credits: 5 });
    expect(led.bankNode()).toBe(null);
    for (let w = 1; w <= 5; w++) led.waveCleared(w);
    led.bank(5);
    led.collect({ credits: 7 });
    expect(led.bankNode()?.credits).toBe(7);
    led.kills = 40;
    led.survival.bossesKilled = 1;
    const st = JSON.parse(JSON.stringify(led.exportState()));
    const b = new RunLedger('r', 1, 0);
    b.restore(st);
    expect(b.kills).toBe(40);
    expect(b.atCheckpoint).toBe(true);
    expect(b.secured.credits).toBe(led.secured.credits);
    expect(b.survival.bossesKilled).toBe(1);
    expect(b.accrueXp()).toBe(led.accrueXp());
  });
});

import { resolveMapVote, voteComplete } from '../src/net/mapVote';

describe('co-op map vote', () => {
  const reach = ['r0n4', 'r0n5', 'r0n2'];
  it('majority wins, host breaks ties, home voters extract alone', () => {
    expect(resolveMapVote(new Map([['a', 'r0n5'], ['b', 'r0n5'], ['c', 'r0n4']]), reach, 'c')).toEqual({ travel: 'r0n5', home: [] });
    expect(resolveMapVote(new Map([['a', 'r0n2'], ['b', 'r0n4']]), reach, 'a')).toEqual({ travel: 'r0n2', home: [] });
    expect(resolveMapVote(new Map([['a', 'r0n2'], ['b', 'r0n4']]), reach, 'z').travel).toBe('r0n4');
    expect(resolveMapVote(new Map([['a', 'home'], ['b', 'r0n4']]), reach, 'a')).toEqual({ travel: 'r0n4', home: ['a'] });
  });
  it('everyone home extracts; a silent timeout continues; unreachable votes are ignored', () => {
    expect(resolveMapVote(new Map([['a', 'home'], ['b', 'home']]), reach, 'a')).toEqual({ travel: null, home: [] });
    expect(resolveMapVote(new Map([['a', null]]), reach, 'a')).toEqual({ travel: 'r0n4', home: [] });
    expect(resolveMapVote(new Map([['a', 'r9n9']]), reach, 'a').travel).toBe('r0n4');
    expect(voteComplete(new Map([['a', 'home'], ['b', null]]), ['a', 'b'])).toBe(false);
    expect(voteComplete(new Map([['a', 'home'], ['b', 'r0n4']]), ['a', 'b'])).toBe(true);
  });
});
