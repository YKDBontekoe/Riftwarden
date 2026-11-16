import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { Engine } from '@babylonjs/core';
import { createRoot } from 'react-dom/client';
import { Game } from './core/Game';
import { loadSettings } from './core/settings';
import { App } from './ui/App';
import { hudStore } from './ui/store';
import './ui/style.css';

async function boot(): Promise<void> {
  const root = createRoot(document.getElementById('ui')!);
  let game: Game | null = null;
  root.render(<App getGame={() => game} />);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, true);
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  game = new Game(engine, canvas, havok, loadSettings());

  const params = new URLSearchParams(location.search);
  if (params.has('test')) {
    // Automation mode: no real pointer lock required.
    game.input.forceCapture = true;
    (window as unknown as { __rift: unknown }).__rift = game.debugApi();
  }

  engine.runRenderLoop(() => game!.frame());
  window.addEventListener('resize', () => engine.resize());
  hudStore.set({ screen: 'menu' });
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('ui');
  if (el) el.innerHTML = `<div class="fatal">Riftwarden failed to start: ${String(err?.message ?? err)}<br/>A WebGL2-capable desktop browser is required.</div>`;
});
