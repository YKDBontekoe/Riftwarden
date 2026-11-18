import { useHud } from './store';

/** Contextual onboarding card (M7). Completes itself when the player does the thing. */
export function TutorialCard() {
  const t = useHud((s) => s.tutorial);
  if (!t) return null;
  return (
    <div className="tutorial-card" key={t.id} data-testid="tutorial-card" data-step={t.id}>
      <div className="tc-kicker">
        TRAINING · {t.index}/{t.total}
      </div>
      <div className="tc-title">{t.title}</div>
      <div className="tc-text">{t.text}</div>
      {t.keys && (
        <div className="tc-keys">
          {t.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </div>
      )}
      <div className="tc-skip">
        <kbd>F10</kbd> skip training · replay any time in Settings › Accessibility
      </div>
    </div>
  );
}
