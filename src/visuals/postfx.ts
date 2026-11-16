import {
  type Camera,
  Color4,
  ColorCurves,
  Constants,
  DefaultRenderingPipeline,
  type Engine,
  ImageProcessingConfiguration,
  type Scene,
  SSAO2RenderingPipeline,
  SSRRenderingPipeline,
} from '@babylonjs/core';

/**
 * Post-processing stack.
 * - High: SSAO (contact shadows/grounding) and screen-space reflections on glossy and wet
 *   surfaces, then the HDR chain below.
 * - Both: HDR bloom, ACES tone mapping, filmic grade, vignette, grain, subtle chromatic
 *   aberration that spikes on hits/explosions, and a desaturated cool grade in tactical mode.
 */
export class PostFx {
  readonly pipeline: DefaultRenderingPipeline;
  private ssao: SSAO2RenderingPipeline | null = null;
  private ssr: SSRRenderingPipeline | null = null;
  private aberration = 0;
  private baseExposure = 1.2;

  constructor(scene: Scene, private engine: Engine, camera: Camera, high: boolean) {
    const supportsGBuffer = engine.getCaps().drawBuffersExtension && engine.webGLVersion >= 2;
    if (high && supportsGBuffer) {
      try {
        const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera], true, Constants.TEXTURETYPE_HALF_FLOAT);
        ssao.radius = 1.6;
        ssao.totalStrength = 1.25;
        ssao.base = 0.12;
        ssao.samples = 12;
        ssao.maxZ = 120;
        ssao.minZAspect = 0.4;
        ssao.expensiveBlur = true;
        ssao.bilateralSamples = 12;
        this.ssao = ssao;
      } catch (e) {
        console.warn('SSAO unavailable', e);
      }
      try {
        const ssr = new SSRRenderingPipeline('ssr', scene, [camera], true, Constants.TEXTURETYPE_HALF_FLOAT);
        ssr.strength = 1.0;
        ssr.reflectionSpecularFalloffExponent = 1.6;
        ssr.step = 1;
        ssr.maxSteps = 140;
        ssr.maxDistance = 90;
        ssr.thickness = 0.5;
        ssr.selfCollisionNumSkip = 2;
        ssr.ssrDownsample = 1;
        ssr.blurDispersionStrength = 0.07;
        ssr.blurDownsample = 1;
        ssr.roughnessFactor = 0.15;
        ssr.reflectivityThreshold = 0.02;
        ssr.enableSmoothReflections = true;
        ssr.attenuateFacingCamera = true;
        ssr.attenuateScreenBorders = true;
        ssr.attenuateIntersectionDistance = true;
        ssr.attenuateBackfaceReflection = true;
        ssr.clipToFrustum = true;
        ssr.useFresnel = true;
        ssr.environmentTexture = null;
        this.ssr = ssr;
      } catch (e) {
        console.warn('SSR unavailable', e);
      }
    }

    const p = new DefaultRenderingPipeline('pipe', true, scene, [camera]);
    this.pipeline = p;
    p.samples = high ? 4 : 1;
    p.fxaaEnabled = !high;
    p.bloomEnabled = true;
    p.bloomThreshold = 0.75;
    p.bloomWeight = high ? 0.62 : 0.45;
    p.bloomKernel = high ? 96 : 48;
    p.bloomScale = 0.5;
    p.sharpenEnabled = high;
    p.sharpen.edgeAmount = 0.22;
    p.chromaticAberrationEnabled = true;
    p.chromaticAberration.aberrationAmount = 6;
    p.chromaticAberration.radialIntensity = 1.2;
    p.grainEnabled = true;
    p.grain.intensity = 7;
    p.grain.animated = true;

    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = this.baseExposure;
    ip.contrast = 1.32;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.2;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0.0, 0.01, 0.02, 1);
    ip.vignetteCameraFov = 0.8;
    ip.colorCurvesEnabled = true;
    const cc = new ColorCurves();
    // Teal shadows, warm highlights: classic sci-fi grade.
    cc.shadowsHue = 195;
    cc.shadowsDensity = 35;
    cc.shadowsSaturation = 25;
    cc.highlightsHue = 30;
    cc.highlightsDensity = 22;
    cc.highlightsSaturation = 15;
    cc.globalSaturation = 8;
    ip.colorCurves = cc;

    engine.setHardwareScalingLevel(high ? 1 / Math.min(window.devicePixelRatio, 1.5) : 1);
  }

  /** Brief lens punch (explosions near the player, taking hits). */
  kick(amount: number): void {
    this.aberration = Math.min(1.5, this.aberration + amount);
  }

  /**
   * @param tactical 0..1 tactical-mode blend
   * @param hurt 0..1 recent damage
   * @param lightning 0..1 sky flash
   */
  update(dt: number, tactical: number, hurt: number, lightning: number): void {
    this.aberration = Math.max(0, this.aberration - dt * 2.5);
    const p = this.pipeline;
    const cc = p.imageProcessing.colorCurves!;
    cc.globalSaturation = 8 - 70 * tactical - 20 * hurt;
    cc.globalHue = 220;
    cc.globalDensity = 18 * tactical;
    p.chromaticAberration.aberrationAmount = 5 + 40 * this.aberration + 7 * tactical + 18 * hurt;
    p.imageProcessing.exposure = this.baseExposure + lightning * 0.12;
    p.grain.intensity = 7 + tactical * 8;
    void this.engine;
  }

  /** Meshes that should not write into the geometry buffer (the first-person viewmodel). */
  get hasScreenSpace(): boolean {
    return !!(this.ssao || this.ssr);
  }
}
