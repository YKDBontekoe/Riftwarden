// The war role of the rules worker: advance the stored war document and apply reports (rules: war/service.ts).
import { create } from '@bufbuild/protobuf';
import { type WarRequest, type WarResult, WarResultSchema } from '@riftwarden/protocol/gen/riftwarden/v1/worker_pb';
import { fromDoc, toDoc } from '@riftwarden/protocol/value';
import { openWar, reportWar, stepWar } from '@riftwarden/rules/war/service';

export function warRequest(req: WarRequest): WarResult {
  const now = req.now || Date.now();
  const fresh = !req.stored || req.stored.json.length === 0;
  const w = openWar(fresh ? null : fromDoc(req.stored), now, req.seed || 1);
  let changed = stepWar(w, now, req.online) || fresh;
  let report: unknown;
  if (req.report) {
    const r = reportWar(w, { node: req.report.node, mode: req.report.mode === 'survival' ? 'survival' : 'defense', players: req.report.players, trusted: req.report.trusted }, now, req.online);
    report = r;
    if (r.ok) changed = true;
  }
  return create(WarResultSchema, { stored: toDoc(w), changed, report: report === undefined ? undefined : toDoc(report) });
}
