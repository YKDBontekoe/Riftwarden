import { Effect } from '@babylonjs/core/Materials/effect';
import { shaderLanguageFor } from './wgsl';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector2 } from '@babylonjs/core/Maths/math.vector';
import { type Scene } from '@babylonjs/core/scene';

Effect.ShadersStore.rwReactorFieldVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPosition;
void main() {
  vPosition = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

Effect.ShadersStore.rwReactorFieldFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vPosition;
uniform vec3 cameraPosition;
uniform vec3 energy;
uniform vec2 chamber; // floor and ceiling of the core
uniform float time;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 cell = floor(p), t = fract(p);
  t = t * t * (3.0 - 2.0 * t);
  return mix(
    mix(mix(hash31(cell), hash31(cell + vec3(1,0,0)), t.x),
        mix(hash31(cell + vec3(0,1,0)), hash31(cell + vec3(1,1,0)), t.x), t.y),
    mix(mix(hash31(cell + vec3(0,0,1)), hash31(cell + vec3(1,0,1)), t.x),
        mix(hash31(cell + vec3(0,1,1)), hash31(cell + vec3(1,1,1)), t.x), t.y),
    t.z);
}

void main() {
  vec3 ray = normalize(vPosition - cameraPosition);
  vec3 entry = vPosition + ray * 0.002;
  float a = max(dot(ray.xz, ray.xz), 0.00001);
  float b = dot(entry.xz, ray.xz);
  float c = dot(entry.xz, entry.xz) - 1.0;
  float toSide = (-b + sqrt(max(0.0, b * b - a * c))) / a;
  float toCap = ray.y > 0.0 ? (chamber.y - entry.y) / max(ray.y, 0.00001)
                           : (entry.y - chamber.x) / max(-ray.y, 0.00001);
  float stride = max(0.0, min(toSide, toCap)) / 16.0;
  float offset = hash31(vec3(gl_FragCoord.xy, 0.0));
  vec3 p = entry + ray * stride * offset;
  float transmittance = 1.0;
  vec3 radiance = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float flow = p.y * 2.55 - time * 1.45;
    float curl = noise(p * vec3(4.0, 2.2, 4.0) - vec3(0.0, time * 1.7, 0.0));
    vec2 spine = vec2(cos(flow + curl), sin(flow + curl)) * (0.32 + 0.19 * curl);
    float d1 = length(p.xz - spine);
    float d2 = length(p.xz + spine * 0.51);
    float threads = exp(-d1 * d1 * 43.0) + exp(-d2 * d2 * 82.0) * 0.69;
    float shell = 1.0 - smoothstep(0.66, 0.98, length(p.xz));
    float density = shell * (0.15 + curl * 0.28 + threads * 1.72);
    float alpha = 1.0 - exp(-density * stride * 1.8);
    vec3 hot = mix(energy * 0.19, energy * 2.15 + vec3(0.7, 0.74, 0.78), smoothstep(0.11, 0.91, threads));
    radiance += transmittance * alpha * hot * (0.49 + curl * 0.87);
    transmittance *= 1.0 - alpha;
    p += ray * stride;
  }
  gl_FragColor = vec4(radiance + transmittance * vec3(0.012, 0.017, 0.022), 1.0);
}`;

/** Integrates plasma emission through the existing two-metre core cylinder. */
export function createReactorField(scene: Scene, bottom: number, top: number): ShaderMaterial {
  const material = new ShaderMaterial('reactorField', scene, 'rwReactorField', {
    shaderLanguage: shaderLanguageFor(scene),
    attributes: ['position'],
    uniforms: ['world', 'worldViewProjection', 'cameraPosition', 'energy', 'chamber', 'time'],
  });
  material.setVector2('chamber', new Vector2(bottom, top));
  material.setColor3('energy', new Color3(0.3, 2.0, 2.4));
  material.setFloat('time', 0);
  return material;
}
