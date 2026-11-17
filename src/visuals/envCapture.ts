import { type AbstractMesh, Constants, CubeTexture, HDRFiltering, ReflectionProbe, RenderTargetTexture, type Scene, type Vector3 } from '@babylonjs/core';

/**
 * Render the finished static scene once into a reflection probe, wrap the cube in a
 * non-rendering cube texture, prefilter it and use it as the scene's IBL environment.
 * Never reference the probe's RTT from a material (it would re-render while sampled).
 * The probe and filter are disposed with the scene.
 */
export function captureEnvironment(scene: Scene, meshes: AbstractMesh[], lit: { realTimeFiltering: boolean }[], at: Vector3, size = 256): void {
  scene.executeWhenReady(() => {
    if (scene.isDisposed) return;
    const probe = new ReflectionProbe('envProbe', size, scene, false, true, true);
    probe.position.copyFrom(at);
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    probe.renderList = [...new Set(meshes)];
    const rtt = probe.cubeTexture;
    scene.customRenderTargets.push(rtt);
    rtt.onAfterUnbindObservable.addOnce(() => {
      scene.onAfterRenderObservable.addOnce(() => {
        const index = scene.customRenderTargets.indexOf(rtt);
        if (index !== -1) scene.customRenderTargets.splice(index, 1);
        const captured = rtt.getInternalTexture();
        if (!captured) return;
        captured.incrementReferences();
        const env = new CubeTexture('', scene);
        env._texture = captured;
        env.gammaSpace = false;
        env.invertZ = rtt.invertZ;
        env.name = 'capturedEnvironment';
        const filter = new HDRFiltering(scene.getEngine(), {
          quality: size >= 256 ? Constants.TEXTURE_FILTERING_QUALITY_HIGH : Constants.TEXTURE_FILTERING_QUALITY_MEDIUM,
        });
        filter.prefilter(env).then(() => {
          if (!scene.isDisposed) scene.environmentTexture = env;
        }).catch((error) => {
          if (scene.isDisposed) return;
          console.warn('Environment prefilter failed, using realtime filtering', error);
          for (const material of lit) material.realTimeFiltering = true;
          scene.environmentTexture = env;
        });
      });
    });
  });
}
