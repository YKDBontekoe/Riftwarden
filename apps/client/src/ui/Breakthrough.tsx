// Breakthrough (final design): shown over the checkpoint that cleared a fifth Rift Level. The rewards were already
// banked by the rules (cache item, shards, title); this screen says what they are and what the new level means.
import { useState } from 'react';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { BREAKTHROUGH_EVERY, breakthroughRarity, breakthroughShards, breakthroughTitle } from '@riftwarden/rules/progression/spikes';
import { levelLoot } from '@riftwarden/rules/progression/riftLevel';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { Backdrop, Crumb, ElementGem, pips } from './ds';

const KEY = 'riftwarden.breakthroughSeen';
const seenList = (): number[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[];
  } catch {
    return [];
  }
};

/** The newest breakthrough this profile has not been shown yet (per device; at most one at a time). */
export function useBreakthrough(save: SaveData, rl: number): [number | null, () => void] {
  const [seen, setSeen] = useState<number[]>(seenList);
  const level = (save.breakthroughs ?? []).filter((l) => l <= rl).sort((a, b) => b - a)[0];
  const show = level && !seen.includes(level) && save.threat.unlocked > level ? level : null;
  return [show, () => {
    if (!show) return;
    const next = [...seen, show];
    setSeen(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(-40)));
    } catch {
      /* private mode: shown again next time */
    }
  }];
}

export function BreakthroughScreen({ level, sector, onContinue }: { level: number; sector: string; onContinue: () => void }) {
  const next = level + 1;
  const loot = levelLoot(next);
  const r = rarity(breakthroughRarity(level));
  return (
    <div className="screen ds-scr breakthrough" data-testid="breakthrough" role="dialog" aria-modal="true" aria-labelledby="bt-title">
      <Backdrop scrim="none" />
      <div className="bt-glow" aria-hidden="true" />
      <div className="ds-top">
        <Crumb parts={['Run', sector, 'Breakthrough']} />
        <span className="ds-grow" />
        <span className="ds-mono">SAVED TO YOUR PROFILE</span>
      </div>
      <div className="ds-abs ds-col" style={{ left: 0, right: 0, top: 96, alignItems: 'center', gap: 8, textAlign: 'center' }}>
        <span className="ds-ov ds-em">Breakthrough · every {BREAKTHROUGH_EVERY}th Rift Level · {breakthroughTitle(level)}</span>
        <span id="bt-title" style={{ font: '800 104px/0.85 var(--ds-d)' }}>RIFT LEVEL {next}</span>
        <span className="ds-meta">Unlocked for every future deploy · hostiles +5% hull, +3% damage per level</span>
      </div>
      <div className="bt-rewards ds-abs">
        <div className="bt-reward ds-col">
          <span className="ds-gem" style={{ '--c': r.color } as React.CSSProperties}><span style={{ transform: 'rotate(-45deg)', font: '700 14px var(--ds-d)', color: r.color }}>◆</span></span>
          <b className="ds-h3">Breakthrough cache</b>
          <span className="ds-meta"><span className="ds-pips" style={{ color: r.color }}>{pips(r.id)}</span> One {r.label.toLowerCase()} item, now in storage</span>
        </div>
        <div className="bt-reward ds-col">
          <ElementGem el="void" size={40} />
          <b className="ds-h3">+{breakthroughShards(level)} rift shards</b>
          <span className="ds-meta">Toward ascending an exotic at the workshop</span>
        </div>
        <div className="bt-reward ds-col">
          <ElementGem el="electric" size={40} />
          <b className="ds-h3">Loot level {loot.levels[0]}–{loot.levels[1]}</b>
          <span className="ds-meta">Item level rises with the new Rift Level{loot.next ? ` · ${rarity(loot.next.rarity).label} drops from RL ${loot.next.at}` : ''}</span>
        </div>
      </div>
      <div className="ds-bot">
        <span className="ds-meta">Next breakthrough at Rift Level {level + BREAKTHROUGH_EVERY}</span>
        <span className="ds-grow" />
        <button className="ds-btn-p" autoFocus data-testid="breakthrough-ok" onClick={onContinue}><span className="ds-kd">ENTER</span>CONTINUE</button>
      </div>
      <div className="ds-grain" />
    </div>
  );
}
