import { Color3, DynamicTexture, type Scene, StandardMaterial, Texture } from '@babylonjs/core';

export interface Palette {
  white: StandardMaterial;
  panel: StandardMaterial;
  graphite: StandardMaterial;
  metal: StandardMaterial;
  floor: StandardMaterial;
  cyanGlow: StandardMaterial;
  cyanDim: StandardMaterial;
  orangeGlow: StandardMaterial;
  orangeDim: StandardMaterial;
  redGlow: StandardMaterial;
  whiteGlow: StandardMaterial;
  enemyArmor: StandardMaterial;
  enemyDark: StandardMaterial;
  shield: StandardMaterial;
  ghostOk: StandardMaterial;
  ghostBad: StandardMaterial;
  rift: StandardMaterial;
}

function solid(scene: Scene, name: string, d: [number, number, number], spec = 0.25, power = 64): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(...d);
  m.specularColor = new Color3(spec, spec, spec);
  m.specularPower = power;
  m.maxSimultaneousLights = 6;
  return m;
}

/** Emissive "light" material. Values > 1 feed the HDR bloom. */
function glow(scene: Scene, name: string, e: [number, number, number]): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = new Color3(...e);
  m.disableLighting = true;
  return m;
}

function floorTexture(scene: Scene): DynamicTexture {
  const size = 512;
  const tex = new DynamicTexture('floorTex', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const n = 2; // panels per tile edge
  const p = size / n;
  ctx.fillStyle = '#b9bec4';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const shade = 178 + ((i + j) % 2) * 9;
      ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 9})`;
      ctx.fillRect(i * p + 3, j * p + 3, p - 6, p - 6);
      // inner inset line
      ctx.strokeStyle = 'rgba(80,88,96,0.22)';
      ctx.lineWidth = 2;
      ctx.strokeRect(i * p + 22, j * p + 22, p - 44, p - 44);
      // corner fasteners
      ctx.fillStyle = 'rgba(60,66,74,0.5)';
      for (const [cx, cy] of [[12, 12], [p - 12, 12], [12, p - 12], [p - 12, p - 12]]) {
        ctx.beginPath();
        ctx.arc(i * p + cx, j * p + cy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = '#4a5058';
  ctx.lineWidth = 6;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * p, 0);
    ctx.lineTo(i * p, size);
    ctx.moveTo(0, i * p);
    ctx.lineTo(size, i * p);
    ctx.stroke();
  }
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

export function createPalette(scene: Scene): Palette {
  const floor = solid(scene, 'floor', [0.78, 0.8, 0.83], 0.18, 32);
  const ft = floorTexture(scene);
  ft.uScale = ft.vScale = 120 / 8; // 8 m tiles across a 120 m ground
  floor.diffuseTexture = ft;

  const shield = new StandardMaterial('shield', scene);
  shield.diffuseColor = Color3.Black();
  shield.specularColor = Color3.Black();
  shield.emissiveColor = new Color3(1.5, 0.35, 0.04);
  shield.alpha = 0.22;
  shield.disableLighting = true;
  shield.backFaceCulling = false;

  const ghost = (name: string, c: [number, number, number]) => {
    const m = glow(scene, name, c);
    m.alpha = 0.38;
    m.backFaceCulling = false;
    return m;
  };

  const rift = glow(scene, 'rift', [1.7, 0.2, 0.03]);
  rift.alpha = 0.85;
  rift.backFaceCulling = false;

  return {
    white: solid(scene, 'white', [0.88, 0.9, 0.92], 0.35, 96),
    panel: solid(scene, 'panel', [0.7, 0.73, 0.76], 0.2, 48),
    graphite: solid(scene, 'graphite', [0.11, 0.12, 0.14], 0.35, 64),
    metal: solid(scene, 'metal', [0.38, 0.4, 0.44], 0.7, 128),
    floor,
    cyanGlow: glow(scene, 'cyanGlow', [0.25, 1.9, 2.2]),
    cyanDim: glow(scene, 'cyanDim', [0.04, 0.42, 0.5]),
    orangeGlow: glow(scene, 'orangeGlow', [2.7, 0.42, 0.03]),
    orangeDim: glow(scene, 'orangeDim', [0.62, 0.11, 0.01]),
    redGlow: glow(scene, 'redGlow', [2.6, 0.28, 0.12]),
    whiteGlow: glow(scene, 'whiteGlow', [2.4, 2.6, 2.9]),
    enemyArmor: solid(scene, 'enemyArmor', [0.5, 0.48, 0.47], 0.45, 80),
    enemyDark: solid(scene, 'enemyDark', [0.08, 0.075, 0.075], 0.4, 64),
    shield,
    ghostOk: ghost('ghostOk', [0.2, 1.4, 1.6]),
    ghostBad: ghost('ghostBad', [1.8, 0.2, 0.12]),
    rift,
  };
}
