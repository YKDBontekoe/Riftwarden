import { describe, expect, it } from 'vitest';
import { nextStep, TUTORIAL } from '../src/progression/tutorial';
import { runOp } from '../src/progression/ops';
import { createDefaultSave } from '../src/progression/save';

describe('onboarding tutorial', () => {
  it('tutorial steps run in order per location and stop once complete', () => {
    const d = createDefaultSave(1);
    expect(nextStep(d, 'hq', () => true)?.id).toBe('hq_look');
    expect(nextStep(d, 'arena', (id) => id !== 'move')?.id).toBe('dash');
    for (const s of TUTORIAL) expect(runOp(d, 'tutorialStep', [s.id]).ok).toBe(true);
    expect(d.tutorial.done).toContain('complete');
    expect(nextStep(d, 'arena', () => true)).toBeNull();
  });
});
