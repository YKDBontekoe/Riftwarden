// Sound captions (Settings > Accessibility): important sounds appear as short captions with their direction, for
// players who cannot hear them (they show even when the game is muted). Pure caption choice and throttling below.
import { useEffect, useState } from 'react';
import { sfx, type SfxName } from '@riftwarden/game/audio/Sfx';

/** Which sounds get a caption, and its text. Frequent combat sounds (shots, hits) are left out on purpose. */
export const CAPTION_TEXT: Partial<Record<SfxName, string>> = {
  reactorHit: 'Reactor under attack',
  alarm: 'Alarm',
  bossRoar: 'Boss roar',
  waveStart: 'Wave incoming',
  waveClear: 'Wave cleared',
  overheat: 'Weapon overheated',
  abilityReady: 'Ability ready',
  shieldReady: 'Shield restored',
  playerHurt: 'Taking damage',
  explosion: 'Explosion',
  mortar: 'Mortar incoming',
  charge: 'Charging attack',
  slam: 'Ground slam',
  lootDrop: 'Rare loot dropped',
  bank: 'Haul banked',
  tacticalOn: 'Tactical time',
  tacticalOff: 'Tactical time ended',
};

/** Same caption again within this many ms only refreshes the shown line. */
export const CAPTION_GAP_MS = 1500;

export interface Caption {
  text: string;
  /** Direction from the stereo pan: left, right, or none for centred sounds. */
  dir: 'left' | 'right' | null;
  at: number;
}

/** Caption for a sound (pure), or null when it has none. */
export function captionFor(name: SfxName, pan: number, at: number): Caption | null {
  const text = CAPTION_TEXT[name];
  if (!text) return null;
  return { text, dir: pan < -0.35 ? 'left' : pan > 0.35 ? 'right' : null, at };
}

/** Add a caption to the shown list (pure): a repeat within the gap refreshes it; newest last; at most four lines. */
export function pushCaption(list: readonly Caption[], c: Caption): Caption[] {
  const same = list.findIndex((x) => x.text === c.text);
  if (same >= 0 && c.at - list[same].at < CAPTION_GAP_MS) return list.map((x, i) => (i === same ? { ...c } : x));
  return [...list.filter((x) => x.text !== c.text), c].slice(-4);
}

const SHOW_MS = 2800;

export function Captions() {
  const [list, setList] = useState<Caption[]>([]);
  useEffect(() => {
    sfx.onCaption = (name, pan) => {
      const c = captionFor(name, pan, performance.now());
      if (c) setList((l) => pushCaption(l, c));
    };
    const t = window.setInterval(() => {
      const now = performance.now();
      setList((l) => (l.some((x) => now - x.at > SHOW_MS) ? l.filter((x) => now - x.at <= SHOW_MS) : l));
    }, 250);
    return () => {
      sfx.onCaption = null;
      window.clearInterval(t);
    };
  }, []);
  if (!list.length) return null;
  return (
    <div className="sound-captions" role="log" aria-live="polite" data-testid="sound-captions">
      {list.map((c) => (
        <span key={c.text} className="sc-line">
          {c.dir === 'left' && <b aria-label="from the left">◀ </b>}
          [{c.text}]
          {c.dir === 'right' && <b aria-label="from the right"> ▶</b>}
        </span>
      ))}
    </div>
  );
}
