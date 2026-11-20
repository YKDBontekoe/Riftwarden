// The replicated event tuples (server -> clients) as a typed union with a structural parser.
// Every tag the server emits (recorder.ts, ServerGame.ts, server/sim.ts) is listed here; ClientGame switches on the
// union exhaustively, so adding an event without handling it (or the reverse) is a compile error.
import type { TowerConfig } from '../towers/components';
import type { ItemInstance } from '../loot/types';
import type { EnemyKind } from '../data/defs';
import type { EliteModId } from '../survival/elites';
import type { EvolutionId } from '../survival/plan';

export type V3 = readonly [number, number, number];
/** Booleans travel as 0/1. */
export type Flag = 0 | 1;

export type ReplicatedEvent =
  // presentation (recorder.ts)
  | readonly ['f', string, unknown] // effect call, encoded args
  | readonly ['w', string, unknown] // weapon-fx call
  | readonly ['s', string, { volume?: number; pitch?: number } | null | undefined, V3 | null] // sound
  | readonly ['u', string, unknown] // HUD / UI event
  | readonly ['t', string, number, unknown] // telegraph op, server id, args
  | readonly ['o', string, number, unknown] // ordnance op, server id, args
  | readonly ['ev', EvolutionId, Flag] // arena evolution
  | readonly ['hz', number, number, number, 'frost' | 'slag', number] // M10 transient hazard patch (x, z, r, kind, life)
  // enemies
  | readonly ['es', number, EnemyKind, EliteModId[], string | null, number, number, number, number, number, number, number, string]
  | readonly ['ek', number, Flag]
  | readonly ['er', number]
  | readonly ['ed', number, Flag]
  | readonly ['el', number, number] // walker frame lost-part mask (limbs.ts bits)
  // towers
  | readonly ['T+', number, TowerConfig, V3, number, string, string]
  | readonly ['T-', number]
  | readonly ['Tc', number, TowerConfig, number]
  // deployables: kind, ground point, yaw, seconds, wall half-width / decoy radius / sentry tower id
  | readonly ['dp', 'wall' | 'decoy' | 'sentry', V3, number, number, number]
  // loot
  | readonly ['L+', number, ItemInstance, V3, V3, number]
  | readonly ['L-', number, Flag]
  // run flow
  | readonly ['up', string, string]
  | readonly ['offer', string[], string | null, string, number]
  | readonly ['vote', Flag, Flag?]
  | readonly ['bank', number, Flag, number, number, number, number]
  | readonly ['def']
  // personal / teammates
  | readonly ['h', number, Flag, V3 | null]
  | readonly ['k', V3, number]
  | readonly ['mv', V3]
  | readonly ['left', string, string]
  | readonly ['shot', string, string, V3];

export type EventTag = ReplicatedEvent[0];

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const flag = (v: unknown): v is Flag => v === 0 || v === 1;
const v3 = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every(num);
const obj = (v: unknown): v is object => !!v && typeof v === 'object';
const opt = <T>(f: (v: unknown) => v is T) => (v: unknown): v is T | null | undefined => v == null || f(v);
const arrOf = <T>(f: (v: unknown) => v is T) => (v: unknown): v is T[] => Array.isArray(v) && v.every(f);

type Check = (v: unknown) => boolean;
/** Per tag: the checks for the fields after the tag (extra trailing fields are tolerated for forward compatibility). */
const SHAPES: { [K in EventTag]: { fields: Check[]; optional?: number } } = {
  f: { fields: [str, () => true] },
  w: { fields: [str, () => true] },
  s: { fields: [str, opt(obj), opt(v3)], optional: 2 },
  u: { fields: [str, () => true] },
  t: { fields: [str, num, () => true] },
  o: { fields: [str, num, () => true] },
  ev: { fields: [str, flag] },
  hz: { fields: [num, num, num, (v: unknown) => v === 'frost' || v === 'slag', num] },
  es: { fields: [num, str, arrOf(str), opt(str), num, num, num, num, num, num, num, str] },
  ek: { fields: [num, flag] },
  er: { fields: [num] },
  ed: { fields: [num, flag] },
  el: { fields: [num, num] },
  'T+': { fields: [num, obj, v3, num, str, str] },
  'T-': { fields: [num] },
  Tc: { fields: [num, obj, num] },
  dp: { fields: [(v: unknown) => v === 'wall' || v === 'decoy' || v === 'sentry', v3, num, num, num] },
  'L+': { fields: [num, obj, v3, v3, num] },
  'L-': { fields: [num, flag] },
  up: { fields: [str, str] },
  offer: { fields: [arrOf(str), opt(str), str, num], optional: 1 },
  vote: { fields: [flag, flag], optional: 1 },
  bank: { fields: [num, flag, num, num, num, num] },
  def: { fields: [] },
  h: { fields: [num, flag, opt(v3)] },
  k: { fields: [v3, num] },
  mv: { fields: [v3] },
  left: { fields: [str, str] },
  shot: { fields: [str, str, v3] },
};

export const EVENT_TAGS = Object.keys(SHAPES) as EventTag[];

/** Validate a raw tuple from the wire; null when the tag is unknown or the fields are malformed. */
export function parseEvent(raw: unknown): ReplicatedEvent | null {
  if (!Array.isArray(raw) || !str(raw[0])) return null;
  const shape = (SHAPES as Record<string, { fields: Check[]; optional?: number } | undefined>)[raw[0]];
  if (!shape) return null;
  const need = shape.fields.length - (shape.optional ?? 0);
  if (raw.length - 1 < need) return null;
  for (let i = 0; i < shape.fields.length; i++) {
    if (i + 1 >= raw.length) {
      if (i < need) return null;
      continue;
    }
    if (!shape.fields[i](raw[i + 1])) return null;
  }
  return raw as unknown as ReplicatedEvent;
}
