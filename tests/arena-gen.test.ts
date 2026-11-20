import { describe, expect, it } from 'vitest';
import { arenaStats, generateArena, sectorName } from '../src/world/arenaGen';
import { distToBoxXZ } from '../src/world/geometry';
import { ARENA, type GateId } from '../src/world/layout';
import { KIT } from '../src/player/movement';
import { NAV, NavGrid } from '../src/world/navgrid';
import { EnemyNavigator, FLYERS, type NavAgent } from '../src/enemies/navigation';
import { recycleRefund, repairCost, towerMaxHp } from '../src/towers/durability';

const GATES: GateId[] = ['north', 'east', 'west', 'south'];

describe('procedural arenas', () => {
  it('is deterministic per seed and varies between seeds', () => {
    const a = JSON.stringify(generateArena(1234));
    for (let i = 0; i < 12; i++) generateArena(9000 + i); // evict the memo
    expect(JSON.stringify(generateArena(1234))).toBe(a);
    expect(JSON.stringify(generateArena(98765))).not.toBe(a);
    expect(sectorName(1234)).toEqual(sectorName(1234));
    expect(sectorName(1234).name).not.toBe('');
  });

  it('is much larger than the classic arena and dense with structures', () => {
    for (const seed of [1, 2, 3, 77, 4242]) {
      const L = generateArena(seed);
      expect(L.half).toBeGreaterThanOrEqual(84);
      expect(L.half).toBeGreaterThan(ARENA.half * 1.8);
      expect(L.mazing).toBe(true);
      expect(arenaStats(L).structures).toBeGreaterThan(20);
      expect(arenaStats(L).platforms).toBeGreaterThanOrEqual(3);
    }
  });

  it('every gate and rift reaches the reactor; lanes stay off solids; spawn is open', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const L = generateArena(seed * 7919);
      const nav = new NavGrid(L, false);
      for (const g of GATES) {
        const pts = L.routes[g].points;
        expect(pts.length).toBeGreaterThan(1);
        const end = pts[pts.length - 1];
        expect(Math.hypot(end.x, end.z)).toBeLessThan(NAV.goalRadius + 1);
        for (const p of pts.slice(1, -1)) {
          for (const b of L.boxes) {
            // Ground enemies can pass beneath bridge decks and transfer girders.
            if (b.kind === 'wall' || b.kind === 'gate' || b.kind === 'reactor' || b.kind === 'bridge' || b.kind === 'runwall') continue;
            expect(distToBoxXZ(p.x, p.z, b)).toBeGreaterThan(0.5);
          }
        }
      }
      expect(L.rifts!.length).toBeGreaterThanOrEqual(4);
      for (const q of L.rifts!) expect(Number.isFinite(nav.costAt(q.x, q.z))).toBe(true);
      expect(nav.walkable(L.playerSpawn.x, L.playerSpawn.z)).toBe(true);
      // structures never overlap the reactor plaza
      for (const b of L.boxes) {
        if (b.kind !== 'wall' && b.kind !== 'gate' && b.kind !== 'reactor') expect(distToBoxXZ(0, 0, b)).toBeGreaterThan(15);
      }
    }
  });
});

describe('districts', () => {
  it('every sector has lane districts, a bastion ring and set pieces; lanes wind', () => {
    let detour = 0;
    let n = 0;
    const seen = new Set<string>();
    for (let seed = 100; seed < 130; seed++) {
      const L = generateArena(seed);
      const f = L.features ?? [];
      expect(f).toContain('ring');
      expect(f.filter((t) => ['maze', 'serpentine', 'containers', 'overpass'].includes(t)).length).toBeGreaterThanOrEqual(3);
      for (const t of f) seen.add(t);
      for (const g of L.initialGates) {
        const p = L.routes[g].points;
        let len = 0;
        for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
        detour += len / Math.hypot(p[0].x, p[0].z);
        n++;
      }
    }
    // Lanes are on average clearly longer than the straight line from the tunnel to the reactor.
    expect(detour / n).toBeGreaterThan(1.1);
    for (const t of ['maze', 'serpentine', 'containers', 'overpass', 'redoubt', 'skyway']) expect(seen.has(t)).toBe(true);
  });

  it('connects the four plaza landings within grapple and wall-run range', () => {
    for (const seed of [1, 77, 4040, 7919, 424242]) {
      const L = generateArena(seed);
      const inner = L.boxes.filter(b => b.kind === 'relay' && Math.abs(b.min[0]) < 22 && Math.abs(b.min[2]) < 22);
      expect(inner).toHaveLength(4);
      for (const relay of inner) {
        // Each socket can reach both adjacent decks. Diagonals can require a second hook.
        const links = inner.filter(b => b !== relay && Math.hypot(
          b.min[0] - relay.min[0], b.max[1] - relay.min[1], b.min[2] - relay.min[2],
        ) <= KIT.grappleRange);
        expect(links.length).toBeGreaterThanOrEqual(2);
      }
      const walls = L.boxes.filter(b => b.kind === 'runwall');
      expect(walls).toHaveLength(2);
      for (const b of walls) {
        expect(b.min[1]).toBeGreaterThan(3);
        expect(b.max[2] - b.min[2]).toBeLessThan(KIT.wallRunSpeed * KIT.wallRunTime);
      }
    }
  });

  it('bridges are elevated decks the ground grid ignores; their pylons block', () => {
    const L = [...Array(20)].map((_, i) => generateArena(200 + i)).find((x) => x.boxes.some((b) => b.kind === 'bridge'))!;
    const nav = new NavGrid(L, false);
    const deck = L.boxes.find((b) => b.kind === 'bridge')!;
    expect(deck.min[1]).toBeGreaterThan(2.5);
    // Somewhere under the deck (away from pylons) is walkable ground.
    let open = 0;
    for (let x = deck.min[0]; x <= deck.max[0]; x += 0.5) for (let z = deck.min[2]; z <= deck.max[2]; z += 0.5) if (nav.walkable(x, z)) open++;
    expect(open).toBeGreaterThan(0);
  });
});

describe('nav grid', () => {
  it('towers reroute ground paths and a sealed maze still has a (breaching) path', () => {
    const L = generateArena(31337);
    const nav = new NavGrid(L);
    const start = L.routes.north.points[0];
    const before = nav.costAt(start.x, start.z);
    const v0 = nav.version;
    const wall = [];
    for (let x = -9; x <= 9; x += 1.5) wall.push({ x, z: L.half - 6, r: 1.1 });
    expect(nav.setObstacles(wall)).toBe(true);
    expect(nav.version).toBeGreaterThan(v0);
    const after = nav.costAt(start.x, start.z);
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBeGreaterThan(before);
    expect(nav.pathFrom(start.x, start.z).length).toBeGreaterThan(1);
    expect(nav.setObstacles([...wall].reverse())).toBe(false);
  });

  it('a single tower on the lane makes paths detour around it', () => {
    const L = generateArena(4040);
    const nav = new NavGrid(L);
    const pts = L.routes.east.points;
    const a = pts[1];
    const b = pts[2] ?? pts[1];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    nav.setObstacles([{ x: mid.x, z: mid.z, r: 1.1 }]);
    const path = nav.pathFrom(pts[0].x, pts[0].z);
    for (let i = 1; i < path.length; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = path[i - 1].x + (path[i].x - path[i - 1].x) * t;
        const z = path[i - 1].z + (path[i].z - path[i - 1].z) * t;
        expect(Math.hypot(x - mid.x, z - mid.z)).toBeGreaterThan(1.1);
      }
    }
  });

  it('classic arena routes remain reachable on the grid', () => {
    const nav = new NavGrid(ARENA, false);
    for (const g of GATES) {
      const p = ARENA.routes[g].points[0];
      expect(Number.isFinite(nav.costAt(p.x, p.z))).toBe(true);
    }
  });

  it('re-plans a 200 m field quickly', () => {
    const nav = new NavGrid(generateArena(555));
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) nav.setObstacles([{ x: 20 + i, z: 20, r: 1.1 }]);
    expect((performance.now() - t0) / 5).toBeLessThan(120);
  });
});


describe('breaching + durability rules', () => {
  const agent = (o: Partial<NavAgent> = {}): NavAgent => ({
    kind: 'walker', path: [], seg: 1, pos: { x: 0, z: 0 }, def: { radius: 0.9, reactorDamage: 6, attackInterval: 1.6, role: 'reactor' },
    damageMult: 1, navV: -1, breachT: 0, breachId: 0, alive: true, ...o,
  });

  it('ground agents breach a live tower ahead; flyers and wrecks never block', () => {
    const towers = [{ id: 7, x: 0, z: 2, radius: 1.1, blocking: true }];
    const hits: number[] = [];
    const nav = new EnemyNavigator(generateArena(12), { towers: () => towers, breach: (_id, dmg) => hits.push(dmg) }, () => 0.5);
    const e = agent();
    let t = 0;
    for (let i = 0; i < 120; i++, t += 1 / 60) expect(nav.blocked(e, 0, 1.2, 1 / 60)).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toBeCloseTo(8 + 6 * 4);
    // moving away from the tower is never blocked
    expect(nav.blocked(agent({ pos: { x: 0, z: 1.5 } }), 0, 0.5, 1 / 60)).toBe(false);
    expect(FLYERS.has('rusher')).toBe(true);
    expect(nav.blocked(agent({ kind: 'rusher' }), 0, 1.2, 1 / 60)).toBe(false);
    towers[0] = { ...towers[0], blocking: false };
    expect(nav.blocked(agent(), 0, 1.2, 1 / 60)).toBe(false);
  });

  it('spawns use gates or the gate\'s forward rifts; bosses always use the gate', () => {
    const L = generateArena(77);
    let k = 0;
    const seq = [0.1, 0, 0, 0.9];
    const nav = new EnemyNavigator(L, { towers: () => [], breach: () => {} }, () => seq[k++ % seq.length]);
    const p = nav.spawnPoint('north', 'reactor');
    const north = (L.rifts ?? []).filter((r) => r.gate === 'north');
    if (north.length) expect(north.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 2)).toBe(true);
    expect(nav.spawnPoint('north', 'boss')).toEqual(L.routes.north.points[0]);
  });

  it('re-plans only when the field version changed', () => {
    const towers: { id: number; x: number; z: number; radius: number; blocking: boolean }[] = [];
    const L = generateArena(4040);
    const nav = new EnemyNavigator(L, { towers: () => towers, breach: () => {} });
    const s = L.routes.east.points[0];
    const e = agent({ pos: { x: s.x, z: s.z }, path: nav.pathFrom('walker', s, 'east') });
    e.navV = nav.ground.version;
    expect(nav.refresh(e)).toBe(false);
    const mid = L.routes.east.points[1];
    towers.push({ id: 1, x: (s.x + mid.x) / 2, z: (s.z + mid.z) / 2, radius: 1.1, blocking: true });
    expect(nav.sync()).toBe(true);
    expect(nav.refresh(e)).toBe(true);
    expect(e.seg).toBe(1);
  });

  it('durability numbers', () => {
    expect(towerMaxHp('bastion', 1)).toBeGreaterThan(towerMaxHp('standard', 1));
    expect(towerMaxHp('standard', 3)).toBe(Math.round(420 * 1.5));
    expect(repairCost(200, 420, 420, false)).toBe(0);
    expect(repairCost(200, 210, 420, false)).toBe(40);
    expect(repairCost(200, 0, 420, true)).toBeGreaterThan(repairCost(200, 1, 420, false));
    expect(recycleRefund(200, 0.75, true)).toBeLessThan(recycleRefund(200, 0.75, false));
  });
});
