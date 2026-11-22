// WGSL versions of the custom shaders (architecture v2 step 10). Each GLSL shader in Effect.ShadersStore has a twin
// here under the same name, so a WebGPU engine compiles native WGSL and never downloads Babylon's GLSL translator
// (glslang + twgsl from a CDN, which would also break offline play). Keep the twins in sync when a shader changes.
// Babylon's WGSL dialect: `attribute` / `varying` / `uniform` declarations; read them as vertexInputs.x,
// fragmentInputs.x, uniforms.x; write vertexOutputs.position / vertexOutputs.x and fragmentOutputs.color.
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { type Scene } from '@babylonjs/core/scene';

/** The shader language for materials of this scene's engine. */
export function shaderLanguageFor(scene: Scene): ShaderLanguage {
  return scene.getEngine().isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL;
}

const W = ShaderStore.ShadersStoreWGSL;

/** GLSL mod(): x - y * floor(x / y) (WGSL's % truncates). */
const MOD = /* wgsl */ `
fn gmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }`;

const NOISE3 = /* wgsl */ `
fn hash13(q: vec3f) -> f32 { var p = fract(q * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn vnoise3(x: vec3f) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3f(1., 0., 0.)), f.x), mix(hash13(i + vec3f(0., 1., 0.)), hash13(i + vec3f(1., 1., 0.)), f.x), f.y),
             mix(mix(hash13(i + vec3f(0., 0., 1.)), hash13(i + vec3f(1., 0., 1.)), f.x), mix(hash13(i + vec3f(0., 1., 1.)), hash13(i + vec3f(1., 1., 1.)), f.x), f.y), f.z);
}
fn fbm3(q: vec3f) -> f32 { var p = q; var s = 0.0; var a = 0.5; for (var i = 0; i < 5; i++) { s += a * vnoise3(p); p = p * 2.03 + vec3f(1.7, 9.2, 3.1); a *= 0.5; } return s; }`;

// ---------------------------------------------------------------- sky (atmosphere.ts)

W['rwSkyVertexShader'] = /* wgsl */ `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = vertexInputs.position;
  let p = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = vec4f(p.x, p.y, p.w * 0.99995, p.w);
}`;

W['rwSkyFragmentShader'] = /* wgsl */ `
varying vDir: vec3f;
uniform time: f32;
uniform flash: f32;
uniform riftDir: vec3f;
uniform sunDir: vec3f;
uniform horizonColor: vec3f;
uniform skyBiome: f32;
var mountainsSampler: sampler;
var mountains: texture_2d<f32>;
${NOISE3}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(fragmentInputs.vDir);
  let h = d.y;
  let time = uniforms.time;
  let flash = uniforms.flash;
  let sd = max(dot(d, normalize(uniforms.sunDir)), 0.0);
  let cryo = uniforms.skyBiome > .5 && uniforms.skyBiome < 1.5;
  let foundry = uniforms.skyBiome > 1.5;
  let horizon = exp(-6.8 * max(h, 0.0));
  let zenith = select(select(vec3f(.049, .044, .105), vec3f(.10, .04, .055), foundry), vec3f(.026, .049, .102), cryo);
  let key = select(vec3f(1., .58, .33), vec3f(.45, .7, 1.), cryo);
  var col = mix(zenith, uniforms.horizonColor, horizon * .88);
  col += key * pow(sd, 4.0) * (0.15 + horizon * .57);
  let cloudPos = d * vec3f(4.8, 22.0, 9.0) + vec3f(time * .012, 2., time * .006);
  let cloud = fbm3(cloudPos);
  let cover = smoothstep(.34, .64, cloud) * smoothstep(-.04, .21, h);
  let silver = key * (pow(sd, 2.5) * .29 + .05);
  col = mix(col, zenith * .42 + silver, cover * select(.93, .54, cryo));
  let azimuth = atan2(d.x, d.z) / 3.14159265 + .76;
  let elevation = (asin(clamp(h, -1.0, 1.0)) + .11) / .44;
  var ridgeColor = textureSample(mountains, mountainsSampler, vec2f(azimuth, elevation)).rgb;
  let ridgeTint = select(select(vec3f(.42, .42, .56), vec3f(.61, .32, .25), foundry), vec3f(.43, .56, .74), cryo);
  ridgeColor *= mix(ridgeTint, key * .69, pow(sd, 2.0));
  col = mix(col, ridgeColor, (1.0 - smoothstep(.62, .98, elevation)) * .87);
  col += key * .78 * pow(sd, 45.);
  col += key * 3.2 * smoothstep(.99945, .99982, sd) * (1. - cover * .8);

  if (cryo) {
    let north = smoothstep(-.45, .5, d.z);
    let bend = .43 + .15 * sin(azimuth * 7. + time * .045) + .062 * sin(azimuth * 14. - time * .035);
    let edge = h - bend;
    let striation = vnoise3(vec3f(azimuth * 183., h * 5., time * .08));
    let curtain = (1. - smoothstep(0., .22, edge)) * smoothstep(-.028, .027, edge);
    let rim = exp(-edge * edge * 4600.);
    col += (vec3f(.12, .84, .64) * curtain * .64 + vec3f(.39, .8, .98) * rim * .35) * north * (.23 + striation * .77);
    let upper = h - bend - .18;
    col += vec3f(.31, .18, .6) * exp(-upper * upper * 160.) * north * striation * .31;
  }
  if (foundry) {
    let smoke = fbm3(vec3f(azimuth * 11., h * 16. + time * .018, time * .03));
    let height = (h - .23) * 4.4;
    let bank = smoothstep(.28, .63, smoke) * exp(-height * height);
    col = mix(col, vec3f(.14, .045, .05) + vec3f(.48, .105, .037) * (1. - h), bank * .68);
  }

  let rd = normalize(uniforms.riftDir);
  let n = normalize(cross(rd, normalize(vec3f(0.35, 1.0, 0.1))));
  let along = dot(d, rd);
  let distort = (fbm3(d * 5.0 + vec3f(0.0, time * 0.03, 0.0)) - 0.5) * 0.1;
  let w = abs(dot(d, n) + distort);
  let mask = smoothstep(.57, .87, along) * smoothstep(.12, .35, h) * select(.55, .16, cryo || foundry);
  let ridge = fbm3(d * 24.0 + vec3f(time * 0.018, 1.8, 0.0));
  let core = exp(-w * w * 49000.0) * mask * (0.4 + ridge);
  let branch = (fbm3(d * 11.0 + vec3f(3.7, 0.0, time * 0.022)) - 0.43) * 0.14;
  let filament = (dot(d, n) + distort + branch) * 145.0;
  let arcs = exp(-filament * filament) * mask * smoothstep(0.35, 0.68, ridge);
  let glowR = exp(-w * w * 500.0) * mask;
  let pulse = 0.85 + 0.15 * sin(time * 1.3 + along * 9.0);
  col += (vec3f(4.0, 1.8, 0.82) * core + vec3f(0.72, 0.21, 0.13) * glowR * (0.25 + cloud)) * pulse * (1.0 + flash * 2.0);
  col += vec3f(1.3, 0.41, 0.2) * arcs * pulse;
  col += vec3f(1.0, 0.5, 0.45) * flash * glowR * cover;
  fragmentOutputs.color = vec4f(col, 1.0);
}`;

// ---------------------------------------------------------------- rift portal (atmosphere.ts)

W['rwRiftVertexShader'] = /* wgsl */ `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`;

W['rwRiftFragmentShader'] = /* wgsl */ `
varying vUV: vec2f;
uniform time: f32;
uniform seed: f32;
uniform energyColor: vec3f;
${NOISE3}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let time = uniforms.time;
  let p = fragmentInputs.vUV * 2.0 - 1.0;
  let r = length(p);
  if (r > 1.0) { discard; }
  let angle = atan2(p.y, p.x);
  let twist = angle + 1.4 * log(r + 0.23) - time * 0.29;
  let flow = vec3f(cos(twist), sin(twist), r * 8.5 + uniforms.seed);
  let cloud = fbm3(flow * vec3f(2.6, 2.6, 0.54) - vec3f(0.0, 0.0, time * 0.27));
  let detail = fbm3(flow * vec3f(5.7, 5.7, 2.2) + vec3f(time * 0.18, 0.0, 0.0));
  let envelope = smoothstep(0.3, 0.71, r) * (1.0 - smoothstep(0.88, 1.0, r));
  let ribbon = r - (0.84 + (cloud - 0.48) * 0.36);
  let arcs = exp(-ribbon * ribbon * (160.0 + detail * 350.0));
  let strands = pow(0.5 + 0.5 * sin(r * 82.0 + detail * 12.7 + cloud * 17.0), 12.0);
  let fractures = smoothstep(0.41, 0.72, detail + cloud * 0.28);
  let filament = strands * fractures * envelope * arcs;
  let vapour = smoothstep(0.25, 0.75, cloud + detail * 0.21) * envelope;
  var col = vec3f(0.012, 0.021, 0.033) * (0.15 + cloud * 2.0);
  col += uniforms.energyColor * (vapour * 0.24 + arcs * fractures * 0.54 + filament * 2.5);
  col += mix(uniforms.energyColor, vec3f(2.4, 2.0, 1.7), 0.63) * filament * filament;
  col *= 1.0 - smoothstep(0.96, 1.0, r) * 0.88;
  fragmentOutputs.color = vec4f(col, 1.0);
}`;

// ---------------------------------------------------------------- lamp beams (atmosphere.ts)

W['rwBeamVertexShader'] = /* wgsl */ `
attribute position: vec3f;
attribute normal: vec3f;
attribute uv: vec2f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vN: vec3f;
varying vW: vec3f;
varying vH: f32;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let w = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vW = w.xyz;
  let m = mat3x3f(uniforms.world[0].xyz, uniforms.world[1].xyz, uniforms.world[2].xyz);
  vertexOutputs.vN = normalize(m * vertexInputs.normal);
  vertexOutputs.vH = vertexInputs.uv.y;
  vertexOutputs.position = uniforms.viewProjection * w;
}`;

W['rwBeamFragmentShader'] = /* wgsl */ `
varying vN: vec3f;
varying vW: vec3f;
varying vH: f32;
uniform cameraPosition: vec3f;
uniform color: vec3f;
uniform time: f32;
${NOISE3}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vW = fragmentInputs.vW;
  let vH = fragmentInputs.vH;
  let v = normalize(uniforms.cameraPosition - vW);
  let facing = abs(dot(normalize(fragmentInputs.vN), v));
  let soft = pow(facing, 2.5);
  let fall = smoothstep(0.0, 0.35, vH) * (0.25 + 0.75 * vH);
  let dust = 0.75 + 0.5 * vnoise3(vW * 0.9 + vec3f(0.0, -uniforms.time * 0.25, uniforms.time * 0.1));
  let dist = length(uniforms.cameraPosition - vW);
  let near = smoothstep(0.5, 4.0, dist);
  let a = soft * fall * dust * near;
  fragmentOutputs.color = vec4f(uniforms.color * a, a);
}`;

// ---------------------------------------------------------------- lane path lights (pathLighting.ts)

W['rwPathVertexShader'] = /* wgsl */ `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
varying vPath: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vPath = vertexInputs.uv;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`;

W['rwPathFragmentShader'] = /* wgsl */ `
varying vPath: vec2f;
uniform signalColor: vec3f;
uniform travel: f32;
uniform activity: f32;
uniform flash: f32;
uniform warning: f32;
uniform pathLength: f32;
${MOD}
fn line(distance: f32, width: f32, feather: f32) -> f32 {
  return 1.0 - smoothstep(width, width + feather, abs(distance));
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let across = abs(fragmentInputs.vPath.x);
  let along = fragmentInputs.vPath.y;
  let acrossAA = max(0.007, min(fwidth(across), 0.09));
  let alongAA = max(0.02, min(fwidth(along), 0.35));
  let activity = uniforms.activity;
  let flash = uniforms.flash;
  let warning = uniforms.warning;

  let joint = smoothstep(0.025, 0.11, abs(gmod(along + 1.8, 3.6) - 1.8));
  let groove = line(across - 0.81, 0.075, acrossAA);
  let rails = line(across - 0.81, 0.026, acrossAA) * joint;
  let markers = line(across - 0.95, 0.018, acrossAA) * line(gmod(along + 0.9, 1.8) - 0.9, 0.23, alongAA);

  let arrow = gmod(along + across * mix(0.82, 1.65, warning) + 1.8, 3.6) - 1.8;
  let chevron = line(arrow, 0.085, alongAA) * (1.0 - smoothstep(0.49, 0.55, across));
  let shoulder = (1.0 - smoothstep(0.82, 1.0, across)) * mix(0.14, 0.29, warning);

  let tail = gmod(along - uniforms.travel + 9.0, 18.0) - 9.0;
  let pulse = line(tail, 0.6, 2.2);
  let tracer = line(tail, 0.12, 0.45);
  let field = 0.21 + activity * 0.41;
  let light = rails * (field + pulse * activity * 1.4 + tracer * flash)
            + markers * (0.14 + activity * 0.35)
            + chevron * (field * 0.72 + pulse * activity * 1.45 + flash * 0.25);
  let endFade = smoothstep(0.0, 0.75, along) * (1.0 - smoothstep(uniforms.pathLength - 0.8, uniforms.pathLength, along));
  let opacity = max(max(groove * 0.78, shoulder), max(chevron * 0.78, markers));
  fragmentOutputs.color = vec4f(vec3f(0.023, 0.032, 0.037) + uniforms.signalColor * light, opacity * endFade);
}`;

// ---------------------------------------------------------------- landmark energy (arenaLandmark.ts)

W['rwLandmarkVertexShader'] = /* wgsl */ `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.);
}`;

W['rwLandmarkFragmentShader'] = /* wgsl */ `
varying vUV: vec2f;
uniform energy: vec3f;
uniform time: f32;
uniform flow: f32;
uniform seed: f32;
fn hash(p: vec2f) -> f32 {
  var q = fract(vec3f(p.x, p.y, p.x) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn noise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2f(1., 0.)), f.x), mix(hash(i + vec2f(0., 1.)), hash(i + vec2f(1., 1.)), f.x), f.y);
}
fn cloud(p: vec2f) -> f32 {
  return .57 * noise(p) + .29 * noise(p * 2.1 + 4.) + .14 * noise(p * 4.3 + 17.);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUV;
  let p = uv * 2. - 1.;
  let time = uniforms.time;
  let seed = uniforms.seed;
  let energy = uniforms.energy;
  if (uniforms.flow > .5) {
    let down = select(1. - uv.y, uv.y, uniforms.flow > 1.5);
    let stream = cloud(vec2f(p.x * 9. + seed, down * 4. - time * 1.6));
    let spread = mix(.24, 1., down);
    let edge = 1. - smoothstep(spread * .32, spread, abs(p.x) + (stream - .5) * .25);
    let strength = edge * (1. - smoothstep(.08, 1., down)) * smoothstep(0., .06, down);
    let col = energy * mix(.55, 1.4, stream) * strength;
    fragmentOutputs.color = vec4f(col, strength * mix(.4, .85, stream));
  } else {
    let r = length(p);
    let theta = atan2(p.y, p.x + .00001);
    let spiral = vec2f(theta * 3.1 + r * 16. - time * .4, r * 6.);
    let wisps = cloud(spiral + seed);
    let x = p.x - (.13 * sin(p.y * 6.4 + .25 * sin(time)) + (noise(vec2f(p.y * 12., seed)) - .5) * .22);
    let tear = abs(x) / max(.043, .34 * (1. - p.y * p.y));
    let split = abs(x + sin(p.y * 13. + 1.) * .13 + .095);
    let fall = (1. - smoothstep(.62, 1., r));
    let whiteCore = exp(-tear * tear * 65.) * (.4 + .6 * wisps);
    let branches = exp(-split * 68.) * smoothstep(.43, .67, wisps);
    let halo = exp(-tear * tear * 1.65) * fall;
    var col = energy * (halo * (.12 + wisps * .6) + branches * .77);
    col += vec3f(2.8, 1.9, 1.5) * whiteCore;
    fragmentOutputs.color = vec4f(col * fall, max(whiteCore, halo) * fall);
  }
}`;

// ---------------------------------------------------------------- gate mist (riftMist.ts)

W['rwMistVertexShader'] = /* wgsl */ `
attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vW: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let w = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vW = w.xyz;
  vertexOutputs.position = uniforms.viewProjection * w;
}`;

W['rwMistFragmentShader'] = /* wgsl */ `
varying vW: vec3f;
uniform time: f32;
uniform color: vec3f;
uniform mouth: vec3f;
uniform inward: vec3f;
uniform halfWidth: f32;
uniform strength: f32;
uniform cameraPosition: vec3f;
fn h2(q: vec2f) -> f32 { var p = fract(q * vec2f(0.3183, 0.3678) + 0.1); p = p * 17.0; return fract(p.x * p.y * (p.x + p.y)); }
fn n2(x: vec2f) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2f(1., 0.)), f.x), mix(h2(i + vec2f(0., 1.)), h2(i + vec2f(1., 1.)), f.x), f.y);
}
fn fbm(q: vec2f) -> f32 { var p = q; var s = 0.0; var a = 0.5; for (var i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.07 + vec2f(3.1, 1.7); a *= 0.5; } return s; }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vW = fragmentInputs.vW;
  let time = uniforms.time;
  let inward = uniforms.inward;
  let rel = vW - uniforms.mouth;
  let d = dot(rel, inward);
  let side = normalize(cross(inward, vec3f(0.0, 1.0, 0.0)));
  let across = abs(dot(rel, side)) / (uniforms.halfWidth + max(d, 0.0) * 0.45);
  let flow = vec2f(dot(vW, side), dot(vW, inward));
  let n = fbm(flow * 0.21 - vec2f(0.0, time * 0.32)) * 0.65 + fbm(flow * 0.55 + vec2f(time * 0.07, -time * 0.5)) * 0.35;
  let body = smoothstep(0.3, 0.74, n);
  let fade = (1.0 - smoothstep(-2.0, 16.0, d)) * smoothstep(-11.0, -6.0, d);
  let edge = 1.0 - smoothstep(0.55, 1.0, across);
  let near = smoothstep(0.6, 3.0, length(uniforms.cameraPosition - vW));
  let a = body * fade * edge * near * uniforms.strength;
  fragmentOutputs.color = vec4f(uniforms.color * a, 1.0);
}`;

// ---------------------------------------------------------------- reactor plasma (reactorField.ts)

W['rwReactorFieldVertexShader'] = /* wgsl */ `
attribute position: vec3f;
uniform world: mat4x4f;
uniform worldViewProjection: mat4x4f;
varying vPosition: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vPosition = (uniforms.world * vec4f(vertexInputs.position, 1.0)).xyz;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`;

W['rwReactorFieldFragmentShader'] = /* wgsl */ `
varying vPosition: vec3f;
uniform cameraPosition: vec3f;
uniform energy: vec3f;
uniform chamber: vec2f;
uniform time: f32;
fn hash31(q: vec3f) -> f32 {
  var p = fract(q * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
fn noise(p: vec3f) -> f32 {
  let cell = floor(p); var t = fract(p);
  t = t * t * (3.0 - 2.0 * t);
  return mix(
    mix(mix(hash31(cell), hash31(cell + vec3f(1., 0., 0.)), t.x), mix(hash31(cell + vec3f(0., 1., 0.)), hash31(cell + vec3f(1., 1., 0.)), t.x), t.y),
    mix(mix(hash31(cell + vec3f(0., 0., 1.)), hash31(cell + vec3f(1., 0., 1.)), t.x), mix(hash31(cell + vec3f(0., 1., 1.)), hash31(cell + vec3f(1., 1., 1.)), t.x), t.y),
    t.z);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let time = uniforms.time;
  let energy = uniforms.energy;
  let chamber = uniforms.chamber;
  let ray = normalize(fragmentInputs.vPosition - uniforms.cameraPosition);
  let entry = fragmentInputs.vPosition + ray * 0.002;
  let a = max(dot(ray.xz, ray.xz), 0.00001);
  let b = dot(entry.xz, ray.xz);
  let c = dot(entry.xz, entry.xz) - 1.0;
  let toSide = (-b + sqrt(max(0.0, b * b - a * c))) / a;
  let toCap = select((entry.y - chamber.x) / max(-ray.y, 0.00001), (chamber.y - entry.y) / max(ray.y, 0.00001), ray.y > 0.0);
  let stride = max(0.0, min(toSide, toCap)) / 16.0;
  let offset = hash31(vec3f(fragmentInputs.position.xy, 0.0));
  var p = entry + ray * stride * offset;
  var transmittance = 1.0;
  var radiance = vec3f(0.0);
  for (var i = 0; i < 16; i++) {
    let flow = p.y * 2.55 - time * 1.45;
    let curl = noise(p * vec3f(4.0, 2.2, 4.0) - vec3f(0.0, time * 1.7, 0.0));
    let spine = vec2f(cos(flow + curl), sin(flow + curl)) * (0.32 + 0.19 * curl);
    let d1 = length(p.xz - spine);
    let d2 = length(p.xz + spine * 0.51);
    let threads = exp(-d1 * d1 * 43.0) + exp(-d2 * d2 * 82.0) * 0.69;
    let shell = 1.0 - smoothstep(0.66, 0.98, length(p.xz));
    let density = shell * (0.15 + curl * 0.28 + threads * 1.72);
    let alpha = 1.0 - exp(-density * stride * 1.8);
    let hot = mix(energy * 0.19, energy * 2.15 + vec3f(0.7, 0.74, 0.78), smoothstep(0.11, 0.91, threads));
    radiance += transmittance * alpha * hot * (0.49 + curl * 0.87);
    transmittance *= 1.0 - alpha;
    p += ray * stride;
  }
  fragmentOutputs.color = vec4f(radiance + transmittance * vec3f(0.012, 0.017, 0.022), 1.0);
}`;

// ---------------------------------------------------------------- soft particles (softParticles.ts)

W['rwSoftParticlePixelShader'] = /* wgsl */ `
varying vUV: vec2f;
varying vColor: vec4f;
var diffuseSamplerSampler: sampler;
var diffuseSampler: texture_2d<f32>;
var worldDepthSampler: sampler;
var worldDepth: texture_2d<f32>;
uniform inverseViewport: vec2f;
uniform fadeDistance: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let sprite = textureSample(diffuseSampler, diffuseSamplerSampler, fragmentInputs.vUV);
  let depth = textureSample(worldDepth, worldDepthSampler, fragmentInputs.position.xy * uniforms.inverseViewport).r;
  let fade = select(smoothstep(0.0, uniforms.fadeDistance, depth - 1.0 / fragmentInputs.position.w), 1.0, depth <= 0.85);
  let color = pow(max(vec3f(0.0), sprite.rgb * fragmentInputs.vColor.rgb), vec3f(2.2));
  fragmentOutputs.color = vec4f(color, sprite.a * fragmentInputs.vColor.a * fade);
}`;

// ---------------------------------------------------------------- area attack warning (telegraphBoundary.ts)

W.rwTelegraphVertexShader = /* wgsl */ `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv * 2.0 - vec2f(1.0);
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`;

W.rwTelegraphFragmentShader = /* wgsl */ `
varying vUV: vec2f;
uniform tone: vec3f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUV;
  let radius = length(uv) * 1.07;
  let aa = clamp(fwidth(radius), 0.001, 0.016);
  let d = abs(radius - 1.0);
  let outline = 1.0 - smoothstep(0.027 - aa, 0.027 + aa, d);
  let edge = 1.0 - smoothstep(0.009 - aa, 0.009 + aa, d);
  let angle = atan2(uv.y, uv.x);
  let tab = 1.0 - smoothstep(0.11, 0.26, abs(sin(angle * 6.0)));
  let ticks = tab * smoothstep(0.892 - aa, 0.892 + aa, radius) * (1.0 - smoothstep(0.968 - aa, 0.968 + aa, radius));
  let stroke = max(edge, ticks * 0.86);
  let alpha = max(outline * 0.81, stroke);
  if (alpha < 0.02) { discard; }
  fragmentOutputs.color = vec4f(mix(vec3f(0.035, 0.024, 0.031), mix(uniforms.tone * 0.47, vec3f(1.0), 0.16), stroke), alpha);
}`;
