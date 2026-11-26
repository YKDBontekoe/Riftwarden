import { useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import { useHud } from '../ui/useHud';
import { desktopUpdate, isDesktop } from './update';

export function DesktopUpdate({ flow }: { flow: Flow | null }) {
  const status = useSyncExternalStore(desktopUpdate.subscribe, desktopUpdate.get);
  const screen = useHud((state) => state.screen);
  if (!isDesktop() || status !== 'ready' || screen !== 'menu' || !flow || flow.busy || (flow.run && !flow.run.ended) || flow.coopRun || flow.net?.state.lobby) return null;
  return (
    <div className="pwa-toast" role="status">
      <span className="pwa-text"><b>Update ready.</b> Restart Riftwarden to install it.</span>
      <button className="primary" onClick={() => {
        if (!flow.busy && (!flow.run || flow.run.ended) && !flow.coopRun && !flow.net?.state.lobby) void desktopUpdate.install();
      }}>RESTART TO UPDATE</button>
      <button className="mini" onClick={desktopUpdate.dismiss}>LATER</button>
    </div>
  );
}
