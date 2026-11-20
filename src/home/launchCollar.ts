import { Color3, PBRMaterial, type Scene, type TransformNode, VertexBuffer } from '@babylonjs/core';
import { segmentedRing } from '../visuals/rings';
import { canvas, toTexture } from '../visuals/textures';

/** Copper windings and backlit index marks on the eight static launch-ring shoes. */
export function buildLaunchCollar(scene: Scene, frame: TransformNode): void {
  const size = 512;
  const enamel = canvas(size);
  const lamps = canvas(size);
  enamel.ctx.fillStyle = '#343f40';
  enamel.ctx.fillRect(0, 0, size, size);
  for (const ctx of [enamel.ctx, lamps.ctx]) ctx.translate(size / 2, size / 2);
  const arc = (radius: number, from: number, to: number, width: number, color: string) => {
    enamel.ctx.beginPath();
    enamel.ctx.arc(0, 0, radius, from, to);
    enamel.ctx.strokeStyle = color;
    enamel.ctx.lineWidth = width;
    enamel.ctx.stroke();
  };
  for (let sector = 0; sector < 8; sector++) {
    const a = sector * Math.PI / 4;
    // Three insulated half-windings per shoe with small gaps at the feed connections.
    for (let winding = 0; winding < 3; winding++) {
      const start = a + 0.04 + winding * 0.24;
      for (let track = 0; track < 4; track++) {
        arc(216 + track * 3, start, start + 0.2, 1.6, track % 2 ? '#c99057' : '#966548');
      }
    }
    for (let tick = 0; tick < 8; tick++) {
      const angle = a + (tick + 0.5) * Math.PI / 32;
      enamel.ctx.save();
      enamel.ctx.rotate(angle);
      enamel.ctx.fillStyle = tick % 4 === 0 ? '#d9ddc6' : '#879b94';
      enamel.ctx.fillRect(231, -1, tick % 4 === 0 ? 8 : 4, 2);
      enamel.ctx.restore();
    }
    lamps.ctx.save();
    lamps.ctx.rotate(a + 0.1);
    lamps.ctx.fillStyle = '#b3ffe4';
    lamps.ctx.fillRect(232, -2, 6, 4);
    lamps.ctx.restore();
  }
  const mat = new PBRMaterial('launchWindingEnamel', scene);
  mat.albedoTexture = toTexture('launchWindings', enamel.c, scene);
  mat.emissiveTexture = toTexture('launchIndexLamps', lamps.c, scene);
  mat.emissiveColor = new Color3(0.55, 1.8, 1.5);
  mat.metallic = 0.52;
  mat.roughness = 0.39;
  mat.usePhysicalLightFalloff = false;

  const ring = segmentedRing(scene, 'launchWindingCollar', 3.55, 0.47, 8, 0.97);
  const uvs = ring.getVerticesData(VertexBuffer.UVKind)!;
  for (let i = 0; i < uvs.length; i++) uvs[i] = 0.5 + uvs[i] / 8;
  ring.setVerticesData(VertexBuffer.UVKind, uvs);
  ring.parent = frame;
  ring.position.set(0, 4.2, -0.43);
  ring.rotation.x = -Math.PI / 2;
  ring.material = mat;
}
