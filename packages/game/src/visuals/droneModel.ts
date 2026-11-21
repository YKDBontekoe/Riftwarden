import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';
import { loftData, type Section, smoothLatheData } from './sculpt';

/** Team colours per lobby slot (HUD, name tags, drone accents). */
export const SLOT_COLORS: readonly [number, number, number][] = [
  [0.3, 1.6, 2.2], // cyan
  [2.4, 1.3, 0.3], // amber
  [1.6, 0.6, 2.6], // violet
  [0.5, 2.2, 0.9], // green
];
export const SLOT_CSS = ['#5fe3ff', '#ffb347', '#c38bff', '#6bf08a'];

export interface DroneRig {
  root: TransformNode;
  body: TransformNode;
  ring: AbstractMesh;
  pod: TransformNode;
  muzzle: TransformNode;
  thrusters: AbstractMesh[];
  accent: PBRMaterial;
}

/** The same airframe serves as an HQ patrol and as the remote co-op Warden. */
export function buildWardenDrone(scene: Scene, kit: Kit, P: Palette, slot: number): DroneRig {
  const c = SLOT_COLORS[slot % SLOT_COLORS.length];
  const accent = unlit(scene, `droneAccent${slot}`, c);
  const exhaust = unlit(scene, `droneExhaust${slot}`, c, { additive: true });
  exhaust.alpha = 0.54;
  accent.onDisposeObservable.addOnce(() => exhaust.dispose());
  const root = kit.node('warden', null);
  const body = kit.node('wBody', root, [0, 0, 0]);
  const L = (name: string, sections: Section[], segments = 20) => kit.sculpt(name, () => loftData(sections, 'z', segments));
  const hull = L('droneHull', [
    { t: -0.55, w: 0.16, h: 0.071, v: 0.015 }, { t: -0.43, w: 0.27, h: 0.13, v: 0.04 },
    { t: -0.15, w: 0.35, h: 0.18, v: 0.055 }, { t: 0.24, w: 0.32, h: 0.14, v: 0.035 },
    { t: 0.48, w: 0.24, h: 0.075, v: -0.003, n: 5 }, { t: 0.59, w: 0.158, h: 0.037, v: -0.022, n: 4 },
  ], 28);
  const keel = L('droneKeel', [
    { t: -0.50, w: 0.125, h: 0.04 }, { t: -0.26, w: 0.285, h: 0.115 },
    { t: 0.26, w: 0.28, h: 0.099, n: 5 }, { t: 0.59, w: 0.142, h: 0.045, v: 0.047 },
  ]);
  const visor = L('droneVisor', [
    { t: 0.33, w: 0.23, h: 0.063, n: 3 }, { t: 0.53, w: 0.197, h: 0.049, v: -0.013, n: 5 },
    { t: 0.61, w: 0.148, h: 0.034, v: -0.018, n: 5 },
  ]);
  const nacelle = L('droneNacelle', [
    { t: -0.56, w: 0.065, h: 0.049, v: 0.02 }, { t: -0.4, w: 0.14, h: 0.091, v: 0.03 },
    { t: 0.12, w: 0.158, h: 0.12, v: 0.01, n: 5 }, { t: 0.30, w: 0.118, h: 0.065, v: -0.02 },
  ]);
  const wing = L('droneShoulder', [
    { t: -0.46, w: 0.061, h: 0.023, n: 5 }, { t: -0.31, w: 0.13, h: 0.052, n: 6 },
    { t: 0.08, w: 0.14, h: 0.049, n: 6 }, { t: 0.29, w: 0.062, h: 0.027, n: 5 },
  ]);
  const nozzle = kit.sculpt('droneNozzle', () => smoothLatheData([
    [0.066, -0.02], [0.085, -0.018], [0.094, 0.018], [0.081, 0.043], [0.064, 0.052],
  ], 16));
  const jet = kit.sculpt('droneJet', () => {
    const data = smoothLatheData([[0.006, -0.47], [0.028, -0.33], [0.049, -0.14], [0.061, 0]], 16);
    const points = data.positions!;
    const colors: number[] = [];
    for (let i = 1; i < points.length; i += 3) colors.push(1, 1, 1, Math.max(0, 1 + points[i] / 0.47) ** 2);
    data.colors = colors;
    return data;
  });
  kit.template(jet, exhaust).hasVertexAlpha = true;
  kit.part(keel, P.graphite, body, { pos: [0, -0.14, 0] });
  kit.part(hull, P.white, body);
  kit.part(visor, P.panel, body, { pos: [0, -0.025, 0.008] });
  kit.part('cyl', P.metal, body, { pos: [0, -0.052, 0.620], scale: [0.065, 0.018, 0.065], rot: [Math.PI / 2, 0, 0] });
  kit.part('sphere', accent, body, { pos: [0, -0.052, 0.630], scale: [0.043, 0.043, 0.018], shadow: false });
  kit.part('torusThin', P.graphite, body, { pos: [0, -0.052, 0.632], rot: [Math.PI / 2, 0, 0], scale: [0.063, 0.063, 0.063] });
  for (const side of [-1, 1]) {
    kit.part(wing, P.panel, body, { pos: [side * 0.292, 0.139, -0.036], rot: [0.16, side * -0.11, side * -0.28] });
    kit.part(nacelle, P.graphite, body, { pos: [side * 0.43, -0.087, -0.003], scale: [1, 1, 1.06], rot: [0, side * -0.16, 0] });
    kit.part(nacelle, P.white, body, { pos: [side * 0.455, 0.024, -0.025], scale: [0.97, 0.92, 1], rot: [0, side * -0.16, 0] });
    kit.part(nozzle, P.graphite, body, { pos: [side * 0.406, -0.015, 0.267], scale: [1.06, 0.87, 0.81], rot: [-Math.PI / 2, 0, 0] });
    kit.part('cyl', P.metal, body, { pos: [side * 0.406, -0.015, 0.315], scale: [0.118, 0.012, 0.087], rot: [Math.PI / 2, 0, 0] });
    kit.part('box', P.graphite, body, { pos: [side * 0.406, -0.015, 0.322], scale: [0.079, 0.013, 0.005] });
    kit.part('box', accent, body, { pos: [side * 0.096, -0.039, 0.619], scale: [0.068, 0.013, 0.01], shadow: false });
    kit.part('box', P.enamel, body, { pos: [side * 0.513, 0.107, 0.10], scale: [0.035, 0.012, 0.13], rot: [-0.12, side * -0.16, side * -0.13] });
    for (let i = 0; i < 3; i++) kit.part('box', P.graphite, body, { pos: [side * (0.53 - i * 0.008), 0.118, -0.21 + i * 0.047], rot: [0, side * -0.21, side * -0.22], scale: [0.059, 0.019, 0.021] });
    kit.part('box', P.metal, body, { pos: [side * 0.32, -0.216, -0.24], rot: [0, -side * 0.30, 0], scale: [0.091, 0.095, 0.33] });
  }

  const ring = kit.part('torusThin', P.graphite, body, { pos: [0, -0.276, 0], scale: [1.11, 0.72, 1.11] });
  const thrusters: AbstractMesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    kit.part('box', accent, ring, { pos: [Math.sin(a) * 0.5, -0.012, Math.cos(a) * 0.5], rot: [0, a, 0], scale: [0.135, 0.021, 0.023], shadow: false });
    const x = Math.sin(a + Math.PI / 4) * 0.55;
    const z = Math.cos(a + Math.PI / 4) * 0.44;
    kit.part(nozzle, P.metal, body, { pos: [x, -0.283, z] });
    kit.part('cyl8', P.graphite, body, { pos: [x, -0.234, z], scale: [0.22, 0.066, 0.22] });
    kit.part('cyl', accent, body, { pos: [x, -0.306, z], scale: [0.115, 0.006, 0.115], shadow: false });
    const flame = kit.part(jet, exhaust, body, { pos: [x, -0.308, z], scale: [1, 0.19, 1], shadow: false });
    flame.hasVertexAlpha = true;
    thrusters.push(flame);
  }

  const pod = kit.node('wPod', body, [0.36, -0.12, 0.18]);
  kit.part('cyl', P.metal, pod, { scale: [0.2, 0.16, 0.2], rot: [0, 0, Math.PI / 2] });
  kit.part(nacelle, P.graphite, pod, { pos: [0, 0, 0.255], scale: [0.55, 0.64, 0.77] });
  kit.part(nozzle, P.metal, pod, { pos: [0, 0, 0.51], rot: [-Math.PI / 2, 0, 0], scale: [0.66, 1.9, 0.66] });
  kit.part('cyl', accent, pod, { pos: [0, 0, 0.592], rot: [Math.PI / 2, 0, 0], scale: [0.045, 0.01, 0.045], shadow: false });
  const muzzle = kit.node('wMuzzle', pod, [0, 0, 0.62]);
  return { root, body, ring, pod, muzzle, thrusters, accent };
}
