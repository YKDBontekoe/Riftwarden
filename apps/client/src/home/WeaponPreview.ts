import '@riftwarden/game/babylonSideEffects';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { Scene } from '@babylonjs/core/scene';
import { rarity } from '@riftwarden/rules/loot/rarity';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { WeaponAnimator } from '@riftwarden/game/weapons/animator';
import { buildWeaponModel, type WeaponRig } from '@riftwarden/game/weapons/model';
import { buildItemModel, type ItemModel, lookOf } from '@riftwarden/game/loot/itemModels';
import { buildStudio } from './studio';

/**
 * 3D item inspection stage (HQ terminals). Weapons show their live procedural model; every
 * other item its sculpt from loot/itemModels (the same model the arena drops show). Runs a tiny dedicated engine on its own
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
  private model: ItemModel | null = null;
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

    buildStudio(scene);

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
    const key = item ? JSON.stringify([item.uid, item.build, item.socketed.map((m) => m?.uid ?? null), item.rarity, item.weapon?.element, item.uniqueId]) : '';
    if (key === this.key) return;
    const sameWeapon = !!item && this.key.startsWith(JSON.stringify([item.uid]).slice(0, -1));
    this.key = key;
    this.rig?.dispose();
    this.rig = null;
    this.model?.dispose();
    this.model = null;
    this.anim = null;
    if (item && item.category !== 'weapon') {
      this.model = buildItemModel(this.scene, lookOf(item), { size: 0.46, name: 'pvItem' });
      this.builds++;
      if (!sameWeapon) this.frameAt(0.62);
      return;
    }
    if (!item?.build) return;
    this.rig = buildWeaponModel(this.scene, item.build, item.socketed, { name: 'pv', mount: false, element: item.weapon?.element, uniqueId: item.uniqueId }, rarity(item.rarity).index);
    this.anim = new WeaponAnimator(this.rig);
    this.builds++;
    const mid = (this.rig.front + this.rig.rear) / 2;
    const len = this.rig.front - this.rig.rear;
    this.rig.root.position.set(0, 0, -mid);
    if (!sameWeapon) {
      const halfWidth = Math.tan(this.camera.fov / 2) * this.engine.getAspectRatio(this.camera);
      this.frameAt(Math.max(0.56, len * 1.12, len * 0.55 / halfWidth));
    }
  }

  private frameAt(radius: number): void {
    this.idle = 0;
    this.camera.target.set(0, 0.02, 0);
    this.camera.radius = radius;
    this.camera.alpha = Math.PI * 0.84;
    this.camera.beta = 1.25;
  }

  /** Idle presentation: slow turntable after a few seconds without input, live parts animate. */
  frame(dt: number): void {
    const d = Math.min(0.1, Math.max(0, dt));
    this.idle += d;
    if (this.idle > 4 && !this.model) this.camera.alpha += d * 0.25;
    // Gear turns on the stage until the player grabs it.
    if (this.model && this.idle > 0.5) this.model.root.rotation.y += d * 0.6;
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
