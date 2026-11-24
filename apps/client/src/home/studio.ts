import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { type Scene } from '@babylonjs/core/scene';
import { captureEnvironment } from '@riftwarden/game/visuals/envCapture';

/**
 * Product-shot studio shared by the item inspection stage and the thumbnail renderer: key,
 * rim and cool fill lights, plus softboxes captured once into the reflection environment.
 * With `floor` the stage gets a dark disc and a faint ring; with `visible: false` the dome and
 * softboxes are invisible to cameras (transparent thumbnails keep the reflections).
 */
export function buildStudio(scene: Scene, { floor = true, visible = true, floorY = -0.16 }: { floor?: boolean; visible?: boolean; floorY?: number } = {}): Mesh[] {
  const hemi = new HemisphericLight('pvFill', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.35;
  hemi.groundColor = new Color3(0.08, 0.09, 0.1);
  const key = new DirectionalLight('pvKey', new Vector3(0.6, -0.7, 0.4), scene);
  key.intensity = 2.4;
  key.diffuse = new Color3(1, 0.95, 0.9);
  const rim = new DirectionalLight('pvRim', new Vector3(-0.4, -0.2, -0.9), scene);
  rim.intensity = 1.6;
  rim.diffuse = new Color3(0.6, 0.85, 1);

  const studio: Mesh[] = [];
  const glow = (name: string, c: [number, number, number]) => {
    const m = new PBRMaterial(name, scene);
    m.unlit = true;
    m.albedoColor = Color3.Black();
    m.emissiveColor = new Color3(...c);
    m.backFaceCulling = false;
    return m;
  };
  const dome = MeshBuilder.CreateSphere('pvDome', { diameter: 12, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  dome.material = glow('pvDomeMat', [0.035, 0.05, 0.065]);
  studio.push(dome);
  for (const [pos, size, c] of [
    [[2.5, 2.5, -1.5], [3, 1.4], [3, 3, 3]],
    [[-3, 1.2, 2], [2, 2.5], [1.2, 1.8, 2.4]],
    [[0, 4.5, 0], [4, 4], [1.6, 1.6, 1.7]],
  ] as [[number, number, number], [number, number], [number, number, number]][]) {
    const p = MeshBuilder.CreatePlane('pvSoftbox', { width: size[0], height: size[1] }, scene);
    p.position.set(...pos);
    p.lookAt(Vector3.Zero());
    p.material = glow('pvSoftboxMat', c);
    studio.push(p);
  }
  const stage: Mesh[] = [];
  if (floor) {
    const disc = MeshBuilder.CreateDisc('pvFloor', { radius: 1.2, tessellation: 48 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = floorY;
    const fm = new PBRMaterial('pvFloorMat', scene);
    fm.albedoColor = new Color3(0.02, 0.025, 0.03);
    fm.metallic = 0.4;
    fm.roughness = 0.35;
    disc.material = fm;
    const ring = MeshBuilder.CreateTorus('pvRing', { diameter: 1.6, thickness: 0.006, tessellation: 64 }, scene);
    ring.position.y = floorY + 0.002;
    ring.material = glow('pvRingMat', [0.037, 0.082, 0.108]);
    stage.push(disc, ring);
    studio.push(disc, ring);
  }
  // Softboxes double as visible studio lights and as the reflection environment.
  captureEnvironment(scene, studio, [], new Vector3(0, 0.1, 0), 128);
  // Hidden studio: the capture is asynchronous, so the meshes stay enabled for the probe and
  // only leave the camera's layer (cameras default to 0x0fffffff).
  if (!visible) for (const m of studio) if (!stage.includes(m)) m.layerMask = 0x10000000;
  return studio;
}
