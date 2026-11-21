import { type Camera } from '@babylonjs/core/Cameras/camera';
import { Constants } from '@babylonjs/core/Engines/constants';
import { type Engine } from '@babylonjs/core/Engines/engine';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline';
import { type Scene } from '@babylonjs/core/scene';

/** Exposure and contrast are uniforms. Their shader variants only change at unity. */
class CameraGrade extends ImageProcessingConfiguration {
  private uniformOnly = false;

  animate(exposure: number, contrast: number): void {
    this.uniformOnly = (this.exposure === 1) === (exposure === 1) && (this.contrast === 1) === (contrast === 1);
    this.exposure = exposure;
    this.contrast = contrast;
    this.uniformOnly = false;
  }

  protected override _updateParameters(): void {
    if (!this.uniformOnly) super._updateParameters();
  }
}

/**
 * Post-processing stack.
 * - High: SSAO (contact shadows) and, in the arena, screen-space reflections on wet surfaces.
 * - All presets: HDR bloom, ACES tone mapping, filmic grade, vignette, grain, subtle chromatic
 *   aberration that spikes on hits/explosions, and a desaturated cool grade in tactical mode.
 */
export class PostFx {
  readonly pipeline: DefaultRenderingPipeline;
  private ssao: SSAO2RenderingPipeline | null = null;
  private ssr: SSRRenderingPipeline | null = null;
  private aberration = 0;
  private readonly grade = new CameraGrade();
  /** Per-location grade baselines (the HQ uses a calmer, brighter look). */
  baseExposure = 1.02;
  baseGrain = 0.30;
  baseContrast = 1.08;
  baseVignette = 0.68;
  /** Situation mood offsets (see MoodDirector); zero in calm play and in the HQ. */
  mood = { exposure: 0, contrast: 0, vignette: 0 };

  constructor(scene: Scene, engine: Engine, camera: Camera, high: boolean, wetReflections = false) {
    const supportsGBuffer = engine.getCaps().drawBuffersExtension && engine.webGLVersion >= 2;
    if (high && supportsGBuffer) {
      try {
        const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera], true, Constants.TEXTURETYPE_HALF_FLOAT);
        ssao.radius = 1.4;
        ssao.totalStrength = 1.18;
        ssao.base = 0.12;
        ssao.samples = 12;
        ssao.maxZ = 120;
        ssao.minZAspect = 0.4;
        ssao.expensiveBlur = true;
        ssao.bilateralSamples = 8;
        this.ssao = ssao;
      } catch (e) {
        console.warn('SSAO unavailable', e);
      }
    }
    if (high && supportsGBuffer && wetReflections) {
      try {
        const ssr = new SSRRenderingPipeline('ssr', scene, [camera], true, Constants.TEXTURETYPE_HALF_FLOAT);
        ssr.strength = 0.36;
        ssr.reflectionSpecularFalloffExponent = 2.2;
        ssr.step = 1;
        ssr.maxSteps = 82;
        ssr.maxDistance = 32;
        ssr.thickness = 0.13;
        ssr.selfCollisionNumSkip = 2;
        ssr.ssrDownsample = 1;
        ssr.blurDispersionStrength = 0.055;
        ssr.blurDownsample = 1;
        ssr.roughnessFactor = 0.045;
        ssr.reflectivityThreshold = 0.048;
        ssr.enableSmoothReflections = true;
        ssr.attenuateFacingCamera = true;
        ssr.attenuateScreenBorders = true;
        ssr.attenuateIntersectionDistance = true;
        ssr.attenuateBackfaceReflection = true;
        ssr.clipToFrustum = true;
        ssr.useFresnel = true;
        // Use the captured environment on misses. Blurring the scene color on misses
        // spreads bright foreground particles into square highlights on reflective surfaces.
        ssr.environmentTextureIsProbe = true;
        scene.onEnvironmentTextureChangedObservable.add((texture) => {
          ssr.environmentTexture = texture instanceof CubeTexture ? texture : null;
        });
        this.ssr = ssr;
      } catch (e) {
        console.warn('SSR unavailable', e);
      }
    }

    const p = new DefaultRenderingPipeline('pipe', true, scene, [camera]);
    this.pipeline = p;
    p.samples = high ? 2 : 1;
    p.fxaaEnabled = true;
    p.bloomEnabled = true;
    p.bloomThreshold = 1.0;
    p.bloomWeight = high ? 0.20 : 0.18;
    p.bloomKernel = high ? 65 : 46;
    p.bloomScale = 0.5;
    // FXAA softens the image; sharpen on every preset (stronger where there is no MSAA) to keep it crisp.
    p.sharpenEnabled = true;
    p.sharpen.edgeAmount = high ? 0.045 : 0.115;
    p.chromaticAberrationEnabled = true;
    p.chromaticAberration.aberrationAmount = 0;
    p.chromaticAberration.radialIntensity = 1.2;
    p.grainEnabled = true;
    p.grain.intensity = this.baseGrain;
    p.grain.animated = true;

    // Scene-wide image processing changes invalidate every material. Give the camera
    // pass its own configuration and reattach it when settings rebuild the pipeline.
    const ip = this.grade;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = this.baseExposure;
    ip.contrast = this.baseContrast;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = this.baseVignette;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0.0, 0.01, 0.02, 1);
    ip.vignetteCameraFov = 0.8;
    ip.colorCurvesEnabled = true;
    const cc = new ColorCurves();
    // Teal shadows, warm highlights: classic sci-fi grade.
    cc.shadowsHue = 205;
    cc.shadowsDensity = 14;
    cc.shadowsSaturation = 10;
    cc.highlightsHue = 35;
    cc.highlightsDensity = 10;
    cc.highlightsSaturation = 8;
    cc.globalSaturation = 10;
    ip.colorCurves = cc;
    p.imageProcessing.imageProcessingConfiguration = ip;
    p.onBuildObservable.add(() => { p.imageProcessing.imageProcessingConfiguration = ip; });
  }

  /** 0..1 carried overspeed of the drone (dash, boost): a little radial aberration and vignette for speed. */
  speed = 0;

  /** Brief lens punch (explosions near the player, taking hits). */
  kick(amount: number): void {
    if (this.reduceMotion) return;
    this.aberration = Math.min(1.5, this.aberration + amount);
  }

  /** M7 settings: bloom toggle, reduced motion (no aberration kicks). */
  reduceMotion = false;
  setOptions(o: { bloom: boolean; reduceMotion: boolean }): void {
    this.reduceMotion = o.reduceMotion;
    this.pipeline.bloomEnabled = o.bloom;
    this.pipeline.chromaticAberrationEnabled = !o.reduceMotion;
  }

  /**
   * @param tactical 0..1 tactical-mode blend
   * @param hurt 0..1 recent damage
   * @param lightning 0..1 sky flash
   */
  update(dt: number, tactical: number, hurt: number, lightning: number): void {
    this.aberration = Math.max(0, this.aberration - dt * 2.5);
    const p = this.pipeline;
    const ip = this.grade;
    const cc = ip.colorCurves!;
    cc.globalSaturation = 10 - 70 * tactical - 20 * hurt;
    cc.globalHue = 220;
    cc.globalDensity = 18 * tactical;
    const speed = this.reduceMotion ? 0 : this.speed;
    p.chromaticAberration.aberrationAmount = 16 * this.aberration + 3 * tactical + 9 * hurt + 5 * speed;
    ip.animate(this.baseExposure + lightning * 0.05 + this.mood.exposure, this.baseContrast + this.mood.contrast);
    ip.vignetteWeight = this.baseVignette + this.mood.vignette + 0.9 * speed;
    p.grain.intensity = this.baseGrain + tactical * 2.5;
  }

  /** Meshes that should not write into the geometry buffer (the first-person viewmodel). */
  get hasScreenSpace(): boolean {
    return !!(this.ssao || this.ssr);
  }
}
