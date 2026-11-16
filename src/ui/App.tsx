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
      {screen === 'loading' && (
        <div className="screen">
          <div className="panel small">
            <div className="title">INITIALIZING</div>
            <div className="sub">Spinning up reactor…</div>
          </div>
        </div>
      )}
      {screen === 'menu' && game && <MainMenu game={game} />}
      {screen === 'paused' && game && <PauseMenu game={game} />}
      {screen === 'defeat' && game && <DefeatScreen game={game} />}
    </>
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
        <>
          <label>
            <span>Field of view</span>
            <input type="range" min={70} max={110} step={1} value={s.fov} onChange={(e) => update({ fov: +e.target.value })} />
            <em>{s.fov}°</em>
          </label>
          <label>
            <span>Graphics</span>
            <select value={s.quality} onChange={(e) => update({ quality: e.target.value as Settings['quality'] })}>
              <option value="high">High (shadows, MSAA)</option>
              <option value="low">Performance</option>
            </select>
            <em />
          </label>
        </>
      )}
      <label>
        <span>Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => update({ volume: +e.target.value })} />
        <em>{Math.round(s.volume * 100)}%</em>
      </label>
    </div>
  );
}

const CONTROLS: [string, string][] = [
  ['WASD', 'Move'],
  ['Mouse / LMB', 'Aim / fire'],
  ['Space', 'Jump · again in air to boost'],
  ['Shift', 'Dash · hold to sprint'],
  ['2 / B', 'Build Sentinel turret'],
  ['Q', 'Tactical slow-time build'],
  ['Hold X', 'Recycle looked-at turret'],
  ['G', 'Start wave early'],
  ['Esc', 'Pause'],
  ['F3', 'Performance stats'],
];

function MainMenu({ game }: { game: Game }) {
  return (
    <div className="screen menu">
      <div className="panel">
        <div className="logo">
          RIFT<span>WARDEN</span>
        </div>
        <div className="tagline">Defend the reactor. Hold the line. There is no last wave.</div>
        <button className="primary" onClick={() => void game.deploy()}>
          DEPLOY
        </button>
        <SettingsPanel game={game} />
        <div className="controls">
          {CONTROLS.map(([k, v]) => (
            <div key={k}>
              <b>{k}</b> {v}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PauseMenu({ game }: { game: Game }) {
  return (
    <div className="screen dim">
      <div className="panel small">
        <div className="title">PAUSED</div>
        <button className="primary" onClick={() => void game.resume()}>
          RESUME
        </button>
        <button onClick={() => game.restart()}>RESTART RUN</button>
        <SettingsPanel game={game} compact />
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
  return (
    <div className="screen dim">
      <div className="panel small">
        <div className="title red">REACTOR LOST</div>
        <div className="stats">
          <div>
            <span>Wave reached</span>
            <b>{stats.wave}</b>
          </div>
          <div>
            <span>Hostiles destroyed</span>
            <b>{stats.kills}</b>
          </div>
          <div>
            <span>Turrets deployed</span>
            <b>{stats.turretsBuilt}</b>
          </div>
          <div>
            <span>Cores earned</span>
            <b>{stats.coresEarned}</b>
          </div>
          <div>
            <span>Time survived</span>
            <b>{fmtTime(stats.time)}</b>
          </div>
        </div>
        <button className="primary" onClick={() => game.restart()}>
          REDEPLOY
        </button>
        <div className="sub">
          or press <b>R</b>
        </div>
      </div>
    </div>
  );
}
