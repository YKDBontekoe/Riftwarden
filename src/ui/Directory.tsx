import type { Flow } from '../core/Flow';
import { CURRENCIES, currencyTooltip } from '../economy/currencies';
import { HQ_STATIONS } from '../home/layout';
import { STATION_INFO } from '../home/stationInfo';
import { levelInfo, pointsAt, POINTS_PER_LEVEL, ringsAt } from '../progression/level';
import { useSave } from './App';

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
  return (
    <>
      <div className="col-label">STATION DIRECTORY</div>
      <div className="station-dir" data-testid="station-directory">
        {HQ_STATIONS.map((st) => {
          const info = STATION_INFO[st.id];
          if (!info) return null;
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
              <b>{info.name.toUpperCase()}</b>
              <span>{info.purpose}</span>
              <small>
                {st.area}
                {info.uses.length > 0 && ` · ${info.uses.map((k) => CURRENCIES[k].icon).join(' ')}`}
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** XP gained (this run) with the resulting level and any level-ups. */
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
      {ups > 0 && <small>Spend skill points at the Neural Lattice in the drone bay.</small>}
    </div>
  );
}
