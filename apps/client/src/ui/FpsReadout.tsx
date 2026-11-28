// Settings > Interface > Frame rate: a small corner readout for players who want a number without the F3 overlay.
import { useEffect, useState } from 'react';
import type { Flow } from '../core/Flow';

export function FpsReadout({ flow }: { flow: Flow }) {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      const f = flow.engine.getFps();
      setFps(Number.isFinite(f) ? Math.round(f) : 0);
    }, 500);
    return () => window.clearInterval(t);
  }, [flow]);
  const tone = fps >= 55 ? 'var(--ds-up)' : fps >= 30 ? 'var(--ds-risk)' : 'var(--ds-down)';
  return (
    <span className="fps-readout ds-mono" data-testid="fps-readout" aria-hidden="true" style={{ color: tone }}>
      {fps} FPS
    </span>
  );
}
