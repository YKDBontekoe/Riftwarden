import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/core/Input';

/** Minimal DOM stand-in: Input only uses these globals in its constructor/lock path. */
function fakeDom() {
  const canvas = { requestPointerLock: vi.fn(async () => {}) } as unknown as HTMLCanvasElement;
  const doc = {
    pointerLockElement: null as HTMLCanvasElement | null,
    addEventListener: vi.fn(),
    exitPointerLock: vi.fn(),
  };
  const win = { addEventListener: vi.fn() };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  return { canvas, doc, win };
}

afterEach(() => vi.unstubAllGlobals());

describe('Input pointer-lock capture', () => {
  it('is captured as soon as requestLock resolves, before pointerlockchange fires', async () => {
    const { canvas, doc } = fakeDom();
    // Browsers set pointerLockElement when the lock is granted, but deliver the
    // pointerlockchange event in a later task. Any caller that awaits requestLock
    // and then checks `captured` must not see a stale false.
    canvas.requestPointerLock = vi.fn(async () => {
      doc.pointerLockElement = canvas;
    });
    const input = new Input(canvas);
    expect(input.captured).toBe(false);
    let lockChanges = 0;
    input.onLockChange = () => lockChanges++;
    await input.requestLock();
    expect(input.isLockedNow()).toBe(true);
    expect(input.captured).toBe(true);
    expect(lockChanges).toBe(0); // the change event has not fired yet
  });

  it('stays uncaptured when the lock request is refused', async () => {
    const { canvas } = fakeDom();
    canvas.requestPointerLock = vi.fn(async () => {
      throw new Error('user gesture required');
    });
    const input = new Input(canvas);
    await input.requestLock();
    expect(input.captured).toBe(false);
  });

  it('retries after Escape cooldown refusals so one resume click is enough', async () => {
    const { canvas, doc } = fakeDom();
    let calls = 0;
    canvas.requestPointerLock = vi.fn(async () => {
      calls++;
      if (calls <= 2) throw new Error('user exited pointer lock with Escape');
      doc.pointerLockElement = canvas;
    });
    const input = new Input(canvas);
    await input.requestLock();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(input.captured).toBe(true);
  });

  it('joins an in-flight retry instead of starting a competing one', async () => {
    const { canvas, doc } = fakeDom();
    let calls = 0;
    canvas.requestPointerLock = vi.fn(async () => {
      calls++;
      if (calls <= 2) throw new Error('cooldown');
      doc.pointerLockElement = canvas;
    });
    const input = new Input(canvas);
    const first = input.requestLock();
    const second = input.requestLock();
    await Promise.all([first, second]);
    expect(input.captured).toBe(true);
    expect(calls).toBeLessThanOrEqual(3);
  });
});
