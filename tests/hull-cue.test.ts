// Low-hull cue: one tone on entering the critical band, re-armed only after a real recovery.
import { describe, expect, it } from 'vitest';
import { hullCue } from '../apps/client/src/ui/hud/hullCue';

describe('hullCue', () => {
  it('plays once when the hull drops into the band', () => {
    let st = { armed: true, play: false };
    const plays: boolean[] = [];
    for (const f of [0.8, 0.3, 0.2, 0.26, 0.22, 0.1]) {
      st = hullCue(st.armed, f);
      plays.push(st.play);
    }
    expect(plays).toEqual([false, false, true, false, false, false]);
  });
  it('re-arms after recovering past 40%', () => {
    let st = hullCue(true, 0.2);
    st = hullCue(st.armed, 0.35);
    expect(st.armed).toBe(false);
    st = hullCue(st.armed, 0.45);
    expect(st.armed).toBe(true);
    expect(hullCue(st.armed, 0.1).play).toBe(true);
  });
  it('never cues for a destroyed drone', () => {
    expect(hullCue(true, 0).play).toBe(false);
  });
});
