// Loot feed rows: identical repeats merge into one row with a count, other events stack (newest five).
import { describe, expect, it } from 'vitest';
import { type FeedRow, pushFeed } from '../apps/client/src/ui/LootHud';
import type { LootEvent } from '@riftwarden/game/ui/store';

const ev = (kind: LootEvent['kind'], name: string, level = 5): LootEvent => ({ kind, name, rarity: 'rare', level, category: 'weapon', count: 1 });

describe('loot feed', () => {
  it('merges a repeat of the newest row', () => {
    let list: FeedRow[] = [];
    list = pushFeed(list, ev('full', 'Arc Rifle'), 1).list;
    const r = pushFeed(list, ev('full', 'Arc Rifle'), 2);
    expect(r.merged).toBe(1);
    expect(r.list).toHaveLength(1);
    expect(r.list[0]).toMatchObject({ id: 2, times: 2 });
  });
  it('does not merge different events or older rows', () => {
    let list: FeedRow[] = [];
    list = pushFeed(list, ev('drop', 'Arc Rifle'), 1).list;
    list = pushFeed(list, ev('pickup', 'Arc Rifle'), 2).list;
    list = pushFeed(list, ev('drop', 'Arc Rifle'), 3).list;
    list = pushFeed(list, ev('drop', 'Arc Rifle', 6), 4).list;
    expect(list.map((r) => r.times)).toEqual([1, 1, 1, 1]);
  });
  it('keeps the newest five', () => {
    let list: FeedRow[] = [];
    for (let i = 0; i < 8; i++) list = pushFeed(list, ev('drop', `Item ${i}`), i).list;
    expect(list.map((r) => r.name)).toEqual(['Item 3', 'Item 4', 'Item 5', 'Item 6', 'Item 7']);
  });
});
