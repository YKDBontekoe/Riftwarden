// The rules role: replay a device log on the server copy of a profile (packages/rules: sync.ts).
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { type ReplayRequest, type ReplayResult, ReplayResultSchema, WorkerRequestSchema, type WorkerResponse, WorkerResponseSchema } from '@riftwarden/protocol/gen/riftwarden/v1/worker_pb';
import { fromDoc, toDoc } from '@riftwarden/protocol/value';
import { createDefaultSave, SAVE_VERSION } from '@riftwarden/rules/progression/save';
import { genesisProblem, type LogEntry, openDoc, replay } from '@riftwarden/rules/progression/sync';
import { warRequest } from './war';

export function replayRequest(req: ReplayRequest): ReplayResult {
  const now = req.now || Date.now();
  const entries: LogEntry[] = req.entries.map((e) => {
    const body = (fromDoc(e.body) ?? {}) as Partial<LogEntry>;
    return { seq: Number(e.seq), at: e.at, op: body.op, run: body.run };
  });
  let doc;
  if (req.doc && req.doc.json.length) doc = openDoc(fromDoc(req.doc), now);
  else if (req.genesis && req.genesis.json.length) {
    const g = fromDoc(req.genesis);
    const bad = genesisProblem(g);
    if (bad) throw new Error(bad);
    doc = openDoc(g, now);
  } else doc = createDefaultSave(now);
  const r = replay(doc, entries, now, { trusted: req.trusted });
  return create(ReplayResultSchema, {
    doc: toDoc(r.doc),
    results: r.results.map((x) => ({ seq: BigInt(x.seq), ok: x.ok, reason: x.reason ?? '' })),
    rulesVersion: SAVE_VERSION,
    applied: r.applied,
  });
}

/** One request frame in, one response frame out (errors become WorkerResponse.error). */
export function handle(bytes: Uint8Array): Uint8Array {
  let id = 0;
  let res: WorkerResponse;
  try {
    const req = fromBinary(WorkerRequestSchema, bytes);
    id = req.id;
    switch (req.call.case) {
      case 'replay':
        res = create(WorkerResponseSchema, { id, result: { case: 'replay', value: replayRequest(req.call.value) } });
        break;
      case 'war':
        res = create(WorkerResponseSchema, { id, result: { case: 'war', value: warRequest(req.call.value) } });
        break;
      default:
        res = create(WorkerResponseSchema, { id, error: { code: 'unknown_call', msg: 'Unknown worker call' } });
    }
  } catch (e) {
    res = create(WorkerResponseSchema, { id, error: { code: 'rejected', msg: (e as Error).message } });
  }
  return toBinary(WorkerResponseSchema, res);
}
