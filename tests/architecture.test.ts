// Architecture guardrails: cheap static checks over import statements so coupling cannot creep back.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

interface Imp {
  spec: string;
  typeOnly: boolean;
}
function imports(file: string): Imp[] {
  const text = readFileSync(file, 'utf8');
  const out: Imp[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // `import { type A, type B }` (all specifiers type-only) also counts as type-only.
    const names = m[3].replace(/[{}*]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    const allType = !!m[2] || (names.length > 0 && names.every((n) => n.startsWith('type ')));
    out.push({ spec: m[4], typeOnly: allType });
  }
  const side = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (let m = side.exec(text); m; m = side.exec(text)) out.push({ spec: m[1], typeOnly: false });
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/');
const files = walk(SRC);

/** Value (non type-only) local dependencies of a file. */
const valueDeps = (f: string) => imports(f).filter((i) => !i.typeOnly).map((i) => resolveLocal(f, i.spec)).filter((x): x is string => !!x);

function findCycle(group: string[]): string[] | null {
  const set = new Set(group);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (f: string): string[] | null => {
    state.set(f, 1);
    stack.push(f);
    for (const d of valueDeps(f)) {
      if (!set.has(d)) continue;
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d].map(rel);
      if (!state.has(d)) {
        const c = visit(d);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(f, 2);
    return null;
  };
  for (const f of group) if (!state.has(f)) {
    const c = visit(f);
    if (c) return c;
  }
  return null;
}

const inDir = (d: string) => files.filter((f) => rel(f).startsWith(d));

describe('architecture boundaries', () => {
  it('progression/save modules form an acyclic graph', () => {
    expect(findCycle(inDir('progression/save/'))).toBeNull();
  });

  it('enemy behaviours depend on EnemyManager, never the other way around', () => {
    const mgr = files.find((f) => rel(f) === 'enemies/EnemyManager.ts')!;
    const behaviourish = (f: string) => /behaviors|Behaviors|bosses\//.test(rel(f));
    const bad = valueDeps(mgr).filter(behaviourish).map(rel);
    expect(bad).toEqual([]);
  });

  it('arena systems never import Game as a value (narrow host interfaces only)', () => {
    const bad: string[] = [];
    for (const f of inDir('arena/')) for (const d of valueDeps(f)) if (rel(d) === 'core/Game.ts') bad.push(rel(f));
    expect(bad).toEqual([]);
  });

  it('presentation capture/replication modules do not depend on the Game subclasses', () => {
    const bad: string[] = [];
    for (const name of ['net/recorder.ts', 'net/replicated.ts', 'net/wire.ts']) {
      const f = files.find((x) => rel(x) === name);
      if (!f) continue;
      for (const d of valueDeps(f)) if (/net\/(Server|Client)Game\.ts$/.test(rel(d)) || rel(d) === 'core/Game.ts') bad.push(`${name} -> ${rel(d)}`);
    }
    expect(bad).toEqual([]);
  });

  it('pure modules import no Babylon values (type-only is fine)', () => {
    const pure = ['loot/roll.ts', 'towers/refit.ts', 'combat/blast.ts', 'ui/hudModel.ts', 'arena/runPhase.ts', 'progression/level.ts', 'progression/skilltree.ts', 'progression/treeOps.ts', 'economy/currencies.ts', 'home/stationInfo.ts', 'loot/loadoutScore.ts', 'ui/statHelp.ts'];
    const bad: string[] = [];
    for (const name of pure) {
      const f = files.find((x) => rel(x) === name);
      if (!f) continue; // module not created yet
      for (const i of imports(f)) if (!i.typeOnly && i.spec.startsWith('@babylonjs/')) bad.push(`${name} -> ${i.spec}`);
    }
    expect(bad).toEqual([]);
  });

  it('server-only code is never imported by the browser bundle', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const i of imports(f)) if (/^(ws|node:)/.test(i.spec) || i.spec.includes('/server/')) bad.push(`${rel(f)} -> ${i.spec}`);
    }
    // src/net/protocol etc. may be shared with the server, but src must not pull in node-only modules.
    expect(bad).toEqual([]);
  });
});
