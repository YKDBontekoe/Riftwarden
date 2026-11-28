import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { affixDef } from '@riftwarden/rules/loot/affixes';
import { baseDef } from '@riftwarden/rules/loot/bases';
import { swapImpact, type SwapImpact } from '@riftwarden/rules/loot/loadoutScore';
import { ComparisonPriorityPicker, ImpactHeadline, useComparisonPriority, useScore, useScoreContext, VerdictTag } from '../compare';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { type Category, type ItemInstance } from '@riftwarden/rules/loot/types';
import { getSlot, type SlotId, SLOTS, slotsFor, defaultSlot } from '@riftwarden/rules/progression/items';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import { ComparePanel } from './compare';
import { EquippedItemsContext, ItemDetail } from './detail';
import { InvEntry, ItemCard, catLabel } from './entry';
import { ItemGlyph } from './glyphs';
import { rarityCls } from '../ds';

type Filter = 'all' | Category | 'unsecured';

type Sort = 'rarity' | 'level' | 'newest' | 'name';

type ViewSort = Sort | 'impact';

const SORTS: ViewSort[] = ['impact', 'rarity', 'level', 'newest', 'name'];

const SORT_KEY = 'riftwarden.invSort';
/** The sort order survives closing the inventory (this device). */
function savedSort(): ViewSort {
  try {
    const v = localStorage.getItem(SORT_KEY) as ViewSort | null;
    return v && SORTS.includes(v) ? v : 'rarity';
  } catch {
    return 'rarity';
  }
}

/** Keyboard list navigation (pure): arrows step, PageUp/PageDown jump a page, Home/End go to the ends. */
export function navIndex(code: string, current: number, length: number, page = 8): number | null {
  if (length <= 0) return null;
  const i = Math.max(0, current);
  const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
  if (code === 'Home') return 0;
  if (code === 'End') return length - 1;
  if (!(code in step)) return null;
  return Math.min(length - 1, Math.max(0, i + step[code]));
}

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
  const [sort, setSortState] = useState<ViewSort>(savedSort);
  const setSort = (f: (x: ViewSort) => ViewSort) =>
    setSortState((x) => {
      const next = f(x);
      try {
        localStorage.setItem(SORT_KEY, next);
      } catch {
        /* private mode: session only */
      }
      return next;
    });
  const searchRef = useRef<HTMLInputElement>(null);
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
      if (ev.code === 'Slash' && !ev.ctrlKey && !ev.metaKey) {
        // "/" jumps to the search box, as in most list UIs.
        ev.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const to = navIndex(ev.code, l.findIndex((e) => e.item.uid === cur?.item.uid), l.length);
      if (to !== null) {
        ev.preventDefault();
        const next = l[to];
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

  const sortLabel = (x: ViewSort) => (x === 'impact' ? 'BEST FOR BUILD' : x.toUpperCase());
  const nextSort = () => setSort((x) => SORTS[(SORTS.indexOf(x) + 1) % SORTS.length]);
  return (
    <div className="inv inv-ds">
      <div className="inv-slots">
        {SLOTS.map((s) => {
          const it = equipped[s.id];
          return (
            <button key={s.id} className={`inv-slot ds-tile ${it ? rarityCls(it.rarity) : 'empty'} ${it ? 'filled' : ''} ${shown && it?.uid === shown.uid ? 'sel on' : ''} ${against && it?.uid === against.uid && shown?.uid !== it.uid ? 'vs' : ''}`} title={it ? `${s.label}: ${it.name}` : `${s.label}: empty`} onClick={() => it && setSel(it.uid)}>
              <span className="is-label">{s.label}</span>
              {it ? <span className="ds-tile-art"><ItemGlyph item={it} size={34} /></span> : <span className="is-empty">+</span>}
              <b>{it ? it.name : 'EMPTY'}</b>
              {it && <em className="ds-lv">{fmtNum(it.level)}</em>}
            </button>
          );
        })}
      </div>
      {header}
      <div className="inv-main">
        <div className="inv-list-col">
          <div className="inv-filters">
            {FILTERS.filter((f) => f === 'all' || (counts[f] ?? 0) > 0 || f === filter).map((f) => (
              <button key={f} className={`ds-chip ${filter === f ? 'on solid' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'ALL' : catLabel(f).replace('UPGRADE ', '')}
                <i>{counts[f] ?? 0}</i>
              </button>
            ))}
            {extraFilter && (
              <button className={`ds-chip risk unsec ${filter === 'unsecured' ? 'on' : ''}`} onClick={() => setFilter('unsecured')}>
                UNSECURED<i>{counts.unsecured}</i>
              </button>
            )}
          </div>
          <div className="inv-search">
            <input
              ref={searchRef}
              type="search"
              placeholder="Search name, rarity, stat…  ( / )"
              aria-label="Search items"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Esc clears the search first, then leaves the box; arrows hand the keyboard back to the list.
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  if (query) setQuery('');
                  else e.currentTarget.blur();
                } else if (e.key === 'ArrowDown' || e.key === 'Enter') e.currentTarget.blur();
              }}
              data-testid="inv-search"
            />
            <button className={`upg ds-chip ${upOnly ? 'on green' : ''}`} onClick={() => setUpOnly((v) => !v)} title="Show upgrades for the selected comparison priority" aria-pressed={upOnly}>
              ▲ UPGRADES ONLY <i>{upgrades}</i>
            </button>
            <button className="inv-sort ds-chip" onClick={nextSort} title="Change the sort order">SORT · {sortLabel(sort)}</button>
          </div>
          <div className="inv-list" ref={listRef} onMouseLeave={() => setHover(null)}>
            {list.length === 0 && <div className="empty-state small">{query || upOnly ? 'No items match.' : entries.length ? 'No items in this category.' : 'Nothing here yet. Secure loot at checkpoints to fill it.'}</div>}
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
          <div className="inv-legend ds-meta">▲ upgrade for your build · ◆ sidegrade · ▼ downgrade · hover a tile to compare</div>
        </div>
        <div className={`inv-detail-col ${hovered && hovered !== selected ? 'previewing' : ''}`}>
          {!shownEntry || !shown ? (
            <div className="empty-state">
              <b>Nothing selected</b>
              <span className="ds-meta">Pick a tile to see what it changes.</span>
            </div>
          ) : (
            <>
              {!shownEntry.equippedIn && shown.category !== 'module' && (
                <div className="vs-head">
                  <div className="ds-col vs-side">
                    <span className="ds-lbl">{slot ? getSlot(slot).label : 'Equipped'}</span>
                    <div className={`ds-tile ${against ? rarityCls(against.rarity) : 'empty'}`}>{against ? <span className="ds-tile-art"><ItemGlyph item={against} size={70} /></span> : <span className="is-empty">EMPTY</span>}{against && <span className="ds-lv">{fmtNum(against.level)}</span>}</div>
                    <span className="ds-h3 vs-name">{against?.name ?? 'Nothing equipped'}</span>
                  </div>
                  <div className="ds-col vs-side">
                    <span className="ds-lbl ds-em">{hovered && hovered !== selected ? 'Hover preview' : 'Selected'}</span>
                    <div className={`ds-tile on ${rarityCls(shown.rarity)}`}><span className="ds-tile-art"><ItemGlyph item={shown} size={70} /></span><span className="ds-lv">{fmtNum(shown.level)}</span></div>
                    <span className="ds-h3 vs-name">{shown.name}</span>
                  </div>
                </div>
              )}
              {!shownEntry.equippedIn && shown.category !== 'module' && <ImpactHeadline impact={impacts.get(shown.uid)} />}
              {hovered && hovered !== selected && <div className="preview-flag">HOVER PREVIEW · click to select</div>}
              <ComparisonPriorityPicker />
              <div className={`detail-split ${!shownEntry.equippedIn && shown.category !== 'module' ? 'two' : ''}`}>
                {!shownEntry.equippedIn && shown.category !== 'module' && (
                  <div className="split-compare">
                    {slots.length > 1 && (
                      <div className="slot-pick">
                        TARGET SLOT
                        {slots.map((s) => (
                          <button key={s} className={`ds-chip ${slot === s ? 'on solid' : ''}`} onClick={() => setTargetSlot(s)}>
                            {getSlot(s).label}
                          </button>
                        ))}
                      </div>
                    )}
                    <ComparePanel item={shown} against={against} equipped={equippedList} slot={slot} />
                  </div>
                )}
                <div className="split-item">
                  <EquippedItemsContext.Provider value={equippedList}>
                    <ItemDetail item={shown} status={shownEntry.equippedIn ? 'equipped' : shownEntry.status} />
                  </EquippedItemsContext.Provider>
                </div>
              </div>
            </>
          )}
          {selected && item && (!shown || shown === item) && (
            <div className="inv-actions">
              {actions.remove &&
                actions.remove.allowed(selected) &&
                (confirm === item.uid ? (
                  <div className="confirm-row">
                    <span>{actions.remove.confirm}</span>
                    <button
                      className="danger ds-btn ds-danger"
                      onClick={() => {
                        actions.remove!.run(item.uid);
                        setConfirm(null);
                        setSel(null);
                      }}
                    >
                      CONFIRM
                    </button>
                    <button className="ds-btn" onClick={() => setConfirm(null)}>CANCEL</button>
                  </div>
                ) : (
                  <button className="danger ds-btn ds-danger" disabled={!actions.canChange} onClick={() => setConfirm(item.uid)}>
                    {actions.remove.label(selected)}
                  </button>
                ))}
              {actions.extra?.(selected)}
              {!actions.canChange && <div className="locked-note">{actions.lockedReason}</div>}
              <span className="ds-grow" />
              {selected.equippedIn && (
                <button className="ds-btn" disabled={!actions.canChange || getSlot(selected.equippedIn).required} onClick={() => actions.unequip(selected.equippedIn!)}>
                  {getSlot(selected.equippedIn).required ? 'REQUIRED SLOT' : 'UNEQUIP'}
                </button>
              )}
              {item.category !== 'module' && !selected.equippedIn && baseDef(item.defId) && (
                <button className="primary small ds-btn-p term-primary" data-key="ENTER" disabled={!actions.canChange} onClick={() => actions.equip(item.uid, slot ?? undefined)}>
                  <span className="ds-kd">ENTER</span>EQUIP{slot ? ` · ${getSlot(slot).label}` : ''}
                  {selectedImpact && <VerdictTag impact={selectedImpact} />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
