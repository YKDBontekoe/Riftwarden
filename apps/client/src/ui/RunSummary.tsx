// Full run breakdown (cargo ledger, combat stats, bosses / events / milestones, secured and lost items).
import type { RunResult } from '@riftwarden/rules/progression/run';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { milestoneLabel } from '@riftwarden/rules/survival/records';
import { EVENTS, type EventId } from '@riftwarden/rules/survival/events';
import { RunRecap } from './RunRecap';
import { BriefList } from './items';
import { FieldIcon } from './FieldIcon';
import { fmtBig, fmtTime } from './format';

export function RunSummary({ result, extra, powerAfter }: { result: RunResult; extra?: { turretsBuilt: number; coresEarned: number } | null; powerAfter?: number }) {
  const tier = getTier(result.tier);
  const sv = result.survival;
  const resources = [
    ['Salvage', result.salvageSecured, result.salvageLost],
    ['Credits', result.creditsSecured ?? 0, result.creditsLost ?? 0],
    ['Components', result.componentsSecured ?? 0, result.componentsLost ?? 0],
    ['Warden XP', (result.xpSecured ?? 0) + (result.xpKept ?? 0), result.xpLost ?? 0],
    ['Equipment', result.itemsSecured, result.itemsLost],
  ] as const;
  const details: [string, string | number][] = [['Final wave', result.finalWave], ['Rift Level', `RL ${tier.id} · ${tier.name}`]];
  if (extra) details.push(['Turrets deployed', extra.turretsBuilt], ['Cores earned', extra.coresEarned]);
  if (sv) details.push(['Bosses destroyed', sv.bossesKilled], ['Elites destroyed', sv.elitesKilled], ['Drone losses', sv.deaths],
    ['Reactor damage taken', fmtBig(sv.reactorDamage)], ['Drone damage dealt', fmtBig(sv.playerDamage)],
    ['Tower damage dealt', fmtBig(sv.towerDamage)], ['Equipment collected', result.itemsCollected ?? 0]);
  return (
    <div className="summary">
      {sv?.dev && <div className="record-badge dev">DEVELOPMENT SESSION · NOT RECORD ELIGIBLE · NOTHING BANKED</div>}
      {!sv?.dev && (result.records?.length ?? 0) > 0 && <div className="record-badge"><strong>RL {tier.id} personal record{result.records!.length > 1 ? 's' : ''}</strong> {result.records!.join(' · ')}</div>}
      {!sv?.dev && !result.records && result.newRecord && <div className="record-badge">New personal record · RL {tier.id}</div>}
      <RunRecap result={result} powerAfter={powerAfter} />
      <div className="result-headline">
        <div><b>{result.wavesCleared}</b><span><FieldIcon name="wave" /> Waves cleared</span></div>
        <div><b>{result.kills.toLocaleString()}</b><span><FieldIcon name="enemy" /> Hostiles destroyed</span></div>
        <div><b>{fmtTime(result.duration)}</b><span><FieldIcon name="clock" /> Time deployed</span></div>
      </div>
      <table className="result-ledger">
        <thead><tr><th scope="col">Cargo</th><th scope="col">Secured</th><th scope="col">Lost</th></tr></thead>
        <tbody>{resources.map(([label, secured, lost]) => <tr key={label}><th scope="row">{label}</th>
          <td className={secured > 0 ? 'gained' : ''}>{secured.toLocaleString()}</td>
          <td className={lost > 0 ? 'lost' : ''}>{lost.toLocaleString()}</td></tr>)}</tbody>
      </table>
      <details className="field-notes mb-[9px]"><summary>Combat breakdown</summary>
        <dl className="tier-modifiers">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </details>
      {sv && (sv.bosses.length > 0 || sv.events.length > 0 || sv.milestones.length > 0) && (
        <div className="run-notes" data-testid="run-notes">
          {sv.bosses.length > 0 && (
            <div>
              <span>BOSSES</span>
              {sv.bosses.join(' · ')}
            </div>
          )}
          {sv.events.length > 0 && (
            <div>
              <span>EVENTS</span>
              {sv.events.map((id) => EVENTS[id as EventId]?.name ?? id).join(' · ')}
              {sv.hvtKilled + sv.hvtEscaped > 0 ? ` · couriers ${sv.hvtKilled} intercepted / ${sv.hvtEscaped} escaped` : ''}
            </div>
          )}
          {sv.milestones.length > 0 && (
            <div>
              <span>MILESTONES</span>
              {sv.milestones.map(milestoneLabel).join(' · ')}
            </div>
          )}
        </div>
      )}
      {!!result.securedItems?.length && (
        <>
          <div className="cp-label">SECURED EQUIPMENT</div>
          <BriefList items={result.securedItems} tone="secured" />
        </>
      )}
      {!!result.lostItems?.length && (
        <>
          <div className="cp-label lost">LOST · NOT SECURED</div>
          <BriefList items={result.lostItems} tone="lost" />
        </>
      )}
    </div>
  );
}

