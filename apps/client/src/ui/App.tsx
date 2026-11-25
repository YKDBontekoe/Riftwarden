import { RunRecap } from './RunRecap';
import { MainMenu, PauseMenu, WardenMark } from './FrontEnd';
import { CheckpointPanel, DefeatScreen, SummaryScreen } from './RunScreens';
import { LoadingScreen } from './LoadingScreen';
import { ConstructionPanel } from './Construction';
import { useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { RunResult } from '@riftwarden/rules/progression/run';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { HomeHud } from './HomeHud';
import { UnlockCard } from './UnlockCard';
import { Hud } from './Hud';
import { useHud } from './useHud';
import { TerminalHost } from './TerminalHost';
import { ArenaInventory } from './LootHud';
import { BriefList } from './items';
import { BuildOverview, TowerPanel, UpgradePanel } from './Roguelite';
import { DevPanel } from './DevPanel';
import { RunMapScreen, StationScreen } from './RunMap';
import { milestoneLabel } from '@riftwarden/rules/survival/records';
import { EVENTS, type EventId } from '@riftwarden/rules/survival/events';
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

/** Boot screen (title design): the warden mark and the name over the sector render while systems start. */
function Loading() {
  return (
    <div className="screen loading menu ds-scr" data-testid="boot-screen">
      <div className="ds-vig" />
      <div className="ds-scrim-b" />
      <div className="ds-abs ds-col" style={{ left: 0, right: 0, top: '30%', alignItems: 'center', gap: 14 }}>
        <WardenMark size={84} />
        <span style={{ font: '800 104px/0.9 var(--ds-d)', letterSpacing: '0.18em', paddingLeft: '0.18em' }}>RIFTWARDEN</span>
        <span className="ds-ov ds-em" style={{ letterSpacing: '0.42em' }}>Hold the line · take the loot · bank it</span>
      </div>
      <div className="ds-bot">
        <span className="ds-row" style={{ gap: 12, width: 360 }}><span className="ds-mono">INITIALIZING HEADQUARTERS</span><span className="load-bar ds-grow"><i /></span></span>
        <span className="ds-grow" />
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

