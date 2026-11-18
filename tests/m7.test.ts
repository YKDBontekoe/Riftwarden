import { describe, expect, it } from 'vitest';
import { normalizeCode, parseClientMsg, PROTOCOL_VERSION, RateLimiter } from '../src/net/protocol';
import { opError, runOp } from '../src/progression/ops';
import { createDefaultSave, migrate, parseSave, sanitizeSave, SAVE_VERSION, serializeSave } from '../src/progression/save';
import { checkEdge, checkFloor, checkFree, checkRemoveFloor, connectedFloors, coreCell, emptyStructure, walkableFloors } from '../src/home/build/model';
import { blueprintStatus } from '../src/home/build/ops';
import { pieceDef } from '../src/home/build/catalog';
import { canInstall, composeTower, DEFAULT_CONFIG } from '../src/towers/components';
import { nextStep, TUTORIAL } from '../src/progression/tutorial';
import { UPGRADES } from '../src/roguelite/upgrades';
import { ENEMY_COST, ENEMY_UNLOCK, SurvivalPlanner } from '../src/survival/plan';

const rich = () => {
  const d = createDefaultSave(1);
  d.resources.credits = 100000;
  d.resources.salvage = 100000;
  d.resources.components = 500;
  return d;
};

describe('M7 protocol', () => {
  it('validates message shapes and rejects malformed input', () => {
    expect(parseClientMsg({ t: 'hello', v: PROTOCOL_VERSION, secret: 'x'.repeat(32), name: 'A' })).not.toBeNull();
    expect(parseClientMsg({ t: 'hello', v: PROTOCOL_VERSION, secret: 'short', name: 'A' })).toBeNull();
    expect(parseClientMsg({ t: 'act', id: 1, a: 'place', cfg: 5 })).toBeNull();
    expect(parseClientMsg({ t: 'input', seq: 1, p: [0, 0, 0], yaw: 0, pitch: 0, sp: 0, fl: 0, heat: 0, shots: [{ f: 'plasma', o: [0, 0, 0], d: [0, 0, 1], pw: 1, h: 0, hits: [[1, 0, Infinity, 0, 0]] }] })).toBeNull();
    expect(parseClientMsg({ t: 'nope' })).toBeNull();
    expect(parseClientMsg([1, 2])).toBeNull();
    expect(normalizeCode(' ab-12x9z ')).toBe('AB12X9');
  });
  it('rate limiter refills over time and caps bursts', () => {
    const r = new RateLimiter(10, 5, 0);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (r.take(0)) ok++;
    expect(ok).toBe(5);
    expect(r.take(1000)).toBe(true);
  });
});

describe('M7 named operations', () => {
  it('reject unknown names, wrong argument types and repeated transaction ids', () => {
    expect(opError('grantEverything', [])).toBe('Unknown operation');
    expect(opError('sellItems', ['not-an-array'])).toMatch(/Invalid argument/);
    const d = rich();
    expect(runOp(d, 'refreshMarket', [], 'tx1').ok).toBe(true);
    expect(runOp(d, 'refreshMarket', [], 'tx1').ok).toBe(false);
  });
  it('cannot sell an item the profile does not own', () => {
    const d = rich();
    const other = createDefaultSave(2);
    const r = runOp(d, 'sellItems', [[other.items[0].uid + 'x']], 'tx2');
    expect(r.ok).toBe(false);
  });
});

describe('M7 construction rules', () => {
  it('core cells are protected and the gateways are the only roots', () => {
    const s = emptyStructure();
    expect(coreCell(0, 0)).toBe(true);
    expect(checkFloor(s, 9, 3, 'floor_basic').ok).toBe(false);
    expect(checkFloor(s, 7, 0, 'floor_basic').ok).toBe(true);
    expect(checkFloor(s, -8, 0, 'floor_basic').ok).toBe(true);
    s.floors['7,0'] = 'floor_basic';
    expect(checkFloor(s, 8, 0, 'floor_basic').ok).toBe(true);
    expect(checkFloor(s, 9, 0, 'floor_basic').ok).toBe(false);
  });
  it('walls cannot seal the gateway; removing a floor never strands others', () => {
    const s = emptyStructure();
    s.floors['7,0'] = 'floor_basic';
    s.floors['8,0'] = 'floor_basic';
    s.floors['9,0'] = 'floor_basic';
    expect(checkEdge(s, '6,0,e', 'wall_basic', {}).ok).toBe(false);
    expect(checkEdge(s, '6,0,e', 'wall_door', {}).ok).toBe(true);
    expect(checkRemoveFloor(s, 8, 0, [], {}).ok).toBe(false);
    expect(checkRemoveFloor(s, 9, 0, [], {}).ok).toBe(true);
    expect([...connectedFloors(s)].sort()).toEqual(['7,0', '8,0', '9,0']);
    s.edges['8,0,e'] = 'wall_basic';
    expect(walkableFloors(s).has('9,0')).toBe(false);
  });
  it('a relocated station can never be walled off', () => {
    const s = emptyStructure();
    s.floors['7,0'] = 'floor_basic';
    s.floors['8,0'] = 'floor_basic';
    const stations = { fabricate: { x: 44.5, z: 0, yaw: Math.PI } };
    expect(checkEdge(s, '7,0,e', 'wall_basic', stations).ok).toBe(false);
    expect(checkEdge(s, '7,0,e', 'wall_doorway', stations).ok).toBe(true);
  });
  it('free placement needs a reachable floor and respects keep-out zones', () => {
    const s = emptyStructure();
    expect(checkFree(s, 'planter', 0, -6.5, 1, [], {}).ok).toBe(false); // spawn
    expect(checkFree(s, 'planter', -5, 4, 1, [], {}).ok).toBe(true);
    expect(checkFree(s, 'planter', 60, 0, 1, [], {}).ok).toBe(false); // nothing built there
    expect(checkFree(s, 'planter', -5, 4, 2, [], {}).ok).toBe(false); // scale bounds
  });
  it('build/remove round trips are value-neutral (undo cannot duplicate resources)', () => {
    const d = rich();
    const before = { ...d.resources };
    expect(runOp(d, 'hqFloor', [7, 0, 'floor_basic']).ok).toBe(true);
    expect(runOp(d, 'hqFloor', [8, 0, 'floor_basic']).ok).toBe(true);
    expect(runOp(d, 'hqPlace', ['pl_test1', 'planter', 44.5, 0.5, 0, 1, {}]).ok).toBe(true);
    expect(runOp(d, 'hqUnfloor', [8, 0]).ok).toBe(false); // object stands on it
    expect(runOp(d, 'hqRemove', ['pl_test1']).ok).toBe(true);
    expect(runOp(d, 'hqUnfloor', [8, 0]).ok).toBe(true);
    expect(runOp(d, 'hqUnfloor', [7, 0]).ok).toBe(true);
    expect(d.resources).toEqual(before);
    expect(runOp(d, 'hqPlace', ['pl_test1', 'planter', 44.5, 0.5, 0, 1, {}]).ok).toBe(false); // floor gone
  });
  it('blueprints: merchant purchase persists; milestone unlocks derive from records', () => {
    const d = rich();
    expect(blueprintStatus(d, pieceDef('floor_lab')!).unlocked).toBe(false);
    d.milestones.push('w10');
    expect(blueprintStatus(d, pieceDef('floor_lab')!).unlocked).toBe(true);
    expect(runOp(d, 'hqBlueprint', ['sofa'], 'bp1').ok).toBe(true);
    expect(runOp(d, 'hqBlueprint', ['sofa'], 'bp2').ok).toBe(false);
    const back = parseSave(serializeSave(d));
    expect(back.ok && back.data.base.blueprints).toContain('sofa');
  });
  it('storage annex adds real bays and cannot be removed while they are used', () => {
    const d = rich();
    const cap = d.storage.capacity;
    expect(runOp(d, 'hqPlace', ['pl_annex1', 'storageAnnex', -5, 3, 0, 1, {}]).ok).toBe(true);
    expect(d.storage.capacity).toBe(cap + 10);
    d.storage.uids = Array.from({ length: cap + 5 }, (_, i) => `fake${i}`);
    expect(runOp(d, 'hqRemove', ['pl_annex1']).ok).toBe(false);
  });
});

describe('M7 save v7', () => {
  it('v6 saves migrate: construction empty, tutorial complete, decorations kept', () => {
    const d = createDefaultSave(1) as unknown as Record<string, unknown>;
    const v6 = JSON.parse(JSON.stringify(d));
    delete v6.tutorial;
    v6.base = { layoutVersion: 1, placeables: (d.base as { placeables: unknown[] }).placeables, facilities: [] };
    const m = migrate(v6, 6);
    expect(m.ok).toBe(true);
    const { data } = sanitizeSave(m.data);
    expect(data.version).toBe(SAVE_VERSION);
    expect(Object.keys(data.base.structure.floors)).toHaveLength(0);
    expect(data.tutorial.done).toContain('complete');
    expect(data.base.placeables.length).toBeGreaterThan(5);
  });
  it('sanitize drops floating or unknown modules', () => {
    const d = createDefaultSave(1);
    (d.base.structure.floors as Record<string, string>)['12,6'] = 'floor_basic';
    (d.base.structure.floors as Record<string, string>)['7,0'] = 'nonsense';
    const { data } = sanitizeSave(JSON.parse(JSON.stringify(d)));
    expect(data.base.structure.floors).toEqual({});
  });
});

describe('M7 content', () => {
  it('missile and support towers compose valid stats and are compatible where documented', () => {
    const mis = { ...DEFAULT_CONFIG, weapon: 'missile_battery' };
    const sup = { ...DEFAULT_CONFIG, weapon: 'support_amp' };
    expect(canInstall(DEFAULT_CONFIG, 'weapon', 'missile_battery')).toBeNull();
    expect(canInstall(sup, 'modifier', 'multi_target')).not.toBeNull();
    const m = composeTower(mis, 1);
    expect(m.archetype).toBe('missile');
    expect(m.targets).toBe(4);
    expect(m.splash).toBeGreaterThan(3);
    expect(composeTower({ ...mis, modifier: 'multi_target' }, 1).targets).toBe(6);
    const s = composeTower(sup, 1);
    expect(s.damage).toBeCloseTo(0.25);
    expect(composeTower({ ...sup, core: 'capacitor' }, 3).damage).toBeGreaterThan(0.3);
  });
  it('new enemies have costs, unlock waves and appear in compositions', () => {
    expect(ENEMY_COST.jammer).toBeGreaterThan(0);
    expect(ENEMY_COST.crawler).toBeGreaterThan(ENEMY_COST.enforcer);
    expect(ENEMY_UNLOCK.crawler).toBeGreaterThan(ENEMY_UNLOCK.jammer!);
    const p = new SurvivalPlanner(1234, 3);
    const kinds = new Set<string>();
    for (let n = 1; n <= 40; n++) for (const s of p.compose(n).spawns) kinds.add(s.kind);
    expect(kinds.has('jammer')).toBe(true);
    expect(kinds.has('crawler')).toBe(true);
  });
  it('ten new upgrades exist with text', () => {
    const ids = ['w_vent', 'w_exec', 'm_momentum', 't_cluster', 't_overload', 'e_frostbite', 'x_bounty', 'd_rebound', 'l_singularity', 'l_echo'];
    for (const id of ids) {
      const u = UPGRADES.find((x) => x.id === id);
      expect(u, id).toBeTruthy();
      expect(u!.text(1).length).toBeGreaterThan(10);
    }
  });
  it('tutorial steps run in order per location and stop once complete', () => {
    const d = createDefaultSave(1);
    expect(nextStep(d, 'hq', () => true)?.id).toBe('hq_look');
    expect(nextStep(d, 'arena', (id) => id !== 'move')?.id).toBe('dash');
    for (const s of TUTORIAL) expect(runOp(d, 'tutorialStep', [s.id]).ok).toBe(true);
    expect(d.tutorial.done).toContain('complete');
    expect(nextStep(d, 'arena', () => true)).toBeNull();
  });
});

describe('M7 signatures', () => {
  it('legendary and exotic weapons roll a persistent signature; others none; old saves get one on load', async () => {
    const { generateItem } = await import('../src/loot/generate');
    const { signatureDef } = await import('../src/loot/signatures');
    const leg = generateItem({ uid: 'L1', seed: 42, level: 10, rarity: 'legendary', baseId: 'plasma_repeater', source: 't', now: 1 });
    const rare = generateItem({ uid: 'R1', seed: 42, level: 10, rarity: 'rare', baseId: 'plasma_repeater', source: 't', now: 1 });
    expect(signatureDef(leg.signature)).not.toBeNull();
    expect(signatureDef(leg.signature)!.exotic).toBeFalsy();
    expect(rare.signature).toBeNull();
    const again = generateItem({ uid: 'L1', seed: 42, level: 10, rarity: 'legendary', baseId: 'plasma_repeater', source: 't', now: 1 });
    expect(again.signature).toBe(leg.signature);
    const d = createDefaultSave(1);
    const old = { ...leg, signature: null };
    d.items.push(old as never);
    d.storage.uids.push(old.uid);
    const { data } = sanitizeSave(JSON.parse(JSON.stringify(d)));
    expect(data.items.find((i) => i.uid === 'L1')!.signature).toBe(leg.signature);
  });
});
