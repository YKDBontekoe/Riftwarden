import { type AbstractMesh, Color3, type Scene, type TransformNode } from '@babylonjs/core';
import type { Kit } from './kit';
import { type Palette, unlit } from './materials';

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

/**
 * Procedural station rigs from kit primitives (instanced; unlit glows feed bloom). Visual only: no colliders,
 * the drone flies through them like the rest of the set dressing.
 */
export function buildStation(scene: Scene, kit: Kit, pal: Palette, kind: StationKind): StationRig {
  const root = kit.node(`station_${kind}`, null);
  const spin = kit.node('spin', root);
  const tint = TINT[kind];
  const glowMat = unlit(scene, `stationGlow_${kind}`, new Color3(...tint));
  const dimMat = unlit(scene, `stationDim_${kind}`, new Color3(tint[0] * 0.18, tint[1] * 0.18, tint[2] * 0.18));
  const glow: AbstractMesh[] = [];
  const g = (m: AbstractMesh) => (glow.push(m), m);
  let focusY = 1.6;
  // Common plinth: a chamfered plate with a glowing ring.
  kit.part('cyl8', pal.graphite, root, { pos: [0, 0.12, 0], scale: [3.2, 0.24, 3.2] });
  g(kit.part('torusThin', glowMat, root, { pos: [0, 0.26, 0], scale: [3.1, 3.1, 3.1], shadow: false }));
  switch (kind) {
    case 'merchant': {
      kit.part('box', pal.panel, root, { pos: [0, 0.75, 0], scale: [1.8, 1.1, 0.9] });
      kit.part('box', pal.graphite, root, { pos: [0, 1.36, -0.1], scale: [1.9, 0.12, 1.1] });
      g(kit.part('box', glowMat, root, { pos: [0, 0.9, 0.46], scale: [1.5, 0.08, 0.02], shadow: false }));
      kit.part('box', pal.metal, root, { pos: [-0.8, 2.1, -0.3], scale: [0.08, 1.6, 0.08] });
      kit.part('box', pal.metal, root, { pos: [0.8, 2.1, -0.3], scale: [0.08, 1.6, 0.08] });
      g(kit.part('box', glowMat, root, { pos: [0, 2.85, -0.3], scale: [1.7, 0.32, 0.05], shadow: false }));
      g(kit.part('ico', glowMat, spin, { pos: [0, 2.15, 0], scale: [0.42, 0.42, 0.42], shadow: false }));
      focusY = 1.5;
      break;
    }
    case 'forge': {
      kit.part('box', pal.steel, root, { pos: [0, 0.6, 0], scale: [1.6, 0.9, 1.1] });
      kit.part('box', pal.metal, root, { pos: [0, 1.15, 0], scale: [2.1, 0.22, 0.7] });
      kit.part('cone', pal.metal, root, { pos: [1.15, 1.15, 0], rot: [0, 0, -Math.PI / 2], scale: [0.5, 0.6, 0.5] });
      g(kit.part('box', glowMat, root, { pos: [0, 0.6, 0.56], scale: [1.2, 0.35, 0.02], shadow: false }));
      kit.part('cyl', pal.rust, root, { pos: [-1.3, 1.4, -0.6], scale: [0.35, 2.4, 0.35] });
      g(kit.part('sphere', glowMat, spin, { pos: [0, 1.75, 0], scale: [0.36, 0.36, 0.36], shadow: false }));
      focusY = 1.3;
      break;
    }
    case 'rest': {
      kit.part('box', pal.white, root, { pos: [0, 0.5, 0], scale: [2.2, 0.5, 1.1] });
      kit.part('box', pal.glazing, root, { pos: [0, 0.95, 0], scale: [2, 0.45, 0.95] });
      g(kit.part('box', glowMat, root, { pos: [0, 0.78, 0.56], scale: [1.8, 0.05, 0.02], shadow: false }));
      g(kit.part('box', glowMat, spin, { pos: [0, 2.1, 0], scale: [0.18, 0.62, 0.18], shadow: false }));
      g(kit.part('box', glowMat, spin, { pos: [0, 2.1, 0], scale: [0.62, 0.18, 0.18], shadow: false }));
      focusY = 1.2;
      break;
    }
    case 'event': {
      kit.part('cone4', pal.enemyDark, root, { pos: [0, 1.6, 0], scale: [0.9, 3, 0.9] });
      g(kit.part('torus', glowMat, spin, { pos: [0, 2.2, 0], rot: [Math.PI / 2, 0, 0], scale: [1.6, 1.6, 1.6], shadow: false }));
      g(kit.part('torusThin', glowMat, spin, { pos: [0, 2.2, 0], rot: [0.4, 0, 0.9], scale: [2.2, 2.2, 2.2], shadow: false }));
      g(kit.part('ico', glowMat, spin, { pos: [0, 3.5, 0], scale: [0.3, 0.3, 0.3], shadow: false }));
      focusY = 2;
      break;
    }
    case 'vault': {
      kit.part('box', pal.steel, root, { pos: [0, 1.2, 0], scale: [2.4, 2.2, 2.4] });
      kit.part('box', pal.metal, root, { pos: [0, 2.4, 0], scale: [2.6, 0.2, 2.6] });
      kit.part('cyl8', pal.metal, root, { pos: [0, 1.2, 1.23], rot: [Math.PI / 2, 0, 0], scale: [1.4, 0.12, 1.4] });
      g(kit.part('torusThin', glowMat, root, { pos: [0, 1.2, 1.31], rot: [Math.PI / 2, 0, 0], scale: [1.5, 1.5, 1.5], shadow: false }));
      g(kit.part('box', glowMat, spin, { pos: [0, 3.2, 0], scale: [0.5, 0.5, 0.5], shadow: false }));
      focusY = 1.4;
      break;
    }
    case 'exit': {
      kit.part('cyl8', pal.steel, root, { pos: [-1.9, 1.8, 0], scale: [0.3, 3.6, 0.3] });
      kit.part('cyl8', pal.steel, root, { pos: [1.9, 1.8, 0], scale: [0.3, 3.6, 0.3] });
      g(kit.part('torus', glowMat, spin, { pos: [0, 2.2, 0], rot: [0, 0, 0], scale: [3.2, 3.2, 1.4], shadow: false }));
      g(kit.part('cyl', dimMat, spin, { pos: [0, 2.2, 0], rot: [Math.PI / 2, 0, 0], scale: [2.9, 0.04, 2.9], shadow: false }));
      focusY = 2;
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
      for (const m of glow) m.material = u ? dimMat : glowMat;
    },
    update(t: number) {
      const k = used ? 0.15 : 1;
      spin.rotation.y = t * 0.8 * k;
      spin.position.y = Math.sin(t * 1.6) * 0.08 * k;
    },
    dispose() {
      root.dispose(false, false);
      glowMat.dispose();
      dimMat.dispose();
    },
  };
}
