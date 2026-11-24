// Staged unlocks: the pausing NEW SYSTEM ONLINE card. Shown as soon as the warden walks the HQ (screen 'unlock',
// HomeBase stops the drone and frees the pointer) or on top of the arena checkpoint panel (already paused).
import { useEffect } from 'react';
import type { UnlockKind } from '@riftwarden/rules/progression/unlocks';
import type { Flow } from '../core/Flow';
import { ackUnlockCard } from '../core/unlockWatch';
import { useHud } from './useHud';

const KIND: Record<UnlockKind, string> = { family: 'WEAPON FAMILY', slot: 'LOADOUT SLOT', station: 'STATION', system: 'SYSTEM' };

/** Where to find what opened (the card's one practical hint). */
function whereText(kind: string, id: string): string {
  if (kind === 'station' || id.startsWith('workshop:')) return 'Its station in the HQ is powered up and marked.';
  if (kind === 'family') return 'Starts dropping on operations and can be crafted once the Fabricator is online.';
  if (kind === 'slot') return 'Equip it at Drone Configuration.';
  return 'Active from your next operation.';
}

export function UnlockCard({ flow }: { flow: Flow }) {
  const list = useHud((s) => s.unlockCard) ?? [];
  const ack = () => {
    const ids = list.map((u) => u.id);
    ackUnlockCard(flow.profile.save.profile.id);
    void flow.home?.closeUnlocks(ids);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') {
        e.preventDefault();
        ack();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  if (!list.length) return null;
  // A big jump (several levels at once) lists everything, compact past four entries.
  const compact = list.length > 4;
  return (
    <div className="screen dim" data-testid="unlock-card" role="dialog" aria-modal="true" aria-labelledby="unlock-card-title">
      <div className="modal panel-frame grid gap-[12px] w-[min(520px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-auto">
        <div className="grid gap-[2px]">
          <span className="font-mono text-[11px] tracking-[0.18em] text-ok">{list.length === 1 ? 'NEW SYSTEM ONLINE' : `${list.length} NEW SYSTEMS ONLINE`}</span>
          <h2 id="unlock-card-title" className="cp-title">{list.length === 1 ? list[0].label : 'Headquarters expanded'}</h2>
        </div>
        <div className="grid gap-[8px]">
          {list.map((u) => (
            <div key={u.id} className="grid gap-[3px] border-l-2 border-ok/80 pl-[10px] py-[3px]" data-unlock={u.id}>
              <div className="flex items-baseline justify-between gap-[10px]">
                <b className="text-[14px]">{u.label}</b>
                <span className="font-mono text-[10px] tracking-[0.1em] text-faint whitespace-nowrap">{KIND[u.kind as UnlockKind] ?? 'SYSTEM'}</span>
              </div>
              {!compact && <span className="text-[13px] text-muted">{u.blurb}</span>}
              {!compact && <span className="text-[12px] text-faint">{whereText(u.kind, u.id)}</span>}
            </div>
          ))}
        </div>
        <button className="primary" data-testid="unlock-card-ok" autoFocus onClick={ack}>
          GOT IT
        </button>
      </div>
    </div>
  );
}
