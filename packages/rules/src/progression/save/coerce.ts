import { THREAT_TIERS } from '../tiers';

export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
export const int = (v: unknown, fallback: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number => Math.floor(num(v, fallback, lo, hi));
export const str = (v: unknown, fallback: string, max = 64): string => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : fallback);
export const MAX_TIER = THREAT_TIERS.length;

