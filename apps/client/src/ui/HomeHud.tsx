import { BoundKey } from './hud/widgets';
import { TutorialCard } from './TutorialCard';
import { useEffect, useState } from 'react';
import type { Flow } from '../core/Flow';
import { RESOURCE_KEYS, type ResourceKey } from '@riftwarden/rules/economy/config';
import { RES_CLASS } from './economy';
import { currencyTooltip } from '@riftwarden/rules/economy/currencies';
import { levelInfo, pointsAt } from '@riftwarden/rules/progression/level';
import { uiEvents } from '@riftwarden/game/ui/store';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { CURRENCY_ICON, FieldIcon } from './FieldIcon';
import { useSave } from './App';
import { Banner, Perf } from './Hud';
import { useHud } from './useHud';

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
      <TutorialCard />
      <div className="hq-loc panel-frame">
        <div className="font-mono text-[10px] tracking-[0.11em] text-cyan">HEADQUARTERS</div>
        <div className="font-display text-[23px] font-[650] tracking-[-0.025em] mt-[2px]">{area || 'COMMAND DECK'}</div>
      </div>
      <div className="hq-res panel-frame">
        <div>
          <span>RESERVES</span>
          <div className="res-line" data-testid="hq-resources">
            {RESOURCE_KEYS.map((k) => (
              <span key={k} className={RES_CLASS[k]} title={currencyTooltip(k)}>
                <i><FieldIcon name={CURRENCY_ICON[k]} /></i>
                {save.resources[k].toLocaleString()}
              </span>
            ))}
          </div>
          <Deltas />
        </div>
        <WardenLevel xp={save.progress.xp} allocated={save.progress.tree.allocated.length} />
        <div>
          <span>THREAT TIER</span>
          <b>
            {tier.roman} · {tier.name}
          </b>
        </div>
      </div>
      {walking && <div className="fixed left-[50%] top-[50%] w-[4px] h-[4px] m-[-2px_0_0_-2px] [border-radius:50%] [background:rgba(255,255,255,0.85)] [box-shadow:0_0_6px_rgba(156,207,194,0.8)]" />}
      {walking && prompt && (
        <div className="hq-prompt" key={prompt.title}>
          <kbd>{prompt.key}</kbd>
          <div>
            <b>{prompt.title}</b>
            <span>{prompt.action}</span>
            {prompt.purpose && <em className="hq-purpose">{prompt.purpose}</em>}
          </div>
        </div>
      )}
      {walking && (
        <div className="fixed bottom-[20px] left-[22px] text-[14px] text-faint tracking-[0.04em]">
          <BoundKey action="move" /> move <BoundKey action="use" /> use terminal <kbd>ESC</kbd> pause
        </div>
      )}
      <Banner />
      <Perf />
    </div>
  );
}

/** Floating "+N" indicators for resources gained or spent at HQ stations. */
function Deltas() {
  const [list, setList] = useState<{ id: number; k: ResourceKey; v: number }[]>([]);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('econ', (e) => {
      const add = RESOURCE_KEYS.filter((k) => e.delta[k]).map((k) => ({ id: ++id, k, v: e.delta[k]! }));
      if (!add.length) return;
      setList((l) => [...l.slice(-4), ...add]);
      const ids = new Set(add.map((a) => a.id));
      setTimeout(() => setList((l) => l.filter((x) => !ids.has(x.id))), 1700);
    });
  }, []);
  return (
    <>
      {list.map((d, i) => (
        <b key={d.id} className={`res-delta ${RES_CLASS[d.k]}`} style={{ top: 46 + i * 18 }}>
          {d.v > 0 ? '+' : '−'}
          {Math.abs(d.v).toLocaleString()} <FieldIcon name={CURRENCY_ICON[d.k]} />
        </b>
      ))}
    </>
  );
}

/** Warden level, XP progress and unspent skill points (HQ overlay). */
export function WardenLevel({ xp, allocated }: { xp: number; allocated: number }) {
  const info = levelInfo(xp);
  const free = Math.max(0, pointsAt(info.level) - allocated);
  return (
    <div className="warden-level" data-testid="warden-level" title={currencyTooltip('xp')}>
      <span>WARDEN LEVEL</span>
      <b>
        {info.level}
        {free > 0 && <em className="pts">+{free} PT</em>}
      </b>
      <div className="xp-bar">
        <i style={{ width: `${Math.round(info.frac * 100)}%` }} />
      </div>
      <small>
        {info.into.toLocaleString()} / {info.need.toLocaleString()} XP
      </small>
    </div>
  );
}
