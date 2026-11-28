import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { plural } from './format';
import type { Flow } from '../core/Flow';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { defaultEntry, findNode, liveNode, nodePlayable } from '@riftwarden/rules/war/world';
import { regionLayout } from '@riftwarden/rules/war/regions';
import { HOUR, nodeLiberation, regionLiberation, regionState, WAR, type WarEvent, type WarState } from '@riftwarden/rules/war/state';
import { BIOMES } from '@riftwarden/rules/world/biomes';
import { nodeInfo } from '@riftwarden/rules/runmap/map';
import { Hint, Seg } from './ds';
import { nodeBrief } from '@riftwarden/rules/runmap/brief';
import { Globe, OrderBanner, RegionMap, RegionStrip, RegionTabs, regionOfNode, WarHeader, WarReport } from './WarMap';
import { isCombatKind, NODE_KINDS } from '@riftwarden/rules/runmap/defs';
import { resumable } from '@riftwarden/rules/runmap/state';
import type { RunMode } from '@riftwarden/rules/runmap/defs';
import { KIND_COLOR, NodeCard } from './RunMap';
import { NamedDrops } from './NamedDrops';
import { FactionSigil } from './FactionIntel';

const clock = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const EVENT_ROW: Record<WarEvent['kind'], { name: string; note: string; tone: string }> = {
  distress: { name: 'Distress', note: '×2 liberation', tone: 'threat' },
  convoy: { name: 'Rift convoy', note: 'destroy it', tone: 'risk' },
  defense: { name: 'Defense', note: 'falls if lost', tone: 'risk' },
};

/** Live events of one region, soonest first; a row selects its sector. */
function LiveEvents({ war, k, onPick }: { war: WarState; k: number; onPick: (id: string) => void }) {
  const now = Date.now();
  const list = war.events.filter((e) => e.region === k && e.until > now).sort((a, b) => a.until - b.until);
  let h = war.hour + 1;
  while ((h + k) % WAR.corruptEvery) h++;
  const next = h * HOUR;
  return (
    <div className="dw-live" data-testid="dw-live">
      <div className="ds-lbl">Live in this region</div>
      {list.map((e) => {
        const n = findNode(war.seed, e.node);
        const r = EVENT_ROW[e.kind];
        return (
          <button key={e.id} className={`dw-ev ${r.tone}`} onClick={() => onPick(e.node)}>
            <i />
            <span><b>{r.name}</b>{n ? ` · ${nodeInfo(n).name}` : ''}</span>
            <em>{r.note}</em>
            <time>{clock(e.until - now)}</time>
          </button>
        );
      })}
      {regionState(war, k)?.status === 'active' && (
        <div className="dw-ev quiet"><i /><span>Corruption spreads next</span><em /><time>{clock(next - now)}</time></div>
      )}
      {!list.length && regionState(war, k)?.status !== 'active' && <div className="rm-none">Nothing is burning here.</div>}
    </div>
  );
}

/**
 * Deployment terminal, map runs (canvas "Deploy · the Rift War"): the planet (or the sector map, M) on the left,
 * the region panel on the right (liberation, live events, war order, mode, Rift Level from `aside`, the sector card).
 */
export function DeployMapPanel({ flow, save, entry, onEntry, aside }: { flow: Flow; save: SaveData; entry: string | null; onEntry: (id: string) => void; aside?: ReactNode }) {
  const wv = useSyncExternalStore(flow.war.store.subscribe, flow.war.store.get);
  const [mode, setMode] = useState<RunMode>(flow.runMode);
  const [regionPick, setRegionPick] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<'planet' | 'sector'>('planet');
  useEffect(() => {
    void flow.war.refresh();
    return () => flow.war.markSeen();
  }, [flow]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.code !== 'KeyM' || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      setView((v) => (v === 'planet' ? 'sector' : 'planet'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pick = (m: RunMode) => {
    flow.runMode = m;
    setMode(m);
  };
  const onRegion = useCallback((k: number) => { setHover(null); setRegionPick(k); }, []);
  const war = wv.war;
  const paths = save.history.filter((h) => h.path?.length).slice(0, 5);
  const rec = save.records[String(save.threat.selected)];
  if (!war) return <div className="dm-panel"><ModeSwitch mode={mode} onPick={pick} /><div className="rm-none">Contacting the war server…</div>{aside}</div>;
  const chosen = entry && nodePlayable(war, entry) ? entry : defaultEntry(war);
  const k = regionPick ?? regionOfNode(war.seed, chosen, 0);
  const show = liveNode(war.seed, war, hover ?? chosen);
  const def = show ? regionLayout(war.seed, show.act - 1) : null;
  const region = regionLayout(war.seed, k);
  const biome = BIOMES[region.biome];
  const lib = Math.round(regionLiberation(war, k));
  const reg = regionState(war, k);
  const select = (id: string) => { onEntry(id); setView('sector'); };
  return (
    <div className="dm-panel dw" data-view={view}>
      <div className="dw-left">
        <div className="dw-viewbar">
          <div className="dw-viewseg" role="tablist" aria-label="War view">
            <button className={view === 'planet' ? 'on' : ''} data-testid="dw-view-planet" onClick={() => setView('planet')}>PLANET</button>
            <button className={view === 'sector' ? 'on' : ''} data-testid="dw-view-sector" onClick={() => setView('sector')}>SECTOR MAP</button>
          </div>
          <WarHeader war={war} source={wv.source} online={wv.online} />
        </div>
        {view === 'planet' ? (
          <div className="dw-planet">
            <Globe war={war} selected={k} onSelect={onRegion} size={400} labels />
            <RegionTabs war={war} k={k} onPick={onRegion} />
          </div>
        ) : (
          <div className="dw-sector">
            <RegionStrip war={war} k={k} />
            <RegionMap war={war} k={k} pickAll selected={chosen} onSelect={onEntry} onHover={setHover} seenAt={wv.seenAt} />
          </div>
        )}
        <div className="dw-legend"><span><i className="lib" />Liberated</span><span><i className="front" />Front (yours)</span><span><i className="fallen" />Corrupted</span><span><i className="locked" />Locked</span><Hint keys="M">{view === 'planet' ? 'Sector map' : 'Planet'}</Hint></div>
      </div>
      <div className="dw-right">
        <div className="ds-kicker ds-row" style={{ gap: 8 }}>
          <FactionSigil biome={biome.id} />
          <span>Region {k + 1} · {biome.name} · {biome.faction.name}</span>
        </div>
        <h2 className="dw-name">{region.name}</h2>
        <div className="dw-lib">
          <b>{lib}<small>%</small></b>
          <div>
            <span>{!reg ? 'LOCKED' : reg.status === 'liberated' ? 'LIBERATED' : 'LIBERATED · TAKE EVERY COMBAT SECTOR'}</span>
            <Seg value={lib / 100} total={20} color="#7fe0c8" height={6} />
          </div>
        </div>
        <LiveEvents war={war} k={k} onPick={select} />
        <OrderBanner war={war} />
        <ModeSwitch mode={mode} onPick={pick} />
        {aside}
        {show && def && (
          <div className="dm-node" data-testid="dm-node">
            <NodeCard b={nodeBrief(show, 0, mode)} />
            {isCombatKind(show.kind) && regionState(war, def.k) && <div className="rm-liberation"><span>SECTOR LIBERATION</span><i className="war-bar"><i style={{ width: `${nodeLiberation(war, show.id, def)}%` }} /></i><b>{Math.round(nodeLiberation(war, show.id, def))}%</b></div>}
            <NamedDrops node={show} />
          </div>
        )}
        <details className="field-notes">
          <summary>War report and records</summary>
          <p>Land on any sector of an unlocked region. Securing a combat sector (five waves) pushes its liberation for every warden; a region falls when all its sectors are free, and the next one opens. Corruption spreads from the rift source while nobody fights it.</p>
          <WarReport war={war} seenAt={wv.seenAt} max={5} />
          <div className="dm-records">
            <span>Most nodes <b>{rec?.bestNodes ?? 0}</b></span>
            <span>Capitals taken <b>{save.totals.actsCleared}</b></span>
            {mode === 'survival' && <span data-testid="dm-survival-rec">Survival best <b>{plural(rec?.survivalBestWave ?? 0, 'wave')} · {plural(rec?.survivalBestNodes ?? 0, 'node')}</b></span>}
          </div>
        </details>
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
