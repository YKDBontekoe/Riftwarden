/** Pure animation helpers shared by weapons, enemies and HQ props (no engine imports). */

/** Damped spring; sub-stepped semi-implicit Euler so large dt (automation advances) stays stable. */
export class Spring {
  x = 0;
  v = 0;
  constructor(public k: number, public c: number) {}
  step(dt: number, target = 0): number {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-(this.x - target) * this.k - this.v * this.c) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v: number): void {
    this.v += v;
  }
  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}

/** Frame-rate independent exponential approach: x moves toward target with rate k (1/s). */
export function damp(x: number, target: number, k: number, dt: number): number {
  return target + (x - target) * Math.exp(-k * Math.max(0, dt));
}

export function smoothstep(p: number): number {
  const t = p < 0 ? 0 : p > 1 ? 1 : p;
  return t * t * (3 - 2 * t);
}

/** Fast attack, slower decay curve (peak ~0.5 near t = ln(a/b)/(a-b) ... normalised use only). */
export function impulse(t: number, a: number, b: number): number {
  return t <= 0 ? 0 : (1 - Math.exp(-t * a)) * Math.exp(-t * b);
}
