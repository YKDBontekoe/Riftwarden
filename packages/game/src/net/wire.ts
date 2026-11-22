import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Argument encoding for replicated presentation calls (effects, telegraphs, ordnance, sounds).
 * Vectors/colours become tagged arrays rounded to centimetres, functions are dropped (follow
 * callbacks are replaced by streamed positions), everything else must already be JSON data.
 */
const r2 = (v: number) => Math.round(v * 100) / 100;

export function enc(v: unknown): unknown {
  if (v instanceof Vector3) return { v: [r2(v.x), r2(v.y), r2(v.z)] };
  if (v instanceof Color3) return { c: [r2(v.r), r2(v.g), r2(v.b)] };
  if (typeof v === 'function') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') o[k] = enc(x);
    return o;
  }
  return v;
}

export function dec(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === 'v' && Array.isArray(o.v) && o.v.length === 3) return new Vector3(o.v[0] as number, o.v[1] as number, o.v[2] as number);
    if (keys.length === 1 && keys[0] === 'c' && Array.isArray(o.c) && o.c.length === 3) return new Color3(o.c[0] as number, o.c[1] as number, o.c[2] as number);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = dec(x);
    return out;
  }
  return v;
}

export const vec = (a: readonly number[]): Vector3 => new Vector3(a[0], a[1], a[2]);
export const arr = (v: Vector3): [number, number, number] => [r2(v.x), r2(v.y), r2(v.z)];
