import type { AbstractMesh, Material, TransformNode } from '@babylonjs/core';
import { BASES, CORES, MODIFIERS, type TowerConfig, WEAPONS } from '../towers/components';
import type { Kit } from './kit';
import type { Palette } from './materials';
import type { TurretRig } from './models';
import { loftData, type LoftAxis, type Section, smoothLatheData } from './sculpt';

/**
 * Procedural modular tower models. One builder composes base pedestal + weapon head + core glow +
 * modifier attachment from the same instanced unit-primitive kit, so a refit visibly changes the tower
 * (different barrels/coils/crystals, core colour, antennas/drums/optics/dishes) without any extra materials.
 */
/** Sculpted tower parts (registered once per kit). */
function towerShapes(kit: Kit) {
  const L = (name: string, secs: Section[], axis: LoftAxis = 'z', segs = 28) => kit.sculpt(name, () => loftData(secs, axis, segs));
  const T = (name: string, prof: [number, number][], tess = 28) => kit.sculpt(name, () => smoothLatheData(prof, tess));
  return {
    baseStd: T('tBaseStd', [[1.08, 0], [1.08, 0.1], [1.0, 0.2], [0.92, 0.26], [0.88, 0.4], [0.74, 0.5], [0.42, 0.56], [0.3, 0.62], [0.26, 1.15], [0.34, 1.22], [0.3, 1.26]], 36),
    baseBastion: L('tBaseBastion', [{ t: 0, w: 1.32, h: 1.32, n: 7 }, { t: 0.2, w: 1.3, h: 1.3, n: 7 }, { t: 0.38, w: 1.16, h: 1.16, n: 6 }, { t: 0.6, w: 1.0, h: 1.0, n: 5 }, { t: 0.7, w: 0.62, h: 0.62, n: 3 }, { t: 1.2, w: 0.46, h: 0.46, n: 2.5 }], 'y', 40),
    baseSpire: T('tBaseSpire', [[0.92, 0], [0.92, 0.08], [0.78, 0.22], [0.36, 0.34], [0.24, 0.6], [0.2, 1.5], [0.27, 1.62], [0.3, 1.78], [0.22, 1.84]], 32),
    foot: L('tFoot', [{ t: -0.36, w: 0.1, h: 0.08 }, { t: -0.2, w: 0.15, h: 0.18, v: 0.04, n: 5 }, { t: 0.3, w: 0.16, h: 0.22, v: 0.06, n: 5 }, { t: 0.38, w: 0.1, h: 0.12, v: 0.04 }]),
    head: L('tHead', [{ t: -0.62, w: 0.3, h: 0.2 }, { t: -0.48, w: 0.47, h: 0.3, n: 5 }, { t: 0.28, w: 0.48, h: 0.31, v: 0.02, n: 5 }, { t: 0.5, w: 0.36, h: 0.2, v: -0.02, n: 4 }, { t: 0.56, w: 0.24, h: 0.12, v: -0.03, n: 3 }], 'z', 32),
    shield: L('tShield', [
      { t: -0.64, w: 0.28, h: 0.092 }, { t: -0.50, w: 0.48, h: 0.145, v: 0.026 },
      { t: -0.24, w: 0.54, h: 0.151, v: 0.048, n: 5 }, { t: 0.11, w: 0.52, h: 0.106, v: 0.07, n: 5 },
      { t: 0.45, w: 0.40, h: 0.068, v: 0.105, n: 4 }, { t: 0.53, w: 0.27, h: 0.043, v: 0.126 },
    ], 'z', 28),
    cheek: L('tCheek', [{ t: -0.5, w: 0.06, h: 0.12 }, { t: -0.35, w: 0.08, h: 0.22, n: 5 }, { t: 0.3, w: 0.08, h: 0.2, n: 5 }, { t: 0.42, w: 0.05, h: 0.1 }], 'z', 16),
    bearing: T('tBearing', [[0.2, -0.11], [0.23, -0.075], [0.23, 0.03], [0.19, 0.072], [0.126, 0.072], [0.115, 0.05]], 24),
    barrel: T('tBarrel', [[0.103, -0.6], [0.13, -0.55], [0.13, -0.38], [0.09, -0.32], [0.082, 0.35], [0.112, 0.45], [0.112, 0.55], [0.094, 0.60], [0.061, 0.60], [0.052, 0.48]], 20),
    breech: T('tBreech', [[0.1, -0.22], [0.14, -0.18], [0.14, 0.16], [0.1, 0.2]], 18),
    longBarrel: T('tLongBarrel', [[0.08, -0.95], [0.1, -0.9], [0.1, -0.5], [0.07, -0.45], [0.06, 0.8], [0.085, 0.85], [0.085, 0.95], [0.06, 0.98]], 18),
    coil: T('tCoil', [[0.1, -0.55], [0.12, -0.5], [0.12, 0.5], [0.16, 0.55], [0.1, 0.6]], 18),
    launcher: L('tLauncher', [{ t: -0.3, w: 0.46, h: 0.32, n: 6 }, { t: -0.22, w: 0.52, h: 0.38, n: 7 }, { t: 0.36, w: 0.52, h: 0.38, n: 7 }, { t: 0.46, w: 0.47, h: 0.34, n: 6 }], 'z', 32),
    tube: T('tTube', [[0.11, -0.2], [0.14, -0.17], [0.14, 0.2], [0.12, 0.22]], 16),
    mast: T('tMast', [[0.42, 0], [0.42, 0.1], [0.3, 0.22], [0.14, 0.4], [0.12, 1.5], [0.18, 1.58], [0.12, 1.66]], 24),
    dome: T('tDome', [[0.56, 0], [0.56, 0.06], [0.5, 0.2], [0.38, 0.38], [0.2, 0.5], [0.0, 0.54]], 32),
    hub: T('tHub', [[0.42, 0], [0.5, 0.06], [0.5, 0.3], [0.42, 0.36]], 28),
  };
}

export function buildTowerRig(kit: Kit, P: Palette, cfg: TowerConfig, level = 1, unique?: Material): TurretRig {
  const base = BASES[cfg.base] ?? BASES.standard;
  const weapon = WEAPONS[cfg.weapon] ?? WEAPONS.autocannon;
  const core = CORES[cfg.core] ?? CORES.standard_core;
  const mod = MODIFIERS[cfg.modifier] ?? MODIFIERS.none;
  const u = unique;
  const part = (shape: Parameters<Kit['part']>[0], mat: Material, parent: TransformNode, o: Parameters<Kit['part']>[3]) => kit.part(shape, mat, parent, o, u);

  const accent = core.id === 'standard_core' ? (weapon.archetype === 'cryo' ? P.whiteGlow : P.cyanGlow) : core.id === 'overcharged' || core.id === 'thermal_core' ? P.orangeGlow : core.id === 'cryo_core' ? P.whiteGlow : P.cyanGlow;
  const root = kit.node('tower', null);
  const S = towerShapes(kit);
  const HP = Math.PI / 2;

  // ---- base pedestal
  if (base.look === 'standard') {
    part(S.baseStd, P.graphite, root, {});
    part(S.hub, P.white, root, { pos: [0, 0.3, 0], scale: [1.6, 0.6, 1.6] });
    part('torusThin', accent, root, { pos: [0, 0.26, 0], scale: [1.98, 0.68, 1.98], shadow: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const x = Math.sin(a), z = Math.cos(a);
      part(S.foot, P.graphite, root, { pos: [x * 0.98, 0.05, z * 0.98], rot: [0, a, 0] });
      part(S.foot, P.metal, root, { pos: [x * 1.1, 0.218, z * 1.1], rot: [0, a, 0], scale: [0.8, 0.36, 0.64] });
      part('cyl6', P.graphite, root, { pos: [x * 1.24, 0.276, z * 1.24], scale: [0.13, 0.071, 0.13] });
    }
  } else if (base.look === 'bastion') {
    part(S.baseBastion, P.graphite, root, {});
    part(S.hub, P.white, root, { pos: [0, 0.42, 0], scale: [2.0, 0.7, 2.0] });
    part('torus', accent, root, { pos: [0, 0.4, 0], scale: [2.5, 1.0, 2.5] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      part(S.foot, P.graphite, root, { pos: [Math.sin(a) * 1.2, 0.08, Math.cos(a) * 1.2], rot: [0, a, 0], scale: [1.4, 1.4, 1.2] });
      part(S.foot, P.metal, root, { pos: [Math.sin(a) * 1.24, 0.33, Math.cos(a) * 1.24], rot: [0, a, 0], scale: [1.08, 0.45, 1] });
    }
  } else {
    part(S.baseSpire, P.white, root, {});
    part('torus', P.cyanGlow, root, { pos: [0, 0.24, 0], scale: [1.6, 1.0, 1.6] });
    part(S.hub, P.graphite, root, { pos: [0, 0.96, 0], scale: [0.6, 1.25, 0.6] });
    part('torusThin', accent, root, { pos: [0, 1.27, 0], scale: [0.58, 0.58, 0.58], shadow: false });
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
    part(S.head, P.graphite, yaw, { pos: [0, 0.046, -0.06], scale: [1, 0.76, 1] });
    part(S.shield, P.white, yaw, { pos: [0, 0.269, -0.04] });
    part(S.hub, P.metal, yaw, { pos: [0, -0.24, -0.05], scale: [0.9, 0.5, 0.9] });
    for (const side of [-1, 1]) {
      part(S.cheek, P.panel, yaw, { pos: [side * 0.42, 0.078, -0.04] });
      part(S.bearing, P.metal, pitch, { pos: [side * 0.41, 0, -0.03], rot: [0, 0, side * -HP] });
      part('box', accent, yaw, { pos: [side * 0.195, 0.27, 0.471], scale: [0.12, 0.023, 0.019], shadow: false });
      part('cyl6', P.graphite, pitch, { pos: [side * 0.489, 0, -0.03], rot: [0, 0, HP], scale: [0.22, 0.082, 0.22] });
    }
    part(S.bearing, P.metal, yaw, { pos: [0, 0.12, -0.64], rot: [-HP, 0, 0], scale: [0.72, 0.53, 0.72] });
    coreGlow = part('cyl', accent, yaw, { pos: [0, 0.12, -0.681], rot: [HP, 0, 0], scale: [0.17, 0.022, 0.17], shadow: false });
    if (weapon.id === 'marksman') {
      part(S.longBarrel, P.graphite, pitch, { pos: [0, 0, 0.9], rot: [HP, 0, 0] });
      part(S.breech, P.metal, pitch, { pos: [0, 0, 0.3], rot: [HP, 0, 0], scale: [1.1, 1.3, 1.1] });
      part('torusThin', accent, pitch, { pos: [0, 0, 1.75], rot: [Math.PI / 2, 0, 0], scale: [0.24, 0.24, 0.24] });
      part('torusThin', accent, pitch, { pos: [0, 0, 1.3], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.2, 0.2] });
      muzzles.push(kit.node('muzzle', pitch, [0, 0, 1.95]));
    } else {
      for (const side of [-1, 1]) {
        part(S.barrel, P.metal, pitch, { pos: [side * 0.22, 0, 0.55], rot: [HP, 0, 0] });
        part(S.breech, P.graphite, pitch, { pos: [side * 0.22, 0, 0.34], rot: [HP, 0, 0] });
        part('torusThin', accent, pitch, { pos: [side * 0.22, 0, 1.092], rot: [HP, 0, 0], scale: [0.22, 0.11, 0.22], shadow: false });
        muzzles.push(kit.node('muzzle', pitch, [side * 0.22, 0, 1.2]));
      }
    }
  } else if (weapon.archetype === 'arc') {
    part(S.head, P.white, yaw, { pos: [0, 0.1, -0.1], scale: [0.92, 0.92, 0.85] });
    part(S.hub, P.graphite, yaw, { pos: [0, -0.24, -0.05], scale: [0.9, 0.5, 0.9] });
    for (const side of [-1, 1]) part(S.cheek, P.graphite, yaw, { pos: [side * 0.47, 0.1, -0.05] });
    coreGlow = part('cyl', accent, yaw, { pos: [0, 0.12, -0.62], rot: [Math.PI / 2, 0, 0], scale: [0.35, 0.12, 0.35] });
    // Coil stack on the barrel axis with a charged emitter globe at the tip.
    part(S.coil, P.graphite, pitch, { pos: [0, 0, 0.6], rot: [HP, 0, 0] });
    for (let i = 0; i < 3; i++) part('torusThin', accent, pitch, { pos: [0, 0, 0.2 + i * 0.32], rot: [Math.PI / 2, 0, 0], scale: [0.62 - i * 0.08, 0.62 - i * 0.08, 0.62 - i * 0.08] });
    for (const side of [-1, 1]) part(S.cheek, P.metal, pitch, { pos: [side * 0.28, 0.03, 0.54], rot: [0, -side * 0.12, 0], scale: [0.58, 0.46, 1] });
    for (const side of [-1, 1]) part('box', P.metal, pitch, { pos: [side * 0.26, 0.05, 1.15], rot: [0, side * 0.35, 0], scale: [0.05, 0.05, 0.55] });
    part('sphere', P.whiteGlow, pitch, { pos: [0, 0, 1.25], scale: [0.3, 0.3, 0.3], shadow: false });
    muzzles.push(kit.node('muzzle', pitch, [0, 0, 1.3]));
  } else if (weapon.archetype === 'missile') {
    // Missile battery: armoured launcher box, 2x2 tube grid with glowing caps, side loaders.
    part(S.hub, P.graphite, yaw, { pos: [0, -0.15, -0.15], scale: [1.1, 0.7, 1.1] });
    for (const side of [-1, 1]) part(S.cheek, P.white, yaw, { pos: [side * 0.6, 0.25, -0.1], scale: [1.4, 1.8, 1] });
    coreGlow = part('cyl', accent, yaw, { pos: [0, 0.12, -0.7], rot: [Math.PI / 2, 0, 0], scale: [0.32, 0.1, 0.32] });
    part(S.launcher, P.white, pitch, { pos: [0, 0.18, 0.25] });
    for (const side of [-1, 1]) part('box', P.panel, pitch, { pos: [side * 0.525, 0.16, 0.24], scale: [0.074, 0.27, 0.48] });
    part('box', P.graphite, pitch, { pos: [0, 0.18, 0.71], scale: [0.86, 0.6, 0.03] });
    for (const x of [-0.24, 0.24]) {
      for (const y of [0.0, 0.36]) {
        part(S.tube, P.metal, pitch, { pos: [x, y, 0.55], rot: [HP, 0, 0] });
        part('cyl8', P.orangeGlow, pitch, { pos: [x, y, 0.76], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.02, 0.2], shadow: false });
        muzzles.push(kit.node('muzzle', pitch, [x, y, 0.82]));
      }
    }
    part('box', accent, pitch, { pos: [0, 0.56, 0.3], scale: [0.7, 0.04, 0.6], shadow: false });
  } else if (weapon.archetype === 'support') {
    // Support amplifier: slim mast, counter-rotating field rings, emitter crown.
    part(S.mast, P.white, yaw, { pos: [0, 0, 0] });
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
    part(S.hub, P.white, yaw, { pos: [0, -0.1, 0], scale: [1.2, 0.8, 1.2] });
    part(S.dome, P.panel, yaw, { pos: [0, 0.2, 0] });
    part('torus', P.metal, yaw, { pos: [0, 0.22, 0], scale: [1.22, 0.55, 1.22] });
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
