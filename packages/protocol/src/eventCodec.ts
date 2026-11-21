// Replicated event tuples (events.ts) <-> protobuf `Event` messages, field for field in tuple order.
// Flags travel as bools and come back as 0 / 1; nullable fields use unset messages / optional fields.
import type { MessageInitShape } from '@bufbuild/protobuf';
import type { Vec3 } from './gen/riftwarden/v1/common_pb';
import type { Event, EventSchema } from './gen/riftwarden/v1/events_pb';
import type { TowerConfig } from './gen/riftwarden/v1/coop_pb';
import type { ReplicatedEvent, V3 } from './events';
import { fromDoc, fromValue, toDoc, toValueInit } from './value';

type EventInit = MessageInitShape<typeof EventSchema>;
type Tuple = readonly unknown[];

const vec = (v: unknown) => {
  const a = v as V3;
  return { x: a[0], y: a[1], z: a[2] };
};
const unvec = (v: Vec3 | undefined): V3 | null => (v ? [v.x, v.y, v.z] : null);
const flag = (b: boolean | undefined): 0 | 1 => (b ? 1 : 0);
const cfgOut = (c: TowerConfig | undefined) => ({ base: c?.base ?? '', weapon: c?.weapon ?? '', core: c?.core ?? '', modifier: c?.modifier ?? '' });

/** Encode one validated tuple. Throws on an unknown tag (the recorder only emits known tags). */
export function eventToProto(e: ReplicatedEvent): EventInit {
  const t = e as Tuple;
  const n = (i: number) => t[i] as number;
  const s = (i: number) => t[i] as string;
  switch (e[0]) {
    case 'f':
      return { ev: { case: 'fx', value: { name: s(1), args: toValueInit(t[2]) } } };
    case 'w':
      return { ev: { case: 'wfx', value: { name: s(1), args: toValueInit(t[2]) } } };
    case 'u':
      return { ev: { case: 'ui', value: { name: s(1), args: toValueInit(t[2]) } } };
    case 's':
      return { ev: { case: 'sound', value: { name: s(1), opts: t[2] == null ? undefined : toValueInit(t[2]), at: t[3] == null ? undefined : vec(t[3]), arity: t.length - 1 } } };
    case 't':
      return { ev: { case: 'telegraph', value: { op: s(1), id: n(2), args: toValueInit(t[3]) } } };
    case 'o':
      return { ev: { case: 'ordnance', value: { op: s(1), id: n(2), args: toValueInit(t[3]) } } };
    case 'ev':
      return { ev: { case: 'evolution', value: { id: s(1), flag: !!t[2] } } };
    case 'hz':
      return { ev: { case: 'hazard', value: { x: n(1), z: n(2), r: n(3), kind: s(4), life: n(5) } } };
    case 'es':
      return {
        ev: {
          case: 'enemySpawn',
          value: { id: n(1), kind: s(2), mods: t[3] as string[], tag: (t[4] as string | null) ?? undefined, encounter: n(5), maxHp: n(6), maxShield: n(7), x: n(8), z: n(9), yaw: n(10), seg: n(11), lane: s(12) },
        },
      };
    case 'ek':
      return { ev: { case: 'enemyKill', value: { id: n(1), flag: !!t[2] } } };
    case 'er':
      return { ev: { case: 'enemyRelease', value: { id: n(1) } } };
    case 'ed':
      return { ev: { case: 'enemyDamage', value: { id: n(1), flag: !!t[2] } } };
    case 'el':
      return { ev: { case: 'enemyLimbs', value: { id: n(1), mask: n(2) } } };
    case 'T+':
      return { ev: { case: 'towerAdd', value: { id: n(1), cfg: t[2] as TowerConfig, p: vec(t[3]), yaw: n(4), owner: s(5), extra: s(6) } } };
    case 'T-':
      return { ev: { case: 'towerRemove', value: { id: n(1) } } };
    case 'Tc':
      return { ev: { case: 'towerChange', value: { id: n(1), cfg: t[2] as TowerConfig, level: n(3) } } };
    case 'dp':
      return { ev: { case: 'deployable', value: { kind: s(1), at: vec(t[2]), yaw: n(3), seconds: n(4), size: n(5) } } };
    case 'L+':
      return { ev: { case: 'lootAdd', value: { id: n(1), item: toDoc(t[2]), from: vec(t[3]), to: vec(t[4]), wave: n(5) } } };
    case 'L-':
      return { ev: { case: 'lootRemove', value: { id: n(1), flag: !!t[2] } } };
    case 'up':
      return { ev: { case: 'upgrade', value: { id: s(1), by: s(2) } } };
    case 'offer':
      return { ev: { case: 'offer', value: { ids: t[1] as string[], chooser: (t[2] as string | null) ?? undefined, source: s(3), seconds: n(4) } } };
    case 'vote':
      return { ev: { case: 'vote', value: { state: n(1), flag: t.length > 2 ? !!t[2] : undefined } } };
    case 'bank':
      return { ev: { case: 'bank', value: { wave: n(1), ok: !!t[2], a: n(3), b: n(4), c: n(5), d: n(6) } } };
    case 'def':
      return { ev: { case: 'defeat', value: {} } };
    case 'h':
      return { ev: { case: 'hurt', value: { amount: n(1), flag: !!t[2], from: t[3] == null ? undefined : vec(t[3]) } } };
    case 'k':
      return { ev: { case: 'knock', value: { v: vec(t[1]), amount: n(2) } } };
    case 'mv':
      return { ev: { case: 'move', value: { p: vec(t[1]) } } };
    case 'left':
      return { ev: { case: 'left', value: { id: s(1), name: s(2) } } };
    case 'shot':
      return { ev: { case: 'shot', value: { id: s(1), family: s(2), dir: vec(t[3]) } } };
  }
  throw new Error(`unknown event tag ${String(e[0])}`);
}

/** Decode one message back into the tuple the replica handles (null for an empty / unknown message). */
export function eventFromProto(m: Event): unknown[] | null {
  const ev = m.ev;
  switch (ev.case) {
    case 'fx':
      return ['f', ev.value.name, fromValue(ev.value.args)];
    case 'wfx':
      return ['w', ev.value.name, fromValue(ev.value.args)];
    case 'ui':
      return ['u', ev.value.name, fromValue(ev.value.args)];
    case 'sound': {
      const out: unknown[] = ['s', ev.value.name, ev.value.opts ? fromValue(ev.value.opts) : null, unvec(ev.value.at)];
      return out.slice(0, 1 + Math.max(1, Math.min(3, ev.value.arity)));
    }
    case 'telegraph':
      return ['t', ev.value.op, ev.value.id, fromValue(ev.value.args)];
    case 'ordnance':
      return ['o', ev.value.op, ev.value.id, fromValue(ev.value.args)];
    case 'evolution':
      return ['ev', ev.value.id, flag(ev.value.flag)];
    case 'hazard':
      return ['hz', ev.value.x, ev.value.z, ev.value.r, ev.value.kind, ev.value.life];
    case 'enemySpawn': {
      const v = ev.value;
      return ['es', v.id, v.kind, [...v.mods], v.tag ?? null, v.encounter, v.maxHp, v.maxShield, v.x, v.z, v.yaw, v.seg, v.lane];
    }
    case 'enemyKill':
      return ['ek', ev.value.id, flag(ev.value.flag)];
    case 'enemyRelease':
      return ['er', ev.value.id];
    case 'enemyDamage':
      return ['ed', ev.value.id, flag(ev.value.flag)];
    case 'enemyLimbs':
      return ['el', ev.value.id, ev.value.mask];
    case 'towerAdd':
      return ['T+', ev.value.id, cfgOut(ev.value.cfg), unvec(ev.value.p), ev.value.yaw, ev.value.owner, ev.value.extra];
    case 'towerRemove':
      return ['T-', ev.value.id];
    case 'towerChange':
      return ['Tc', ev.value.id, cfgOut(ev.value.cfg), ev.value.level];
    case 'deployable':
      return ['dp', ev.value.kind, unvec(ev.value.at), ev.value.yaw, ev.value.seconds, ev.value.size];
    case 'lootAdd':
      return ['L+', ev.value.id, fromDoc(ev.value.item), unvec(ev.value.from), unvec(ev.value.to), ev.value.wave];
    case 'lootRemove':
      return ['L-', ev.value.id, flag(ev.value.flag)];
    case 'upgrade':
      return ['up', ev.value.id, ev.value.by];
    case 'offer':
      return ['offer', [...ev.value.ids], ev.value.chooser ?? null, ev.value.source, ev.value.seconds];
    case 'vote':
      return ev.value.flag === undefined ? ['vote', ev.value.state] : ['vote', ev.value.state, flag(ev.value.flag)];
    case 'bank':
      return ['bank', ev.value.wave, flag(ev.value.ok), ev.value.a, ev.value.b, ev.value.c, ev.value.d];
    case 'defeat':
      return ['def'];
    case 'hurt':
      return ['h', ev.value.amount, flag(ev.value.flag), unvec(ev.value.from)];
    case 'knock':
      return ['k', unvec(ev.value.v), ev.value.amount];
    case 'move':
      return ['mv', unvec(ev.value.p)];
    case 'left':
      return ['left', ev.value.id, ev.value.name];
    case 'shot':
      return ['shot', ev.value.id, ev.value.family, unvec(ev.value.dir)];
    default:
      return null;
  }
}
