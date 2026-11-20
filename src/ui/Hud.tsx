import { TutorialCard } from './TutorialCard';
import { TeamHud, TeamTags } from './TeamHud';
import { RunBadges } from './Roguelite';
import type { Game } from '../core/Game';
import { LootFeed, LootLabels, LootPrompt } from './LootHud';
import { SurvivalHud } from './SurvivalHud';
import { Banner, CenterPanel, Cores, Hint, Overlays, Perf, PlayerPanel, Respawn, RunPanel, TopCenter, WeaponPanel } from './hud/Panels';
import { Crosshair, DamageDirection, DamageNumbers, HealthBars, Hitmarker, KillChain, KillPulse } from './hud/Feedback';
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
      <TopCenter />
      <SurvivalHud />
      <aside className="hud-rail hud-starboard">
        <Cores />
        <RunPanel />
        <LootFeed />
      </aside>
      <PlayerPanel />
      <CenterPanel />
      <WeaponPanel />
      <Banner />
      <Hint />
      <Respawn />
      <Perf />
    </div>
  );
}

// ---------------------------------------------------------------- primitives
