import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { type Scene } from '@babylonjs/core/scene';
import { canvas, rng, toTexture } from './textures';
import type { Box, GateId } from '@riftwarden/rules/world/layout';

const cell = 256;
const size = cell * 4;
const gateCells: Record<GateId, number> = { north: 4, east: 5, west: 6, south: 7 };

export class ArenaDecals {
  private material: PBRMaterial;
  private pieces: Mesh[] = [];

  constructor(private scene: Scene, sector = 'SECTOR 07') {
    const { c, ctx } = canvas(size);
    const random = rng(201);
    for (let i = 0; i < 14; i++) {
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
      } else if (i < 8) {
        const direction = ['NORTH', 'EAST', 'WEST', 'SOUTH'][i - 4];
        ctx.fillStyle = '#e3e5ce';
        ctx.fillRect(12, 20, 232, 216);
        ctx.fillStyle = '#b96546';
        ctx.fillRect(12, 20, 22, 216);
        ctx.fillStyle = '#202b26';
        ctx.textAlign = 'left';
        ctx.font = 'bold 82px Arial, sans-serif';
        ctx.fillText(direction, 46, 147, 185);
        ctx.font = 'bold 27px Arial, sans-serif';
        ctx.fillText('RIFT GATE', 48, 199);
      } else if (i < 12) {
        const label = ['REACTOR', sector, 'KEEP CLEAR', 'SERVICE'][i - 8];
        ctx.fillStyle = i === 10 ? '#d5a054' : '#b4c4c9';
        ctx.textAlign = 'center';
        ctx.font = '900 31px sans-serif';
        ctx.fillText(label, 128, 144, 220);
        ctx.fillRect(35, 155, 186, 4);
        for (const x of [24, 194]) {
          ctx.fillRect(x, 101, 38, 4);
          ctx.fillRect(x < 100 ? x : x + 34, 105, 4, 14);
        }
      } else if (i === 12) {
        // Split socket and centre pin. A single silhouette reads from across the plaza.
        ctx.strokeStyle = '#b5ffe1';
        ctx.lineWidth = 17;
        for (let j = 0; j < 3; j++) {
          const angle = j * Math.PI * 2 / 3;
          ctx.beginPath();
          ctx.arc(128, 128, 81, angle + 0.12, angle + 1.87);
          ctx.stroke();
        }
        ctx.fillStyle = '#e3fff0';
        ctx.fillRect(109, 109, 38, 38);
      } else {
        ctx.fillStyle = '#9be8ce';
        for (const start of [19, 94, 169]) {
          ctx.beginPath();
          ctx.moveTo(start, 184);
          ctx.lineTo(start + 39, 72);
          ctx.lineTo(start + 68, 72);
          ctx.lineTo(start + 29, 184);
          ctx.fill();
        }
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
    const sign = MeshBuilder.CreatePlane('gateStencil', { width: 3.25, height: 1.04 }, this.scene);
    sign.position.copyFrom(position);
    sign.rotation.y = yaw;
    this.add(sign, gateCells[id]);
  }

  private stamp(index: number, x: number, y: number, z: number, yaw: number, w: number, h: number): void {
    const mesh = MeshBuilder.CreatePlane('transferStencil', { width: w, height: h }, this.scene);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.add(mesh, index);
  }

  /** The same socket marking on all four faces of a standing or hanging tether point. */
  socket(x: number, y: number, z: number, halfX: number, halfZ: number, size: number): void {
    this.stamp(12, x, y, z - halfZ, 0, size, size);
    this.stamp(12, x, y, z + halfZ, Math.PI, size, size);
    this.stamp(12, x - halfX, y, z, Math.PI / 2, size, size);
    this.stamp(12, x + halfX, y, z, -Math.PI / 2, size, size);
  }

  transfer(b: Box): void {
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    if (b.kind === 'relay') {
      this.socket((x0 + x1) / 2, y1 - 1.52, (z0 + z1) / 2, (x1 - x0) / 2 + 0.055, (z1 - z0) / 2 + 0.055, 2);
    } else {
      for (let t = z0 + 2.5; t < z1 - 1.9; t += 5) {
        this.stamp(13, x0 - 0.02, (y0 + y1) / 2, t, Math.PI / 2, 4.1, 2.6);
        this.stamp(13, x1 + 0.02, (y0 + y1) / 2, t, -Math.PI / 2, 4.1, 2.6);
      }
    }
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
