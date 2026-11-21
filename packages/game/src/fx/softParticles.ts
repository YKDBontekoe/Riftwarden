import { Effect } from '@babylonjs/core/Materials/effect';
import { type ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { GeometryBufferRenderer } from '@babylonjs/core/Rendering/geometryBufferRenderer';
import { type Scene } from '@babylonjs/core/scene';

Effect.ShadersStore.rwSoftParticlePixelShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying vec4 vColor;
uniform sampler2D diffuseSampler;
uniform sampler2D worldDepth;
uniform vec2 inverseViewport;
uniform float fadeDistance;
void main() {
  vec4 sprite = texture2D(diffuseSampler, vUV);
  float depth = texture2D(worldDepth, gl_FragCoord.xy * inverseViewport).r;
  // The weapon is drawn over the world after particles. Ignore its near-field depth.
  float fade = depth <= 0.85 ? 1.0 : smoothstep(0.0, fadeDistance, depth - 1.0 / gl_FragCoord.w);
  // The scene is linear HDR until post-processing.
  vec3 color = pow(max(vec3(0.0), sprite.rgb * vColor.rgb), vec3(2.2));
  gl_FragColor = vec4(color, sprite.a * vColor.a * fade);
}`;

/** Reuses the cinematic G-buffer. Billboard smoke fades before it cuts into opaque geometry. */
export function softenParticles(scene: Scene, ps: ParticleSystem, range: number): void {
  const renderer = scene.geometryBufferRenderer;
  if (!renderer?.isSupported) return;
  const engine = scene.getEngine();
  const effect = engine.createEffectForParticles('rwSoftParticle', ['inverseViewport', 'fadeDistance'], ['worldDepth'], '', undefined, undefined, undefined, ps);
  ps.setCustomEffect(effect);
  ps.onBeforeDrawParticlesObservable.add((boundEffect) => {
    if (!boundEffect) return;
    const buffer = renderer.getGBuffer();
    const size = buffer.getSize();
    const depth = buffer.textures[renderer.getTextureIndex(GeometryBufferRenderer.DEPTH_TEXTURE_TYPE)];
    boundEffect.setTexture('worldDepth', depth);
    boundEffect.setFloat2('inverseViewport', 1 / size.width, 1 / size.height);
    boundEffect.setFloat('fadeDistance', range);
  });
}
