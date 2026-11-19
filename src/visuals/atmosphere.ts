import {
  type AbstractMesh,
  Color3,
  Color4,
  Constants,
  Effect,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  TransformNode,
  PointLight,
  type Scene,
  ShaderMaterial,
  SpotLight,
  Texture,
  Vector3,
} from '@babylonjs/core';
import type { ArenaLayout } from '../world/layout';
import { type Palette, unlit } from './materials';
import { canvas, flareSprite, sparkSprite, toTexture } from './textures';
import { placeScan } from './scannedProps';
import { captureEnvironment } from './envCapture';
import { BASE_FOG } from './mood';
import { RiftMist } from './riftMist';

// ---------------------------------------------------------------- shaders

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

Effect.ShadersStore['rwSkyVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = worldViewProjection * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = p.w * 0.99995;
}`;

Effect.ShadersStore['rwSkyFragmentShader'] = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float time;
uniform float flash;
uniform vec3 riftDir;
uniform vec3 sunDir;
uniform vec3 horizonColor;
uniform sampler2D mountains;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = max(dot(d, normalize(sunDir)), 0.0);

  // Low morning haze and long cirrus bands keep the yard silhouette legible.
  float horizon = exp(-3.7 * max(h, 0.0));
  vec3 col = mix(vec3(0.045, 0.07, 0.095), horizonColor, horizon);
  col += vec3(0.85, 0.42, 0.17) * pow(sd, 3.0) * (0.35 + horizon);
  vec3 cloudPos = d * vec3(3.1, 18.0, 6.0) + vec3(time * 0.003, 2.0, time * 0.002);
  float cloud = fbm3(cloudPos);
  float cover = smoothstep(0.38, 0.62, cloud) * smoothstep(-0.03, 0.22, h);
  col = mix(col, vec3(0.13, 0.13, 0.15) + vec3(0.55, 0.26, 0.1) * pow(sd, 2.0), cover * 0.78);
  // Mirror at the rear meridian so both ends of the panorama join continuously.
  float azimuth = atan(d.x, d.z) / 3.14159265 + 0.76;
  float elevation = (asin(clamp(h, -1.0, 1.0)) + 0.045) / 0.78;
  vec3 ridgeColor = texture2D(mountains, vec2(azimuth, elevation)).rgb;
  // Ridges sit in the dusk: darkened and warmed toward the sun, cooler away from it.
  ridgeColor = ridgeColor * mix(vec3(0.42, 0.45, 0.52), vec3(0.85, 0.62, 0.45), pow(sd, 2.0));
  col = mix(col, ridgeColor, (1.0 - smoothstep(0.75, 1.0, elevation)) * 0.94);
  col += vec3(0.95, 0.58, 0.27) * pow(sd, 45.0);
  col += vec3(3.6, 2.7, 1.7) * smoothstep(0.99945, 0.99982, sd) * (1.0 - cover * 0.6);

  // The rift: a thin burning tear high in the sky away from the sun.
  vec3 rd = normalize(riftDir);
  vec3 n = normalize(cross(rd, normalize(vec3(0.35, 1.0, 0.1))));
  float along = dot(d, rd);
  float distort = (fbm3(d * 5.0 + vec3(0.0, time * 0.03, 0.0)) - 0.5) * 0.1;
  float w = abs(dot(d, n) + distort);
  float mask = smoothstep(0.57, 0.87, along) * smoothstep(0.12, 0.35, h);
  float ridge = fbm3(d * 24.0 + vec3(time * 0.018, 1.8, 0.0));
  float core = exp(-w * w * 49000.0) * mask * (0.4 + ridge);
  float branch = (fbm3(d * 11.0 + vec3(3.7, 0.0, time * 0.022)) - 0.43) * 0.14;
  float filament = (dot(d, n) + distort + branch) * 145.0;
  float arcs = exp(-filament * filament) * mask * smoothstep(0.35, 0.68, ridge);
  float glowR = exp(-w * w * 500.0) * mask;
  float pulse = 0.85 + 0.15 * sin(time * 1.3 + along * 9.0);
  col += (vec3(4.0, 1.8, 0.82) * core + vec3(0.72, 0.21, 0.13) * glowR * (0.25 + cloud)) * pulse * (1.0 + flash * 2.0);
  col += vec3(1.3, 0.41, 0.2) * arcs * pulse;
  col += vec3(1.0, 0.5, 0.45) * flash * glowR * cover;

  gl_FragColor = vec4(col, 1.0);
}`;

Effect.ShadersStore['rwRiftVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(){ vUV = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

Effect.ShadersStore['rwRiftFragmentShader'] = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform float time;
uniform float seed;
uniform vec3 energyColor;
${NOISE_GLSL}
void main(){
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float angle = atan(p.y, p.x);
  float twist = angle + 1.4 * log(r + 0.23) - time * 0.29;
  vec3 flow = vec3(cos(twist), sin(twist), r * 8.5 + seed);
  float cloud = fbm3(flow * vec3(2.6, 2.6, 0.54) - vec3(0.0, 0.0, time * 0.27));
  float detail = fbm3(flow * vec3(5.7, 5.7, 2.2) + vec3(time * 0.18, 0.0, 0.0));
  float envelope = smoothstep(0.3, 0.71, r) * (1.0 - smoothstep(0.88, 1.0, r));
  float ribbon = r - (0.84 + (cloud - 0.48) * 0.36);
  float arcs = exp(-ribbon * ribbon * (160.0 + detail * 350.0));
  float strands = pow(0.5 + 0.5 * sin(r * 82.0 + detail * 12.7 + cloud * 17.0), 12.0);
  float fractures = smoothstep(0.41, 0.72, detail + cloud * 0.28);
  float filament = strands * fractures * envelope * arcs;
  float vapour = smoothstep(0.25, 0.75, cloud + detail * 0.21) * envelope;
  vec3 col = vec3(0.012, 0.021, 0.033) * (0.15 + cloud * 2.0);
  col += energyColor * (vapour * 0.24 + arcs * fractures * 0.54 + filament * 2.5);
  col += mix(energyColor, vec3(2.4, 2.0, 1.7), 0.63) * filament * filament;
  col *= 1.0 - smoothstep(0.96, 1.0, r) * 0.88;
  gl_FragColor = vec4(col, 1.0);
}`;

Effect.ShadersStore['rwBeamVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vN;
varying vec3 vW;
varying float vH;
void main(){
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(world) * normal);
  vH = uv.y;
  gl_Position = viewProjection * w;
}`;

Effect.ShadersStore['rwBeamFragmentShader'] = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying float vH;
uniform vec3 cameraPosition;
uniform vec3 color;
uniform float time;
${NOISE_GLSL}
void main(){
  vec3 v = normalize(cameraPosition - vW);
  float facing = abs(dot(normalize(vN), v));
  float soft = pow(facing, 2.5);
  float fall = smoothstep(0.0, 0.35, vH) * (0.25 + 0.75 * vH);
  float dust = 0.75 + 0.5 * vnoise3(vW * 0.9 + vec3(0.0, -time * 0.25, time * 0.1));
  float dist = length(cameraPosition - vW);
  float near = smoothstep(0.5, 4.0, dist);
  float a = soft * fall * dust * near;
  gl_FragColor = vec4(color * a, a);
}`;

/** A shared energy membrane with scene-specific color and a different flow field at each gate. */
export function createRiftMaterial(scene: Scene, name: string, color: Color3, seed: number): ShaderMaterial {
  const material = new ShaderMaterial(name, scene, 'rwRift', {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection', 'time', 'seed', 'energyColor'],
  });
  material.backFaceCulling = false;
  material.setFloat('time', 0);
  material.setFloat('seed', seed);
  material.setColor3('energyColor', color);
  return material;
}

/** Downward cone of light on a wall: bright at the top, fading and widening. */
function splashTexture(scene: Scene) {
  const W = 128;
  const H = 160;
  const { c, ctx } = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = y / H; // 0 top
      const u = (x / W - 0.5) * 2;
      const width = 0.18 + v * 0.85;
      const edge = Math.max(0, 1 - Math.abs(u) / width);
      const a = Math.pow(edge, 1.6) * Math.pow(1 - v, 1.8) * (v < 0.03 ? v / 0.03 : 1);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(1, a) * 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = toTexture('splash', c, scene, { aniso: 2 });
  t.wrapU = t.wrapV = 0;
  t.hasAlpha = true;
  return t;
}

/** Lamp positions under the roof trusses (x, z). */
const LAMPS: [number, number][] = [
  [-22, -30], [-22, -8], [-22, 14], [-22, 34],
  [22, -30], [22, -8], [22, 14], [22, 34],
  [-10, 36], [10, 36],
];

/**
 * Sky, skyline and air. Owns everything that sets the mood but has no gameplay role:
 * a procedural storm sky with a burning rift, swirling gate portals, volumetric-looking
 * lamp shafts, a distant city in the haze, drifting dust and falling embers. It also
 * captures the scene into a prefiltered reflection probe used as the PBR environment.
 */
export class Atmosphere {
  private sky: ShaderMaterial;
  private beamMat: ShaderMaterial;
  private lampBeams!: Mesh;
  private dust: ParticleSystem;
  private embers: ParticleSystem;
  private rain: ParticleSystem;
  private gateEmbers: ParticleSystem[] = [];
  private portalMats: ShaderMaterial[] = [];
  private time = 0;
  /** Vapour rolling out of the gate tunnels (seal state follows the arena gates). */
  readonly mist: RiftMist;
  private flash = 0;
  private nextFlash = 6;
  readonly skyMesh: Mesh;
  readonly gateLights: PointLight[] = [];
  /** Static meshes that should appear in environment reflections. */
  readonly envMeshes: AbstractMesh[] = [];
  readonly fogColor = new Color3(...BASE_FOG);
  /** Direction *towards* the sun (low, behind the south-east wall). */
  readonly sunDir = new Vector3(-0.64, 0.23, -0.74).normalize();

  constructor(private scene: Scene, private P: Palette, private layout: ArenaLayout) {
    const sky = new ShaderMaterial('sky', scene, 'rwSky', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'time', 'flash', 'riftDir', 'sunDir', 'horizonColor'],
      samplers: ['mountains'],
    });
    const mountains = new Texture(new URL('../assets/alpine-horizon.webp', import.meta.url).href, scene, false, true);
    mountains.wrapU = Texture.MIRROR_ADDRESSMODE;
    mountains.wrapV = Texture.CLAMP_ADDRESSMODE;
    sky.setTexture('mountains', mountains);
    sky.backFaceCulling = false;
    sky.disableDepthWrite = true;
    sky.setVector3('riftDir', new Vector3(-0.42, 0.4, 1).normalize());
    sky.setVector3('sunDir', this.sunDir);
    sky.setColor3('horizonColor', new Color3(0.36, 0.33, 0.32));
    sky.setFloat('time', 0);
    sky.setFloat('flash', 0);
    this.sky = sky;
    this.skyMesh = MeshBuilder.CreateSphere('skyDome', { diameter: 600, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.skyMesh.material = sky;
    this.skyMesh.infiniteDistance = true;
    this.skyMesh.isPickable = false;
    this.skyMesh.alwaysSelectAsActiveMesh = true;
    this.skyMesh.applyFog = false;
    this.envMeshes.push(this.skyMesh);

    const fill = new HemisphericLight('stormFill', new Vector3(-0.3, 1, 0.35), scene);
    // Cool storm fill, low: the warm sun and the practical lights carry the contrast.
    fill.diffuse.set(0.58, 0.68, 0.82);
    fill.groundColor.set(0.2, 0.19, 0.2);
    fill.specular.set(0, 0, 0);
    fill.intensity = 0.26;

    this.beamMat = new ShaderMaterial('lampBeam', scene, 'rwBeam', {
      attributes: ['position', 'normal', 'uv'],
      uniforms: ['world', 'viewProjection', 'cameraPosition', 'color', 'time'],
      needAlphaBlending: true,
    });
    this.beamMat.alphaMode = Constants.ALPHA_ADD;
    this.beamMat.disableDepthWrite = true;
    this.beamMat.backFaceCulling = false;
    this.beamMat.setColor3('color', new Color3(0.12, 0.16, 0.21));

    this.mist = new RiftMist(scene, layout);
    this.buildSkyline();
    this.buildLamps();
    this.buildSconces();
    this.buildGateLights();

    const flare = flareSprite(scene);
    this.dust = this.makeDust(flare);
    this.embers = this.makeEmbers(flare);
    this.rain = this.makeRain(sparkSprite(scene));
  }

  /** Light the actual floor and retaining structures under the foreground gantry. */
  lightYard(surfaces: AbstractMesh[]): void {
    for (const side of [-1, 1]) {
      const source = new Vector3(side * 22, 11.23, -8);
      const axis = new Vector3(-side * 0.43, -1, 0.12).normalize();
      const lamp = new SpotLight('gantryFloodlight', source, axis, 1.58, 2.4, this.scene);
      lamp.diffuse = side < 0 ? new Color3(1, 0.76, 0.53) : new Color3(0.51, 0.72, 1);
      lamp.specular.copyFrom(lamp.diffuse);
      lamp.range = 30;
      lamp.intensity = 3.8;
      lamp.includedOnlyMeshes = surfaces;
    }
  }

  /** The gate portal discs use the swirling rift shader instead of a flat emissive. */
  adoptPortals(): void {
    let i = 0;
    for (const m of this.scene.meshes) {
      if (m.name !== 'rift') continue;
      const mat = createRiftMaterial(this.scene, `riftPortal${i}`, new Color3(2.9, 0.39, 0.09), i * 13.7);
      m.material = mat;
      this.portalMats.push(mat);
      i++;
    }
  }

  private buildSkyline(): void {
    const cut = new TransformNode('quarryCut', this.scene);
    // Surveyed cuts sit beyond the retaining walls. The low northern saddle frames the magnet.
    for (const [x, z, yaw, length, height, depth] of [
      [42, 84, 1.92, 142, 118, 93], [69, 73, 1.44, 116, 154, 100],
      [93, 42, 0.42, 124, 121, 127], [86, 2, -0.32, 114, 94, 110],
      [72, -43, -0.82, 102, 67, 83], [-85, 30, -0.41, 132, 108, 99],
      [-78, -33, 0.75, 119, 88, 85], [-32, -93, 1.21, 149, 76, 95],
      [23, -104, 1.75, 140, 97, 120],
    ]) placeScan(cut, 'rock', [x * 1.35, -9, z * 1.35], yaw, [length * 1.1, height * 0.8, depth]);
  }

  private buildLamps(): void {
    const H = 11.9;
    const beams: Mesh[] = [];
    const housings: Mesh[] = [];
    const lenses: Mesh[] = [];
    const pools: Mesh[] = [];
    for (const [x, z] of LAMPS) {
      const beam = MeshBuilder.CreateCylinder('beam', { diameterTop: 0.9, diameterBottom: 7.5, height: H - 0.55, tessellation: 24, cap: Mesh.NO_CAP }, this.scene);
      beam.position.set(x, (H - 0.55) / 2, z);
      beams.push(beam);
      const hs = MeshBuilder.CreateCylinder('lampH', { diameterTop: 0.6, diameterBottom: 1.4, height: 0.7, tessellation: 12 }, this.scene);
      hs.position.set(x, 12 - 0.35, z);
      housings.push(hs);
      const lens = MeshBuilder.CreateCylinder('lampL', { diameter: 1.1, height: 0.05, tessellation: 12 }, this.scene);
      lens.position.set(x, 11.3, z);
      lenses.push(lens);
      const pool = MeshBuilder.CreateDisc('lampPool', { radius: 4.2, tessellation: 32 }, this.scene);
      pool.rotation.x = Math.PI / 2;
      pool.position.set(x, 0.03, z);
      pools.push(pool);
    }
    const beam = Mesh.MergeMeshes(beams, true, true)!;
    beam.material = this.beamMat;
    beam.isPickable = false;
    beam.applyFog = false;
    beam.name = 'lampBeams';
    this.lampBeams = beam;
    const housing = Mesh.MergeMeshes(housings, true, true)!;
    housing.material = this.P.graphite;
    housing.isPickable = false;
    const lens = Mesh.MergeMeshes(lenses, true, true)!;
    lens.material = unlit(this.scene, 'lampLens', [2.2, 2.0, 1.7]);
    lens.isPickable = false;
    // Fake light pools on the deck: additive soft discs.
    const flare = flareSprite(this.scene);
    const poolMat = unlit(this.scene, 'lampPoolMat', [0.13, 0.15, 0.16], { tex: flare, opacity: flare, additive: true, zOffset: -2 });
    const pool = Mesh.MergeMeshes(pools, true, true)!;
    pool.material = poolMat;
    pool.isPickable = false;
    for (const m of [beam, housing, lens, pool]) m.freezeWorldMatrix();
    this.envMeshes.push(housing, lens);
  }

  /** Wall lamps on the inner perimeter with fake light splashes fanning down the cladding. */
  private buildSconces(): void {
    const H = this.layout.half;
    const housings: Mesh[] = [];
    const lenses: Mesh[] = [];
    const splashes: Mesh[] = [];
    const place = (x: number, z: number, nx: number, nz: number) => {
      const yaw = Math.atan2(nx, nz);
      const hs = MeshBuilder.CreateBox('sconce', { width: 1.1, height: 0.35, depth: 0.5 }, this.scene);
      hs.position.set(x + nx * 0.25, 6.6, z + nz * 0.25);
      hs.rotation.y = yaw;
      housings.push(hs);
      const ln = MeshBuilder.CreateBox('sconceL', { width: 0.9, height: 0.06, depth: 0.36 }, this.scene);
      ln.position.set(x + nx * 0.27, 6.41, z + nz * 0.27);
      ln.rotation.y = yaw;
      lenses.push(ln);
      const sp = MeshBuilder.CreatePlane('splash', { width: 5, height: 6.4 }, this.scene);
      sp.position.set(x + nx * 0.06, 3.3, z + nz * 0.06);
      sp.rotation.y = yaw + Math.PI;
      splashes.push(sp);
    };
    for (let c = -36; c <= 36; c += 12) {
      if (Math.abs(c) > 8) {
        place(c, -H, 0, 1);
        place(c, H, 0, -1);
        place(H, c, -1, 0);
        place(-H, c, 1, 0);
      }
    }
    const hs = Mesh.MergeMeshes(housings, true, true)!;
    hs.material = this.P.graphite;
    hs.isPickable = false;
    const ln = Mesh.MergeMeshes(lenses, true, true)!;
    ln.material = unlit(this.scene, 'sconceLens', [2.6, 2.1, 1.5]);
    ln.isPickable = false;
    const sp = Mesh.MergeMeshes(splashes, true, true)!;
    const cone = splashTexture(this.scene);
    sp.material = unlit(this.scene, 'sconceSplash', [0.5, 0.36, 0.22], { tex: cone, opacity: cone, additive: true, zOffset: -2 });
    sp.isPickable = false;
    for (const m of [hs, ln, sp]) m.freezeWorldMatrix();
    this.envMeshes.push(hs, ln);
  }

  private buildGateLights(): void {
    const H = this.layout.half;
    const filament = sparkSprite(this.scene);
    for (const [x, z] of [[0, H + 5], [H + 5, 0], [-H - 5, 0], [0, -H - 5]]) {
      const l = new PointLight('gateLight', new Vector3(x, 3.4, z), this.scene);
      l.diffuse = new Color3(1, 0.42, 0.12);
      l.specular = new Color3(1, 0.5, 0.2);
      l.intensity = 1.6;
      l.range = 24;
      this.gateLights.push(l);
      // embers pouring out of each rift
      const ps = new ParticleSystem('gateEmbers', 120, this.scene);
      ps.particleTexture = filament;
      ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
      ps.minScaleY = 1.7;
      ps.maxScaleY = 3.8;
      const inward = new Vector3(-x, 0, -z).normalize();
      ps.emitter = new Vector3(x, 3.5, z);
      ps.minEmitBox = new Vector3(-2.5, -2.5, -2.5);
      ps.maxEmitBox = new Vector3(2.5, 2.5, 2.5);
      ps.direction1 = inward.scale(1.5).add(new Vector3(-0.6, 0.2, -0.6));
      ps.direction2 = inward.scale(3.5).add(new Vector3(0.6, 1.2, 0.6));
      ps.minEmitPower = 0.8;
      ps.maxEmitPower = 2.9;
      ps.minLifeTime = 2;
      ps.maxLifeTime = 4.5;
      ps.minSize = 0.04;
      ps.maxSize = 0.085;
      ps.emitRate = 22;
      ps.gravity = new Vector3(0, 0.4, 0);
      ps.addColorGradient(0, new Color4(0, 0, 0, 0));
      ps.addColorGradient(0.1, new Color4(3, 0.9, 0.2, 1));
      ps.addColorGradient(0.7, new Color4(2, 0.35, 0.05, 1));
      ps.addColorGradient(1, new Color4(0.3, 0.02, 0, 0));
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.start();
      this.gateEmbers.push(ps);
    }
  }

  private makeDust(tex: ParticleSystem['particleTexture']): ParticleSystem {
    const ps = new ParticleSystem('dust', 600, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3();
    ps.minEmitBox = new Vector3(-18, -3, -18);
    ps.maxEmitBox = new Vector3(18, 9, 18);
    ps.direction1 = new Vector3(-0.15, -0.05, -0.15);
    ps.direction2 = new Vector3(0.15, 0.08, 0.15);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.6;
    ps.minLifeTime = 6;
    ps.maxLifeTime = 11;
    ps.minSize = 0.018;
    ps.maxSize = 0.05;
    ps.emitRate = 55;
    ps.gravity = new Vector3(0, -0.02, 0);
    ps.addColorGradient(0, new Color4(0, 0, 0, 0));
    ps.addColorGradient(0.2, new Color4(0.9, 0.8, 0.62, 0.35));
    ps.addColorGradient(0.8, new Color4(0.85, 0.76, 0.6, 0.3));
    ps.addColorGradient(1, new Color4(0, 0, 0, 0));
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.preWarmCycles = 120;
    ps.preWarmStepOffset = 5;
    ps.start();
    return ps;
  }

  private makeEmbers(tex: ParticleSystem['particleTexture']): ParticleSystem {
    const ps = new ParticleSystem('ashfall', 400, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(0, 22, 0);
    ps.minEmitBox = new Vector3(-40, 0, -40);
    ps.maxEmitBox = new Vector3(40, 4, 40);
    ps.direction1 = new Vector3(-0.6, -1, -0.2);
    ps.direction2 = new Vector3(0.2, -0.6, 0.6);
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 1.4;
    ps.minLifeTime = 10;
    ps.maxLifeTime = 16;
    ps.minSize = 0.03;
    ps.maxSize = 0.09;
    ps.emitRate = 26;
    ps.addColorGradient(0, new Color4(0, 0, 0, 0));
    ps.addColorGradient(0.1, new Color4(2.4, 0.7, 0.18, 1));
    ps.addColorGradient(0.6, new Color4(1.4, 0.3, 0.06, 0.8));
    ps.addColorGradient(1, new Color4(0.1, 0.02, 0.01, 0));
    ps.addAngularSpeedGradient(0, -2, 2);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.preWarmCycles = 200;
    ps.preWarmStepOffset = 6;
    ps.start();
    return ps;
  }

  private makeRain(texture: ParticleSystem['particleTexture']): ParticleSystem {
    const drops = new ParticleSystem('yardRain', 680, this.scene);
    drops.particleTexture = texture;
    drops.emitter = new Vector3();
    drops.minEmitBox = new Vector3(-17, 3.6, -15);
    drops.maxEmitBox = new Vector3(17, 14, 19);
    drops.direction1 = new Vector3(-0.25, -1, 0.15);
    drops.direction2 = new Vector3(-0.19, -1, 0.21);
    drops.minEmitPower = 11;
    drops.maxEmitPower = 16;
    drops.minLifeTime = 0.65;
    drops.maxLifeTime = 1.24;
    drops.minSize = 0.035;
    drops.maxSize = 0.083;
    drops.minScaleX = 0.31;
    drops.maxScaleX = 0.54;
    drops.minScaleY = 5.7;
    drops.maxScaleY = 9.7;
    drops.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    drops.blendMode = ParticleSystem.BLENDMODE_ADD;
    drops.addColorGradient(0, new Color4(0.37, 0.51, 0.61, 0));
    drops.addColorGradient(0.25, new Color4(0.43, 0.55, 0.62, 0.46));
    drops.addColorGradient(0.68, new Color4(0.38, 0.47, 0.53, 0.31));
    drops.addColorGradient(1, new Color4(0.3, 0.43, 0.53, 0));
    drops.preWarmCycles = 24;
    drops.preWarmStepOffset = 4;
    drops.start();
    return drops;
  }

  /** Lightning flicker in the clouds around the rift. Returns the current flash level. */
  update(dt: number, camPos: Vector3): number {
    this.time += dt;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.flash = 1;
      this.nextFlash = 9 + Math.random() * 16;
    }
    // double-strike flicker
    const f = this.flash;
    this.flash = Math.max(0, this.flash - dt * 3.2);
    const flick = f > 0.5 ? f : f * (0.5 + 0.5 * Math.sin(this.time * 60));
    this.sky.setFloat('time', this.time);
    this.mist.update(this.time, camPos);
    this.sky.setFloat('flash', flick);
    this.riftMatsTime();
    this.beamMat.setFloat('time', this.time);
    this.beamMat.setVector3('cameraPosition', camPos);
    (this.dust.emitter as Vector3).copyFrom(camPos);
    (this.rain.emitter as Vector3).copyFrom(camPos);
    for (let i = 0; i < this.gateLights.length; i++) {
      const l = this.gateLights[i];
      // Rift-lit, not floodlit: the tunnel steel keeps its dark value; the mist carries the glow into the yard.
      l.intensity = 2.1 + 0.35 * Math.sin(this.time * 7.3 + i * 2) * Math.sin(this.time * 3.1 + i) + flick * 0.6;
    }
    return flick;
  }

  private riftMatsTime(): void {
    for (const m of this.portalMats) m.setFloat('time', this.time);
  }

  private qualityHigh = true;
  private density = 1;
  private reduceMotion = false;

  setQuality(high: boolean): void {
    this.qualityHigh = high;
    this.lampBeams.setEnabled(high);
    this.applyRates();
  }

  /** Scale ambient particle rates by the particle-density setting (0.2..1, on top of the quality rates). */
  setDensity(mult: number, reduceMotion: boolean): void {
    this.density = Math.max(0.2, Math.min(1, mult));
    this.reduceMotion = reduceMotion;
    this.applyRates();
  }

  private applyRates(): void {
    const high = this.qualityHigh;
    const m = this.density;
    this.dust.emitRate = (high ? 45 : 18) * m;
    this.embers.emitRate = (high ? 8 : 3) * m;
    this.rain.emitRate = this.reduceMotion ? 0 : (high ? 280 : 85) * m;
    for (const particles of this.gateEmbers) particles.emitRate = (high ? 30 : 14) * m;
  }

  /** M6: gate index 3 (south) is sealed until the secondary access route opens. */
  setGateOpen(index: number, open: boolean): void {
    this.gateLights[index]?.setEnabled(open);
    const ps = this.gateEmbers[index];
    if (!ps) return;
    if (open) ps.start();
    else ps.stop();
  }

  /**
   * Render the static scene once into a cube map from above the reactor plaza, prefilter
   * it for roughness, and use it as the PBR environment (reflections + ambient light).
   */
  captureEnvironment(extra: AbstractMesh[], lit: { realTimeFiltering: boolean }[], high: boolean): void {
    captureEnvironment(this.scene, [...this.envMeshes, ...extra], lit, new Vector3(0, 7, -8), high ? 256 : 128);
  }
}
