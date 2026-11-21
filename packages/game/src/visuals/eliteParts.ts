import type { AbstractMesh, Material, Scene, TransformNode } from '@babylonjs/core';
import type { EnemyDef } from '@riftwarden/rules/data/defs';
import type { EliteModId } from '@riftwarden/rules/survival/elites';
import { enemyMats } from './enemyModels';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';

/**
 * Elite modifier hardware, attached to an enemy root and sized from its definition:
 *   Overcharged = twin tesla rods + an orbiting arc ring (blue)
 *   Armored     = bolted slab plating (front, flanks, crown) that falls off when broken
 *   Accelerated = twin thruster pods with flames that flare on boosts
 *   Volatile    = an exposed red critical core inside a cage, pulsing faster as HP drops
 * Built once per pooled enemy object and toggled, so respawns never rebuild geometry.
 */
export interface EliteParts {
  node: TransformNode;
  spin: TransformNode | null;
  flames: AbstractMesh[];
  plates: AbstractMesh[];
  core: AbstractMesh | null;
}

export function buildEliteParts(kit: Kit, P: Palette, parent: TransformNode, def: EnemyDef, mod: EliteModId): EliteParts {
  const M = enemyMats(P.white.getScene(), P);
  const y = def.bodyY;
  const r = def.bodyR;
  const node = kit.node(`elite:${mod}`, parent);
  const out: EliteParts = { node, spin: null, flames: [], plates: [], core: null };
  if (mod === 'overcharged') {
    for (const side of [-1, 1]) {
      kit.part('cyl8', P.metal, node, { pos: [side * r * 0.55, y + r * 0.9, -r * 0.35], rot: [0.25, 0, side * 0.3], scale: [0.09, r * 1.2, 0.09] });
      kit.part('torusThin', M.blue, node, { pos: [side * r * 0.72, y + r * 1.25, -r * 0.25], rot: [0.25, 0, side * 0.3], scale: [0.22, 0.22, 0.22], shadow: false });
      kit.part('sphere', M.blue, node, { pos: [side * r * 0.82, y + r * 1.48, -r * 0.18], scale: [0.18, 0.18, 0.18], shadow: false });
    }
    const spin = kit.node('ocSpin', node, [0, y, 0]);
    kit.part('torusThin', M.blue, spin, { rot: [0.35, 0, 0.2], scale: [r * 2.6, r * 2.6, r * 2.6], shadow: false });
    out.spin = spin;
  } else if (mod === 'armored') {
    const w = r * 1.5;
    out.plates.push(kit.part('box', M.plate, node, { pos: [0, y, r * 0.95], rot: [-0.15, 0, 0], scale: [w, r * 1.1, 0.14] }));
    for (const side of [-1, 1]) out.plates.push(kit.part('box', M.plate, node, { pos: [side * r * 0.95, y + 0.1, 0], rot: [0, 0, side * 0.12], scale: [0.14, r * 0.9, r * 1.3] }));
    out.plates.push(kit.part('box', M.plate, node, { pos: [0, y + r * 0.95, 0], scale: [w * 0.9, 0.12, r * 1.2] }));
    for (const p of [...out.plates]) {
      // rivet strips read as bolted armour
      out.plates.push(kit.part('box', P.graphite, p as unknown as TransformNode, { pos: [0, 0.42, 0.6], scale: [0.9, 0.08, 0.3] }));
    }
  } else if (mod === 'accelerated') {
    for (const side of [-1, 1]) {
      kit.part('cyl', P.graphite, node, { pos: [side * r * 0.6, y + r * 0.2, -r * 1.0], rot: [Math.PI / 2, 0, 0], scale: [0.36, 0.7, 0.36] });
      kit.part('torus', M.amber, node, { pos: [side * r * 0.6, y + r * 0.2, -r * 1.36], rot: [Math.PI / 2, 0, 0], scale: [0.32, 0.32, 0.32], shadow: false });
      out.flames.push(kit.part('cone', M.flame, node, { pos: [side * r * 0.6, y + r * 0.2, -r * 1.75], rot: [-Math.PI / 2, 0, 0], scale: [0.28, 0.7, 0.28], shadow: false }));
    }
    kit.part('box', M.amber, node, { pos: [0, y + r * 0.6, -r * 0.9], scale: [r * 0.9, 0.05, 0.05], shadow: false });
  } else if (mod === 'volatile') {
    const core = kit.part('sphere', M.red, node, { pos: [0, y + r * 0.2, r * 0.75], scale: [0.42, 0.42, 0.42], shadow: false });
    for (let i = 0; i < 3; i++) kit.part('torusThin', P.graphite, node, { pos: [0, y + r * 0.2, r * 0.75], rot: [i * 1.05, i * 0.7, 0], scale: [0.62, 0.62, 0.62] });
    out.core = core;
  } else buildMutationParts(kit, P, node, out, def, mod);
  node.setEnabled(false);
  return out;
}

/** M10 mutation glows (unlit HDR, one material per mutation, cached per scene). */
const MUT_COLORS: Record<Exclude<EliteModId, 'overcharged' | 'armored' | 'accelerated' | 'volatile'>, [number, number, number]> = {
  regenerating: [0.5, 2.6, 0.9],
  splitting: [2.6, 0.8, 2.0],
  shielded: [0.6, 1.7, 3.2],
  blinking: [1.6, 0.9, 3.2],
  frostbound: [1.6, 2.6, 3.2],
  molten: [3.4, 1.0, 0.15],
};
const mutCache = new WeakMap<Scene, Record<string, Material>>();
function mutationMats(P: Palette): Record<keyof typeof MUT_COLORS, Material> {
  const scene = P.white.getScene();
  let m = mutCache.get(scene);
  if (!m) {
    m = {};
    for (const [id, c] of Object.entries(MUT_COLORS)) m[id] = unlit(scene, `mut:${id}`, c);
    m.shieldBubble = unlit(scene, 'mut:shieldBubble', [0.25, 0.7, 1.4], { additive: true });
    mutCache.set(scene, m);
  }
  return m as Record<keyof typeof MUT_COLORS, Material>;
}

/**
 * M10 mutation hardware:
 *   Regenerating = green double ring spinning around the waist   Splitting  = two pink seeds orbiting the body
 *   Shielded     = additive barrier bubble (pulses on hits)       Blinking   = violet crystal + halo above the head
 *   Frostbound   = pale ice spikes on the shoulders              Molten     = glowing slag plates that flicker
 */
function buildMutationParts(kit: Kit, P: Palette, node: TransformNode, out: EliteParts, def: EnemyDef, mod: EliteModId): void {
  const M = mutationMats(P);
  const y = def.bodyY;
  const r = def.bodyR;
  if (mod === 'regenerating') {
    const spin = kit.node('regenSpin', node, [0, y, 0]);
    for (const tilt of [0.35, -0.35]) kit.part('torusThin', M.regenerating, spin, { rot: [tilt, 0, tilt * 0.5], scale: [r * 2.3, r * 2.3, r * 2.3], shadow: false });
    out.spin = spin;
  } else if (mod === 'splitting') {
    const spin = kit.node('splitSpin', node, [0, y + r * 0.3, 0]);
    for (const side of [-1, 1]) kit.part('ico', M.splitting, spin, { pos: [side * r * 1.15, 0, 0], scale: [0.26, 0.34, 0.26], shadow: false });
    out.spin = spin;
  } else if (mod === 'shielded') {
    out.core = kit.part('sphere', (M as unknown as Record<string, Material>).shieldBubble, node, { pos: [0, y, 0], scale: [r * 2.7, r * 2.9, r * 2.7], shadow: false });
  } else if (mod === 'blinking') {
    const spin = kit.node('blinkSpin', node, [0, def.topY - 0.3, 0]);
    kit.part('ico', M.blinking, spin, { scale: [0.22, 0.42, 0.22], shadow: false });
    kit.part('torusThin', M.blinking, spin, { rot: [Math.PI / 2, 0, 0], scale: [0.7, 0.7, 0.7], shadow: false });
    out.spin = spin;
  } else if (mod === 'frostbound') {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        kit.part('cone', M.frostbound, node, { pos: [side * r * (0.55 + i * 0.12), y + r * (0.75 + i * 0.08), -r * 0.2 + i * 0.15], rot: [-0.3 + i * 0.2, 0, side * (0.5 + i * 0.25)], scale: [0.12, 0.42 - i * 0.08, 0.12], shadow: false });
      }
    }
  } else if (mod === 'molten') {
    for (const [px, py, pz] of [[0, 0.1, 0.92], [0.9, 0.3, 0], [-0.9, -0.1, 0.1], [0, 0.85, -0.3]]) {
      out.flames.push(kit.part('box', M.molten, node, { pos: [px * r, y + py * r, pz * r], rot: [0.2 * px, 0.4 * pz, 0.3 * py], scale: [0.34, 0.08, 0.26], shadow: false }));
    }
  }
}

/** Floating threat marker: a gold diamond for elites (pips in modifier colours), a teal cross for support units. */
export interface ThreatMark {
  node: TransformNode;
  pips: Map<EliteModId, AbstractMesh>;
  support: TransformNode;
  diamond: AbstractMesh;
  buff: AbstractMesh;
}

export function buildThreatMark(kit: Kit, P: Palette, parent: TransformNode, def: EnemyDef): ThreatMark {
  const M = enemyMats(P.white.getScene(), P);
  const node = kit.node('threatMark', parent, [0, def.topY + 0.15, 0]);
  const diamond = kit.part('ico', P.orangeGlow, node, { scale: [0.3, 0.46, 0.3], shadow: false });
  const pips = new Map<EliteModId, AbstractMesh>();
  const mats: Record<EliteModId, Material> = { overcharged: M.blue, armored: P.whiteGlow, accelerated: M.amber, volatile: M.red, ...mutationMats(P) };
  const ids = Object.keys(mats) as EliteModId[];
  ids.forEach((id, i) => {
    const a = (i / ids.length) * Math.PI * 2;
    pips.set(id, kit.part('sphere', mats[id], node, { pos: [Math.sin(a) * 0.42, 0, Math.cos(a) * 0.42], scale: [0.16, 0.16, 0.16], shadow: false }));
  });
  const support = kit.node('supportMark', node, [0, 0.1, 0]);
  kit.part('box', M.support, support, { scale: [0.5, 0.14, 0.14], shadow: false });
  kit.part('box', M.support, support, { scale: [0.14, 0.5, 0.14], shadow: false });
  const buff = kit.part('torusThin', M.support, parent, { pos: [0, def.bodyY, 0], scale: [def.bodyR * 2.6, def.bodyR * 2.6, def.bodyR * 2.6], shadow: false });
  buff.setEnabled(false);
  node.setEnabled(false);
  return { node, pips, support, diamond, buff };
}
