import { keyLabel } from '@riftwarden/game/core/settings';
import { useHud } from './useHud';
import { type ReactNode, useEffect } from 'react';
import { stationInfo } from '@riftwarden/rules/home/stationInfo';
import { CURRENCIES, currencyTooltip } from '@riftwarden/rules/economy/currencies';

/** Terminal window frame shared by every HQ station. E / Esc close it (not while typing). */
export function Shell({ code, title, sub, close, children, accent = 'cyan', wide }: { code: string; title: string; sub: string; close: () => void; children: ReactNode; accent?: 'cyan' | 'amber' | 'violet'; wide?: boolean }) {
  const useCode = useHud(s => s.bindings.use);
  const info = stationInfo(useHud((s) => s.terminal));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === 'Escape' || (e.code === useCode && !typing)) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, useCode]);
  return (
    <div className="screen terminal-screen">
      <div className={`terminal panel-frame ${accent} ${wide ? 'wide' : ''}`}>
        <div className="term-head">
          <div className="term-code">{code}</div>
          <div className="flex-[1]">
            <div className="term-title">{title}</div>
            <div className="term-sub">{sub}</div>
          </div>
          <button className="term-close" onClick={close}>
            <kbd>{keyLabel(useCode)}</kbd>/<kbd>ESC</kbd> CLOSE
          </button>
        </div>
        {info && (
          <div className="term-purpose" data-testid="term-purpose">
            <span>{info.purpose}</span>
            {info.uses.length > 0 && (
              <span className="term-uses">
                USES
                {info.uses.map((k) => (
                  <i key={k} className={CURRENCIES[k].cls} title={currencyTooltip(k)}>
                    {CURRENCIES[k].icon} {CURRENCIES[k].name}
                  </i>
                ))}
              </span>
            )}
          </div>
        )}
        <div className="term-body">{children}</div>
      </div>
    </div>
  );
}

