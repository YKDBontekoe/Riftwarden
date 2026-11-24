import '@riftwarden/game/babylonSideEffects';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import type { ItemModel } from '@riftwarden/game/loot/itemModels';
import { buildStudio } from './studio';

/**
 * Item / currency thumbnails rendered from the real 3D models (loot/itemModels), so terminal
 * icons match what drops in the arena. One small engine on a detached canvas renders queued
 * jobs one per frame into cached object URLs (transparent PNG); it is released after a short
 * idle period and recreated on demand. The cache (key -> URL) lives for the page session.
 * Off in `?test` unless `&thumbs` (headless suites keep the SVG glyphs and one GL context).
 */
export type ThumbView = 'side' | 'front' | 'top' | 'coin';

interface Job {
  key: string;
  build: (scene: Scene) => ItemModel;
  view: ThumbView;
}

const SIZE = 160;
const IDLE_MS = 20000;
const READY_MS = 20000;
const GLOW_PEAK = 0.62;
const MAX_CACHE = 600;
const VIEWS: Record<ThumbView, { alpha: number; beta: number; yaw: number }> = {
  // Weapons point +z: seen from the left flank (core bay side), muzzle to the right.
  side: { alpha: Math.PI, beta: 1.4, yaw: 0.12 },
  front: { alpha: Math.PI / 2, beta: 1.22, yaw: -0.55 },
  top: { alpha: Math.PI / 2, beta: 0.92, yaw: -0.6 },
  coin: { alpha: Math.PI / 2, beta: 1.08, yaw: -0.5 },
};

/**
 * Unlit accents are HDR (> 1 feeds bloom in the arena); an icon has no bloom and ACES washes bright
 * values to white, so each model's own glow materials are scaled to a peak of GLOW_PEAK (hue kept).
 */
function tame(model: ItemModel): void {
  for (const m of model.meshes) {
    const mat = m.material;
    if (!(mat instanceof PBRMaterial) || !mat.unlit) continue;
    const e = mat.emissiveColor;
    const peak = Math.max(e.r, e.g, e.b);
    if (peak > GLOW_PEAK) e.scaleInPlace(GLOW_PEAK / peak);
  }
}

class ThumbRenderer {
  private cache = new Map<string, string>();
  private queued = new Set<string>();
  private queue: Job[] = [];
  private listeners = new Set<() => void>();
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private ready: Promise<void> | null = null;
  private running = false;
  private idleTimer = 0;
  readonly enabled: boolean;
  /** Rendered thumbnails (tests). */
  renders = 0;

  constructor() {
    const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    this.enabled = typeof document !== 'undefined' && (!params.has('test') || params.has('thumbs'));
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Queue a thumbnail unless cached or queued. Newest requests render first (visible rows). */
  request(key: string, build: Job['build'], view: ThumbView): void {
    if (!this.enabled || this.cache.has(key) || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push({ key, build, view });
    void this.pump();
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const engine = new Engine(canvas, true, { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: true }, false);
    engine.setHardwareScalingLevel(1);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.skipPointerMovePicking = true;
    const ip = scene.imageProcessingConfiguration;
    ip.isEnabled = true;
    // Filmic curve lifts the dark gunmetal; glows are tamed per model (tame()) so ACES keeps their hue.
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.65;
    ip.contrast = 1.15;
    const cam = new ArcRotateCamera('thumbCam', Math.PI / 2, 1.2, 3, Vector3.Zero(), scene);
    cam.fov = 0.42;
    cam.minZ = 0.05;
    buildStudio(scene, { floor: false, visible: false });
    // Icons read at 30-40 px: an extra soft front fill keeps dark gunmetal parts legible.
    const fill = new HemisphericLight('thumbFill', new Vector3(0.3, 0.5, 1), scene);
    fill.intensity = 0.9;
    fill.groundColor = new Color3(0.15, 0.17, 0.2);
    this.engine = engine;
    this.scene = scene;
    this.camera = cam;
    // The reflection environment is captured asynchronously: render until it lands (bounded).
    this.ready = new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = () => {
        if (scene.isDisposed) return resolve();
        scene.render();
        if (scene.environmentTexture || performance.now() - t0 > 4000) resolve();
        else requestAnimationFrame(step);
      };
      step();
    }).then(() => this.warm(scene));
    return this.ready;
  }

  /** Compile the weapon kit's shaders once (first weapon thumbnails would otherwise miss parts). */
  private async warm(scene: Scene): Promise<void> {
    if (!warmBuild) return;
    const model = warmBuild(scene);
    model.root.position.y = -100;
    try {
      await Promise.race([scene.whenReadyAsync(), new Promise((r) => setTimeout(r, READY_MS))]);
    } finally {
      model.dispose();
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    clearTimeout(this.idleTimer);
    try {
      await this.start();
      while (this.queue.length) {
        const job = this.queue.pop()!;
        try {
          const url = await this.render(job);
          this.store(job.key, url);
        } catch (error) {
          console.warn('Thumbnail failed', job.key, error);
        }
        this.queued.delete(job.key);
        // One per frame keeps the page responsive while a long list fills in.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    } finally {
      this.running = false;
      this.idleTimer = window.setTimeout(() => this.release(), IDLE_MS);
    }
  }

  private async render(job: Job): Promise<string> {
    const scene = this.scene!;
    const cam = this.camera!;
    const model = job.build(scene);
    try {
      const v = VIEWS[job.view];
      model.root.rotation.y = v.yaw;
      cam.alpha = v.alpha;
      cam.beta = v.beta;
      tame(model);
      if (job.view === 'side') {
        // Long weapons lie on the icon's diagonal (muzzle up-right) and are framed by length.
        model.root.rotation.x = -0.62;
        const len = Math.max(model.extent.x, model.extent.y, model.extent.z) * model.scale;
        cam.radius = ((len * 0.5 * Math.cos(0.62)) / Math.tan(cam.fov / 2)) * 1.06;
      } else {
        // Frame the bounding sphere of the scaled model.
        const r = Math.hypot(model.extent.x, model.extent.y, model.extent.z) * model.scale * 0.5;
        cam.radius = (r / Math.sin(cam.fov / 2)) * 0.97;
      }
      // Bounded: a material that never reports ready must not stall the queue.
      const ready = await Promise.race([scene.whenReadyAsync().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), READY_MS))]);
      if (!ready) console.warn('Thumbnail rendered before its materials were ready', job.key);
      scene.render();
      this.renders++;
      const blob = await new Promise<Blob | null>((res) => (this.engine!.getRenderingCanvas() as HTMLCanvasElement).toBlob(res, 'image/png'));
      if (!blob) throw new Error('empty canvas');
      return URL.createObjectURL(blob);
    } finally {
      model.dispose();
    }
  }

  private store(key: string, url: string): void {
    this.cache.set(key, url);
    if (this.cache.size > MAX_CACHE) {
      const [old, oldUrl] = this.cache.entries().next().value as [string, string];
      this.cache.delete(old);
      URL.revokeObjectURL(oldUrl);
    }
    for (const fn of this.listeners) fn();
  }

  /** Free the GL context; cached images stay valid. */
  release(): void {
    if (this.running) return;
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
    this.camera = null;
    this.ready = null;
  }

  stats() {
    return { cached: this.cache.size, queued: this.queue.length, renders: this.renders, live: !!this.engine };
  }
}

/** Model compiled once when the renderer starts (set by the UI layer: a stock weapon). */
let warmBuild: ((scene: Scene) => ItemModel) | null = null;
export function setThumbWarmup(build: (scene: Scene) => ItemModel): void {
  warmBuild = build;
}

export const itemThumbs = new ThumbRenderer();
if (typeof window !== 'undefined') (window as unknown as { __thumbs?: ThumbRenderer }).__thumbs = itemThumbs;
