import { visibleCurrencies } from '@riftwarden/rules/progression/unlocks';
import { BoundKey } from './hud/widgets';
import { TutorialCard } from './TutorialCard';
import { useEffect, useState } from 'react';
import { HQ_STATIONS } from '@riftwarden/rules/home/layout';
import { lockReason, STATION_FEATURE } from '@riftwarden/rules/progression/unlocks';
import type { SaveData } from '@riftwarden/rules/progression/save';
import type { Flow } from '../core/Flow';
import { RESOURCE_KEYS, type ResourceKey } from '@riftwarden/rules/economy/config';
import { RES_CLASS } from './economy';
import { currencyTooltip } from '@riftwarden/rules/economy/currencies';
import { levelInfo, pointsAt } from '@riftwarden/rules/progression/level';
import { uiEvents } from '@riftwarden/game/ui/store';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { CurrencyIcon } from './inventory/thumbs';
import { useSave } from './useSave';
import { Banner, Perf } from './Hud';
import { useHud } from './useHud';
import { Cur } from './ds';
import { NextUnlocksStrip, UnlockToast } from './UnlockTrack';

/** Calm HQ overlay: location, reserve, selected Rift Level, interaction prompt. */
export function HomeHud({ flow }: { flow: Flow }) {
  const screen = useHud((s) => s.screen);
  const area = useHud((s) => s.area);
  const prompt = useHud((s) => s.prompt);
  const save = useSave(flow);
  const tier = getTier(save.threat.selected);
  const walking = screen === 'home';
  return (
    <div className={`hud home-hud ${walking ? '' : 'muted'}`}>
      <TutorialCard />
      <NextUnlocksStrip save={save} />
      <UnlockToast />
      <div className="hq-loc ds-col">
        <span className="ds-ov">Headquarters</span>
        <span className="ds-h2">{area || 'COMMAND DECK'}</span>
      </div>
      <div className="hq-res ds-row">
        <div className="res-line ds-row" data-testid="hq-resources">
          {visibleCurrencies(save).map((k) => <Cur key={k} k={k} value={save.resources[k]} />)}
        </div>
        <Deltas />
        <WardenLevel xp={save.progress.xp} allocated={save.progress.tree.allocated.length} />
        <span className="ds-col hq-rl"><span className="ds-lbl">{save.seasonId ? `Season ${save.seasonId}` : 'Rift Level'}</span><b className="ds-d">RL {tier.id} · {tier.name}</b></span>
      </div>
      {walking && <div className="fixed left-[50%] top-[50%] w-[4px] h-[4px] m-[-2px_0_0_-2px] [border-radius:50%] [background:rgba(255,255,255,0.85)] [box-shadow:0_0_6px_rgba(156,207,194,0.8)]" />}
      {walking && prompt && (
        <div className={`hq-prompt ds-glass ds-cut${prompt.locked ? ' locked' : ''}`} key={prompt.title} data-testid="hq-prompt">
          {prompt.locked ? <kbd className="[background:#3a2a22] [color:var(--orange)] [border-color:var(--orange)] [box-shadow:none]" aria-label="Locked">⨯</kbd> : <kbd>{prompt.key}</kbd>}
          <div className="ds-col">
            <b className="ds-h3">{prompt.title}</b>
            {prompt.locked ? <span className="text-orange" data-testid="hq-prompt-locked">LOCKED · {prompt.locked}</span> : <span>{prompt.action}</span>}
            {prompt.purpose && <em className="hq-purpose">{prompt.purpose}</em>}
          </div>
        </div>
      )}
      {walking && flow.home && <StationList home={flow.home} save={save} />}
      {walking && (
        <div className="hq-keys ds-row">
          <span className="ds-hint"><BoundKey action="move" />Move</span>
          <span className="ds-hint"><BoundKey action="use" />Use</span>
          <span className="ds-hint"><kbd>ESC</kbd>Pause</span>
        </div>
      )}
      <Banner />
      <Perf />
    </div>
  );
}

/** Bottom left while roaming (canvas "HQ free roam"): the nearest open stations with their distance. */
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** Screen-relative arrow toward a point (pure): `dx`/`dz` from the player, `yaw` as the player faces (0 = +z). */
export function bearingArrow(dx: number, dz: number, yaw: number): string {
  const rel = Math.atan2(dx, dz) - yaw;
  const a = Math.atan2(Math.sin(rel), Math.cos(rel));
  return ARROWS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

function stationDirectory(home: NonNullable<Flow['home']>, save: SaveData) {
  const p = home.player?.position;
  const yaw = home.player?.yaw ?? 0;
  const open: { id: string; title: string; dist: number; arrow: string }[] = [];
  let offline = 0;
  for (const st of HQ_STATIONS) {
    const f = STATION_FEATURE[st.id];
    if (f && lockReason(save, f)) {
      offline++;
      continue;
    }
    // Relocated stations stand where the warden put them.
    const pose = save.base.stations?.[st.id];
    const [x, z] = pose ? [pose.x, pose.z] : st.pos;
    open.push({ id: st.id, title: st.title, dist: p ? Math.hypot(x - p.x, z - p.z) : 0, arrow: p ? bearingArrow(x - p.x, z - p.z, yaw) : '' });
  }
  open.sort((a, b) => a.dist - b.dist);
  return { open, offline };
}

function StationList({ home, save }: { home: NonNullable<Flow['home']>; save: SaveData }) {
  const [dir, setDir] = useState(() => stationDirectory(home, save));
  useEffect(() => {
    const t = window.setInterval(() => setDir(stationDirectory(home, save)), 500);
    return () => window.clearInterval(t);
  }, [home, save]);
  if (!dir.open.length) return null;
  return (
    <div className="hq-stations ds-glass" data-testid="hq-stations">
      <span className="ds-lbl">Stations</span>
      <ul>
        {dir.open.slice(0, 5).map((s, i) => (
          <li key={s.id} className={i === 0 ? 'near' : ''}>
            <span className="ds-dia" aria-hidden="true" />
            <b>{s.title}</b>
            <em>{s.dist < 4 ? 'here' : <><span className="hs-dir" aria-hidden="true">{s.arrow}</span> {Math.round(s.dist)} m</>}</em>
          </li>
        ))}
      </ul>
      {dir.offline > 0 && <span className="ds-meta hs-off">{dir.offline} more offline · unlock by level</span>}
    </div>
  );
}

/** Floating "+N" indicators for resources gained or spent at HQ stations. */
function Deltas() {
  const [list, setList] = useState<{ id: number; k: ResourceKey; v: number }[]>([]);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('econ', (e) => {
      const add = RESOURCE_KEYS.filter((k) => e.delta[k]).map((k) => ({ id: ++id, k, v: e.delta[k]! }));
      if (!add.length) return;
      setList((l) => [...l.slice(-4), ...add]);
      const ids = new Set(add.map((a) => a.id));
      setTimeout(() => setList((l) => l.filter((x) => !ids.has(x.id))), 1700);
    });
  }, []);
  return (
    <>
      {list.map((d, i) => (
        <b key={d.id} className={`res-delta ${RES_CLASS[d.k]}`} style={{ top: 46 + i * 18 }}>
          {d.v > 0 ? '+' : '−'}
          {Math.abs(d.v).toLocaleString()} <CurrencyIcon k={d.k} />
        </b>
      ))}
    </>
  );
}

/** Warden level, XP progress and unspent skill points (HQ overlay). */
export function WardenLevel({ xp, allocated }: { xp: number; allocated: number }) {
  const info = levelInfo(xp);
  const free = Math.max(0, pointsAt(info.level) - allocated);
  return (
    <div className="warden-level ds-row" data-testid="warden-level" title={`${currencyTooltip('xp')} · ${info.into.toLocaleString()} / ${info.need.toLocaleString()} XP`}>
      <span className="wl-badge ds-cut-s" aria-hidden="true">{info.level}</span>
      <span className="ds-col">
        <b className="ds-d">WARDEN {info.level}</b>
        <span className="ds-meta">{free > 0 ? <em className="pts">{free} point{free > 1 ? 's' : ''}</em> : `${info.into.toLocaleString()} / ${info.need.toLocaleString()} XP`}</span>
        <span className="xp-bar"><i style={{ width: `${Math.round(info.frac * 100)}%` }} /></span>
      </span>
    </div>
  );
}
