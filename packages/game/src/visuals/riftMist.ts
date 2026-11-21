import { Color3, Constants, Effect, type Mesh, MeshBuilder, type Scene, ShaderMaterial, Vector3 } from '@babylonjs/core';
import type { ArenaLayout, GateId } from '@riftwarden/rules/world/layout';

/**
 * Rift mist: low, slow vapour rolling out of each gate tunnel onto the yard. Two additive layers per
 * gate (a dense floor sheet and a thinner layer at waist height) with world-space noise that flows
 * inward and fades across ~16 m of deck. Open rifts glow orange; a sealed gate breathes grey.
 * Purely visual: not pickable, no depth write, one material per gate.
 */
Effect.ShadersStore['rwMistVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vW;
void main(){ vec4 w = world * vec4(position, 1.0); vW = w.xyz; gl_Position = viewProjection * w; }`;

Effect.ShadersStore['rwMistFragmentShader'] = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform float time;
uniform vec3 color;
uniform vec3 mouth;
uniform vec3 inward;
uniform float halfWidth;
uniform float strength;
uniform vec3 cameraPosition;
float h2(vec2 p){ p = fract(p * vec2(0.3183, 0.3678) + 0.1); p *= 17.0; return fract(p.x * p.y * (p.x + p.y)); }
float n2(vec2 x){ vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1,0)), f.x), mix(h2(i + vec2(0,1)), h2(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ s += a * n2(p); p = p * 2.07 + vec2(3.1, 1.7); a *= 0.5; } return s; }
void main(){
  vec3 rel = vW - mouth;
  float d = dot(rel, inward);                  // metres into the yard (negative inside the tunnel)
  vec3 side = normalize(cross(inward, vec3(0.0, 1.0, 0.0)));
  float across = abs(dot(rel, side)) / (halfWidth + max(d, 0.0) * 0.45); // the plume spreads as it rolls in
  vec2 flow = vec2(dot(vW, side), dot(vW, inward));
  float n = fbm(flow * 0.21 - vec2(0.0, time * 0.32)) * 0.65 + fbm(flow * 0.55 + vec2(time * 0.07, -time * 0.5)) * 0.35;
  float body = smoothstep(0.3, 0.74, n);
  float fade = (1.0 - smoothstep(-2.0, 16.0, d)) * smoothstep(-11.0, -6.0, d);
  float edge = 1.0 - smoothstep(0.55, 1.0, across);
  // Fade out right in front of the camera so the drone never looks through a flat sheet.
  float near = smoothstep(0.6, 3.0, length(cameraPosition - vW));
  float a = body * fade * edge * near * strength;
  gl_FragColor = vec4(color * a, 1.0);
}`;

interface GateMist {
  mats: ShaderMaterial[];
  meshes: Mesh[];
}

const OPEN = new Color3(0.9, 0.28, 0.08);
const SEALED = new Color3(0.16, 0.17, 0.19);

export class RiftMist {
  private gates = new Map<GateId, GateMist>();

  constructor(scene: Scene, layout: ArenaLayout) {
    const H = layout.half;
    const defs: { id: GateId; mouth: Vector3; inward: Vector3 }[] = [
      { id: 'north', mouth: new Vector3(0, 0, H), inward: new Vector3(0, 0, -1) },
      { id: 'south', mouth: new Vector3(0, 0, -H), inward: new Vector3(0, 0, 1) },
      { id: 'east', mouth: new Vector3(H, 0, 0), inward: new Vector3(-1, 0, 0) },
      { id: 'west', mouth: new Vector3(-H, 0, 0), inward: new Vector3(1, 0, 0) },
    ];
    for (const g of defs) {
      const sealed = !layout.initialGates.includes(g.id);
      const entry: GateMist = { mats: [], meshes: [] };
      for (const [y, strength, size] of [[0.07, 1.15, 30], [0.75, 0.45, 24]] as const) {
        const mat = new ShaderMaterial(`riftMist:${g.id}:${y}`, scene, 'rwMist', {
          attributes: ['position'],
          uniforms: ['world', 'viewProjection', 'time', 'color', 'mouth', 'inward', 'halfWidth', 'strength', 'cameraPosition'],
        });
        mat.alphaMode = Constants.ALPHA_ADD;
        mat.needAlphaBlending = () => true;
        mat.disableDepthWrite = true;
        mat.backFaceCulling = false;
        mat.setVector3('mouth', g.mouth);
        mat.setVector3('inward', g.inward);
        mat.setFloat('halfWidth', 4.2);
        mat.setFloat('strength', strength);
        mat.setColor3('color', sealed ? SEALED : OPEN);
        mat.setFloat('time', 0);
        const plane = MeshBuilder.CreateGround(`riftMist:${g.id}`, { width: size, height: size, subdivisions: 1 }, scene);
        // Centre the sheet a little inside the yard; it covers the tunnel mouth and ~16 m of deck.
        plane.position.copyFrom(g.mouth.add(g.inward.scale(size * 0.3))).y = y;
        plane.material = mat;
        plane.isPickable = false;
        plane.applyFog = false;
        plane.alwaysSelectAsActiveMesh = true;
        plane.freezeWorldMatrix();
        entry.mats.push(mat);
        entry.meshes.push(plane);
      }
      this.gates.set(g.id, entry);
    }
  }

  /** A gate opened by an arena evolution: its mist turns from grey to rift orange. */
  setSealed(id: GateId, sealed: boolean): void {
    for (const m of this.gates.get(id)?.mats ?? []) m.setColor3('color', sealed ? SEALED : OPEN);
  }

  update(time: number, camPos: Vector3): void {
    for (const g of this.gates.values()) for (const m of g.mats) {
      m.setFloat('time', time);
      m.setVector3('cameraPosition', camPos);
    }
  }
}
