import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { levelForXp, levelInfo, pointsAt, ringsAt, xpFor, xpForLevel, xpToNext, XP } from '@riftwarden/rules/progression/level';
import { RunLedger } from '@riftwarden/rules/progression/run';
import { BRANCHES, CORE_ID, allocateBlocker, capScale,
  generateTree,
  MAX_RINGS,
  ringScale,
  RULE_CAP, pruneAllocation, respecCost, treeModifiers, treeRules } from '@riftwarden/rules/progression/skilltree';
import { MIGRATIONS, SAVE_VERSION, bankRewards, beginRun, createDefaultSave, migrate, recordRun, sanitizeSave, treeSeedFor } from '@riftwarden/rules/progression/save';
import { runOp } from '@riftwarden/rules/progression/ops';
import { STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { setUnlockAll } from '@riftwarden/rules/progression/unlocks';

// Legacy rules suites exercise late systems on fresh profiles: staged unlocks are covered by tests/unlocks.test.ts.
beforeAll(() => setUnlockAll(true));
afterAll(() => setUnlockAll(false));

const sv = { elitesKilled: 0, bossesKilled: 0, events: [] as string[], milestones: [] as string[], hvtKilled: 0, dev: false };

describe('warden levels', () => {
  it('xp is deterministic, monotone in every input, tier-scaled and zero for dev sessions', () => {
    const base = { tier: 1, kills: 40, wavesCleared: 5, survival: sv };
    expect(xpFor(base)).toBe(xpFor({ ...base }));
    expect(xpFor({ ...base, kills: 41 })).toBeGreaterThan(xpFor(base));
    expect(xpFor({ ...base, wavesCleared: 6 })).toBeGreaterThan(xpFor(base));
    expect(xpFor({ ...base, tier: 3 })).toBeGreaterThan(xpFor(base));
    expect(xpFor({ ...base, survival: { ...sv, bossesKilled: 1 } })).toBe(xpFor(base) + XP.boss);
    expect(xpFor({ ...base, survival: { ...sv, dev: true } })).toBe(0);
    expect(Number.isFinite(xpFor({ tier: 5, kills: 1e9, wavesCleared: 1e6, survival: sv }))).toBe(true);
  });

  it('levels: curve, inverse and derived points/rings', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpToNext(1) - 1)).toBe(1);
    expect(levelForXp(xpToNext(1))).toBe(2);
    for (const l of [1, 2, 7, 30, 120]) expect(levelForXp(xpForLevel(l))).toBe(l);
    for (let l = 1; l < 200; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    const i = levelInfo(xpForLevel(4) + 10);
    expect(i).toMatchObject({ level: 4, into: 10 });
    expect(pointsAt(1)).toBe(0);
    expect(pointsAt(6)).toBe(5);
    expect(ringsAt(1)).toBe(1);
    expect(ringsAt(6)).toBe(2);
    expect(levelForXp(1e12)).toBeGreaterThan(100);
  });
});

describe('ledger xp', () => {
  const play = (l: RunLedger, waves: number) => {
    for (let w = 1; w <= waves; w++) {
      for (let k = 0; k < 10; k++) l.addKill();
      l.waveCleared(w);
    }
  };

  it('xp is unsecured until a checkpoint banks it', () => {
    const l = new RunLedger('r', 1, 0);
    play(l, 5);
    const total = xpFor({ tier: 1, kills: 50, wavesCleared: 5, survival: sv });
    const moved = l.bank(5)!;
    expect(moved.xp).toBe(total);
    expect(l.secured.xp).toBe(total);
    expect(l.unsecured.xp).toBe(0);
  });

  it('defeat keeps a share of unsecured xp, extraction keeps all, finalize is idempotent', () => {
    const a = new RunLedger('a', 1, 0);
    play(a, 3);
    const total = a.xpEarned;
    const r = a.finalize('defeat');
    expect(r.xpKept).toBe(Math.floor(total * XP.keepOnLoss));
    expect(r.xpLost).toBe(total - r.xpKept!);
    expect(a.finalize('returned')).toBe(r);
    const b = new RunLedger('b', 1, 0);
    play(b, 3);
    expect(b.finalize('returned').xpKept).toBe(b.finalize('returned').xpKept);
  });

  it('xpMult (keystones) scales earned xp', () => {
    const a = new RunLedger('a', 1, 0);
    const b = new RunLedger('b', 1, 0);
    b.xpMult = 1.15;
    play(a, 5);
    play(b, 5);
    expect(b.bank(5)!.xp).toBe(Math.floor(a.bank(5)!.xp * 1.15));
  });

  it('banking and recording apply xp to the save once', () => {
    const d = createDefaultSave(0);
    beginRun(d, 'run1', 1, 0);
    const l = new RunLedger('run1', 1, 0);
    play(l, 5);
    const moved = l.bank(5)!;
    expect(bankRewards(d, 'run1', 5, moved)).toBe(true);
    expect(bankRewards(d, 'run1', 5, moved)).toBe(false);
    expect(d.progress.xp).toBe(moved.xp);
    play(l, 7);
    const res = l.finalize('defeat');
    expect(recordRun(d, res)).toBe(true);
    expect(recordRun(d, res)).toBe(false);
    expect(d.progress.xp).toBe(moved.xp + res.xpKept!);
  });
});

describe('save v8', () => {
  it('v7 saves migrate with veteran xp; sanitize keeps the seed derived from the profile', () => {
    const v7 = { ...createDefaultSave(0), version: 7 } as Record<string, unknown>;
    delete v7.progress;
    (v7.totals as Record<string, number>).kills = 1000;
    v7.milestones = ['w10'];
    const m = migrate(v7, 7, 10);
    expect(m.ok).toBe(true);
    const { data } = sanitizeSave(m.data);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.progress.xp).toBe(1000 * 2 + 300);
    expect(data.progress.tree.seed).toBe(treeSeedFor(data.profile.id));
    expect(MIGRATIONS[7]).toBeTypeOf('function');
  });

  it('sanitize prunes invalid or over-budget allocations', () => {
    const d = createDefaultSave(0);
    const tree = generateTree(d.progress.tree.seed, 1);
    const first = tree.nodes[0].id;
    d.progress.tree.allocated = [first, 'bogus', 'r9h0'];
    expect(sanitizeSave(JSON.parse(JSON.stringify(d))).data.progress.tree.allocated).toEqual([]); // level 1 = 0 points
    d.progress.xp = xpForLevel(3);
    expect(sanitizeSave(JSON.parse(JSON.stringify(d))).data.progress.tree.allocated).toEqual([first]);
  });
});

describe('procedural skill tree', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = generateTree(1234, 6);
    const b = generateTree(1234, 6);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(JSON.stringify(generateTree(99, 6).nodes)).not.toBe(JSON.stringify(a.nodes));
  });

  it('revealing more rings never changes earlier rings', () => {
    const small = generateTree(77, 4).nodes;
    const big = generateTree(77, 12).nodes.filter((n) => n.ring <= 4);
    expect(JSON.stringify(big)).toBe(JSON.stringify(small));
  });

  it('every node is reachable from the core, branches stay in their sector, stats are real', () => {
    const t = generateTree(4242, 30);
    const reach = new Set<string>([CORE_ID]);
    for (const n of t.nodes) {
      expect(n.parents.length).toBeGreaterThan(0);
      expect(n.parents.some((p) => reach.has(p))).toBe(true);
      reach.add(n.id);
      for (const m of n.mods) expect(STAT_DEFS[m.stat]).toBeDefined();
      for (const p of n.parents) if (p !== CORE_ID) expect(t.byId.get(p)!.branch).toBe(n.branch);
    }
    for (const b of BRANCHES) expect(t.nodes.some((n) => n.branch === b && n.kind === 'keystone')).toBe(true);
  });

  it('stays finite at ring 200', () => {
    const t = generateTree(5, 200);
    expect(t.nodes.length).toBeGreaterThan(1000);
    for (const n of t.nodes) for (const m of n.mods) expect(Number.isFinite(m.value)).toBe(true);
  });

  it('allocation rules: revealed ring, connected parent, point budget', () => {
    const t = generateTree(11, 3);
    const r1 = t.nodes.find((n) => n.ring === 1)!;
    const r2 = t.nodes.find((n) => n.ring === 2 && !n.parents.includes(r1.id))!;
    expect(allocateBlocker(t, [], r1.id, 1)).toMatch(/points/);
    expect(allocateBlocker(t, [], r1.id, 2)).toBeNull();
    expect(allocateBlocker(t, [], r2.id, 6)).toMatch(/connected/);
    expect(allocateBlocker(t, [], t.nodes.find((n) => n.ring === 3)!.id, 6)).toMatch(/revealed/);
    expect(pruneAllocation(11, 2, [r1.id, r1.id])).toEqual([r1.id]);
  });

  it('soft caps: stacking every node of one stat stays below the cap', () => {
    const t = generateTree(8, 60);
    const all = t.nodes.map((n) => n.id);
    const mods = treeModifiers(8, all);
    const dmg = mods.find((m) => m.stat === 'weaponDamageMult' && m.op === 'pct')!;
    // The cap grows 3% per ring of the deepest allocated node (deep points keep paying), never beyond it.
    expect(dmg.value).toBeLessThanOrEqual(0.03 * 12 * capScale(60));
    expect(dmg.value).toBeGreaterThan(0.03 * 12);
    expect(dmg.value).toBeGreaterThan(0);
    expect(treeModifiers(8, [])).toEqual([]);
  });

  it('the tree is endless: deep rings lean on keystones and notables, values grow slowly, rules stay bounded', () => {
    const t = generateTree(5, 60);
    const ring = (r: number) => t.nodes.filter((n) => n.ring === r);
    expect(ring(21).some((n) => n.kind === 'keystone')).toBe(false);
    expect(ring(22).some((n) => n.kind === 'keystone')).toBe(true);
    expect(ring(24).some((n) => n.kind === 'keystone')).toBe(true);
    const share = (from: number, to: number) => {
      const ns = t.nodes.filter((n) => n.ring >= from && n.ring <= to && n.kind !== 'keystone');
      return ns.filter((n) => n.kind === 'notable').length / ns.length;
    };
    expect(share(41, 60)).toBeGreaterThan(share(2, 39) + 0.12);
    expect(ringScale(10)).toBeCloseTo(2.35);
    expect(ringScale(30)).toBeCloseTo(3.35);
    // Revealing rings never changes earlier ones (ring 2000 is still reachable and finite).
    const deep = generateTree(5, MAX_RINGS);
    expect(deep.rings).toBe(MAX_RINGS);
    expect(deep.byId.get(t.nodes[30].id)).toEqual(t.nodes[30]);
    for (const n of deep.nodes.slice(-40)) for (const m of n.mods) expect(Number.isFinite(m.value)).toBe(true);
    const keys = deep.nodes.filter((n) => n.rule?.xpMult).map((n) => n.id);
    expect(treeRules(5, keys).xpMult).toBeLessThanOrEqual(RULE_CAP.xpMult);
  });

  it('keystone rules are read from allocated keystones only', () => {
    const t = generateTree(3, 12);
    const ks = t.nodes.filter((n) => n.rule?.xpMult);
    expect(ks.length).toBeGreaterThan(0);
    expect(treeRules(3, [ks[0].id]).xpMult).toBeGreaterThan(1);
    expect(treeRules(3, [])).toEqual({ xpMult: 1, startCores: 0 });
  });

  it('ops: allocate via runOp, respec costs credits and escalates', () => {
    const d = createDefaultSave(0);
    d.progress.xp = xpForLevel(4);
    const t = generateTree(d.progress.tree.seed, 1);
    expect(runOp(d, 'treeAllocate', [t.nodes[0].id]).ok).toBe(true);
    expect(runOp(d, 'treeAllocate', [t.nodes[0].id]).ok).toBe(false);
    const credits = d.resources.credits;
    expect(runOp(d, 'treeRespec', [], 'tx1')).toMatchObject({ ok: true });
    expect(d.resources.credits).toBe(credits - respecCost(0));
    expect(d.progress.tree.allocated).toEqual([]);
    expect(runOp(d, 'treeRespec', [], 'tx2').ok).toBe(false); // nothing allocated
    expect(respecCost(1)).toBeGreaterThan(respecCost(0));
    d.activeRun = { id: 'x', tier: 1, startedAt: 0, bankedThroughWave: 0, salvageSecured: 0, itemsSecured: 0, creditsSecured: 0, componentsSecured: 0 };
    expect(runOp(d, 'treeAllocate', [t.nodes[1].id]).ok).toBe(false);
  });
});
