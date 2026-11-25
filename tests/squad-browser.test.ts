import { describe, expect, it } from 'vitest';
import { parseSquads } from '../apps/client/src/ui/SquadBrowser';

describe('open-squad browser listing', () => {
  it('keeps well-formed rows and drops the rest', () => {
    const rows = parseSquads({
      rooms: [
        { code: 'ABCDE', host: 'Alpha', players: 2, capacity: 4, tier: 3, mode: 'survival' },
        { code: 7, host: 'Bad' },
        { code: 'FGHJK', host: 'Beta', players: 'x', tier: -2, mode: 'nonsense' },
      ],
    });
    expect(rows).toEqual([
      { code: 'ABCDE', host: 'Alpha', players: 2, capacity: 4, tier: 3, mode: 'survival' },
      { code: 'FGHJK', host: 'Beta', players: 0, capacity: 4, tier: 1, mode: 'defense' },
    ]);
  });

  it('treats a missing or malformed body as an empty list', () => {
    expect(parseSquads(null)).toEqual([]);
    expect(parseSquads({ rooms: 'no' })).toEqual([]);
  });
});
