import { keyLabel, movementLabel } from '@riftwarden/game/core/settings';
import { useHud } from '../useHud';
import { useEffect, useState } from 'react';

/** Segmented bar with a delayed "damage trail" that drains after the real value. */
export function SegBar({ value, tone, segments = 20, marker, className = '' }: { value: number; tone: string; segments?: number; marker?: number; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const [trail, setTrail] = useState(v);
  useEffect(() => {
    if (v >= trail) {
      setTrail(v);
      return;
    }
    const t = setTimeout(() => setTrail(v), 450);
    return () => clearTimeout(t);
  }, [v, trail]);
  return (
    <div className={`segbar ${tone} ${className}`} style={{ ['--segs' as string]: segments }}>
      <div className="trail" style={{ transform: `scaleX(${trail})` }} />
      <div className="fill" style={{ transform: `scaleX(${v})` }} />
      <div className="grid" />
      {marker !== undefined && <div className="marker" style={{ left: `${marker * 100}%` }} />}
    </div>
  );
}

export function Key({ k }: { k: string }) {
  return <kbd>{k}</kbd>;
}

export function BoundKey({ action }: { action: string }) {
  const keys = useHud(s => s.bindings);
  return <kbd>{action === 'move' ? movementLabel(keys) : keyLabel(keys[action])}</kbd>;
}

// ---------------------------------------------------------------- overlays

export interface Num {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  t: number;
  dx: number;
}

export function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
