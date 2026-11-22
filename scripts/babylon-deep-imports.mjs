// One-off codemod (kept for future upgrades): rewrite `import { A, B } from '@babylonjs/core'` into deep imports
// from the module that declares each name (`@babylonjs/core/Maths/math.vector`), so the bundle carries only what
// the game uses. The map comes from following the package's `export * from` barrels to their leaf .d.ts files.
//   node scripts/babylon-deep-imports.mjs [--check]      (--check: list files that still import the barrel)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

const require = createRequire(join(process.cwd(), 'apps/client/package.json'));
const root = dirname(require.resolve('@babylonjs/core/package.json'));

/** name -> deep module path (without extension), following barrels depth-first in export order. */
const map = new Map();
const seen = new Set();
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/export \* from "(\.[^"]+)";/g)) {
    let target = join(dirname(file), m[1].replace(/\.js$/, '.d.ts'));
    try {
      if (statSync(target.replace(/\.d\.ts$/, '')).isDirectory()) target = join(target.replace(/\.d\.ts$/, ''), 'index.d.ts');
    } catch {
      /* a file */
    }
    walk(target);
  }
  const mod = relative(root, file).replace(/\.d\.ts$/, '').replace(/\\/g, '/');
  if (mod.endsWith('/index') || mod === 'index') {
    // Named re-exports inside barrels: export { A as B } from "./x"
    for (const m of src.matchAll(/export \{([^}]+)\} from "(\.[^"]+)";/g)) {
      const target = relative(root, join(dirname(file), m[2].replace(/\.js$/, ''))).replace(/\\/g, '/');
      for (const part of m[1].split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        const name = alias ?? orig;
        if (name && !map.has(name)) map.set(name, alias ? `${target}#${orig}` : target);
      }
    }
    return;
  }
  const add = (n) => n && !map.has(n) && map.set(n, mod);
  for (const m of src.matchAll(/export (?:declare )?(?:abstract )?(?:class|function|const|let|var|enum|interface|type|namespace) ([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/export \{([^}]+)\};/g)) for (const part of m[1].split(',')) add(part.trim().split(/\s+as\s+/).pop());
}
walk(join(root, 'index.d.ts'));

function files(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const check = process.argv.includes('--check');
const targets = [...files('apps'), ...files('packages'), ...files('tests'), ...files('scripts')];
const barrel = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@babylonjs\/core';?\n?/g;
let changed = 0;
const missing = new Set();
for (const f of targets) {
  const src = readFileSync(f, 'utf8');
  if (!src.includes("'@babylonjs/core'")) continue;
  if (check) {
    console.log(f);
    continue;
  }
  const out = src.replace(barrel, (_all, typeOnly, names) => {
    const groups = new Map();
    for (const raw of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      const isType = !!typeOnly || raw.startsWith('type ');
      const spec = raw.replace(/^type\s+/, '');
      const name = spec.split(/\s+as\s+/)[0].trim();
      const found = map.get(name);
      const [mod, orig] = found ? found.split('#') : [];
      if (!mod) {
        missing.add(`${name} (${f})`);
        continue;
      }
      if (!groups.has(mod)) groups.set(mod, []);
      const local = orig ? `${orig} as ${spec.split(/\s+as\s+/).pop()}` : spec;
      groups.get(mod).push(isType && !typeOnly ? `type ${local}` : local);
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mod, specs]) => `import ${typeOnly ? 'type ' : ''}{ ${specs.join(', ')} } from '@babylonjs/core/${mod}';\n`)
      .join('');
  });
  if (out !== src) {
    writeFileSync(f, out);
    changed++;
  }
}
if (missing.size) {
  console.error(`no module found for:\n  ${[...missing].join('\n  ')}`);
  process.exitCode = 1;
}
if (!check) console.log(`${changed} files rewritten, ${map.size} names known`);
