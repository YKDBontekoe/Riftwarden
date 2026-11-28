// Loading tips name the player's own keys: `{action}` tokens follow the bindings.
import { describe, expect, it } from 'vitest';
import { fillKeys, pickTip, TIPS } from '../apps/client/src/ui/loadingTips';
import { ACTIONS, DEFAULT_SETTINGS } from '@riftwarden/game/core/settings';

describe('loading tips', () => {
  it('fills tokens from the bindings', () => {
    expect(fillKeys('Call a wave early with {wave}.', DEFAULT_SETTINGS.keys)).toBe('Call a wave early with G.');
    expect(fillKeys('Call a wave early with {wave}.', { ...DEFAULT_SETTINGS.keys, wave: 'F5' })).toBe('Call a wave early with F5.');
    expect(fillKeys('Unknown {nothing} stays.', DEFAULT_SETTINGS.keys)).toBe('Unknown {nothing} stays.');
  });
  it('every token in a tip is a real action, and no tip is left with a token', () => {
    const ids = new Set(ACTIONS.map((a) => a.id));
    for (const list of Object.values(TIPS)) for (const t of list) for (const m of t.matchAll(/\{([a-z]+)\}/g)) expect(ids.has(m[1])).toBe(true);
    for (let i = 0; i < TIPS.arena.length; i++) expect(pickTip('arena', i, DEFAULT_SETTINGS.keys)).not.toMatch(/\{[a-z]+\}/);
  });
});
