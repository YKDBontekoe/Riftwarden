import { useSyncExternalStore } from 'react';
import { isUnlocked, lockReason, STATION_FEATURE, unlockDef } from '@riftwarden/rules/progression/unlocks';
import type { Flow } from '../core/Flow';
import { CURRENCIES, currencyTooltip } from '@riftwarden/rules/economy/currencies';
import { HQ_STATIONS } from '@riftwarden/rules/home/layout';
import { STATION_INFO } from '@riftwarden/rules/home/stationInfo';
import { levelInfo, pointsAt, POINTS_PER_LEVEL, ringsAt } from '@riftwarden/rules/progression/level';
import { useSave } from './useSave';
import { stationArtwork } from '@riftwarden/game/visuals/fieldArtwork';
import { FieldArt } from './FieldArt';
import { FieldIcon, STATION_ICON } from './FieldIcon';
import { CurrencyIcon } from './inventory/thumbs';

/** Command Console: Warden level, XP and skill points at a glance. */
export function WardenProgress({ flow }: { flow: Flow }) {
  const save = useSave(flow);
  const info = levelInfo(save.progress.xp);
  const free = Math.max(0, pointsAt(info.level) - save.progress.tree.allocated.length);
  return (
    <>
      <div className="col-label">WARDEN LEVEL</div>
      <div className="xp-gain" data-testid="command-level">
        <b>
          LEVEL {info.level}
          {free > 0 && <span className="lvlup">{free} POINT{free > 1 ? 'S' : ''} TO SPEND</span>}
        </b>
        <div className="xp-bar">
          <i style={{ width: `${Math.round(info.frac * 100)}%` }} />
        </div>
        <small>
          {save.progress.xp.toLocaleString()} XP total · {info.need - info.into} XP to level {info.level + 1} · {ringsAt(info.level)} lattice ring{ringsAt(info.level) > 1 ? 's' : ''} open
        </small>
      </div>
    </>
  );
}

/** Every HQ station: what it is for, which currencies it uses, and a ping to find it. */
export function StationDirectory({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSyncExternalStore(flow.profile.store.subscribe, flow.profile.store.get).save;
  return (
    <>
      <div className="col-label">STATION DIRECTORY</div>
      <div className="station-dir" data-testid="station-directory">
        {HQ_STATIONS.map((st) => {
          const info = STATION_INFO[st.id];
          if (!info) return null;
          const locked = STATION_FEATURE[st.id] ? lockReason(save, STATION_FEATURE[st.id]) : null;
          // Staged unlocks: offline stations are summarised below instead of listed.
          if (locked) return null;
          return (
            <button
              key={st.id}
              data-station={st.id}
              title="Mark this station in the HQ"
              onClick={() => {
                close();
                flow.home?.pingStation(st.id);
              }}
            >
              <FieldArt name={stationArtwork(st.id)} className="directory-art" />
              <b><FieldIcon name={STATION_ICON[st.id]} /> {info.name.toUpperCase()}</b>
              {locked ? <span className="text-orange" data-testid={`dir-locked-${st.id}`}>⨯ {locked}</span> : <span>{info.purpose}</span>}
              <small>
                {st.area}
                {info.uses.length > 0 && <span className="directory-currencies">{info.uses.map((k) => <i key={k} className={CURRENCIES[k].cls} title={CURRENCIES[k].name}><CurrencyIcon k={k} /></i>)}</span>}
              </small>
            </button>
          );
        })}
      </div>
      <OfflineStations save={save} />
    </>
  );
}

/** XP gained (this run) with the resulting level and any level-ups. */
/** Warden level that opens the Neural Lattice (progression/unlocks). */
const LATTICE_LEVEL = (() => { const u = unlockDef('station:lattice'); return u && 'warden' in u.by ? u.by.warden : 1; })();

export function XpGain({ gained, totalAfter, label = 'WARDEN XP' }: { gained: number; totalAfter: number; label?: string }) {
  const after = levelInfo(totalAfter);
  const before = levelInfo(Math.max(0, totalAfter - gained));
  const ups = after.level - before.level;
  return (
    <div className="xp-gain" data-testid="xp-gain" title={currencyTooltip('xp')}>
      <small>{label}</small>
      <b>
        +{gained.toLocaleString()} XP · LEVEL {after.level}
        {ups > 0 && <span className="lvlup">LEVEL UP{ups > 1 ? ` ×${ups}` : ''} · +{ups * POINTS_PER_LEVEL} SKILL POINT{ups * POINTS_PER_LEVEL > 1 ? 'S' : ''}</span>}
      </b>
      <div className="xp-bar">
        <i style={{ width: `${Math.round(after.frac * 100)}%` }} />
      </div>
      {ups > 0 && <small>{isUnlocked({ progress: { xp: totalAfter }, threat: { unlocked: 1 } }, 'station:lattice') ? 'Spend skill points at the Neural Lattice in the drone bay.' : `Skill points wait for the Neural Lattice (opens at Warden level ${LATTICE_LEVEL}).`}</small>}
    </div>
  );
}

/** One line for the stations still offline (the unlock track in this console says when each opens). */
function OfflineStations({ save }: { save: Parameters<typeof lockReason>[0] }) {
  const off = HQ_STATIONS.filter((st) => STATION_INFO[st.id] && STATION_FEATURE[st.id] && lockReason(save, STATION_FEATURE[st.id]));
  if (!off.length) return null;
  return (
    <small className="text-faint" data-testid="dir-offline">
      {off.length} more station{off.length === 1 ? ' is' : 's are'} offline. They power up as you level; see the unlock track.
    </small>
  );
}
