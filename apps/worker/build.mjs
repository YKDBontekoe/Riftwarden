// Production bundle of the worker (both roles): one ESM program in dist/, Havok's wasm beside it. The image runs
// `node dist/main.mjs` with no node_modules and no TypeScript loader.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: { main: join(here, 'src/main.ts') },
  outdir: out,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: 'linked',
  minify: false,
  logLevel: 'warning',
  // CommonJS dependencies inside an ESM bundle need require().
  banner: { js: "import { createRequire as __rq } from 'node:module'; const require = __rq(import.meta.url);" },
});
const req = createRequire(join(here, 'src/sim/coopSim.ts'));
let dir = dirname(req.resolve('@babylonjs/havok'));
while (!dir.endsWith('havok') && dir.length > 1) dir = dirname(dir);
copyFileSync(join(dir, 'lib/esm/HavokPhysics.wasm'), join(out, 'HavokPhysics.wasm'));
console.log(`worker bundle written to ${out}`);
