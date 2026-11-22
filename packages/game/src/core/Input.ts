/** Keyboard/mouse state with per-frame edge detection and pointer-lock management. */
export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  mouseDx = 0;
  mouseDy = 0;
  /** Wheel steps this frame (+1 per notch down, -1 up), only while captured. */
  wheel = 0;
  private wheelAcc = 0;
  private buttons = [false, false, false];
  private buttonsPressed = [false, false, false];
  locked = false;
  private skipMouse = 0;
  /** Test hook: treat input as captured without real pointer lock (headless automation). */
  forceCapture = false;
  /** M7: key rebinding (physical code -> code the game listens for). */
  remap = new Map<string, string>();
  /** M7: accept keys without pointer lock (construction mode uses a free cursor). */
  freeKeys = false;
  onLockChange: (locked: boolean) => void = () => {};
  private lockAttempt: Promise<void> | null = null;
  /** When the browser's default Escape unlock happened (programmatic exits don't have a cooldown). */
  private unlockedAt = 0;
  private programmaticUnlock = false;
  private static readonly ESCAPE_COOLDOWN_MS = 1250;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.captured) {
        // Release through the API, not the browser's default Escape gesture.
        // A default-gesture unlock makes the browser refuse requestPointerLock
        // for a short window, which is why RESUME needed extra clicks.
        e.preventDefault();
        this.releaseLock();
        return;
      }
      if (!this.captured && !this.freeKeys) return;
      if (['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const code = this.remap.get(e.code) ?? e.code;
      if (!this.down.has(code)) this.pressedSet.add(code);
      this.down.add(code);
    });
    window.addEventListener('keyup', (e) => {
      const code = this.remap.get(e.code) ?? e.code;
      if (this.down.delete(code)) this.releasedSet.add(code);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.captured) return;
      if (this.skipMouse > 0) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.captured || e.button > 2) return;
      this.buttons[e.button] = true;
      this.buttonsPressed[e.button] = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.buttons[e.button] = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        // Trackpads send many small deltas: accumulate to whole notches (~100 px each).
        this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        const steps = Math.trunc(this.wheelAcc / 90);
        if (steps !== 0) {
          this.wheel += Math.sign(steps);
          this.wheelAcc = 0;
        }
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.clear();
        this.unlockedAt = this.programmaticUnlock ? 0 : Date.now();
        this.programmaticUnlock = false;
      }
      this.skipMouse = 2; // some browsers report a large delta right after locking
      this.onLockChange(this.locked);
    });
    window.addEventListener('blur', () => this.clear());
  }

  get captured(): boolean {
    return this.locked || this.forceCapture;
  }

  async requestLock(): Promise<void> {
    if (this.forceCapture) return;
    // A second click while a retry sequence is running must join it, not start
    // a competing request (which would just extend the blocked window).
    if (this.lockAttempt) return this.lockAttempt;
    const attempt = this.acquireLock();
    this.lockAttempt = attempt;
    try {
      await attempt;
    } finally {
      if (this.lockAttempt === attempt) this.lockAttempt = null;
    }
  }

  private async acquireLock(): Promise<void> {
    if (this.isLockedNow()) {
      this.reflectLock();
      return;
    }
    // Chrome ignores Escape while locked, so it always unlocks with the default
    // gesture and then refuses a fresh lock for a short window. Wait that out
    // inside the click's transient activation so one RESUME click is enough.
    const remaining = Input.ESCAPE_COOLDOWN_MS - (Date.now() - this.unlockedAt);
    if (remaining > 0) await new Promise<void>((r) => setTimeout(r, remaining + 50));
    // Sparse retries cover browsers with a longer block; still inside the
    // click's ~5 s activation window.
    const gaps = [0, 250, 500, 800];
    for (const gap of gaps) {
      if (gap > 0) await new Promise<void>((r) => setTimeout(r, gap));
      try {
        await this.canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
      } catch {
        try {
          await this.canvas.requestPointerLock();
        } catch {
          continue;
        }
      }
      break;
    }
    this.reflectLock();
  }

  /** pointerlockchange is delivered in a later task than the request promise. */
  private reflectLock(): void {
    if (this.isLockedNow()) {
      this.locked = true;
      this.skipMouse = 2;
    }
  }

  /** Direct pointer-lock query (the change event can lag a request's promise). */
  isLockedNow(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  releaseLock(): void {
    if (document.pointerLockElement) {
      this.programmaticUnlock = true;
      document.exitPointerLock();
    }
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
  pressed(code: string): boolean {
    return this.pressedSet.has(code);
  }
  released(code: string): boolean {
    return this.releasedSet.has(code);
  }
  mouse(button: number): boolean {
    return this.buttons[button];
  }
  mousePressed(button: number): boolean {
    return this.buttonsPressed[button];
  }

  /** Test/automation helpers. */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressedSet.add(code);
      this.down.add(code);
    } else if (this.down.delete(code)) this.releasedSet.add(code);
  }
  simulateWheel(steps: number): void {
    this.wheel += steps;
  }
  simulateMouse(button: number, isDown: boolean): void {
    this.buttons[button] = isDown;
    if (isDown) this.buttonsPressed[button] = true;
  }

  endFrame(): void {
    if (this.skipMouse > 0) this.skipMouse--;
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.buttonsPressed[0] = this.buttonsPressed[1] = this.buttonsPressed[2] = false;
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheel = 0;
  }

  clear(): void {
    this.down.clear();
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.endFrame();
  }
}
