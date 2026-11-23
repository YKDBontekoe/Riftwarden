import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { shaderLanguageFor } from '../visuals/wgsl';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Scene } from '@babylonjs/core/scene';

ShaderStore.ShadersStore.rwTelegraphVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv * 2.0 - 1.0;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

ShaderStore.ShadersStore.rwTelegraphFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec3 tone;
void main() {
  float radius = length(vUV) * 1.07;
  float aa = clamp(fwidth(radius), 0.001, 0.016);
  float d = abs(radius - 1.0);
  float outline = 1.0 - smoothstep(0.027 - aa, 0.027 + aa, d);
  float edge = 1.0 - smoothstep(0.009 - aa, 0.009 + aa, d);
  float angle = atan(vUV.y, vUV.x);
  float tab = 1.0 - smoothstep(0.11, 0.26, abs(sin(angle * 6.0)));
  float ticks = tab * smoothstep(0.892 - aa, 0.892 + aa, radius) * (1.0 - smoothstep(0.968 - aa, 0.968 + aa, radius));
  float stroke = max(edge, ticks * 0.86);
  float alpha = max(outline * 0.81, stroke);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(mix(vec3(0.035, 0.024, 0.031), mix(tone * 0.47, vec3(1.0), 0.16), stroke), alpha);
}`;

/** Dark outline and high-contrast inward ticks stay readable through lit ground and additive particles. */
export function telegraphBoundary(scene: Scene, color: string, tone: [number, number, number]): ShaderMaterial {
  const material = new ShaderMaterial(`teleBoundary:${color}`, scene, 'rwTelegraph', {
    attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'tone'], needAlphaBlending: true, shaderLanguage: shaderLanguageFor(scene),
  });
  material.setVector3('tone', new Vector3(...tone));
  material.alphaMode = Constants.ALPHA_COMBINE;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  return material;
}
