import { lockedSlots } from '@riftwarden/rules/progression/unlocks';
import { useMemo } from 'react';
import { sfx } from '@riftwarden/game/audio/Sfx';
import type { Flow } from '../../core/Flow';
import { STORAGE_EXPANSION, storageExpansionCost } from '@riftwarden/rules/loot/economy';
import { SLOTS } from '@riftwarden/rules/progression/items';
import { equippedItem, type SaveData, storedItems } from '@riftwarden/rules/progression/save';
import { useSave } from '../useSave';
import { useTx, TxMessage, CostLine } from '../economy';
import { dismantleYield } from '@riftwarden/rules/economy/config';
import { type InvEntry, InventoryView } from '../items';
import { LoadoutTerminal, useEquipped } from './Loadout';

export function saveEntries(save: SaveData): InvEntry[] {
  const out: InvEntry[] = [];
  for (const s of SLOTS) {
    const it = equippedItem(save, s.id);
    if (it) out.push({ item: it, status: 'equipped', equippedIn: s.id });
  }
  for (const it of storedItems(save)) out.push({ item: it, status: 'stored', equippedIn: null });
  return out;
}

export function StoragePanel({ flow }: { flow: Flow }) {
  const save = useSave(flow);
  const equipped = useEquipped(save);
  const entries = useMemo(() => saveEntries(save), [save]);
  const used = save.storage.uids.length;
  const over = used > save.storage.capacity;
  const cost = storageExpansionCost(save.storage.expansions);
  const act = (op: string, args: unknown[]) => {
    const ok = flow.profile.op(op, args).ok;
    sfx.play(ok ? 'equip' : 'buildDeny');
  };
  const tx = useTx(flow, 'salvage');
  return (
    <>
      <InventoryView
        entries={entries}
        equipped={equipped}
        lockedSlots={lockedSlots(save)}
        actions={{
          canChange: true,
          lockedReason: '',
          equip: (uid, slot) => act('equipFromStorage', [uid, slot ?? null]),
          unequip: (slot) => act('unequipToStorage', [slot]),
          remove: {
            label: (e) => {
              const y = dismantleYield(e.item);
              return `DISMANTLE · +${y.salvage.toLocaleString()} SALVAGE${y.components ? ` · +${y.components.toLocaleString()} COMP` : ''}`;
            },
            allowed: (e) => e.status === 'stored' && !e.item.locked,
            run: (uid) => void tx.run('dismantle', 'dismantleItems', [[uid]], (r) => `Dismantled · +${r.salvage.toLocaleString()} salvage${r.components ? ` · +${r.components.toLocaleString()} components` : ''}`),
            confirm: 'Dismantle permanently?',
          },
          extra: (e) =>
            e.status === 'stored' || e.status === 'equipped' ? (
              <button className="ds-btn" onClick={() => void tx.run('lock', 'setItemLock', [e.item.uid, !e.item.locked], () => (e.item.locked ? 'Unlocked' : 'Locked: protected from selling and dismantling'))}>
                {e.item.locked ? 'UNLOCK' : 'LOCK'}
              </button>
            ) : null,
        }}
        header={
          <div className="storage-bar ds-row">
            <div className={`cap ${over ? 'over' : ''}`}>
              <span>
                BAYS {used} / {save.storage.capacity} {over && '· OVER CAPACITY: DEPLOYMENT LOCKED'}
              </span>
              <div className="cap-bar">
                <i style={{ width: `${Math.min(100, (used / save.storage.capacity) * 100)}%` }} />
              </div>
            </div>
            <button className="mini expand" disabled={save.resources.salvage < cost} onClick={() => act('expandStorage', [])}>
              +{STORAGE_EXPANSION} BAYS · <CostLine cost={{ salvage: cost }} save={save} />
            </button>
            <TxMessage msg={tx.msg} />
          </div>
        }
      />
    </>
  );
}

/** The storage station opens the drone bay on its Storage tab (canvas: Loadout · Storage · Presets). */
export function StorageTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  return <LoadoutTerminal flow={flow} close={close} initial="storage" />;
}
