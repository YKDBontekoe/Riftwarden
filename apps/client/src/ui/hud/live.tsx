// Fine-grained HUD bindings (architecture v2 section 11): the 20 Hz HUD snapshot drives values that change every
// tick (timers, bars, heat, cooldowns) through signals that write straight into their DOM nodes, so those updates
// never re-render React. React still renders the structure, which changes rarely (a panel appears, a slot fills).
import { computed, effect, signal } from '@preact/signals-core';
import { createElement, type CSSProperties, useEffect, useRef, useState } from 'react';
import { type HudState, hudStore } from '@riftwarden/game/ui/store';

/** The HUD snapshot as a signal (one subscription to the store for every live binding). */
export const hud = signal<HudState>(hudStore.get());
hudStore.subscribe(() => {
  hud.value = hudStore.get();
});

/**
 * Bind a derived value to an element: `apply` runs on mount and whenever `select` gives a different value (===).
 * The latest `select` / `apply` are used without re-subscribing, so inline functions are fine.
 */
export function useLive<E extends HTMLElement, T>(select: (s: HudState) => T, apply: (el: E, v: T) => void) {
  const ref = useRef<E>(null);
  const fns = useRef({ select, apply });
  fns.current = { select, apply };
  useEffect(() => {
    const value = computed(() => fns.current.select(hud.value));
    return effect(() => {
      const v = value.value;
      if (ref.current) fns.current.apply(ref.current, v);
    });
  }, []);
  return ref;
}

/** Text that follows the HUD snapshot without re-rendering. */
export function LiveText({ select, as = 'span', className, testId }: { select: (s: HudState) => string | number; as?: 'span' | 'b' | 'em' | 'div'; className?: string; testId?: string }) {
  const ref = useLive<HTMLElement, string | number>(select, (el, v) => {
    el.textContent = String(v);
  });
  return createElement(as, { ref, className, 'data-testid': testId });
}

/** Inline style that follows the HUD snapshot (`apply` sets the properties it needs). */
export function useLiveStyle<T>(select: (s: HudState) => T, apply: (style: CSSStyleDeclaration, v: T) => void) {
  return useLive<HTMLElement, T>(select, (el, v) => apply(el.style, v));
}

/**
 * Segmented bar (same markup and classes as SegBar) bound to the snapshot: the fill follows at once, the damage trail
 * drains 0.45 s later; the tone class updates in place.
 */
export function LiveBar({ select, segments = 20, className = '', marker }: { select: (s: HudState) => { value: number; tone: string }; segments?: number; className?: string; marker?: number }) {
  const [first] = useState(() => select(hudStore.get()));
  const trail = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef(Math.max(0, Math.min(1, first.value)));
  const key = (s: HudState) => {
    const r = select(s);
    return `${Math.max(0, Math.min(1, r.value)).toFixed(4)}|${r.tone}`;
  };
  const root = useLive<HTMLDivElement, string>(key, (el, k) => {
    const [vs, tone] = k.split('|');
    const v = Number(vs);
    el.className = `segbar ${tone} ${className}`;
    (el.querySelector('.fill') as HTMLElement).style.transform = `scaleX(${v})`;
    if (timer.current) clearTimeout(timer.current);
    const setTrail = (t: number) => {
      shown.current = t;
      if (trail.current) trail.current.style.transform = `scaleX(${t})`;
    };
    if (v >= shown.current) setTrail(v);
    else timer.current = setTimeout(() => setTrail(v), 450);
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const style = { ['--segs' as string]: segments } as CSSProperties;
  return (
    <div ref={root} className={`segbar ${first.tone} ${className}`} style={style}>
      <div ref={trail} className="trail" style={{ transform: `scaleX(${shown.current})` }} />
      <div className="fill" style={{ transform: `scaleX(${shown.current})` }} />
      <div className="grid" />
      {marker !== undefined && <div className="marker" style={{ left: `${marker * 100}%` }} />}
    </div>
  );
}
