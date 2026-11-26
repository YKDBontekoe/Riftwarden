import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Kit } from './kit';
import type { Palette } from './materials';
import { enemyMats } from './enemyModels';
import { factionFinishes } from './factionFinishes';
import { beveledBoxData } from './bevel';
import { WALKER_SHIN, WALKER_THIGH, type DroneRig, type WalkerLeg, type WalkerRig } from './models';
import { loftData, smoothLatheData, type Section, type LoftAxis } from './sculpt';

const RIGHT_ANGLE = Math.PI / 2;

function armorLoft(sections: Section[], axis: LoftAxis = 'z'): VertexData {
  const data = loftData(sections, axis);
  const pos = data.positions!;
  const normal = data.normals!;
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const nx = Math.abs(normal[i]);
    const ny = Math.abs(normal[i + 1]);
    const nz = Math.abs(normal[i + 2]);
    // Face-plane projection keeps the grain visible on deck plates and wing tops.
    if (ny >= nx && ny >= nz) uv.push(pos[i] * 1.25, pos[i + 2] * 1.25);
    else if (nx >= nz) uv.push(pos[i + 2] * 1.25, pos[i + 1] * 1.25);
    else uv.push(pos[i] * 1.25, pos[i + 1] * 1.25);
  }
  data.uvs = uv;
  return data;
}

function panelShape(kit: Kit) {
  return kit.sculpt('factionPanel', () => {
    const data = beveledBoxData(1, 1, 1, 0.11);
    const normals = data.normals!;
    const colors: number[] = [];
    for (let i = 0; i < normals.length; i += 3) {
      const face = Math.max(Math.abs(normals[i]), Math.abs(normals[i + 1]), Math.abs(normals[i + 2]));
      const wear = face > 0.99 ? 0.86 : 1.17;
      colors.push(wear, wear, wear, 1);
    }
    data.colors = colors;
    return data;
  });
}

function identification(kit: Kit, row: number) {
  return kit.sculpt(`factionIdentification:${row}`, () => {
    const top = 1 - row / 3 - 0.003;
    const bottom = top - 1 / 3 + 0.006;
    const data = new VertexData();
    data.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    data.indices = [0, 2, 1, 0, 3, 2];
    data.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    data.uvs = [0, bottom, 1, bottom, 1, top, 0, top];
    return data;
  });
}


export interface SapperRig extends WalkerRig {
  fuseLamp: AbstractMesh;
}

export function buildSapper(kit: Kit, base: Palette): SapperRig {
  const P = base;
  const finish = factionFinishes(P, 'scrap');
  const panel = panelShape(kit);
  const M = enemyMats(P.white.getScene(), P);
  const root = kit.node('sapper', null);
  const hips = kit.node('sapperHips', root, [0, 1.31, 0]);
  const torso = kit.node('sapperHull', hips, [0, 0.1, 0]);
  const hull = kit.sculpt('sapperHull', () => armorLoft([
    { t: -1.08, w: 0.43, h: 0.24, n: 5 },
    { t: -0.72, w: 0.69, h: 0.33, n: 5 },
    { t: 0.45, w: 0.66, h: 0.30, n: 5 },
    { t: 0.95, w: 0.42, h: 0.20, v: -0.06, n: 5 },
  ]));
  kit.part(hull, finish.casting, torso);
  const belly = kit.sculpt('sapperUnderframe', () => armorLoft([
    { t: -0.90, w: 0.26, h: 0.10, n: 4 },
    { t: -0.44, w: 0.43, h: 0.17, n: 5 },
    { t: 0.56, w: 0.42, h: 0.17, n: 5 },
    { t: 0.91, w: 0.31, h: 0.09, n: 4 },
  ]));
  kit.part(belly, finish.heat, torso, { pos: [0, -0.27, 0.04] });
  kit.part(panel, finish.armor, torso, { pos: [-0.44, 0.30, -0.67], rot: [0.23, 0.07, -0.32], scale: [0.66, 0.18, 0.76] });
  kit.part(panel, finish.casting, torso, { pos: [0.43, 0.31, 0.42], rot: [-0.15, -0.12, 0.22], scale: [0.58, 0.19, 0.76] });
  for (const side of [-1, 1]) {
    const plating = kit.part(panel, finish.armor, torso, { pos: [side * 0.62, -0.02, 0.43], rot: [0.13, -side * 0.22, side * 0.19], scale: [0.19, 0.48, 0.68] });
    kit.part(identification(kit, 0), finish.marking, plating, {
      pos: [side * 0.507, -0.17, 0], rot: [0, side * RIGHT_ANGLE, 0], scale: [0.76, 0.28, 1], shadow: false,
    });
    for (const z of [0.25, 0.41, 0.57]) {
      kit.part(panel, finish.heat, torso, { pos: [side * 0.71, 0.06, z], rot: [0.18, -side * 0.22, side * 0.19], scale: [0.021, 0.22, 0.042] });
    }
    for (const z of [-0.90, 0.15, 0.78]) {
      kit.part('cyl6', finish.machined, torso, { pos: [side * 0.66, -0.16, z], rot: [0, 0, RIGHT_ANGLE], scale: [0.080, 0.045, 0.080] });
    }
    kit.part(panel, finish.warning, torso, { pos: [side * 0.72, 0.175, 0.69], rot: [0.4, -side * 0.23, side * 0.19], scale: [0.022, 0.12, 0.05] });
  }
  // An exposed transverse charge cell dominates the profile. The rear window sits on the weakpoint side.
  kit.part('cyl', P.orangeGlow, torso, { pos: [0, 0.18, -0.40], rot: [0, 0, RIGHT_ANGLE], scale: [0.55, 1.65, 0.55], shadow: false });
  for (const x of [-0.79, -0.50, 0.50, 0.79]) {
    kit.part('cyl', finish.machined, torso, { pos: [x, 0.18, -0.40], rot: [0, 0, RIGHT_ANGLE], scale: [0.66, 0.09, 0.66] });
  }
  for (const z of [-0.53, -0.33, -0.13]) {
    kit.part(panel, finish.heat, torso, { pos: [0, 0.455, z], scale: [1.63, 0.042, 0.065] });
  }
  for (const side of [-1, 1]) {
    kit.part('cyl', finish.casting, torso, { pos: [side * 0.85, 0.18, -0.40], rot: [0, 0, RIGHT_ANGLE], scale: [0.51, 0.15, 0.51] });
    kit.part('torusThin', finish.machined, torso, { pos: [side * 0.94, 0.18, -0.40], rot: [0, 0, RIGHT_ANGLE], scale: [0.40, 0.40, 0.40] });
    kit.part('cyl6', finish.heat, torso, { pos: [side * 0.94, 0.18, -0.40], rot: [0, 0, RIGHT_ANGLE], scale: [0.28, 0.12, 0.28] });
  }
  kit.part(panel, finish.heat, torso, { pos: [0, 0.15, -1.075], scale: [0.36, 0.24, 0.16] });
  kit.part('box', P.orangeDim, torso, { pos: [0, 0.14, -1.16], scale: [0.23, 0.095, 0.02], shadow: false });
  const fuseLamp = kit.part('box', M.chargeRed, torso, { pos: [0, 0.14, -1.173], scale: [0.23, 0.095, 0.014], shadow: false });
  fuseLamp.setEnabled(false);
  for (const x of [-0.31, 0.31]) {
    kit.part(panel, finish.heat, torso, { pos: [x, 0.23, -1.08], scale: [0.14, 0.46, 0.14] });
    kit.part(panel, finish.warning, torso, { pos: [x, 0.27, -1.16], scale: [0.14, 0.09, 0.025] });
  }
  const head = kit.node('sapperSensor', torso, [0, -0.04, 0.98]);
  const sensor = kit.sculpt('sapperLensHousing', () => smoothLatheData([
    [0.17, -0.22], [0.25, -0.17], [0.255, 0.04], [0.219, 0.07],
    [0.219, 0.25], [0.187, 0.266], [0.132, 0.238], [0.13, 0.06],
  ], 24));
  kit.part(sensor, finish.casting, head, { rot: [RIGHT_ANGLE, 0, 0] });
  kit.part('torusThin', finish.machined, head, { pos: [0, 0, 0.248], rot: [RIGHT_ANGLE, 0, 0], scale: [0.375, 0.375, 0.375] });
  kit.part('sphere', P.orangeGlow, head, { pos: [0, 0, 0.185], scale: [0.23, 0.23, 0.100], shadow: false });
  for (const side of [-1, 1]) {
    kit.part('cyl6', finish.heat, head, { pos: [side * 0.233, 0.102, 0.091], rot: [RIGHT_ANGLE, 0, 0], scale: [0.112, 0.17, 0.112] });
    kit.part('cyl8', P.orangeDim, head, { pos: [side * 0.233, 0.102, 0.178], rot: [RIGHT_ANGLE, 0, 0], scale: [0.053, 0.013, 0.053], shadow: false });
  }
  const probe = kit.sculpt('sapperProbe', () => smoothLatheData([
    [0.17, 0], [0.20, 0.14], [0.15, 0.38], [0.10, 0.55], [0.035, 0.71],
  ], 12));
  kit.part(probe, finish.casting, torso, { pos: [0.24, -0.29, 0.75], rot: [RIGHT_ANGLE, 0, 0] });
  for (const z of [0.92, 1.02, 1.12]) {
    kit.part('cyl8', finish.machined, torso, { pos: [0.24, -0.29, z], rot: [RIGHT_ANGLE, 0, 0], scale: [0.33, 0.06, 0.33] });
  }

  const upper = kit.sculpt('sapperUpperLeg', () => armorLoft([
    { t: -0.68, w: 0.11, h: 0.13, u: 0.11, n: 5 },
    { t: -0.35, w: 0.19, h: 0.19, u: 0.07, n: 5 },
    { t: 0.03, w: 0.16, h: 0.17, n: 5 },
  ], 'y'));
  const leg = (side: number, z: number): WalkerLeg => {
    const thigh = kit.node('sapperHipJoint', hips, [side * 0.69, -0.08, z]);
    kit.part(upper, finish.casting, thigh, { scale: [side, 1, 1] });
    kit.part(upper, finish.armor, thigh, { pos: [side * 0.101, -0.13, 0.039], scale: [side * 0.50, 0.57, 1.09] });
    kit.part('cyl', finish.casting, thigh, { rot: [0, 0, RIGHT_ANGLE], scale: [0.41, 0.41, 0.41] });
    kit.part('cyl', finish.casting, thigh, { pos: [side * 0.23, -0.25, -0.134], rot: [0.15, 0, side * 0.14], scale: [0.096, 0.32, 0.096] });
    kit.part('cyl', finish.machined, thigh, { pos: [side * 0.26, -0.456, -0.161], rot: [0.15, 0, side * 0.14], scale: [0.058, 0.20, 0.058] });
    const knee = kit.node('sapperKnee', thigh, [0, -WALKER_THIGH, 0]);
    kit.part('cyl', finish.machined, knee, { rot: [0, 0, RIGHT_ANGLE], scale: [0.28, 0.31, 0.28] });
    kit.part(panel, finish.casting, knee, { pos: [side * 0.04, -0.31, -0.03], scale: [0.24, 0.63, 0.23] });
    kit.part('cyl', finish.heat, knee, { pos: [side * 0.18, 0, 0], rot: [0, 0, RIGHT_ANGLE], scale: [0.22, 0.085, 0.22] });
    kit.part('cyl6', finish.machined, knee, { pos: [side * 0.228, 0, 0], rot: [0, 0, RIGHT_ANGLE], scale: [0.096, 0.042, 0.096] });
    kit.part('cyl', finish.machined, knee, { pos: [side * 0.13, -0.36, -0.145], rot: [0.11, 0, side * -0.14], scale: [0.058, 0.39, 0.058] });
    kit.part(panel, finish.armor, knee, { pos: [side * 0.13, -0.23, 0.08], rot: [0.09, 0, 0], scale: [0.11, 0.41, 0.20] });
    const ankle = kit.node('sapperFoot', knee, [0, -WALKER_SHIN, 0]);
    kit.part(panel, finish.casting, ankle, { pos: [0, -0.03, 0.05], scale: [0.29, 0.12, 0.47] });
    for (const x of [-0.10, 0.10]) kit.part(panel, finish.machined, ankle, { pos: [x, -0.036, 0.27], scale: [0.095, 0.085, 0.15] });
    thigh.rotationQuaternion = Quaternion.Identity();
    knee.rotationQuaternion = Quaternion.Identity();
    ankle.rotationQuaternion = Quaternion.Identity();
    return { thigh, knee, ankle, stanceX: side * 0.94 };
  };
  const left = leg(-1, -0.75);
  const right = leg(1, -0.75);
  const forelegs = [leg(-1, 0.75), leg(1, 0.75)] as const;
  // Reuse the walker limb IDs for the two forelegs and retain the shared motion rig's muzzle anchor.
  const cannon = forelegs[1].thigh;
  const armL = forelegs[0].thigh;
  const barrel = kit.node('sapperMuzzleAnchor', cannon);
  const muzzleGlow = kit.part('sphere', P.orangeDim, barrel, { shadow: false });
  muzzleGlow.setEnabled(false);
  return {
    root, hips, torso, head, forelegs, cannon, armL, barrel, muzzleGlow, fuseLamp, shield: null,
    thighL: left.thigh, kneeL: left.knee, ankleL: left.ankle,
    thighR: right.thigh, kneeR: right.knee, ankleR: right.ankle,
  };
}

export interface BurrowerRig {
  root: TransformNode;
  body: TransformNode;
  drill: TransformNode;
  sprockets: TransformNode[];
  treads: AbstractMesh[][];
  treadFrame: number;
}

export const BURROWER_SURFACE_Y = 1.18;
const TRACK_RADIUS = 0.40;
const TRACK_STRAIGHT = 1.84;
const TRACK_HALF_TURN = Math.PI * TRACK_RADIUS;
const TRACK_LOOP = 2 * (TRACK_STRAIGHT + TRACK_HALF_TURN);
const TRACK_LINKS = 38;
const TRACK_PITCH = TRACK_LOOP / TRACK_LINKS;
const TRACK_FRAMES = 6;

/** Prebake one shoe-length of travel. Only one merged belt per side is active at a time. */
function trackShoeData(frame: number): VertexData {
  const links: VertexData[] = [];
  for (let i = 0; i < TRACK_LINKS; i++) {
    const d = TRACK_PITCH * (i + frame / TRACK_FRAMES);
    let angle = 0, y = TRACK_RADIUS, z = -TRACK_STRAIGHT / 2 + d;
    if (d >= 2 * TRACK_STRAIGHT + TRACK_HALF_TURN) {
      angle = Math.PI + (d - 2 * TRACK_STRAIGHT - TRACK_HALF_TURN) / TRACK_RADIUS;
      y = Math.cos(angle) * TRACK_RADIUS;
      z = -TRACK_STRAIGHT / 2 + Math.sin(angle) * TRACK_RADIUS;
    } else if (d >= TRACK_STRAIGHT + TRACK_HALF_TURN) {
      angle = Math.PI;
      y = -TRACK_RADIUS;
      z = TRACK_STRAIGHT / 2 - (d - TRACK_STRAIGHT - TRACK_HALF_TURN);
    } else if (d >= TRACK_STRAIGHT) {
      angle = (d - TRACK_STRAIGHT) / TRACK_RADIUS;
      y = Math.cos(angle) * TRACK_RADIUS;
      z = TRACK_STRAIGHT / 2 + Math.sin(angle) * TRACK_RADIUS;
    }
    const shoe = beveledBoxData(0.59, 0.086, 0.145, 0.027);
    shoe.transform(Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Right(), angle), new Vector3(0, y, z)));
    links.push(shoe);
  }
  const first = links.shift()!;
  return first.merge(links);
}

export function setBurrowerTravel(rig: BurrowerRig, distance: number): void {
  const frame = Math.min(TRACK_FRAMES - 1, Math.floor((distance % TRACK_PITCH) / TRACK_PITCH * TRACK_FRAMES));
  if (frame !== rig.treadFrame) {
    for (const belt of rig.treads) {
      belt[rig.treadFrame].setEnabled(false);
      belt[frame].setEnabled(true);
    }
    rig.treadFrame = frame;
  }
  const rotation = (distance / TRACK_RADIUS) % (Math.PI * 2);
  for (const sprocket of rig.sprockets) sprocket.rotation.x = rotation;
}

/** One tapered screw flight, with thickness so the cutting edge catches light from either side. */
function drillFlightData(): VertexData {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const segments = 56;
  const profile = [[0.83, -0.06], [1, -0.035], [1, 0.027], [0.83, 0.055]];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = t * Math.PI * 6;
    const radius = 0.53 * (1 - t ** 1.4) + 0.035;
    for (const [ratio, offset] of profile) {
      positions.push(Math.cos(a) * radius * ratio, Math.sin(a) * radius * ratio, 0.13 + t * 0.89 + offset);
      uvs.push(t, ratio);
    }
    if (i === segments) break;
    for (let j = 0; j < 4; j++) {
      const edge = i * 4 + j;
      const next = i * 4 + (j + 1) % 4;
      indices.push(edge, next, next + 4, edge, next + 4, edge + 4);
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs });
  return data;
}

export function buildBurrower(kit: Kit, base: Palette): BurrowerRig {
  const P = base;
  const finish = factionFinishes(P, 'rime');
  const panel = panelShape(kit);
  const root = kit.node('burrower', null);
  const body = kit.node('burrowerChassis', root, [0, BURROWER_SURFACE_Y, 0]);
  const hull = kit.sculpt('burrowerWedge', () => armorLoft([
    { t: -1.38, w: 0.76, h: 0.30, n: 5 },
    { t: -0.93, w: 1.00, h: 0.50, v: 0.14, n: 5 },
    { t: 0.32, w: 1.03, h: 0.44, v: 0.23, n: 5 },
    { t: 0.92, w: 0.86, h: 0.25, v: 0.16, n: 5 },
  ]));
  kit.part(hull, finish.casting, body);
  const trackFrames = Array.from({ length: TRACK_FRAMES }, (_, frame) => (
    kit.sculpt(`burrowerTrackShoes:${frame}`, () => trackShoeData(frame))
  ));
  const treads: AbstractMesh[][] = [];
  const sprockets: TransformNode[] = [];
  for (const side of [-1, 1]) {
    treads.push(trackFrames.map((shape, frame) => {
      const belt = kit.part(shape, finish.tracks, body, { pos: [side * 0.96, -0.67, -0.28] });
      belt.setEnabled(frame === 0);
      return belt;
    }));
    for (const z of [-1.18, -0.74, -0.30, 0.14, 0.58]) {
      const wheel = kit.node('burrowerSprocket', body, [side * 1.04, -0.67, z]);
      kit.part('cyl', finish.heat, wheel, { rot: [0, 0, RIGHT_ANGLE], scale: [0.67, 0.43, 0.67] });
      kit.part('torusThin', finish.machined, wheel, { pos: [side * 0.223, 0, 0], rot: [0, 0, RIGHT_ANGLE], scale: [0.48, 0.48, 0.48] });
      kit.part('cyl6', finish.casting, wheel, { pos: [side * 0.23, 0, 0], rot: [0, 0, RIGHT_ANGLE], scale: [0.29, 0.11, 0.29] });
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        kit.part('cyl6', finish.machined, wheel, { pos: [side * 0.293, Math.cos(a) * 0.10, Math.sin(a) * 0.10], rot: [0, 0, RIGHT_ANGLE], scale: [0.052, 0.03, 0.052] });
      }
      sprockets.push(wheel);
    }
    kit.part(panel, finish.heat, body, { pos: [side * 0.76, 0.57, -0.57], rot: [0.13, 0, -side * 0.26], scale: [0.67, 0.17, 1.20] });
    kit.part(panel, finish.armor, body, { pos: [side * 0.74, 0.20, 0.85], rot: [-0.27, side * 0.31, side * 0.17], scale: [0.30, 0.49, 0.83] });
    kit.part(panel, finish.machined, body, { pos: [side * 0.70, 0.01, 1.20], rot: [-0.34, -side * 0.20, 0], scale: [0.16, 0.35, 0.62] });
    kit.part(panel, finish.warning, body, { pos: [side * 0.93, 0.55, -0.8], rot: [0.10, 0, -side * 0.25], scale: [0.13, 0.08, 0.34] });
    kit.part(panel, finish.casting, body, { pos: [side * 1.11, -0.11, -0.36], rot: [0, 0, -side * 0.20], scale: [0.33, 0.27, 1.87] });
    for (const z of [-1.08, -0.47, 0.15]) {
      kit.part(panel, finish.armor, body, { pos: [side * 1.24, -0.04, z], rot: [0.09, side * 0.11, -side * 0.14], scale: [0.18, 0.33, 0.51] });
      kit.part('cyl6', finish.machined, body, { pos: [side * 1.331, -0.08, z - 0.11], rot: [0, 0, RIGHT_ANGLE], scale: [0.064, 0.043, 0.064] });
    }
    kit.part(panel, finish.armor, body, { pos: [side * 0.56, 0.59, 0.02], rot: [-0.17, side * 0.09, -side * 0.32], scale: [0.55, 0.15, 0.86] });
  }
  kit.part(panel, finish.heat, body, { pos: [0, 0.56, -0.66], scale: [0.82, 0.16, 0.66] });
  for (let i = 0; i < 7; i++) {
    kit.part(panel, finish.armor, body, { pos: [0, 0.661, -0.93 + i * 0.082], rot: [-0.32, 0, 0], scale: [0.76, 0.064, 0.045] });
  }
  const brow = kit.part(panel, finish.casting, body, { pos: [0, 0.52, 0.74], rot: [-0.31, 0, 0], scale: [1.14, 0.25, 0.64] });
  kit.part(identification(kit, 1), finish.marking, brow, { pos: [0, 0.508, 0], rot: [-RIGHT_ANGLE, 0, 0], scale: [0.76, 0.36, 1], shadow: false });
  kit.part('box', P.cyanGlow, body, { pos: [0, 0.49, 1.06], scale: [0.66, 0.065, 0.045], shadow: false });

  const drill = kit.node('burrowerDrill', body, [0, -0.03, 0.93]);
  const bit = kit.sculpt('burrowerBit', () => smoothLatheData([
    [0.30, 0], [0.42, 0.08], [0.42, 0.25], [0.34, 0.47], [0.19, 0.72], [0.035, 1.03],
  ], 20));
  kit.part(bit, finish.heat, drill, { rot: [RIGHT_ANGLE, 0, 0] });
  kit.part('cyl', finish.casting, drill, { pos: [0, 0, -0.04], rot: [RIGHT_ANGLE, 0, 0], scale: [0.97, 0.23, 0.97] });
  kit.part('torusThin', finish.machined, drill, { pos: [0, 0, 0.02], rot: [RIGHT_ANGLE, 0, 0], scale: [0.89, 0.89, 0.89] });
  kit.part(kit.sculpt('burrowerCuttingFlight', drillFlightData), finish.machined, drill);
  return { root, body, drill, sprockets, treads, treadFrame: 0 };
}

export function buildSkimmer(kit: Kit, base: Palette): DroneRig {
  const P = base;
  const finish = factionFinishes(P, 'crucible');
  const panel = panelShape(kit);
  const root = kit.node('crucibleSkimmer', null);
  const body = kit.node('skimmerFlightBody', root, [0, 1.3, 0]);
  body.scaling.setAll(0.62);
  const hull = kit.sculpt('skimmerHull', () => armorLoft([
    { t: -0.91, w: 0.33, h: 0.22, n: 5 },
    { t: -0.46, w: 0.65, h: 0.30, n: 5 },
    { t: 0.12, w: 0.49, h: 0.24, n: 5 },
    { t: 0.68, w: 0.14, h: 0.08, v: -0.065, n: 5 },
  ]));
  const wing = kit.sculpt('skimmerWing', () => armorLoft([
    { t: 0.26, w: 0.69, h: 0.145, u: -0.03, n: 5 },
    { t: 0.54, w: 0.59, h: 0.115, u: -0.17, n: 5 },
    { t: 0.92, w: 0.42, h: 0.067, u: -0.37, v: -0.053, n: 5 },
    { t: 1.28, w: 0.22, h: 0.044, u: -0.63, v: -0.10, n: 5 },
    { t: 1.54, w: 0.045, h: 0.022, u: -0.85, v: -0.16, n: 4 },
  ], 'x'));
  const stabilizer = kit.sculpt('skimmerStabilizer', () => armorLoft([
    { t: 0.0, w: 0.068, h: 0.25, n: 4 },
    { t: 0.19, w: 0.045, h: 0.19, v: -0.13, n: 4 },
    { t: 0.40, w: 0.018, h: 0.055, v: -0.28, n: 4 },
  ], 'y'));
  kit.part(hull, finish.casting, body);
  const spine = kit.sculpt('skimmerDorsal', () => armorLoft([
    { t: -0.78, w: 0.295, h: 0.046, v: 0.17, n: 4 },
    { t: -0.50, w: 0.41, h: 0.083, v: 0.268, n: 5 },
    { t: -0.19, w: 0.39, h: 0.073, v: 0.28, n: 5 },
    { t: 0.23, w: 0.28, h: 0.055, v: 0.177, n: 5 },
    { t: 0.66, w: 0.14, h: 0.046, v: -0.01, n: 4 },
  ]));
  kit.part(spine, finish.armor, body);
  const badgePanel = kit.part(panel, finish.heat, body, { pos: [0, 0.346, -0.33], rot: [-0.05, 0, 0], scale: [0.48, 0.040, 0.36] });
  kit.part(identification(kit, 2), finish.marking, badgePanel, { pos: [0, 0.535, 0], rot: [-RIGHT_ANGLE, 0, 0], scale: [0.85, 0.48, 1], shadow: false });
  const exhaust = kit.sculpt('skimmerExhaustBell', () => smoothLatheData([
    [0.092, -0.155], [0.147, -0.106], [0.16, 0.012], [0.187, 0.128],
    [0.168, 0.161], [0.134, 0.134], [0.096, -0.078],
  ], 20));
  for (const side of [-1, 1]) {
    kit.part(wing, finish.heat, body, { scale: [side, 1, 1] });
    kit.part(wing, finish.armor, body, { pos: [side * 0.09, 0.13, -0.10], scale: [side * 0.88, 0.34, 0.79] });
    kit.part(wing, finish.heat, body, { pos: [0, -0.095, -0.03], scale: [side, 0.52, 0.96] });
    const strake = kit.sculpt('skimmerStrake', () => armorLoft([
      { t: -0.73, w: 0.15, h: 0.025, v: 0.16, n: 4 },
      { t: -0.55, w: 0.19, h: 0.043, v: 0.14, n: 5 },
      { t: 0.20, w: 0.065, h: 0.023, v: 0.10, n: 4 },
    ]));
    kit.part(strake, finish.casting, body, { pos: [side * 0.60, 0.07, 0], rot: [0, side * 0.29, -side * 0.20] });
    for (const z of [-0.50, -0.27]) {
      kit.part('cyl6', finish.machined, body, { pos: [side * 0.64, 0.235, z], scale: [0.056, 0.022, 0.056] });
    }
    kit.part(stabilizer, finish.casting, body, { pos: [side * 0.63, 0.16, -0.49], rot: [0.12, -side * 0.07, -side * 0.48] });
    const vent = kit.node('skimmerWingDuct', body, [side * 0.73, -0.121, 0.23]);
    vent.rotation.set(-0.19, side * 0.55, 0);
    kit.part(panel, finish.heat, vent, { pos: [0, 0.015, -0.053], scale: [0.43, 0.15, 0.26] });
    kit.part(panel, finish.machined, vent, { pos: [0, -0.064, -0.03], scale: [0.45, 0.061, 0.31] });
    kit.part('box', P.orangeDim, vent, { pos: [0, 0.012, 0.08], scale: [0.31, 0.039, 0.026], shadow: false });
    for (let i = 0; i < 4; i++) {
      kit.part(panel, finish.casting, vent, { pos: [-0.126 + i * 0.084, 0.01, 0.104], rot: [0, 0, 0.20], scale: [0.031, 0.076, 0.048] });
    }
    kit.part(exhaust, finish.heat, body, { pos: [side * 0.37, -0.03, -0.98], rot: [-RIGHT_ANGLE, 0, 0] });
    kit.part('torusThin', finish.machined, body, { pos: [side * 0.37, -0.03, -1.128], rot: [RIGHT_ANGLE, 0, 0], scale: [0.33, 0.33, 0.33] });
    kit.part('cyl8', P.orangeGlow, body, { pos: [side * 0.37, -0.03, -1.043], rot: [RIGHT_ANGLE, 0, 0], scale: [0.188, 0.02, 0.188], shadow: false });
  }
  const intake = kit.sculpt('skimmerIntakeHousing', () => armorLoft([
    { t: 0.27, w: 0.32, h: 0.12, v: -0.13, n: 4 },
    { t: 0.51, w: 0.30, h: 0.16, v: -0.15, n: 5 },
    { t: 0.67, w: 0.26, h: 0.12, v: -0.19, n: 4 },
  ]));
  kit.part(intake, finish.heat, body);
  const noseDuct = kit.node('skimmerNoseDuct', body, [0, -0.202, 0.765]);
  noseDuct.rotation.x = -0.33;
  kit.part(panel, finish.casting, noseDuct, { pos: [0, 0.112, -0.003], scale: [0.55, 0.091, 0.30] });
  kit.part(panel, finish.casting, noseDuct, { pos: [0, -0.112, -0.01], scale: [0.53, 0.084, 0.27] });
  for (const side of [-1, 1]) {
    kit.part(panel, finish.armor, noseDuct, { pos: [side * 0.248, 0, -0.013], rot: [0, 0, side * -0.14], scale: [0.092, 0.248, 0.29] });
  }
  kit.part('box', P.orangeGlow, noseDuct, { pos: [0, -0.013, 0.058], scale: [0.425, 0.118, 0.022], shadow: false });
  for (let i = -2; i <= 2; i++) {
    kit.part(panel, finish.heat, noseDuct, { pos: [i * 0.080, 0, 0.101], rot: [0, -0.19, -0.14], scale: [0.031, 0.158, 0.052] });
  }
  const ring = kit.part('torusThin', P.orangeDim, body, { pos: [0, 0, -0.94], scale: [0.43, 0.43, 0.43], shadow: false });
  return { root, body, ring };
}
