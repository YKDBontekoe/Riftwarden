// React parts of the final UI design system (ds.css): breadcrumb, input-aware hints, currencies, measures, item tiles.
import type { ReactNode } from 'react';
import type { RarityId } from '@riftwarden/rules/loot/rarity';
import { CURRENCIES, currencyTooltip, type CurrencyKey } from '@riftwarden/rules/economy/currencies';

/** Rarity -> ds colour class (colour always comes with pips on the tile). */
export const RARITY_CLS: Record<RarityId, string> = {
  common: 'ds-rc', uncommon: 'ds-ru', rare: 'ds-rr', epic: 'ds-re', legendary: 'ds-rl', exotic: 'ds-rx', ascended: 'ds-ra',
};
const RARITY_ORDER: readonly RarityId[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'exotic', 'ascended'];
export const rarityCls = (id: string | undefined): string => RARITY_CLS[(id ?? 'common') as RarityId] ?? 'ds-rc';
/** ■■■□□□□ for a rarity (the shape that goes with its colour). */
export function pips(id: string | undefined): string {
  const n = Math.max(0, RARITY_ORDER.indexOf((id ?? 'common') as RarityId)) + 1;
  return '■'.repeat(n) + '□'.repeat(7 - n);
}

/** Currency colour + shape: credits are dots, materials diamonds. */
export const CUR_LOOK: Record<CurrencyKey, { color: string; shape: 'dot' | 'dia' }> = {
  credits: { color: '#7fe9ff', shape: 'dot' },
  salvage: { color: '#edb282', shape: 'dia' },
  components: { color: '#d4b2ff', shape: 'dia' },
  shards: { color: '#9ff5ff', shape: 'dia' },
  xp: { color: '#d4b2ff', shape: 'dot' },
  cores: { color: '#ffcf73', shape: 'dot' },
  tactical: { color: '#9fd7ff', shape: 'dot' },
} as Record<CurrencyKey, { color: string; shape: 'dot' | 'dia' }>;

export function Mark({ k }: { k: CurrencyKey }) {
  const l = CUR_LOOK[k] ?? { color: '#f4f1e8', shape: 'dot' };
  return <span aria-hidden="true" className={l.shape === 'dot' ? 'ds-dot' : 'ds-dia'} style={{ background: l.color, boxShadow: `0 0 10px ${l.color}` }} />;
}

/** One currency in the top bar: mark, amount, short name. */
export function Cur({ k, value, note }: { k: CurrencyKey; value: number; note?: string }) {
  const info = CURRENCIES[k];
  return (
    <span className="ds-cur" title={currencyTooltip(k)} data-cur={k}>
      <Mark k={k} />
      {Math.floor(value).toLocaleString()} <small>{note ?? info?.name ?? k}</small>
    </span>
  );
}

/** Breadcrumb: `RUN / GLACIER WORKS / CHECKPOINT` (last part bold). */
export function Crumb({ parts }: { parts: readonly string[] }) {
  return (
    <span className="ds-crumb">
      {parts.map((p, i) => (
        <span key={i} className="ds-row" style={{ gap: 12 }}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {i === parts.length - 1 ? <b>{p}</b> : p}
        </span>
      ))}
    </span>
  );
}

/** Key glyph(s) + words. Touch mode hides the glyphs (html[data-touch]); the words stay. */
export function Hint({ keys, children, onClick }: { keys: readonly string[] | string; children: ReactNode; onClick?: () => void }) {
  const ks = typeof keys === 'string' ? [keys] : keys;
  const inner = (
    <>
      {ks.map((k) => (
        <span key={k} className="ds-k">{k}</span>
      ))}
      {children}
    </>
  );
  return onClick ? <button type="button" className="ds-hint" onClick={onClick}>{inner}</button> : <span className="ds-hint">{inner}</span>;
}

/** Skewed segment meter: n of total lit. */
export function Seg({ value, total, color, height }: { value: number; total: number; color?: string; height?: number }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * total);
  return (
    <span className="ds-seg" style={color ? ({ '--c': color } as React.CSSProperties) : undefined} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''} style={height ? { height } : undefined} />
      ))}
    </span>
  );
}

export function Bar({ value, color, height }: { value: number; color?: string; height?: number }) {
  return (
    <span className="ds-bar" style={{ ...(color ? { '--c': color } : {}), ...(height ? { height } : {}) } as React.CSSProperties} aria-hidden="true">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </span>
  );
}

export function RiskTag({ children }: { children: ReactNode }) {
  return <span className="ds-risk-tag">{children}</span>;
}

export function Gem({ color, size = 40, children }: { color: string; size?: number; children?: ReactNode }) {
  return <span className="ds-gem" style={{ '--c': color, width: size, height: size } as React.CSSProperties}>{children}</span>;
}

/** Element glyph paths (16 px stroke icons) for gems. */
export const ELEMENT_PATH: Record<string, string> = {
  kinetic: 'M8 3a5 5 0 1 0 0 10A5 5 0 1 0 8 3zM8 7v2',
  thermal: 'M8 1.5c2.5 3 4.5 5 4.5 8a4.5 4.5 0 0 1-9 0c0-2 1.2-3.3 2-4 .2 1.5 1 2.3 1.8 2.5C7.4 6 7.4 3.8 8 1.5z',
  electric: 'M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z',
  cryo: 'M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5',
  corrosive: 'M8 1.5C8 1.5 3.5 7 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7 8 1.5 8 1.5z',
  void: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11zM8 6a2 2 0 1 0 0 4 2 2 0 1 0 0-4z',
};
export const ELEMENT_COLOR: Record<string, string> = {
  kinetic: '#e4e6e0', thermal: '#ffa46b', electric: '#ffe76b', cryo: '#9fe0ff', corrosive: '#b8f06b', void: '#d4b2ff',
};

export function ElementGem({ el, size = 34 }: { el: string; size?: number }) {
  const c = ELEMENT_COLOR[el] ?? '#f4f1e8';
  return (
    <Gem color={c} size={size}>
      <svg aria-hidden="true" width={size * 0.47} height={size * 0.47} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <path d={ELEMENT_PATH[el] ?? ELEMENT_PATH.kinetic} />
      </svg>
    </Gem>
  );
}

/** Background for full-screen menus: the live world blurred behind glass (or a solid ground before a world exists). */
export function Backdrop({ solid, scrim = 'l' }: { solid?: boolean; scrim?: 'l' | 'r' | 'none' }) {
  return (
    <>
      <div className={solid ? 'ds-solid' : 'ds-blur'} />
      {scrim === 'l' && <div className="ds-scrim-l" />}
      {scrim === 'r' && <div className="ds-scrim-r" />}
      <div className="ds-vig" />
    </>
  );
}
