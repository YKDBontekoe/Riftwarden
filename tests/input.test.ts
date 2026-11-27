import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from '@riftwarden/game/core/Input';

type KeyEvent = { code?: string; repeat?: boolean; preventDefault?: () => void };

/** Minimal DOM stand-in: Input only uses these globals in its constructor/lock path. */
function fakeDom() {
  const canvas = { requestPointerLock: vi.fn(async () => {}) } as unknown as HTMLCanvasElement;
  const winListeners = new Map<string, ((e: KeyEvent) => void)[]>();
  const docListeners = new Map<string, (() => void)[]>();
  const doc = {
    pointerLockElement: null as HTMLCanvasElement | null,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      const list = docListeners.get(type) ?? [];
      list.push(fn);
      docListeners.set(type, list);
    }),
    exitPointerLock: vi.fn(),
  };
  const win = {
    addEventListener: vi.fn((type: string, fn: (e: KeyEvent) => void) => {
      const list = winListeners.get(type) ?? [];
      list.push(fn);
      winListeners.set(type, list);
    }),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  const fire = (type: string, e: KeyEvent = {}) => winListeners.get(type)?.forEach((fn) => fn(e));
  const fireDoc = (type: string) => docListeners.get(type)?.forEach((fn) => fn());
  return { canvas, doc, win, fire, fireDoc };
}

afterEach(() => vi.unstubAllGlobals());

describe('Input pointer-lock capture', () => {
  it('uses native capture for look, and releases it on Escape', async () => {
    const { canvas, fire } = fakeDom();
    let move: (dx: number, dy: number) => void = () => {};
    const stop = vi.fn();
    const input = new Input(canvas);
    input.nativeMouse = { start: async (onMove) => { move = onMove; return true; }, stop };
    const onLockChange = vi.fn();
    input.onLockChange = onLockChange;
    await input.requestLock();
    expect(input.captured).toBe(true);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    move(4, -3);
    expect([input.mouseDx, input.mouseDy]).toEqual([4, -3]);
    fire('keydown', { code: 'KeyW' });
    expect(input.isDown('KeyW')).toBe(true);
    fire('keydown', { code: 'Escape', preventDefault: vi.fn() });
    expect(stop).toHaveBeenCalledOnce();
    expect(input.captured).toBe(false);
    expect(input.isDown('KeyW')).toBe(false);
    expect(onLockChange).toHaveBeenCalledExactlyOnceWith(false);
    move(5, 5);
    expect([input.mouseDx, input.mouseDy]).toEqual([0, 0]);
  });

  it('releases native capture on focus loss and ignores a late acquisition', async () => {
    const { canvas, fire } = fakeDom();
    let finish!: (value: boolean) => void;
    const stop = vi.fn();
    const input = new Input(canvas);
    input.nativeMouse = { start: () => new Promise((resolve) => { finish = resolve; }), stop };
    const attempt = input.requestLock();
    fire('blur');
    finish(true);
    await attempt;
    expect(input.captured).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('pauses if native capture is lost', async () => {
    const { canvas } = fakeDom();
    let lost = () => {};
    const stop = vi.fn();
    const input = new Input(canvas);
    input.nativeMouse = { start: async (_move, onLost) => { lost = onLost; return true; }, stop };
    input.onLockChange = vi.fn();
    await input.requestLock();
    lost();
    expect(input.captured).toBe(false);
    expect(input.onLockChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('releases active native capture exactly once on window blur', async () => {
    const { canvas, fire } = fakeDom();
    const input = new Input(canvas);
    const stop = vi.fn();
    input.nativeMouse = { start: async () => true, stop };
    input.onLockChange = vi.fn();
    await input.requestLock();
    fire('blur');
    expect(input.captured).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(input.onLockChange).toHaveBeenCalledExactlyOnceWith(false);
  });
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

  it('waits out the Escape cooldown before the first lock request', async () => {
    const { canvas, doc, fireDoc } = fakeDom();
    const input = new Input(canvas);
    // Default-gesture unlock: pointerLockElement is not our canvas.
    doc.pointerLockElement = {} as HTMLCanvasElement;
    fireDoc('pointerlockchange');
    let requestedAt = 0;
    canvas.requestPointerLock = vi.fn(async () => {
      requestedAt = Date.now();
      doc.pointerLockElement = canvas;
    });
    const started = Date.now();
    await input.requestLock();
    expect(input.captured).toBe(true);
    expect(requestedAt - started).toBeGreaterThanOrEqual(1100);
  });

  it('does not wait after a programmatic release', async () => {
    const { canvas, doc, fireDoc } = fakeDom();
    const input = new Input(canvas);
    doc.pointerLockElement = canvas;
    input.releaseLock();
    fireDoc('pointerlockchange');
    let requestedAt = 0;
    canvas.requestPointerLock = vi.fn(async () => {
      requestedAt = Date.now();
      doc.pointerLockElement = canvas;
    });
    const started = Date.now();
    await input.requestLock();
    expect(input.captured).toBe(true);
    expect(requestedAt - started).toBeLessThan(300);
  });

  it('releases via exitPointerLock on Escape while locked', () => {
    const { doc, fire } = fakeDom();
    const input = new Input({} as HTMLCanvasElement);
    input.locked = true;
    doc.pointerLockElement = {} as HTMLCanvasElement;
    const preventDefault = vi.fn();
    fire('keydown', { code: 'Escape', repeat: false, preventDefault });
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape when not captured (e.g. the pause menu handles it)', () => {
    const { doc, fire } = fakeDom();
    new Input({} as HTMLCanvasElement);
    const preventDefault = vi.fn();
    fire('keydown', { code: 'Escape', repeat: false, preventDefault });
    expect(doc.exitPointerLock).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('consumes a build click completely and clears captured input on blur', () => {
    const { canvas, fire } = fakeDom();
    const input = new Input(canvas);
    input.forceCapture = true;
    const onLockChange = vi.fn();
    input.onLockChange = onLockChange;
    input.simulateMouse(0, true);
    input.consumeMouse(0);
    expect(input.mouse(0) || input.mousePressed(0)).toBe(false);
    input.simulateMouse(0, true);
    input.simulateKey('KeyW', true);
    fire('blur');
    expect(input.mouse(0) || input.isDown('KeyW')).toBe(false);
    expect(onLockChange).toHaveBeenCalledWith(false);
  });
});
