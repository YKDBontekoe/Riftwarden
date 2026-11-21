import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { Engine } from '@babylonjs/core';
import { createRoot } from 'react-dom/client';
import { Flow } from './core/Flow';
import { loadSettings } from '@riftwarden/game/core/settings';
import { App } from './ui/App';
import './ui/style.css';

async function boot(): Promise<void> {
  const root = createRoot(document.getElementById('ui')!);
  let flow: Flow | null = null;
  root.render(<App getFlow={() => flow} />);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  // In-world screens and signs are drawn to canvases: make sure the UI fonts are ready (bounded wait).
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
  flow = new Flow(engine, canvas, havok, loadSettings());

  const params = new URLSearchParams(location.search);
  flow.devTools = params.has('dev') || params.has('test');
  if (params.has('classic')) flow.arenaMode = 'classic';
  if (params.has('endless')) flow.mapMode = false;
  if (params.has('test')) {
    // Automation mode: no real pointer lock required.
    flow.input.forceCapture = true;
    // Legacy acceptance suites measure the hand-built arena; ?procedural opts into generated sectors.
    flow.arenaMode = params.has('procedural') ? 'procedural' : 'classic';
    // ...and the classic endless checkpoint flow; ?map opts into the branching run map.
    flow.mapMode = params.has('map');
    // ...and a local Rift War (no network) unless ?war asks for the shared one.
    if (!params.has('war')) flow.war.base = null;
    (window as unknown as { __rift: unknown }).__rift = flow.debugApi();
  }

  flow.boot();
  // The only render loop for the whole session; worlds are swapped underneath it.
  engine.runRenderLoop(() => flow!.frame());
  window.addEventListener('resize', () => flow?.resize());
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('ui');
  if (el) el.innerHTML = `<div class="fatal">Riftwarden failed to start: ${String(err?.message ?? err)}<br/>A WebGL2-capable desktop browser is required.</div>`;
});
