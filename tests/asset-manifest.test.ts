import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROP_SPECIES } from '@riftwarden/rules/world/propCatalog';
import { MUSIC_TRACKS } from '@riftwarden/game/audio/musicPlan';

const DIR = join(__dirname, '../packages/game/src/assets/cc0');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  assets: { id: string; kind: string; file: string; license: string; sha256: string; bytes: number; source: string; author: string }[];
};
/**
 * Repository budget for third-party assets. All are lazily loaded and never precached; an arena downloads only
 * its own biome's surface sets (~3-5 MB) plus the props and loops it uses.
 */
const BUDGET = 32 * 1024 * 1024;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('CC0 asset manifest', () => {
  const files = walk(DIR).map((p) => relative(DIR, p)).filter((p) => p !== 'manifest.json');

  it('lists every shipped file, CC0 only, with a matching hash', () => {
    const listed = new Map(manifest.assets.map((a) => [a.file, a]));
    for (const file of files) {
      const entry = listed.get(file);
      expect(entry, `${file} is not in manifest.json (run node scripts/fetch-cc0.mjs)`).toBeDefined();
      expect(entry!.license).toBe('CC0-1.0');
      expect(entry!.source).toMatch(/^https:\/\/(polyhaven\.com|opengameart\.org)\//);
      expect(entry!.author.length).toBeGreaterThan(0);
      const buf = readFileSync(join(DIR, file));
      expect(entry!.bytes).toBe(buf.length);
      expect(createHash('sha256').update(buf).digest('hex')).toBe(entry!.sha256);
    }
    expect(manifest.assets.length).toBe(files.length);
  });

  it('stays inside the download budget', () => {
    expect(manifest.assets.reduce((s, a) => s + a.bytes, 0)).toBeLessThanOrEqual(BUDGET);
  });

  it('has an asset for every prop species and music track the game asks for', () => {
    const ids = new Set(manifest.assets.map((a) => a.id));
    for (const species of Object.keys(PROP_SPECIES)) expect(ids.has(species), species).toBe(true);
    for (const track of MUSIC_TRACKS) expect(ids.has(track), track).toBe(true);
  });
});
