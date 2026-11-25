import { BoundKey } from './hud/widgets';
import { useHud } from './useHud';
import { Seg } from './ds';

/** Contextual onboarding card (M7). Completes itself when the player does the thing. */
export function TutorialCard() {
  const t = useHud((s) => s.tutorial);
  if (!t) return null;
  return (
    <div className="tutorial-card ds-glass ds-cut" key={t.id} data-testid="tutorial-card" data-step={t.id}>
      <div className="tc-kicker ds-row">
        <span className="ds-ov ds-em ds-grow">First run · step {t.index} of {t.total}</span>
        <Seg value={t.index / Math.max(1, t.total)} total={Math.min(12, t.total)} color="#ff8a3d" />
      </div>
      <div className="tc-title ds-h2">{t.title}</div>
      <div className="tc-text ds-body">{t.text}</div>
      {t.keys && (
        <div className="tc-keys">
          {t.keys.map((k) => (
            k === 'MOUSE' || k === 'LMB' ? <kbd key={k}>{k}</kbd> : <BoundKey key={k} action={k} />
          ))}
        </div>
      )}
      <div className="tc-skip">
        <kbd>F10</kbd> skip training · replay any time in Settings › Accessibility
      </div>
    </div>
  );
}
