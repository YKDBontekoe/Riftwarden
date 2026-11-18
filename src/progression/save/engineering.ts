import { type ItemInstance, isSlotId } from '../items';
import { canInstall, removalCost } from '../../weapons/modules';
import { SaveData } from './types';
import { itemByUid, slotOf } from './ownership';

// ------------------------------------------------------------------ weapon engineering (M3)

export type EngineeringResult = { ok: true; cost: number } | { ok: false; reason: string };

/** An owned weapon (equipped or stored). Engineering never touches run cargo. */
function ownedWeapon(data: SaveData, uid: string): ItemInstance | null {
  const it = itemByUid(data, uid);
  return it && it.category === 'weapon' && (data.storage.uids.includes(uid) || slotOf(data, uid)) ? it : null;
}

/**
 * Install a stored module into a socket of an owned weapon (HQ only, free). The module
 * leaves storage and the item list and lives inside the weapon from then on. Everything
 * is validated before anything changes.
 */
export function installModule(data: SaveData, weaponUid: string, socket: number, moduleUid: string): EngineeringResult {
  if (data.activeRun) return { ok: false, reason: 'Engineering is only available at HQ between runs' };
  const weapon = ownedWeapon(data, weaponUid);
  if (!weapon) return { ok: false, reason: 'Weapon not owned' };
  const mi = data.storage.uids.indexOf(moduleUid);
  const module = itemByUid(data, moduleUid);
  if (mi < 0 || !module) return { ok: false, reason: 'Module not in storage' };
  const check = canInstall(weapon, socket, module);
  if (!check.ok) return check;
  data.storage.uids.splice(mi, 1);
  data.items = data.items.filter((i) => i.uid !== moduleUid);
  weapon.socketed[socket] = module;
  return { ok: true, cost: 0 };
}

/** Salvage cost of removing the module in a socket (null when the socket is empty). */
export function moduleRemovalCost(data: SaveData, weaponUid: string, socket: number): number | null {
  const m = itemByUid(data, weaponUid)?.socketed?.[socket];
  return m ? removalCost(m) : null;
}

/** Pull an installed module back into storage for salvage (needs a free storage bay). */
export function uninstallModule(data: SaveData, weaponUid: string, socket: number): EngineeringResult {
  if (data.activeRun) return { ok: false, reason: 'Engineering is only available at HQ between runs' };
  const weapon = ownedWeapon(data, weaponUid);
  const m = weapon?.socketed?.[socket];
  if (!weapon || !m) return { ok: false, reason: 'Socket is empty' };
  const cost = removalCost(m);
  if (data.resources.salvage < cost) return { ok: false, reason: `Needs ${cost} salvage` };
  if (data.storage.uids.length >= data.storage.capacity) return { ok: false, reason: 'Storage full' };
  if (data.items.some((i) => i.uid === m.uid)) return { ok: false, reason: 'Duplicate module id' };
  data.resources.salvage -= cost;
  weapon.socketed[socket] = null;
  data.items.push(m);
  data.storage.uids.push(m.uid);
  return { ok: true, cost };
}

/**
 * Move an installed module straight into a socket of another (or the same) owned weapon.
 * Costs the same as a removal; needs no free storage bay. Validated before any change.
 */
export function transferModule(data: SaveData, fromUid: string, fromSocket: number, toUid: string, toSocket: number): EngineeringResult {
  if (data.activeRun) return { ok: false, reason: 'Engineering is only available at HQ between runs' };
  const from = ownedWeapon(data, fromUid);
  const to = ownedWeapon(data, toUid);
  const m = from?.socketed?.[fromSocket];
  if (!from || !to || !m) return { ok: false, reason: 'Nothing to transfer' };
  if (from === to && fromSocket === toSocket) return { ok: false, reason: 'Same socket' };
  // Check against the target as if the module had already left its socket.
  const probe: ItemInstance = { ...to, socketed: to.socketed.map((x) => (x?.uid === m.uid ? null : x)) };
  const check = canInstall(probe, toSocket, m);
  if (!check.ok) return check;
  const cost = removalCost(m);
  if (data.resources.salvage < cost) return { ok: false, reason: `Needs ${cost} salvage` };
  data.resources.salvage -= cost;
  from.socketed[fromSocket] = null;
  to.socketed[toSocket] = m;
  return { ok: true, cost };
}

export { isSlotId };

