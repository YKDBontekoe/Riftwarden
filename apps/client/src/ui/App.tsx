import { RunRecap } from './RunRecap';
import { MainMenu, PauseMenu } from './FrontEnd';
import { savePower } from './RiftLevel';
import { LoadingScreen } from './LoadingScreen';
import { BoundKey } from './hud/widgets';
import { ConstructionPanel } from './Construction';
import { ClientGame } from '@riftwarden/game/net/ClientGame';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '@riftwarden/game/core/Game';
import type { RunResult } from '@riftwarden/rules/progression/run';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { getTier, nextCheckpoint } from '@riftwarden/rules/progression/tiers';
import { HomeHud } from './HomeHud';
import { UnlockCard } from './UnlockCard';
import { Hud } from './Hud';
import { useHud } from './useHud';
import { TerminalHost } from './TerminalHost';
import { ArenaInventory } from './LootHud';
import { BriefList } from './items';
import { GearUpgrades } from './GearUpgrades';
import { XpGain } from './Directory';
import { XP } from '@riftwarden/rules/progression/level';
import { BuildOverview, TowerPanel, UpgradePanel } from './Roguelite';
import { DevPanel } from './DevPanel';
import { RunMapScreen, StationScreen } from './RunMap';
import { milestoneLabel } from '@riftwarden/rules/survival/records';
import { EVENTS, type EventId } from '@riftwarden/rules/survival/events';
import { FieldArt } from './FieldArt';
import { FieldIcon } from './FieldIcon';
import { TouchControls } from '../touch/TouchControls';
import { RotateHint, UpdateToast } from '../touch/MobileUi';

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
const HOME_HUD_SCREENS = new Set(['home', 'terminal', 'paused', 'unlock']);

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
      {screen === 'runmap' && flow && arena && <RunMapScreen key={`map${flow.transitions}`} flow={flow} game={arena} />}
      {screen === 'station' && arena && <StationScreen key={`st${flow?.transitions}`} game={arena} />}
      {screen === 'upgrade' && arena && <UpgradePanel key={`up${arena.director.build.offers}`} game={arena} />}
      {screen === 'build' && arena && <BuildOverview game={arena} />}
      {screen === 'dev' && arena && flow && <DevPanel game={arena} flow={flow} />}
      {screen === 'towers' && arena && <TowerPanel game={arena} />}
      {screen === 'inventory' && arena && <ArenaInventory key={`inv${flow?.transitions}`} game={arena} />}
      {screen === 'defeat' && flow && <DefeatScreen flow={flow} />}
      {screen === 'summary' && flow && <SummaryScreen flow={flow} />}
      {screen === 'construct' && flow && home && <ConstructionPanel key={`cons${flow.transitions}`} flow={flow} />}
      {flow && ((screen === 'unlock' && location === 'home') || (screen === 'checkpoint' && location === 'arena')) && <UnlockCard flow={flow} />}
      {screen === 'transit' && <LoadingScreen />}
      {flow && <TouchControls flow={flow} />}
      <RotateHint />
      <UpdateToast flow={flow} />
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
        <div className="cache-heading"><span aria-hidden="true" className="uc-art art-cache" /><div><div className="cp-kicker">Checkpoint · RL {tier.id}</div>
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

export function RunSummary({ result, extra, powerAfter }: { result: RunResult; extra?: { turretsBuilt: number; coresEarned: number } | null; powerAfter?: number }) {
  const tier = getTier(result.tier);
  const sv = result.survival;
  const resources = [
    ['Salvage', result.salvageSecured, result.salvageLost],
    ['Credits', result.creditsSecured ?? 0, result.creditsLost ?? 0],
    ['Components', result.componentsSecured ?? 0, result.componentsLost ?? 0],
    ['Warden XP', (result.xpSecured ?? 0) + (result.xpKept ?? 0), result.xpLost ?? 0],
    ['Equipment', result.itemsSecured, result.itemsLost],
  ] as const;
  const details: [string, string | number][] = [['Final wave', result.finalWave], ['Rift Level', `RL ${tier.id} · ${tier.name}`]];
  if (extra) details.push(['Turrets deployed', extra.turretsBuilt], ['Cores earned', extra.coresEarned]);
  if (sv) details.push(['Bosses destroyed', sv.bossesKilled], ['Elites destroyed', sv.elitesKilled], ['Drone losses', sv.deaths],
    ['Reactor damage taken', fmtNum(sv.reactorDamage)], ['Drone damage dealt', fmtNum(sv.playerDamage)],
    ['Tower damage dealt', fmtNum(sv.towerDamage)], ['Equipment collected', result.itemsCollected ?? 0]);
  return (
    <div className="summary">
      {sv?.dev && <div className="record-badge dev">DEVELOPMENT SESSION · NOT RECORD ELIGIBLE · NOTHING BANKED</div>}
      {!sv?.dev && (result.records?.length ?? 0) > 0 && <div className="record-badge"><strong>RL {tier.id} personal record{result.records!.length > 1 ? 's' : ''}</strong> {result.records!.join(' · ')}</div>}
      {!sv?.dev && !result.records && result.newRecord && <div className="record-badge">New personal record · RL {tier.id}</div>}
      <RunRecap result={result} powerAfter={powerAfter} />
      <div className="result-headline">
        <div><b>{result.wavesCleared}</b><span><FieldIcon name="wave" /> Waves cleared</span></div>
        <div><b>{result.kills.toLocaleString()}</b><span><FieldIcon name="enemy" /> Hostiles destroyed</span></div>
        <div><b>{fmtTime(result.duration)}</b><span><FieldIcon name="clock" /> Time deployed</span></div>
      </div>
      <table className="result-ledger">
        <thead><tr><th scope="col">Cargo</th><th scope="col">Secured</th><th scope="col">Lost</th></tr></thead>
        <tbody>{resources.map(([label, secured, lost]) => <tr key={label}><th scope="row">{label}</th>
          <td className={secured > 0 ? 'gained' : ''}>{secured.toLocaleString()}</td>
          <td className={lost > 0 ? 'lost' : ''}>{lost.toLocaleString()}</td></tr>)}</tbody>
      </table>
      <details className="field-notes mb-[9px]"><summary>Combat breakdown</summary>
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
        <div className="operation-heading-art">
          <FieldArt name="operation-defeat" className="operation-art" />
          <div className="defeat-title">Reactor lost</div>
          <div className="defeat-sub">
            Containment failed on wave {result.finalWave}. Your banked cargo and starting equipment are safe.
          </div>
        </div>
        {!result.survival?.dev && <XpGain gained={(result.xpSecured ?? 0) + (result.xpKept ?? 0)} totalAfter={save.progress.xp} label={`WARDEN XP · ${Math.round(XP.keepOnLoss * 100)}% OF UNSECURED XP KEPT`} />}
        <RunSummary result={result} extra={stats} />
        <div className="row2">
          <button className="primary" onClick={() => void flow.leaveArena()}>
            RETURN TO HQ
          </button>
          <button onClick={() => void flow.redeploy()}>REDEPLOY · RL {getTier(result.tier).id}</button>
        </div>
      </div>
    </div>
  );
}

function SummaryScreen({ flow }: { flow: Flow }) {
  const result = useHud((s) => s.lastRun);
  const save = useSave(flow);
  const secured = useMemo(() => (result?.securedItems ?? []).map((i) => i.uid), [result]);
  if (!result) return null;
  const extracted = result.outcome === 'returned';
  return (
    <div className="screen dim summary-screen">
      <div className="modal wide panel-frame">
        <div className="operation-heading-art">
          <FieldArt name={extracted ? 'operation-recovery' : 'operation-defeat'} className="operation-art" />
          <div className="cp-kicker">{extracted ? 'OPERATION COMPLETE' : 'OPERATION ABANDONED'}</div>
          <div className="cp-title">{extracted ? 'Drone recovered' : 'Run forfeited'}</div>
          <div className="cp-sub">
            {extracted ? 'Checkpoint extraction successful.' : 'Unsecured cargo was lost when you left the arena.'} HQ reserve: <b className="o">{save.resources.salvage} salvage</b> · <b className="c">{save.resources.credits} credit{save.resources.credits === 1 ? '' : 's'}</b> · <b className="v">{save.resources.components} component{save.resources.components === 1 ? '' : 's'}</b>. Merchants have restocked.
          </div>
        </div>
        {!result.survival?.dev && <XpGain gained={(result.xpSecured ?? 0) + (result.xpKept ?? 0)} totalAfter={save.progress.xp} />}
        {!!result.securedItems?.length && <GearUpgrades flow={flow} save={save} uids={secured} />}
        <RunSummary result={result} powerAfter={savePower(save)} />
        <button className="primary" onClick={() => void flow.home?.takeControl()}>
          CONTINUE
        </button>
      </div>
    </div>
  );
}
