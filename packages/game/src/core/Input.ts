export interface NativeMouseCapture {
  start(move: (dx: number, dy: number) => void, lost: () => void): Promise<boolean>;
  stop(): void;
}

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
  /** Touch controls are on: input counts as captured without pointer lock (the overlay feeds keys, buttons, look). */
  touch = false;
  /** Virtual stick (touch): strafe / forward -1..1; zero when idle. */
  stickX = 0;
  stickZ = 0;
  /** Stick pushed past its ring (sprint). */
  stickSprint = false;
  /** Called when a gesture asks for control in touch mode (fullscreen + orientation lock live there). */
  onEngage: () => void = () => {};
  /** Taps also fire compatibility mouse events: ignore those right after a touch. */
  private touchAt = -1e9;
  private lockAttempt: Promise<void> | null = null;
  nativeMouse: NativeMouseCapture | null = null;
  private nativeLocked = false;
  private captureGeneration = 0;
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
      if (!this.captured || this.nativeLocked || performance.now() - this.touchAt < 900) return;
      if (this.skipMouse > 0) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
    window.addEventListener('touchstart', () => (this.touchAt = performance.now()), { passive: true, capture: true });
    document.addEventListener('mousedown', (e) => {
      if (!this.captured || e.button > 2 || performance.now() - this.touchAt < 900) return;
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
        if (!this.locked && !this.nativeLocked) return;
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
    window.addEventListener('blur', () => {
      const wasCaptured = this.captured;
      const wasNative = this.nativeLocked;
      if (this.nativeMouse) this.releaseLock();
      this.clear();
      if (wasCaptured && !wasNative) this.onLockChange(false);
    });
  }

  get captured(): boolean {
    return this.locked || this.nativeLocked || this.forceCapture || this.touch;
  }

  async requestLock(): Promise<void> {
    if (this.touch) {
      this.onEngage();
      return;
    }
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
    if (this.nativeMouse) {
      if (this.nativeLocked) return;
      const generation = this.captureGeneration;
      const mouse = this.nativeMouse;
      const acquired = await mouse.start(
        (dx, dy) => { if (this.nativeLocked) this.look(dx, dy); },
        () => { if (this.nativeLocked) this.releaseLock(); },
      );
      if (generation !== this.captureGeneration) {
        mouse.stop();
      } else if (acquired) {
        this.nativeLocked = true;
      }
      return;
    }
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
    this.captureGeneration++;
    if (this.nativeLocked) {
      this.nativeLocked = false;
      this.nativeMouse?.stop();
      this.clear();
      this.onLockChange(false);
    }
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

  /** Consume a button when another mode used the click, including its held state. */
  consumeMouse(button: number): void {
    this.buttons[button] = this.buttonsPressed[button] = false;
  }

  /** Touch look: mouse-equivalent pixels, consumed by the next frame. */
  look(dx: number, dy: number): void {
    if (Number.isFinite(dx)) this.mouseDx += dx;
    if (Number.isFinite(dy)) this.mouseDy += dy;
  }

  /** Touch stick (see core/touch.ts stickVector). */
  setStick(x: number, z: number, sprint: boolean): void {
    this.stickX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.stickZ = Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0;
    this.stickSprint = sprint;
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
    this.wheelAcc = 0;
    this.setStick(0, 0, false);
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.endFrame();
  }
}
