import { keyLabel } from '@riftwarden/game/core/settings';
import { useHud } from './useHud';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { RESOURCE_KEYS, type ResourceKey } from '@riftwarden/rules/economy/config';
import { stationInfo } from '@riftwarden/rules/home/stationInfo';
import { CURRENCIES, currencyTooltip } from '@riftwarden/rules/economy/currencies';
import { stationArtwork } from '@riftwarden/game/visuals/fieldArtwork';
import { FieldArt } from './FieldArt';
import { FieldIcon, STATION_ICON } from './FieldIcon';
import { CurrencyIcon } from './inventory/thumbs';
import { Crumb, Cur } from './ds';
import { OfflineBanner } from './SystemStates';

/** Currencies the warden can see (staged unlocks); null = all. Provided by TerminalHost. */
export const ShellCurrencies = createContext<readonly ResourceKey[] | null>(null);
/** Secured HQ resources (top-bar amounts). Provided by TerminalHost. */
export const ShellResources = createContext<Partial<Record<ResourceKey, number>> | null>(null);

/** Terminal window frame shared by every HQ station. E / Esc close it (not while typing). */
export function Shell({ code, title, sub, close, children, accent = 'cyan', wide }: { code: string; title: string; sub: string; close: () => void; children: ReactNode; accent?: 'cyan' | 'amber' | 'violet'; wide?: boolean }) {
  const useCode = useHud(s => s.bindings.use);
  const terminal = useHud((s) => s.terminal);
  const info = stationInfo(terminal);
  const visible = useContext(ShellCurrencies);
  const uses = info ? info.uses.filter((k) => !visible || !(RESOURCE_KEYS as readonly string[]).includes(k) || visible.includes(k as ResourceKey)) : [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === 'Escape' || (e.code === useCode && !typing)) {
        e.preventDefault();
        close();
        return;
      }
      // Enter runs the station's main action (the docked button) unless something else has the focus.
      const focus = document.activeElement;
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !typing && !e.defaultPrevented && !(focus instanceof HTMLButtonElement || focus instanceof HTMLAnchorElement || focus instanceof HTMLSelectElement)) {
        const btn = document.querySelector<HTMLButtonElement>('.terminal-screen .term-primary[data-enter]:not(:disabled)');
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, useCode]);
  const res = useContext(ShellResources);
  const name = info?.name ?? title;
  return (
    <div className={`screen terminal-screen ds-scr acc-${accent}`}>
      <div className="ds-blur" />
      <div className="term-shade" />
      <div className="ds-top term-top">
        <span className="term-code ds-mono">{terminal && <FieldIcon name={STATION_ICON[terminal]} />}{code}</span>
        <Crumb parts={name.toLowerCase() === title.toLowerCase() ? ['HQ', title] : ['HQ', name, title]} />
        <span className="ds-grow" />
        <OfflineBanner chip />
        <span className="term-meta ds-mono" title={sub}>{sub}</span>
        {res && uses.filter((k) => (RESOURCE_KEYS as readonly string[]).includes(k)).map((k) => <Cur key={k} k={k} value={res[k as ResourceKey] ?? 0} />)}
      </div>
      <div className={`terminal panel-frame ${accent} ${wide ? 'wide' : ''}`}>
        <div className="term-head">
          <FieldArt name={stationArtwork(terminal)} className="terminal-art" />
          <div className="term-titles flex-[1]">
            <div className="term-title">{title}</div>
            <div className="term-sub">{sub}</div>
          </div>
        </div>
        <div className="term-body">{children}</div>
      </div>
      <div className="ds-bot term-bot">
        {info && (
          <span className="term-purpose ds-meta" data-testid="term-purpose">
            {info.purpose}
            {uses.length > 0 && (
              <span className="term-uses">
                {' '}Uses{' '}
                {uses.map((k) => (
                  <i key={k} className={CURRENCIES[k].cls} title={currencyTooltip(k)}>
                    <CurrencyIcon k={k} /> {CURRENCIES[k].name}
                  </i>
                ))}
              </span>
            )}
          </span>
        )}
        <span className="ds-grow" />
        <button className="term-close ds-hint" onClick={close}>
          <span className="ds-k">{keyLabel(useCode)}</span><span className="ds-k">ESC</span>BACK
        </button>
      </div>
      <div className="ds-grain" />
    </div>
  );
}

