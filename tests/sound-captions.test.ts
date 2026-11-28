// Sound captions: curated sounds only, direction from the pan, repeats refresh instead of stacking.
import { describe, expect, it } from 'vitest';
import { CAPTION_GAP_MS, captionFor, pushCaption } from '../apps/client/src/ui/hud/Captions';
import { sanitizeSettings } from '@riftwarden/game/core/settings';

describe('sound captions', () => {
  it('captions important sounds and skips frequent ones', () => {
    expect(captionFor('reactorHit', 0, 0)?.text).toBe('Reactor under attack');
    expect(captionFor('shoot', 0, 0)).toBeNull();
    expect(captionFor('hit', 0, 0)).toBeNull();
  });
  it('reads the direction from the stereo pan', () => {
    expect(captionFor('mortar', -0.8, 0)?.dir).toBe('left');
    expect(captionFor('mortar', 0.6, 0)?.dir).toBe('right');
    expect(captionFor('mortar', 0.1, 0)?.dir).toBeNull();
  });
  it('a repeat within the gap refreshes the line; at most four lines', () => {
    const a = captionFor('alarm', 0, 0)!;
    let l = pushCaption([], a);
    l = pushCaption(l, { ...a, at: CAPTION_GAP_MS - 1 });
    expect(l).toHaveLength(1);
    expect(l[0].at).toBe(CAPTION_GAP_MS - 1);
    for (const n of ['bossRoar', 'waveStart', 'explosion', 'slam'] as const) l = pushCaption(l, captionFor(n, 0, 10)!);
    expect(l.map((c) => c.text)).toEqual(['Boss roar', 'Wave incoming', 'Explosion', 'Ground slam']);
  });
  it('the setting defaults off', () => {
    expect(sanitizeSettings({}).captions).toBe(false);
    expect(sanitizeSettings({ captions: true }).captions).toBe(true);
  });
});
