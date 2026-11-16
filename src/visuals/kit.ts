import { type AbstractMesh, Mesh, MeshBuilder, type Scene, type StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';

export type Shape = 'box' | 'cyl' | 'cyl6' | 'cyl8' | 'sphere' | 'ico' | 'cone' | 'torus' | 'torusThin';

export interface PartOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  name?: string;
}

/**
 * Procedural model kit. Every part is a unit primitive scaled per instance; one hidden
 * source mesh exists per (shape, material) pair and all models use GPU instances of it.
 * In "unique" mode (for previews/ghosts) parts are real meshes with an override material.
 */
export class Kit {
  private templates = new Map<string, Mesh>();
  private root: TransformNode;
  shadowSink: ((m: AbstractMesh) => void) | null = null;

  constructor(private scene: Scene) {
    this.root = new TransformNode('kitTemplates', scene);
  }

  private makeShape(shape: Shape): Mesh {
    const s = this.scene;
    switch (shape) {
      case 'box':
        return MeshBuilder.CreateBox('k_box', { size: 1 }, s);
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
    }
  }

  template(shape: Shape, mat: StandardMaterial): Mesh {
    const key = `${shape}|${mat.uniqueId}`;
    let t = this.templates.get(key);
    if (!t) {
      t = this.makeShape(shape);
      t.material = mat;
      t.parent = this.root;
      t.isPickable = false;
      t.isVisible = false;
      t.position.y = -500;
      t.alwaysSelectAsActiveMesh = false;
      this.templates.set(key, t);
    }
    return t;
  }

  /** Create a part. If `unique` material is given, makes a standalone clone with that material. */
  part(shape: Shape, mat: StandardMaterial, parent: TransformNode, o: PartOpts = {}, unique?: StandardMaterial): AbstractMesh {
    const t = this.template(shape, mat);
    let m: AbstractMesh;
    if (unique) {
      const c = t.clone(o.name ?? 'part', null, true)!;
      c.material = unique;
      c.isVisible = true;
      m = c;
    } else {
      m = t.createInstance(o.name ?? 'part');
    }
    m.parent = parent;
    m.isPickable = false;
    m.position.set(...(o.pos ?? [0, 0, 0]));
    if (o.rot) m.rotation.set(...o.rot);
    m.scaling.set(...(o.scale ?? [1, 1, 1]));
    if (this.shadowSink && !unique) this.shadowSink(m);
    return m;
  }

  node(name: string, parent: TransformNode | null, pos: [number, number, number] = [0, 0, 0]): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = parent;
    n.position = new Vector3(...pos);
    return n;
  }
}
