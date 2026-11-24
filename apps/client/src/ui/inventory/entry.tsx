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

/** One line in an item list. `right` replaces the status tag (prices); `check` turns it into a multi-select row. */
export function ItemCard({ e, selected, onSelect, onHover, impact, right, check, disabled }: { e: InvEntry; selected: boolean; onSelect: () => void; onHover?: (on: boolean) => void; impact?: SwapImpact | null; right?: ReactNode; check?: boolean; disabled?: boolean }) {
  const it = e.item;
  const r = rarity(it.rarity);
  const known = !!baseDef(it.defId);
  const hint = impact && !e.equippedIn && it.category !== 'module' ? <ImpactChips impact={impact} /> : null;
  return (
    <button
      className={`icard r-${r.id} ${selected ? 'sel' : ''} ${e.status} ${disabled ? 'dis' : ''} ${impact && !e.equippedIn ? `v-${impact.verdict}` : ''}`}
      style={{ ['--rc' as string]: r.color }}
      onClick={onSelect}
      onMouseEnter={onHover && (() => onHover(true))}
      onMouseLeave={onHover && (() => onHover(false))}
      data-uid={it.uid}
    >
      <i className="absolute left-[0] top-[0] bottom-[0] w-[3px] [background:var(--rc)] [box-shadow:0_0_10px_var(--rc)]" />
      {check !== undefined && <i className={`ic-check ${check ? 'on' : ''}`} />}
      <ItemGlyph item={it} size={38} />
      <span className="ic-main">
        <b>
          {itemTitle(it)}
          {it.locked && <i className="ic-lock" title="Locked: protected from selling and dismantling" />}
        </b>
        <span className="ic-sub">
          <em>
            {known ? catLabel(it.category) : 'UNKNOWN DEFINITION'} · LV {fmtNum(it.level)}
          </em>
          {hint}
        </span>
      </span>
      {right ?? <span className={`ic-status s-${e.status}`}>{e.equippedIn ? getSlot(e.equippedIn).label : STATUS_LABEL[e.status]}</span>}
    </button>
  );
}
