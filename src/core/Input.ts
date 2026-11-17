/** Keyboard/mouse state with per-frame edge detection and pointer-lock management. */
export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  mouseDx = 0;
  mouseDy = 0;
  private buttons = [false, false, false];
  private buttonsPressed = [false, false, false];
  locked = false;
  private skipMouse = 0;
  /** Test hook: treat input as captured without real pointer lock (headless automation). */
  forceCapture = false;
  onLockChange: (locked: boolean) => void = () => {};
  private lockAttempt: Promise<void> | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.captured) return;
      if (['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (this.down.delete(e.code)) this.releasedSet.add(e.code);
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
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.clear();
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
    // Chrome refuses a fresh lock for a short window after the user left it
    // with Escape, even from a click gesture. Retry inside the click's
    // transient-activation window so one press of RESUME is enough.
    for (let i = 0; i < 8; i++) {
      if (i > 0) await new Promise<void>((r) => setTimeout(r, 200));
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
    if (document.pointerLockElement) document.exitPointerLock();
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
  }

  clear(): void {
    this.down.clear();
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.endFrame();
  }
}
