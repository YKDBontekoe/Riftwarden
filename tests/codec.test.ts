// Binary frame codec: every message the game sends must come back exactly as JSON frames delivered it,
// so handlers and validators keep working unchanged (architecture v2, step 2).
import { describe, expect, it } from 'vitest';
import { decodeClient, decodeServer, encodeClient, encodeServer } from '@riftwarden/protocol/codec';
import { parseEvent } from '@riftwarden/protocol/events';
import { type ClientMsg, parseClientMsg, PROTOCOL_VERSION, type ServerMsg } from '@riftwarden/protocol/protocol';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { SAMPLES, V } from './fixtures/events';

const viaServer = (m: ServerMsg) => decodeServer(encodeServer(m));
const viaClient = (m: ClientMsg) => decodeClient(encodeClient(m));
const r = (v: number, k: number) => Math.round(v * k) / k;

const CLIENT: ClientMsg[] = [
  { t: 'hello', v: PROTOCOL_VERSION },
  { t: 'create', tier: 2 },
  { t: 'join', code: 'ABCDE' },
  { t: 'leave' },
  { t: 'ready', ready: true },
  { t: 'tier', tier: 3 },
  { t: 'mode', mode: 'survival' },
  { t: 'mode', mode: 'defense' },
  { t: 'node', node: 'r0n4' },
  { t: 'node', node: null },
  { t: 'start' },
  { t: 'presence', p: [1.5, 2, -3.25], yaw: 0.75 },
  { t: 'visit', on: true },
  { t: 'input', seq: 41, p: [12.345678, 1.6, -40.1], yaw: 1.2345, pitch: -0.1, sp: 16.5, fl: 5, heat: 0.42 },
  {
    t: 'input',
    seq: 42,
    p: [1, 2, 3],
    yaw: 0,
    pitch: 0,
    sp: 0,
    fl: 4,
    heat: 0.1,
    shots: [{ f: 'plasma', o: [1, 1.6, 2], d: [0, 0, 1], pw: 1, h: 0.2, hits: [[7, 1, 1.1, 1.5, 9.9], [8, 0, 2, 1, 12]] }],
  },
  { t: 'act', id: 1, a: 'place', cfg: { base: 'standard', weapon: 'autocannon', core: 'standard_core', modifier: 'none' }, p: [4, 0, 5], yaw: 1.5 },
  { t: 'act', id: 2, a: 'recycle', tower: 3 },
  { t: 'act', id: 3, a: 'repair', tower: 3 },
  { t: 'act', id: 4, a: 'modify', tower: 3, what: 'level' },
  { t: 'act', id: 5, a: 'modify', tower: 3, what: 'core', part: 'thermal_core' },
  { t: 'act', id: 6, a: 'tactical' },
  { t: 'act', id: 7, a: 'startWave' },
  { t: 'act', id: 8, a: 'collect', pickup: 12 },
  { t: 'act', id: 9, a: 'upgrade', pick: 'w_vent' },
  { t: 'act', id: 10, a: 'vote', home: false },
  { t: 'act', id: 11, a: 'mapVote', choice: 'r0n3' },
  { t: 'act', id: 12, a: 'station', station: 'forge', opt: 'temper' },
  { t: 'act', id: 13, a: 'equip', uid: 'a.1' },
  { t: 'act', id: 14, a: 'equip', uid: 'a.1', slot: 'weapon2' },
  { t: 'act', id: 15, a: 'unequip', slot: 'armor' },
  { t: 'act', id: 16, a: 'discard', uid: 'a.2' },
  { t: 'act', id: 17, a: 'ability', slot: 'ultimate', o: [1, 2, 3], d: [0, -0.5, 0.86] },
  { t: 'act', id: 18, a: 'swap', slot: 'weapon2' },
  { t: 'act', id: 19, a: 'pound', p: [3, 0, 4], f: 7.5 },
  { t: 'act', id: 20, a: 'test', op: 'jump', n: 9 },
  { t: 'act', id: 21, a: 'test', op: 'killAll' },
  { t: 'ping', c: 1234.5 },
];

/** A snapshot shaped like ServerGame.netSnapshot + personal (values rounded the way the server rounds them). */
function snapshot(seed: number, full: boolean): Record<string, unknown> {
  const rand = mulberry32(seed);
  const pos = () => r((rand() - 0.5) * 180, 100);
  const enemies = Array.from({ length: 40 }, (_, i) => [
    i + 1,
    pos(),
    r(rand() * 6, 100),
    pos(),
    r((rand() - 0.5) * 6, 1000),
    Math.round(rand() * 900),
    900,
    Math.round(rand() * 50),
    0,
    i % 3 === 0 ? 1 : 0,
    r(rand(), 100),
    r(rand() * 4, 10),
    0,
    r(rand(), 100),
    [i % 5, Math.round(rand() * 100), 0, i % 7 === 0 ? 1 : 0],
    full || i % 4 === 0 ? { mode: 'walk', t: r(rand() * 3, 100), armed: true } : 0,
    i % 9,
  ]);
  return {
    t: r(1234.5678, 1000),
    w: [12, 'combat', r(7.34, 10), 31, 9],
    r: 812,
    c: 245,
    tac: [64, 1, 0.35],
    e: enemies,
    a: [
      ['p1', pos(), 1.6, pos(), 1.234, -0.05, 120, 150, 40, 60, 1, 0, 0, 5, 0.42, 'plasma', 1, 16.5, -1, 'Alpha'],
      ['p2', pos(), 1.6, pos(), -2.5, 0.2, 0, 150, 0, 60, 0, 9999, 2, 0, 0, 'rail', 1, 0, 1, 'Beta'],
    ],
    tw: [[1, 0.5, -0.1, 0, 1, 0, 14, 3302, 400, 525.5, 0], [2, 3.1, 0, 1, 0, 0, 0, 0, 0, 420, 1]],
    tl: [[5, 1.25, 0.03, -4]],
    or: [],
    sv: { event: 'swarm', left: 12.5, marks: [{ v: [1, 2, 3] }] },
    boss: 0,
    cp: [0, 0, 1, 31],
    of: [['a', 'b', 'c'], 'p1', 22],
    ups: 4,
    nd: 0,
    mv: { open: true, votes: { p1: 'r0n2' }, left: 40 },
    ht: 0.5,
    me: full
      ? { seq: 77, run: { su: 10, ss: 0, cu: 5, cs: 0, k: 40, d: 312 }, ult: 0.375, inv: { loadout: { weapon: 'a.1' }, items: [{ uid: 'a.1', rarity: 'rare' }], cargo: 1, cap: 20 }, st: { hull: 150 } }
      : { seq: 78, run: { su: 11 }, ult: 0.4 },
  };
}

describe('frame codec: events', () => {
  it('every replicated event tag round-trips exactly', () => {
    for (const [tag, ev] of Object.entries(SAMPLES)) {
      const back = viaServer({ t: 'ev', e: [ev] });
      expect(back, tag).toEqual({ t: 'ev', e: [ev] });
      expect(parseEvent((back as { e: unknown[] }).e[0]), tag).not.toBeNull();
    }
  });

  it('keeps nulls, optional trailing fields and nested vectors / colours', () => {
    const cases: unknown[][] = [
      ['s', 'hit'],
      ['s', 'hit', null, null],
      ['s', 'hit', { volume: 0.4, pitch: 1.2, rate: 2 }, null],
      ['vote', 2],
      ['shot', 'p1', 'swarm', V, 12],
      ['vote', 0, 0],
      ['offer', ['x'], null, '', 30],
      ['es', 9, 'walker', ['armored', 'volatile'], 'hvt', 3, 1200.5, 40, -12.25, 33.5, 1.5708, 2, 'east'],
      ['h', 3, 1, null],
      ['f', 'explode', [{ v: V }, { scale: 1.5, color: { c: [1, 0.4, 0.1] }, style: 'heavy', debris: true, list: [1, 'two', null] }]],
      ['t', 'marker', 4, [{ v: V }, 2.2, { follow: null }]],
    ];
    for (const ev of cases) expect(viaServer({ t: 'ev', e: [ev] }), String(ev[0])).toEqual({ t: 'ev', e: [ev] });
  });

  it('drops values JSON would drop (undefined fields, functions) and nulls non-finite numbers', () => {
    const back = viaServer({ t: 'ev', e: [['u', 'alert', { text: 'x', gone: undefined, n: Infinity, list: [undefined, NaN] }]] });
    expect(back).toEqual(JSON.parse(JSON.stringify({ t: 'ev', e: [['u', 'alert', { text: 'x', n: Infinity, list: [undefined, NaN] }]] })));
  });
});

describe('frame codec: client messages', () => {
  it('every client message and act variant round-trips and still validates', () => {
    for (const m of CLIENT) {
      const back = viaClient(m);
      expect(back, `${m.t}${'a' in m ? `:${m.a}` : ''}`).toEqual(m);
      expect(parseClientMsg(back), m.t).not.toBeNull();
    }
  });

  it('unreadable bytes decode to null and unknown enums fail validation', () => {
    expect(decodeClient(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeNull();
    // An act with an unset slot enum (as a forged frame would carry).
    const forged = decodeClient(encodeClient({ t: 'act', id: 1, a: 'swap', slot: 'weapon' }).map((b, i, a) => (i === a.length - 1 ? 0 : b)));
    expect(parseClientMsg(forged)).toBeNull();
  });
});

describe('frame codec: server messages', () => {
  const SERVER: ServerMsg[] = [
    { t: 'welcome', v: PROTOCOL_VERSION, playerId: 'p1', name: 'Alpha' },
    { t: 'error', code: 'version', msg: 'Reload the page.' },
    { t: 'lobby', lobby: null },
    {
      t: 'lobby',
      lobby: { code: 'ABCDE', hostId: 'p1', tier: 2, mode: 'survival', node: 'r0n1', maxTier: 3, capacity: 4, state: 'running', wave: 7, players: [{ id: 'p1', name: 'Alpha', ready: true, connected: true, host: true, weapon: 'Repeater', rarity: 'rare', level: 12 }] },
    },
    { t: 'lobby', lobby: { code: 'ABCDE', hostId: 'p1', tier: 1, mode: 'defense', node: null, maxTier: 1, capacity: 4, state: 'lobby', wave: 0, players: [] } },
    { t: 'presence', players: [{ id: 'p2', name: 'Beta', p: [1, 2, 3], yaw: 0.5 }] },
    { t: 'hostHq', owner: 'p1', base: { structure: {} } },
    {
      t: 'runStart',
      run: { runId: 'run-1', tier: 2, seed: -1734567890, arena: 123456789, you: 'p1', players: [{ id: 'p1', name: 'Alpha', slot: 0 }], loadout: { weapon: null }, towerTech: ['core:thermal'], milestones: [], rejoin: false, mode: 'survival', node: { id: 'r0n0', map: -99, path: ['r0n0'], cleared: 0, acts: 0, carry: { wave: 0 } } },
    },
    { t: 'runStart', run: { runId: 'run-2', tier: 1, seed: 5, arena: 0, you: 'p1', players: [], loadout: {}, towerTech: [], milestones: ['m'], rejoin: true, node: null } },
    { t: 'actResult', id: 9, ok: false, reason: 'Towers are offline in survival' },
    { t: 'runEnd', result: { outcome: 'returned' } },
    { t: 'pong', c: 1.5, s: 1700000000000 },
  ];

  it('every server message round-trips exactly', () => {
    for (const m of SERVER) expect(viaServer(m), m.t).toEqual(m);
  });

  it('snapshots (full and delta) round-trip exactly', () => {
    for (const full of [true, false]) {
      const s = snapshot(full ? 1 : 2, full);
      expect(viaServer({ t: 'snap', s }), full ? 'full' : 'delta').toEqual({ t: 'snap', s });
    }
  });

  it('a snapshot frame is smaller than its JSON text', () => {
    // Measured: ~33% smaller for 40 enemies with a quarter carrying AI deltas (rows alone ~43%);
    // per-client delta compression (architecture step 7) is where the big saving comes from.
    const s = snapshot(3, false);
    const json = JSON.stringify({ t: 'snap', s }).length;
    const bin = encodeServer({ t: 'snap', s }).length;
    expect(bin).toBeLessThan(json * 0.7);
  });
});
