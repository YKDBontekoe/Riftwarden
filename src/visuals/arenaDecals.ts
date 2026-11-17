import { Mesh, MeshBuilder, PBRMaterial, type Scene, Texture, Vector3, VertexBuffer } from '@babylonjs/core';
import { canvas, rng, toTexture } from './textures';
import type { GateId } from '../world/layout';

const cell = 256;
const size = cell * 4;
const gateCells: Record<GateId, number> = { north: 4, east: 5, west: 6 };

export class ArenaDecals {
  private material: PBRMaterial;
  private pieces: Mesh[] = [];

  constructor(private scene: Scene) {
    const { c, ctx } = canvas(size);
    const random = rng(201);
    for (let i = 0; i < 7; i++) {
      ctx.save();
      ctx.translate((i % 4) * cell, Math.floor(i / 4) * cell);
      ctx.beginPath();
      ctx.rect(8, 8, 240, 240);
      ctx.clip();
      if (i < 3) {
        for (let n = 0; n < 42; n++) {
          const x = 36 + random() * 184;
          const y = 58 + random() * 140;
          const radius = 12 + random() * 33;
          const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
          g.addColorStop(0, i === 2 ? 'rgba(123,92,55,0.30)' : 'rgba(18,19,20,0.43)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      } else if (i === 3) {
        ctx.fillStyle = 'rgba(232,164,66,0.70)';
        for (let j = -2; j < 8; j++) {
          const x = j * 45;
          ctx.beginPath();
          ctx.moveTo(x, 94);
          ctx.lineTo(x + 20, 94);
          ctx.lineTo(x + 67, 161);
          ctx.lineTo(x + 47, 161);
          ctx.fill();
        }
      } else {
        const direction = ['NORTH', 'EAST', 'WEST'][i - 4];
        ctx.fillStyle = '#28313b';
        ctx.fillRect(12, 20, 232, 216);
        ctx.strokeStyle = '#94754a';
        ctx.lineWidth = 3;
        ctx.strokeRect(16, 26, 224, 204);
        ctx.fillStyle = '#dc9d54';
        ctx.fillRect(24, 42, 208, 8);
        ctx.fillStyle = '#f4d8a8';
        ctx.textAlign = 'center';
        ctx.font = 'bold 58px monospace';
        ctx.fillText(direction, 128, 135);
        ctx.font = 'bold 31px monospace';
        ctx.fillText('RIFT GATE', 128, 189);
      }
      ctx.globalCompositeOperation = 'destination-out';
      for (let n = 0; n < (i < 3 ? 100 : 235); n++) {
        ctx.fillStyle = `rgba(0,0,0,${0.18 + random() * 0.55})`;
        ctx.fillRect(8 + random() * 240, 8 + random() * 240, 0.8 + random() * 5.2, 1 + random() * 2.2);
      }
      ctx.restore();
    }

    const atlas = toTexture('arenaDecalAtlas', c, scene);
    atlas.hasAlpha = true;
    atlas.wrapU = atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
    const mat = new PBRMaterial('arenaDecals', scene);
    mat.albedoTexture = atlas;
    mat.useAlphaFromAlbedoTexture = true;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    mat.disableDepthWrite = true;
    mat.zOffset = -1;
    mat.metallic = 0;
    mat.roughness = 0.84;
    mat.maxSimultaneousLights = 8;
    mat.usePhysicalLightFalloff = false;
    this.material = mat;
  }

  floor(kind: number, x: number, z: number, width: number, length: number, yaw: number): void {
    const floor = MeshBuilder.CreateGround('deckWear', { width, height: length }, this.scene);
    floor.position.set(x, 0.016, z);
    floor.rotation.y = yaw;
    this.add(floor, kind);
  }

  gate(id: GateId, position: Vector3, yaw: number): void {
    const sign = MeshBuilder.CreatePlane('gateStencil', { width: 3.0, height: 0.92 }, this.scene);
    sign.position.copyFrom(position);
    sign.rotation.y = yaw;
    this.add(sign, gateCells[id]);
  }

  private add(mesh: Mesh, index: number): void {
    const uv = mesh.getVerticesData(VertexBuffer.UVKind)!;
    const x = (index % 4) * cell;
    const y = Math.floor(index / 4) * cell;
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = (x + 8 + uv[i] * (cell - 16)) / size;
      uv[i + 1] = (y + 8 + (1 - uv[i + 1]) * (cell - 16)) / size;
    }
    mesh.setVerticesData(VertexBuffer.UVKind, uv, false);
    this.pieces.push(mesh);
  }

  finish(): void {
    const merged = Mesh.MergeMeshes(this.pieces, true, true);
    if (!merged) return;
    merged.name = 'arenaSurfaceDecals';
    merged.material = this.material;
    merged.receiveShadows = true;
    merged.isPickable = false;
    merged.alphaIndex = 1;
    merged.freezeWorldMatrix();
    this.pieces.length = 0;
  }
}
