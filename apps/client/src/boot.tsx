import '@riftwarden/game/babylonSideEffects';
import HavokPhysics from '@babylonjs/havok';
import { startAccountSync } from './account/sync';
import { refreshAccount } from './account/store';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { createEngine } from './core/engine';
import { createRoot } from 'react-dom/client';
import { Flow } from './core/Flow';
import { loadSettings, mobileDefaults } from '@riftwarden/game/core/settings';
import { immersiveStats, initTouch, isTouchDevice } from './touch/touchMode';
import { simulatePwa } from './pwa';
import { createAppRouter, Root } from './ui/router';
import { loadSurfaceSources } from '@riftwarden/game/visuals/surfaceSources';

// The game: Babylon, Havok, the simulation and the React app. Loaded by main.tsx right after the shell.
export async function boot(): Promise<void> {
  const root = createRoot(document.getElementById('ui')!);
  let flow: Flow | null = null;
  root.render(<Root router={createAppRouter(() => flow)} />);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  // First start on a phone or tablet: the performance preset (stored settings always win).
  const settings = loadSettings(isTouchDevice() ? mobileDefaults() : undefined);
  const { engine, backend } = await createEngine(canvas, settings.renderer);
  const [havok] = await Promise.all([
    HavokPhysics({ locateFile: () => havokWasmUrl }),
    Promise.race([loadSurfaceSources(), new Promise((resolve) => setTimeout(resolve, 1800))]),
  ]);
  // In-world screens and signs are drawn to canvases: make sure the UI fonts are ready (bounded wait).
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
  flow = new Flow(engine, canvas, havok, settings);
  flow.backend = backend;

  const params = new URLSearchParams(location.search);
  // Touch controls (auto on touch screens; ?touch forces them, automation never enters real fullscreen).
  initTouch(flow, { force: params.has('touch'), simulate: params.has('test') });
  flow.devTools = params.has('dev') || params.has('test');
  // Accounts: sync the profile while signed in; restore the session at boot (automation opts in with &account).
  startAccountSync(flow);
  if (!params.has('test') || params.has('account')) void refreshAccount();
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
    (window as unknown as { __touch: unknown }).__touch = { immersiveStats, simulatePwa };
  }

  flow.boot();
  // The only render loop for the whole session; worlds are swapped underneath it.
  engine.runRenderLoop(() => flow!.frame());
  window.addEventListener('resize', () => flow?.resize());
}
