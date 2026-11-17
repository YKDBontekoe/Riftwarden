import { useEffect, useRef } from 'react';
import { WeaponPreview } from '../home/WeaponPreview';
import type { ItemInstance } from '../loot/types';

/** Live 3D weapon inspection (drag to rotate, scroll to zoom). Owns its preview engine. */
export function WeaponViewer({ item, caption }: { item: ItemInstance | null; caption?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pv = useRef<WeaponPreview | null>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const preview = new WeaponPreview(canvas);
    pv.current = preview;
    (window as unknown as { __preview?: WeaponPreview }).__preview = preview;
    const ro = new ResizeObserver(() => preview.engine.resize());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      preview.dispose();
      pv.current = null;
      const w = window as unknown as { __preview?: WeaponPreview };
      if (w.__preview === preview) delete w.__preview;
    };
  }, []);
  useEffect(() => {
    pv.current?.show(item);
  }, [item]);
  return (
    <div className="wpn-viewer">
      <canvas ref={ref} />
      {!item && <div className="wv-empty">NO WEAPON SELECTED</div>}
      <div className="wv-hint">{caption ?? 'DRAG TO ROTATE · SCROLL TO ZOOM'}</div>
    </div>
  );
}
