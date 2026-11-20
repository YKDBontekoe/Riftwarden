import { LoadingScreen } from './LoadingScreen';
import { BoundKey } from './hud/widgets';
import { CoopPanel, urlJoinCode } from './Coop';
import { SettingsPanel } from './SettingsPanel';
import { ConstructionPanel } from './Construction';
import { ClientGame } from '../net/ClientGame';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '../core/Game';
import type { RunResult } from '../progression/run';
import type { SaveData } from '../progression/save';
import { getTier, nextCheckpoint } from '../progression/tiers';
import { HomeHud } from './HomeHud';
import { Hud } from './Hud';
import { useHud } from './store';
import { TerminalHost } from './TerminalHost';
import { ArenaInventory } from './LootHud';
import { BriefList } from './items';
import { XpGain } from './Directory';
import { XP } from '../progression/level';
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
      {screen === 'construct' && flow && home && <ConstructionPanel key={`cons${flow.transitions}`} flow={flow} />}
      {screen === 'transit' && <LoadingScreen />}
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

function Insignia() {
  return (
    <svg className="insignia" viewBox="0 0 48 40" aria-hidden="true">
      <path fill="currentColor" d="M0 36 15 4h9L9 36zm15 0L30 4h16l-4 8H35L24 36zm16 0 5-11 10 11z" />
    </svg>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return <div className={`logo ${small ? 'small' : ''}`}><Insignia /><span className="logo-word">Riftwarden</span></div>;
}

const CONTROLS = [
  [<BoundKey action="move" />, 'Move'],
  [<kbd>MOUSE</kbd>, 'Aim · LMB fire'],
  [<BoundKey action="jump" />, 'Jump · press again for a directional boost'],
  [<BoundKey action="dash" />, 'Dash · hold to sprint'],
  [<BoundKey action="use" />, 'Use terminal or pick up loot'],
  [<><BoundKey action="inventory" /><kbd>TAB</kbd></>, 'Drone cargo'],
  [<><BoundKey action="build" /><kbd>2</kbd></>, 'Build tower · C/V/N/M cycle parts'],
  [<kbd>T</kbd>, 'Tower engineering during preparation'],
  [<kbd>R/C/V/N</kbd>, 'Aim at a tower to level or refit it'],
  [<kbd>U</kbd>, 'Run build overview'],
  [<BoundKey action="tactical" />, 'Tactical slow-time'],
  [<BoundKey action="recycle" />, 'Hold to recycle a turret'],
  [<BoundKey action="wave" />, 'Start wave early'],
  [<BoundKey action="checkpoint" />, 'Return to HQ at a checkpoint'],
  [<kbd>ESC</kbd>, 'Pause or close terminal'],
  [<kbd>F3</kbd>, 'Performance stats'],
] as const;

function Controls() {
  return (
    <div className="controls">
      {CONTROLS.map(([k, v]) => (
        <div key={v}>
          <span className="control-keys">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

const MENU_SECTIONS = {
  briefing: 'Briefing',
  'co-op': 'Co-op',
  settings: 'Settings',
  controls: 'Controls',
} as const;

function MainMenu({ flow }: { flow: Flow }) {
  const [tab, setTab] = useState<keyof typeof MENU_SECTIONS | null>(urlJoinCode() ? 'co-op' : null);
  const save = useSave(flow);
  const tier = getTier(save.threat.selected);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setTab(null); };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, []);
  return (
    <main className="screen menu">
      <header className="menu-header">
        <button className="menu-identity" aria-label="Riftwarden main menu" onClick={() => setTab(null)}>
          <Insignia /><span>Sector 07</span>
        </button>
        <nav className="menu-nav" aria-label="Main menu">
          {(Object.keys(MENU_SECTIONS) as (keyof typeof MENU_SECTIONS)[]).map((section) => (
            <button key={section} aria-pressed={tab === section} onClick={() => setTab(tab === section ? null : section)}>
              {MENU_SECTIONS[section].toUpperCase()}
            </button>
          ))}
        </nav>
      </header>
      {tab === null ? (
        <section className="menu-hero">
          <h1>Riftwarden</h1>
          <p>Pilot a defense drone. Hold the reactor against waves of machines. Bring the salvage home.</p>
          <button className="primary deploy" onClick={() => void flow.enterHq()}>
            <span>ENTER HEADQUARTERS</span><span aria-hidden="true">↗</span>
          </button>
        </section>
      ) : (
        <section className="menu-sheet" aria-label={MENU_SECTIONS[tab]}>
          <div className="menu-sheet-head"><h2>{MENU_SECTIONS[tab]}</h2><button aria-label="Back to main menu" onClick={() => setTab(null)}>×</button></div>
          {tab === 'briefing' && <ol className="mission-steps">
            <li><b>Deploy from headquarters</b><p>Use the deployment terminal with <BoundKey action="use" /> to select a threat tier.</p></li>
            <li><b>Hold the reactor</b><p>Build turrets between waves. Collect equipment and salvage from fallen machines with <BoundKey action="use" />.</p></li>
            <li><b>Bank your salvage</b><p>Every five waves, a checkpoint secures your haul. Return home or stay for another wave. Losing the reactor costs your unsecured cargo.</p></li>
          </ol>}
          {tab === 'co-op' && <CoopPanel flow={flow} compact />}
          {tab === 'settings' && <SettingsPanel flow={flow} />}
          {tab === 'controls' && <Controls />}
        </section>
      )}
      <footer className="menu-ledger">
        <div><span>Threat tier</span><strong>{tier.roman} <i>/</i> {tier.name}</strong></div>
        <div><span>Operations</span><strong>{save.totals.runs.toLocaleString()}</strong></div>
        <div><span>Salvage</span><strong>{save.resources.salvage.toLocaleString()}</strong></div>
        <div><span>Credits</span><strong>{save.resources.credits.toLocaleString()}</strong></div>
      </footer>
    </main>
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

function CoopVote({ game }: { game: ClientGame }) {
  const c = useHud((s) => s.coop);
  if (!c) return null;
  return (
    <div className="coop-vote" data-testid="coop-vote">
      <div className="cp-label">TEAM VOTE · {c.voteOpen ? `${c.voteLeft} s left` : 'closed'}</div>
      {c.team.map((m) => (
        <div key={m.id} className="cv-row">
          <i className="swatch" style={{ background: m.color }} />
          <span>{m.self ? `${m.name} (you)` : m.name}</span>
          <b className={m.vote === 1 ? 'home' : m.vote === 0 ? 'stay' : ''}>{!m.connected ? 'OFFLINE' : m.vote === 1 ? 'RETURN' : m.vote === 0 ? 'CONTINUE' : '…'}</b>
        </div>
      ))}
      {game.myVote !== null && <div className="sub">Your vote: {game.myVote ? 'return to HQ' : 'continue'}</div>}
    </div>
  );
}

function CheckpointPanel({ flow, game }: { flow: Flow; game: Game }) {
  const coop = game instanceof ClientGame ? game : null;
  const run = useHud((s) => s.run);
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
  if (!run) return null;
  const tier = getTier(run.tier);
  const wave = run.lastBankedWave;
  return (
    <div className="screen dim checkpoint">
      <div className="modal wide panel-frame">
        <div className="cache-heading"><span aria-hidden="true" className="uc-art art-cache" /><div><div className="cp-kicker">Checkpoint · Tier {tier.roman}</div>
        <h2 className="cp-title">Wave {wave} secured</h2></div></div>
        <div className="cp-sub">{game.lastBankSaved ? 'All collected salvage and equipment has been banked to headquarters.' : 'Warning: the save could not be written. Rewards are held in memory and will be written with the next successful save.'}</div>
        <div className="stat-cards cyan">
          {(
            [
              ['EQUIPMENT BANKED', String(game.cfg.run.secured.items.length)],
              ['SALVAGE SECURED', String(run.salvageSecured)],
              ['CREDITS BANKED', String(run.creditsSecured)],
              ['COMPONENTS BANKED', String(run.componentsSecured)],
              ['WARDEN XP BANKED', String(run.xpSecured ?? 0)],
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
        {!!run.xpSecured && game.lastBankSaved && <XpGain gained={run.xpSecured} totalAfter={save.progress.xp} label="WARDEN XP BANKED THIS OPERATION" />}
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
          <span>HQ reserve <b>{save.resources.salvage.toLocaleString()} salvage</b></span>
          <span>Next checkpoint <b>Wave {nextCheckpoint(wave + 1)}</b></span>
        </div>
        {coop && <CoopVote game={coop} />}
        <div className="row2">
          <button className="primary" disabled={busy || (coop ? coop.myVote === false : false)} data-testid="cp-continue" onClick={() => (coop ? coop.vote(false) : void game.continueRun())}>
            {coop ? 'VOTE: CONTINUE' : 'CONTINUE SURVIVAL'}
          </button>
          <button
            className="home-btn"
            disabled={busy}
            data-testid="cp-home"
            onClick={() => {
              if (coop) return coop.vote(true);
              setBusy(true);
              void flow.returnHome().finally(() => setBusy(false));
            }}
          >
            {coop ? 'VOTE: RETURN TO HQ' : 'RETURN TO HQ'}
          </button>
        </div>
        {coop && (
          <button className="mini" onClick={() => void game.continueRun()}>
            BACK TO THE ARENA (VOTE LATER WITH H)
          </button>
        )}
        <div className="sub">
          {coop ? 'The team returns only if every connected warden votes to return. One vote to continue keeps the operation going.' : <>Returning ends the run. You can still return during this preparation phase with <BoundKey action="checkpoint" />.</>}
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
  const sv = result.survival;
  const resources = [
    ['Salvage', result.salvageSecured, result.salvageLost],
    ['Credits', result.creditsSecured ?? 0, result.creditsLost ?? 0],
    ['Components', result.componentsSecured ?? 0, result.componentsLost ?? 0],
    ['Warden XP', (result.xpSecured ?? 0) + (result.xpKept ?? 0), result.xpLost ?? 0],
    ['Equipment', result.itemsSecured, result.itemsLost],
  ] as const;
  const details: [string, string | number][] = [['Final wave', result.finalWave], ['Threat tier', `${tier.roman} · ${tier.name}`]];
  if (extra) details.push(['Turrets deployed', extra.turretsBuilt], ['Cores earned', extra.coresEarned]);
  if (sv) details.push(['Bosses destroyed', sv.bossesKilled], ['Elites destroyed', sv.elitesKilled], ['Drone losses', sv.deaths],
    ['Reactor damage taken', fmtNum(sv.reactorDamage)], ['Drone damage dealt', fmtNum(sv.playerDamage)],
    ['Tower damage dealt', fmtNum(sv.towerDamage)], ['Equipment collected', result.itemsCollected ?? 0]);
  return (
    <div className="summary">
      {sv?.dev && <div className="record-badge dev">DEVELOPMENT SESSION · NOT RECORD ELIGIBLE · NOTHING BANKED</div>}
      {!sv?.dev && (result.records?.length ?? 0) > 0 && <div className="record-badge"><strong>Tier {tier.roman} personal record{result.records!.length > 1 ? 's' : ''}</strong> {result.records!.join(' · ')}</div>}
      {!sv?.dev && !result.records && result.newRecord && <div className="record-badge">New personal record · Tier {tier.roman}</div>}
      <div className="result-headline">
        <div><b>{result.wavesCleared}</b><span>Waves cleared</span></div>
        <div><b>{result.kills.toLocaleString()}</b><span>Hostiles destroyed</span></div>
        <div><b>{fmtTime(result.duration)}</b><span>Time deployed</span></div>
      </div>
      <table className="result-ledger">
        <thead><tr><th scope="col">Cargo</th><th scope="col">Secured</th><th scope="col">Lost</th></tr></thead>
        <tbody>{resources.map(([label, secured, lost]) => <tr key={label}><th scope="row">{label}</th>
          <td className={secured > 0 ? 'gained' : ''}>{secured.toLocaleString()}</td>
          <td className={lost > 0 ? 'lost' : ''}>{lost.toLocaleString()}</td></tr>)}</tbody>
      </table>
      <details className="field-notes combat-report"><summary>Combat breakdown</summary>
        <dl className="tier-modifiers">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </details>
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
  const save = useSave(flow);
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
        <div className="defeat-title">
          Reactor lost
        </div>
        <div className="defeat-sub">
          Containment failed on wave {result.finalWave}. Your banked cargo and starting equipment are safe.
        </div>
        {!result.survival?.dev && <XpGain gained={(result.xpSecured ?? 0) + (result.xpKept ?? 0)} totalAfter={save.progress.xp} label={`WARDEN XP · ${Math.round(XP.keepOnLoss * 100)}% OF UNSECURED XP KEPT`} />}
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
        <div className="cp-title">{extracted ? 'Drone recovered' : 'Run forfeited'}</div>
        <div className="cp-sub">
          {extracted ? 'Checkpoint extraction successful.' : 'Unsecured cargo was lost when you left the arena.'} HQ reserve: <b className="o">{save.resources.salvage} salvage</b> · <b className="c">{save.resources.credits} credit{save.resources.credits === 1 ? '' : 's'}</b> · <b className="v">{save.resources.components} component{save.resources.components === 1 ? '' : 's'}</b>. Merchants have restocked.
        </div>
        {!result.survival?.dev && <XpGain gained={(result.xpSecured ?? 0) + (result.xpKept ?? 0)} totalAfter={save.progress.xp} />}
        <RunSummary result={result} />
        <button className="primary" onClick={() => void flow.home?.takeControl()}>
          CONTINUE
        </button>
      </div>
    </div>
  );
}
