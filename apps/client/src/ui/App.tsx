// Screen router: which overlay shows for the current screen and location. Every screen lives in its own module.
import { MainMenu, PauseMenu, WardenMark } from './FrontEnd';
import { CheckpointPanel, DefeatScreen, SummaryScreen } from './RunScreens';
import { LoadingScreen } from './LoadingScreen';
import { ConstructionPanel } from './Construction';
import type { Flow } from '../core/Flow';
import { HomeHud } from './HomeHud';
import { UnlockCard } from './UnlockCard';
import { Hud } from './Hud';
import { useHud } from './useHud';
import { TerminalHost } from './TerminalHost';
import { ArenaInventory } from './LootHud';
import { UpgradePanel } from './Roguelite';
import { BuildOverview } from './RunBuild';
import { TowerPanel } from './TowerPanel';
import { DevPanel } from './DevPanel';
import { RunMapScreen, StationScreen } from './RunMap';
import { TouchControls } from '../touch/TouchControls';
import { RotateHint, UpdateToast } from '../touch/MobileUi';
import { DesktopUpdate } from '../desktop/DesktopUpdate';

interface Props {
  getFlow: () => Flow | null;
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
      <DesktopUpdate flow={flow} />
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
