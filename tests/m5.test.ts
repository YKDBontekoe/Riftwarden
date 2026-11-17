import { describe, expect, it } from 'vitest';
import { type BusEvent, EffectBus, MAX_DEPTH, MAX_QUEUE } from '../src/combat/events';
import { applyBurn, applyChill, applyShock, isBurning, newStatus, resolveReactions, speedFactor, tickStatus, vulnerability } from '../src/combat/status';
import { mulberry32 } from '../src/combat/damage';
import { OFFER_SIZE, RunBuild, UPGRADES, UP, upgradeDef } from '../src/roguelite/upgrades';
import { BASES, CORES, DEFAULT_CONFIG, MODIFIERS, WEAPONS, availableParts, canInstall, compatibility, composeTower, configCost, isUnlocked, levelCost, NO_RUN_INPUT, STARTER_TECH, swapCost, TECH_LIST, type TowerConfig } from '../src/towers/components';

interface Ev extends BusEvent {
  type: 'a' | 'b' | 'c';
  n?: number;
}
const root = (bus: EffectBus<Ev>, type: Ev['type'] = 'a'): Ev => ({ type, chain: bus.newChain(), source: { kind: 'weapon', id: 'w' } });

describe('effect bus', () => {
  it('delivers in order and clears the queue', () => {
    const bus = new EffectBus<Ev>(() => 0);
    const seen: string[] = [];
    bus.register({ id: 'x', owner: 'o', on: ['a', 'b'], run: (e) => void seen.push(e.type) });
    bus.emit(root(bus, 'a'));
    bus.emit(root(bus, 'b'));
    bus.drain();
    expect(seen).toEqual(['a', 'b']);
    expect(bus.size).toBe(0);
  });
  it('registering the same id twice replaces (no duplicate listeners)', () => {
    const bus = new EffectBus<Ev>();
    let n = 0;
    for (let i = 0; i < 5; i++) bus.register({ id: 'x', owner: 'o', on: 'a', run: () => void n++ });
    bus.emit(root(bus));
    bus.drain();
    expect(n).toBe(1);
    expect(bus.effectCount).toBe(1);
  });
  it('unregisterOwner removes only that owner', () => {
    const bus = new EffectBus<Ev>();
    bus.register({ id: '1', owner: 'upgrade:a', on: 'a', run: () => {} });
    bus.register({ id: '2', owner: 'upgrade:b', on: 'a', run: () => {} });
    expect(bus.unregisterOwner('upgrade:a')).toBe(1);
    expect(bus.effectCount).toBe(1);
  });
  it('infinite feedback loop a->b->a is bounded by chain limit and depth', () => {
    const bus = new EffectBus<Ev>();
    let runsA = 0;
    let runsB = 0;
    bus.register({ id: 'ea', owner: 'o', on: 'a', chainLimit: 50, run: (e, api) => { runsA++; bus.emit({ type: 'b', chain: api.child(e), source: { kind: 'effect', id: 'ea' } }); } });
    bus.register({ id: 'eb', owner: 'o', on: 'b', chainLimit: 50, run: (e, api) => { runsB++; bus.emit({ type: 'a', chain: api.child(e), source: { kind: 'effect', id: 'eb' } }); } });
    bus.emit(root(bus));
    const n = bus.drain();
    expect(n).toBeLessThanOrEqual(MAX_DEPTH + 2);
    expect(runsA + runsB).toBeLessThanOrEqual(MAX_DEPTH + 1);
    expect(bus.stats.depthBlocked).toBeGreaterThan(0);
    expect(bus.size).toBe(0);
  });
  it('default chain limit stops an effect re-triggering inside one chain, but not across chains', () => {
    const bus = new EffectBus<Ev>();
    let runs = 0;
    bus.register({ id: 'e', owner: 'o', on: 'a', run: (e, api) => { runs++; bus.emit({ type: 'a', chain: api.child(e), source: { kind: 'effect', id: 'e' } }); } });
    bus.emit(root(bus));
    bus.drain();
    expect(runs).toBe(1);
    expect(bus.stats.chainBlocked).toBe(1);
    bus.emit(root(bus));
    bus.drain();
    expect(runs).toBe(2);
  });
  it('cooldowns and chances apply; budget defers (never drops) events', () => {
    const bus = new EffectBus<Ev>(() => 0.99);
    let cd = 0;
    let ch = 0;
    bus.register({ id: 'cd', owner: 'o', on: 'b', cooldown: 1, chainLimit: 99, run: () => void cd++ });
    bus.register({ id: 'ch', owner: 'o', on: 'c', chance: 0.5, chainLimit: 99, run: () => void ch++ });
    for (let i = 0; i < 5; i++) bus.emit(root(bus, 'b'));
    for (let i = 0; i < 5; i++) bus.emit(root(bus, 'c'));
    expect(bus.drain(4)).toBe(4);
    expect(bus.size).toBe(6);
    bus.drain();
    expect(cd).toBe(1);
    expect(ch).toBe(0);
    bus.tick(1.1);
    bus.emit(root(bus, 'b'));
    bus.drain();
    expect(cd).toBe(2);
  });
  it('queue is hard-capped and counts refusals; unsubscribed events are not queued', () => {
    const bus = new EffectBus<Ev>();
    bus.register({ id: 'e', owner: 'o', on: 'a', chainLimit: 1e9, run: () => {} });
    for (let i = 0; i < MAX_QUEUE + 10; i++) bus.emit(root(bus, 'a'));
    expect(bus.size).toBe(MAX_QUEUE);
    expect(bus.stats.dropped).toBe(10);
    bus.clear();
    bus.emit(root(bus, 'c'));
    expect(bus.size).toBe(0);
  });
  it('a throwing effect is contained and counted', () => {
    const bus = new EffectBus<Ev>();
    let ok = 0;
    bus.register({ id: 'bad', owner: 'o', on: 'a', run: () => { throw new Error('x'); } });
    bus.register({ id: 'good', owner: 'o', on: 'a', run: () => void ok++ });
    bus.emit(root(bus));
    bus.drain();
    expect(bus.stats.errors).toBe(1);
    expect(ok).toBe(1);
  });
});

describe('statuses', () => {
  const noHooks = { burn: () => {}, expire: () => {} };
  it('burn stacks, refreshes, ticks and expires', () => {
    const s = newStatus();
    expect(applyBurn(s, 10).stacks).toBe(1);
    for (let i = 0; i < 10; i++) applyBurn(s, 10);
    expect(s.burnStacks).toBe(5);
    let dmg = 0;
    let expired = false;
    for (let t = 0; t < 5; t += 0.05) tickStatus(s, 0.05, { burn: (d) => (dmg += d), expire: (k) => (expired = expired || k === 'burn') });
    expect(expired).toBe(true);
    expect(isBurning(s)).toBe(false);
    // 4 s at 5 stacks x 10 dps
    expect(dmg).toBeGreaterThan(150);
    expect(dmg).toBeLessThanOrEqual(5 * 10 * 4.6);
  });
  it('chill slows, freezes at 100, grants immunity, decays', () => {
    const s = newStatus();
    expect(applyChill(s, 50)).toBe('chill');
    expect(speedFactor(s)).toBeLessThan(0.75);
    expect(vulnerability(s)).toBeGreaterThan(1);
    expect(applyChill(s, 60)).toBe('freeze');
    expect(speedFactor(s)).toBe(0);
    expect(applyChill(s, 100)).toBe('none');
    for (let t = 0; t < 1.6; t += 0.1) tickStatus(s, 0.1, noHooks);
    expect(s.frozenT).toBe(0);
    expect(applyChill(s, 50)).toBe('none'); // immune
    for (let t = 0; t < 4; t += 0.1) tickStatus(s, 0.1, noHooks);
    expect(applyChill(s, 50)).toBe('chill');
    for (let t = 0; t < 10; t += 0.1) tickStatus(s, 0.1, noHooks);
    expect(s.chill).toBe(0);
  });
  it('shock disruption has an internal cooldown', () => {
    const s = newStatus();
    expect(applyShock(s).disrupted).toBe(true);
    expect(applyShock(s).disrupted).toBe(false);
    expect(speedFactor(s)).toBeCloseTo(0.4);
    for (let t = 0; t < 2.1; t += 0.1) tickStatus(s, 0.1, noHooks);
    expect(applyShock(s).disrupted).toBe(true);
  });
  it('thermal shock consumes chill and has a cooldown (no repeat)', () => {
    const s = newStatus();
    applyChill(s, 80);
    const r = resolveReactions(s, 'thermal', 100);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('thermalShock');
    expect(r[0].damage).toBeGreaterThan(100);
    expect(s.chill).toBe(0);
    applyChill(s, 80);
    expect(resolveReactions(s, 'thermal', 100)).toHaveLength(0); // cooldown
    for (let t = 0; t < 2; t += 0.1) tickStatus(s, 0.1, noHooks);
    expect(resolveReactions(s, 'thermal', 100)).toHaveLength(1);
  });
  it('overload consumes burn; superconduct consumes chill; thermal does not trigger overload', () => {
    const s = newStatus();
    applyBurn(s, 10);
    applyBurn(s, 10);
    expect(resolveReactions(s, 'thermal', 50)).toHaveLength(0);
    const r = resolveReactions(s, 'electric', 40);
    expect(r.map((x) => x.kind)).toEqual(['overload']);
    expect(isBurning(s)).toBe(false);
    applyChill(s, 70);
    const r2 = resolveReactions(s, 'electric', 40);
    expect(r2[0].kind).toBe('superconduct');
    expect(r2[0].chainBonus).toBe(2);
    expect(s.chill).toBeCloseTo(30);
    expect(resolveReactions(s, 'none', 40)).toHaveLength(0);
  });
});

describe('run upgrades', () => {
  const ctx = { wave: 3, family: 'plasma' as const, towers: 1, towerArchetypes: ['ballistic' as const] };
  it('catalog is internally consistent', () => {
    const ids = new Set<string>();
    for (const u of UPGRADES) {
      expect(ids.has(u.id)).toBe(false);
      ids.add(u.id);
      expect(u.maxStacks).toBeGreaterThan(0);
      for (let n = 1; n <= u.maxStacks; n++) expect(u.text(n).length).toBeGreaterThan(10);
    }
    expect(UPGRADES.length).toBeGreaterThanOrEqual(25);
    expect(UPGRADES.filter((u) => u.rarity === 'legendary').length).toBeGreaterThanOrEqual(3);
    expect(UP.stormCrit.jumps(1)).toBe(3);
    expect(UP.stormCrit.dmg(1)).toBeCloseTo(0.45);
  });
  it('offers three distinct eligible upgrades, deterministically per seed', () => {
    const a = new RunBuild(1234);
    const b = new RunBuild(1234);
    const c = new RunBuild(98765);
    const oa = a.nextOffer(ctx).map((u) => u.id);
    const ob = b.nextOffer(ctx).map((u) => u.id);
    expect(oa).toEqual(ob);
    expect(oa).toHaveLength(OFFER_SIZE);
    expect(new Set(oa).size).toBe(OFFER_SIZE);
    // different seeds differ across a series of offers
    let differs = false;
    for (let i = 0; i < 6; i++) if (a.roll(ctx, i).map((u) => u.id).join() !== c.roll(ctx, i).map((u) => u.id).join()) differs = true;
    expect(differs).toBe(true);
    // the sequence is advanced by index, not by hidden state
    expect(a.roll(ctx, 0).map((u) => u.id)).toEqual(oa);
  });
  it('respects eligibility: no beam-incompatible, tower-less, prerequisite or early-legendary offers', () => {
    const b = new RunBuild(7);
    for (let i = 0; i < 200; i++) {
      const offer = b.roll({ wave: 1, family: 'beam', towers: 0, towerArchetypes: [] }, i);
      for (const u of offer) {
        expect(u.needs?.notFamily?.includes('beam')).toBeFalsy();
        expect(u.needs?.towers).toBeFalsy();
        expect(u.rarity).not.toBe('legendary');
        expect(u.needs?.anyTag).toBeUndefined();
      }
    }
  });
  it('stack limits, modifiers are rebuilt from scratch, and reset clears everything', () => {
    const b = new RunBuild(5);
    for (let i = 0; i < 9; i++) b.take('w_calibrated', 1);
    expect(b.count('w_calibrated')).toBe(5);
    expect(b.take('w_calibrated', 2)).toBe(false);
    expect(b.modifiers().filter((m) => m.stat === 'weaponDamageMult')).toHaveLength(5);
    expect(b.roll(ctx, 0).every((u) => u.id !== 'w_calibrated')).toBe(true);
    b.reset(9);
    expect(b.total).toBe(0);
    expect(b.modifiers()).toHaveLength(0);
  });
  it('prerequisites unlock after taking a source; legendaries gate on wave', () => {
    const b = new RunBuild(11);
    const storm = upgradeDef('l_stormfall')!;
    expect(b.eligible(storm, { ...ctx, wave: 10 })).toBe(false);
    b.take('e_static', 1);
    expect(b.eligible(storm, { ...ctx, wave: 3 })).toBe(false);
    expect(b.eligible(storm, { ...ctx, wave: 10 })).toBe(true);
    expect(b.eligible(upgradeDef('s_precision')!, ctx)).toBe(false);
    expect(b.eligible(upgradeDef('s_precision')!, { ...ctx, towerArchetypes: ['cryo'] })).toBe(true);
  });
  it('rarity distribution favours common and legendary stays rare', () => {
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const rich = { wave: 8, family: 'plasma' as const, towers: 2, towerArchetypes: ['ballistic' as const, 'arc' as const] };
    const b = new RunBuild(3);
    b.take('e_static', 1);
    b.take('e_ignite', 1);
    for (let i = 0; i < 600; i++) for (const u of b.roll(rich, i)) counts[u.rarity]++;
    expect(counts.common).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.legendary);
    expect(counts.legendary).toBeGreaterThan(0);
  });
  it('build affinity leans toward owned tags without making it deterministic', () => {
    const rich = { wave: 5, family: 'plasma' as const, towers: 1, towerArchetypes: ['ballistic' as const] };
    const lean = new RunBuild(1);
    lean.take('e_static', 1);
    lean.take('e_stormcrit', 2);
    const base = new RunBuild(1);
    const share = (b: RunBuild) => {
      let e = 0;
      let all = 0;
      for (let i = 0; i < 300; i++) for (const u of b.roll(rich, i)) { all++; if (u.tags.includes('electric')) e++; }
      return e / all;
    };
    expect(share(lean)).toBeGreaterThan(share(base));
    expect(share(lean)).toBeLessThan(0.9);
  });
  it('archetype labels emerge from picks', () => {
    const b = new RunBuild(1);
    for (const id of ['e_static', 'e_stormcrit', 's_sync']) b.take(id, 1);
    expect(b.archetypes()[0].id).toBe('storm');
  });
});

describe('modular towers', () => {
  const cfg = (o: Partial<TowerConfig>): TowerConfig => ({ ...DEFAULT_CONFIG, ...o });
  it('default config reproduces the old Sentinel (cost 100, 15 dmg, 3.2/s, 22 m)', () => {
    expect(configCost(DEFAULT_CONFIG)).toBe(100);
    const s = composeTower(DEFAULT_CONFIG, 1);
    expect(s.damage).toBeCloseTo(15);
    expect(s.fireRate).toBeCloseTo(3.2);
    expect(s.range).toBeCloseTo(22);
    expect(s.archetype).toBe('ballistic');
  });
  it('enforces explicit compatibility', () => {
    expect(compatibility(DEFAULT_CONFIG)).toBeNull();
    expect(canInstall(DEFAULT_CONFIG, 'weapon', 'chain_emitter')).toBeNull();
    expect(canInstall(cfg({ weapon: 'frost_projector' }), 'modifier', 'splash_shells')).toMatch(/incompatible/);
    expect(canInstall(cfg({ base: 'bastion' }), 'weapon', 'frost_projector')).toMatch(/cannot mount/);
    expect(canInstall(cfg({ base: 'spire' }), 'weapon', 'autocannon')).toMatch(/cannot mount/);
    expect(canInstall(DEFAULT_CONFIG, 'core', 'nope')).toMatch(/Unknown/);
    expect(canInstall(cfg({ weapon: 'chain_emitter' }), 'modifier', 'field_amp')).toMatch(/incompatible/);
    // all weapon/core/mod combos validated by the same rule: no combination yields NaN stats
    for (const b of Object.keys(BASES)) for (const w of Object.keys(WEAPONS)) for (const c of Object.keys(CORES)) for (const m of Object.keys(MODIFIERS)) {
      const t = { base: b, weapon: w, core: c, modifier: m };
      if (compatibility(t)) continue;
      const s = composeTower(t, 3);
      for (const v of [s.damage, s.fireRate, s.range, s.dps, s.chain]) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('archetypes behave differently and parts change numbers', () => {
    const arc = composeTower(cfg({ weapon: 'chain_emitter' }), 1);
    expect(arc.chain).toBe(3);
    expect(arc.shock).toBe(true);
    expect(arc.element).toBe('electric');
    const multi = composeTower(cfg({ weapon: 'chain_emitter', core: 'overcharged', modifier: 'multi_target' }), 1);
    expect(multi.chain).toBe(5);
    expect(multi.fireRate).toBeGreaterThan(arc.fireRate);
    expect(multi.damage).toBeLessThan(arc.damage);
    const frost = composeTower(cfg({ weapon: 'frost_projector', core: 'cryo_core', modifier: 'field_amp' }), 1);
    expect(frost.chill).toBeCloseTo(20 * 1.4 * 1.3);
    expect(frost.range).toBeGreaterThan(14);
    const thermal = composeTower(cfg({ core: 'thermal_core' }), 1);
    expect(thermal.element).toBe('thermal');
    expect(thermal.burnFrac).toBeGreaterThan(0);
    expect(composeTower(cfg({ modifier: 'multi_target' }), 1).targets).toBe(2);
  });
  it('stats are recomputed from scratch: no bonus survives a part swap', () => {
    const a = composeTower(cfg({ core: 'capacitor' }), 2);
    const back = composeTower(DEFAULT_CONFIG, 2);
    expect(composeTower(DEFAULT_CONFIG, 2)).toEqual(back);
    expect(a.damage).toBeGreaterThan(back.damage);
  });
  it('run inputs and empowerment apply', () => {
    const base = composeTower(cfg({ weapon: 'chain_emitter' }), 1);
    const emp = composeTower(cfg({ weapon: 'chain_emitter' }), 1, { ...NO_RUN_INPUT, empowered: true, extraChain: 1, damageMult: 2 });
    expect(emp.fireRate).toBeCloseTo(base.fireRate * 1.4);
    expect(emp.chain).toBe(base.chain + 3);
    expect(emp.damage).toBeCloseTo(base.damage * 2);
  });
  it('costs: swap nets out half the old part, level upgrade grows', () => {
    expect(swapCost(DEFAULT_CONFIG, 'core', 'standard_core')).toBe(0);
    expect(swapCost(DEFAULT_CONFIG, 'core', 'capacitor')).toBe(60);
    expect(swapCost(cfg({ core: 'capacitor' }), 'core', 'standard_core')).toBe(0);
    expect(levelCost(DEFAULT_CONFIG, 2)).toBeGreaterThan(levelCost(DEFAULT_CONFIG, 1));
    expect(configCost(DEFAULT_CONFIG, 0.7)).toBe(70);
  });
  it('starter parts are always available; others need research', () => {
    expect(STARTER_TECH).toContain('weapon:autocannon');
    expect(isUnlocked(new Set(STARTER_TECH), 'weapon', 'autocannon')).toBe(true);
    expect(isUnlocked(new Set(STARTER_TECH), 'weapon', 'chain_emitter')).toBe(false);
    expect(availableParts(DEFAULT_CONFIG, 'weapon', STARTER_TECH).map((p) => p.id)).toEqual(['autocannon']);
    const all = new Set([...STARTER_TECH, ...TECH_LIST.map((t) => `${t.slot}:${t.id}`)]);
    expect(availableParts(DEFAULT_CONFIG, 'weapon', all).map((p) => p.id).sort()).toEqual(['autocannon', 'chain_emitter', 'frost_projector', 'marksman']);
    expect(TECH_LIST.length).toBeGreaterThanOrEqual(10);
  });
});

describe('determinism helpers', () => {
  it('mulberry32 is stable', () => {
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });
});

import { researchBlocker, researchTower } from '../src/economy/transactions';
import { createDefaultSave, MIGRATIONS, parseSave, sanitizeSave, serializeSave } from '../src/progression/save';

describe('tower research & save v5', () => {
  it('research needs milestone + resources, is permanent, atomic and idempotent by tx id', () => {
    const d = createDefaultSave();
    expect(researchBlocker(d, 'weapon', 'chain_emitter')).toMatch(/wave 3/i);
    d.records['1'] = { ...d.records['1'], bestWave: 5 } as never;
    d.resources.credits = 100;
    expect(researchTower(d, 'weapon', 'chain_emitter').ok).toBe(false);
    expect(d.towers.unlocked).toHaveLength(0);
    expect(d.resources.credits).toBe(100);
    d.resources.credits = 1000;
    expect(researchTower(d, 'weapon', 'chain_emitter', 'tx1').ok).toBe(true);
    expect(d.resources.credits).toBe(700);
    expect(researchTower(d, 'weapon', 'chain_emitter', 'tx1').ok).toBe(false);
    expect(researchTower(d, 'weapon', 'chain_emitter').ok).toBe(false);
    expect(researchTower(d, 'weapon', 'autocannon').ok).toBe(false);
    d.activeRun = { id: 'r' } as never;
    expect(researchTower(d, 'weapon', 'marksman').ok).toBe(false);
  });
  it('unlocks survive serialisation; bogus ids are dropped; v4 saves migrate without losing anything', () => {
    const d = createDefaultSave();
    d.towers.unlocked = ['weapon:chain_emitter', 'weapon:nope'];
    const r = parseSave(serializeSave(sanitizeSave(d).data));
    expect(r.ok && r.data.towers.unlocked).toEqual(['weapon:chain_emitter']);
    const v4 = JSON.parse(JSON.stringify(createDefaultSave()));
    delete v4.towers;
    const out = MIGRATIONS[4](v4) as { towers: { unlocked: string[] } };
    expect(out.towers.unlocked).toEqual([]);
    expect(sanitizeSave(v4).data.towers.unlocked).toEqual([]);
  });
});
