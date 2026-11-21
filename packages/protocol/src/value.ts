// Conversions between plain JSON-like data and the protobuf `Value` / `Doc` types.
// `Value` keeps vectors and colours typed: the simulation's argument encoding (`wire.enc`) tags them as
// {v: [x, y, z]} / {c: [r, g, b]}, which become Vec3 / Color here and are tagged the same way again on decode,
// so the replica's `dec` sees exactly what it saw with JSON frames.
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { type Doc, DocSchema, type Value, type ValueMap, ValueSchema } from './gen/riftwarden/v1/common_pb';

export type ValueInit = MessageInitShape<typeof ValueSchema>;

const isTriple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');

function only(o: Record<string, unknown>, key: string): boolean {
  const keys = Object.keys(o);
  return keys.length === 1 && keys[0] === key;
}

/** JSON-like data -> Value init. Mirrors JSON semantics: non-finite numbers and undefined become null. */
export function toValueInit(v: unknown): ValueInit {
  if (v === null || v === undefined) return { kind: { case: 'null', value: true } };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { kind: { case: 'null', value: true } };
    return Number.isInteger(v) && Math.abs(v) <= 0x7fffffff && !Object.is(v, -0) ? { kind: { case: 'int', value: v } } : { kind: { case: 'num', value: v } };
  }
  if (typeof v === 'string') return { kind: { case: 'str', value: v } };
  if (typeof v === 'boolean') return { kind: { case: 'flag', value: v } };
  if (Array.isArray(v)) return { kind: { case: 'list', value: { items: v.map(toValueInit) } } };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (only(o, 'v') && isTriple(o.v)) return { kind: { case: 'vec', value: { x: o.v[0], y: o.v[1], z: o.v[2] } } };
    if (only(o, 'c') && isTriple(o.c)) return { kind: { case: 'color', value: { r: o.c[0], g: o.c[1], b: o.c[2] } } };
    const fields: Record<string, ValueInit> = {};
    for (const [k, x] of Object.entries(o)) if (x !== undefined && typeof x !== 'function') fields[k] = toValueInit(x);
    return { kind: { case: 'map', value: { fields } } };
  }
  // Functions and symbols do not travel (same as JSON).
  return { kind: { case: 'null', value: true } };
}

/** Value -> JSON-like data (vectors / colours tagged as {v} / {c}). An unset Value decodes to undefined. */
export function fromValue(v: Value | undefined): unknown {
  if (!v) return undefined;
  const k = v.kind;
  switch (k.case) {
    case 'null':
      return null;
    case 'num':
    case 'int':
    case 'str':
    case 'flag':
      return k.value;
    case 'vec':
      return { v: [k.value.x, k.value.y, k.value.z] };
    case 'color':
      return { c: [k.value.r, k.value.g, k.value.b] };
    case 'list':
      return k.value.items.map(fromValue);
    case 'map':
      return fromMap(k.value);
    default:
      return undefined;
  }
}

export function fromMap(m: ValueMap | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (m) for (const [key, x] of Object.entries(m.fields)) out[key] = fromValue(x);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A rules-owned document as JSON bytes. */
export function toDoc(v: unknown): { json: Uint8Array } {
  return { json: encoder.encode(JSON.stringify(v ?? null)) };
}

export function fromDoc(d: Doc | undefined): unknown {
  if (!d || d.json.length === 0) return null;
  return JSON.parse(decoder.decode(d.json)) as unknown;
}

export { create, DocSchema };
