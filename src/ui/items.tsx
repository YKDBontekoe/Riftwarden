import { signatureDef } from '../loot/signatures';
import { type ReactNode, useMemo, useState } from 'react';
import { formatModifier, STAT_DEFS } from '../combat/stats';
import { affixDef } from '../loot/affixes';
import { baseDef, type IconKind } from '../loot/bases';
import { compareItems, statPreview, weaponDefFor, weaponSummary } from '../loot/equipment';
import { RARITIES, rarity } from '../loot/rarity';
import { CATEGORY_LABEL, type Category, type ItemInstance } from '../loot/types';
import { getSlot, type SlotId, SLOTS, slotsFor } from '../progression/items';
import { fmtNum } from '../combat/stats';
import { buildComponents, FAMILIES, SOCKET_LABEL } from '../weapons/build';
import { describeEffects } from '../weapons/components';
import { moduleTypeDef } from '../weapons/modules';
import { enhanceLevel, enhanceStatMult, maxEnhance } from '../economy/config';

const CATEGORY_ICON: Record<Category, IconKind> = { weapon: 'rifle', armor: 'plate', shield: 'ring', reactor: 'core', processor: 'chip', accessory: 'gem', module: 'cube' };

/** Inline SVG glyph per base icon kind (matches the pickup holograms). */
export function ItemGlyph({ item, size = 34 }: { item: Pick<ItemInstance, 'defId' | 'rarity' | 'category'>; size?: number }) {
  const kind: IconKind = baseDef(item.defId)?.icon ?? CATEGORY_ICON[item.category] ?? 'cube';
  const c = rarity(item.rarity).color;
  return (
    <svg className="glyph" viewBox="0 0 40 40" width={size} height={size} style={{ ['--rc' as string]: c }}>
      <rect x="1" y="1" width="38" height="38" className="gl-bg" />
      {kind === 'rifle' && (
        <>
          <path d="M6 22 H30 V17 H6 Z" className="gl-body" />
          <path d="M30 19 H36" className="gl-line" />
          <path d="M11 22 L9 29 H13 L15 22" className="gl-body" />
          <path d="M9 19.5 H26" className="gl-glow" />
        </>
      )}
      {kind === 'plate' && (
        <>
          <path d="M20 6 L32 13 V27 L20 34 L8 27 V13 Z" className="gl-body" />
          <path d="M20 13 L26 16.5 V23.5 L20 27 L14 23.5 V16.5 Z" className="gl-glow-fill" />
        </>
      )}
      {kind === 'ring' && (
        <>
          <circle cx="20" cy="20" r="12" className="gl-glow" />
          <circle cx="20" cy="20" r="5" className="gl-body" />
        </>
      )}
      {kind === 'core' && (
        <>
          <rect x="14" y="8" width="12" height="24" className="gl-body" />
          <rect x="17.5" y="8" width="5" height="24" className="gl-glow-fill" />
          <ellipse cx="20" cy="20" rx="11" ry="4" className="gl-line" />
        </>
      )}
      {kind === 'chip' && (
        <>
          <rect x="11" y="11" width="18" height="18" className="gl-body" />
          <rect x="16" y="16" width="8" height="8" className="gl-glow-fill" />
          <path d="M14 7 V11 M20 7 V11 M26 7 V11 M14 29 V33 M20 29 V33 M26 29 V33" className="gl-line" />
        </>
      )}
      {kind === 'gem' && (
        <>
          <path d="M20 6 L30 16 L20 34 L10 16 Z" className="gl-glow-fill" />
          <path d="M10 16 H30" className="gl-line" />
        </>
      )}
      {kind === 'cube' && (
        <>
          <path d="M20 7 L32 14 V27 L20 34 L8 27 V14 Z" className="gl-body" />
          <path d="M20 7 V20 M8 14 L20 20 L32 14" className="gl-glow" />
        </>
      )}
    </svg>
  );
}

export function RarityTag({ id }: { id: string }) {
  const r = rarity(id);
  return (
    <span className={`rtag r-${r.id}`} style={{ ['--rc' as string]: r.color }}>
      {r.label.toUpperCase()}
    </span>
  );
}

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

function catLabel(c: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[c]?.toUpperCase() ?? c.toUpperCase();
}

/** Display name with enhancement level ("Rail Lancer +3"). */
export function itemTitle(it: ItemInstance): string {
  const e = enhanceLevel(it);
  return e > 0 ? `${it.name} +${e}` : it.name;
}

/** One line in an item list. `right` replaces the status tag (prices); `check` turns it into a multi-select row. */
export function ItemCard({ e, selected, onSelect, compareTo, right, check, disabled }: { e: InvEntry; selected: boolean; onSelect: () => void; compareTo?: ItemInstance | null; right?: ReactNode; check?: boolean; disabled?: boolean }) {
  const it = e.item;
  const r = rarity(it.rarity);
  const known = !!baseDef(it.defId);
  let hint: ReactNode = null;
  if (compareTo && compareTo.uid !== it.uid && !e.equippedIn && it.category !== 'module') {
    const rows = compareItems(it, compareTo);
    const up = rows.filter((x) => x.verdict > 0).length;
    const down = rows.filter((x) => x.verdict < 0).length;
    hint = (
      <span className="cmp-hint">
        {up > 0 && <i className="up">▲{up}</i>}
        {down > 0 && <i className="down">▼{down}</i>}
      </span>
    );
  }
  return (
    <button className={`icard r-${r.id} ${selected ? 'sel' : ''} ${e.status} ${disabled ? 'dis' : ''}`} style={{ ['--rc' as string]: r.color }} onClick={onSelect} data-uid={it.uid}>
      {check !== undefined && <i className={`ic-check ${check ? 'on' : ''}`} />}
      <ItemGlyph item={it} />
      <span className="ic-main">
        <b>
          {itemTitle(it)}
          {it.locked && <i className="ic-lock" title="Locked: protected from selling and dismantling" />}
        </b>
        <em>
          {known ? catLabel(it.category) : 'UNKNOWN DEFINITION'} · LV {fmtNum(it.level)}
        </em>
      </span>
      {hint}
      {right ?? <span className={`ic-status s-${e.status}`}>{e.equippedIn ? getSlot(e.equippedIn).label : STATUS_LABEL[e.status]}</span>}
    </button>
  );
}

export function TierPips({ tier }: { tier: number }) {
  return (
    <span className="pips" title={`Tier ${tier}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < tier ? 'on' : ''} />
      ))}
    </span>
  );
}

/** Full item readout: identity, base stats, affixes, weapon block, sockets/modules. */
export function ItemDetail({ item, status }: { item: ItemInstance; status?: EntryStatus }) {
  const base = baseDef(item.defId);
  const r = rarity(item.rarity);
  const w = weaponDefFor(item);
  const ws = w ? weaponSummary(w) : null;
  return (
    <div className="idetail" style={{ ['--rc' as string]: r.color }}>
      <div className="id-head">
        <ItemGlyph item={item} size={54} />
        <div>
          <div className="id-name">{itemTitle(item)}</div>
          <div className="id-meta">
            <RarityTag id={item.rarity} /> <span>LV {fmtNum(item.level)}</span> <span>{catLabel(item.category)}</span>
            {enhanceLevel(item) > 0 && (
              <span className="enh-tag">
                ENHANCED +{enhanceLevel(item)}/{maxEnhance(item)}
              </span>
            )}
            {item.locked && <span className="lock-tag">LOCKED</span>}
            {item.source === 'crafted' && <span className="src-tag">FABRICATED</span>}
            {item.source === 'merchant' && <span className="src-tag">MERCHANT STOCK</span>}
            {status && <span className={`ic-status s-${status}`}>{STATUS_LABEL[status]}</span>}
          </div>
        </div>
      </div>
      <p className="id-blurb">{base ? base.blurb : 'This item’s definition is missing from this build. It is kept safely in storage but cannot be equipped.'}</p>
      {ws && w && <WeaponBlock item={item} />}
      {item.base.length > 0 && (
        <div className="id-block">
          <div className="id-label">BASE</div>
          {item.base.map((s, i) => {
            const m = enhanceStatMult(item, s.stat, s.value, 'base');
            return (
              <div key={i} className="id-row">
                <span>{STAT_DEFS[s.stat].label}</span>
                {m !== 1 && <small className="enh-up">+{Math.round((m - 1) * 100)}%</small>}
                <b className={(s.value < 0) !== (STAT_DEFS[s.stat].better === 'lower') && s.value !== 0 ? 'neg' : ''}>{formatModifier(s.stat, s.op, s.value * m)}</b>
              </div>
            );
          })}
        </div>
      )}
      {signatureDef(item.signature) && (
        <div className="id-block signature" data-testid="item-signature">
          <div className="id-label">SIGNATURE · {signatureDef(item.signature)!.exotic ? 'EXOTIC' : 'LEGENDARY'}</div>
          <div className="sig-name">{signatureDef(item.signature)!.name}</div>
          <div className="sig-text">{signatureDef(item.signature)!.text}</div>
        </div>
      )}
      <div className="id-block">
        <div className="id-label">{item.category === 'module' ? `MODULE AFFIXES · ${item.affixes.length}` : `AFFIXES · ${item.affixes.length}`}</div>
        {item.affixes.length === 0 && <div className="id-none">No affixes</div>}
        {item.affixes.map((a, i) => {
          const m = enhanceStatMult(item, a.stat, a.value, 'affix');
          return (
            <div key={i} className={`id-row affix ${a.locked ? 'locked' : ''}`}>
              <span>
                {a.locked && <i className="ic-lock" title="Locked affix: kept by full recalibration" />}
                {STAT_DEFS[a.stat].label}
                <small>{affixDef(a.id)?.adjective ?? ''}</small>
              </span>
              {m !== 1 && <small className="enh-up">+{Math.round((m - 1) * 100)}%</small>}
              <TierPips tier={a.tier} />
              <b>{formatModifier(a.stat, a.op, a.value * m)}</b>
            </div>
          );
        })}
      </div>
      {item.category === 'module' && item.module && <ModuleNote item={item} />}
    </div>
  );
}

const MECH_LABEL: Record<string, string> = { auto: 'AUTOMATIC', burst: '3-ROUND BURST', charge: 'CHARGE & RELEASE', cycle: 'AUTO-CYCLE', beam: 'CONTINUOUS BEAM' };

/** Weapon readout: family, firing mechanism, effective numbers, generated components and sockets. */
export function WeaponBlock({ item, compact }: { item: ItemInstance; compact?: boolean }) {
  const w = weaponDefFor(item);
  if (!w) return null;
  const ws = weaponSummary(w);
  const fam = FAMILIES[w.family];
  const comps = item.build ? buildComponents(item.build) : [];
  return (
    <>
      <div className="id-block">
        <div className="id-label">
          {fam.label.toUpperCase()} · {MECH_LABEL[w.mechanism] ?? w.mechanism}
        </div>
        <div className="id-row">
          <span>{w.mechanism === 'pulse' ? 'Damage / pulse (splash 60%) · pulses/s' : w.mechanism === 'scatter' ? 'Damage / pellet ×7 · shots/s' : w.family === 'beam' ? 'Damage / tick · ticks/s' : w.family === 'rail' && w.mechanism === 'charge' ? 'Damage (full charge) · cycle' : 'Damage / shot · fire rate'}</span>
          <b>
            {fmtNum(w.damage)} · {fmtNum(w.fireRate)}/s
          </b>
        </div>
        <div className="id-row">
          <span>Sustained DPS (base)</span>
          <b>{fmtNum(ws.dps)}</b>
        </div>
        <div className="id-row">
          <span>Range</span>
          <b>{fmtNum(w.range)} m</b>
        </div>
        <div className="id-row">
          <span>Heat / {w.family === 'beam' ? 'tick' : 'shot'} · fire time to overheat</span>
          <b>
            {fmtNum(w.heatPerShot)}% · {fmtNum(ws.sustain)} s
          </b>
        </div>
        <div className="id-row">
          <span>Cooling</span>
          <b>{fmtNum(w.coolRate)}%/s</b>
        </div>
        {w.family === 'rail' && (
          <div className="id-row">
            <span>{w.mechanism === 'charge' ? 'Charge time · pierce' : 'Pierce'}</span>
            <b>
              {w.mechanism === 'charge' ? `${fmtNum(w.chargeTime)} s · ` : ''}
              {w.pierce} extra target{w.pierce === 1 ? '' : 's'}
            </b>
          </div>
        )}
        {w.family === 'beam' && (
          <div className="id-row">
            <span>Ramp ceiling · beam width</span>
            <b>
              ×{fmtNum(w.rampMax)} in {fmtNum(w.rampTime)} s · {fmtNum(w.beamWidth)} m
            </b>
          </div>
        )}
      </div>
      {!compact && comps.length > 0 && (
        <div className="id-block">
          <div className="id-label">COMPONENTS</div>
          {comps.map((c) => {
            const fx = describeEffects(c.effects);
            return (
              <div key={c.id} className="id-row comp">
                <span>
                  {c.name}
                  <small>{c.slot}</small>
                </span>
                <b className="comp-fx">
                  {fx.length ? fx.map((f, k) => (
                    <em key={k} className={f.good ? 'up' : 'down'}>
                      {f.text}
                    </em>
                  )) : <em className="faint">cosmetic</em>}
                </b>
              </div>
            );
          })}
        </div>
      )}
      <div className="id-block">
        <div className="id-label">MODULE SOCKETS · {item.sockets}</div>
        {item.sockets === 0 && <div className="id-none">No sockets (uncommon and better weapons have 1–4)</div>}
        {item.build?.sockets.map((k, i) => {
          const m = item.socketed[i];
          return (
            <div key={i} className={`id-row socket ${m ? 'filled' : ''}`} style={m ? { ['--rc' as string]: rarity(m.rarity).color } : undefined}>
              <span>
                <i className={`sock-ico k-${k}`} /> {SOCKET_LABEL[k]}
              </span>
              <b>{m ? itemTitle(m) : 'EMPTY'}</b>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ModuleNote({ item }: { item: ItemInstance }) {
  const def = moduleTypeDef(item.module?.type);
  if (!def) return <div className="id-note">Unknown module type: kept in storage, cannot be installed.</div>;
  return (
    <div className="id-note">
      {def.blurb} Fits a <b>{SOCKET_LABEL[def.socket]}</b> socket on{' '}
      <b>{def.families.length === 3 ? 'any weapon family' : def.families.map((f) => FAMILIES[f].label).join(' · ')}</b>. Install it at the HQ workshop; it takes effect while that weapon
      is equipped.
    </div>
  );
}

/** Raw comparison (item vs item) and effective drone stats before/after. */
export function ComparePanel({ item, against, equipped }: { item: ItemInstance; against: ItemInstance | null; equipped: (ItemInstance | null)[] }) {
  const rows = useMemo(() => compareItems(item, against), [item, against]);
  const preview = useMemo(() => (item.category === 'module' ? [] : statPreview(equipped, item, against)), [item, against, equipped]);
  if (item.category === 'module') return null;
  return (
    <div className="compare">
      <div className="id-label">
        VS {against ? <b style={{ color: rarity(against.rarity).color }}>{against.name}</b> : 'EMPTY SLOT'} {against && <span className="faint">LV {fmtNum(against.level)}</span>}
      </div>
      <table className="cmp-table">
        <thead>
          <tr>
            <th>ITEM STAT</th>
            <th>THIS</th>
            <th>EQUIPPED</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.verdict > 0 ? 'up' : r.verdict < 0 ? 'down' : ''}>
              <td>{r.label}</td>
              <td>
                {r.a || '—'} {r.verdict > 0 ? '▲' : r.verdict < 0 ? '▼' : ''}
              </td>
              <td>{r.b || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.length > 0 && (
        <>
          <div className="id-label">DRONE STATS IF EQUIPPED</div>
          <table className="cmp-table">
            <tbody>
              {preview.map((r) => (
                <tr key={r.stat} className={r.verdict > 0 ? 'up' : r.verdict < 0 ? 'down' : ''}>
                  <td>{r.label}</td>
                  <td>{r.before}</td>
                  <td>
                    → {r.after} {r.verdict > 0 ? '▲' : r.verdict < 0 ? '▼' : ''}
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

type Filter = 'all' | Category | 'unsecured';
type Sort = 'rarity' | 'level' | 'newest' | 'name';

const FILTERS: Filter[] = ['all', 'weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'module'];

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
 * Inventory browser: equipped slot strip, filter/sort list, detail + comparison.
 * Stateless with respect to game data: callers pass entries and the equipped map.
 */
export function InventoryView({ entries, equipped, actions, extraFilter, header }: { entries: InvEntry[]; equipped: Record<SlotId, ItemInstance | null>; actions: InventoryActions; extraFilter?: boolean; header?: ReactNode }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('rarity');
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState<SlotId | null>(null);

  const list = useMemo(() => {
    const f = entries.filter((e) => (filter === 'all' ? true : filter === 'unsecured' ? e.status === 'unsecured' : e.item.category === filter));
    return sortEntries(f, sort);
  }, [entries, filter, sort]);
  const selected = entries.find((e) => e.item.uid === sel) ?? list[0] ?? null;
  const item = selected?.item ?? null;
  const slots = item ? slotsFor(item.category) : [];
  const slot = targetSlot && slots.includes(targetSlot) ? targetSlot : (slots.find((s) => !equipped[s]) ?? slots[0] ?? null);
  const against = slot ? equipped[slot] : null;
  const equippedList = SLOTS.map((s) => equipped[s.id]);
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: entries.length, unsecured: entries.filter((e) => e.status === 'unsecured').length };
    for (const e of entries) m[e.item.category] = (m[e.item.category] ?? 0) + 1;
    return m;
  }, [entries]);

  return (
    <div className="inv">
      <div className="inv-slots">
        {SLOTS.map((s) => {
          const it = equipped[s.id];
          const r = it ? rarity(it.rarity) : null;
          return (
            <button key={s.id} className={`inv-slot ${it ? 'filled' : ''} ${item && it?.uid === item.uid ? 'sel' : ''}`} style={r ? { ['--rc' as string]: r.color } : undefined} onClick={() => it && setSel(it.uid)}>
              <span className="is-label">{s.label}</span>
              {it ? <ItemGlyph item={it} size={28} /> : <span className="is-empty">—</span>}
              <b>{it ? it.name : 'EMPTY'}</b>
              {it && <em>LV {fmtNum(it.level)}</em>}
            </button>
          );
        })}
      </div>
      {header}
      <div className="inv-main">
        <div className="inv-list-col">
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
            {(['rarity', 'level', 'newest', 'name'] as Sort[]).map((s) => (
              <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
                {s.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="inv-list">
            {list.length === 0 && <div className="empty-state small">No items in this category.</div>}
            {list.map((e) => (
              <ItemCard key={e.item.uid} e={e} selected={e.item.uid === item?.uid} onSelect={() => (setSel(e.item.uid), setConfirm(null))} compareTo={equipped[slotsFor(e.item.category)[0] ?? 'weapon']} />
            ))}
          </div>
        </div>
        <div className="inv-detail-col">
          {!selected || !item ? (
            <div className="empty-state">
              <div className="empty-ico">∅</div>
              <b>Nothing selected</b>
            </div>
          ) : (
            <>
              <ItemDetail item={item} status={selected.equippedIn ? 'equipped' : selected.status} />
              {slots.length > 1 && !selected.equippedIn && (
                <div className="slot-pick">
                  TARGET SLOT
                  {slots.map((s) => (
                    <button key={s} className={slot === s ? 'on' : ''} onClick={() => setTargetSlot(s)}>
                      {getSlot(s).label}
                    </button>
                  ))}
                </div>
              )}
              {!selected.equippedIn && <ComparePanel item={item} against={against} equipped={equippedList} />}
              <div className="inv-actions">
                {item.category !== 'module' && !selected.equippedIn && baseDef(item.defId) && (
                  <button className="primary small" disabled={!actions.canChange} onClick={() => actions.equip(item.uid, slot ?? undefined)}>
                    EQUIP{slot ? ` · ${getSlot(slot).label}` : ''}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small legend of rarity colours (inventory header). */
export function RarityLegend() {
  return (
    <div className="rlegend">
      {RARITIES.map((r) => (
        <span key={r.id} style={{ ['--rc' as string]: r.color }}>
          <i />
          {r.label}
        </span>
      ))}
    </div>
  );
}

/** Compact list of item briefs (summary / checkpoint / defeat screens). */
export function BriefList({ items, tone }: { items: { uid: string; name: string; rarity: string; level: number; category: string }[]; tone?: 'lost' | 'secured' }) {
  if (!items.length) return null;
  return (
    <div className={`brief-list ${tone ?? ''}`}>
      {items.map((i) => (
        <div key={i.uid} className="brief" style={{ ['--rc' as string]: rarity(i.rarity).color }}>
          <ItemGlyph item={{ defId: '', rarity: i.rarity as ItemInstance['rarity'], category: i.category as Category }} size={22} />
          <b>{i.name}</b>
          <em>LV {fmtNum(i.level)}</em>
        </div>
      ))}
    </div>
  );
}
