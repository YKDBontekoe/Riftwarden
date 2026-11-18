import { TutorialCard } from './TutorialCard';
import { TeamHud } from './TeamHud';
import { RunBadges } from './Roguelite';
import type { Game } from '../core/Game';
import { LootFeed, LootLabels, LootPrompt } from './LootHud';
import { SurvivalHud } from './SurvivalHud';
import { Banner, CenterPanel, Cores, Hint, Overlays, Perf, PlayerPanel, Respawn, RunPanel, TopCenter, WeaponPanel } from './hud/Panels';
import { Crosshair, DamageDirection, DamageNumbers, HealthBars, Hitmarker } from './hud/Feedback';
import { Radar } from './hud/Radar';
export { Banner, Perf } from './hud/Panels';

export function Hud({ game }: { game: Game }) {
  return (
    <div className="hud">
      <Overlays />
      <HealthBars game={game} />
      <DamageNumbers game={game} />
      <LootLabels game={game} />
      <DamageDirection />
      <Crosshair />
      <Hitmarker />
      <LootPrompt />
      <LootFeed />
      <Radar game={game} />
      <TopCenter />
      <SurvivalHud />
      <Cores />
      <RunPanel />
      <PlayerPanel />
      <CenterPanel />
      <WeaponPanel />
      <Banner />
      <Hint />
      <Respawn />
      <RunBadges />
      <Perf />
      <TeamHud />
      <TutorialCard />
    </div>
  );
}

// ---------------------------------------------------------------- primitives
