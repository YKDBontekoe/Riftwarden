import { describe, expect, it } from 'vitest';
import { createDefaultSave, sanitizeSave } from '../src/progression/save';

describe('legendary and exotic weapon signatures', () => {
  it('legendary and exotic weapons roll a persistent signature; others none; old saves get one on load', async () => {
    const { generateItem } = await import('../src/loot/generate');
    const { signatureDef } = await import('../src/loot/signatures');
    const leg = generateItem({ uid: 'L1', seed: 42, level: 10, rarity: 'legendary', baseId: 'plasma_repeater', source: 't', now: 1 });
    const rare = generateItem({ uid: 'R1', seed: 42, level: 10, rarity: 'rare', baseId: 'plasma_repeater', source: 't', now: 1 });
    expect(signatureDef(leg.signature)).not.toBeNull();
    expect(signatureDef(leg.signature)!.exotic).toBeFalsy();
    expect(rare.signature).toBeNull();
    const again = generateItem({ uid: 'L1', seed: 42, level: 10, rarity: 'legendary', baseId: 'plasma_repeater', source: 't', now: 1 });
    expect(again.signature).toBe(leg.signature);
    const d = createDefaultSave(1);
    const old = { ...leg, signature: null };
    d.items.push(old as never);
    d.storage.uids.push(old.uid);
    const { data } = sanitizeSave(JSON.parse(JSON.stringify(d)));
    expect(data.items.find((i) => i.uid === 'L1')!.signature).toBe(leg.signature);
  });
});
