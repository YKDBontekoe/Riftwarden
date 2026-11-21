import { type AssetContainer, LoadAssetContainerAsync, PBRMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

const sources = {
  fern: new URL('../assets/nest-fern.glb', import.meta.url).href,
  rock: new URL('../assets/granite-outcrop.glb', import.meta.url).href,
};
const libraries = new WeakMap<object, Map<string, Promise<AssetContainer>>>();

/** Share scanned geometry and textures between placements, including player-built planters. */
export function placeScan(parent: TransformNode, species: keyof typeof sources, position: [number, number, number], yaw: number, scale: [number, number, number]): void {
  const scene = parent.getScene();
  let library = libraries.get(scene);
  if (!library) libraries.set(scene, library = new Map());
  let source = library.get(species);
  if (!source) {
    source = LoadAssetContainerAsync(sources[species], scene, { pluginExtension: '.glb' }).then(container => {
      for (const m of container.materials) if (m instanceof PBRMaterial) {
        m.usePhysicalLightFalloff = false;
        m.maxSimultaneousLights = 8;
        if (species === 'fern') { m.backFaceCulling = false; m.twoSidedLighting = true; }
        // Quarry rocks are 100+ m silhouettes: dark, cool basalt so the dusk sun rims them instead of
        // turning them into orange mud, and the fog can carry them into the panorama.
        if (species === 'rock') { m.albedoColor.set(0.38, 0.39, 0.43); m.environmentIntensity = 0.55; }
      }
      return container;
    });
    library.set(species, source);
  }
  void source.then(container => {
    if (scene.isDisposed || parent.isDisposed()) return;
    const instance = container.instantiateModelsToScene(name => species + ':' + name, false, { doNotInstantiate: false });
    for (const node of instance.rootNodes) {
      if (!(node instanceof TransformNode)) continue;
      node.parent = parent;
      node.position.copyFromFloats(...position);
      // The glTF root carries the handedness conversion. Compose the placement with it.
      node.rotate(Vector3.Up(), yaw);
      node.scaling.multiplyInPlace(new Vector3(...scale));
      for (const part of node.getChildMeshes()) {
        part.isPickable = false;
        part.receiveShadows = true;
      }
    }
  }).catch(error => { if (!scene.isDisposed) console.warn('Scenery asset unavailable', species, error); });
}
