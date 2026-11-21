import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/combat/damage';
import { isCombatKind } from '../src/runmap/defs';
import { parseRegionId, regionLayout, regionNode } from '../src/war/regions';
import { HOUR, liveMods, newWar, regionLiberation, regionState, sanitizeWar, secureNode, tickWar, WAR, type WarState } from '../src/war/state';

const T0 = 1_800_000_000_000;

/** Players secure nodes at a steady pace: each online warden finishes a node every 15 minutes. */
function simulate(online: number, hours: number, seed = 7): { s: WarState; conqueredAt: number | null } {
  const s = newWar(seed, T0);
  const r = mulberry32(99);
  let conqueredAt: number | null = null;
  for (let h = 1; h <= hours; h++) {
    const now = T0 + h * HOUR;
    tickWar(s, now, online);
    const reg = s.regions[0];
    for (let i = 0; i < online * 4 && reg.status === 'active'; i++) {
      // Wardens prefer distress calls and threats, otherwise any unfinished sector.
      const todo = Object.entries(reg.nodes).filter(([, n]) => n.corrupt || n.lib < 100).map(([id]) => id);
      const hot = s.events.filter((e) => e.region === 0 && todo.includes(e.node)).map((e) => e.node);
      const id = hot.length ? hot[0] : todo[Math.floor(r() * todo.length) % todo.length];
      secureNode(s, { node: id, mode: 'defense', players: 1 }, now);
    }
    if (reg.status === 'liberated' && conqueredAt === null) conqueredAt = h;
  }
  return { s, conqueredAt };
}

describe('war regions', () => {
  it('layouts are deterministic, connected, with landing / capital / rift and biome-coherent sectors', () => {
    for (let k = 0; k < 30; k++) {
      const d = regionLayout(1234, k);
      expect(JSON.stringify(regionLayout(1234, k))).toBe(JSON.stringify(d));
      expect(d.nodes.length).toBeGreaterThanOrEqual(10);
      expect(d.nodes.find((n) => n.id === d.capital)?.kind).toBe('boss');
      expect(d.nodes.find((n) => n.id === d.landing)?.kind).toBe('combat');
      expect(d.nodes.some((n) => n.kind === 'rest') && d.nodes.some((n) => n.kind === 'merchant')).toBe(true);
      // Connected from the landing.
      const seen = new Set([d.landing]);
      const q = [d.landing];
      while (q.length) {
        const cur = q.shift()!;
        for (const l of d.nodes.find((n) => n.id === cur)!.links) if (parseRegionId(l)?.k === k && !seen.has(l)) (seen.add(l), q.push(l));
      }
      expect(seen.size).toBe(d.nodes.length);
      // Links are symmetric inside the region.
      for (const n of d.nodes) for (const l of n.links) if (parseRegionId(l)?.k === k) expect(d.nodes.find((x) => x.id === l)!.links).toContain(n.id);
      for (const n of d.nodes) expect(n.mods.every((m) => !['corrupted', 'stronghold', 'distress', 'defense', 'convoy'].includes(m))).toBe(true);
    }
    // Regions chain: a capital leads to the next landing and back.
    expect(regionNode(1234, 'r2n1')!.links).toContain('r3n0');
    expect(regionNode(1234, 'r3n0')!.links).toContain('r2n1');
  });
});

describe('war rules', () => {
  it('a region falls in about a day whatever the population', () => {
    for (const online of [1, 4, 40]) {
      const { conqueredAt } = simulate(online, 60);
      expect(conqueredAt).not.toBe(null);
      expect(conqueredAt!).toBeGreaterThan(10);
      expect(conqueredAt!).toBeLessThan(48);
    }
  });

  it('the next region unlocks; liberated regions stay playable', () => {
    const { s } = simulate(4, 60);
    expect(s.regions[0].status).toBe('liberated');
    expect(regionState(s, 1)?.status).toBe('active');
    expect(regionLiberation(s, 0)).toBe(100);
    expect(secureNode(s, { node: 'r0n0', mode: 'defense', players: 1 }, T0).reason).toMatch(/already liberated/);
  });

  it('liberation per secured node scales down with players online; distress doubles it', () => {
    const a = newWar(3, T0);
    a.avgOnline = 1;
    expect(secureNode(a, { node: 'r0n0', mode: 'defense', players: 1 }, T0).gain).toBe(WAR.baseGain);
    const b = newWar(3, T0);
    b.avgOnline = 10;
    expect(secureNode(b, { node: 'r0n0', mode: 'defense', players: 2 }, T0).gain).toBeCloseTo((WAR.baseGain * 2) / 10);
    b.events.push({ id: 'x', kind: 'distress', region: 0, node: 'r0n0', until: T0 + HOUR });
    expect(secureNode(b, { node: 'r0n0', mode: 'defense', players: 1 }, T0).gain).toBeCloseTo((WAR.baseGain * 2) / 10);
  });

  it('nobody playing: resistance erodes, corruption spreads, the region falls back', () => {
    const s = newWar(11, T0);
    secureNode(s, { node: 'r0n0', mode: 'defense', players: 1 }, T0);
    tickWar(s, T0 + 5 * HOUR, 1);
    expect(s.regions[0].nodes.r0n0.lib).toBeLessThan(WAR.baseGain);
    const corrupt0 = Object.values(s.regions[0].nodes).filter((n) => n.corrupt).length;
    for (let h = 6; h < 400; h += 24) tickWar(s, T0 + h * HOUR, 1);
    const reg = s.regions[0];
    expect(Object.values(reg.nodes).filter((n) => n.corrupt).length).toBeGreaterThan(corrupt0);
    expect(reg.fallbacks).toBeGreaterThan(0);
    expect(s.log.some((l) => l.kind === 'fallback')).toBe(true);
  });

  it('securing a corrupted node purges it; a threatened liberated node is defended or falls', () => {
    const s = newWar(5, T0);
    const def = regionLayout(5, 0);
    expect(liveMods(s, def.rift)).toContain('corrupted');
    const res = secureNode(s, { node: def.rift, mode: 'defense', players: 1 }, T0);
    expect(res.messages).toContain('Corruption purged');
    expect(s.regions[0].nodes[def.rift].corrupt).toBe(false);
    // A threat on a liberated node: falls when it expires.
    s.regions[0].nodes.r0n0.lib = 100;
    s.events.push({ id: 't', kind: 'defense', region: 0, node: 'r0n0', until: T0 + 2 * HOUR });
    tickWar(s, T0 + 3 * HOUR, 1);
    expect(s.regions[0].nodes.r0n0.corrupt).toBe(true);
  });

  it('capital is a stronghold below 60%; orders complete into war buffs; catch-up is bounded', () => {
    const s = newWar(8, T0);
    expect(liveMods(s, 'r0n1')).toContain('stronghold');
    tickWar(s, T0 + HOUR, 1);
    expect(s.order).not.toBe(null);
    s.order = { id: 'o', region: 0, kind: 'secure', target: 1, progress: 0, until: T0 + 10 * HOUR, reward: 'luck' };
    secureNode(s, { node: 'r0n0', mode: 'defense', players: 1 }, T0 + HOUR);
    expect(s.buffs[0]).toMatchObject({ kind: 'luck', mult: 1.2 });
    const before = s.hour;
    tickWar(s, T0 + 10_000 * HOUR, 1);
    expect(s.hour - before).toBeGreaterThan(WAR.maxCatchUp);
    expect(sanitizeWar(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(sanitizeWar({ v: 2 })).toBe(null);
  });

  it('every combat node of a region is tracked', () => {
    const s = newWar(9, T0);
    const def = regionLayout(9, 0);
    expect(Object.keys(s.regions[0].nodes).sort()).toEqual(def.nodes.filter((n) => isCombatKind(n.kind)).map((n) => n.id).sort());
  });
});
