import { useMemo } from 'react';
import { compareItems, statPreview } from '@riftwarden/rules/loot/equipment';
import { swapImpact } from '@riftwarden/rules/loot/loadoutScore';
import { ImpactBanner, statTooltip, useComparisonPriority, useScore } from '../compare';
import { STAT_HELP } from '../statHelp';
import type { StatKey } from '@riftwarden/rules/combat/stats';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { type ItemInstance } from '@riftwarden/rules/loot/types';
import { fmtNum } from '@riftwarden/rules/combat/stats';

import { type SlotId, SLOTS } from '@riftwarden/rules/progression/items';

const rowHelp = (key: string): string | undefined => (key.includes('|') ? STAT_HELP[key.split('|')[0] as StatKey] : undefined);

/** Loadout impact banner, side-by-side item stats and effective drone stats before/after. */
export function ComparePanel({ item, against, equipped, slot }: { item: ItemInstance; against: ItemInstance | null; equipped: (ItemInstance | null)[]; slot: SlotId | null }) {
  const priority = useComparisonPriority();
  const rows = useMemo(() => compareItems(item, against), [item, against]);
  const preview = useMemo(() => (item.category === 'module' ? [] : statPreview(equipped, item, against)), [item, against, equipped]);
  const base = useScore(equipped);
  const targetIndex = slot ? SLOTS.findIndex((s) => s.id === slot) : undefined;
  const impact = useMemo(() => (item.category === 'module' ? null : swapImpact(equipped, item, against, base, priority, targetIndex)), [item, against, equipped, base, priority, targetIndex]);
  if (item.category === 'module' || !impact) return null;
  const arrow = (v: number) => (v > 0 ? '▲' : v < 0 ? '▼' : '');
  return (
    <div className="compare">
      <ImpactBanner impact={impact} against={against} />
      <div className="id-label">
        ITEM STATS · THIS vs {against ? <b style={{ color: rarity(against.rarity).color }}>{against.name}</b> : 'EMPTY SLOT'} {against && <span className="faint">LV {fmtNum(against.level)}</span>}
      </div>
      <table className="cmp-table side">
        <thead>
          <tr>
            <th>STAT</th>
            <th>THIS</th>
            <th />
            <th>EQUIPPED</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.verdict > 0 ? 'up' : r.verdict < 0 ? 'down' : ''} title={rowHelp(r.key)}>
              <td>{r.label}</td>
              <td className="num">{r.a || '—'}</td>
              <td className="arr">{arrow(r.verdict)}</td>
              <td className="num dim">{r.b || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.length > 0 && (
        <>
          <div className="id-label">DRONE TOTALS IF EQUIPPED</div>
          <table className="cmp-table side">
            <tbody>
              {preview.map((r) => (
                <tr key={r.stat} className={r.verdict > 0 ? 'up' : r.verdict < 0 ? 'down' : ''} title={statTooltip(r.stat, equipped)}>
                  <td>{r.label}</td>
                  <td className="num dim">{r.before}</td>
                  <td className="arr">→</td>
                  <td className="num">
                    {r.after} {arrow(r.verdict)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
