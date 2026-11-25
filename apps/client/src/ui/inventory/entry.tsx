import { type ReactNode } from 'react';
import { baseDef } from '@riftwarden/rules/loot/bases';
import { type SwapImpact } from '@riftwarden/rules/loot/loadoutScore';
import { ImpactChips } from '../compare';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { CATEGORY_LABEL, type ItemInstance } from '@riftwarden/rules/loot/types';
import { getSlot, type SlotId } from '@riftwarden/rules/progression/items';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import { enhanceLevel } from '@riftwarden/rules/economy/config';
import { ItemGlyph } from './glyphs';
import { rarityCls } from '../ds';

export type EntryStatus = 'equipped' | 'stored' | 'carried' | 'secured' | 'unsecured';

export const STATUS_LABEL: Record<EntryStatus, string> = {
  equipped: 'EQUIPPED',
  stored: 'STORED',
  carried: 'BROUGHT IN · SAFE',
  secured: 'SECURED',
  unsecured: 'UNSECURED',
};

export interface InvEntry {
  item: ItemInstance;
  status: EntryStatus;
  equippedIn: SlotId | null;
}

export function catLabel(c: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[c]?.toUpperCase() ?? c.toUpperCase();
}

/** Display name with enhancement level ("Rail Lancer +3"). */
export function itemTitle(it: ItemInstance): string {
  const e = enhanceLevel(it);
  return e > 0 ? `${it.name} +${e}` : it.name;
}

const VERDICT_MARK: Record<string, [string, string]> = { upgrade: ['▲', 'ds-up'], sidegrade: ['◆', 'ds-side'], downgrade: ['▼', 'ds-bad'] };

/**
 * One item in a list. Default: a tile (final design: rarity glow + pips, real render, level top left, verdict arrow top
 * right, name strip); `row` keeps the wide list line for narrow side columns. `right` replaces the status tag (prices),
 * `check` turns it into a multi-select entry. Class names (`icard`, status, `ic-main`, `ic-check`, `dis`) are stable
 * hooks for the browser suites.
 */
export function ItemCard({ e, selected, onSelect, onHover, impact, right, check, disabled, row }: { e: InvEntry; selected: boolean; onSelect: () => void; onHover?: (on: boolean) => void; impact?: SwapImpact | null; right?: ReactNode; check?: boolean; disabled?: boolean; row?: boolean }) {
  const it = e.item;
  const r = rarity(it.rarity);
  const known = !!baseDef(it.defId);
  const verdict = impact && !e.equippedIn && it.category !== 'module' ? impact.verdict : null;
  const hint = verdict ? <ImpactChips impact={impact} /> : null;
  const sub = `${known ? catLabel(it.category) : 'UNKNOWN DEFINITION'} · LV ${fmtNum(it.level)}`;
  const status = right ?? <span className={`ic-status s-${e.status}`}>{e.equippedIn ? getSlot(e.equippedIn).label : STATUS_LABEL[e.status]}</span>;
  const common = {
    style: { ['--rc' as string]: r.color },
    onClick: onSelect,
    onMouseEnter: onHover && (() => onHover(true)),
    onMouseLeave: onHover && (() => onHover(false)),
    'data-uid': it.uid,
    'aria-pressed': selected,
  };
  if (!row) {
    const v = verdict ? VERDICT_MARK[verdict] : null;
    return (
      <button {...common} title={`${itemTitle(it)} · ${r.label} ${sub}`} className={`icard tile ds-tile ${rarityCls(it.rarity)} ${selected ? 'sel on' : ''} ${e.status} ${disabled ? 'dis' : ''} ${verdict ? `v-${verdict}` : ''}`}>
        {check !== undefined && <i className={`ic-check ${check ? 'on' : ''}`} />}
        <span className="ds-tile-art"><ItemGlyph item={it} size={72} /></span>
        <span className="ds-lv">{fmtNum(it.level)}</span>
        {v && <span className={`ds-vd ${v[1]}`}>{v[0]}</span>}
        {it.locked && <i className="ic-lock" title="Locked: protected from selling and dismantling" />}
        <span className="ic-main">
          <b>{itemTitle(it)}</b>
          <em className="ds-sr">{sub}</em>
        </span>
        <span className="ic-foot">{status}</span>
      </button>
    );
  }
  return (
    <button {...common} className={`icard r-${r.id} ${selected ? 'sel' : ''} ${e.status} ${disabled ? 'dis' : ''} ${verdict ? `v-${verdict}` : ''}`}>
      <i className="absolute left-[0] top-[0] bottom-[0] w-[3px] [background:var(--rc)] [box-shadow:0_0_10px_var(--rc)]" />
      {check !== undefined && <i className={`ic-check ${check ? 'on' : ''}`} />}
      <ItemGlyph item={it} size={38} />
      <span className="ic-main">
        <b>
          {itemTitle(it)}
          {it.locked && <i className="ic-lock" title="Locked: protected from selling and dismantling" />}
        </b>
        <span className="ic-sub">
          <em>{sub}</em>
          {hint}
        </span>
      </span>
      {status}
    </button>
  );
}
