import { MasteryGainToast } from './Mastery';
import { TutorialCard } from './TutorialCard';
import { TeamHud, TeamTags } from './TeamHud';
import { RunBadges } from './Roguelite';
import type { Game } from '@riftwarden/game/core/Game';
import { LootFeed, LootLabels, LootPrompt } from './LootHud';
import { SurvivalHud } from './SurvivalHud';
import { Banner, CenterPanel, CondRow, Hint, MoveRow, Overlays, Perf, Respawn } from './hud/Panels';
import { Compass, CriticalHull, Objective, PhaseCores, PrepClock, Vitals, WeaponBlock } from './hud/Combat';
import { Crosshair, DamageDirection, DamageNumbers, HealthBars, Hitmarker, KillChain, KillPulse } from './hud/Feedback';
import { Radar } from './hud/Radar';
import { NodeChip } from './RunMap';
import { useHud } from './useHud';
import { useSyncExternalStore } from 'react';
import { minimapStore } from './hud/minimap';
export { Banner, Perf } from './hud/Panels';

import { RangePanel } from './FiringRange';

export function Hud({ game }: { game: Game }) {
  const phase = useHud(s => s.phase);
  const build = useHud(s => s.buildMode);
  const radar = useSyncExternalStore(minimapStore.subscribe, minimapStore.get).on;
  return (
    <div className={`hud combat-hud ${radar ? 'show-radar' : ''}${game.range ? ' in-range' : ''}`} data-phase={phase} data-build={build}>
      <Overlays />
      <HealthBars game={game} />
      <DamageNumbers game={game} />
      <LootLabels game={game} />
      <DamageDirection game={game} />
      <TeamTags />
      <Crosshair />
      <Hitmarker />
      <KillPulse />
      <KillChain />
      <LootPrompt />
      <aside className="hud-rail hud-port">
        <Radar game={game} />
        <TeamHud />
        <RunBadges />
        <TutorialCard />
      </aside>
      <Objective game={game} />
      <Compass game={game} />
      <SurvivalHud />
      <NodeChip />
      <PhaseCores />
      <PrepClock />
      <RangePanel game={game} />
      <aside className="hud-rail hud-starboard">
        <LootFeed />
      </aside>
      <Vitals>
        <MoveRow />
        <CondRow />
      </Vitals>
      <CenterPanel />
      <WeaponBlock />
      <Banner />
      <MasteryGainToast />
      <Hint />
      <CriticalHull />
      <Respawn />
      <Perf />
    </div>
  );
}

// ---------------------------------------------------------------- primitives
