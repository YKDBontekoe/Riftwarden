// Babylon pieces that register themselves by side effect: scene components and prototype augmentations. With deep
// imports (scripts/babylon-deep-imports.mjs) nothing pulls them in implicitly, so every entry point (client, sim
// worker, tests) imports this module once before building a scene.
import '@babylonjs/core/Culling/ray'; // scene.pick / multiPickWithRay / createPickingRay
import '@babylonjs/core/Meshes/instancedMesh'; // Mesh.createInstance
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent'; // scene.enablePhysics / getPhysicsEngine
import '@babylonjs/core/Physics/v2/physicsEngineComponent'; // physics bodies on transform nodes
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent'; // SSAO2 / SSR geometry buffer
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import '@babylonjs/core/Animations/animatable';
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture';
import '@babylonjs/core/Engines/Extensions/engine.renderTarget';
import '@babylonjs/core/Engines/Extensions/engine.renderTargetCube';
import '@babylonjs/core/Engines/Extensions/engine.cubeTexture';
