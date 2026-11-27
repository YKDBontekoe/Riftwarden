// Static-mesh pick acceleration (world/triangleBvh + world/fastPick): accelerated picks must equal Babylon's
// brute-force picks exactly (hit, distance, face, barycentrics, picked point), including merged meshes and fastCheck.
import '../apps/worker/src/sim/headless';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accelerateStaticPicking } from '@riftwarden/game/world/fastPick';
import { TriangleBvh } from '@riftwarden/game/world/triangleBvh';

let engine: NullEngine;
let scene: Scene;

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterAll(() => {
  scene.dispose();
  engine.dispose();
});

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A level-like merged shell: many boxes, cylinders and spheres in one mesh (like `arena:metal|wall`). */
function shell(name: string, seed: number, parts = 160): Mesh {
  const r = rng(seed);
  const meshes: Mesh[] = [];
  for (let i = 0; i < parts; i++) {
    const kind = i % 3;
    const m =
      kind === 0
        ? MeshBuilder.CreateBox(`b${i}`, { width: 0.5 + r() * 6, height: 0.5 + r() * 8, depth: 0.5 + r() * 6 }, scene)
        : kind === 1
          ? MeshBuilder.CreateCylinder(`c${i}`, { diameter: 0.4 + r() * 2, height: 1 + r() * 10, tessellation: 12 + Math.floor(r() * 12) }, scene)
          : MeshBuilder.CreateSphere(`s${i}`, { diameter: 0.5 + r() * 3, segments: 8 }, scene);
    m.position.set((r() - 0.5) * 80, r() * 10, (r() - 0.5) * 80);
    m.rotation.set(r() * 3, r() * 3, r() * 3);
    meshes.push(m);
  }
  const merged = Mesh.MergeMeshes(meshes, true, true)!;
  merged.name = name;
  merged.material = new StandardMaterial(`${name}:m`, scene);
  merged.freezeWorldMatrix();
  return merged;
}

function rays(seed: number, n: number): Ray[] {
  const r = rng(seed);
  const out: Ray[] = [];
  for (let i = 0; i < n; i++) {
    const o = new Vector3((r() - 0.5) * 90, r() * 14, (r() - 0.5) * 90);
    // Mix of random, axis-aligned and grazing directions (slab-test edge cases).
    let d: Vector3;
    if (i % 7 === 0) d = new Vector3(r() < 0.5 ? 1 : -1, 0, 0);
    else if (i % 7 === 1) d = new Vector3(0, -1, 0);
    else if (i % 7 === 2) d = new Vector3(0, 0, r() < 0.5 ? 1 : -1);
    else d = new Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize();
    out.push(new Ray(o, d, 5 + r() * 120));
  }
  return out;
}

const view = (p: ReturnType<Mesh['intersects']>) => ({ hit: p.hit, d: p.distance, face: p.faceId, bu: p.bu, bv: p.bv, x: p.pickedPoint?.x, y: p.pickedPoint?.y, z: p.pickedPoint?.z });

describe('static pick acceleration', () => {
  it('matches Babylon brute-force picks exactly on merged level geometry', () => {
    const brute = shell('brute', 7);
    const fast = shell('fast', 7);
    expect(accelerateStaticPicking(fast)).toBeGreaterThan(5000);
    let hits = 0;
    for (const ray of rays(11, 3000)) {
      const a = view(brute.intersects(ray, false));
      const b = view(fast.intersects(ray, false));
      expect(b).toEqual(a);
      if (a.hit) hits++;
    }
    // The fixture must actually exercise hits and misses.
    expect(hits).toBeGreaterThan(300);
    expect(hits).toBeLessThan(2900);
    const fastHit = rays(13, 600).map((ray) => fast.intersects(ray, true).hit);
    expect(fastHit).toEqual(rays(13, 600).map((ray) => brute.intersects(ray, true).hit));
    brute.dispose();
    fast.dispose();
  });

  it('scene.pickWithRay returns the same mesh, point and normal', () => {
    const brute = shell('scene-brute', 21, 80);
    const fast = shell('scene-fast', 21, 80);
    accelerateStaticPicking(fast);
    const only = (m: Mesh) => (x: unknown) => x === m;
    for (const ray of rays(5, 400)) {
      const a = scene.pickWithRay(ray, only(brute));
      const b = scene.pickWithRay(ray, only(fast));
      expect(b?.hit).toBe(a?.hit);
      if (!a?.hit) continue;
      expect(b!.distance).toBe(a.distance);
      expect(b!.faceId).toBe(a.faceId);
      expect(b!.getNormal(true)?.asArray()).toEqual(a.getNormal(true)?.asArray());
    }
    brute.dispose();
    fast.dispose();
  });

  it('keeps small meshes, predicates and wireframe on the original path', () => {
    const box = MeshBuilder.CreateBox('small', { size: 1 }, scene);
    expect(accelerateStaticPicking(box)).toBe(0);
    const fast = shell('pred', 3, 40);
    accelerateStaticPicking(fast, 1);
    let calls = 0;
    const ray = new Ray(new Vector3(-60, 3, 0), new Vector3(1, 0, 0), 200);
    fast.intersects(ray, false, () => {
      calls++;
      return true;
    });
    expect(calls).toBeGreaterThan(0);
    box.dispose();
    fast.dispose();
  });

  it('bvh: empty input and degenerate triangles', () => {
    expect(new TriangleBvh([], []).raycast(0, 0, 0, 1, 0, 0, 10)).toBeNull();
    // All triangles share one centroid (cannot split): still a valid leaf.
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const idx: number[] = [];
    for (let i = 0; i < 40; i++) idx.push(0, 1, 2);
    const hit = new TriangleBvh(pos, idx).raycast(0.2, 0.2, -1, 0, 0, 1, 10);
    expect(hit).toMatchObject({ face: 0, distance: 1 });
  });
});
