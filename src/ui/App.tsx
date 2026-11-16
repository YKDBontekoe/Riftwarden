import { useEffect, useState } from 'react';
import type { Game } from '../core/Game';
import type { Settings } from '../core/settings';
import { Hud } from './Hud';
import { useHud } from './store';

interface Props {
  getGame: () => Game | null;
}

export function App({ getGame }: Props) {
  const screen = useHud((s) => s.screen);
  const game = getGame();
  return (
    <>
      {(screen === 'playing' || screen === 'paused' || screen === 'defeat') && game && <Hud game={game} />}
      {screen === 'loading' && <Loading />}
      {screen === 'menu' && game && <MainMenu game={game} />}
      {screen === 'paused' && game && <PauseMenu game={game} />}
      {screen === 'defeat' && game && <DefeatScreen game={game} />}
    </>
  );
}

function Loading() {
  return (
    <div className="screen loading">
      <div className="load-box">
        <Logo small />
        <div className="load-bar">
          <i />
        </div>
        <div className="load-text">Initializing reactor containment…</div>
      </div>
    </div>
  );
}

function Logo({ small }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'small' : ''}`}>
      <div className="logo-mark">
        <svg viewBox="0 0 48 48" width={small ? 34 : 54} height={small ? 34 : 54}>
          <path d="M24 3 L43 14 V34 L24 45 L5 34 V14 Z" className="hex" />
          <path d="M24 12 L33 17 V31 L24 36 L15 31 V17 Z" className="hex-in" />
          <path d="M24 17 V31 M18 24 H30" className="cross" />
        </svg>
      </div>
      <div className="logo-text">
        <div className="logo-word" data-text="RIFTWARDEN">
          RIFT<span>WARDEN</span>
        </div>
        {!small && <div className="logo-sub">REACTOR DEFENSE INITIATIVE · SECTOR 07</div>}
      </div>
    </div>
  );
}

function SettingsPanel({ game, compact }: { game: Game; compact?: boolean }) {
  const [s, setS] = useState<Settings>(game.settings);
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    game.applySettings(next);
    if (patch.quality && patch.quality !== s.quality) location.reload();
  };
  return (
    <div className="settings">
      <label>
        <span>Mouse sensitivity</span>
        <input type="range" min={0.2} max={3} step={0.05} value={s.sensitivity} onChange={(e) => update({ sensitivity: +e.target.value })} />
        <em>{s.sensitivity.toFixed(2)}</em>
      </label>
      {!compact && (
        <label>
          <span>Field of view</span>
          <input type="range" min={70} max={110} step={1} value={s.fov} onChange={(e) => update({ fov: +e.target.value })} />
          <em>{s.fov}°</em>
        </label>
      )}
      <label>
        <span>Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => update({ volume: +e.target.value })} />
        <em>{Math.round(s.volume * 100)}%</em>
      </label>
      {!compact && (
        <div className="quality">
          <span>Graphics</span>
          <div className="seg">
            <button className={s.quality === 'high' ? 'on' : ''} onClick={() => update({ quality: 'high' })}>
              CINEMATIC
              <small>Reflections · AO · shadows</small>
            </button>
            <button className={s.quality === 'low' ? 'on' : ''} onClick={() => update({ quality: 'low' })}>
              PERFORMANCE
              <small>Bloom only</small>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const CONTROLS: [string, string][] = [
  ['WASD', 'Move'],
  ['MOUSE', 'Aim · LMB fire'],
  ['SPACE', 'Jump · again to boost'],
  ['SHIFT', 'Dash · hold to sprint'],
  ['2 / B', 'Build Sentinel'],
  ['Q', 'Tactical slow-time'],
  ['HOLD X', 'Recycle turret'],
  ['G', 'Start wave early'],
  ['ESC', 'Pause'],
  ['F3', 'Performance stats'],
];

function Controls() {
  return (
    <div className="controls">
      {CONTROLS.map(([k, v]) => (
        <div key={k}>
          <kbd>{k}</kbd>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

function MainMenu({ game }: { game: Game }) {
  const [tab, setTab] = useState<'briefing' | 'settings' | 'controls'>('briefing');
  return (
    <div className="screen menu">
      <div className="menu-col">
        <Logo />
        <div className="tagline">Defend the reactor. Hold the line. There is no last wave.</div>
        <button className="primary deploy" onClick={() => void game.deploy()}>
          <span>DEPLOY</span>
          <i>▶</i>
        </button>
        <div className="tabs">
          {(['briefing', 'settings', 'controls'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="tab-body">
          {tab === 'briefing' && (
            <div className="briefing">
              <p>
                A rift has torn open above the city. Machines pour through three gates toward the <b className="c">reactor</b>.
              </p>
              <ul>
                <li>
                  <i className="o" />
                  <span>
                    Hostiles follow the <b className="o">orange lanes</b>. Build turrets beside them.
                  </span>
                </li>
                <li>
                  <i className="c" />
                  <span>
                    Shoot <b>glowing visors</b> for guaranteed critical hits.
                  </span>
                </li>
                <li>
                  <i className="v" />
                  <span>
                    <b className="v">Tactical mode</b> slows hostiles while you build.
                  </span>
                </li>
              </ul>
            </div>
          )}
          {tab === 'settings' && <SettingsPanel game={game} />}
          {tab === 'controls' && <Controls />}
        </div>
      </div>
      <div className="menu-status">
        <div className="chip red">
          <i />
          RIFT ACTIVITY · SEVERE
        </div>
        <div className="chip cyan">
          <i />
          REACTOR ONLINE
        </div>
      </div>
      <div className="menu-foot">BUILD 0.2 · BABYLON.JS · HAVOK</div>
    </div>
  );
}

function PauseMenu({ game }: { game: Game }) {
  const [tab, setTab] = useState<'settings' | 'controls'>('settings');
  return (
    <div className="screen dim">
      <div className="modal panel-frame">
        <div className="modal-title">
          <span className="tick" />
          PAUSED
        </div>
        <button className="primary" onClick={() => void game.resume()}>
          RESUME
        </button>
        <button onClick={() => game.restart()}>RESTART RUN</button>
        <div className="tabs">
          {(['settings', 'controls'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        {tab === 'settings' ? <SettingsPanel game={game} compact /> : <Controls />}
      </div>
    </div>
  );
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function DefeatScreen({ game }: { game: Game }) {
  const stats = useHud((s) => s.stats);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1800);
    return () => clearTimeout(t);
  }, []);
  if (!ready) return null;
  const cards: [string, string][] = [
    ['WAVE REACHED', String(stats.wave)],
    ['HOSTILES DESTROYED', String(stats.kills)],
    ['TURRETS DEPLOYED', String(stats.turretsBuilt)],
    ['CORES EARNED', String(stats.coresEarned)],
    ['TIME SURVIVED', fmtTime(stats.time)],
  ];
  return (
    <div className="screen dim defeat">
      <div className="modal wide panel-frame red">
        <div className="defeat-title" data-text="REACTOR LOST">
          REACTOR LOST
        </div>
        <div className="defeat-sub">Containment failed. The rift claims Sector 07.</div>
        <div className="stat-cards">
          {cards.map(([k, v], i) => (
            <div key={k} className="card" style={{ animationDelay: `${0.08 * i}s` }}>
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
        <button className="primary" onClick={() => game.restart()}>
          REDEPLOY
        </button>
        <div className="sub">
          or press <kbd>R</kbd>
        </div>
      </div>
    </div>
  );
}
