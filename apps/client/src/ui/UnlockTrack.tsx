// Staged unlocks in the HQ (docs/design/progression-design.md §5): the full track (Command Console), the next three goals
// (HQ strip) and the "just unlocked" toast. Locked entries are teasers: name, what they do and when they open.
import { useEffect } from 'react';
import { hudStore } from '@riftwarden/game/ui/store';
import { nextUnlocks, requirementText, type TrackEntry, unlockTrack, type UnlockKind } from '@riftwarden/rules/progression/unlocks';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { useHud } from './useHud';

const KIND: Record<UnlockKind, string> = { family: 'WEAPON FAMILY', slot: 'LOADOUT SLOT', station: 'STATION', system: 'SYSTEM' };

function Entry({ e, compact }: { e: TrackEntry; compact?: boolean }) {
  return (
    <div className={`grid gap-[3px] border-l-2 py-[5px] pl-[9px] ${e.open ? 'border-ok/70' : 'border-line'}`} data-testid={`unlock-${e.def.id}`} data-open={e.open ? '1' : '0'}>
      <div className="flex items-baseline justify-between gap-[10px]">
        <b className={`text-[13px] ${e.open ? '' : 'text-muted'}`}>{e.open ? '✓ ' : ''}{e.def.label}</b>
        <span className="font-mono text-[10px] tracking-[0.1em] text-faint whitespace-nowrap">{e.open ? KIND[e.def.kind] : e.status.toUpperCase()}</span>
      </div>
      {!compact && <span className="text-[12px] text-faint">{e.def.blurb}</span>}
      {!e.open && (
        <div className="h-[3px] bg-[rgb(255_255_255/0.07)]" aria-hidden="true">
          <div className="h-full bg-cyan/70" style={{ width: `${Math.round(e.progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Every unlock: what is open, what comes next (Command Console). */
export function UnlockTrackPanel({ save }: { save: SaveData }) {
  const track = unlockTrack(save);
  const open = track.filter((e) => e.open).length;
  const next = nextUnlocks(save, 3).map((e) => e.def.id);
  const rest = track.filter((e) => !e.open && !next.includes(e.def.id));
  return (
    <div className="grid gap-[6px] mt-[14px]" data-testid="unlock-track">
      <div className="col-label">UNLOCK TRACK · {open}/{track.length}</div>
      {track.filter((e) => next.includes(e.def.id)).map((e) => <Entry key={e.def.id} e={e} />)}
      <details className="field-notes">
        <summary>All unlocks ({rest.length} more locked, {open} open)</summary>
        <div className="grid gap-[4px] mt-[6px]">
          {track.filter((e) => !next.includes(e.def.id)).map((e) => <Entry key={e.def.id} e={e} compact />)}
        </div>
      </details>
    </div>
  );
}

/** The next goals, always visible in the HQ (small strip under the reserves). */
export function NextUnlocksStrip({ save }: { save: SaveData }) {
  const next = nextUnlocks(save, 2);
  if (!next.length) return null;
  return (
    <div className="hq-next panel-frame grid gap-[5px] p-[8px_12px] w-[250px]" data-testid="next-unlocks">
      <span className="font-mono text-[10px] tracking-[0.12em] text-cyan">NEXT UNLOCKS</span>
      {next.map((e) => (
        <div key={e.def.id} className="grid gap-[2px]">
          <div className="flex justify-between gap-[8px] text-[12px]">
            <b className="font-[600] truncate">{e.def.label}</b>
            <span className="font-mono text-[10px] text-faint whitespace-nowrap" title={requirementText(e.def)}>{e.status}</span>
          </div>
          <div className="h-[3px] bg-[rgb(255_255_255/0.08)]"><div className="h-full bg-cyan/70" style={{ width: `${Math.round(e.progress * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** "Unlocked" toast in the HQ for features that opened during the last run (clears itself). */
export function UnlockToast() {
  const list = useHud((s) => s.unlocks);
  useEffect(() => {
    if (!list?.length) return;
    const t = setTimeout(() => hudStore.set({ unlocks: [] }), 14000);
    return () => clearTimeout(t);
  }, [list]);
  if (!list?.length) return null;
  // A big jump (several levels in one run) shows three cards and a summary line for the rest.
  const shown = list.length > 4 ? list.slice(0, 3) : list;
  const more = list.length > 4 ? list.slice(3) : [];
  return (
    <div className="fixed right-[22px] top-[150px] grid gap-[6px] w-[300px] pointer-events-none" data-testid="unlock-toast" aria-live="polite">
      {more.length > 0 && (
        <div className="panel-frame bg-glass p-[9px_12px] border-l-2 border-ok/80 grid gap-[2px] order-last">
          <span className="font-mono text-[10px] tracking-[0.14em] text-ok">+{more.length} MORE UNLOCKED</span>
          <span className="text-[12px] text-muted">{more.map((u) => u.label).join(' · ')}</span>
        </div>
      )}
      {shown.map((u) => (
        <div key={u.id + u.at} className="panel-frame bg-glass p-[9px_12px] border-l-2 border-ok/80 grid gap-[2px] [animation:rise_.25s_ease-out]">
          <span className="font-mono text-[10px] tracking-[0.14em] text-ok">UNLOCKED</span>
          <b className="text-[14px]">{u.label}</b>
          <span className="text-[12px] text-muted">{u.blurb}</span>
        </div>
      ))}
    </div>
  );
}
