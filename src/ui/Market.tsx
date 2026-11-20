import { useMemo, useState } from 'react';
import type { Flow } from '../core/Flow';
import { buyPrice, type Cost, dismantleYield, MARKET, sellPrice } from '../economy/config';
import { type MarketEntry, type MerchantId } from '../economy/market';
import { qualityOdds, QUALITIES, type QualityDef, type Recipe, recipeBases, RECIPES, unlockedFor } from '../economy/recipes';
import { craftCostFor, fabricationLevel, previewDismantle, protectionReason, refreshCost } from '../economy/transactions';
import { fmtNum } from '../combat/stats';
import { rarity, RARITIES } from '../loot/rarity';
import { CATEGORY_LABEL, type Category, type ItemInstance } from '../loot/types';
import { defaultSlot, SLOTS, slotsFor } from '../progression/items';
import { swapImpact } from '../loot/loadoutScore';
import { useScore } from './compare';
import { type SaveData } from '../progression/save';
import { FAMILIES, SOCKET_LABEL } from '../weapons/build';
import { canInstall, moduleTypeDef } from '../weapons/modules';
import { useSave } from './App';
import { ConfirmButton, CostLine, costText, ResourceBar, TxMessage, useTx } from './economy';
import { ComparePanel, type InvEntry, ItemCard, ItemDetail, itemTitle, RarityTag, sortEntries } from './items';
import { Shell } from './shell';
import { saveEntries, useEquipped } from './Terminals';

const asEntry = (item: ItemInstance): InvEntry => ({ item, status: 'stored', equippedIn: null });
const catShort = (c: string) => ((CATEGORY_LABEL as Record<string, string>)[c] ?? c).replace('Upgrade ', '').toUpperCase();

function Tabs<T extends string>({ tabs, value, set }: { tabs: [T, string][]; value: T; set: (t: T) => void }) {
  return (
    <div className="tabs term-tabs">
      {tabs.map(([id, label]) => (
        <button key={id} className={value === id ? 'on' : ''} data-tab={id} onClick={() => set(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function CategoryChips({ cats, value, set, counts }: { cats: Category[]; value: Category | 'all'; set: (c: Category | 'all') => void; counts: Record<string, number> }) {
  return (
    <div className="inv-filters">
      {(['all', ...cats] as (Category | 'all')[]).map((c) => (
        <button key={c} className={value === c ? 'on' : ''} onClick={() => set(c)}>
          {c === 'all' ? 'ALL' : catShort(c)}
          <i>{counts[c] ?? 0}</i>
        </button>
      ))}
    </div>
  );
}

function countBy(items: ItemInstance[]): Record<string, number> {
  const m: Record<string, number> = { all: items.length };
  for (const i of items) m[i.category] = (m[i.category] ?? 0) + 1;
  return m;
}

/** Owned weapons with a socket (free or occupied) that fits a module, for compatibility readouts. */
function moduleFits(save: SaveData, module: ItemInstance): { weapon: ItemInstance; free: number; total: number }[] {
  const out: { weapon: ItemInstance; free: number; total: number }[] = [];
  for (const e of saveEntries(save)) {
    const w = e.item;
    if (w.category !== 'weapon' || !w.build) continue;
    let free = 0;
    let total = 0;
    w.build.sockets.forEach((_, i) => {
      const probe = { ...w, socketed: w.socketed.map((m, j) => (j === i ? null : m)) };
      if (canInstall(probe, i, module).ok) {
        total++;
        if (!w.socketed[i]) free++;
      }
    });
    if (total) out.push({ weapon: w, free, total });
  }
  return out;
}

export function ModuleCompat({ save, module }: { save: SaveData; module: ItemInstance }) {
  const def = moduleTypeDef(module.module?.type);
  const fits = moduleFits(save, module);
  return (
    <div className="id-block compat">
      <div className="id-label">COMPATIBILITY</div>
      <div className="id-row">
        <span>Socket · families</span>
        <b>
          {def ? SOCKET_LABEL[def.socket] : '?'} · {def ? (def.families.length === 3 ? 'ALL FAMILIES' : def.families.map((f) => FAMILIES[f].label.toUpperCase()).join(', ')) : '—'}
        </b>
      </div>
      {fits.length === 0 && <div className="id-none">None of your weapons has a matching socket (sockets come with uncommon+ weapons).</div>}
      {fits.map((f) => (
        <div key={f.weapon.uid} className="id-row" style={{ ['--rc' as string]: rarity(f.weapon.rarity).color }}>
          <span className="rc">{itemTitle(f.weapon)}</span>
          <b className={f.free ? 'good' : 'faint'}>{f.free ? `${f.free} FREE` : 'OCCUPIED'} / {f.total}</b>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ merchants

/** Equipment exchange (merchant = 'equipment') and module broker (merchant = 'modules'). */
export function MerchantTerminal({ flow, close, merchant }: { flow: Flow; close: () => void; merchant: MerchantId }) {
  const save = useSave(flow);
  const isModules = merchant === 'modules';
  const [tab, setTab] = useState<'buy' | 'sell' | 'exchange'>('buy');
  const tx = useTx(flow, merchant === 'equipment' ? 'merchant' : 'modules');
  return (
    <Shell
      code={isModules ? 'MB-06' : 'EX-05'}
      title={isModules ? 'MODULE BROKER' : 'EQUIPMENT EXCHANGE'}
      sub={isModules ? 'Weapon upgrade modules · material exchange' : 'Generated equipment · buy and sell'}
      close={close}
      wide
      accent={isModules ? 'violet' : 'cyan'}
    >
      <div className="market-head">
        <Tabs
          tabs={isModules ? [['buy', 'BUY MODULES'], ['sell', 'SELL MODULES'], ['exchange', 'MATERIAL EXCHANGE']] : [['buy', 'BUY EQUIPMENT'], ['sell', 'SELL EQUIPMENT']]}
          value={tab}
          set={(t) => {
            setTab(t);
            tx.setMsg(null);
          }}
        />
        <ResourceBar save={save} compact />
      </div>
      {tab === 'buy' && <BuyPane save={save} merchant={merchant} tx={tx} />}
      {tab === 'sell' && <SellPane save={save} modules={isModules} tx={tx} />}
      {tab === 'exchange' && <ExchangePane save={save} tx={tx} />}
      <TxMessage msg={tx.msg} />
    </Shell>
  );
}

type Tx = ReturnType<typeof useTx>;

function BuyPane({ save, merchant, tx }: { save: SaveData; merchant: MerchantId; tx: Tx }) {
  const equipped = useEquipped(save);
  const eqList = useMemo(() => SLOTS.map((s) => equipped[s.id]), [equipped]);
  const base = useScore(eqList);
  const impactOf = (it: ItemInstance) => {
    if (it.category === 'module') return null;
    const s = defaultSlot(it.category, equipped);
    return s ? swapImpact(eqList, it, equipped[s], base) : null;
  };
  const entries = merchant === 'equipment' ? save.market.equipment : save.market.modules;
  const [sel, setSel] = useState<string | null>(null);
  const [cat, setCat] = useState<Category | 'all'>('all');
  const list = entries.filter((e) => cat === 'all' || e.item.category === cat);
  const entry = entries.find((e) => e.id === sel) ?? list.find((e) => !e.sold) ?? list[0] ?? null;
  const item = entry?.item ?? null;
  const price = item ? buyPrice(item, merchant) : 0;
  const slot = item ? defaultSlot(item.category, equipped) : null;
  const bays = save.storage.capacity - save.storage.uids.length;
  const expensive = !!item && (price >= save.resources.credits * 0.4 || rarity(item.rarity).index >= 3);
  const rc = refreshCost(save);
  const cats = merchant === 'equipment' ? (['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'ability', 'ultimate'] as Category[]) : [];
  return (
    <div className="market-grid">
      <div className="mk-list-col">
        <div className="mk-manifest">
          <span>
            MANIFEST #{save.market.rotation} · {entries.filter((e) => !e.sold).length}/{entries.length} IN STOCK
          </span>
          <em>Restocks after every operation</em>
        </div>
        {cats.length > 0 && <CategoryChips cats={cats} value={cat} set={setCat} counts={countBy(entries.map((e) => e.item))} />}
        <div className="inv-list">
          {list.map((e) => (
            <ItemCard
              key={e.id}
              e={asEntry(e.item)}
              selected={e.id === entry?.id}
              disabled={e.sold}
              impact={e.sold ? null : impactOf(e.item)}
              onSelect={() => {
                setSel(e.id);
                tx.setMsg(null);
              }}
              right={e.sold ? <span className="price sold">SOLD</span> : <span className={`price ${buyPrice(e.item, merchant) > save.resources.credits ? 'short' : ''}`}>{e.featured && <i className="feat">FEATURED</i>}◈ {buyPrice(e.item, merchant).toLocaleString()}</span>}
            />
          ))}
        </div>
        <ConfirmButton
          className="mini wide"
          label={
            <>
              REQUEST NEW MANIFEST · <CostLine cost={{ credits: rc }} save={save} />
            </>
          }
          confirm={`Replace the remaining stock for ${rc} credits?`}
          disabled={save.resources.credits < rc}
          onConfirm={() => tx.run('buy', 'refreshMarket', [], (r) => `New manifest #${r.rotation} · −${r.price} credits`)}
        />
      </div>
      <div className="inv-detail-col">
        {!entry || !item ? (
          <div className="empty-state">
            <b>Nothing on offer</b>
          </div>
        ) : (
          <>
            <ItemDetail item={item} />
            {item.category === 'module' ? <ModuleCompat save={save} module={item} /> : <ComparePanel item={item} against={slot ? equipped[slot] : null} equipped={Object.values(equipped)} />}
            <div className="buy-box">
              <div>
                <span className="bb-label">PRICE</span>
                <CostLine cost={{ credits: price }} save={save} />
              </div>
              <div>
                <span className="bb-label">STORAGE</span>
                <b className={bays < 1 ? 'bad' : ''}>{bays < 1 ? 'FULL' : `${bays} BAYS FREE`}</b>
              </div>
              {entry.sold ? (
                <button disabled>SOLD</button>
              ) : (
                <ConfirmButton
                  className="primary small"
                  testId="buy"
                  label={`BUY · ◈ ${price.toLocaleString()}`}
                  confirm={`Buy ${item.name} for ${price} credits?`}
                  needConfirm={expensive}
                  disabled={price > save.resources.credits || bays < 1}
                  onConfirm={() => tx.run('buy', 'buyItem', [merchant, entry.id], (r) => `Purchased ${r.item.name} · −${r.price} credits · now in storage`)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SellPane({ save, modules, tx }: { save: SaveData; modules: boolean; tx: Tx }) {
  const equipped = useEquipped(save);
  const all = useMemo(() => sortEntries(saveEntries(save).filter((e) => (modules ? e.item.category === 'module' : e.item.category !== 'module')), 'rarity'), [save, modules]);
  const [sel, setSel] = useState<string | null>(null);
  const [cat, setCat] = useState<Category | 'all'>('all');
  const list = all.filter((e) => cat === 'all' || e.item.category === cat);
  const entry = all.find((e) => e.item.uid === sel) ?? list.find((e) => !protectionReason(save, e.item.uid)) ?? list[0] ?? null;
  const item = entry?.item ?? null;
  const why = item ? protectionReason(save, item.uid) : null;
  const cats = modules ? [] : (['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'ability', 'ultimate'] as Category[]);
  return (
    <div className="market-grid">
      <div className="mk-list-col">
        {cats.length > 0 && <CategoryChips cats={cats} value={cat} set={setCat} counts={countBy(all.map((e) => e.item))} />}
        <div className="inv-list">
          {list.length === 0 && <div className="empty-state small">Nothing to sell.</div>}
          {list.map((e) => {
            const p = protectionReason(save, e.item.uid);
            return (
              <ItemCard
                key={e.item.uid}
                e={e}
                selected={e.item.uid === item?.uid}
                disabled={!!p}
                onSelect={() => {
                  setSel(e.item.uid);
                  tx.setMsg(null);
                }}
                right={p ? <span className="price prot">{e.equippedIn ? 'EQUIPPED' : 'LOCKED'}</span> : <span className="price gain">+◈ {sellPrice(e.item).toLocaleString()}</span>}
              />
            );
          })}
        </div>
      </div>
      <div className="inv-detail-col">
        {item && entry ? (
          <>
            <ItemDetail item={item} status={entry.equippedIn ? 'equipped' : 'stored'} />
            <div className="buy-box">
              <div>
                <span className="bb-label">SALE VALUE</span>
                <b className="good">+◈ {sellPrice(item).toLocaleString()}</b>
              </div>
              <div>
                <span className="bb-label">OR DISMANTLE</span>
                <CostLine cost={{ salvage: dismantleYield(item).salvage, components: dismantleYield(item).components }} />
              </div>
              {why ? (
                <div className="prot-note">{why}</div>
              ) : (
                <ConfirmButton
                  className="danger"
                  testId="sell"
                  label={`SELL · +◈ ${sellPrice(item).toLocaleString()}`}
                  confirm={`Sell ${item.name} permanently?`}
                  onConfirm={() => tx.run('sell', 'sellItems', [[item.uid]], (r) => `Sold for ${r.credits} credits${r.modulesReturned ? ` · ${r.modulesReturned} module(s) returned to storage` : ''}`)}
                />
              )}
              {item.locked ? (
                <button className="mini" onClick={() => tx.run('lock', 'setItemLock', [item.uid, false], () => 'Unlocked')}>
                  UNLOCK
                </button>
              ) : null}
            </div>
            {!modules && <ComparePanel item={item} against={equipped[slotsFor(item.category)[0] ?? 'weapon'] ?? null} equipped={Object.values(equipped)} />}
          </>
        ) : (
          <div className="empty-state">
            <b>Nothing selected</b>
          </div>
        )}
      </div>
    </div>
  );
}

function ExchangePane({ save, tx }: { save: SaveData; tx: Tx }) {
  return (
    <div className="exchange-grid">
      {MARKET.exchange.map((o) => {
        const st = save.market.exchange.find((x) => x.id === o.id);
        const left = st?.left ?? 0;
        return (
          <div key={o.id} className={`ex-card ${left ? '' : 'out'}`}>
            <div className="ex-title">{o.label.toUpperCase()}</div>
            <div className="ex-give">
              <CostLine cost={o.give} />
            </div>
            <div className="ex-stock">
              {Array.from({ length: Math.max(left, 0) }, (_, i) => (
                <i key={i} />
              ))}
              <span>{left} LEFT THIS MANIFEST</span>
            </div>
            <button className="primary small" data-testid={`ex-${o.id}`} disabled={!left || save.resources.credits < o.price} onClick={() => tx.run('exchange', 'buyExchange', [o.id], (r) => `Received ${costText(r.give, '+')} · −${r.price} credits`)}>
              BUY · ◈ {o.price}
            </button>
          </div>
        );
      })}
      <p className="faint small ex-note">Exchange stock is limited and restocks with the manifest. Materials cannot be sold back.</p>
    </div>
  );
}

// ------------------------------------------------------------------ reclamation (salvage station)

export function SalvageTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const tx = useTx(flow, 'salvage');
  const entries = useMemo(() => sortEntries(saveEntries(save), 'rarity'), [save]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [cat, setCat] = useState<Category | 'all'>('all');
  // Selections that no longer exist (or became protected) drop out automatically.
  const valid = [...picked].filter((u) => !protectionReason(save, u));
  const preview = previewDismantle(save, valid);
  const list = entries.filter((e) => cat === 'all' || e.item.category === cat);
  const focused = entries.find((e) => e.item.uid === focus)?.item ?? null;
  const toggle = (uid: string) => {
    tx.setMsg(null);
    setFocus(uid);
    if (protectionReason(save, uid)) return;
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  };
  const pickRarity = (rid: string) => setPicked(new Set([...valid, ...list.filter((e) => e.item.rarity === rid && !protectionReason(save, e.item.uid)).map((e) => e.item.uid)]));
  const cats = ['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'ability', 'ultimate', 'module'] as Category[];
  return (
    <Shell code="RC-07" title="RECLAMATION PRESS" sub="Dismantle equipment into salvage and advanced components" close={close} wide accent="amber">
      <div className="market-head">
        <div className="salv-quick">
          SELECT
          {RARITIES.slice(0, 4).map((r) => (
            <button key={r.id} className="mini" style={{ ['--rc' as string]: r.color }} onClick={() => pickRarity(r.id)}>
              ALL {r.label.toUpperCase()}
            </button>
          ))}
          <button className="mini" onClick={() => setPicked(new Set())}>
            CLEAR
          </button>
        </div>
        <ResourceBar save={save} compact />
      </div>
      <div className="market-grid">
        <div className="mk-list-col">
          <CategoryChips cats={cats} value={cat} set={setCat} counts={countBy(entries.map((e) => e.item))} />
          <div className="inv-list tall">
            {list.map((e) => {
              const why = protectionReason(save, e.item.uid);
              const y = dismantleYield(e.item);
              return (
                <ItemCard
                  key={e.item.uid}
                  e={e}
                  selected={e.item.uid === focus}
                  check={why ? undefined : valid.includes(e.item.uid)}
                  disabled={!!why}
                  onSelect={() => toggle(e.item.uid)}
                  right={why ? <span className="price prot">{e.equippedIn ? 'EQUIPPED' : 'LOCKED'}</span> : <CostLine cost={{ salvage: y.salvage, components: y.components }} />}
                />
              );
            })}
          </div>
        </div>
        <div className="inv-detail-col">
          <div className="salv-preview">
            <div className="id-label">DISMANTLE PREVIEW · {preview.count} ITEM{preview.count === 1 ? '' : 'S'}</div>
            <div className="sp-yield">{preview.count ? <CostLine cost={{ salvage: preview.salvage, components: preview.components }} label="YIELD" /> : <span className="faint small">Select items on the left. Equipped and locked items are protected.</span>}</div>
            {preview.modulesReturned > 0 && <div className="faint small">{preview.modulesReturned} installed module(s) return to storage intact.</div>}
            <div className="sp-names">
              {valid.slice(0, 10).map((u) => {
                const it = save.items.find((i) => i.uid === u)!;
                return (
                  <span key={u} style={{ ['--rc' as string]: rarity(it.rarity).color }}>
                    {itemTitle(it)}
                  </span>
                );
              })}
              {valid.length > 10 && <span>+{valid.length - 10} more</span>}
            </div>
            <ConfirmButton
              className="danger wide"
              testId="dismantle"
              label={`DISMANTLE ${preview.count || ''} ${preview.count === 1 ? 'ITEM' : 'ITEMS'}`}
              confirm={`Destroy ${preview.count} item${preview.count === 1 ? '' : 's'} permanently for ${costText({ salvage: preview.salvage, components: preview.components }, '+')}?`}
              disabled={preview.count === 0}
              onConfirm={() => {
                const res = tx.run('dismantle', 'dismantleItems', [valid], (r) => `Dismantled ${r.count} item${r.count === 1 ? '' : 's'} · +${r.salvage} salvage${r.components ? ` · +${r.components} components` : ''}`);
                if (res) setPicked(new Set());
              }}
            />
          </div>
          {focused && (
            <>
              <ItemDetail item={focused} />
              <div className="inv-actions">
                {(() => {
                  const why = protectionReason(save, focused.uid);
                  return why && !focused.locked ? <div className="prot-note">{why}</div> : null;
                })()}
                <button className="mini" data-testid="lock-toggle" onClick={() => tx.run('lock', 'setItemLock', [focused.uid, !focused.locked], () => (focused.locked ? 'Unlocked: can be sold or dismantled' : 'Locked: protected from selling and dismantling'))}>
                  {focused.locked ? 'UNLOCK ITEM' : 'LOCK ITEM (PROTECT)'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <TxMessage msg={tx.msg} />
    </Shell>
  );
}

// ------------------------------------------------------------------ fabrication

const GROUPS: [Recipe['group'], string][] = [
  ['weapons', 'WEAPONS'],
  ['defense', 'ARMOR & SHIELDS'],
  ['systems', 'REACTORS & SYSTEMS'],
  ['modules', 'WEAPON MODULES'],
  ['materials', 'MATERIALS'],
];

export function FabricateTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const tx = useTx(flow, 'fabricate');
  const [rid, setRid] = useState<string>('w_plasma');
  const [qid, setQid] = useState<string>('standard');
  const [last, setLast] = useState<ItemInstance | null>(null);
  const recipe = RECIPES.find((r) => r.id === rid) ?? RECIPES[0];
  const level = fabricationLevel(save);
  const q = QUALITIES.find((x) => x.id === qid) ?? QUALITIES[0];
  const isItem = recipe.output.kind === 'item';
  const cost: Cost = craftCostFor(save, recipe, isItem ? q : undefined, level);
  const unlock = unlockedFor(recipe, isItem ? q : undefined, save.threat.unlocked);
  const bays = save.storage.capacity - save.storage.uids.length;
  const lastNow = last ? (save.items.find((i) => i.uid === last.uid) ?? null) : null;
  const doCraft = () => {
    const res = tx.run('craft', 'craft', [recipe.id, isItem ? q.id : null], (r) => (r.item ? `Fabricated ${r.item.name} (${rarity(r.item.rarity).label}, LV ${r.item.level})` : `Converted · ${costText(r.give, '+')}`));
    if (res?.item) setLast(res.item);
  };
  return (
    <Shell code="FB-08" title="FABRICATOR" sub={`Manufacture equipment from materials · output level ${level}`} close={close} wide accent="amber">
      <div className="market-head">
        <div className="faint small">Output level follows your best cleared wave and threat tier. Crafted items use the same generator as enemy loot.</div>
        <ResourceBar save={save} cost={unlock.ok ? cost : undefined} compact />
      </div>
      <div className="fab-grid">
        <div className="fab-recipes">
          {GROUPS.map(([g, label]) => (
            <div key={g}>
              <div className="col-label">{label}</div>
              {RECIPES.filter((r) => r.group === g).map((r) => (
                <button key={r.id} className={`recipe ${r.id === recipe.id ? 'on' : ''}`} data-recipe={r.id} onClick={() => (setRid(r.id), tx.setMsg(null))}>
                  {r.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="fab-main">
          <div className="fab-title">
            <b>{recipe.name}</b>
            <span>{recipe.blurb}</span>
          </div>
          {isItem ? (
            <>
              <div className="fab-bases">
                <span className="bb-label">POSSIBLE OUTPUT</span>
                {recipeBases(recipe).map((b) => (
                  <em key={b.id}>{b.name}</em>
                ))}
                <span className="bb-label">ITEM LEVEL</span>
                <em>{level}</em>
              </div>
              <div className="quality-grid">
                {QUALITIES.map((qq) => (
                  <QualityCard key={qq.id} q={qq} on={qq.id === q.id} save={save} recipe={recipe} level={level} pick={() => (setQid(qq.id), tx.setMsg(null))} />
                ))}
              </div>
            </>
          ) : recipe.output.kind === 'material' ? (
            <div className="fab-conv">
              <CostLine cost={recipe.output.take} save={save} label="CONSUMES" />
              <span className="arrow">→</span>
              <CostLine cost={recipe.output.give} label="PRODUCES" />
            </div>
          ) : null}
          <div className="buy-box">
            <div>
              <span className="bb-label">COST</span>
              <CostLine cost={cost} save={save} />
            </div>
            {isItem && (
              <div>
                <span className="bb-label">STORAGE</span>
                <b className={bays < 1 ? 'bad' : ''}>{bays < 1 ? 'FULL' : `${bays} BAYS FREE`}</b>
              </div>
            )}
            {!unlock.ok ? (
              <div className="prot-note">{unlock.reason}</div>
            ) : (
              <button className="primary small" data-testid="craft" disabled={(isItem && bays < 1) || Object.entries(cost).some(([k, v]) => save.resources[k as keyof SaveData['resources']] < (v ?? 0))} onClick={doCraft}>
                {isItem ? `FABRICATE · ${q.label.toUpperCase()}` : 'CONVERT'}
              </button>
            )}
          </div>
        </div>
        <div className="fab-result">
          <div className="col-label">LAST OUTPUT</div>
          {lastNow ? (
            <>
              <ItemDetail item={lastNow} />
              {slotsFor(lastNow.category).length > 0 && save.storage.uids.includes(lastNow.uid) && (
                <button className="mini wide" onClick={() => tx.run('equip', 'equipFromStorage', [lastNow.uid], () => `${lastNow.name} equipped`)}>
                  EQUIP NOW
                </button>
              )}
            </>
          ) : (
            <div className="empty-state small">
              <b>No output yet</b>
              <p>Fabricated items go to storage.</p>
            </div>
          )}
        </div>
      </div>
      <TxMessage msg={tx.msg} />
    </Shell>
  );
}

function QualityCard({ q, on, save, recipe, level, pick }: { q: QualityDef; on: boolean; save: SaveData; recipe: Recipe; level: number; pick: () => void }) {
  const u = unlockedFor(recipe, q, save.threat.unlocked);
  const odds = qualityOdds(q);
  return (
    <button className={`q-card ${on ? 'on' : ''} ${u.ok ? '' : 'locked'}`} data-quality={q.id} onClick={pick}>
      <b>{q.label.toUpperCase()}</b>
      <span className="q-blurb">{u.ok ? q.blurb : u.reason}</span>
      <div className="q-odds">
        {odds.map((o) => (
          <div key={o.id} className="q-odd" style={{ ['--rc' as string]: rarity(o.id).color }}>
            <RarityTag id={o.id} />
            <i style={{ width: `${Math.max(2, o.p * 100)}%` }} />
            <em>{fmtNum(o.p * 100)}%</em>
          </div>
        ))}
      </div>
      <CostLine cost={craftCostFor(save, recipe, q, level)} save={save} />
    </button>
  );
}

export type { MarketEntry };
