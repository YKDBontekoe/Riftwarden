import { useMemo, useState } from 'react';
import { sfx } from '@riftwarden/game/audio/Sfx';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import type { Flow } from '../../core/Flow';
import { DroneStats } from '../DroneStats';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { type ItemInstance, type SlotId, SLOTS } from '@riftwarden/rules/progression/items';
import { equippedItem, type SaveData } from '@riftwarden/rules/progression/save';
import { useSave } from '../App';
import { Shell } from '../shell';

export function useEquipped(save: SaveData): Record<SlotId, ItemInstance | null> {
  return useMemo(() => Object.fromEntries(SLOTS.map((s) => [s.id, equippedItem(save, s.id)])) as Record<SlotId, ItemInstance | null>, [save]);
}

export function LoadoutTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const equipped = useEquipped(save);
  const [msg, setMsg] = useState('');
  const mutate = (op: string, args: unknown[], ok: string, fail: string) => {
    const done = flow.profile.op(op, args).ok;
    setMsg(done ? ok : fail);
    sfx.play(done ? 'equip' : 'buildDeny');
  };
  return (
    <Shell code="DC-02" title="DRONE CONFIGURATION" sub="Warden Mk-I · loadout & calculated statistics" close={close} wide>
      <div className="loadout-grid">
        <div className="slots-col">
          <div className="col-label">EQUIPMENT SLOTS</div>
          {SLOTS.map((slot) => {
            const it = equipped[slot.id];
            const r = it ? rarity(it.rarity) : null;
            return (
              <div key={slot.id} className={`slot ${it ? 'filled' : ''}`} style={r ? { ['--rc' as string]: r.color } : undefined}>
                <span className="slot-label">{slot.label}</span>
                <b>{it ? it.name : 'EMPTY'}</b>
                <em>
                  {it ? `${r!.label.toUpperCase()} · LV ${fmtNum(it.level)} · ${it.affixes.length} affix${it.affixes.length === 1 ? '' : 'es'}` : 'Equip from the storage terminal'}
                  {it && !slot.required && (
                    <button className="mini" onClick={() => mutate('unequipToStorage', [slot.id], 'Moved to storage', 'Storage full')}>
                      UNEQUIP
                    </button>
                  )}
                </em>
              </div>
            );
          })}
          <div className="col-label">SAVED CONFIGURATIONS</div>
          <div className="presets">
            {save.presets.map((p, i) => {
              const n = Object.values(p.slots).filter(Boolean).length;
              const missing = Object.values(p.slots).filter((u) => u && !save.items.some((it) => it.uid === u)).length;
              const active = n > 0 && SLOTS.every((s) => (p.slots[s.id] ?? null) === (save.loadout[s.id] ?? null));
              return (
                <div key={i} className={`preset ${active ? 'on' : ''}`}>
                  <b>{p.name}</b>
                  <em>{n ? `${n} item${n === 1 ? '' : 's'}${missing ? ` · ${missing} missing` : ''}${active ? ' · ACTIVE' : ''}` : 'EMPTY'}</em>
                  <button className="mini" onClick={() => mutate('savePreset', [i], `Saved to ${p.name}`, 'Cannot save')}>
                    SAVE
                  </button>
                  <button className="mini" disabled={!n || active} onClick={() => mutate('loadPreset', [i], `${p.name} equipped`, 'Nothing to change')}>
                    LOAD
                  </button>
                </div>
              );
            })}
          </div>
          {msg && <div className="term-msg">{msg}</div>}
        </div>
        <div className="stats-col">
          <DroneStats equipped={equipped} />
        </div>
      </div>
    </Shell>
  );
}
