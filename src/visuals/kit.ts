import { beveledBoxData } from './bevel';
import { enableHitFlash, initFlash, registerFlashBuffer } from './hitFlashPlugin';
import { loftData, smoothLatheData } from './sculpt';
import { type AbstractMesh, type Material, Matrix, Mesh, MeshBuilder, PBRMaterial, type Scene, TransformNode, Vector3, type VertexData } from '@babylonjs/core';

export type Shape = 'box' | 'cyl' | 'cyl6' | 'cyl8' | 'sphere' | 'ico' | 'cone' | 'torus' | 'torusThin' | 'arc' | 'cone4' | `s:${string}`;

export interface PartOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  name?: string;
  /** false: never register as a shadow caster (glows, holograms). */
  shadow?: boolean;
}

/**
 * Procedural model kit. Every part is a unit primitive scaled per instance; one hidden
 * source mesh exists per (shape, material) pair and all models use GPU instances of it.
 * In "unique" mode (for previews/ghosts) parts are real meshes with an override material.
 */
export class Kit {
  private templates = new Map<string, Mesh>();
  /** Sculpted shapes (`s:name`): generated once per kit, then instanced like the primitives. */
  private sculpted = new Map<string, () => VertexData>();
  private root: TransformNode;
  shadowSink: ((m: AbstractMesh) => void) | null = null;
  /**
   * While true, new parts are flashable: their templates (kept apart by a `|f` key suffix) register the
   * per-instance hit-flash buffer and their material gets the flash plugin. Enemy rigs are built in this mode.
   */
  flashMode = false;

  /** While true, boxes become softened hard-surface blocks and spheres smooth (enemy rigs). */
  softMode = false;

  /** Run `fn` with softened primitives. */
  soft<T>(fn: () => T): T {
    const prev = this.softMode;
    this.softMode = true;
    try {
      return fn();
    } finally {
      this.softMode = prev;
    }
  }

  /** Primitive substitution in soft mode (registered lazily as sculpted shapes). */
  private softShape(shape: Shape): Shape {
    if (!this.softMode) return shape;
    if (shape === 'box') {
      return this.sculpt('softBox', () => loftData([
        { t: -0.5, w: 0.43, h: 0.43, n: 4 },
        { t: -0.455, w: 0.5, h: 0.5, n: 5 },
        { t: 0.455, w: 0.5, h: 0.5, n: 5 },
        { t: 0.5, w: 0.43, h: 0.43, n: 4 },
      ], 'y', 28));
    }
    if (shape === 'sphere') return this.sculpt('softSphere', () => smoothLatheData(Array.from({ length: 13 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      return [Math.max(0.0005, Math.cos(a) * 0.5), Math.sin(a) * 0.5] as [number, number];
    }), 28));
    return shape;
  }

  /** Run `fn` with flashable parts (enemy rigs, elite hardware, threat marks). */
  flashable<T>(fn: () => T): T {
    const prev = this.flashMode;
    this.flashMode = true;
    try {
      return fn();
    } finally {
      this.flashMode = prev;
    }
  }

  constructor(private scene: Scene) {
    this.root = new TransformNode('kitTemplates', scene);
  }

  /**
   * Register a sculpted shape under `s:name` (first registration wins, so rig builders can call this
   * every time they build). Returns the shape id to pass to part().
   */
  sculpt(name: string, gen: () => VertexData): Shape {
    const id = `s:${name}` as const;
    if (!this.sculpted.has(id)) this.sculpted.set(id, gen);
    return id;
  }

  private makeShape(shape: Shape): Mesh {
    const s = this.scene;
    const gen = this.sculpted.get(shape);
    if (gen) {
      const m = new Mesh(`k_${shape}`, s);
      gen().applyToMesh(m);
      return m;
    }
    switch (shape) {
      case 'box': {
        const m = new Mesh('k_box', s);
        beveledBoxData(1, 1, 1, 0.08).applyToMesh(m);
        return m;
      }
      case 'cyl':
        return MeshBuilder.CreateCylinder('k_cyl', { diameter: 1, height: 1, tessellation: 20 }, s);
      case 'cyl6':
        return MeshBuilder.CreateCylinder('k_cyl6', { diameter: 1, height: 1, tessellation: 6 }, s);
      case 'cyl8':
        return MeshBuilder.CreateCylinder('k_cyl8', { diameter: 1, height: 1, tessellation: 8 }, s);
      case 'cone':
        return MeshBuilder.CreateCylinder('k_cone', { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 16 }, s);
      case 'sphere':
        return MeshBuilder.CreateSphere('k_sph', { diameter: 1, segments: 12 }, s);
      case 'ico':
        return MeshBuilder.CreateIcoSphere('k_ico', { radius: 0.5, subdivisions: 1, flat: true }, s);
      case 'torus':
        return MeshBuilder.CreateTorus('k_tor', { diameter: 1, thickness: 0.12, tessellation: 32 }, s);
      case 'torusThin':
        return MeshBuilder.CreateTorus('k_tor2', { diameter: 1, thickness: 0.05, tessellation: 32 }, s);
      case 'cone4':
        return MeshBuilder.CreateCylinder('k_cone4', { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 4 }, s);
      case 'arc': {
        // 120-degree curved shield panel centred on +Z, double sided, unit radius 0.5, height 1.
        const m = MeshBuilder.CreateCylinder('k_arc', { diameter: 1, height: 1, tessellation: 36, arc: 1 / 3, enclose: false, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, s);
        m.refreshBoundingInfo();
        const c = m.getBoundingInfo().boundingBox.center;
        m.bakeTransformIntoVertices(Matrix.RotationY(-Math.atan2(c.x, c.z)));
        return m;
      }
      default:
        throw new Error(`Unknown kit shape ${shape}`);
    }
  }

  /** Only PBR materials carry the flash plugin. */
  private flashes(mat: Material): boolean {
    return this.flashMode && mat instanceof PBRMaterial;
  }

  template(shape: Shape, mat: Material): Mesh {
    const key = `${shape}|${mat.uniqueId}${this.flashes(mat) ? '|f' : ''}`;
    let t = this.templates.get(key);
    if (!t) {
      t = this.makeShape(shape);
      t.material = mat;
      t.parent = this.root;
      t.isPickable = false;
      t.isVisible = false;
      t.position.y = -500;
      t.alwaysSelectAsActiveMesh = false;
      t.receiveShadows = true;
      if (this.flashes(mat)) {
        enableHitFlash(mat);
        registerFlashBuffer(t);
      }
      this.templates.set(key, t);
    }
    return t;
  }

  /** Compile every (shape, material) template in its instanced variant (no first-sight shader hitches). */
  warmAll(): Promise<unknown> {
    const jobs: Promise<unknown>[] = [];
    for (const t of this.templates.values()) if (t.material) jobs.push(t.material.forceCompilationAsync(t, { useInstances: true }).catch(() => {}));
    return Promise.all(jobs);
  }

  /** Create a part. If `unique` material is given, makes a standalone clone with that material. */
  part(shape: Shape, mat: Material, parent: TransformNode, o: PartOpts = {}, unique?: Material): AbstractMesh {
    shape = this.softShape(shape);
    const t = this.template(shape, mat);
    let m: AbstractMesh;
    if (unique) {
      const c = t.clone(o.name ?? 'part', null, true)!;
      c.material = unique;
      c.isVisible = true;
      m = c;
    } else {
      m = t.createInstance(o.name ?? 'part');
      if (this.flashes(mat)) initFlash(m);
    }
    m.parent = parent;
    m.isPickable = false;
    m.position.set(...(o.pos ?? [0, 0, 0]));
    if (o.rot) m.rotation.set(...o.rot);
    m.scaling.set(...(o.scale ?? [1, 1, 1]));
    if (this.shadowSink && !unique && o.shadow !== false) this.shadowSink(m);
    return m;
  }

  node(name: string, parent: TransformNode | null, pos: [number, number, number] = [0, 0, 0]): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = parent;
    n.position = new Vector3(...pos);
    return n;
  }
}
