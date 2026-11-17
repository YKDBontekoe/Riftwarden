import { type ReactNode, useEffect } from 'react';

/** Terminal window frame shared by every HQ station. E / Esc close it (not while typing). */
export function Shell({ code, title, sub, close, children, accent = 'cyan', wide }: { code: string; title: string; sub: string; close: () => void; children: ReactNode; accent?: 'cyan' | 'amber' | 'violet'; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === 'Escape' || (e.code === 'KeyE' && !typing)) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="screen terminal-screen">
      <div className={`terminal panel-frame ${accent} ${wide ? 'wide' : ''}`}>
        <div className="term-head">
          <div className="term-code">{code}</div>
          <div className="term-titles">
            <div className="term-title">{title}</div>
            <div className="term-sub">{sub}</div>
          </div>
          <button className="term-close" onClick={close}>
            <kbd>E</kbd>/<kbd>ESC</kbd> CLOSE
          </button>
        </div>
        <div className="term-body">{children}</div>
      </div>
    </div>
  );
}

