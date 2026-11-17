import type { Flow } from '../core/Flow';
import { getTier } from '../progression/tiers';
import { useSave } from './App';
import { Banner, Perf } from './Hud';
import { useHud } from './store';

/** Calm HQ overlay: location, reserve, current threat tier, interaction prompt. */
export function HomeHud({ flow }: { flow: Flow }) {
  const screen = useHud((s) => s.screen);
  const area = useHud((s) => s.area);
  const prompt = useHud((s) => s.prompt);
  const save = useSave(flow);
  const tier = getTier(save.threat.selected);
  const walking = screen === 'home';
  return (
    <div className={`hud home-hud ${walking ? '' : 'muted'}`}>
      <div className="hq-loc panel-frame">
        <div className="hq-kicker">HEADQUARTERS</div>
        <div className="hq-area">{area || 'COMMAND DECK'}</div>
      </div>
      <div className="hq-res panel-frame">
        <div>
          <span>SALVAGE RESERVE</span>
          <b className="o">{save.resources.salvage}</b>
        </div>
        <div>
          <span>THREAT TIER</span>
          <b>
            {tier.roman} · {tier.name}
          </b>
        </div>
      </div>
      {walking && <div className="hq-dot" />}
      {walking && prompt && (
        <div className="hq-prompt" key={prompt.title}>
          <kbd>{prompt.key}</kbd>
          <div>
            <b>{prompt.title}</b>
            <span>{prompt.action}</span>
          </div>
        </div>
      )}
      {walking && (
        <div className="hq-keys">
          <kbd>WASD</kbd> move <kbd>E</kbd> use terminal <kbd>ESC</kbd> pause
        </div>
      )}
      <Banner />
      <Perf />
    </div>
  );
}
