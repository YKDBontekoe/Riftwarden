import { type ReactNode, useMemo } from 'react';
import { fmtNum, type StatKey, STAT_DEFS } from '../combat/stats';
import { type LoadoutScore, loadoutScore, pctText, SCORE_HELP, SCORE_KEYS, SCORE_LABEL, SCORE_UNIT, type ScoreDelta, type ScoreKey, statSources, type SwapImpact, VERDICT_LABEL } from '../loot/loadoutScore';
import { rarity } from '../loot/rarity';
import type { ItemInstance } from '../loot/types';
import { STAT_HELP } from './statHelp';

/** Shared comparison widgets: impact chips, verdict tags, the impact banner and stat tooltips. */

export function useScore(equipped: readonly (ItemInstance | null)[]): LoadoutScore {
  // Equipped arrays are rebuilt per render; key the memo on the uids + enhancement/engineering state.
  const key = equipped.map((i) => (i ? `${i.uid}:${i.enhance ?? 0}:${i.rerolls ?? 0}:${i.socketed.map((m) => m?.uid ?? '-').join(',')}` : '-')).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => loadoutScore(equipped), [key]);
}

const short: Record<ScoreKey, string> = { dps: 'DPS', ehp: 'EHP', mobility: 'MOV', towers: 'TWR' };

/** Compact per-headline deltas for list rows ("DPS +12%  EHP −3%"). */
export function ImpactChips({ impact, max = 2 }: { impact: SwapImpact | null | undefined; max?: number }) {
  if (!impact) return null;
  if (!impact.deltas.length) return <span className="impact-chips"><i className="flat">=</i></span>;
  const top = [...impact.deltas].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, max);
  return (
    <span className="impact-chips" title={impact.deltas.map((d) => `${SCORE_LABEL[d.key]} ${pctText(d.pct)}`).join(' · ')}>
      {top.map((d) => (
        <i key={d.key} className={d.pct > 0 ? 'up' : 'down'}>
          {short[d.key]} {pctText(d.pct)}
        </i>
      ))}
    </span>
  );
}

export function VerdictTag({ impact }: { impact: SwapImpact | null | undefined }) {
  if (!impact) return null;
  return <span className={`verdict v-${impact.verdict}`}>{VERDICT_LABEL[impact.verdict]}</span>;
}

function fmtScore(k: ScoreKey, v: number): string {
  return k === 'dps' || k === 'ehp' ? fmtNum(v) : fmtNum(Math.round(v));
}

/** One headline bar: before -> after with a proportional fill. */
function ImpactRow({ d }: { d: ScoreDelta }) {
  const max = Math.max(d.before, d.after, 1e-9);
  return (
    <div className={`impact-row ${d.pct > 0 ? 'up' : 'down'}`} title={SCORE_HELP[d.key]}>
      <span className="ir-label">{SCORE_LABEL[d.key]}</span>
      <span className="ir-bar">
        <i className="ir-before" style={{ width: `${(d.before / max) * 100}%` }} />
        <i className="ir-after" style={{ width: `${(d.after / max) * 100}%` }} />
      </span>
      <span className="ir-vals">
        {fmtScore(d.key, d.before)} → <b>{fmtScore(d.key, d.after)}</b> <small>{SCORE_UNIT[d.key]}</small>
      </span>
      <b className="ir-pct">{pctText(d.pct)}</b>
    </div>
  );
}

/** Headline verdict for a swap: what the whole drone gains or loses. */
export function ImpactBanner({ impact, against, title = 'LOADOUT IMPACT' }: { impact: SwapImpact; against?: ItemInstance | null; title?: string }) {
  return (
    <div className={`impact-banner v-${impact.verdict}`} data-testid="impact-banner">
      <div className="ib-head">
        <span className="id-label">{title}</span>
        <VerdictTag impact={impact} />
        {against !== undefined && (
          <span className="ib-vs">
            vs {against ? <b style={{ color: rarity(against.rarity).color }}>{against.name}</b> : <b>EMPTY SLOT</b>}
          </span>
        )}
      </div>
      {impact.deltas.length === 0 ? <div className="id-none">No change to firepower, survivability, mobility or tower support.</div> : impact.deltas.map((d) => <ImpactRow key={d.key} d={d} />)}
    </div>
  );
}

/** The four headline numbers of the current loadout (drone configuration header). */
export function ScoreCards({ score }: { score: LoadoutScore }) {
  return (
    <div className="score-cards">
      {SCORE_KEYS.map((k) => (
        <div key={k} className={`score-card s-${k}`} title={SCORE_HELP[k]}>
          <span>{SCORE_LABEL[k]}</span>
          <b>{fmtScore(k, score[k])}</b>
          <em>{SCORE_UNIT[k]}</em>
        </div>
      ))}
    </div>
  );
}

/** Tooltip text for a stat: what it does + which equipped items feed it. */
export function statTooltip(stat: StatKey, equipped?: readonly (ItemInstance | null)[]): string {
  const lines = [`${STAT_DEFS[stat].label}: ${STAT_HELP[stat]}`];
  if (equipped) {
    const src = statSources(equipped, stat);
    if (src.length) lines.push('', 'From:', ...src.map((s) => `  ${s.text}  ${s.name}`));
    else lines.push('', 'No equipped item modifies this stat.');
  }
  return lines.join('\n');
}

/** Stat label with an info tooltip. */
export function StatName({ stat, equipped, children }: { stat: StatKey; equipped?: readonly (ItemInstance | null)[]; children?: ReactNode }) {
  return (
    <span className="stat-name" title={statTooltip(stat, equipped)}>
      {children ?? STAT_DEFS[stat].label}
      <i className="info-dot">i</i>
    </span>
  );
}
