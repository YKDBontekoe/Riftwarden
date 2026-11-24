import { MasteryBench } from './Mastery';
import { lockReason, unlockDef } from '@riftwarden/rules/progression/unlocks';
import { useMemo, useState } from 'react';
import { fmtNum, formatModifier, STAT_DEFS } from '@riftwarden/rules/combat/stats';
import type { Flow } from '../core/Flow';
import { ascendBlock, ascendItem } from '@riftwarden/rules/loot/ascend';
import { ascendCost } from '@riftwarden/rules/economy/transactions';
import { engineeringRand } from '@riftwarden/rules/economy/engineering';
import { enhanceCost, enhanceLevel, escalation, maxEnhance, rerollCost, ENHANCE_EFFECT, componentSwapCost } from '@riftwarden/rules/economy/config';
import { affixValueRange, maxLocks, rerollPool, SWAPPABLE_SLOTS, swapComponent, swapOptions, tierRange } from '@riftwarden/rules/economy/engineering';
import { affixDef } from '@riftwarden/rules/loot/affixes';
import { compareItems, weaponStatRows } from '@riftwarden/rules/loot/equipment';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { CATEGORY_LABEL, type Category, type ItemInstance, type RolledAffix } from '@riftwarden/rules/loot/types';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { FAMILIES } from '@riftwarden/rules/weapons/build';
import { componentDef, type ComponentSlot, describeEffects } from '@riftwarden/rules/weapons/components';
import { useSave } from './App';
import { ConfirmButton, CostLine, ResourceBar, TxMessage, useTx } from './economy';
import { type InvEntry, ItemCard, ItemDetail, itemTitle, sortEntries, TierPips } from './items';
import { Shell } from './shell';
import { TowerTech } from './TowerTech';
import { ModuleBench, saveEntries, useEquipped } from './Terminals';
import { swapImpact } from '@riftwarden/rules/loot/loadoutScore';
import { ComparisonPriorityPicker, ImpactBanner, useComparisonPriority } from './compare';
import { SLOTS } from '@riftwarden/rules/progression/items';
import { WeaponViewer } from './WeaponViewer';

type Tab = 'modules' | 'affixes' | 'enhance' | 'components' | 'towers' | 'mastery';

interface EngEntry extends InvEntry {
  /** Weapon this module is installed in. */
  host?: ItemInstance;
}

/** Every owned item: equipped, stored and modules installed in owned weapons. */
function engEntries(save: SaveData): EngEntry[] {
  const out: EngEntry[] = saveEntries(save);
  for (const e of [...out]) for (const m of e.item.socketed ?? []) if (m) out.push({ item: m, status: 'stored', equippedIn: null, host: e.item });
  return out;
}

/** Feature each workshop tab needs (staged unlocks). */
const TAB_FEATURE: Record<Tab, string> = { modules: 'station:modules', affixes: 'workshop:affixes', enhance: 'workshop:enhance', components: 'workshop:components', towers: 'workshop:towers', mastery: '' };

export function EngineeringTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  // Open on the first tab the warden can use (modules unlock at RL 3; enhancement at RL 2).
  const [tab, setTab] = useState<Tab>(() => (['modules', 'enhance', 'affixes', 'components', 'towers'] as Tab[]).find((t) => !lockReason(save, TAB_FEATURE[t])) ?? 'mastery');
  const [selW, setSelW] = useState<string | null>(() => save.loadout.weapon);
  const locked = lockReason(save, TAB_FEATURE[tab]);
  return (
    <Shell code="WS-04" title="ENGINEERING WORKSHOP" sub="Modules · affix recalibration · enhancement · component engineering · mastery" close={close} accent="amber" wide>
      <div className="market-head">
        <div className="tabs term-tabs">
          {(
            [
              ['modules', 'MODULES'],
              ['affixes', 'AFFIXES'],
              ['enhance', 'ENHANCE'],
              ['components', 'COMPONENTS'],
              ['towers', 'TOWER TECH'],
              ['mastery', 'MASTERY'],
            ] as [Tab, string][]
          )
            // Staged unlocks: a tab appears once its system is online (the unlock card announces it).
            .filter(([id]) => id === tab || !lockReason(save, TAB_FEATURE[id]))
            .map(([id, label]) => (
              <button key={id} className={tab === id ? 'on' : ''} data-tab={id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
        </div>
        <ResourceBar save={save} compact />
      </div>
      {locked ? (
        <div className="empty-state" data-testid="ws-locked">
          <b>Locked</b>
          <p>{locked}</p>
          <p className="text-muted">{unlockDef(TAB_FEATURE[tab])?.blurb}</p>
        </div>
      ) : (
        <>
          {tab === 'modules' && <ModuleBench flow={flow} selW={selW} setSelW={setSelW} />}
          {tab === 'towers' && <TowerTech flow={flow} save={save} />}
          {tab === 'mastery' && <MasteryBench flow={flow} save={save} />}
          {tab !== 'modules' && tab !== 'towers' && tab !== 'mastery' && <Bench key={tab} flow={flow} save={save} tab={tab} selW={selW} setSelW={setSelW} />}
        </>
      )}
    </Shell>
  );
}

function Bench({ flow, save, tab, selW, setSelW }: { flow: Flow; save: SaveData; tab: Exclude<Tab, 'modules' | 'towers' | 'mastery'>; selW: string | null; setSelW: (u: string) => void }) {
  const tx = useTx(flow, 'workshop');
  const weaponsOnly = tab === 'components';
  const all = useMemo(() => sortEntries(engEntries(save), 'rarity') as EngEntry[], [save]);
  const [cat, setCat] = useState<Category | 'all'>('all');
  const pool = all.filter((e) => (weaponsOnly ? e.item.category === 'weapon' : true));
  const list = pool.filter((e) => cat === 'all' || e.item.category === cat);
  const entry = all.find((e) => e.item.uid === selW && (!weaponsOnly || e.item.category === 'weapon')) ?? list[0] ?? null;
  const item = entry?.item ?? null;
  const [preview, setPreview] = useState<ItemInstance | null>(null);
  const shown = preview && item && preview.uid === item.uid ? preview : item;
  const cats = weaponsOnly ? [] : (['weapon', 'armor', 'shield', 'reactor', 'processor', 'accessory', 'ability', 'ultimate', 'module'] as Category[]);
  return (
    <div className="eng-grid">
      <div className="eng-col">
        <div className="col-label">{weaponsOnly ? 'OWNED WEAPONS' : 'OWNED EQUIPMENT'} · {pool.length}</div>
        {cats.length > 0 && (
          <div className="inv-filters">
            {(['all', ...cats] as (Category | 'all')[]).map((c) => (
              <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
                {c === 'all' ? 'ALL' : (CATEGORY_LABEL[c] ?? c).replace('Upgrade ', '').toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <div className="inv-list short">
          {list.map((e) => (
            <ItemCard
              key={e.item.uid}
              e={e}
              selected={e.item.uid === item?.uid}
              onSelect={() => {
                setSelW(e.item.uid);
                setPreview(null);
                tx.setMsg(null);
              }}
              right={e.host ? <span className="ic-status s-equipped">INSTALLED</span> : e.equippedIn ? undefined : <span />}
            />
          ))}
        </div>
      </div>
      <div className="eng-col eng-center">
        {item ? (
          <>
            {item.category === 'weapon' ? <WeaponViewer item={shown} caption={shown !== item ? 'PREVIEW · PROPOSED CONFIGURATION' : undefined} /> : <ItemDetail item={shown!} />}
            <div className="eng-title" style={{ ['--rc' as string]: rarity(item.rarity).color }}>
              <b>{itemTitle(item)}</b>
              <span>
                {rarity(item.rarity).label.toUpperCase()} · LV {fmtNum(item.level)} · {item.build ? FAMILIES[item.build.family].label.toUpperCase() : (CATEGORY_LABEL[item.category] ?? '').toUpperCase()}
                {entry?.host ? ` · INSTALLED IN ${entry.host.name.toUpperCase()}` : ''}
              </span>
            </div>
            <StatDiff before={item} after={shown!} />
            <EquippedImpact save={save} before={item} after={shown!} />
          </>
        ) : (
          <div className="empty-state">
            <b>No equipment</b>
          </div>
        )}
      </div>
      <div className="eng-col">
        {item && tab === 'affixes' && <AffixBench save={save} item={item} tx={tx} />}
        {item && tab === 'enhance' && <EnhanceBench save={save} item={item} tx={tx} setPreview={setPreview} />}
        {item && tab === 'components' && <ComponentBench save={save} item={item} tx={tx} setPreview={setPreview} />}
        <TxMessage msg={tx.msg} />
      </div>
    </div>
  );
}

/** For an equipped item: what the proposed change does to the whole loadout. */
function EquippedImpact({ save, before, after }: { save: SaveData; before: ItemInstance; after: ItemInstance }) {
  const equipped = useEquipped(save);
  const list = useMemo(() => SLOTS.map((s) => equipped[s.id]), [equipped]);
  const priority = useComparisonPriority();
  const impact = useMemo(() => {
    if (before === after || !list.some((i) => i?.uid === before.uid)) return null;
    return swapImpact(list, after, before, undefined, priority);
  }, [list, before, after, priority]);
  return impact ? <><ComparisonPriorityPicker /><ImpactBanner impact={impact} title="IF APPLIED · LOADOUT IMPACT" /></> : null;
}

/** Before/after effective statistics (weapons: full weapon readout incl. modules; others: item stats). */
function StatDiff({ before, after }: { before: ItemInstance; after: ItemInstance }) {
  const changed = before !== after;
  if (before.category === 'weapon') {
    const a = weaponStatRows(before);
    const b = changed ? weaponStatRows(after) : null;
    return (
      <table className="cmp-table eng-stats" data-testid="stat-diff">
        <thead>
          <tr>
            <th>WEAPON</th>
            <th>CURRENT</th>
            {b && <th>AFTER</th>}
          </tr>
        </thead>
        <tbody>
          {a.map((r) => {
            const x = b?.find((y) => y.key === r.key);
            const v = x ? (Math.abs(x.value - r.value) < 1e-9 ? 0 : (x.value > r.value) === (r.better === 'higher') ? 1 : -1) : 0;
            return (
              <tr key={r.key} className={v > 0 ? 'up' : v < 0 ? 'down' : ''}>
                <td>{r.label}</td>
                <td>{r.text}</td>
                {b && <td>{x ? `${x.text} ${v > 0 ? '▲' : v < 0 ? '▼' : ''}` : '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  if (!changed) return null;
  const rows = compareItems(after, before).filter((r) => r.a !== r.b);
  return (
    <table className="cmp-table eng-stats" data-testid="stat-diff">
      <thead>
        <tr>
          <th>STAT</th>
          <th>CURRENT</th>
          <th>AFTER</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={3}>No numerical change</td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.key} className={r.verdict > 0 ? 'up' : r.verdict < 0 ? 'down' : ''}>
            <td>{r.label}</td>
            <td>{r.b || '—'}</td>
            <td>
              {r.a || '—'} {r.verdict > 0 ? '▲' : r.verdict < 0 ? '▼' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Tx = ReturnType<typeof useTx>;

const affixText = (a: RolledAffix) => `${formatModifier(a.stat, a.op, a.value)} ${STAT_DEFS[a.stat].label.toLowerCase()}`;

// ------------------------------------------------------------------ affixes

function AffixBench({ save, item, tx }: { save: SaveData; item: ItemInstance; tx: Tx }) {
  const [idx, setIdx] = useState(0);
  const [result, setResult] = useState<{ uid: string; before: RolledAffix[]; after: RolledAffix[] } | null>(null);
  const i = Math.min(idx, Math.max(0, item.affixes.length - 1));
  const a = item.affixes[i];
  const locks = item.affixes.filter((x) => x.locked).length;
  if (!item.affixes.length)
    return (
      <div className="empty-state small">
        <b>No affixes</b>
        <p>This item has no random modifiers to engineer. Rarer items carry more affixes.</p>
      </div>
    );
  const pool = rerollPool(item, i);
  const tr = tierRange(item, i);
  const def = a ? affixDef(a.id) : undefined;
  const range = def ? affixValueRange(item, def, tr) : null;
  const statCost = rerollCost(item, { kind: 'single', mode: 'stat' });
  const valueCost = rerollCost(item, { kind: 'single', mode: 'value' });
  const fullCost = rerollCost(item, { kind: 'full', locks });
  const showResult = result && result.uid === item.uid ? result : null;
  return (
    <>
      <div className="col-label">AFFIXES · SELECT ONE · LOCK TO PROTECT</div>
      <div className="affix-list">
        {item.affixes.map((x, k) => (
          <div key={k} className={`affix-row ${k === i ? 'on' : ''} ${x.locked ? 'locked' : ''}`} data-affix={k} onClick={() => setIdx(k)}>
            <button
              className={`lock-btn ${x.locked ? 'on' : ''}`}
              title={x.locked ? 'Unlock' : 'Lock (kept by full recalibration)'}
              data-testid={`lock-${k}`}
              onClick={(ev) => {
                ev.stopPropagation();
                tx.run('lock', 'setAffixLock', [item.uid, k, !x.locked], () => (x.locked ? 'Affix unlocked' : 'Affix locked: full recalibration keeps it'));
              }}
            />
            <span>{STAT_DEFS[x.stat].label}</span>
            <TierPips tier={x.tier} />
            <b>{formatModifier(x.stat, x.op, x.value)}</b>
          </div>
        ))}
      </div>
      <div className="faint small">
        {locks}/{maxLocks(item)} locks · engineering ops on this item: {item.rerolls ?? 0} (costs ×{fmtNum(escalation(item.rerolls))})
      </div>
      {a && !a.locked && (
        <>
          <div className="eng-action">
            <div className="ea-head">
              <b>RECALIBRATE STAT</b>
              <CostLine cost={statCost} save={save} />
            </div>
            <p>Replace this affix with a random compatible one. Possible results:</p>
            <div className="pool-chips">
              {pool.map((p) => (
                <span key={p.id} className={p.id === a.id ? 'cur' : ''}>
                  {STAT_DEFS[p.stat].label}
                </span>
              ))}
            </div>
            <p className="faint small">
              Tier {tr[0]}–{tr[1]} at item level {item.level}. The outcome is random.
            </p>
            <button className="primary small" data-testid="reroll-stat" onClick={() => {
              const r = tx.run('reroll', 'rerollAffix', [item.uid, i, 'stat'], (r) => `${affixText(r.before)} → ${affixText(r.after)} (T${r.after.tier})`);
              if (r) setResult({ uid: item.uid, before: [r.before], after: [r.after] });
            }}>
              RECALIBRATE
            </button>
          </div>
          <div className="eng-action">
            <div className="ea-head">
              <b>REFINE VALUE</b>
              <CostLine cost={valueCost} save={save} />
            </div>
            <p>
              Keep <b>{STAT_DEFS[a.stat].label}</b>, reroll its tier and roll.
              {range && (
                <>
                  {' '}
                  Range <b>{formatModifier(a.stat, a.op, range[0])}</b> to <b>{formatModifier(a.stat, a.op, range[1])}</b> (now {formatModifier(a.stat, a.op, a.value)}).
                </>
              )}
            </p>
            <button className="small" data-testid="reroll-value" onClick={() => {
              const r = tx.run('reroll', 'rerollAffix', [item.uid, i, 'value'], (r) => `${affixText(r.before)} → ${affixText(r.after)} (T${r.after.tier})`);
              if (r) setResult({ uid: item.uid, before: [r.before], after: [r.after] });
            }}>
              REFINE
            </button>
          </div>
        </>
      )}
      {a?.locked && <div className="prot-note">This affix is locked. Unlock it to recalibrate it individually.</div>}
      <div className="eng-action">
        <div className="ea-head">
          <b>FULL RECALIBRATION</b>
          <CostLine cost={fullCost} save={save} />
        </div>
        <p>
          Rerolls all {item.affixes.length - locks} unlocked affix{item.affixes.length - locks === 1 ? '' : 'es'}. Locked affixes are kept exactly; each lock adds salvage and advanced components.
        </p>
        <ConfirmButton
          className="small"
          testId="reroll-all"
          label="RECALIBRATE ALL UNLOCKED"
          confirm="Reroll every unlocked affix?"
          disabled={locks >= item.affixes.length}
          onConfirm={() => {
            const r = tx.run('reroll', 'rerollUnlocked', [item.uid], () => 'Recalibrated · locked affixes kept');
            if (r) setResult({ uid: item.uid, before: r.before, after: r.after });
          }}
        />
      </div>
      {showResult && (
        <div className="eng-result">
          <div className="id-label">LAST RESULT</div>
          {showResult.after.map((x, k) => (
            <div key={k} className="id-row">
              <span className="faint">{affixText(showResult.before[k])}</span>
              <b>→ {affixText(x)}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ enhancement

function enhanceText(item: ItemInstance): string {
  switch (item.category) {
    case 'weapon':
      return `+${ENHANCE_EFFECT.weaponDamage * 100}% base damage and +${ENHANCE_EFFECT.weaponCooling * 100}% cooling per level.`;
    case 'module':
      return `+${ENHANCE_EFFECT.module * 100}% to every beneficial module stat per level (trade-off penalties are not amplified).`;
    default:
      return `+${ENHANCE_EFFECT.gearBase * 100}% to the item's beneficial base stats per level.`;
  }
}

function EnhanceBench({ save, item, tx, setPreview }: { save: SaveData; item: ItemInstance; tx: Tx; setPreview: (i: ItemInstance | null) => void }) {
  const lvl = enhanceLevel(item);
  const max = maxEnhance(item);
  const cost = enhanceCost(item);
  const next = useMemo(() => ({ ...item, enhance: lvl + 1 }), [item, lvl]);
  return (
    <>
      <div className="col-label">ENHANCEMENT</div>
      <div className="enh-pips">
        {Array.from({ length: max }, (_, k) => (
          <i key={k} className={k < lvl ? 'on' : ''} />
        ))}
        <b>
          +{lvl} / +{max}
        </b>
      </div>
      <p className="faint small">{enhanceText(item)} Enhancement never fails and never damages equipment. Better rarities can be enhanced further.</p>
      {lvl < max ? (
        <div className="eng-action">
          <div className="ea-head">
            <b>ENHANCE TO +{lvl + 1}</b>
            <CostLine cost={cost} save={save} />
          </div>
          <button
            className="primary small"
            data-testid="enhance"
            onMouseEnter={() => setPreview(next)}
            onMouseLeave={() => setPreview(null)}
            onFocus={() => setPreview(next)}
            onClick={() => {
              const r = tx.run('enhance', 'enhanceItem', [item.uid], (r) => `${item.name} enhanced to +${r.level}`);
              if (r) setPreview(null);
            }}
          >
            ENHANCE
          </button>
          <button className="mini" onClick={() => setPreview(next)}>
            PREVIEW +{lvl + 1}
          </button>
        </div>
      ) : (
        <div className="prot-note">Maximum enhancement for {rarity(item.rarity).label.toLowerCase()} equipment.</div>
      )}
      {(item.rarity === 'exotic' || item.rarity === 'ascended') && <AscendBench save={save} item={item} tx={tx} setPreview={setPreview} />}
    </>
  );
}

/** Ascension: Exotic -> Ascended for rift shards (the preview is the exact result: the roll is deterministic). */
function AscendBench({ save, item, tx, setPreview }: { save: SaveData; item: ItemInstance; tx: Tx; setPreview: (i: ItemInstance | null) => void }) {
  const why = lockReason(save, 'workshop:ascension')?.replace(/\.$/, '') ?? ascendBlock(item);
  const next = useMemo(() => (why ? null : ascendItem(item, engineeringRand(item, 'ascend'))), [item, why]);
  const cost = ascendCost(item);
  return (
    <div className="ascend-bench" data-testid="ascend-bench">
      <div className="col-label">ASCENSION</div>
      <p className="faint small">
        An Ascended item keeps everything it has, gains stronger rarity multipliers and one extra affix at the top tier with a perfect roll. Rift shards drop from elites, bosses, elite caches,
        high-value targets and checkpoints from RL 3.
      </p>
      {why ? (
        <div className="prot-note">{why}.</div>
      ) : (
        <div className="eng-action">
          <div className="ea-head">
            <b>ASCEND</b>
            <CostLine cost={cost} save={save} />
          </div>
          <button
            className="primary small ascend"
            data-testid="ascend"
            onMouseEnter={() => setPreview(next)}
            onMouseLeave={() => setPreview(null)}
            onFocus={() => setPreview(next)}
            onClick={() => {
              const r = tx.run('ascend', 'ascendItem', [item.uid], () => `${item.name} ascended`);
              if (r) setPreview(null);
            }}
          >
            ASCEND
          </button>
          <button className="mini" onClick={() => setPreview(next)}>
            PREVIEW
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ components

function ComponentBench({ save, item, tx, setPreview }: { save: SaveData; item: ItemInstance; tx: Tx; setPreview: (i: ItemInstance | null) => void }) {
  const [slot, setSlot] = useState<ComponentSlot>('barrel');
  const [pick, setPick] = useState<string | null>(null);
  if (item.category !== 'weapon' || !item.build) return null;
  const cur = componentDef((item.build as unknown as Record<string, string>)[slot]);
  const opts = swapOptions(item, slot);
  const sel = opts.find((o) => o.id === pick) ?? null;
  const previewOf = (id: string) => {
    const r = swapComponent(item, slot, id);
    return r ? { ...item, build: r.build, weapon: r.weapon } : null;
  };
  return (
    <>
      <div className="col-label">COMPONENT SLOT</div>
      <div className="slot-tabs">
        {SWAPPABLE_SLOTS.map((s) => (
          <button
            key={s}
            className={slot === s ? 'on' : ''}
            data-slot={s}
            onClick={() => {
              setSlot(s);
              setPick(null);
              setPreview(null);
            }}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      {cur && (
        <div className="comp-card cur">
          <b>{cur.name}</b>
          <span>{cur.blurb}</span>
          <FxList effects={cur.effects} />
        </div>
      )}
      <div className="col-label">REPLACEMENTS · {opts.length}</div>
      {opts.length === 0 && <div className="text-faint text-[13px]">No alternative {slot} for this family and rarity.</div>}
      {opts.map((o) => (
        <button
          key={o.id}
          className={`comp-card opt ${o.id === pick ? 'on' : ''}`}
          data-comp={o.id}
          onClick={() => {
            setPick(o.id);
            setPreview(previewOf(o.id));
            tx.setMsg(null);
          }}
        >
          <b>
            {o.name}
            {o.minRarity ? <em className="prem">PREMIUM</em> : null}
          </b>
          <span>{o.blurb}</span>
          <FxList effects={o.effects} />
        </button>
      ))}
      {sel && (
        <div className="eng-action">
          <div className="ea-head">
            <b>INSTALL {sel.name.toUpperCase()}</b>
            <CostLine cost={componentSwapCost(item, slot, (sel.minRarity ?? 0) > 0)} save={save} />
          </div>
          <p className="faint small">Component effects rescale the weapon's stored roll (quality is kept). The removed component is recycled. Mechanisms change how the weapon fires.</p>
          <ConfirmButton
            className="primary small"
            testId="swap"
            label="REFIT COMPONENT"
            confirm={`Replace ${cur?.name ?? 'component'} with ${sel.name}?`}
            onConfirm={() => {
              const r = tx.run('component', 'modifyComponent', [item.uid, slot, sel.id], () => `${sel.name} fitted`);
              if (r) {
                setPick(null);
                setPreview(null);
              }
            }}
          />
        </div>
      )}
    </>
  );
}

function FxList({ effects }: { effects: Parameters<typeof describeEffects>[0] }) {
  const fx = describeEffects(effects);
  return (
    <span className="comp-fx">
      {fx.length ? (
        fx.map((f, k) => (
          <em key={k} className={f.good ? 'up' : 'down'}>
            {f.text}
          </em>
        ))
      ) : (
        <em className="faint">baseline</em>
      )}
    </span>
  );
}
