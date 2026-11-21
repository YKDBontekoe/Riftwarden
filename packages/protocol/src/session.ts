// Session socket frames (proto/riftwarden/v1/session.proto) for non-browser clients (bots, protocol suites).
// The browser's SessionClient builds the same frames.
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { SessionClientFrameSchema, SessionServerFrameSchema } from './gen/riftwarden/v1/session_pb';
import { fromDoc, toDoc } from './value';

export interface SyncAnswer {
  rev: number;
  doc: unknown;
  claimed: boolean;
  results: { seq: number; ok: boolean; reason: string }[];
}

export type SessionDown =
  | { kind: 'coop'; frame: Uint8Array }
  | { kind: 'response'; id: number; error: { code: string; msg: string } | null; sync: SyncAnswer | null }
  | { kind: 'changed'; rev: number }
  | { kind: 'error'; code: string; msg: string };

/** A co-op frame (codec.encodeClient output) wrapped for the session socket. */
export function sessionCoop(frame: Uint8Array): Uint8Array {
  return toBinary(SessionClientFrameSchema, create(SessionClientFrameSchema, { call: { case: 'coop', value: frame } }));
}

/** A sync call: `entries` bodies are `{ op?, run? }` log entries of `device`. */
export function sessionSync(id: number, device: string, entries: { seq: number; at: number; body: unknown }[], genesis?: unknown): Uint8Array {
  return toBinary(
    SessionClientFrameSchema,
    create(SessionClientFrameSchema, {
      id,
      call: { case: 'sync', value: { device, entries: entries.map((e) => ({ seq: BigInt(e.seq), at: e.at, body: toDoc(e.body) })), genesis: genesis === undefined ? undefined : toDoc(genesis) } },
    }),
  );
}

export function decodeSession(bytes: Uint8Array): SessionDown | null {
  let f;
  try {
    f = fromBinary(SessionServerFrameSchema, bytes);
  } catch {
    return null;
  }
  switch (f.msg.case) {
    case 'coop':
      return { kind: 'coop', frame: f.msg.value };
    case 'changed':
      return { kind: 'changed', rev: Number(f.msg.value.rev) };
    case 'error':
      return { kind: 'error', code: f.msg.value.code, msg: f.msg.value.msg };
    case 'response': {
      const r = f.msg.value;
      const sync =
        r.result.case === 'sync'
          ? { rev: Number(r.result.value.rev), doc: fromDoc(r.result.value.doc), claimed: r.result.value.claimed, results: r.result.value.results.map((x) => ({ seq: Number(x.seq), ok: x.ok, reason: x.reason })) }
          : null;
      return { kind: 'response', id: r.id, error: r.error ? { code: r.error.code, msg: r.error.msg } : null, sync };
    }
    default:
      return null;
  }
}
