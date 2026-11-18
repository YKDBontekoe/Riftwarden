import type { AbstractMesh, Material, TransformNode } from '@babylonjs/core';
import { BASES, CORES, MODIFIERS, type TowerConfig, WEAPONS } from '../towers/components';
import type { Kit } from './kit';
import type { Palette } from './materials';
import type { TurretRig } from './models';

/**
 * Procedural modular tower models. One builder composes base pedestal + weapon head + core glow +
 * modifier attachment from the same instanced unit-primitive kit, so a refit visibly changes the tower
 * (different barrels/coils/crystals, core colour, antennas/drums/optics/dishes) without any extra materials.
 */
export function buildTowerRig(kit: Kit, P: Palette, cfg: TowerConfig, level = 1, unique?: Material): TurretRig {
  const base = BASES[cfg.base] ?? BASES.standard;
  const weapon = WEAPONS[cfg.weapon] ?? WEAPONS.autocannon;
  const core = CORES[cfg.core] ?? CORES.standard_core;
  const mod = MODIFIERS[cfg.modifier] ?? MODIFIERS.none;
  const u = unique;
  const part = (shape: Parameters<Kit['part']>[0], mat: Material, parent: TransformNode, o: Parameters<Kit['part']>[3]) => kit.part(shape, mat, parent, o, u);

  const accent = core.id === 'standard_core' ? (weapon.archetype === 'cryo' ? P.whiteGlow : P.cyanGlow) : core.id === 'overcharged' || core.id === 'thermal_core' ? P.orangeGlow : core.id === 'cryo_core' ? P.whiteGlow : P.cyanGlow;
  const root = kit.node('tower', null);

  // ---- base pedestal
  if (base.look === 'standard') {
    part('cyl6', P.graphite, root, { pos: [0, 0.18, 0], scale: [2.1, 0.36, 2.1] });
    part('cyl6', P.white, root, { pos: [0, 0.45, 0], scale: [1.7, 0.22, 1.7] });
    part('torus', P.cyanGlow, root, { pos: [0, 0.37, 0], scale: [1.95, 1.0, 1.95] });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      part('box', P.graphite, root, { pos: [Math.sin(a) * 0.95, 0.25, Math.cos(a) * 0.95], rot: [0, a, 0], scale: [0.3, 0.4, 0.7] });
    }
    part('cyl', P.metal, root, { pos: [0, 0.85, 0], scale: [0.5, 0.7, 0.5] });
  } else if (base.look === 'bastion') {
    part('cyl8', P.graphite, root, { pos: [0, 0.22, 0], scale: [2.6, 0.44, 2.6] });
    part('cyl8', P.white, root, { pos: [0, 0.55, 0], scale: [2.1, 0.3, 2.1] });
    part('torus', accent, root, { pos: [0, 0.45, 0], scale: [2.4, 1.0, 2.4] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      part('box', P.graphite, root, { pos: [Math.sin(a) * 1.15, 0.45, Math.cos(a) * 1.15], rot: [0, a, 0], scale: [0.5, 0.7, 0.5] });
    }
    part('cyl', P.metal, root, { pos: [0, 0.95, 0], scale: [0.8, 0.5, 0.8] });
  } else {
    part('cyl6', P.graphite, root, { pos: [0, 0.14, 0], scale: [1.8, 0.28, 1.8] });
    part('torus', P.cyanGlow, root, { pos: [0, 0.3, 0], scale: [1.6, 1.0, 1.6] });
    part('cyl', P.white, root, { pos: [0, 0.9, 0], scale: [0.42, 1.2, 0.42] });
    part('cyl', P.metal, root, { pos: [0, 1.55, 0], scale: [0.3, 0.3, 0.3] });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      part('box', P.graphite, root, { pos: [Math.sin(a) * 0.5, 0.7, Math.cos(a) * 0.5], rot: [0.35 * Math.cos(a), a, -0.35 * Math.sin(a)], scale: [0.08, 1.3, 0.08] });
    }
  }
  // Level pips on the pedestal rim.
  for (let i = 1; i < level; i++) {
    const a = ((i - 1) / 4) * Math.PI * 0.8 - Math.PI * 0.4;
    part('box', accent, root, { pos: [Math.sin(a) * base.radius * 0.95, 0.5, -Math.cos(a) * base.radius * 0.95], rot: [0, a, 0], scale: [0.14, 0.1, 0.1], shadow: false });
  }

  const lift = base.look === 'spire' ? 1.1 : base.look === 'bastion' ? 0.1 : 0;
  const yaw = kit.node('tYaw', root, [0, 1.25 + lift, 0]);
  const pitch = kit.node('tPitch', yaw, [0, 0.1, 0.3]);
  const muzzles: TransformNode[] = [];
  let coreGlow!: AbstractMesh;

  if (weapon.archetype === 'ballistic') {
    part('box', P.white, yaw, { pos: [0, 0.12, -0.05], scale: [0.95, 0.55, 1.05] });
    part('box', P.graphite, yaw, { pos: [0, 0.42, -0.15], scale: [0.7, 0.1, 0.7] });
    for (const side of [-1, 1]) part('box', P.graphite, yaw, { pos: [side * 0.52, 0.1, -0.05], scale: [0.12, 0.42, 0.9] });
    part('box', accent, yaw, { pos: [0, 0.22, 0.48], scale: [0.6, 0.07, 0.04] });
    coreGlow = part('cyl', accent, yaw, { pos: [0, 0.12, -0.6], rot: [Math.PI / 2, 0, 0], scale: [0.35, 0.12, 0.35] });
    if (weapon.id === 'marksman') {
      part('cyl', P.graphite, pitch, { pos: [0, 0, 0.9], rot: [Math.PI / 2, 0, 0], scale: [0.14, 1.9, 0.14] });
      part('cyl', P.metal, pitch, { pos: [0, 0, 0.3], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.6, 0.3] });
      part('torusThin', accent, pitch, { pos: [0, 0, 1.75], rot: [Math.PI / 2, 0, 0], scale: [0.24, 0.24, 0.24] });
      part('torusThin', accent, pitch, { pos: [0, 0, 1.3], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.2, 0.2] });
      muzzles.push(kit.node('muzzle', pitch, [0, 0, 1.95]));
    } else {
      for (const side of [-1, 1]) {
        part('cyl', P.graphite, pitch, { pos: [side * 0.22, 0, 0.55], rot: [Math.PI / 2, 0, 0], scale: [0.16, 1.15, 0.16] });
        part('cyl', P.metal, pitch, { pos: [side * 0.22, 0, 0.25], rot: [Math.PI / 2, 0, 0], scale: [0.24, 0.4, 0.24] });
        part('torusThin', accent, pitch, { pos: [side * 0.22, 0, 1.12], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.2, 0.2] });
        muzzles.push(kit.node('muzzle', pitch, [side * 0.22, 0, 1.2]));
      }
    }
  } else if (weapon.archetype === 'arc') {
    part('box', P.white, yaw, { pos: [0, 0.1, -0.1], scale: [0.9, 0.5, 0.9] });
    for (const side of [-1, 1]) part('box', P.graphite, yaw, { pos: [side * 0.5, 0.1, -0.05], scale: [0.12, 0.42, 0.9] });
    coreGlow = part('cyl', accent, yaw, { pos: [0, 0.12, -0.62], rot: [Math.PI / 2, 0, 0], scale: [0.35, 0.12, 0.35] });
    // Coil stack on the barrel axis with a charged emitter globe at the tip.
    part('cyl', P.graphite, pitch, { pos: [0, 0, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.2, 1.1, 0.2] });
    for (let i = 0; i < 3; i++) part('torusThin', accent, pitch, { pos: [0, 0, 0.2 + i * 0.32], rot: [Math.PI / 2, 0, 0], scale: [0.62 - i * 0.08, 0.62 - i * 0.08, 0.62 - i * 0.08] });
    for (const side of [-1, 1]) part('box', P.metal, pitch, { pos: [side * 0.26, 0.05, 1.15], rot: [0, side * 0.35, 0], scale: [0.05, 0.05, 0.55] });
    part('sphere', P.whiteGlow, pitch, { pos: [0, 0, 1.25], scale: [0.3, 0.3, 0.3], shadow: false });
    muzzles.push(kit.node('muzzle', pitch, [0, 0, 1.3]));
  } else if (weapon.archetype === 'missile') {
    // Missile battery: armoured launcher box, 2x2 tube grid with glowing caps, side loaders.
    part('box', P.graphite, yaw, { pos: [0, 0.1, -0.15], scale: [1.05, 0.45, 1.0] });
    for (const side of [-1, 1]) part('box', P.white, yaw, { pos: [side * 0.6, 0.25, -0.1], scale: [0.14, 0.8, 0.9] });
    coreGlow = part('cyl', accent, yaw, { pos: [0, 0.12, -0.7], rot: [Math.PI / 2, 0, 0], scale: [0.32, 0.1, 0.32] });
    part('box', P.white, pitch, { pos: [0, 0.18, 0.25], scale: [1.0, 0.72, 0.95] });
    part('box', P.graphite, pitch, { pos: [0, 0.18, 0.72], scale: [0.92, 0.64, 0.04] });
    for (const x of [-0.24, 0.24]) {
      for (const y of [0.0, 0.36]) {
        part('cyl8', P.metal, pitch, { pos: [x, y, 0.55], rot: [Math.PI / 2, 0, 0], scale: [0.28, 0.42, 0.28] });
        part('cyl8', P.orangeGlow, pitch, { pos: [x, y, 0.76], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.02, 0.2], shadow: false });
        muzzles.push(kit.node('muzzle', pitch, [x, y, 0.82]));
      }
    }
    part('box', accent, pitch, { pos: [0, 0.56, 0.3], scale: [0.7, 0.04, 0.6], shadow: false });
  } else if (weapon.archetype === 'support') {
    // Support amplifier: slim mast, counter-rotating field rings, emitter crown.
    part('cyl', P.white, yaw, { pos: [0, 0.2, 0], scale: [0.8, 0.4, 0.8] });
    part('cyl', P.graphite, yaw, { pos: [0, 0.9, 0], scale: [0.26, 1.4, 0.26] });
    coreGlow = part('sphere', P.cyanGlow, yaw, { pos: [0, 1.75, 0], scale: [0.42, 0.42, 0.42], shadow: false });
    part('torus', P.white, yaw, { pos: [0, 0.6, 0], scale: [1.3, 1, 1.3] });
    part('torusThin', P.cyanGlow, pitch, { pos: [0, 0.9, -0.3], rot: [0.35, 0, 0.2], scale: [1.5, 1, 1.5], shadow: false });
    part('torusThin', P.cyanGlow, pitch, { pos: [0, 1.25, -0.3], rot: [-0.3, 0, -0.25], scale: [1.1, 1, 1.1], shadow: false });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      part('box', P.metal, yaw, { pos: [Math.sin(a) * 0.32, 1.6, Math.cos(a) * 0.32], rot: [Math.cos(a) * 0.4, a, -Math.sin(a) * 0.4], scale: [0.06, 0.5, 0.06] });
    }
    muzzles.push(kit.node('muzzle', yaw, [0, 1.75, 0]));
  } else {
    // Cryogenic field projector: dome, crystal array, orbiting emitter ring.
    part('cyl', P.white, yaw, { pos: [0, 0.1, 0], scale: [1.1, 0.5, 1.1] });
    part('sphere', P.panel, yaw, { pos: [0, 0.4, 0], scale: [1.0, 0.7, 1.0] });
    coreGlow = part('sphere', accent, yaw, { pos: [0, 0.62, 0], scale: [0.45, 0.45, 0.45], shadow: false });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part('cone', P.whiteGlow, yaw, { pos: [Math.sin(a) * 0.5, 0.55, Math.cos(a) * 0.5], rot: [Math.cos(a) * 0.5, a, -Math.sin(a) * 0.5], scale: [0.16, 0.7, 0.16], shadow: false });
    }
    part('torusThin', P.whiteGlow, yaw, { pos: [0, 0.2, 0], scale: [1.9, 1, 1.9], shadow: false });
    muzzles.push(kit.node('muzzle', yaw, [0, 0.9, 0]));
  }

  // ---- modifier attachment
  const top = weapon.archetype === 'cryo' ? yaw : pitch;
  switch (mod.look) {
    case 'array':
      for (let i = -1; i <= 1; i++) part('cyl', P.metal, yaw, { pos: [i * 0.22, 0.72, -0.25], scale: [0.04, 0.5 + (i === 0 ? 0.25 : 0), 0.04] });
      part('sphere', accent, yaw, { pos: [0, 1.12, -0.25], scale: [0.1, 0.1, 0.1], shadow: false });
      break;
    case 'shells':
      part('cyl', P.graphite, yaw, { pos: [0.65, 0.2, -0.2], rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.7, 0.42] });
      part('torusThin', P.orangeGlow, yaw, { pos: [0.65, 0.2, 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.4, 0.4, 0.4], shadow: false });
      break;
    case 'optics':
      part('cyl', P.graphite, top, { pos: [0, 0.22, 0.4], rot: [Math.PI / 2, 0, 0], scale: [0.16, 0.7, 0.16] });
      part('cyl', P.whiteGlow, top, { pos: [0, 0.22, 0.76], rot: [Math.PI / 2, 0, 0], scale: [0.12, 0.04, 0.12], shadow: false });
      break;
    case 'dish':
      part('cone', P.white, yaw, { pos: [0, 0.82, -0.3], rot: [Math.PI, 0, 0], scale: [0.7, 0.28, 0.7] });
      part('cyl', P.metal, yaw, { pos: [0, 0.6, -0.3], scale: [0.06, 0.4, 0.06] });
      break;
    case 'lens':
      part('torusThin', P.whiteGlow, yaw, { pos: [0, 1.15, 0], rot: [0.5, 0, 0.3], scale: [0.9, 1, 0.9], shadow: false });
      part('ico', P.whiteGlow, yaw, { pos: [0, 1.15, 0], scale: [0.22, 0.22, 0.22], shadow: false });
      break;
    default:
  }
  return { root, yaw, pitch, muzzles, coreGlow };
}
