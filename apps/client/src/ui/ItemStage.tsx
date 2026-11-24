import { useEffect, useRef } from 'react';
import { WeaponPreview } from '../home/WeaponPreview';
import type { ItemInstance } from '@riftwarden/rules/loot/types';

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
/** Headless suites keep a single GL context unless they opt in with `&stage`. */
export const STAGE_ENABLED = !params.has('test') || params.has('stage');

/**
 * Compact live inspection stage for the item detail panel: the item's 3D model turns slowly
 * (drag to rotate). Same engine as the workshop weapon viewer, created with the panel and
 * released when it unmounts.
 */
export function ItemStage({ item }: { item: ItemInstance }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pv = useRef<WeaponPreview | null>(null);
  useEffect(() => {
    const preview = new WeaponPreview(ref.current!);
    pv.current = preview;
    (window as unknown as { __stage?: WeaponPreview }).__stage = preview;
    const ro = new ResizeObserver(() => preview.engine.resize());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      preview.dispose();
      pv.current = null;
      const w = window as unknown as { __stage?: WeaponPreview };
      if (w.__stage === preview) delete w.__stage;
    };
  }, []);
  useEffect(() => {
    pv.current?.show(item);
  }, [item]);
  return (
    <div className="item-stage" data-testid="item-stage">
      <canvas ref={ref} />
    </div>
  );
}
