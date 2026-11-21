import { type Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import { type AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { type Scene } from '@babylonjs/core/scene';

/** Name of the per-instance vec4 buffer: rgb = additive tint (HDR), a = strength. */
export const FLASH_BUFFER = 'instanceFlash';

/**
 * PBR material plugin: adds `instanceFlash.rgb * instanceFlash.a` to the final colour of any
 * instanced mesh that registered the FLASH_BUFFER. Meshes without the buffer compile the plain
 * variant, so one shared material can serve flashing and non-flashing meshes.
 */
export class HitFlashPlugin extends MaterialPluginBase {
  private on = false;

  constructor(material: Material) {
    super(material, 'HitFlash', 250, { HITFLASH: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>, _scene: Scene, mesh: AbstractMesh): void {
    this.on = mesh.isVerticesDataPresent(FLASH_BUFFER);
    defines.HITFLASH = this.on;
  }

  override getClassName(): string {
    return 'HitFlashPlugin';
  }

  override getAttributes(attributes: string[]): void {
    if (this.on) attributes.push(FLASH_BUFFER);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef HITFLASH\nattribute vec4 ${FLASH_BUFFER};\nvarying vec4 vHitFlash;\n#endif`,
        CUSTOM_VERTEX_MAIN_END: `#ifdef HITFLASH\nvHitFlash = ${FLASH_BUFFER};\n#endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef HITFLASH\nvarying vec4 vHitFlash;\n#endif`,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef HITFLASH\nfinalColor.rgb += vHitFlash.rgb * vHitFlash.a;\n#endif`,
    };
  }
}

/** Attach the plugin once per material. */
export function enableHitFlash(mat: Material): void {
  if (!mat.pluginManager?.getPlugin('HitFlash')) new HitFlashPlugin(mat);
}

/** Register the per-instance flash buffer on a kit template (default: no flash). */
export function registerFlashBuffer(t: Mesh): void {
  t.registerInstancedBuffer(FLASH_BUFFER, 4);
  t.instancedBuffers[FLASH_BUFFER] = new Vector4(0, 0, 0, 0);
}

/** Give one instance its own flash vector (instances otherwise share the template's by reference). */
export function initFlash(instance: AbstractMesh): Vector4 {
  const v = new Vector4(0, 0, 0, 0);
  instance.instancedBuffers[FLASH_BUFFER] = v;
  return v;
}
