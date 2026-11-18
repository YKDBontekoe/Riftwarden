/**
 * Minimal browser surface for running the real arena simulation (Babylon NullEngine + Havok)
 * inside Node. Only what the simulation touches: 2D canvases for procedural textures are
 * inert (the server never renders), audio is absent (Sfx stays silent without AudioContext).
 */
type AnyFn = (...a: unknown[]) => unknown;

function fakeContext2d(canvas: { width: number; height: number }): unknown {
  const img = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {
    canvas,
    getImageData: (_x: number, _y: number, w: number, h: number) => img(w, h),
    createImageData: (w: number | { width: number; height: number }, h?: number) => (typeof w === 'number' ? img(w, h ?? w) : img(w.width, w.height)),
    measureText: (s: string) => ({ width: String(s).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createConicGradient: () => grad,
    createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      return (() => undefined) as AnyFn;
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  });
}

function fakeCanvas(): unknown {
  const c: Record<string, unknown> = { width: 300, height: 150, style: {} };
  c.getContext = (kind: string) => (kind === '2d' ? (c.__ctx ??= fakeContext2d(c as never)) : null);
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  c.toDataURL = () => '';
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  return c;
}

const g = globalThis as Record<string, unknown>;
if (typeof g.document === 'undefined') {
  const noop = () => {};
  g.document = {
    createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas() : { style: {}, appendChild: noop, setAttribute: noop }),
    addEventListener: noop,
    removeEventListener: noop,
    body: { appendChild: noop },
    fonts: { ready: Promise.resolve() },
    pointerLockElement: null,
  };
  g.window = g;
  (g as { addEventListener: AnyFn }).addEventListener = noop;
  (g as { removeEventListener: AnyFn }).removeEventListener = noop;
  g.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext(kind: string) {
      return kind === '2d' ? fakeContext2d(this) : null;
    }
  };
  g.requestAnimationFrame = (f: (t: number) => void) => setTimeout(() => f(performance.now()), 16);
  g.cancelAnimationFrame = (h: number) => clearTimeout(h);
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
}
export {};
