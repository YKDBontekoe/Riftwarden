// Engine factory (architecture v2 step 10): WebGL2, or Babylon's WebGPU engine when the settings (or `?webgpu`) ask
// for it and the browser has it (falling back to WebGL2 otherwise). WebGPU stays opt-in until it has been checked on
// real GPUs: headless SwiftShader cannot present WebGPU frames, so only its shaders are verified automatically
// (scripts/check-wgsl.mjs). `?webgl` forces WebGL2.
import { type AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Engine } from '@babylonjs/core/Engines/engine';

export type Backend = 'webgpu' | 'webgl';

export async function createEngine(canvas: HTMLCanvasElement, prefer: Backend): Promise<{ engine: AbstractEngine; backend: Backend }> {
  const params = new URLSearchParams(location.search);
  const want: Backend = params.has('webgl') ? 'webgl' : params.has('webgpu') ? 'webgpu' : params.has('test') ? 'webgl' : prefer;
  if (want === 'webgpu' && 'gpu' in navigator) {
    try {
      // Its own chunk: WebGL players never download it.
      const [{ WebGPUEngine }] = await Promise.all([
        import('@babylonjs/core/Engines/webgpuEngine'),
        // Engine extensions (dynamic / render-target / cube textures...) register by side effect.
        import('@babylonjs/core/Engines/WebGPU/Extensions/index'),
      ]);
      // initAsync requests the adapter itself (and throws without one): no separate support probe.
      const engine = new WebGPUEngine(canvas, { stencil: true, antialias: true, powerPreference: 'high-performance' });
      await engine.initAsync();
      return { engine, backend: 'webgpu' };
    } catch (e) {
      console.warn('WebGPU unavailable, using WebGL2:', e);
    }
  }
  return { engine: new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }), backend: 'webgl' };
}
