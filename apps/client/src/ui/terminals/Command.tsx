import { UnlockTrackPanel } from '../UnlockTrack';
import { CodexPanel, WarCaches } from '../Spikes';
import { Leaderboards, SeasonPanel } from '../Seasons';
import type { Flow } from '../../core/Flow';
import { getTier, type ThreatTier } from '@riftwarden/rules/progression/tiers';
import { MILESTONES } from '@riftwarden/rules/survival/records';
import { fmtTime, useSave } from '../App';
import { Shell } from '../shell';
import { StationDirectory, WardenProgress } from '../Directory';
import { Stat } from './Deploy';

export function CommandTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const savedAt = flow.profile.store.get().savedAt || save.profile.lastSavedAt;
  const t = save.totals;
  return (
    <Shell code="CC-00" title="COMMAND CONSOLE" sub={`Service record · ${save.profile.callsign}`} close={close} wide>
      <div className="command-grid">
        <div>
          <div className="col-label">SERVICE RECORD</div>
          <div className="stat-grid">
            <Stat k="OPERATIONS" v={String(t.runs)} />
            <Stat k="EXTRACTED AT CHECKPOINT" v={String(t.returned)} />
            <Stat k="REACTOR LOST" v={String(t.defeated)} />
            <Stat k="ABANDONED / INTERRUPTED" v={`${t.abandoned} / ${t.interrupted}`} />
            <Stat k="HOSTILES DESTROYED" v={String(t.kills)} />
            <Stat k="SALVAGE SECURED (TOTAL)" v={String(t.salvageSecured)} />
            <Stat k="BOSSES · ELITES DESTROYED" v={`${t.bossesDefeated} · ${t.elitesDefeated}`} />
            <Stat k="HIGHEST RIFT LEVEL UNLOCKED" v={`RL ${save.threat.unlocked}`} />
          </div>
          <WardenProgress flow={flow} />
          <UnlockTrackPanel save={save} />
          <SeasonPanel flow={flow} />
          <Leaderboards />
          <CodexPanel save={save} />
          <WarCaches flow={flow} save={save} />
          <div className="col-label">MILESTONES · {save.milestones.length}/{MILESTONES.length}</div>
          <div className="milestones" data-testid="milestones">
            {MILESTONES.map((m) => (
              <span key={m.id} className={`ms ${save.milestones.includes(m.id) ? 'on' : ''}`} title={m.label}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="col-label">SURVIVAL RECORDS</div>
          <table className="rec-table">
            <thead>
              <tr>
                <th>RIFT LEVEL</th>
                <th>BEST WAVE</th>
                <th>REACHED</th>
                <th>BOSSES</th>
                <th>ELITES</th>
                <th>RUNS</th>
                <th>LONGEST</th>
              </tr>
            </thead>
            <tbody>
              {recordLevels(save).map((tier) => {
                const r = save.records[String(tier.id)];
                const locked = tier.id > save.threat.unlocked;
                return (
                  <tr key={tier.id} className={locked ? 'locked' : ''}>
                    <td>
                      RL {tier.id} · {tier.name}
                    </td>
                    <td className="hi">{locked ? 'LOCKED' : (r?.bestWave ?? 0)}</td>
                    <td>{r?.highestWave ?? 0}</td>
                    <td>{r ? `${r.bossesDefeated}${r.bestBossesRun > 1 ? ` (best ${r.bestBossesRun})` : ''}` : 0}</td>
                    <td>{r?.elitesDefeated ?? 0}</td>
                    <td>{r?.runs ?? 0}</td>
                    <td>{r ? fmtTime(r.longestRun) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <StationDirectory flow={flow} close={close} />
          <div className="col-label">RECENT OPERATIONS</div>
          {save.history.length === 0 ? (
            <div className="empty-state small">
              <b>No operations on record</b>
              <p>Use the deployment terminal in the launch bay to begin.</p>
            </div>
          ) : (
            <div className="history">
              {save.history.map((h) => (
                <div key={h.id} className={`hist ${h.outcome}`}>
                  <span className="h-out">{h.outcome === 'returned' ? 'EXTRACTED' : h.outcome === 'defeat' ? 'REACTOR LOST' : h.outcome.toUpperCase()}</span>
                  <span>RL{h.tier}</span>
                  <span>W{h.finalWave}</span>
                  <span>{h.kills} kills</span>
                  {h.bosses.length > 0 && <span className="boss">{h.bosses.length} boss{h.bosses.length > 1 ? 'es' : ''}</span>}
                  {h.elites > 0 && <span>{h.elites} elites</span>}
                  <span className="o">+{h.salvageSecured}</span>
                  {h.salvageLost > 0 && <span className="r">−{h.salvageLost}</span>}
                  {(h.newRecord || h.records.length > 0) && <span className="rec">RECORD</span>}
                  {h.dev && <span className="dev">DEV</span>}
                </div>
              ))}
            </div>
          )}
          <div className="mt-[14px] font-mono text-[10.5px] tracking-[0.14em] text-faint">
            PROFILE SAVED LOCALLY · {savedAt ? new Date(savedAt).toLocaleTimeString() : '—'}
            {flow.profile.store.get().lastWriteOk ? '' : ' · WRITE FAILED (storage unavailable)'}
          </div>
        </div>
      </div>
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
