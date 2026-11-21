import { describe, expect, it } from 'vitest';
import { generateAct, mapSeedFor, nodeEffect, segmentTier, SEGMENT } from '../src/runmap/map';
import { lookahead, nodeIntel } from '../src/runmap/intel';
import { MODE_EFFECT } from '../src/runmap/defs';
import { getTier } from '../src/progression/tiers';
import { SurvivalPlanner } from '../src/survival/plan';
import { BIOMES } from '../src/world/biomes';
import { generateArena } from '../src/world/arenaGen';
import { NavGrid } from '../src/world/navgrid';
import { ARENA } from '../src/world/layout';
import { Hunt, HUNT } from '../src/arena/Hunt';
import { beginRun, createDefaultSave, recordRun, sanitizeSave } from '../src/progression/save';
import { RunLedger } from '../src/progression/run';

const seed = mapSeedFor(4242);
const act1 = generateAct(seed, 1);
const entry = act1.rows[0][0];
const ctx = (o: Partial<Parameters<typeof nodeIntel>[1]> = {}) => ({ plannerSeed: 777, tier: getTier(1), mode: 'defense' as const, lastWave: 10, act: { curses: [], blessings: [] }, dps: 150, ...o });

describe('node intel', () => {
  it('is the roster the arena planner will compose for that node (same seed, tier, faction, segment)', () => {
    const intel = nodeIntel(entry, ctx());
    const effect = nodeEffect(entry, [MODE_EFFECT.defense]);
    const p = new SurvivalPlanner(777, segmentTier(getTier(1), effect), BIOMES[entry.biome].faction);
    p.setSegment({ from: 11, to: 15, boss: entry.boss, event: effect.event ?? null, cores: effect.cores });
    let n = 0;
    for (let w = 11; w <= 15; w++) n += p.compose(w).spawns.length;
    expect(intel.hostiles).toBe(n);
    expect(intel.roster.reduce((s, r) => s + r.count, 0)).toBe(n);
    expect(intel.totalHp).toBeGreaterThan(0);
    expect(intel.fireSeconds).toBeCloseTo(intel.totalHp / 150);
    expect(intel.threat).toBeGreaterThanOrEqual(1);
    expect(intel.threat).toBeLessThanOrEqual(5);
    // Faction of the node's sector = the faction the generated arena carries.
    expect(BIOMES[generateArena(entry.seed).biome as keyof typeof BIOMES].faction.name).toBe(intel.faction);
  });

  it('elite and boss nodes read harder; survival is smaller; hubs list rewards without hostiles', () => {
    const plain = nodeIntel(entry, ctx({ lastWave: 20 }));
    const elite = nodeIntel({ ...entry, kind: 'elite' }, ctx({ lastWave: 20 }));
    const boss = nodeIntel({ ...entry, kind: 'boss', boss: 'colossus' }, ctx({ lastWave: 20 }));
    const surv = nodeIntel(entry, ctx({ lastWave: 20, mode: 'survival' }));
    expect(elite.elites).toBeGreaterThan(plain.elites);
    expect(boss.boss).toBe('SIEGE COLOSSUS');
    expect(surv.totalHp).toBeLessThan(plain.totalHp);
    expect(surv.rewards.some((r) => r.label === 'Income' && r.value === '+25%')).toBe(true);
    for (const kind of ['merchant', 'forge', 'rest', 'vault', 'event'] as const) {
      const h = nodeIntel({ ...entry, kind, mods: [], anomaly: kind === 'event' ? 'pact' : null }, ctx());
      expect(h.hostiles).toBe(0);
      expect(h.rewards.length).toBeGreaterThan(0);
    }
  });

  it('route lookahead: downstream nodes, rows to the boss, fight range', () => {
    const l = lookahead(seed, entry);
    const boss = act1.rows[act1.rows.length - 1][0];
    expect(l.reach).toContain(boss.id);
    expect(l.rowsToBoss).toBe(act1.rows.length - 1);
    expect(l.minFights).toBeGreaterThanOrEqual(2); // the entry fight and the boss
    expect(l.maxFights).toBeGreaterThanOrEqual(l.minFights);
    expect(l.canRest).toBe(true); // the camp row always has a safe harbour
    expect(lookahead(seed, boss)).toMatchObject({ rowsToBoss: 0, minFights: 1, maxFights: 1 });
    expect(SEGMENT).toBe(5);
  });
});

describe('survival hunt', () => {
  it('the hunt layout moves its reactor point with the hunted drone; the real layout is untouched', () => {
    const L = generateArena(99);
    const h = new Hunt(L);
    h.aim({ x: 30, z: -12 });
    expect(h.layout.reactor.x).toBe(30);
    expect(h.layout.reactor.z).toBe(-12);
    expect(L.reactor.x).not.toBe(30);
    expect(h.layout.routes).toBe(L.routes);
    expect(Hunt.hitFor(1000, 100)).toBe(100 * HUNT.hitCap);
    expect(Hunt.hitFor(10, 100)).toBe(10 * HUNT.hitShare);
  });

  it('a retargeted field leads to the drone, not the reactor', () => {
    const L = generateArena(99);
    const g = new NavGrid(L, false);
    const from = L.routes.north.points[0];
    const toReactor = g.pathFrom(from.x, from.z).at(-1)!;
    expect(Math.hypot(toReactor.x - L.reactor.x, toReactor.z - L.reactor.z)).toBeLessThan(10);
    // Hunt a drone near the drop point.
    const drone = { x: L.playerSpawn.x, z: L.playerSpawn.z };
    const v = g.version;
    g.retarget([drone]);
    expect(g.version).toBe(v + 1);
    const end = g.pathFrom(from.x, from.z).at(-1)!;
    expect(Math.hypot(end.x - drone.x, end.z - drone.z)).toBeLessThan(NavGrid.HUNT_RADIUS + 2);
  });

  it('a drone standing on a solid block is still hunted (nearest walkable ground)', () => {
    const g = new NavGrid(ARENA, false);
    const onBlock = { x: ARENA.reactor.x + 26, z: ARENA.reactor.z - 26 };
    expect(g.walkable(onBlock.x, onBlock.z)).toBe(false);
    g.retarget([onBlock]);
    for (const r of Object.values(ARENA.routes)) {
      const p = g.pathFrom(r.points[0].x, r.points[0].z);
      expect(p.length).toBeGreaterThanOrEqual(2);
      expect(Math.hypot(p.at(-1)!.x - onBlock.x, p.at(-1)!.z - onBlock.z)).toBeLessThan(12);
    }
  });

  it('survival runs keep their own records and mode in the history', () => {
    const d = createDefaultSave(1);
    beginRun(d, 'run_s', 1, 2, { mapSeed: 5, mode: 'survival' });
    expect(d.activeRun?.mode).toBe('survival');
    const led = new RunLedger('run_s', 1, 2);
    led.survivalMode = true;
    for (let w = 1; w <= 10; w++) led.waveCleared(w);
    led.map = { act: 1, nodes: 2, actsCleared: 0, path: ['1C', '1C'] };
    const res = led.finalize('defeat', 9);
    expect(res.mode).toBe('survival');
    expect(recordRun(d, res)).toBe(true);
    expect(d.records['1']).toMatchObject({ survivalRuns: 1, survivalBestWave: 10, survivalBestNodes: 2 });
    expect(d.history[0].mode).toBe('survival');
    const back = sanitizeSave(JSON.parse(JSON.stringify(d))).data;
    expect(back.history[0].mode).toBe('survival');
    expect(back.records['1'].survivalBestWave).toBe(10);
  });
});
