import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '../core/Game';
import type { Settings } from '../core/settings';
import type { RunResult } from '../progression/run';
import type { SaveData } from '../progression/save';
import { getTier, nextCheckpoint } from '../progression/tiers';
import { HomeHud } from './HomeHud';
import { Hud } from './Hud';
import { useHud } from './store';
import { TerminalHost } from './TerminalHost';
import { ArenaInventory } from './LootHud';
import { BriefList } from './items';
import { BuildOverview, TowerPanel, UpgradePanel } from './Roguelite';
import { DevPanel } from './DevPanel';
import { milestoneLabel } from '../survival/records';
import { EVENTS, type EventId } from '../survival/events';

interface Props {
  getFlow: () => Flow | null;
}

export function useSave(flow: Flow): SaveData {
  return useSyncExternalStore(flow.profile.store.subscribe, () => flow.profile.store.get().save);
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const ARENA_SCREENS = new Set(['playing', 'paused', 'checkpoint', 'defeat', 'inventory', 'upgrade', 'build', 'towers']);
const HOME_HUD_SCREENS = new Set(['home', 'terminal', 'paused']);

export function App({ getFlow }: Props) {
  const screen = useHud((s) => s.screen);
  const location = useHud((s) => s.location);
  const flow = getFlow();
  const arena = flow?.arena ?? null;
  const home = flow?.home ?? null;
  return (
    <>
      {flow && location === 'arena' && arena && ARENA_SCREENS.has(screen) && <Hud key={`hud${flow.transitions}`} game={arena} />}
      {flow && location === 'home' && home && HOME_HUD_SCREENS.has(screen) && <HomeHud key={`home${flow.transitions}`} flow={flow} />}
      {screen === 'loading' && <Loading />}
      {screen === 'menu' && flow && <MainMenu flow={flow} />}
      {screen === 'terminal' && flow && home && <TerminalHost key={`term${flow.transitions}`} flow={flow} home={home} />}
      {screen === 'paused' && flow && <PauseMenu flow={flow} />}
      {screen === 'checkpoint' && flow && arena && <CheckpointPanel flow={flow} game={arena} />}
      {screen === 'upgrade' && arena && <UpgradePanel key={`up${arena.director.build.offers}`} game={arena} />}
      {screen === 'build' && arena && <BuildOverview game={arena} />}
      {screen === 'dev' && arena && flow && <DevPanel game={arena} flow={flow} />}
      {screen === 'towers' && arena && <TowerPanel game={arena} />}
      {screen === 'inventory' && arena && <ArenaInventory key={`inv${flow?.transitions}`} game={arena} />}
      {screen === 'defeat' && flow && <DefeatScreen flow={flow} />}
      {screen === 'summary' && flow && <SummaryScreen flow={flow} />}
      {screen === 'transit' && <Transit />}
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
        <div className="load-text">Initializing headquarters systems…</div>
      </div>
    </div>
  );
}

function Transit() {
  const t = useHud((s) => s.transit);
  return (
    <div className="screen transit">
      <div className="transit-box">
        <div className="transit-ring">
          <i />
          <i />
        </div>
        <div className="transit-title">{t?.title ?? 'TRANSFERRING'}</div>
        <div className="transit-sub">{t?.sub ?? ''}</div>
        <div className="load-bar">
          <i />
        </div>
      </div>
    </div>
  );
}

export function Logo({ small }: { small?: boolean }) {
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

function SettingsPanel({ flow, compact }: { flow: Flow; compact?: boolean }) {
  const [s, setS] = useState<Settings>(flow.settings);
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    flow.applySettings(next);
  };
  const inArena = flow.location === 'arena';
  return (
    <div className="settings">
      <label>
        <span>Mouse sensitivity</span>
        <input type="range" min={0.2} max={3} step={0.05} value={s.sensitivity} onChange={(e) => update({ sensitivity: +e.target.value })} />
        <em>{s.sensitivity.toFixed(2)}</em>
      </label>
      <label>
        <span>Field of view</span>
        <input type="range" min={70} max={110} step={1} value={s.fov} onChange={(e) => update({ fov: +e.target.value })} />
        <em>{s.fov}°</em>
      </label>
      <label>
        <span>Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => update({ volume: +e.target.value })} />
        <em>{Math.round(s.volume * 100)}%</em>
      </label>
      {!compact && (
        <div className="quality">
          <span>Graphics{inArena ? ' (applies on return to HQ)' : ''}</span>
          <div className="seg">
            <button className={s.quality === 'high' ? 'on' : ''} onClick={() => update({ quality: 'high' })}>
              CINEMATIC
              <small>HiDPI · reflections · ambient occlusion</small>
            </button>
            <button className={s.quality === 'low' ? 'on' : ''} onClick={() => update({ quality: 'low' })}>
              PERFORMANCE
              <small>Lighter effects · limited resolution</small>
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
  ['SPACE', 'Jump · again for a directional air boost'],
  ['SHIFT', 'Dash · hold to sprint'],
  ['E', 'Use terminal (HQ) · pick up loot'],
  ['I / TAB', 'Drone cargo / inventory'],
  ['2 / B', 'Build tower (C/V/N/M cycle parts)'],
  ['T', 'Tower engineering (preparation)'],
  ['AIM + R/C/V/N', 'Refit tower: level / weapon / core / modifier'],
  ['U', 'Run build overview'],
  ['Q', 'Tactical slow-time'],
  ['HOLD X', 'Recycle turret'],
  ['G', 'Start wave early'],
  ['H', 'Return to HQ (checkpoint)'],
  ['ESC', 'Pause / close terminal'],
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

function MainMenu({ flow }: { flow: Flow }) {
  const [tab, setTab] = useState<'briefing' | 'settings' | 'controls'>('briefing');
  const save = useSave(flow);
  const tier = getTier(save.threat.selected);
  return (
    <div className="screen menu">
      <div className="menu-col">
        <Logo />
        <div className="tagline">Defend the reactor. Secure the salvage. Come home.</div>
        <button className="primary deploy" onClick={() => void flow.enterHq()}>
          <span>ENTER HEADQUARTERS</span>
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
                A rift has torn open above the city. From headquarters you deploy your drone to hold the <b className="c">reactor</b> against endless machine waves.
              </p>
              <ul>
                <li>
                  <i className="c" />
                  <span>
                    Walk the HQ and use the <b className="c">deployment terminal</b> <kbd>E</kbd> to pick a threat tier.
                  </span>
                </li>
                <li>
                  <i className="o" />
                  <span>
                    Machines drop <b className="o">equipment</b> and salvage. Pick loot up with <kbd>E</kbd>; it is only <b>secured</b> at checkpoints every 5 waves.
                  </span>
                </li>
                <li>
                  <i className="v" />
                  <span>
                    At a checkpoint, <b>continue</b> or <b className="v">return home</b>. Lose the reactor and unsecured salvage is gone.
                  </span>
                </li>
              </ul>
            </div>
          )}
          {tab === 'settings' && <SettingsPanel flow={flow} />}
          {tab === 'controls' && <Controls />}
        </div>
      </div>
      <div className="menu-status">
        <div className="chip amber">
          <i />
          SALVAGE · {save.resources.salvage}
        </div>
        <div className="chip cyan">
          <i />
          CREDITS · {save.resources.credits}
        </div>
        <div className="chip cyan">
          <i />
          OPERATIONS · {save.totals.runs}
        </div>
        <div className="chip red">
          <i />
          THREAT TIER {tier.roman} · {tier.name}
        </div>
      </div>
      <div className="menu-foot">BUILD 0.4 · M2 · BABYLON.JS · HAVOK</div>
    </div>
  );
}

function PauseMenu({ flow }: { flow: Flow }) {
  const [tab, setTab] = useState<'settings' | 'controls'>('settings');
  const [confirm, setConfirm] = useState(false);
  const [resuming, setResuming] = useState(false);
  const inArena = flow.location === 'arena';
  const resume = useCallback(() => {
    if (resuming) return;
    setResuming(true);
    if (inArena) void flow.arena?.resume();
    else void flow.home?.takeControl();
    // Re-enable if pointer lock was denied outright so the menu isn't stuck.
    window.setTimeout(() => setResuming(false), 4000);
  }, [flow, inArena, resuming]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.code !== 'Escape') return;
      e.preventDefault();
      if (confirm) setConfirm(false);
      else resume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, resume]);
  return (
    <div className="screen dim">
      <div className="modal panel-frame">
        <div className="modal-title">
          <span className="tick" />
          PAUSED
        </div>
        <div className="pause-loc">{inArena ? `SECTOR 07 · THREAT TIER ${getTier(flow.run?.tier ?? 1).roman}` : 'HEADQUARTERS'}</div>
        <button className="primary" disabled={resuming} onClick={resume}>
          {resuming ? 'RESUMING…' : 'RESUME'}
        </button>
        {inArena &&
          (confirm ? (
            <div className="confirm">
              <div className="confirm-text">Abandon the run? Unsecured salvage and items are lost. Secured loot and the gear you deployed with are kept.</div>
              <div className="row2">
                <button className="danger" onClick={() => void flow.abandonRun()}>
                  ABANDON
                </button>
                <button onClick={() => setConfirm(false)}>CANCEL</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirm(true)}>ABANDON RUN</button>
          ))}
        <div className="tabs">
          {(['settings', 'controls'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        {tab === 'settings' ? <SettingsPanel flow={flow} compact={inArena} /> : <Controls />}
      </div>
    </div>
  );
}

function CheckpointPanel({ flow, game }: { flow: Flow; game: Game }) {
  const run = useHud((s) => s.run);
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
  if (!run) return null;
  const tier = getTier(run.tier);
  const wave = run.lastBankedWave;
  return (
    <div className="screen dim checkpoint">
      <div className="modal wide panel-frame">
        <div className="cp-kicker">CHECKPOINT · THREAT TIER {tier.roman}</div>
        <div className="cp-title">WAVE {wave} SECURED</div>
        <div className="cp-sub">{game.lastBankSaved ? 'All collected salvage and equipment has been banked to headquarters.' : 'Warning: the save could not be written. Rewards are held in memory and will be written with the next successful save.'}</div>
        <div className="stat-cards cyan">
          {(
            [
              ['WAVES CLEARED', String(wave)],
              ['SALVAGE SECURED', String(run.salvageSecured)],
              ['CREDITS · COMPONENTS', `${run.creditsSecured} · ${run.componentsSecured}`],
              ['HQ RESERVE', String(save.resources.salvage)],
              ['HOSTILES', String(run.kills)],
              ['TIME', fmtTime(run.duration)],
            ] as const
          ).map(([k, v], i) => (
            <div key={k} className="card" style={{ animationDelay: `${0.06 * i}s` }}>
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
        {game.lastCache.length > 0 && (
          <>
            <div className="cp-label">CHECKPOINT CACHE · SECURED</div>
            <BriefList items={game.lastCache} tone="secured" />
          </>
        )}
        {game.cfg.run.secured.items.length > game.lastCache.length && (
          <>
            <div className="cp-label">EQUIPMENT SECURED THIS RUN · {game.cfg.run.secured.items.length}</div>
            <BriefList items={game.cfg.run.secured.items.filter((i) => !game.lastCache.includes(i)).slice(-8)} tone="secured" />
          </>
        )}
        <div className="cp-progress">
          <span>NEXT CHECKPOINT</span>
          <div className="cp-track">
            {Array.from({ length: 5 }, (_, i) => (
              <i key={i} className={i === 0 ? 'now' : ''} />
            ))}
          </div>
          <b>WAVE {nextCheckpoint(wave + 1)}</b>
        </div>
        <div className="row2">
          <button className="primary" disabled={busy} onClick={() => void game.continueRun()}>
            CONTINUE SURVIVAL
          </button>
          <button
            className="home-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void flow.returnHome().finally(() => setBusy(false));
            }}
          >
            RETURN TO HQ
          </button>
        </div>
        <div className="sub">
          Returning ends the run. You can still return during this preparation phase with <kbd>H</kbd>.
        </div>
      </div>
    </div>
  );
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e15) return n.toExponential(2);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export function RunSummary({ result, extra }: { result: RunResult; extra?: { turretsBuilt: number; coresEarned: number } | null }) {
  const tier = getTier(result.tier);
  const cards: [string, string, string?][] = [
    ['FINAL WAVE', String(result.finalWave)],
    ['WAVES CLEARED', String(result.wavesCleared)],
    [`TIER · ${tier.name}`, tier.roman],
    ['HOSTILES DESTROYED', String(result.kills)],
    ['RUN DURATION', fmtTime(result.duration)],
    ['SALVAGE SECURED', String(result.salvageSecured), 'good'],
    ['CREDITS · COMPONENTS SECURED', `${result.creditsSecured ?? 0} · ${result.componentsSecured ?? 0}`, (result.creditsSecured ?? 0) > 0 ? 'good' : ''],
    ['UNSECURED LOST', `${result.salvageLost} salv · ${result.creditsLost ?? 0} cr · ${result.componentsLost ?? 0} comp`, result.salvageLost + (result.creditsLost ?? 0) + (result.componentsLost ?? 0) > 0 ? 'bad' : ''],
  ];
  cards.push(['ITEMS SECURED / LOST', `${result.itemsSecured} / ${result.itemsLost}`, result.itemsLost > 0 ? 'bad' : result.itemsSecured > 0 ? 'good' : '']);
  if (extra) cards.push(['TURRETS DEPLOYED', String(extra.turretsBuilt)]);
  const sv = result.survival;
  if (sv) {
    cards.push(['BOSSES DESTROYED', String(sv.bossesKilled), sv.bossesKilled ? 'good' : '']);
    cards.push(['ELITES DESTROYED', String(sv.elitesKilled)]);
    cards.push(['DRONE LOSSES', String(sv.deaths), sv.deaths ? 'bad' : '']);
    cards.push(['REACTOR DAMAGE TAKEN', fmtNum(sv.reactorDamage), sv.reactorDamage > 0 ? 'bad' : 'good']);
    cards.push(['DRONE DAMAGE DEALT', fmtNum(sv.playerDamage)]);
    cards.push(['TOWER DAMAGE DEALT', fmtNum(sv.towerDamage)]);
    cards.push(['EQUIPMENT COLLECTED', String(result.itemsCollected ?? 0)]);
  }
  return (
    <div className="summary">
      {sv?.dev && <div className="record-badge dev">DEVELOPMENT SESSION · NOT RECORD ELIGIBLE · NOTHING BANKED</div>}
      {!sv?.dev && (result.records?.length ?? 0) > 0 && <div className="record-badge">NEW PERSONAL RECORD{result.records!.length > 1 ? 'S' : ''} · TIER {tier.roman} · {result.records!.join(' · ').toUpperCase()}</div>}
      {!sv?.dev && !result.records && result.newRecord && <div className="record-badge">NEW PERSONAL RECORD · TIER {tier.roman}</div>}
      <div className="summary-grid">
        {cards.map(([k, v, tone], i) => (
          <div key={k} className={`card ${tone ?? ''}`} style={{ animationDelay: `${0.05 * i}s` }}>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {sv && (sv.bosses.length > 0 || sv.events.length > 0 || sv.milestones.length > 0) && (
        <div className="run-notes" data-testid="run-notes">
          {sv.bosses.length > 0 && (
            <div>
              <span>BOSSES</span>
              {sv.bosses.join(' · ')}
            </div>
          )}
          {sv.events.length > 0 && (
            <div>
              <span>EVENTS</span>
              {sv.events.map((id) => EVENTS[id as EventId]?.name ?? id).join(' · ')}
              {sv.hvtKilled + sv.hvtEscaped > 0 ? ` · couriers ${sv.hvtKilled} intercepted / ${sv.hvtEscaped} escaped` : ''}
            </div>
          )}
          {sv.milestones.length > 0 && (
            <div>
              <span>MILESTONES</span>
              {sv.milestones.map(milestoneLabel).join(' · ')}
            </div>
          )}
        </div>
      )}
      {!!result.securedItems?.length && (
        <>
          <div className="cp-label">SECURED EQUIPMENT</div>
          <BriefList items={result.securedItems} tone="secured" />
        </>
      )}
      {!!result.lostItems?.length && (
        <>
          <div className="cp-label lost">LOST · NOT SECURED</div>
          <BriefList items={result.lostItems} tone="lost" />
        </>
      )}
    </div>
  );
}

function DefeatScreen({ flow }: { flow: Flow }) {
  const result = useHud((s) => s.lastRun);
  const stats = useHud((s) => s.stats);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1800);
    return () => clearTimeout(t);
  }, []);
  if (!ready || !result) return null;
  return (
    <div className="screen dim defeat">
      <div className="modal wide panel-frame red">
        <div className="defeat-title" data-text="REACTOR LOST">
          REACTOR LOST
        </div>
        <div className="defeat-sub">
          Containment failed. {result.salvageLost > 0 || result.itemsLost > 0 ? `${result.salvageLost} unsecured salvage and ${result.itemsLost} unsecured item${result.itemsLost === 1 ? '' : 's'} were lost.` : 'Nothing unsecured was lost.'} Secured loot and the gear you deployed with are safe.
        </div>
        <RunSummary result={result} extra={stats} />
        <div className="row2">
          <button className="primary" onClick={() => void flow.leaveArena()}>
            RETURN TO HQ
          </button>
          <button onClick={() => void flow.redeploy()}>REDEPLOY · TIER {getTier(result.tier).roman}</button>
        </div>
      </div>
    </div>
  );
}

function SummaryScreen({ flow }: { flow: Flow }) {
  const result = useHud((s) => s.lastRun);
  const save = useSave(flow);
  if (!result) return null;
  const extracted = result.outcome === 'returned';
  return (
    <div className="screen dim summary-screen">
      <div className="modal wide panel-frame">
        <div className="cp-kicker">{extracted ? 'OPERATION COMPLETE' : 'OPERATION ABANDONED'}</div>
        <div className="cp-title">{extracted ? 'DRONE RECOVERED' : 'RUN FORFEITED'}</div>
        <div className="cp-sub">
          {extracted ? 'Checkpoint extraction successful.' : 'The run was abandoned; unsecured salvage did not make it back.'} HQ reserve: <b className="o">{save.resources.salvage} salvage</b> · <b className="c">{save.resources.credits} credits</b> · <b className="v">{save.resources.components} components</b>. Merchants have restocked.
        </div>
        <RunSummary result={result} />
        <button className="primary" onClick={() => void flow.home?.takeControl()}>
          CONTINUE
        </button>
      </div>
    </div>
  );
}
