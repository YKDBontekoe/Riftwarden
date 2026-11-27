import { Material } from '@babylonjs/core/Materials/material';

/**
 * Cheap material creation in crowded scenes. Babylon marks a material's users dirty on every property change by
 * scanning every mesh in the scene for submeshes that use it (`Material._markAllSubMeshesAsDirty`), and a new
 * PBRMaterial does this a dozen times while it is constructed and configured. With 15-25k meshes in a late fight a
 * dropped weapon (six new materials) stalled a frame for ~0.5 s. A material that is still being built cannot be
 * assigned to any mesh yet, so the scan can only find nothing: inside `freshMaterial` it is skipped.
 *
 * Contract: the callback only constructs and configures new materials (never touches a material a mesh already
 * uses) and returns before any of them is assigned. Nested scopes are fine.
 */
let depth = 0;
let installed = false;

type MarkFn = (this: Material, func: (defines: unknown) => void) => void;

function install(): void {
  if (installed) return;
  installed = true;
  const proto = Material.prototype as unknown as { _markAllSubMeshesAsDirty?: MarkFn };
  const original = proto._markAllSubMeshesAsDirty;
  // Engine internals moved: fall back to the normal (slower) path rather than break.
  if (typeof original !== 'function') return;
  proto._markAllSubMeshesAsDirty = function (this: Material, func) {
    if (depth > 0) return;
    original.call(this, func);
  };
}

export function freshMaterial<T>(build: () => T): T {
  install();
  depth++;
  try {
    return build();
  } finally {
    depth--;
  }
}

/** Number of open scopes (tests). */
export function freshMaterialDepth(): number {
  return depth;
}
