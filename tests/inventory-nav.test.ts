// Inventory list keyboard navigation: arrows step, PageUp/PageDown jump a page, Home/End reach the ends.
import { describe, expect, it } from 'vitest';
import { navIndex } from '../apps/client/src/ui/inventory/InventoryView';

describe('inventory keyboard navigation', () => {
  it('steps and clamps', () => {
    expect(navIndex('ArrowDown', 0, 5)).toBe(1);
    expect(navIndex('ArrowUp', 0, 5)).toBe(0);
    expect(navIndex('ArrowDown', 4, 5)).toBe(4);
    expect(navIndex('ArrowDown', -1, 5)).toBe(1);
  });
  it('jumps by a page and to the ends', () => {
    expect(navIndex('PageDown', 1, 30)).toBe(9);
    expect(navIndex('PageUp', 3, 30)).toBe(0);
    expect(navIndex('Home', 12, 30)).toBe(0);
    expect(navIndex('End', 2, 30)).toBe(29);
  });
  it('ignores other keys and empty lists', () => {
    expect(navIndex('KeyA', 1, 5)).toBeNull();
    expect(navIndex('ArrowDown', 0, 0)).toBeNull();
  });
});
