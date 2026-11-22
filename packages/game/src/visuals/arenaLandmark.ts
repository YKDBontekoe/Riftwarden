import { Constants } from '@babylonjs/core/Engines/constants';
import { shaderLanguageFor } from './wgsl';
import { Effect } from '@babylonjs/core/Materials/effect';
import { type Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { type VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { biomeOf, type BiomeId } from '@riftwarden/rules/world/biomes';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import type { DressingHost } from './arenaDressing';
import { createBeveledBox } from './bevel';
import { type Palette, unlit } from './materials';
import { segmentedRing } from './rings';
import { loftData, smoothLatheData } from './sculpt';
import { canvas, toTexture, vnoise } from './textures';

Effect.ShadersStore['rwLandmarkVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.);
}`;

Effect.ShadersStore['rwLandmarkFragmentShader'] = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec3 energy;
uniform float time;
uniform float flow;
uniform float seed;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float cloud(vec2 p) {
  return .57 * noise(p) + .29 * noise(p * 2.1 + 4.) + .14 * noise(p * 4.3 + 17.);
}

void main() {
  vec2 p = vUV * 2. - 1.;
  if (flow > .5) {
    // Vertical curtains. Long exposure streaks close to the nozzle give way to turbulent spray.
    float down = flow > 1.5 ? vUV.y : 1. - vUV.y;
    float stream = cloud(vec2(p.x * 9. + seed, down * 4. - time * 1.6));
    float spread = mix(.24, 1., down);
    float edge = 1. - smoothstep(spread * .32, spread, abs(p.x) + (stream - .5) * .25);
    float strength = edge * (1. - smoothstep(.08, 1., down)) * smoothstep(0., .06, down);
    vec3 col = energy * mix(.55, 1.4, stream) * strength;
    gl_FragColor = vec4(col, strength * mix(.4, .85, stream));
  } else {
    // A thin torn edge surrounded by a deep, spiralling cloud and small branching seams.
    float r = length(p);
    float theta = atan(p.y, p.x + .00001);
    vec2 spiral = vec2(theta * 3.1 + r * 16. - time * .4, r * 6.);
    float wisps = cloud(spiral + seed);
    float x = p.x - (.13 * sin(p.y * 6.4 + .25 * sin(time)) + (noise(vec2(p.y * 12., seed)) - .5) * .22);
    float tear = abs(x) / max(.043, .34 * (1. - p.y * p.y));
    float split = abs(x + sin(p.y * 13. + 1.) * .13 + .095);
    float fall = (1. - smoothstep(.62, 1., r));
    float whiteCore = exp(-tear * tear * 65.) * (.4 + .6 * wisps);
    float branches = exp(-split * 68.) * smoothstep(.43, .67, wisps);
    float halo = exp(-tear * tear * 1.65) * fall;
    vec3 col = energy * (halo * (.12 + wisps * .6) + branches * .77);
    col += vec3(2.8, 1.9, 1.5) * whiteCore;
    gl_FragColor = vec4(col * fall, max(whiteCore, halo) * fall);
  }
}`;

/** One large industrial installation beyond the north wall. All pieces are scenery. */
export class ArenaLandmark {
  private readonly origin: Vector3;
  private readonly biome: BiomeId;
  private readonly materials: ShaderMaterial[] = [];
  private rotor: TransformNode | null = null;
  private readonly phases: Mesh[] = [];

  constructor(private h: DressingHost, private p: Palette, layout: ArenaLayout) {
    const seed = layout.seed ?? 7;
    this.biome = biomeOf(layout).id;
    const lateral = ((seed >>> 4) % 13) - 6;
    this.origin = new Vector3(lateral + (this.biome === 'cryo' ? -19 : this.biome === 'foundry' ? 57 : -12), 0, layout.half + 33);
  }

  build(): void {
    // The playable slab ends at the perimeter, so the exterior machinery needs its own ground.
    const apron = MeshBuilder.CreateGround('exteriorQuarryFloor', { width: 340, height: 125 }, this.h.scene);
    this.place(apron, 0, -2.3, 20, this.p.concrete);
    if (this.biome === 'cryo') this.drill();
    else if (this.biome === 'foundry') this.furnace();
    else this.containment();
  }

  update(time: number): void {
    for (const mat of this.materials) mat.setFloat('time', time);
    if (this.rotor) this.rotor.rotation.y = time * 0.17;
    for (let i = 0; i < this.phases.length; i++) this.phases[i].rotation.y = time * (i === 0 ? .11 : -.16);
  }

  private place(mesh: Mesh, x: number, y: number, z: number, mat: Material): Mesh {
    mesh.position.set(x, y, z).addInPlace(this.origin);
    this.h.add(mesh, mat, null);
    return mesh;
  }

  private shape(name: string, data: VertexData, mat: Material, x = 0, y = 0, z = 0): Mesh {
    const mesh = new Mesh(name, this.h.scene);
    data.applyToMesh(mesh);
    return this.place(mesh, x, y, z, mat);
  }

  private beam(a: [number, number, number], b: [number, number, number], width: number, depth: number, mat: Material): void {
    const start = new Vector3(...a);
    const end = new Vector3(...b);
    const axis = end.subtract(start);
    const center = start.add(end).scaleInPlace(.5);
    const beam = createBeveledBox('landmarkBeam', width, axis.length(), depth, Math.min(width, depth) * .13, this.h.scene);
    beam.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), axis.normalize(), Quaternion.Identity());
    this.place(beam, center.x, center.y, center.z, mat);
  }

  private disk(name: string, radius: number, width: number, segments: number, coverage: number, y: number, z: number, mat: Material, moving = false): Mesh {
    const ring = segmentedRing(this.h.scene, name, radius, width, segments, coverage);
    if (moving) {
      const frame = new TransformNode(name + 'Frame', this.h.scene);
      frame.position.copyFrom(this.origin).addInPlaceFromFloats(0, y, z);
      frame.rotation.x = -Math.PI / 2;
      ring.parent = frame;
      ring.material = mat;
      return ring;
    }
    ring.rotation.x = -Math.PI / 2;
    return this.place(ring, 0, y, z, mat);
  }

  private energy(name: string, width: number, height: number, x: number, y: number, z: number, color: Color3, flow: 'rift' | 'fall' | 'rise' = 'rift'): void {
    const scene = this.h.scene;
    const mat = new ShaderMaterial(name, scene, 'rwLandmark', {
      shaderLanguage: shaderLanguageFor(scene),
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'energy', 'flow', 'seed', 'time'],
      needAlphaBlending: true,
    });
    mat.setColor3('energy', color);
    mat.setFloat('time', 0);
    mat.setFloat('seed', x * .14 + y * .07);
    mat.setFloat('flow', flow === 'rise' ? 2 : flow === 'fall' ? 1 : 0);
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alphaMode = Constants.ALPHA_ADD;
    this.materials.push(mat);
    const plane = MeshBuilder.CreatePlane(name, { width, height }, scene);
    plane.position.set(x, y, z).addInPlace(this.origin);
    plane.material = mat;
    plane.isPickable = false;
  }

  private containment(): void {
    const p = this.p;
    const violet = unlit(this.h.scene, 'containmentExchange', [.85, .35, 2.1]);
    const hot = unlit(this.h.scene, 'containmentArc', [2.65, .64, .30]);
    const y = 32;
    for (const side of [-1, 1]) {
      this.beam([side * 29, -2, 2], [side * 22, 38, 2], 7.4, 7, p.concrete);
      this.beam([side * 22, 38, 2], [side * 11, 54, 2], 6.4, 6.4, p.white);
      this.beam([side * 32, 0, 6], [side * 21, 36, 6], 2.4, 3.1, p.steel);
      this.beam([side * 26, 14, -1.65], [side * 22, 36, -1.65], .52, .32, violet);
      this.beam([side * 22, 36, -1.52], [side * 10.7, 53.6, -1.52], .28, .28, hot);
      for (let i = 0; i < 7; i++) this.beam([side * (30 - i * .79), 8 + i * 3.7, -1.6],
        [side * (24 - i * .79), 8 + i * 3.7, -1.6], .64, .4, p.metal);
    }
    // Stepped segmented annulus and the rotating field regulators in its aperture.
    this.disk('containmentWeb', 20, 6.5, 4, .93, y, 1.2, p.graphite);
    this.disk('containmentCeramic', 21.3, 2.5, 12, .94, y, -.68, p.white);
    this.disk('containmentBus', 18.4, .63, 12, .78, y, -.71, violet);
    this.phases.push(
      this.disk('containmentRegulator', 16.6, .44, 5, .64, y, -.82, hot, true),
      this.disk('containmentVernier', 15.3, .28, 36, .42, y, -.92, violet, true),
    );
    for (let i = 0; i < 12; i++) {
      const a = (i + .46) * Math.PI / 6;
      const x = Math.sin(a), h = Math.cos(a);
      this.beam([x * 18.8, y + h * 18.8, -.99], [x * 22.5, y + h * 22.5, -.99], .49, .45, p.metal);
      this.beam([x * 21.8, y + h * 21.8, -1.26], [x * 22.1, y + h * 22.1, -1.26], .34, .26, p.whiteGlow);
    }
    this.energy('industrialBreach', 32, 39, 0, y, .55, new Color3(2.5, .33, 1.35));
  }

  /** Layered silt and pale frost on the exposed faces of the glacier. */
  private glacierMaterial(): PBRMaterial {
    const size = 256;
    const { c, ctx } = canvas(size);
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const broad = vnoise(u * 4, v * 4, 4, 19);
        const grain = vnoise(u * 56, v * 56, 56, 9);
        const bend = vnoise(u * 8, v * 3, 8, 23, 3);
        const strata = Math.abs(Math.sin(Math.PI * 2 * (v * 5 + .52 * broad + .18 * bend)));
        const fracture = Math.max(0, .19 - strata) * (.55 + grain);
        const blue = .64 + broad * .24 + grain * .06 - fracture;
        const at = (y * size + x) * 4;
        image.data[at] = 158 * blue;
        image.data[at + 1] = 209 * blue;
        image.data[at + 2] = 255 * blue;
        image.data[at + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const ice = new PBRMaterial('excavationGlacier', this.h.scene);
    const strataTexture = toTexture('glacierStrata', c, this.h.scene);
    strataTexture.uScale = .053;
    strataTexture.vScale = .037;
    ice.albedoTexture = strataTexture;
    ice.metallic = .08;
    ice.roughness = .53;
    ice.emissiveColor = new Color3(.045, .083, .12);
    return ice;
  }

  private drill(): void {
    const p = this.p;
    const ice = unlit(this.h.scene, 'boreCoolant', [.38, 1.55, 2.4]);
    const glacier = this.glacierMaterial();
    const drillHead = smoothLatheData([[2.2, 8], [5.3, 12], [8.9, 20], [10.8, 24], [11, 27], [9.5, 28], [8.8, 31]], 24);
    const rotor = this.rotor = new TransformNode('glacierDrillRotor', this.h.scene);
    rotor.position.copyFrom(this.origin);
    const bit = new Mesh('excavationCutter', this.h.scene);
    drillHead.applyToMesh(bit);
    bit.material = p.steel;
    bit.parent = rotor;
    bit.isPickable = false;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const tooth = createBeveledBox('boreTooth', 1.75, 4.6, 2.8, .37, this.h.scene);
      tooth.position.set(9.9 * Math.sin(a), 23, 9.9 * Math.cos(a));
      tooth.rotation.set(.31, a, .22);
      tooth.material = i % 3 === 0 ? p.enamel : p.metal;
      tooth.parent = rotor;
      tooth.isPickable = false;
    }
    for (const side of [-1, 1]) {
      this.beam([side * 25, -4, 2], [side * 14, 37, 2], 5.3, 14, p.white);
      this.beam([side * 26, 0, -5.2], [side * 15, 35.2, -5.2], 1.1, .55, ice);
      this.beam([side * 20, 1, 12], [side * 14, 36, 7], 7.6, 5, p.steel);
    }
    this.beam([-19, 37, 2], [19, 37, 2], 6.2, 16, p.graphite);
    this.shape('drillCarriage', smoothLatheData([[10, 27.8], [10, 31], [11.4, 31.8], [11.4, 36], [8, 39],
      [7.6, 47], [5.8, 48], [5.8, 52], [3.8, 53]], 32), p.white);
    this.shape('coolantManifold', smoothLatheData([[10.5, 29], [10.55, 30.2]], 40), ice);
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const x = Math.sin(a), z = Math.cos(a);
      this.beam([x * 9.9, 33.5, z * 9.9], [x * 7.5, 46.5, z * 7.5], .72, .91, p.steel);
    }
    this.shape('drillStatusBand', smoothLatheData([[8.15, 40.2], [8.15, 40.65]], 36), ice);
    this.beam([-2.8, 51, 0], [-2.8, 60, 0], .66, .66, p.metal);
    this.beam([-3.1, 60, 0], [-3.1, 61, 0], .83, .83, p.redGlow);
    for (const [x, z, height, width] of [[-42, 8, 35, 12], [-52, 16, 54, 16], [38, 3, 31, 10], [48, 14, 42, 14],
      [59, 26, 63, 21], [-67, 30, 39, 18], [32, 16, 22, 9]]) {
      const lean = x * .13;
      const sections = [
        { t: -8, w: width, h: width * .78, n: 3 },
        { t: height * .52, w: width * .8, h: width * .65, u: lean * .4, n: 4, roll: .26 },
        { t: height * .82, w: width * .57, h: width * .49, u: lean, n: 3, roll: .35 },
        { t: height, w: width * .03, h: width * .03, u: lean * 1.75, n: 3, roll: .4 },
      ];
      this.shape('glacialSerac', loftData(sections, 'y'), glacier, x, 0, z);
    }
    this.energy('boreExhaust', 19, 22, 0, 11, -5.3, new Color3(.24, .92, 1.55), 'fall');
  }

  private furnace(): void {
    const p = this.p;
    const throat = unlit(this.h.scene, 'furnaceThroat', [2.6, .35, .06]);
    const core = unlit(this.h.scene, 'furnaceSeal', [1.6, .54, .09]);
    const vessel = smoothLatheData([[5, 14], [8, 17], [13, 23], [16, 34], [17, 38], [17, 43],
      [18, 45], [18, 47], [15.4, 47], [15.4, 45], [11, 42]], 48);
    this.shape('smeltingCrucible', vessel, p.steel, 0, 0, 3);
    for (const [radius, y] of [[13.4, 24], [16.7, 36], [18, 44], [18.4, 46]]) {
      this.shape('furnaceHoop', smoothLatheData([[radius, y - .75], [radius + .38, y], [radius + .38, y + .55],
        [radius - .4, y + .7]], 40), p.metal, 0, 0, 3);
    }
    for (const side of [-1, 1]) {
      this.beam([side * 27, -3, 3], [side * 22, 43, 3], 9, 13, p.concrete);
      this.beam([side * 24, 7, -3.65], [side * 20, 40, -3.65], 3.3, 1.05, p.graphite);
      this.beam([side * 24, 12, -4.25], [side * 20.5, 41, -4.25], .48, .4, throat);
      this.beam([side * 24, 39, 3], [side * 10, 47, 3], 3.2, 6.2, p.enamel);
      this.shape('flareStack', smoothLatheData([[5.3, -11], [5.3, -8], [3.9, -7.5], [3.7, 26], [2.7, 39], [2.6, 56], [3.1, 58], [3.3, 59]], 20),
        p.steel, side * 37, side > 0 ? -6 : 0, 14);
      this.energy('flareStackFlame', 6, 14, side * 37, side > 0 ? 60 : 66, 14, new Color3(2.35, .54, .08), 'rise');
    }
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const x = Math.sin(a), z = Math.cos(a);
      this.beam([x * 13, 24, 3 + z * 13], [x * 17.45, 42.7, 3 + z * 17.45], 1.18, 1.2, p.graphite);
      if (i % 2 === 0) this.beam([x * 17.5, 39.2, 3 + z * 17.5], [x * 17.46, 42.1, 3 + z * 17.46], .33, .32, throat);
    }
    // Recessed cast face and the three glowing tap channels.
    this.disk('furnaceTapPlate', 9, 4.8, 3, .98, 30, -11.1, p.graphite);
    this.disk('furnaceTapSeal', 6.8, .72, 12, .83, 30, -11.18, core);
    for (const x of [-3.1, 0, 3.1]) {
      this.beam([x, 13, -8], [x, 27, -8], 2.1, 3.5, p.enamel);
      this.beam([x, 25, -10.3], [x, 29, -10.3], 1.48, .44, throat);
      this.energy('moltenTap', x === 0 ? 3.5 : 2.4, 25, x, 15.8, -10.6, new Color3(3.1, .76, .08), 'fall');
    }
  }
}
