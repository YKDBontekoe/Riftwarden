import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/combat/damage';
import { actOf, findNode, generateAct, mapSeedFor, nodeEffect, pathCode, reachable, ROWS, staircase } from '../src/runmap/map';
import { actEffects, addCurse, carryStats, emptyCarry, endAct, purgeCurse, sanitizeCarry, towerRefund } from '../src/runmap/carry';
import { ANOMALIES, ANOMALY_IDS, CURSES, isCombatKind, MAX_CURSES, NODE_MODS } from '../src/runmap/defs';
import { forgePrice, merchantStock, resolveAnomaly } from '../src/runmap/hub';
import { newMapState, resumable, sanitizeMapState } from '../src/runmap/state';

const crosses = (edges: [number, number][]) => edges.some(([a, b]) => edges.some(([c, d]) => a < c && b > d));

describe('run map generation', () => {
  it('is deterministic per (seed, act) and differs between seeds', () => {
    const a = JSON.stringify(generateAct(1234, 1));
    expect(JSON.stringify(generateAct(1234, 1))).toBe(a);
    expect(JSON.stringify(generateAct(1235, 1))).not.toBe(a);
    expect(JSON.stringify(generateAct(1234, 2))).not.toBe(a);
  });

  it('staircase links cover both rows without crossings', () => {
    const r = mulberry32(9);
    for (let k = 0; k < 400; k++) {
      const a = 1 + Math.floor(r() * 4);
      const b = 1 + Math.floor(r() * 4);
      const e = staircase(a, b, r);
      expect(crosses(e)).toBe(false);
      for (let i = 0; i < a; i++) expect(e.some(([x]) => x === i)).toBe(true);
      for (let j = 0; j < b; j++) expect(e.some(([, y]) => y === j)).toBe(true);
    }
  });

  it('every act has the expected shape over many seeds', () => {
    let kinds = new Set<string>();
    let mods = 0;
    for (let s = 1; s <= 300; s++) {
      const seed = mapSeedFor(s);
      for (const act of [1, 2, 4]) {
        const m = generateAct(seed, act);
        expect(m.rows).toHaveLength(ROWS);
        expect(m.rows[0].every((n) => n.kind === 'combat')).toBe(true);
        const last = m.rows[ROWS - 1];
        expect(last).toHaveLength(1);
        expect(last[0].actBoss && last[0].kind === 'boss' && !!last[0].boss).toBe(true);
        expect(m.rows[ROWS - 2].some((n) => n.kind === 'rest')).toBe(true);
        expect(m.rows.flat().filter((n) => n.kind === 'boss' && !n.actBoss).length).toBeLessThanOrEqual(1);
        for (let row = 1; row < ROWS - 2; row++) expect(m.rows[row].some((n) => isCombatKind(n.kind))).toBe(true);
        for (const n of m.rows.flat()) {
          kinds.add(n.kind);
          mods += n.mods.length;
          expect(n.seed).toBeGreaterThan(0);
          if (!isCombatKind(n.kind)) expect(n.mods).toEqual([]);
          expect(n.kind === 'event').toBe(!!n.anomaly);
          if (act === 1 && n.row === 0) expect(n.mods).toEqual([]);
          for (const m2 of n.mods) if (NODE_MODS[m2].kinds) expect(NODE_MODS[m2].kinds).toContain(n.kind);
          expect(n.mods.filter((x) => NODE_MODS[x].effect.event).length).toBeLessThanOrEqual(1);
        }
        // Every node is reachable from the entry row and leads to the boss.
        const seen = new Set(m.rows[0].map((n) => n.id));
        for (let row = 0; row < ROWS - 1; row++) for (const n of m.rows[row]) if (seen.has(n.id)) n.links.forEach((l) => seen.add(l));
        expect(seen.size).toBe(m.rows.flat().length);
        for (let row = 0; row < ROWS - 1; row++) for (const n of m.rows[row]) expect(n.links.length).toBeGreaterThan(0);
      }
    }
    expect([...kinds].sort()).toEqual(['boss', 'combat', 'elite', 'event', 'forge', 'merchant', 'rest', 'vault']);
    expect(mods).toBeGreaterThan(100);
    kinds = new Set();
  });

  it('reachable: entry row before the first node, links mid-act, next act after the boss', () => {
    const seed = mapSeedFor(77);
    const a1 = generateAct(seed, 1);
    expect(reachable(seed, null).map((n) => n.id)).toEqual(a1.rows[0].map((n) => n.id));
    const n = a1.rows[2][0];
    expect(reachable(seed, n.id).map((q) => q.id)).toEqual(n.links);
    const boss = a1.rows[ROWS - 1][0];
    expect(reachable(seed, boss.id).map((q) => q.id)).toEqual(generateAct(seed, 2).rows[0].map((q) => q.id));
    expect(actOf('a12r3c1')).toBe(12);
    expect(findNode(seed, boss.id)?.actBoss).toBe(true);
    expect(pathCode([a1.rows[0][0].id, boss.id], seed)).toEqual(['1C', '1B*']);
  });

  it('acts stay finite and valid deep into an endless run', () => {
    const m = generateAct(mapSeedFor(5), 500);
    expect(m.rows.flat().every((n) => Number.isFinite(n.x) && n.seed > 0)).toBe(true);
  });

  it('node effects combine kind, modifiers and act effects', () => {
    const node = { ...generateAct(1, 2).rows[1][0], kind: 'elite' as const, mods: ['fortified' as const, 'scarcity' as const] };
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
    const s = sanitizeMapState({ ...m, path: ['a1r0c0', 'evil', 'a1r1c2'], current: 'a1r1c2', next: 'a1r2c0', carry: emptyCarry() })!;
    expect(s.path).toEqual(['a1r0c0', 'a1r1c2']);
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
    const m = { ...d.activeRun!.map!, current: 'a1r0c0', path: ['a1r0c0'], cleared: 1, carry: emptyCarry(), next: 'a1r1c0' };
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
  const reach = ['a1r1c0', 'a1r1c1', 'a1r1c2'];
  it('majority wins, host breaks ties, home voters extract alone', () => {
    expect(resolveMapVote(new Map([['a', 'a1r1c1'], ['b', 'a1r1c1'], ['c', 'a1r1c0']]), reach, 'c')).toEqual({ travel: 'a1r1c1', home: [] });
    expect(resolveMapVote(new Map([['a', 'a1r1c2'], ['b', 'a1r1c0']]), reach, 'a')).toEqual({ travel: 'a1r1c2', home: [] });
    expect(resolveMapVote(new Map([['a', 'a1r1c2'], ['b', 'a1r1c0']]), reach, 'z').travel).toBe('a1r1c0');
    expect(resolveMapVote(new Map([['a', 'home'], ['b', 'a1r1c0']]), reach, 'a')).toEqual({ travel: 'a1r1c0', home: ['a'] });
  });
  it('everyone home extracts; a silent timeout continues; unreachable votes are ignored', () => {
    expect(resolveMapVote(new Map([['a', 'home'], ['b', 'home']]), reach, 'a')).toEqual({ travel: null, home: [] });
    expect(resolveMapVote(new Map([['a', null]]), reach, 'a')).toEqual({ travel: 'a1r1c0', home: [] });
    expect(resolveMapVote(new Map([['a', 'a9r9c9']]), reach, 'a').travel).toBe('a1r1c0');
    expect(voteComplete(new Map([['a', 'home'], ['b', null]]), ['a', 'b'])).toBe(false);
    expect(voteComplete(new Map([['a', 'home'], ['b', 'a1r1c0']]), ['a', 'b'])).toBe(true);
  });
});
