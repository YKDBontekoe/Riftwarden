// HUD store structural sharing: equal plain values keep their reference (no re-render), real changes notify.
import { describe, expect, it } from 'vitest';
import { Store } from '@riftwarden/game/ui/store';

describe('Store structural sharing', () => {
  it('keeps the previous reference for deep-equal plain data and skips the notify', () => {
    const s = new Store<{ m5: { towers: number; buffs: { name: string; t: number }[] } | null; wave: number }>({ m5: null, wave: 1 });
    let calls = 0;
    s.subscribe(() => calls++);
    s.set({ m5: { towers: 2, buffs: [{ name: 'a', t: 1 }] } });
    const first = s.get().m5;
    expect(calls).toBe(1);
    s.set({ m5: { towers: 2, buffs: [{ name: 'a', t: 1 }] } });
    expect(calls).toBe(1);
    expect(s.get().m5).toBe(first);
    // A real change in a nested value notifies and replaces the object.
    s.set({ m5: { towers: 2, buffs: [{ name: 'a', t: 2 }] }, wave: 1 });
    expect(calls).toBe(2);
    expect(s.get().m5).not.toBe(first);
    // Mixed patch: unchanged keys keep identity, changed keys update.
    const m5 = s.get().m5;
    s.set({ m5: { towers: 2, buffs: [{ name: 'a', t: 2 }] }, wave: 2 });
    expect(calls).toBe(3);
    expect(s.get().m5).toBe(m5);
    expect(s.get().wave).toBe(2);
  });

  it('treats non-plain values (Map, class instances) and shape changes as changes', () => {
    class Box {
      constructor(readonly v: number) {}
    }
    const s = new Store<{ x: unknown }>({ x: null });
    let calls = 0;
    s.subscribe(() => calls++);
    s.set({ x: new Map([[1, 2]]) });
    s.set({ x: new Map([[1, 2]]) });
    s.set({ x: new Box(1) });
    s.set({ x: new Box(1) });
    s.set({ x: [1, 2] });
    s.set({ x: [1, 2, 3] });
    s.set({ x: { a: 1 } });
    s.set({ x: { a: 1, b: undefined } });
    s.set({ x: Number.NaN });
    s.set({ x: Number.NaN });
    expect(calls).toBe(9);
  });
});
