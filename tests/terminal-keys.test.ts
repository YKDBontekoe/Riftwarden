// Terminal item grids: arrow keys step tiles (←/→ one, ↑/↓ a row), clamped to the grid.
import { describe, expect, it } from 'vitest';
import { gridStep } from '../apps/client/src/ui/shell';

describe('gridStep', () => {
  it('steps by one and by a row', () => {
    expect(gridStep(5, 20, 4, 'ArrowRight')).toBe(6);
    expect(gridStep(5, 20, 4, 'ArrowLeft')).toBe(4);
    expect(gridStep(5, 20, 4, 'ArrowDown')).toBe(9);
    expect(gridStep(5, 20, 4, 'ArrowUp')).toBe(1);
  });
  it('clamps at the edges', () => {
    expect(gridStep(1, 20, 4, 'ArrowUp')).toBe(0);
    expect(gridStep(18, 20, 4, 'ArrowDown')).toBe(19);
    expect(gridStep(0, 20, 4, 'ArrowLeft')).toBe(0);
  });
  it('starts at the first tile with nothing selected, and ignores other keys', () => {
    expect(gridStep(-1, 20, 4, 'ArrowDown')).toBe(0);
    expect(gridStep(3, 20, 4, 'KeyW')).toBeNull();
    expect(gridStep(0, 0, 4, 'ArrowDown')).toBeNull();
    expect(gridStep(2, 5, 0, 'ArrowDown')).toBe(3);
  });
});
