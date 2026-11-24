import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { affixDef } from '@riftwarden/rules/loot/affixes';
import { baseDef } from '@riftwarden/rules/loot/bases';
import { swapImpact, type SwapImpact } from '@riftwarden/rules/loot/loadoutScore';
import { ComparisonPriorityPicker, useComparisonPriority, useScore, useScoreContext, VerdictTag } from '../compare';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { type Category, type ItemInstance } from '@riftwarden/rules/loot/types';
import { getSlot, type SlotId, SLOTS, slotsFor, defaultSlot } from '@riftwarden/rules/progression/items';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import { ComparePanel } from './compare';
import { EquippedItemsContext, ItemDetail } from './detail';
import { InvEntry, ItemCard, catLabel } from './entry';
import { ItemGlyph } from './glyphs';

type Filter = 'all' | Category | 'unsecured';

type Sort = 'rarity' | 'level' | 'newest' | 'name';

type ViewSort = Sort | 'impact';

const FILTERS: Filter[] = ['all', 'weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'ability', 'ultimate', 'module'];

export function sortEntries(list: InvEntry[], sort: Sort): InvEntry[] {
  const r = (e: InvEntry) => rarity(e.item.rarity).index;
  const out = [...list];
  out.sort((a, b) => {
    switch (sort) {
      case 'rarity':
        return r(b) - r(a) || b.item.level - a.item.level || a.item.name.localeCompare(b.item.name);
      case 'level':
        return b.item.level - a.item.level || r(b) - r(a);
      case 'newest':
        return b.item.acquiredAt - a.item.acquiredAt;
      case 'name':
        return a.item.name.localeCompare(b.item.name);
    }
  });
  return out;
}

/** Free-text match over name, category, rarity, affix and stat labels. */
export function matchesQuery(it: ItemInstance, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const hay = [it.name, it.category, rarity(it.rarity).label, ...it.affixes.map((a) => `${STAT_DEFS[a.stat].label} ${affixDef(a.id)?.adjective ?? ''}`), ...it.base.map((b) => STAT_DEFS[b.stat].label)].join(' ').toLowerCase();
  return t.split(/\s+/).every((w) => hay.includes(w));
}

export interface InventoryActions {
  canChange: boolean;
  lockedReason: string;
  equip(uid: string, slot?: SlotId): void;
  unequip(slot: SlotId): void;
  /** Destroy/scrap action for an entry (undefined = not available for it). */
  remove?: { label: (e: InvEntry) => string; allowed: (e: InvEntry) => boolean; run: (uid: string) => void; confirm: string };
  /** Extra per-item controls (e.g. lock toggle). */
  extra?: (e: InvEntry) => ReactNode;
}

/**
 * Inventory browser: equipped slot strip, search/filter/sort list with loadout impact per
 * item, detail + comparison. Hovering a row previews it against the equipped item without
 * changing the selection; arrow keys move the selection, Enter equips it.
 * Stateless with respect to game data: callers pass entries and the equipped map.
 */
export function InventoryView({ entries, equipped, actions, extraFilter, header, lockedSlots = [] }: { entries: InvEntry[]; equipped: Record<SlotId, ItemInstance | null>; actions: InventoryActions; extraFilter?: boolean; header?: ReactNode; lockedSlots?: readonly SlotId[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<ViewSort>('rarity');
  const [query, setQuery] = useState('');
  const [upOnly, setUpOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState<SlotId | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const priority = useComparisonPriority();

  const equippedList = useMemo(() => SLOTS.map((s) => equipped[s.id]), [equipped]);
  const base = useScore(equippedList);
  const ctx = useScoreContext();
  const impacts = useMemo(() => {
    const m = new Map<string, SwapImpact>();
    for (const e of entries) {
      if (e.equippedIn || e.item.category === 'module' || !baseDef(e.item.defId)) continue;
      const s = defaultSlot(e.item.category, equipped, lockedSlots);
      if (s) m.set(e.item.uid, swapImpact(equippedList, e.item, equipped[s], base, priority, SLOTS.findIndex((slot) => slot.id === s), ctx));
    }
    return m;
  }, [entries, equipped, equippedList, base, priority, lockedSlots, ctx]);

  const list = useMemo(() => {
    const f = entries.filter((e) => (filter === 'all' ? true : filter === 'unsecured' ? e.status === 'unsecured' : e.item.category === filter) && matchesQuery(e.item, query) && (!upOnly || impacts.get(e.item.uid)?.verdict === 'upgrade'));
    if (sort !== 'impact') return sortEntries(f, sort);
    return [...f].sort((a, b) => (impacts.get(b.item.uid)?.score ?? -9) - (impacts.get(a.item.uid)?.score ?? -9));
  }, [entries, filter, sort, query, upOnly, impacts]);
  const selected = (upOnly ? list : entries).find((e) => e.item.uid === sel) ?? list[0] ?? null;
  const hovered = hover ? list.find((e) => e.item.uid === hover) ?? null : null;
  const shownEntry = hovered ?? selected;
  const item = selected?.item ?? null;
  const shown = shownEntry?.item ?? null;
  // Slots the warden has not unlocked are never offered (staged unlocks).
  const slots = shown ? slotsFor(shown.category).filter((s) => !lockedSlots.includes(s)) : [];
  const slot = targetSlot && slots.includes(targetSlot) ? targetSlot : shown ? defaultSlot(shown.category, equipped, lockedSlots) : null;
  const against = slot ? equipped[slot] : null;
  const selectedImpact = item && shown === item && slot && selected && !selected.equippedIn && impacts.has(item.uid)
    ? swapImpact(equippedList, item, against, base, priority, SLOTS.findIndex((s) => s.id === slot), ctx)
    : null;
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: entries.length, unsecured: entries.filter((e) => e.status === 'unsecured').length };
    for (const e of entries) m[e.item.category] = (m[e.item.category] ?? 0) + 1;
    return m;
  }, [entries]);
  const upgrades = useMemo(() => [...impacts.values()].filter((i) => i.verdict === 'upgrade').length, [impacts]);

  // Keyboard: arrows move the selection, Enter equips (ignored while typing in the search box).
  const stateRef = useRef({ list, selected, slot, canChange: actions.canChange });
  stateRef.current = { list, selected, slot, canChange: actions.canChange };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return;
      const { list: l, selected: cur, slot: sl, canChange } = stateRef.current;
      if (ev.code === 'ArrowDown' || ev.code === 'ArrowUp') {
        ev.preventDefault();
        const i = Math.max(0, l.findIndex((e) => e.item.uid === cur?.item.uid));
        const next = l[Math.min(l.length - 1, Math.max(0, i + (ev.code === 'ArrowDown' ? 1 : -1)))];
        if (next) {
          setSel(next.item.uid);
          setHover(null);
          setConfirm(null);
          listRef.current?.querySelector(`[data-uid="${next.item.uid}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      } else if (ev.code === 'Enter' && cur && !cur.equippedIn && canChange && cur.item.category !== 'module' && baseDef(cur.item.defId)) {
        ev.preventDefault();
        actions.equip(cur.item.uid, sl ?? undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  return (
    <div className="inv">
      <div className="inv-slots">
        {SLOTS.map((s) => {
          const it = equipped[s.id];
          const r = it ? rarity(it.rarity) : null;
          return (
            <button key={s.id} className={`inv-slot ${it ? 'filled' : ''} ${shown && it?.uid === shown.uid ? 'sel' : ''} ${against && it?.uid === against.uid && shown?.uid !== it.uid ? 'vs' : ''}`} style={r ? { ['--rc' as string]: r.color } : undefined} onClick={() => it && setSel(it.uid)}>
              <span className="font-mono text-[9px] tracking-[0.14em] text-faint">{s.label}</span>
              {it ? <ItemGlyph item={it} size={28} /> : <span className="text-faint leading-[30px]">—</span>}
              <b>{it ? it.name : 'EMPTY'}</b>
              {it && <em>LV {fmtNum(it.level)}</em>}
            </button>
          );
        })}
      </div>
      {header}
      <ComparisonPriorityPicker />
      <div className="inv-main">
        <div className="inv-list-col">
          <div className="inv-search">
            <input type="search" placeholder="Search name, rarity, stat…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="inv-search" />
            <button className={`upg ${upOnly ? 'on' : ''}`} onClick={() => setUpOnly((v) => !v)} title="Show upgrades for the selected comparison priority" aria-pressed={upOnly}>
              ▲ UPGRADES <i>{upgrades}</i>
            </button>
          </div>
          <div className="inv-filters">
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'ALL' : catLabel(f).replace('UPGRADE ', '')}
                <i>{counts[f] ?? 0}</i>
              </button>
            ))}
            {extraFilter && (
              <button className={`unsec ${filter === 'unsecured' ? 'on' : ''}`} onClick={() => setFilter('unsecured')}>
                UNSECURED<i>{counts.unsecured}</i>
              </button>
            )}
          </div>
          <div className="inv-sort">
            SORT
            {(['rarity', 'level', 'impact', 'newest', 'name'] as ViewSort[]).map((s) => (
              <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
                {s === 'impact' ? 'BEST FIRST' : s.toUpperCase()}
              </button>
            ))}
            <span className="kbd-hint">
              <kbd>↑</kbd>
              <kbd>↓</kbd> select · <kbd>⏎</kbd> equip
            </span>
          </div>
          <div className="inv-list" ref={listRef} onMouseLeave={() => setHover(null)}>
            {list.length === 0 && <div className="empty-state small">{query || upOnly ? 'No items match.' : 'No items in this category.'}</div>}
            {list.map((e) => (
              <ItemCard
                key={e.item.uid}
                e={e}
                selected={e.item.uid === item?.uid}
                onSelect={() => (setSel(e.item.uid), setConfirm(null))}
                onHover={(on) => setHover(on ? e.item.uid : null)}
                impact={impacts.get(e.item.uid)}
              />
            ))}
          </div>
        </div>
        <div className={`inv-detail-col ${hovered && hovered !== selected ? 'previewing' : ''}`}>
          {!shownEntry || !shown ? (
            <div className="empty-state">
              <div className="empty-ico">∅</div>
              <b>Nothing selected</b>
            </div>
          ) : (
            <>
              {hovered && hovered !== selected && <div className="preview-flag">HOVER PREVIEW · click to select</div>}
              <div className={`detail-split ${!shownEntry.equippedIn && shown.category !== 'module' ? 'two' : ''}`}>
                <div className="ds-item">
                  <EquippedItemsContext.Provider value={equippedList}>
                    <ItemDetail item={shown} status={shownEntry.equippedIn ? 'equipped' : shownEntry.status} />
                  </EquippedItemsContext.Provider>
                </div>
                {!shownEntry.equippedIn && shown.category !== 'module' && (
                  <div className="ds-compare">
                    {slots.length > 1 && (
                      <div className="slot-pick">
                        TARGET SLOT
                        {slots.map((s) => (
                          <button key={s} className={slot === s ? 'on' : ''} onClick={() => setTargetSlot(s)}>
                            {getSlot(s).label}
                          </button>
                        ))}
                      </div>
                    )}
                    <ComparePanel item={shown} against={against} equipped={equippedList} slot={slot} />
                  </div>
                )}
              </div>
              {selected && item && shown === item && (
                <div className="inv-actions">
                  {item.category !== 'module' && !selected.equippedIn && baseDef(item.defId) && (
                    <button className="primary small" disabled={!actions.canChange} onClick={() => actions.equip(item.uid, slot ?? undefined)}>
                      EQUIP{slot ? ` · ${getSlot(slot).label}` : ''}
                      {selectedImpact && <VerdictTag impact={selectedImpact} />}
                    </button>
                  )}
                  {selected.equippedIn && (
                    <button disabled={!actions.canChange || getSlot(selected.equippedIn).required} onClick={() => actions.unequip(selected.equippedIn!)}>
                      {getSlot(selected.equippedIn).required ? 'REQUIRED SLOT' : 'UNEQUIP'}
                    </button>
                  )}
                  {actions.remove &&
                    actions.remove.allowed(selected) &&
                    (confirm === item.uid ? (
                      <div className="confirm-row">
                        <span>{actions.remove.confirm}</span>
                        <button
                          className="danger"
                          onClick={() => {
                            actions.remove!.run(item.uid);
                            setConfirm(null);
                            setSel(null);
                          }}
                        >
                          CONFIRM
                        </button>
                        <button onClick={() => setConfirm(null)}>CANCEL</button>
                      </div>
                    ) : (
                      <button className="danger" disabled={!actions.canChange} onClick={() => setConfirm(item.uid)}>
                        {actions.remove.label(selected)}
                      </button>
                    ))}
                  {actions.extra?.(selected)}
                  {!actions.canChange && <div className="locked-note">{actions.lockedReason}</div>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
