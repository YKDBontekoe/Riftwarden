// Run summary: secured items that are upgrades for the build, with one button to equip them (named ops, so the change
// syncs like any other). New wardens otherwise had to find the Drone Configuration terminal to use their first finds.
import { useMemo, useState } from 'react';
import type { Flow } from '../core/Flow';
import { suggestEquips } from '@riftwarden/rules/progression/gearSuggest';
import { getSlot } from '@riftwarden/rules/progression/items';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { treeModifiers } from '@riftwarden/rules/progression/skilltree';
import { sfx } from '@riftwarden/game/audio/Sfx';

export function GearUpgrades({ flow, save, uids }: { flow: Flow; save: SaveData; uids: readonly string[] }) {
  const [done, setDone] = useState<string | null>(null);
  const list = useMemo(
    () => suggestEquips(save, uids, { extra: treeModifiers(save.progress.tree.seed, save.progress.tree.allocated), mastery: save.progress.mastery, faction: null }),
    [save, uids],
  );
  if (done) return <div className="gear-up done" data-testid="gear-upgrades-done">{done}</div>;
  if (!list.length) return null;
  return (
    <div className="gear-up" data-testid="gear-upgrades">
      <div className="cp-label">UPGRADES FOR YOUR BUILD</div>
      {list.map((g) => (
        <div key={g.uid} className="gear-up-row">
          <span className="text-ok">▲</span> <b>{g.name}</b> <span className="text-faint">→ {getSlot(g.slot).label}{g.replaces ? '' : ' (empty)'}</span>
        </div>
      ))}
      <button
        className="m-0 mt-[6px] w-auto px-[14px] py-[8px] text-[12px]"
        data-testid="gear-upgrades-equip"
        onClick={() => {
          let n = 0;
          for (const g of list) if (flow.profile.op('equipFromStorage', [g.uid, g.slot]).ok) n++;
          sfx.play(n ? 'chargeReady' : 'buildDeny');
          setDone(n ? `${n} upgrade${n === 1 ? '' : 's'} equipped. Swapped-out gear went to storage.` : 'Could not equip (storage full?).');
        }}
      >
        EQUIP {list.length === 1 ? 'IT' : `ALL ${list.length}`}
      </button>
    </div>
  );
}
