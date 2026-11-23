import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_TAGS, parseEvent } from '@riftwarden/protocol/events';
import { mulberry32 } from '@riftwarden/rules/combat/damage';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
import { SAMPLES, V } from './fixtures/events';

describe('replicated events', () => {
  it('has a valid sample for every tag (and no stray samples)', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...EVENT_TAGS].sort());
    for (const [tag, ev] of Object.entries(SAMPLES)) expect(parseEvent(ev), tag).toEqual(ev);
  });

  it('every tag the server emits is part of the union', () => {
    const emitted = new Set<string>();
    for (const f of ['packages/game/src/net/recorder.ts', 'packages/game/src/net/ServerGame.ts', 'apps/worker/src/sim/coopSim.ts']) {
      for (const m of read(f).matchAll(/(?:push|pushExcept)\(\s*\[\s*'([A-Za-z+-]+)'/g)) emitted.add(m[1]);
    }
    expect(emitted.size).toBeGreaterThan(15);
    expect([...emitted].filter((t) => !EVENT_TAGS.includes(t as never))).toEqual([]);
  });

  it('every tag in the union has a handler in ClientGame', () => {
    const src = read('packages/game/src/net/ClientGame.ts');
    const handled = new Set([...src.matchAll(/case '([A-Za-z+-]+)'/g)].map((m) => m[1]));
    expect(EVENT_TAGS.filter((t) => !handled.has(t))).toEqual([]);
  });

  it('rejects unknown tags, non-arrays and non-string tags', () => {
    for (const bad of [null, undefined, 5, 'f', {}, [], [1], ['nope', 1], [null, 1]]) expect(parseEvent(bad), JSON.stringify(bad)).toBeNull();
  });

  it('rejects missing required fields and wrong field types', () => {
    expect(parseEvent(['mv'])).toBeNull();
    expect(parseEvent(['mv', [1, 2]])).toBeNull();
    expect(parseEvent(['mv', [1, 2, 'x']])).toBeNull();
    expect(parseEvent(['mv', [1, 2, NaN]])).toBeNull();
    expect(parseEvent(['mv', [1, 2, Infinity]])).toBeNull();
    expect(parseEvent(['ek', '7', 1])).toBeNull();
    expect(parseEvent(['ek', 7, 2])).toBeNull();
    expect(parseEvent(['es', 7, 'walker', 'not-an-array', null, 1, 1, 1, 1, 1, 1, 1, 'north'])).toBeNull();
    expect(parseEvent(['T+', 1, 'cfg', V, 0, '', ''])).toBeNull();
    expect(parseEvent(['offer', [1, 2], null, 'x', 30])).toBeNull();
  });

  it('tolerates optional trailing fields and extra fields for forward compatibility', () => {
    expect(parseEvent(['vote', 1])).not.toBeNull();
    expect(parseEvent(['vote', 0, 1])).not.toBeNull();
    expect(parseEvent(['offer', ['a'], null, 'Alpha'])).not.toBeNull();
    expect(parseEvent(['mv', V, 'extra', { x: 1 }])).not.toBeNull();
    expect(parseEvent(['def', 'anything'])).not.toBeNull();
  });

  it('accepts both legacy swarm shots and shots with a validated seeker target', () => {
    const legacy = ['shot', 'p1', 'swarm', V];
    const tracked = [...legacy, 12];
    expect(parseEvent(legacy)).toEqual(legacy);
    expect(parseEvent(tracked)).toEqual(tracked);
    expect(parseEvent([...legacy, '12'])).toBeNull();
  });

  it('never throws on arbitrary garbage (fuzz)', () => {
    const rnd = mulberry32(1234);
    const atoms: unknown[] = [0, 1, -1, 1e9, NaN, Infinity, '', 'x', 'f', 'es', 'T+', null, undefined, true, [], {}, [1, 2, 3], { v: [1, 2, 3] }];
    let accepted = 0;
    for (let n = 0; n < 5000; n++) {
      const len = Math.floor(rnd() * 14);
      const raw = Array.from({ length: len }, () => atoms[Math.floor(rnd() * atoms.length)]);
      if (rnd() < 0.6 && len) raw[0] = EVENT_TAGS[Math.floor(rnd() * EVENT_TAGS.length)];
      expect(() => parseEvent(raw)).not.toThrow();
      if (parseEvent(raw)) accepted++;
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(5000);
  });
});
