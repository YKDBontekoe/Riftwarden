import type { WeaponFamily } from '../data/defs';
import { rarity } from '../loot/rarity';
import type { ItemInstance } from '../loot/types';
import { SOCKET_LABEL, type SocketKind } from './build';

/**
 * Weapon upgrade modules (pure rules). A module item carries its rolled stats; this file
 * only says where it fits (socket kind + weapon families) and how it looks when installed.
 * Effects are ordinary StatModifiers, applied through the weapon item while it is equipped.
 */
export type ModuleVisual = 'collar' | 'fins' | 'chip' | 'capacitor' | 'fork' | 'coil' | 'exchanger' | 'gyro';

export interface ModuleTypeDef {
  type: string;
  name: string;
  socket: SocketKind;
  families: readonly WeaponFamily[];
  visual: ModuleVisual;
  /** One line on what it does (every effect listed is simulated). */
  blurb: string;
  legacy?: boolean;
}

const ALL: readonly WeaponFamily[] = ['plasma', 'rail', 'beam'];

export const MODULE_TYPES: readonly ModuleTypeDef[] = [
  { type: 'amp', name: 'Damage Amplifier', socket: 'power', families: ALL, visual: 'collar', blurb: 'Raises weapon damage.' },
  { type: 'cooling', name: 'Cooling Matrix', socket: 'system', families: ALL, visual: 'fins', blurb: 'Faster cooling and less heat per shot.' },
  { type: 'crit', name: 'Critical Processor', socket: 'system', families: ALL, visual: 'chip', blurb: 'Higher critical chance and critical damage.' },
  { type: 'overcharge', name: 'Overcharge Capacitor', socket: 'power', families: ALL, visual: 'capacitor', blurb: 'Much more damage, at the cost of heat efficiency.' },
  { type: 'splitter', name: 'Projectile Splitter', socket: 'barrel', families: ['plasma'], visual: 'fork', blurb: 'Fires an extra plasma bolt per shot; each bolt is weaker and spread widens.' },
  { type: 'arc', name: 'Arc Conductor', socket: 'barrel', families: ALL, visual: 'coil', blurb: 'Hits can arc to another enemy within 12 m for part of the damage. Slightly more heat.' },
  { type: 'thermal', name: 'Thermal Converter', socket: 'power', families: ALL, visual: 'exchanger', blurb: 'Converts heat into damage: the hotter the weapon, the harder it hits. Slower cooling.' },
  { type: 'stabilizer', name: 'Precision Stabilizer', socket: 'barrel', families: ALL, visual: 'gyro', blurb: 'Less spread and recoil, faster charge/ramp; slightly slower fire rate.' },
  // M2 modules (still installable; their stored affixes apply as rolled)
  { type: 'barrel', name: 'Barrel Insert', socket: 'barrel', families: ALL, visual: 'collar', blurb: 'Early barrel insert: its rolled affixes apply.', legacy: true },
  { type: 'coolant', name: 'Coolant Insert', socket: 'system', families: ALL, visual: 'fins', blurb: 'Early thermal insert: its rolled affixes apply.', legacy: true },
  { type: 'capacitor', name: 'Capacitor Insert', socket: 'power', families: ALL, visual: 'capacitor', blurb: 'Early energy insert: its rolled affixes apply.', legacy: true },
];

const BY_TYPE = new Map(MODULE_TYPES.map((m) => [m.type, m]));

export function moduleTypeDef(type: string | undefined): ModuleTypeDef | undefined {
  return type ? BY_TYPE.get(type) : undefined;
}

export type InstallCheck = { ok: true } | { ok: false; reason: string };

/** Can `module` go into socket `index` of `weapon`? (ownership is checked by the transaction) */
export function canInstall(weapon: ItemInstance | null | undefined, index: number, module: ItemInstance | null | undefined): InstallCheck {
  if (!weapon || weapon.category !== 'weapon' || !weapon.build) return { ok: false, reason: 'Not an engineerable weapon' };
  if (!module || module.category !== 'module' || !module.module) return { ok: false, reason: 'Not an upgrade module' };
  if (!Number.isInteger(index) || index < 0 || index >= weapon.sockets) return { ok: false, reason: 'No such socket' };
  if (weapon.socketed[index]) return { ok: false, reason: 'Socket occupied' };
  if (weapon.socketed.some((m) => m?.uid === module.uid)) return { ok: false, reason: 'Already installed' };
  const def = moduleTypeDef(module.module.type);
  if (!def || !module.module.compatible.includes('weapon')) return { ok: false, reason: 'Module type cannot be installed in weapons' };
  const kind = weapon.build.sockets[index];
  if (def.socket !== kind) return { ok: false, reason: `Needs a ${SOCKET_LABEL[def.socket]} socket (this is ${SOCKET_LABEL[kind]})` };
  if (!def.families.includes(weapon.build.family)) return { ok: false, reason: `Not supported by this weapon family` };
  return { ok: true };
}

/** Salvage charged to pull an installed module back out (installation itself is free). */
export function removalCost(module: Pick<ItemInstance, 'level' | 'rarity'>): number {
  const lvl = Math.max(1, Math.min(1e6, module.level));
  return Math.round((12 + lvl * 1.5) * (1 + rarity(module.rarity).index * 0.6));
}

/** Installed modules of a weapon (non-empty sockets). */
export function installedModules(weapon: ItemInstance | null | undefined): ItemInstance[] {
  return weapon?.socketed?.filter((m): m is ItemInstance => !!m) ?? [];
}
