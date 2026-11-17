import { type AbstractMesh, BaseTexture, Constants, HDRFiltering, ReflectionProbe, RenderTargetTexture, type Scene, type Vector3 } from '@babylonjs/core';

/**
 * Render the finished static scene once into a reflection probe, wrap the cube in a
 * plain BaseTexture, prefilter it and use it as the scene's IBL environment.
 * Never reference the probe's RTT from a material (it would re-render while sampled).
 * The probe and filter are disposed with the scene.
 */
export function captureEnvironment(scene: Scene, meshes: AbstractMesh[], lit: { realTimeFiltering: boolean }[], at: Vector3, size = 256): void {
  scene.executeWhenReady(() => {
    if (scene.isDisposed) return;
    const probe = new ReflectionProbe('envProbe', size, scene, false, true, true);
    probe.position.copyFrom(at);
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    const list = probe.renderList!;
    for (const m of meshes) if (!list.includes(m)) list.push(m);
    const rtt = probe.cubeTexture;
    // Probes only render when referenced; force a single capture as a custom target.
    scene.customRenderTargets.push(rtt);
    let faces = 0;
    const obs = rtt.onAfterRenderObservable.add(() => {
      if (++faces < 6) return;
      rtt.onAfterRenderObservable.remove(obs);
      scene.onAfterRenderObservable.addOnce(() => {
        const i = scene.customRenderTargets.indexOf(rtt);
        if (i >= 0) scene.customRenderTargets.splice(i, 1);
        const env = new BaseTexture(scene, rtt.getInternalTexture());
        env.gammaSpace = false;
        env.name = 'capturedEnvironment';
        const filter = new HDRFiltering(scene.getEngine(), { quality: Constants.TEXTURE_FILTERING_QUALITY_HIGH, hdrScale: 1 });
        filter
          .prefilter(env)
          .then(() => {
            if (!scene.isDisposed) scene.environmentTexture = env;
          })
          .catch((e) => {
            console.warn('Environment prefilter failed, using realtime filtering', e);
            for (const m of lit) m.realTimeFiltering = true;
            if (!scene.isDisposed) scene.environmentTexture = env;
          });
      });
    });
  });
}
