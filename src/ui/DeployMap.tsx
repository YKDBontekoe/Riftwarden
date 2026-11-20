import { useState } from 'react';
import type { Flow } from '../core/Flow';
import type { SaveData } from '../progression/save';
import { findNode } from '../runmap/map';
import { NODE_KINDS } from '../runmap/defs';
import { resumable } from '../runmap/state';
import { DeployMapPreview, KIND_COLOR } from './RunMap';

/** Deployment terminal, map runs: the next run's first act (choose an entry sector) and the map codex. */
export function DeployMapPanel({ flow, save, entry, onEntry }: { flow: Flow; save: SaveData; entry: string | null; onEntry: (id: string) => void }) {
  const seed = flow.mapSeedPreview();
  const paths = save.history.filter((h) => h.path?.length).slice(0, 5);
  const rec = save.records[String(save.threat.selected)];
  return (
    <div className="dm-panel">
      <div className="operation-heading"><h2>Rift map · Act 1</h2><span>Choose an entry sector</span></div>
      <DeployMapPreview seed={seed} entry={entry} onEntry={onEntry} />
      <p>Each node is a sector: five waves to secure it, or a hub visit. At every node you bank and choose the next one, or extract. Towers stay behind (half their cost refunds); cores, upgrades and cargo carry on. Act bosses lift curses and open the next, harder act.</p>
      <div className="dm-records">
        <span>Deepest act <b>{rec?.deepestAct ?? 0}</b></span>
        <span>Most nodes <b>{rec?.bestNodes ?? 0}</b></span>
        <span>Act bosses <b>{save.totals.actsCleared}</b></span>
      </div>
      {paths.length > 0 && (
        <details className="field-notes" data-testid="dm-codex">
          <summary>Map codex · recent paths</summary>
          {paths.map((h) => (
            <div key={h.id} className="dm-path">
              <span>T{h.tier} · {h.outcome}</span>
              <b>{h.path!.map((c, i) => <i key={i} className={c.endsWith('*') ? 'boss' : ''}>{c}</i>)}</b>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/** A suspended map run waits at the HQ: resume it at its next node, or end it (banked rewards stay). */
export function ResumeCard({ flow, save }: { flow: Flow; save: SaveData }) {
  const [busy, setBusy] = useState(false);
  const a = save.activeRun;
  const m = a?.map;
  if (!a || !m || !resumable(m) || (flow.run && !flow.run.ended)) return null;
  const next = findNode(m.seed, m.next!);
  return (
    <div className="dm-resume" data-testid="dm-resume">
      <div className="cp-kicker">Suspended operation · tier {a.tier}</div>
      <b>Act {m.act} · {m.cleared} node{m.cleared === 1 ? '' : 's'} secured · wave {a.bankedThroughWave}</b>
      {next && <span style={{ color: KIND_COLOR[next.kind] }}>Next: {next.actBoss ? 'Act boss' : NODE_KINDS[next.kind].name}</span>}
      <span>HQ terminals stay locked until the operation is resumed or ended.</span>
      <div className="row2">
        <button className="primary" data-testid="dm-resume-go" disabled={busy} onClick={() => { setBusy(true); void flow.resumeRun().then((ok) => !ok && setBusy(false)); }}>RESUME OPERATION</button>
        <button className="home-btn" data-testid="dm-resume-end" disabled={busy} onClick={() => flow.endSuspendedRun()}>END OPERATION</button>
      </div>
    </div>
  );
}
