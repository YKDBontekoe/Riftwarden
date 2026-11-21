// Compile the custom WGSL shaders (packages/game/src/visuals/wgsl.ts) with the browser's real WGSL compiler (Tint, via
// headless Chromium + SwiftShader). Babylon's dialect (attribute / varying / uniform declarations, vertexInputs /
// vertexOutputs / fragmentInputs / fragmentOutputs / uniforms) is lowered to plain WGSL the way Babylon's WebGPU shader
// processor does, so type and syntax errors in the shader bodies show up here instead of on a player's GPU.
//   node --import tsx scripts/check-wgsl.mjs
import { createRequire } from 'node:module';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import '../packages/game/src/visuals/wgsl.ts';

// CommonJS resolution: finds the development container's global Playwright like the other suites do.
const { chromium } = createRequire(import.meta.url)('playwright');

function lower(name, src) {
  const vertex = name.endsWith('VertexShader');
  const attrs = [];
  const varyings = [];
  const uniforms = [];
  let body = src
    .replace(/^\s*attribute\s+(\w+)\s*:\s*([^;]+);/gm, (_, n, t) => (attrs.push([n, t.trim()]), ''))
    .replace(/^\s*varying\s+(\w+)\s*:\s*([^;]+);/gm, (_, n, t) => (varyings.push([n, t.trim()]), ''))
    .replace(/^\s*uniform\s+(\w+)\s*:\s*([^;]+);/gm, (_, n, t) => (uniforms.push([n, t.trim()]), ''));
  let binding = 1;
  body = body.replace(/^\s*var\s+(\w+)\s*:\s*(sampler|texture_2d<f32>)\s*;/gm, (_, n, t) => `@group(0) @binding(${binding++}) var ${n}: ${t};`);
  const interp = (t) => (/^(i32|u32|vec\du)/.test(t) ? ' @interpolate(flat)' : '');
  const head = [
    `struct FragmentInputs { @builtin(position) position: vec4f, ${varyings.map(([n, t], i) => `@location(${i})${interp(t)} ${n}: ${t},`).join(' ')} };`,
    uniforms.length ? `struct Uniforms { ${uniforms.map(([n, t]) => `${n}: ${t},`).join(' ')} }; @group(0) @binding(0) var<uniform> uniforms: Uniforms;` : '',
  ];
  if (vertex) {
    head.push(`struct VertexInputs { ${attrs.map(([n, t], i) => `@location(${i}) ${n}: ${t},`).join(' ')} };`);
    head.push('var<private> vertexInputs: VertexInputs; var<private> vertexOutputs: FragmentInputs;');
    body = body.replace(/@vertex\s*fn main\(input: VertexInputs\) -> FragmentInputs \{/, '@vertex fn main(input: VertexInputs) -> FragmentInputs { vertexInputs = input;');
  } else {
    head.push('struct FragmentOutputs { @location(0) color: vec4f };');
    head.push('var<private> fragmentInputs: FragmentInputs; var<private> fragmentOutputs: FragmentOutputs;');
    body = body.replace(/@fragment\s*fn main\(input: FragmentInputs\) -> FragmentOutputs \{/, '@fragment fn main(input: FragmentInputs) -> FragmentOutputs { fragmentInputs = input;');
  }
  // Every entry point returns its output struct at the end of main.
  const i = body.lastIndexOf('}');
  body = body.slice(0, i) + (vertex ? '  return vertexOutputs;\n}' : '  return fragmentOutputs;\n}') + body.slice(i + 1);
  return head.filter(Boolean).join('\n') + '\n' + body;
}

const ours = Object.entries(ShaderStore.ShadersStoreWGSL).filter(([n]) => n.startsWith('rw'));
const shaders = ours.map(([n, s]) => ({ name: n, code: lower(n, s) }));
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage();
await p.route('http://localhost:5199/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
await p.goto('http://localhost:5199/');
const results = await p.evaluate(async (list) => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const out = [];
  for (const s of list) {
    const mod = device.createShaderModule({ code: s.code });
    const info = await mod.getCompilationInfo();
    out.push({ name: s.name, errors: info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`) });
  }
  return out;
}, shaders);
await b.close();
let bad = 0;
for (const r of results) {
  console.log(`${r.errors.length ? 'FAIL' : 'ok  '} ${r.name}${r.errors.length ? '\n     ' + r.errors.join('\n     ') : ''}`);
  if (r.errors.length) bad++;
}
console.log(`\n${results.length - bad}/${results.length} shaders compile`);
if (bad) {
  if (process.env.SHOW) for (const s of shaders) if (s.name === process.env.SHOW) console.log(s.code);
  process.exit(1);
}
