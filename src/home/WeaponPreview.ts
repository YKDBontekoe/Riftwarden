import {
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  Vector3,
} from '@babylonjs/core';
import { rarity } from '../loot/rarity';
import type { ItemInstance } from '../loot/types';
import { WeaponAnimator } from '../weapons/animator';
import { buildWeaponModel, type WeaponRig } from '../weapons/model';
import { captureEnvironment } from '../visuals/envCapture';

/**
 * 3D weapon inspection stage (HQ terminals). Runs a tiny dedicated engine on its own
 * canvas inside the terminal UI, because the terminal overlay blurs the main canvas.
 * Uses the exact same model builder as the first-person viewmodel. The model is rebuilt
 * only when the weapon's build or installed modules change; everything (engine, scene,
 * textures) is released by dispose().
 */
export class WeaponPreview {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private rig: WeaponRig | null = null;
  private anim: WeaponAnimator | null = null;
  private key = '';
  private idle = 0;
  private disposed = false;
  /** Number of model (re)builds (tests). */
  builds = 0;

  constructor(canvas: HTMLCanvasElement, loop = true) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, antialias: true }, true);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.025, 0.035, 0.045, 1);
    scene.skipPointerMovePicking = true;

    const cam = new ArcRotateCamera('previewCam', Math.PI * 0.84, 1.25, 1.2, new Vector3(0, 0.02, 0), scene);
    cam.minZ = 0.02;
    cam.fov = 0.6;
    cam.lowerRadiusLimit = 0.35;
    cam.upperRadiusLimit = 2.4;
    cam.wheelPrecision = 180;
    cam.pinchPrecision = 300;
    cam.panningSensibility = 0;
    cam.lowerBetaLimit = 0.25;
    cam.upperBetaLimit = Math.PI - 0.25;
    cam.attachControl(canvas, true);
    this.camera = cam;
    canvas.addEventListener('pointerdown', () => (this.idle = 0));
    canvas.addEventListener('wheel', () => (this.idle = 0), { passive: true });

    // Studio: key, rim and cool fill lights; softboxes captured into the reflection env.
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
    const floor = MeshBuilder.CreateDisc('pvFloor', { radius: 1.2, tessellation: 48 }, scene);
    floor.rotation.x = Math.PI / 2;
    floor.position.y = -0.16;
    const fm = new PBRMaterial('pvFloorMat', scene);
    fm.albedoColor = new Color3(0.02, 0.025, 0.03);
    fm.metallic = 0.4;
    fm.roughness = 0.35;
    floor.material = fm;
    const ring = MeshBuilder.CreateTorus('pvRing', { diameter: 1.6, thickness: 0.006, tessellation: 64 }, scene);
    ring.position.y = -0.158;
    ring.material = glow('pvRingMat', [0.037, 0.082, 0.108]);
    studio.push(floor, ring);
    // Softboxes double as visible studio lights and as the reflection environment.
    captureEnvironment(scene, studio, [], new Vector3(0, 0.1, 0), 128);

    const pipe = new DefaultRenderingPipeline('pvPipe', true, scene, [cam]);
    pipe.samples = 4;
    pipe.bloomEnabled = true;
    pipe.bloomThreshold = 1;
    pipe.bloomWeight = 0.35;
    pipe.bloomKernel = 48;
    pipe.imageProcessingEnabled = true;
    pipe.imageProcessing.toneMappingEnabled = true;
    pipe.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipe.imageProcessing.exposure = 1.1;
    pipe.imageProcessing.vignetteEnabled = true;
    pipe.imageProcessing.vignetteWeight = 1.6;

    if (loop) {
      this.engine.runRenderLoop(() => {
        if (this.disposed) return;
        this.frame(this.engine.getDeltaTime() / 1000);
        scene.render();
      });
    }
  }

  /** Show a weapon (null clears). Rebuilds only when the look changed. */
  show(item: ItemInstance | null): void {
    const key = item ? JSON.stringify([item.uid, item.build, item.socketed.map((m) => m?.uid ?? null), item.rarity]) : '';
    if (key === this.key) return;
    const sameWeapon = !!item && this.key.startsWith(JSON.stringify([item.uid]).slice(0, -1));
    this.key = key;
    this.rig?.dispose();
    this.rig = null;
    this.anim = null;
    if (!item?.build) return;
    this.rig = buildWeaponModel(this.scene, item.build, item.socketed, { name: 'pv', mount: false }, rarity(item.rarity).index);
    this.anim = new WeaponAnimator(this.rig);
    this.builds++;
    const mid = (this.rig.front + this.rig.rear) / 2;
    const len = this.rig.front - this.rig.rear;
    this.rig.root.position.set(0, 0, -mid);
    if (!sameWeapon) {
      const halfWidth = Math.tan(this.camera.fov / 2) * this.engine.getAspectRatio(this.camera);
      this.idle = 0;
      this.camera.target.set(0, 0.02, 0);
      this.camera.radius = Math.max(0.56, len * 1.12, len * 0.55 / halfWidth);
      this.camera.alpha = Math.PI * 0.84;
      this.camera.beta = 1.25;
    }
  }

  /** Idle presentation: slow turntable after a few seconds without input, live parts animate. */
  frame(dt: number): void {
    const d = Math.min(0.1, Math.max(0, dt));
    this.idle += d;
    if (this.idle > 4) this.camera.alpha += d * 0.25;
    this.anim?.update({ dt: d, lookDx: 0, lookDy: 0, speed: 0, grounded: true, sprinting: false, dashing: false, verticalSpeed: 0, heat: 0, overheated: false, charge: 0, active: 0, holster: 0 });
    if (this.rig) {
      // The animator moves the slide/fins only; keep the root still on the stage.
      this.rig.root.rotation.set(0, 0, 0);
    }
  }

  get meshCount(): number {
    return this.scene.meshes.length;
  }

  /**
   * Release engine + scene. If shaders are still compiling (the terminal was closed right
   * after opening), wait for readiness first (bounded): disposing mid-compile makes the
   * pending compile callbacks touch a dead scene.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop();
    let done = false;
    const kill = () => {
      if (done) return;
      done = true;
      this.scene.dispose();
      this.engine.dispose();
    };
    if (this.scene.isReady()) kill();
    else {
      this.scene.executeWhenReady(kill);
      setTimeout(kill, 8000);
      // Keep the scene compiling while it waits (the render loop is stopped).
      const pump = () => {
        if (done) return;
        try {
          this.scene.render();
        } catch {
          /* best effort */
        }
        setTimeout(pump, 50);
      };
      pump();
    }
  }
}
