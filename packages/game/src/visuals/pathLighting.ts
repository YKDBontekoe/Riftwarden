import {
  type Color3,
  Constants,
  Effect,
  Mesh,
  type Scene,
  ShaderMaterial,
  VertexData,
} from '@babylonjs/core';
import type { Vec2 } from '@riftwarden/rules/world/layout';

Effect.ShadersStore.rwPathVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vPath;
void main() {
  vPath = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

Effect.ShadersStore.rwPathFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vPath;
uniform vec3 signalColor;
uniform float travel;
uniform float activity;
uniform float flash;
uniform float warning;
uniform float pathLength;

float line(float distance, float width, float feather) {
  return 1.0 - smoothstep(width, width + feather, abs(distance));
}

void main() {
  float across = abs(vPath.x);
  float along = vPath.y;
  float acrossAA = max(0.007, min(fwidth(across), 0.09));
  float alongAA = max(0.02, min(fwidth(along), 0.35));

  // Machined channels carry narrow lights, with cutouts for service joints.
  float joint = smoothstep(0.025, 0.11, abs(mod(along + 1.8, 3.6) - 1.8));
  float groove = line(across - 0.81, 0.075, acrossAA);
  float rails = line(across - 0.81, 0.026, acrossAA) * joint;
  float markers = line(across - 0.95, 0.018, acrossAA)
                * line(mod(along + 0.9, 1.8) - 0.9, 0.23, alongAA);

  // The arrow tip sits ahead of both wings as distance increases.
  float arrow = mod(along + across * mix(0.82, 1.65, warning) + 1.8, 3.6) - 1.8;
  float chevron = line(arrow, 0.085, alongAA) * (1.0 - smoothstep(0.49, 0.55, across));
  float shoulder = (1.0 - smoothstep(0.82, 1.0, across)) * mix(0.14, 0.29, warning);

  // Broad soft-edged sweeps stay continuous through joins and travel into the hub.
  float tail = mod(along - travel + 9.0, 18.0) - 9.0;
  float pulse = line(tail, 0.6, 2.2);
  float tracer = line(tail, 0.12, 0.45);
  float field = 0.21 + activity * 0.41;
  float light = rails * (field + pulse * activity * 1.4 + tracer * flash)
              + markers * (0.14 + activity * 0.35)
              + chevron * (field * 0.72 + pulse * activity * 1.45 + flash * 0.25);
  float endFade = smoothstep(0.0, 0.75, along) * (1.0 - smoothstep(pathLength - 0.8, pathLength, along));
  float opacity = max(max(groove * 0.78, shoulder), max(chevron * 0.78, markers));
  gl_FragColor = vec4(vec3(0.023, 0.032, 0.037) + signalColor * light, opacity * endFade);
}`;

/** A floor ribbon with mitered joins and UVs in metres along the route. */
export function createPathLight(
  scene: Scene,
  name: string,
  points: readonly Vec2[],
  halfWidth: number,
  color: Color3,
  warning = false,
): { mesh: Mesh; setColor(c: Color3): void; update(dt: number, activity: number, flash?: number): void } {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const segments = points.slice(1).map((end, i) => {
    const start = points[i];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    return { nx: dz / length, nz: -dx / length, length };
  });
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = segments[Math.max(0, i - 1)];
    const next = segments[Math.min(i, segments.length - 1)];
    const dot = prev.nx * next.nx + prev.nz * next.nz;
    const miter = halfWidth / Math.max(0.75, 1 + dot);
    const x = (prev.nx + next.nx) * miter;
    const z = (prev.nz + next.nz) * miter;
    if (i > 0) distance += prev.length;
    positions.push(p.x - x, 0.028, p.z - z, p.x + x, 0.028, p.z + z);
    uvs.push(-1, distance, 1, distance);
    if (i > 0) {
      const base = (i - 1) * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.alphaIndex = 2;
  mesh.freezeWorldMatrix();

  const material = new ShaderMaterial(name, scene, 'rwPath', {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection', 'signalColor', 'travel', 'activity', 'flash', 'warning', 'pathLength'],
    needAlphaBlending: true,
  });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.alphaMode = Constants.ALPHA_COMBINE;
  material.setColor3('signalColor', color);
  material.setFloat('warning', warning ? 1 : 0);
  material.setFloat('pathLength', distance);
  material.setFloat('travel', 0);
  material.setFloat('activity', 0.5);
  material.setFloat('flash', 0);
  mesh.material = material;

  let travel = 0;
  return {
    mesh,
    setColor(c: Color3) {
      material.setColor3('signalColor', c);
    },
    update(dt, activity, flash = 0) {
      travel = (travel + dt * (2.3 + activity * 4.2)) % 18;
      material.setFloat('travel', travel);
      material.setFloat('activity', activity);
      material.setFloat('flash', flash);
    },
  };
}
