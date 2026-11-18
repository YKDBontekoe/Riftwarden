import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProfileDatabase } from '../server/profileDatabase';
import { bankRewards, beginRun, createDefaultSave, resolveInterruptedRun } from '../src/progression/save';

const testUrl = process.env.RIFT_TEST_DATABASE_URL;

describe.skipIf(!testUrl)('PostgreSQL profiles', () => {
  const schema = `profiles_${randomBytes(8).toString('hex')}`;
  let admin: pg.Pool;
  let db: ProfileDatabase;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(testUrl!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    vi.stubEnv('DATABASE_URL', url.href);
    db = new ProfileDatabase((error) => { throw error; });
    await db.migrate();
    await db.migrate();
  });

  afterAll(async () => {
    try {
      await db?.close();
      if (admin) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin?.end();
      vi.unstubAllEnvs();
    }
  });

  const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it('round trips balances, gear, a socketed module, presets, run state, market, and HQ rows', async () => {
    const data = createDefaultSave(1_700_000_000_000);
    data.resources.credits = 1_000_000_000_000;
    const weapon = data.items[0];
    const module = structuredClone(data.market.modules[0].item);
    module.uid = 'installed-module';
    weapon.sockets = 2;
    weapon.socketed = [null, module];
    weapon.build!.sockets = ['barrel', 'system'];
    weapon.enhance = 2;
    weapon.locked = false;
    const accessory = structuredClone(data.market.equipment[0].item);
    Object.assign(accessory, { uid: 'accessory', category: 'accessory' });
    const stored = { ...structuredClone(data.market.modules[1].item), uid: 'stored-module' };
    data.items.push(accessory, stored);
    data.storage.uids.push(stored.uid);
    data.loadout.accessory2 = accessory.uid;
    data.presets[2].slots.accessory2 = accessory.uid;
    data.base.structure.floors['-8,0'] = 'floor';
    data.base.stations.command = { x: 0, z: 1.4, yaw: 1.5 };
    data.base.owned.bench = 4;
    data.base.placeables[0].props = { accentColor: 'blue', lightEnabled: false, brightness: 0 };
    data.tutorial.done.push('test');
    data.towers.unlocked.push('core:test');
    data.economy.tx.push('a', 'b');
    beginRun(data, 'previous-run', 1);
    bankRewards(data, 'previous-run', 5, { salvage: 5, items: [] });
    resolveInterruptedRun(data);
    data.market.equipment[0].sold = true;
    data.market.modules[0].featured = false;
    beginRun(data, 'active-run', 1);
    bankRewards(data, 'active-run', 5, { salvage: 3, items: [] });

    await db.save([{ id: 'rich-profile', revision: null, data }]);
    const loaded = await db.load('rich-profile');
    expect(loaded?.revision).toBe(0);
    expect(json(loaded?.data)).toEqual(json(data));

    const next = structuredClone(data);
    next.base.placeables.reverse();
    next.storage.uids.length = 0;
    next.items.pop();
    next.activeRun = null;
    next.resources.credits -= 4;
    await db.save([{ id: 'rich-profile', revision: 0, data: next, before: data }]);
    const updated = await db.load('rich-profile');
    expect(updated?.revision).toBe(1);
    expect(json(updated?.data)).toEqual(json(next));
  });

  it('rolls back an invalid write across every profile in a transaction', async () => {
    const data = createDefaultSave();
    await db.save([{ id: 'a', revision: null, data }, { id: 'b', revision: null, data }]);
    const changed = structuredClone(data);
    changed.resources.credits++;
    changed.base.owned.planter = 1;
    const invalid = structuredClone(data);
    invalid.base.owned.planter = -1;
    await expect(db.save([
      { id: 'a', revision: 0, data: changed, before: data },
      { id: 'b', revision: 0, data: invalid, before: data },
    ])).rejects.toMatchObject({ code: '23514' });
    expect((await db.load('a'))?.revision).toBe(0);
    expect(json((await db.load('a'))?.data)).toEqual(json(data));
    expect(json((await db.load('b'))?.data)).toEqual(json(data));

    await db.save([{ id: 'a', revision: 0, data: changed, before: data }]);
    await expect(db.save([{ id: 'a', revision: 0, data, before: data }])).rejects.toThrow('Profile revision conflict');
    expect(json((await db.load('a'))?.data)).toEqual(json(changed));
  });
});
