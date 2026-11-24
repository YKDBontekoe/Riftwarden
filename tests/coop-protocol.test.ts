import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { normalizeCode, parseClientMsg, PROTOCOL_VERSION, RateLimiter } from '@riftwarden/protocol/protocol';
import { opError, runOp } from '@riftwarden/rules/progression/ops';
import { createDefaultSave } from '@riftwarden/rules/progression/save';
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

describe('co-op protocol', () => {
  it('every action survives the act envelope (no field collides with the request id)', () => {
    const acts = [
      { a: 'upgrade', pick: 'w_vent' },
      { a: 'modify', tower: 3, what: 'weapon', part: 'arc_coil' },
      { a: 'collect', pickup: 4 },
      { a: 'equip', uid: 'x.1', slot: 'weapon' },
      { a: 'vote', home: true },
    ];
    for (const a of acts) {
      const m = parseClientMsg({ t: 'act', id: 7, ...a }) as { id: number } | null;
      expect(m, a.a).not.toBeNull();
      expect(m!.id).toBe(7);
    }
  });
  it('validates message shapes and rejects malformed input', () => {
    expect(parseClientMsg({ t: 'hello', v: PROTOCOL_VERSION })).not.toBeNull();
    expect(parseClientMsg({ t: 'hello', v: 'thirteen' })).toBeNull();
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

describe('named profile operations', () => {
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
