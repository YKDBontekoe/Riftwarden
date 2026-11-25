// Drone configuration (final design "Loadout"): weapons and abilities left, build headlines centre, gear tiles right;
// STATS tab = drone statistics with sources; PRESETS tab = saved configurations. Equipping happens at storage.
import { slotLockReason } from '@riftwarden/rules/progression/unlocks';
import { useEffect, useMemo, useState } from 'react';
import { sfx } from '@riftwarden/game/audio/Sfx';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import type { Flow } from '../../core/Flow';
import { StoragePanel } from './Storage';
import { DroneStats } from '../DroneStats';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { weaponDefFor, weaponSummary } from '@riftwarden/rules/loot/equipment';
import { activeSetBonuses } from '@riftwarden/rules/loot/sets';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { readiness, recommendedLevel } from '@riftwarden/rules/progression/riftLevel';
import { type ItemInstance, type SlotId, SLOTS, getSlot } from '@riftwarden/rules/progression/items';
import { equippedItem, type SaveData } from '@riftwarden/rules/progression/save';
import { useSave } from '../useSave';
import { Shell } from '../shell';
import { useScore } from '../compare';
import { savePower } from '../RiftLevel';
import { ItemGlyph } from '../inventory/glyphs';
import { ELEMENT_COLOR, Hint, rarityCls } from '../ds';

export function useEquipped(save: SaveData): Record<SlotId, ItemInstance | null> {
  return useMemo(() => Object.fromEntries(SLOTS.map((s) => [s.id, equippedItem(save, s.id)])) as Record<SlotId, ItemInstance | null>, [save]);
}

type Tab = 'loadout' | 'storage' | 'stats' | 'presets';
const ABILITY_KEY: Partial<Record<SlotId, string>> = { ability: 'RMB', ability2: 'F', ultimate: 'T · ult' };
const GEAR: SlotId[] = ['armor', 'shield', 'reactor', 'processor', 'accessory', 'accessory2'];

/** One slot as a tile: render, level, slot label + name; empty slots say so, locked ones say why. */
function SlotTile({ save, slot, it, sel, pick, height, children }: { save: SaveData; slot: SlotId; it: ItemInstance | null; sel: boolean; pick: () => void; height: number; children?: React.ReactNode }) {
  const def = getSlot(slot);
  const locked = !it ? slotLockReason(save, slot) : null;
  if (locked)
    return (
      <div className="ds-tile empty lo-tile locked" style={{ height }} data-testid={`slot-locked-${slot}`}>
        <span className="lo-cap ds-col"><span className="ds-lbl">{def.label} · locked</span><b className="ds-d">⨯ {locked}</b></span>
      </div>
    );
  const label = ABILITY_KEY[slot] ?? def.label;
  return (
    <button type="button" className={`ds-tile lo-tile ${it ? rarityCls(it.rarity) : 'empty'} ${sel ? 'on' : ''}`} style={{ height }} onClick={pick} aria-pressed={sel} data-slot={slot}>
      {it && <span className="ds-tile-art"><ItemGlyph item={it} size={Math.round(height * 0.6)} /></span>}
      {it && <span className="ds-lv">{fmtNum(it.level)}</span>}
      <span className="lo-cap ds-col">
        <span className={`ds-lbl ${it ? '' : 'ds-warn'}`}>{label}{it ? '' : ' · empty'}</span>
        <b className="ds-d">{it ? it.name : '+ equip'}</b>
        {children}
      </span>
    </button>
  );
}

export function LoadoutTerminal({ flow, close, initial = 'loadout' }: { flow: Flow; close: () => void; initial?: Tab }) {
  const save = useSave(flow);
  const equipped = useEquipped(save);
  const all = useMemo(() => SLOTS.map((s) => equipped[s.id]), [equipped]);
  const score = useScore(all);
  const [tab, setTab] = useState<Tab>(initial);
  const [sel, setSel] = useState<SlotId>('weapon');
  const [msg, setMsg] = useState('');
  const mutate = (op: string, args: unknown[], ok: string, fail: string) => {
    const done = flow.profile.op(op, args).ok;
    setMsg(done ? ok : fail);
    sfx.play(done ? 'equip' : 'buildDeny');
  };
  const tier = getTier(save.threat.selected);
  const power = savePower(save);
  const ready = readiness(power, tier.id);
  const rec = recommendedLevel(power, save.threat.unlocked);
  const sets = activeSetBonuses(all.filter((_, i) => SLOTS[i].id !== 'weapon2'));
  const weaponLine = (it: ItemInstance | null) => {
    const w = weaponDefFor(it);
    return w ? weaponSummary(w, score.stats) : null;
  };
  const selItem = equipped[sel];
  const tabs: [Tab, string][] = [['loadout', 'Loadout'], ['storage', `Storage ${save.storage.uids.length} / ${save.storage.capacity}`], ['stats', 'Stats'], ['presets', 'Presets']];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const i = tabs.findIndex(([t]) => t === tab);
      if (e.code === 'KeyQ') setTab(tabs[(i + tabs.length - 1) % tabs.length][0]);
      else if (e.code === 'KeyR') setTab(tabs[(i + 1) % tabs.length][0]);
      else if (e.code === 'KeyX' && tab === 'loadout' && selItem && !getSlot(sel).required) mutate('unequipToStorage', [sel], 'Moved to storage', 'Storage full');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const weaponTile = (slot: 'weapon' | 'weapon2', height: number) => {
    const it = equipped[slot];
    const ws = weaponLine(it);
    const el = it?.weapon?.element ?? 'kinetic';
    return (
      <SlotTile save={save} slot={slot} it={it} sel={sel === slot} pick={() => setSel(slot)} height={height}>
        {it && <span className="ds-meta" style={{ color: ELEMENT_COLOR[el] }}>{el} · {ws ? `${fmtNum(ws.dps)} DPS` : ''}</span>}
      </SlotTile>
    );
  };
  return (
    <Shell code="DC-02" title={tabs.find(([t]) => t === tab)![1].replace(/ \d.*$/, '').toUpperCase()} sub="Warden Mk-I · loadout, storage, statistics and presets" close={close} wide>
      <div className="tabs term-tabs lo-tabs">
        <span className="ds-sh">Q</span>
        {tabs.map(([t, label]) => <button key={t} className={tab === t ? 'on' : ''} data-tab={t} onClick={() => setTab(t)}>{label}</button>)}
        <span className="ds-sh">R</span>
        <span className="ds-grow" />
        <span className="ds-mono">RL {tier.id} {ready.toUpperCase()} · POWER {fmtNum(power)}</span>
      </div>
      {tab === 'loadout' && (
        <div className="lo-grid">
          <div className="ds-col lo-weapons">
            <span className="ds-lbl">Weapons · Z swaps in the field</span>
            {weaponTile('weapon', 150)}
            {weaponTile('weapon2', 116)}
            <span className="ds-lbl" style={{ marginTop: 4 }}>Abilities</span>
            <div className="lo-abilities">
              {(['ability', 'ability2', 'ultimate'] as SlotId[]).map((s) => <SlotTile key={s} save={save} slot={s} it={equipped[s]} sel={sel === s} pick={() => setSel(s)} height={92} />)}
            </div>
          </div>
          <div className="ds-col lo-build">
            <span className="ds-lbl">Build</span>
            <div className="ds-col"><span className="ds-lbl">Firepower</span><span className="ds-row" style={{ alignItems: 'baseline' }}><span className="ds-numxl">{fmtNum(score.dps)}</span><span className="ds-meta">DPS · best weapon in hand</span></span></div>
            <div className="ds-col"><span className="ds-lbl">Survivability</span><span className="ds-row" style={{ alignItems: 'baseline' }}><span className="ds-numxl" style={{ fontSize: 46 }}>{fmtNum(score.ehp)}</span><span className="ds-meta">effective hull</span></span></div>
            <div className="ds-row" style={{ gap: 28 }}>
              <div className="ds-col"><span className="ds-lbl">Mobility</span><span className="ds-num">{fmtNum(Math.round(score.mobility))}</span></div>
              <div className="ds-col"><span className="ds-lbl">Towers</span><span className="ds-num">{fmtNum(Math.round(score.towers))}</span></div>
            </div>
            <div className="ds-hr" />
            <div className="ds-col" style={{ gap: 6 }}>
              <span className="ds-lbl">Ready for</span>
              <span className="ds-row"><span className={`ds-num ${ready === 'easy' || ready === 'fair' ? 'ds-up' : 'ds-warn'}`}>RL {tier.id}</span><span className="ds-meta">{ready} · recommended RL {rec}</span></span>
            </div>
            <div className="ds-col" style={{ gap: 6 }}>
              <span className="ds-lbl">Set bonus</span>
              {sets.length ? sets.map((a) => <span key={a.set.id} style={{ fontSize: 14 }}><b style={{ color: '#d4b2ff' }}>{a.set.name} {a.pieces} / 4</b> · {a.bonuses.length ? a.bonuses[a.bonuses.length - 1].text : `${2 - a.pieces} more for the first bonus`}</span>) : <span className="ds-meta">No set pieces worn. Rare+ gear can belong to a set.</span>}
            </div>
          </div>
          <div className="lo-gear">
            {GEAR.map((s) => <SlotTile key={s} save={save} slot={s} it={equipped[s]} sel={sel === s} pick={() => setSel(s)} height={120} />)}
          </div>
        </div>
      )}
      {tab === 'storage' && <StoragePanel flow={flow} />}
      {tab === 'stats' && <DroneStats equipped={equipped} />}
      {tab === 'presets' && (
        <div className="presets ds-col" style={{ gap: 8, maxWidth: 720 }}>
          {save.presets.map((p, i) => {
            const n = Object.values(p.slots).filter(Boolean).length;
            const missing = Object.values(p.slots).filter((u) => u && !save.items.some((it) => it.uid === u)).length;
            const active = n > 0 && SLOTS.every((s) => (p.slots[s.id] ?? null) === (save.loadout[s.id] ?? null));
            return (
              <div key={i} className={`preset ds-list-row ${active ? 'on' : ''}`}>
                <span className="ds-col ds-grow"><b className="ds-h3">{p.name}</b><span className="ds-meta">{n ? `${n} item${n === 1 ? '' : 's'}${missing ? ` · ${missing} missing` : ''}${active ? ' · active' : ''}` : 'Empty'}</span></span>
                <button className="ds-btn" onClick={() => mutate('savePreset', [i], `Saved to ${p.name}`, 'Cannot save')}>SAVE CURRENT</button>
                <button className="ds-btn" disabled={!n || active} onClick={() => mutate('loadPreset', [i], `${p.name} equipped`, 'Nothing to change')}>LOAD</button>
              </div>
            );
          })}
        </div>
      )}
      {tab !== 'storage' && <div className="lo-bot ds-row">
        <span className="ds-lbl">Presets</span>
        {save.presets.map((p, i) => {
          const n = Object.values(p.slots).filter(Boolean).length;
          const active = n > 0 && SLOTS.every((s) => (p.slots[s.id] ?? null) === (save.loadout[s.id] ?? null));
          return <button key={i} className={`ds-chip ${active ? 'solid' : ''}`} disabled={!n || active} onClick={() => mutate('loadPreset', [i], `${p.name} equipped`, 'Nothing to change')}>{i + 1} · {p.name}</button>;
        })}
        {msg && <span className="term-msg ds-meta">{msg}</span>}
        <span className="ds-grow" />
        {tab === 'loadout' && selItem && !getSlot(sel).required && <Hint keys="X" onClick={() => mutate('unequipToStorage', [sel], 'Moved to storage', 'Storage full')}>Unequip {rarity(selItem.rarity).label.toLowerCase()} {getSlot(sel).label.toLowerCase()}</Hint>}
      </div>}
    </Shell>
  );
}
