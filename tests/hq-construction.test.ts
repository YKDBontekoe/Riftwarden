import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { runOp } from '@riftwarden/rules/progression/ops';
import { createDefaultSave, migrate, parseSave, sanitizeSave, SAVE_VERSION, serializeSave } from '@riftwarden/rules/progression/save';
import { checkEdge, checkFloor, checkFree, checkRemoveFloor, connectedFloors, coreCell, emptyStructure, walkableFloors } from '@riftwarden/rules/home/build/model';
import { blueprintStatus } from '@riftwarden/rules/home/build/ops';
import { pieceDef } from '@riftwarden/rules/home/build/catalog';
import { setUnlockAll } from '@riftwarden/rules/progression/unlocks';

// Legacy rules suites exercise late systems on fresh profiles: staged unlocks are covered by tests/unlocks.test.ts.
beforeAll(() => setUnlockAll(true));
afterAll(() => setUnlockAll(false));

const rich = () => {
  const d = createDefaultSave(1);
  d.resources.credits = 100000;
  d.resources.salvage = 100000;
  d.resources.components = 500;
  return d;
};

describe('HQ construction rules', () => {
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

describe('save v7 (construction + tutorial)', () => {
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
