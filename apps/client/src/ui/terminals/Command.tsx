import { UnlockTrackPanel } from '../UnlockTrack';
import { CodexPanel, WarCaches } from '../Spikes';
import { Leaderboards, SeasonPanel } from '../Seasons';
import type { Flow } from '../../core/Flow';
import { getTier, type ThreatTier } from '@riftwarden/rules/progression/tiers';
import { MILESTONES } from '@riftwarden/rules/survival/records';
import { useSave } from '../useSave';
import { fmtTime, plural } from '../format';
import { Shell } from '../shell';
import { StationDirectory, WardenProgress } from '../Directory';
import { useEffect } from 'react';
import { useRemembered } from '../remembered';

type CmdTab = 'record' | 'history' | 'progress' | 'season' | 'stations';
const CMD_TABS: [CmdTab, string][] = [['record', 'Service record'], ['history', 'History'], ['progress', 'Milestones · codex'], ['season', 'Season'], ['stations', 'Stations']];

export function CommandTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const [tab, setTab] = useRemembered<CmdTab>('command.tab', 'record', (v) => CMD_TABS.some(([id]) => id === v));
  const savedAt = flow.profile.store.get().savedAt || save.profile.lastSavedAt;
  const t = save.totals;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const i = CMD_TABS.findIndex(([id]) => id === tab);
      if (e.code === 'KeyQ') setTab(CMD_TABS[(i + CMD_TABS.length - 1) % CMD_TABS.length][0]);
      else if (e.code === 'KeyR') setTab(CMD_TABS[(i + 1) % CMD_TABS.length][0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, setTab]);
  const totals: [string, string][] = [
    ['Operations', t.runs.toLocaleString()], ['Extracted', t.returned.toLocaleString()], ['Reactor lost', t.defeated.toLocaleString()],
    ['Hostiles', t.kills.toLocaleString()], ['Bosses · elites', `${t.bossesDefeated} · ${t.elitesDefeated}`], ['Salvage secured', t.salvageSecured.toLocaleString()],
  ];
  return (
    <Shell code="CC-00" title="COMMAND CONSOLE" sub={`Service record · ${save.profile.callsign}`} close={close} wide>
      <div className="tabs term-tabs lo-tabs" data-tabkeys="own">
        <span className="ds-sh">Q</span>
        {CMD_TABS.map(([id, label]) => <button key={id} data-tab={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
        <span className="ds-sh">R</span>
        <span className="ds-grow" />
        <span className="ds-mono">ABANDONED / INTERRUPTED {t.abandoned} / {t.interrupted} · RL {save.threat.unlocked} UNLOCKED</span>
      </div>
      {tab === 'record' && (
        <div className="cmd-record">
          <div className="cmd-totals">
            {totals.map(([k, v]) => <div key={k} className="ds-col"><span className="ds-num" style={{ fontSize: 38 }}>{v}</span><span className="ds-lbl">{k}</span></div>)}
          </div>
          <div className="cmd-split">
            <table className="rec-table cmd-table">
              <thead>
                <tr><th>Rift Level</th><th>Best wave</th><th>Reached</th><th>Bosses</th><th>Elites</th><th>Runs</th><th>Checkpoints</th><th>Longest</th></tr>
              </thead>
              <tbody>
                {recordLevels(save).map((tier) => {
                  const r = save.records[String(tier.id)];
                  const locked = tier.id > save.threat.unlocked;
                  return (
                    <tr key={tier.id} className={locked ? 'locked' : ''}>
                      <td><b className="ds-d">RL {tier.id}</b> {tier.name}</td>
                      <td className="hi">{locked ? 'LOCKED' : (r?.bestWave ?? 0)}</td>
                      <td>{r?.highestWave ?? 0}</td>
                      <td>{r ? `${r.bossesDefeated}${r.bestBossesRun > 1 ? ` (best ${r.bestBossesRun})` : ''}` : 0}</td>
                      <td>{r?.elitesDefeated ?? 0}</td>
                      <td>{r?.runs ?? 0}</td>
                      <td>{r?.checkpoints ?? 0}</td>
                      <td>{r ? fmtTime(r.longestRun) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="ds-col" style={{ gap: 10 }}>
              <WardenProgress flow={flow} />
              <span className="ds-meta">Profile saved {savedAt ? new Date(savedAt).toLocaleTimeString() : '—'}{flow.profile.store.get().lastWriteOk ? '' : ' · write failed (storage unavailable)'}</span>
            </div>
          </div>
        </div>
      )}
      {tab === 'history' && (
        save.history.length === 0 ? (
          <div className="empty-state small">
            <b>No operations on record</b>
            <p>Use the deployment terminal in the launch bay to begin.</p>
          </div>
        ) : (
          <div className="history cmd-history">
            {save.history.map((h) => (
              <div key={h.id} className={`hist ds-list-row ${h.outcome}`}>
                <span className="h-out ds-d">{h.outcome === 'returned' ? 'EXTRACTED' : h.outcome === 'defeat' ? 'REACTOR LOST' : h.outcome.toUpperCase()}</span>
                <span>RL {h.tier}</span>
                <span className="ds-grow ds-meta">{h.path?.length ? h.path.join(' › ') : plural(h.kills, 'kill')}{h.bosses.length > 0 ? ` · ${plural(h.bosses.length, 'boss', 'bosses')}` : ''}{h.elites > 0 ? ` · ${plural(h.elites, 'elite')}` : ''}</span>
                <b className="ds-d" style={{ fontSize: 22 }}>W{h.finalWave}</b>
                <span className="o">+{h.salvageSecured}</span>
                {h.salvageLost > 0 && <span className="r">−{h.salvageLost}</span>}
                {(h.newRecord || h.records.length > 0) && <span className="ds-chip solid">Record</span>}
                {h.dev && <span className="dev">DEV</span>}
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'progress' && (
        <div className="cmd-progress">
          <div className="ds-col" style={{ gap: 10 }}>
            <UnlockTrackPanel save={save} />
            <span className="ds-lbl">Milestones · {save.milestones.length}/{MILESTONES.length}</span>
            <div className="milestones" data-testid="milestones">
              {MILESTONES.map((m) => (
                <span key={m.id} className={`ms ds-chip ${save.milestones.includes(m.id) ? 'on green' : ''}`} title={m.label}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div className="ds-col" style={{ gap: 10 }}>
            <CodexPanel save={save} />
            <WarCaches flow={flow} save={save} />
          </div>
        </div>
      )}
      {tab === 'season' && (
        <div className="cmd-progress">
          <SeasonPanel flow={flow} />
          <Leaderboards online={flow.war.base !== null} />
        </div>
      )}
      {tab === 'stations' && <StationDirectory flow={flow} close={close} />}
    </Shell>
  );
}

/** Levels shown in the records table: every level played or unlocked, newest first, plus the next locked one. */
function recordLevels(save: { records: Record<string, unknown>; threat: { unlocked: number } }): ThreatTier[] {
  const ids = new Set<number>([save.threat.unlocked + 1]);
  for (let i = 1; i <= save.threat.unlocked; i++) ids.add(i);
  for (const k of Object.keys(save.records)) if (Number(k) >= 1) ids.add(Number(k));
  return [...ids].sort((a, b) => b - a).slice(0, 40).map(getTier);
}
