// First load: this shell and the styles (the boot splash in index.html is already on screen). Everything else (the
// engine, the simulation, the React app) is one lazily loaded chunk that starts downloading right away.
import './ui/style.css';

function fatal(err: unknown): void {
  console.error(err);
  const el = document.getElementById('ui');
  const msg = String((err as Error)?.message ?? err).replace(/[<>&]/g, '');
  if (el) el.innerHTML = `<div class="fatal">Riftwarden failed to start: ${msg}<br/>A WebGL2-capable desktop browser is required.</div>`;
}

import('./boot').then((m) => m.boot()).catch(fatal);
