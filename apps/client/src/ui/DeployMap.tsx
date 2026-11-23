import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { defaultEntry, findNode, liveNode, nodePlayable } from '@riftwarden/rules/war/world';
import { regionLayout } from '@riftwarden/rules/war/regions';
import { nodeLiberation, regionState } from '@riftwarden/rules/war/state';
import { nodeBrief } from '@riftwarden/rules/runmap/brief';
import { Globe, OrderBanner, RegionMap, RegionStrip, RegionTabs, regionOfNode, WarHeader, WarReport } from './WarMap';
import { isCombatKind, NODE_KINDS } from '@riftwarden/rules/runmap/defs';
import { resumable } from '@riftwarden/rules/runmap/state';
import type { RunMode } from '@riftwarden/rules/runmap/defs';
import { KIND_COLOR, NodeCard } from './RunMap';
import { NamedDrops } from './NamedDrops';

/** Deployment terminal, map runs: the Rift War (globe, regions, sectors) to pick where to land, records, codex. */
export function DeployMapPanel({ flow, save, entry, onEntry }: { flow: Flow; save: SaveData; entry: string | null; onEntry: (id: string) => void }) {
  const wv = useSyncExternalStore(flow.war.store.subscribe, flow.war.store.get);
  const [mode, setMode] = useState<RunMode>(flow.runMode);
  const [regionPick, setRegionPick] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    void flow.war.refresh();
    return () => flow.war.markSeen();
  }, [flow]);
  const pick = (m: RunMode) => {
    flow.runMode = m;
    setMode(m);
  };
  const onRegion = useCallback((k: number) => { setHover(null); setRegionPick(k); }, []);
  const war = wv.war;
  const paths = save.history.filter((h) => h.path?.length).slice(0, 5);
  const rec = save.records[String(save.threat.selected)];
  if (!war) return <div className="dm-panel"><ModeSwitch mode={mode} onPick={pick} /><div className="rm-none">Contacting the war server…</div></div>;
  const chosen = entry && nodePlayable(war, entry) ? entry : defaultEntry(war);
  const k = regionPick ?? regionOfNode(war.seed, chosen, 0);
  const show = liveNode(war.seed, war, hover ?? chosen);
  const def = show ? regionLayout(war.seed, show.act - 1) : null;
  return (
    <div className="dm-panel">
      <ModeSwitch mode={mode} onPick={pick} />
      <WarHeader war={war} source={wv.source} online={wv.online} />
      <OrderBanner war={war} />
      <div className="dm-war">
        <div className="dm-globe">
          <Globe war={war} selected={k} onSelect={onRegion} size={150} />
          <RegionTabs war={war} k={k} onPick={onRegion} />
        </div>
        <div className="dm-region">
          <RegionStrip war={war} k={k} />
          <RegionMap war={war} k={k} pickAll selected={chosen} onSelect={onEntry} onHover={setHover} seenAt={wv.seenAt} />
        </div>
      </div>
      {show && def && (
        <div className="dm-node" data-testid="dm-node">
          <NodeCard b={nodeBrief(show, 0, mode)} />
          {isCombatKind(show.kind) && regionState(war, def.k) && <div className="rm-liberation"><span>SECTOR LIBERATION</span><i className="war-bar"><i style={{ width: `${nodeLiberation(war, show.id, def)}%` }} /></i><b>{Math.round(nodeLiberation(war, show.id, def))}%</b></div>}
          <NamedDrops node={show} />
        </div>
      )}
      <p>Land on any sector of an unlocked region. Securing a combat sector (five waves) pushes its liberation for every warden; a region falls when all its sectors are free, and the next one opens. Corruption spreads from the rift source while nobody fights it.</p>
      <WarReport war={war} seenAt={wv.seenAt} max={5} />
      <div className="dm-records">
        <span>Most nodes <b>{rec?.bestNodes ?? 0}</b></span>
        <span>Capitals taken <b>{save.totals.actsCleared}</b></span>
        {mode === 'survival' && <span data-testid="dm-survival-rec">Survival best <b>{rec?.survivalBestWave ?? 0} waves · {rec?.survivalBestNodes ?? 0} nodes</b></span>}
      </div>
      {paths.length > 0 && (
        <details className="field-notes" data-testid="dm-codex">
          <summary>Codex · recent paths</summary>
          {paths.map((h) => (
            <div key={h.id} className="dm-path">
              <span>T{h.tier}{h.mode === 'survival' ? ' · SURV' : ''} · {h.outcome}</span>
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
      <b>Region {m.act} · {m.cleared} node{m.cleared === 1 ? '' : 's'} secured · wave {a.bankedThroughWave}</b>
      {next && <span style={{ color: KIND_COLOR[next.kind] }}>Next: {next.actBoss ? 'Region capital' : NODE_KINDS[next.kind].name} · {next.region}</span>}
      <span>HQ terminals stay locked until the operation is resumed or ended.</span>
      <div className="row2">
        <button className="primary" data-testid="dm-resume-go" disabled={busy} onClick={() => { setBusy(true); void flow.resumeRun().then((ok) => !ok && setBusy(false)); }}>RESUME OPERATION</button>
        <button className="home-btn" data-testid="dm-resume-end" disabled={busy} onClick={() => flow.endSuspendedRun()}>END OPERATION</button>
      </div>
    </div>
  );
}

const MODES: { id: RunMode; name: string; text: string }[] = [
  { id: 'defense', name: 'DEFENSE', text: 'Hold the reactor. Build towers along the lanes. The drone respawns.' },
  { id: 'survival', name: 'SURVIVAL', text: 'No reactor, no towers: every machine hunts you. One life. Smaller waves, +25% income, +20% loot luck.' },
];

/** Game mode switch for solo map runs. */
export function ModeSwitch({ mode, onPick }: { mode: RunMode; onPick: (m: RunMode) => void }) {
  return (
    <div className="mode-switch" role="group" aria-label="Game mode">
      {MODES.map((m) => (
        <button key={m.id} className={`mode-opt ${mode === m.id ? 'on' : ''} m-${m.id}`} aria-pressed={mode === m.id} data-testid={`mode-${m.id}`} onClick={() => onPick(m.id)}>
          <b>{m.name}</b>
          <span>{m.text}</span>
        </button>
      ))}
    </div>
  );
}
