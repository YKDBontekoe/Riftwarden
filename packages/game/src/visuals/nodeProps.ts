import { Color3 } from '@babylonjs/core/Maths/math.color';
import { type AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { type ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { type TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { type Scene } from '@babylonjs/core/scene';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';
import { createRiftMaterial } from './atmosphere';
import { loftData } from './sculpt';

/** Station kinds a map node places in its arena (hub stations, the vault and the exit rift). */
export type StationKind = 'merchant' | 'forge' | 'rest' | 'event' | 'vault' | 'exit';

export interface StationRig {
  root: TransformNode;
  /** Spins/bobs while the station is live. */
  spin: TransformNode;
  glow: AbstractMesh[];
  /** Interaction focus height above the root. */
  focusY: number;
  setUsed(used: boolean): void;
  update(t: number): void;
  dispose(): void;
}

const TINT: Record<StationKind, [number, number, number]> = {
  merchant: [2.2, 1.5, 0.35],
  forge: [3.2, 0.9, 0.25],
  rest: [0.4, 2.6, 1.2],
  event: [1.8, 0.5, 2.8],
  vault: [0.5, 1.6, 3],
  exit: [2.4, 0.6, 3.4],
};

type P = [number, number, number];
/** Per-kind idle motion; `k` is 1 while live, ~0.15 once used. */
type Anim = (t: number, k: number) => void;

/**
 * Procedural station rigs from kit primitives (instanced; unlit glows feed bloom). Visual only: no colliders,
 * the drone flies through them like the rest of the set dressing. Local +z faces the drop point (the warden's
 * approach). A used station dims its glow material and slows down.
 */
export function buildStation(scene: Scene, kit: Kit, pal: Palette, kind: StationKind): StationRig {
  const root = kit.node(`station_${kind}`, null);
  const spin = kit.node('spin', root);
  const tint = TINT[kind];
  const glowMat = unlit(scene, `stationGlow_${kind}`, new Color3(...tint));
  const dimMat = unlit(scene, `stationDim_${kind}`, new Color3(tint[0] * 0.18, tint[1] * 0.18, tint[2] * 0.18));
  const glow: AbstractMesh[] = [];
  const g = (m: AbstractMesh) => (glow.push(m), m);
  const box = (mat: typeof pal.steel, parent: TransformNode, pos: P, scale: P, rot?: P) => kit.part('box', mat, parent, { pos, scale, rot });
  const lit = (parent: TransformNode, shape: Parameters<Kit['part']>[0], pos: P, scale: P, rot?: P) => g(kit.part(shape, glowMat, parent, { pos, scale, rot, shadow: false }));
  let focusY = 1.6;
  let anim: Anim = () => {};
  let rift: ShaderMaterial | null = null;

  // Common deck: octagonal platform, machined top plate, lit rim, four bollards with lit caps, a front step.
  kit.part('cyl8', pal.graphite, root, { pos: [0, 0.11, 0], scale: [3.6, 0.22, 3.6] });
  kit.part('cyl8', pal.metal, root, { pos: [0, 0.235, 0], scale: [3.2, 0.04, 3.2] });
  lit(root, 'torusThin', [0, 0.25, 0], [3.35, 3.35, 3.35]);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * (Math.PI / 2);
    const x = Math.sin(a) * 1.62, z = Math.cos(a) * 1.62;
    kit.part('cyl8', pal.steel, root, { pos: [x, 0.45, z], scale: [0.16, 0.5, 0.16] });
    lit(root, 'cyl8', [x, 0.72, z], [0.12, 0.05, 0.12]);
  }
  box(pal.graphite, root, [0, 0.07, 1.95], [1.4, 0.14, 0.5]);
  lit(root, 'box', [0, 0.145, 2.19], [1.1, 0.012, 0.02]);

  switch (kind) {
    case 'merchant': {
      // Trade kiosk: counter with a lit front, three display plinths with spinning wares, canopy on posts,
      // price board, supply crates behind.
      const counter = kit.sculpt('kioskCounter', () => loftData([
        { t: 0.24, w: 0.95, h: 0.42, n: 6 }, { t: 0.4, w: 0.9, h: 0.38, n: 6 }, { t: 1.08, w: 1.02, h: 0.46, n: 6 }, { t: 1.16, w: 1.06, h: 0.5, n: 6 },
      ], 'y', 16));
      kit.part(counter, pal.panel, root, { pos: [0, 0, 0.1] });
      box(pal.graphite, root, [0, 1.19, 0.1], [2.2, 0.06, 1.06]);
      lit(root, 'box', [0, 0.78, 0.58], [1.7, 0.06, 0.02]);
      const wares: TransformNode[] = [];
      for (const [x, shape] of [[-0.65, 'ico'], [0, 'cyl6'], [0.65, 'box']] as const) {
        kit.part('cyl8', pal.metal, root, { pos: [x, 1.27, 0.2], scale: [0.36, 0.1, 0.36] });
        const w = kit.node('ware', root, [x, 1.55, 0.2]);
        lit(w, shape, [0, 0, 0], [0.22, 0.22, 0.22], [0.5, 0, 0.4]);
        wares.push(w);
      }
      for (const s of [-1, 1]) {
        kit.part('cyl8', pal.steel, root, { pos: [s * 1.05, 1.8, -0.35], scale: [0.1, 3.3, 0.1] });
        box(pal.metal, root, [s * 1.05, 0.32, -0.35], [0.24, 0.18, 0.24]);
      }
      box(pal.panel, root, [0, 3.48, 0.05], [2.6, 0.08, 1.4], [0.12, 0, 0]);
      box(pal.graphite, root, [0, 3.38, 0.05], [2.5, 0.06, 1.3], [0.12, 0, 0]);
      lit(root, 'box', [0, 3.36, 0.72], [2.3, 0.04, 0.02]);
      box(pal.graphite, root, [0, 2.45, -0.38], [1.9, 0.75, 0.07]);
      lit(root, 'box', [0, 2.45, -0.33], [1.7, 0.6, 0.012]);
      for (const [x, z, y] of [[-0.6, -1.05, 0.5], [0.15, -1.15, 0.5], [-0.25, -1.1, 1.0]] as const) {
        box(pal.steel, root, [x, y, z], [0.6, 0.5, 0.5]);
        box(pal.rust, root, [x, y + 0.2, z + 0.26], [0.5, 0.06, 0.01]);
      }
      focusY = 1.5;
      anim = (t, k) => wares.forEach((w, i) => {
        w.rotation.y = t * 0.9 * k + i;
        w.position.y = 1.55 + Math.sin(t * 1.6 + i) * 0.05 * k;
      });
      break;
    }
    case 'forge': {
      // Forge: heavy anvil block with a glowing crucible, furnace column with lit slots, chimney, a hammer that
      // rises and falls, coolant tanks.
      const anvil = kit.sculpt('forgeAnvil', () => loftData([
        { t: 0.24, w: 0.85, h: 0.6, n: 6 }, { t: 0.5, w: 0.55, h: 0.4, n: 6 }, { t: 0.85, w: 0.5, h: 0.36, n: 6 }, { t: 1.0, w: 0.95, h: 0.55, n: 6 }, { t: 1.12, w: 0.92, h: 0.52, n: 6 },
      ], 'y', 16));
      kit.part(anvil, pal.steel, root, { pos: [0, 0, 0.35] });
      kit.part('cyl8', pal.graphite, root, { pos: [0, 1.18, 0.35], scale: [0.7, 0.14, 0.7] });
      lit(root, 'cyl8', [0, 1.24, 0.35], [0.54, 0.04, 0.54]);
      lit(root, 'box', [0, 0.7, 0.92], [0.7, 0.24, 0.02]);
      kit.part('cyl8', pal.steel, root, { pos: [0, 1.7, -0.9], scale: [1.2, 3.0, 1.2] });
      kit.part('cyl8', pal.metal, root, { pos: [0, 3.24, -0.9], scale: [1.32, 0.1, 1.32] });
      for (let i = 0; i < 3; i++) lit(root, 'box', [0, 0.9 + i * 0.5, -0.29], [0.5, 0.12, 0.02]);
      kit.part('cyl', pal.rust, root, { pos: [0.35, 4.1, -1.0], scale: [0.36, 1.8, 0.36] });
      kit.part('cyl8', pal.graphite, root, { pos: [0.35, 5.0, -1.0], scale: [0.48, 0.12, 0.48] });
      // Hammer on a gantry arm.
      box(pal.graphite, root, [1.0, 2.25, -0.2], [0.16, 2.6, 0.16]);
      box(pal.graphite, root, [0.5, 3.45, 0.1], [1.1, 0.16, 0.16]);
      const hammer = kit.node('forgeHammer', root, [0, 2.6, 0.35]);
      kit.part('cyl', pal.metal, hammer, { pos: [0, 0.4, 0], scale: [0.08, 0.9, 0.08] });
      box(pal.steel, hammer, [0, 0, 0], [0.42, 0.32, 0.42]);
      box(pal.rust, hammer, [0, -0.17, 0], [0.38, 0.03, 0.38]);
      for (const x of [-1.2, -0.85]) {
        kit.part('cyl', pal.white, root, { pos: [x, 0.85, -0.2], scale: [0.3, 1.2, 0.3] });
        lit(root, 'box', [x, 0.85, -0.04], [0.04, 0.8, 0.012]);
      }
      const ember = kit.node('ember', spin, [0, 1.55, 0.35]);
      lit(ember, 'sphere', [0, 0, 0], [0.26, 0.26, 0.26]);
      focusY = 1.3;
      anim = (t, k) => {
        const c = (t * 0.7) % 1;
        hammer.position.y = 2.6 - (c < 0.15 ? Math.sin((c / 0.15) * Math.PI) * 0.9 : 0) * k;
        ember.position.y = 1.55 + Math.sin(t * 2.4) * 0.05 * k;
      };
      break;
    }
    case 'rest': {
      // Repair cradle: low bed with a glass cover, an arch frame with a scanner bar that sweeps the bed, a rotating
      // medical cross above, supply cases.
      kit.part('cyl8', pal.white, root, { pos: [0, 0.42, 0], scale: [2.3, 0.35, 1.2] });
      kit.part('cyl8', pal.glazing, root, { pos: [0, 0.68, 0], scale: [2.0, 0.22, 0.95] });
      lit(root, 'box', [0, 0.47, 0.6], [1.6, 0.04, 0.02]);
      for (const s of [-1, 1]) {
        box(pal.metal, root, [s * 1.2, 1.25, 0], [0.14, 2.1, 0.3]);
        box(pal.white, root, [s * 1.12, 2.35, 0], [0.32, 0.18, 0.34], [0, 0, -s * 0.5]);
        lit(root, 'box', [s * 1.2, 1.25, 0.16], [0.03, 1.6, 0.012]);
      }
      box(pal.white, root, [0, 2.48, 0], [1.9, 0.16, 0.36]);
      const scanner = kit.node('restScanner', root, [0, 1.0, 0]);
      lit(scanner, 'box', [0, 0, 0], [2.2, 0.04, 0.05]);
      box(pal.metal, scanner, [0, 0.04, 0], [2.3, 0.06, 0.1]);
      const cross = kit.node('restCross', spin, [0, 3.2, 0]);
      lit(cross, 'box', [0, 0, 0], [0.18, 0.62, 0.18]);
      lit(cross, 'box', [0, 0, 0], [0.62, 0.18, 0.18]);
      for (const [x, z] of [[-1.0, -1.05], [0.9, -1.1]] as const) {
        box(pal.white, root, [x, 0.45, z], [0.55, 0.42, 0.4]);
        lit(root, 'box', [x, 0.5, z + 0.21], [0.14, 0.14, 0.01]);
      }
      focusY = 1.2;
      anim = (t, k) => {
        scanner.position.y = 1.0 + (0.5 + 0.5 * Math.sin(t * 1.3)) * 1.1 * k;
        cross.position.y = 3.2 + Math.sin(t * 1.6) * 0.08 * k;
      };
      break;
    }
    case 'event': {
      // Anomaly: a cluster of dark shards around a tall obelisk, a floating core inside crossed rings, debris that
      // orbits it.
      kit.part('cone4', pal.enemyDark, root, { pos: [0, 1.7, 0], scale: [0.9, 3.2, 0.9] });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const h = 1.0 + (i % 3) * 0.45;
        kit.part('cone4', pal.enemyDark, root, { pos: [Math.sin(a) * 0.85, h * 0.45, Math.cos(a) * 0.85], rot: [Math.cos(a) * 0.35, a, -Math.sin(a) * 0.35], scale: [0.4, h, 0.4] });
        lit(root, 'box', [Math.sin(a) * 0.62, 0.3 + h * 0.3, Math.cos(a) * 0.62], [0.03, h * 0.5, 0.03], [Math.cos(a) * 0.35, a, -Math.sin(a) * 0.35]);
      }
      const rings = kit.node('anomalyRings', root, [0, 3.6, 0]);
      lit(rings, 'torus', [0, 0, 0], [1.5, 1.5, 1.5], [Math.PI / 2, 0, 0]);
      lit(rings, 'torusThin', [0, 0, 0], [2.1, 2.1, 2.1], [0.4, 0, 0.9]);
      const core = kit.node('anomalyCore', spin, [0, 3.6, 0]);
      lit(core, 'ico', [0, 0, 0], [0.42, 0.42, 0.42]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        box(pal.enemyDark, core, [Math.sin(a) * 1.35, Math.sin(i * 1.7) * 0.4, Math.cos(a) * 1.35], [0.16, 0.16, 0.16], [i, i * 0.6, 0]);
      }
      focusY = 2;
      anim = (t, k) => {
        rings.rotation.set(Math.sin(t * 0.5) * 0.4 * k, t * 0.35 * k, 0);
        core.position.y = 3.6 + Math.sin(t * 1.4) * 0.12 * k;
      };
      break;
    }
    case 'vault': {
      // Armoured safe: chamfered body with corner guards, a round door with a spoked wheel, lit lock bolts, a
      // beacon on the roof.
      const body = kit.sculpt('vaultBody', () => loftData([
        { t: 0.24, w: 1.3, h: 1.2, n: 8 }, { t: 0.5, w: 1.2, h: 1.1, n: 8 }, { t: 2.3, w: 1.2, h: 1.1, n: 8 }, { t: 2.5, w: 1.3, h: 1.2, n: 8 },
      ], 'y', 16));
      kit.part(body, pal.steel, root);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(pal.metal, root, [sx * 1.2, 1.37, sz * 1.08], [0.22, 2.3, 0.22]);
      box(pal.metal, root, [0, 2.56, 0], [2.7, 0.14, 2.5]);
      kit.part('cyl8', pal.metal, root, { pos: [0, 1.35, 1.2], rot: [Math.PI / 2, 0, 0], scale: [1.5, 0.14, 1.5] });
      lit(root, 'torusThin', [0, 1.35, 1.29], [1.6, 1.6, 1.6], [Math.PI / 2, 0, 0]);
      const wheel = kit.node('vaultWheel', root, [0, 1.35, 1.36]);
      kit.part('torusThin', pal.steel, wheel, { rot: [Math.PI / 2, 0, 0], scale: [0.8, 3, 0.8] });
      for (let i = 0; i < 4; i++) box(pal.steel, wheel, [0, 0, 0], [0.06, 0.8, 0.06], [0, 0, (i * Math.PI) / 4]);
      kit.part('cyl8', pal.graphite, wheel, { rot: [Math.PI / 2, 0, 0], scale: [0.22, 0.1, 0.22] });
      for (const s of [-1, 1]) {
        box(pal.graphite, root, [s * 0.95, 1.35, 1.25], [0.3, 0.14, 0.12]);
        lit(root, 'box', [s * 0.95, 1.35, 1.32], [0.16, 0.05, 0.012]);
        box(pal.graphite, root, [-0.9, 1.35 + s * 0.45, 1.24], [0.2, 0.3, 0.14]);
      }
      const beacon = kit.node('vaultBeacon', spin, [0, 3.0, 0]);
      kit.part('cyl8', pal.graphite, root, { pos: [0, 2.7, 0], scale: [0.4, 0.14, 0.4] });
      lit(beacon, 'box', [0, 0, 0], [0.42, 0.42, 0.42], [0.6, 0.6, 0]);
      focusY = 1.4;
      anim = (t, k) => {
        wheel.rotation.z = Math.sin(t * 0.4) * 0.6 * k;
        beacon.position.y = 3.0 + Math.sin(t * 1.6) * 0.08 * k;
      };
      break;
    }
    case 'exit': {
      // Exit rift: a standing gate of two braced pylons around a vertical ring, a membrane disc and counter-rotating
      // ring segments.
      for (const s of [-1, 1]) {
        const pylon = kit.sculpt('exitPylon', () => loftData([
          { t: 0.24, w: 0.34, h: 0.4, n: 6 }, { t: 1.2, w: 0.26, h: 0.32, n: 6 }, { t: 3.6, w: 0.2, h: 0.26, n: 6 }, { t: 4.4, w: 0.12, h: 0.18, n: 6 },
        ], 'y', 16));
        kit.part(pylon, pal.steel, root, { pos: [s * 2.0, 0, 0] });
        lit(root, 'box', [s * 1.9, 2.3, 0], [0.03, 2.8, 0.05]);
        box(pal.metal, root, [s * 1.85, 2.25, 0], [0.5, 0.18, 0.22]);
        box(pal.graphite, root, [s * 2.0, 0.4, 0], [0.8, 0.3, 0.7]);
      }
      lit(root, 'torus', [0, 2.25, 0], [3.3, 3.3, 3.3], [Math.PI / 2, 0, 0]);
      // Membrane: the animated rift shader of the arena gates and the HQ launch ring (seen from both sides).
      rift = createRiftMaterial(scene, 'exitMembrane', new Color3(1.3, 0.35, 2.0), 7.3);
      const disc = MeshBuilder.CreateDisc('exitMembrane', { radius: 1.55, tessellation: 48 }, scene);
      disc.material = rift;
      disc.parent = root;
      disc.position.set(0, 2.25, 0);
      disc.isPickable = false;
      const segs = kit.node('exitSegments', root, [0, 2.25, 0]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        lit(segs, 'box', [Math.sin(a) * 1.9, Math.cos(a) * 1.9, 0], [0.5, 0.08, 0.08], [0, 0, -a + Math.PI / 2]);
      }
      focusY = 2;
      anim = (t, k) => {
        segs.rotation.z = t * 0.6 * Math.max(k, 0.4);
        rift?.setFloat('time', t);
      };
      break;
    }
  }
  let used = false;
  return {
    root,
    spin,
    glow,
    focusY,
    setUsed(u: boolean) {
      used = u;
      glowMat.emissiveColor.set(...(u ? (tint.map((c) => c * 0.18) as P) : tint));
    },
    update(t: number) {
      const k = used ? 0.15 : 1;
      spin.rotation.y = t * 0.8 * k;
      anim(t, k);
    },
    dispose() {
      root.dispose(false, false);
      glowMat.dispose();
      dimMat.dispose();
      rift?.dispose();
    },
  };
}
