import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { GetEnvironmentBRDFTexture } from '@babylonjs/core/Misc/brdfTextureTools';
import { Scene } from '@babylonjs/core/scene';

/**
 * Babylon decodes its BRDF lookup asynchronously and later calls texture.getScene().
 * Keep that small, shared lookup in an engine-owned virtual scene: disposing an HQ
 * or arena during decode must not dispose the lookup's scene underneath the callback.
 * Virtual scenes are disposed by the engine and never enter its rendered scene list.
 */
export function configureBrdfLifetime(engine: AbstractEngine): void {
  const owner = new Scene(engine, { virtual: true });
  owner.detachControl();
  const lookup = GetEnvironmentBRDFTexture(owner);
  engine.onNewSceneAddedObservable.add((scene) => {
    scene.environmentBRDFTexture = lookup;
  });
}
