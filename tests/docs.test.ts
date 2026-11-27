// Documentation stays navigable (AGENTS.md "Documentation rules"): relative Markdown links resolve, every CLAUDE.md
// import points at an existing file, and every system note is listed in the systems index.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const skip = new Set(['node_modules', '.git', 'target', 'dist', 'gen']);

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) markdownFiles(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

const docs = markdownFiles(root);
const rel = (p: string) => relative(root, p);

describe('documentation', () => {
  it('relative links resolve', () => {
    const broken: string[] = [];
    for (const file of docs) {
      // Code spans can contain link-like text; drop them before scanning.
      const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const path = decodeURIComponent(target.split('#')[0]);
        if (!existsSync(resolve(dirname(file), path))) broken.push(`${rel(file)} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('CLAUDE.md imports point at existing files', () => {
    const broken: string[] = [];
    for (const file of docs.filter((f) => f.endsWith('CLAUDE.md'))) {
      for (const [, target] of readFileSync(file, 'utf8').matchAll(/^@(\S+)$/gm)) {
        if (!existsSync(resolve(dirname(file), target))) broken.push(`${rel(file)} -> @${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every system note is listed in docs/systems/README.md', () => {
    const dir = join(root, 'docs/systems');
    const index = readFileSync(join(dir, 'README.md'), 'utf8');
    const missing = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md' && !index.includes(`](${f})`));
    expect(missing).toEqual([]);
  });

  it('the agent guide stays short', () => {
    // Detail belongs in docs/; the root guide is loaded into every agent session.
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8').split('\n').length).toBeLessThan(200);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8').split('\n').length).toBeLessThan(40);
  });
});
