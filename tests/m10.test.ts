import { describe, expect, it } from 'vitest';
import { ENEMIES } from '@riftwarden/rules/data/defs';
import { DROP_SOURCES } from '@riftwarden/rules/loot/drops';
import { ELITE_IDS, ELITE_MODS, MUTATION_WAVE, rollMods, validMods } from '@riftwarden/rules/survival/elites';
import { ENEMY_COST, ENEMY_UNLOCK, SurvivalPlanner } from '@riftwarden/rules/survival/plan';
import { generateArena } from '@riftwarden/rules/world/arenaGen';
import { BIOME_IDS, BIOMES, biomeForSeed, biomeOf, factionMix } from '@riftwarden/rules/world/biomes';
import { mulberry32 } from '@riftwarden/rules/combat/damage';
import { ARENA } from '@riftwarden/rules/world/layout';
import { NavGrid } from '@riftwarden/rules/world/navgrid';
import { PASS_TOWERS } from '@riftwarden/rules/enemies/navigation';

const NEW_KINDS = ['sapper', 'skimmer', 'marksman', 'burrower'] as const;

describe('M10 biomes', () => {
  it('seeds split evenly across the three biomes and the classic arena is the outpost', () => {
    const n: Record<string, number> = {};
    for (let s = 1; s <= 600; s++) n[biomeForSeed(s)] = (n[biomeForSeed(s)] ?? 0) + 1;
    for (const id of BIOME_IDS) expect(n[id]).toBeGreaterThan(150);
    expect(biomeOf(ARENA).id).toBe('outpost');
  });

  it('generated arenas carry their biome; hazards sit in open ground, reserved, off the drop point and rifts', () => {
    for (let s = 1; s <= 30; s++) {
      const L = generateArena(s * 31);
      expect(L.biome).toBe(biomeForSeed(s * 31));
      const kind = BIOMES[L.biome!].hazard;
      const hz = L.hazards ?? [];
      if (kind === 'none') expect(hz.length).toBe(0);
      else expect(hz.length).toBeGreaterThan(3);
      const nav = new NavGrid(L, false);
      for (const h of hz) {
        expect(h.kind).toBe(kind);
        expect(nav.walkable(h.x, h.z)).toBe(true);
        expect(Math.hypot(h.x - L.playerSpawn.x, h.z - L.playerSpawn.z)).toBeGreaterThan(h.r + 9);
        for (const q of L.rifts ?? []) expect(Math.hypot(q.x - h.x, q.z - h.z)).toBeGreaterThan(h.r + 4);
        expect(L.reserved.some((r) => r.x0 <= h.x - h.r + 1e-6 && r.x1 >= h.x + h.r - 1e-6 && /frost|slag/.test(r.label))).toBe(true);
      }
      // Sector names come from the biome's word pool.
      expect(BIOMES[L.biome!].words.some((w) => L.name!.startsWith(w))).toBe(true);
    }
  });

  it('a faction biases the mix and always adds its archetypes', () => {
    const base = { walker: 4, rusher: 2, bulwark: 1 };
    const cryo = factionMix(base, BIOMES.cryo.faction);
    expect(cryo.burrower).toBeGreaterThan(0);
    expect(cryo.bulwark!).toBeGreaterThan(base.bulwark);
    expect(cryo.rusher!).toBeLessThan(base.rusher);
    expect(factionMix(base, null)).toBe(base);
  });
});

describe('M10 archetypes', () => {
  it('are fully defined (stats, cost, unlock, loot table) and the burrower/skimmer pass towers', () => {
    for (const k of NEW_KINDS) {
      const d = ENEMIES[k];
      expect(d.kind).toBe(k);
      expect(d.hp).toBeGreaterThan(0);
      expect(ENEMY_COST[k]).toBeGreaterThan(0);
      expect(ENEMY_UNLOCK[k]).toBeGreaterThanOrEqual(3);
      expect(k in DROP_SOURCES).toBe(true);
    }
    expect(PASS_TOWERS.has('burrower')).toBe(true);
    expect(PASS_TOWERS.has('skimmer')).toBe(true);
    expect(PASS_TOWERS.has('sapper')).toBe(false);
  });

  it('factions bring their archetypes into compositions; no faction keeps the old roster', () => {
    const count = (biome: keyof typeof BIOMES | null) => {
      const pl = new SurvivalPlanner(4242, 2, biome ? BIOMES[biome].faction : null);
      const c: Record<string, number> = {};
      for (let n = 4; n <= 30; n++) for (const s of pl.compose(n).spawns) c[s.kind] = (c[s.kind] ?? 0) + 1;
      return c;
    };
    const none = count(null);
    for (const k of NEW_KINDS) expect(none[k] ?? 0).toBe(0);
    expect(count('cryo').burrower ?? 0).toBeGreaterThan(0);
    expect(count('foundry').skimmer ?? 0).toBeGreaterThan(10);
    expect((count('outpost').sapper ?? 0) + (count('outpost').marksman ?? 0)).toBeGreaterThan(0);
  });

  it('compositions stay deterministic per seed + faction', () => {
    const a = new SurvivalPlanner(99, 3, BIOMES.foundry.faction).compose(18).spawns;
    const b = new SurvivalPlanner(99, 3, BIOMES.foundry.faction).compose(18).spawns;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('M10 mutations', () => {
  it('every modifier has a definition, and new ones respect exclusions', () => {
    expect(ELITE_IDS.length).toBe(10);
    for (const id of ELITE_IDS) expect(ELITE_MODS[id].color).toMatch(/^#/);
    expect(validMods('walker', ['splitting', 'volatile'])).toBe(false);
    expect(validMods('walker', ['frostbound', 'molten'])).toBe(false);
    expect(validMods('walker', ['shielded', 'armored'])).toBe(false);
    expect(validMods('walker', ['blinking', 'accelerated'])).toBe(false);
    expect(validMods('bulwark', ['splitting'])).toBe(false); // big frames do not split
    expect(validMods('walker', ['regenerating', 'shielded', 'splitting'])).toBe(true);
  });

  it('mutations unlock by wave and follow faction weights (a zero weight never rolls)', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      for (const m of rollMods('walker', 3, r, { wave: 6 })) expect(MUTATION_WAVE[m] ?? 0).toBeLessThanOrEqual(6);
      for (const m of rollMods('walker', 2, r, { wave: 40, weights: BIOMES.foundry.faction.mods })) expect(m).not.toBe('frostbound');
      for (const m of rollMods('walker', 2, r, { wave: 40, weights: BIOMES.cryo.faction.mods })) expect(m).not.toBe('molten');
    }
    // Strong preference shows up statistically.
    let frost = 0;
    for (let i = 0; i < 500; i++) if (rollMods('walker', 1, r, { wave: 40, weights: BIOMES.cryo.faction.mods })[0] === 'frostbound') frost++;
    expect(frost / 500).toBeGreaterThan(0.2);
  });
});
