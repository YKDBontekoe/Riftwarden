import { DynamicTexture, type Scene, Texture } from '@babylonjs/core';

/**
 * Procedural texture generation. Everything is drawn at startup into canvases so the
 * game ships no image assets: tileable value-noise/fbm, height -> normal map conversion,
 * PBR texture sets (albedo / normal / ORM) and particle sprites.
 */

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (i: number, p: number) => ((i % p) + p) % p;

/** Tileable value noise in [0,1]. `period` is in lattice cells. */
export function vnoise(x: number, y: number, period: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const ax = wrap(x0, period);
  const ay = wrap(y0, period);
  const bx = wrap(x0 + 1, period);
  const by = wrap(y0 + 1, period);
  const a = hash(ax, ay, seed);
  const b = hash(bx, ay, seed);
  const c = hash(ax, by, seed);
  const d = hash(bx, by, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fractal noise in ~[0,1]. u,v in [0,1). */
export function fbm(u: number, v: number, basePeriod: number, octaves: number, seed = 0, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u * p, v * p, p, seed + o * 17) * amp;
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w: number, h = w): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d', { willReadFrequently: true })! };
}

/** Converts a height field (0..1) into a tangent-space normal map canvas. Wraps at the edges. */
export function heightToNormal(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const yu = (y - 1 + size) % size;
    const yd = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
      const dy = (height[yd * size + x] - height[yu * size + x]) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Read a canvas back as a height field (luminance 0..1). */
export function canvasHeight(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const d = ctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}

export function toTexture(name: string, c: HTMLCanvasElement, scene: Scene, opts: { srgb?: boolean; aniso?: number } = {}): DynamicTexture {
  const tex = new DynamicTexture(name, c, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.update(false);
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = opts.aniso ?? 8;
  tex.gammaSpace = opts.srgb ?? true;
  return tex;
}

export interface PbrSet {
  albedo: DynamicTexture;
  normal: DynamicTexture;
  orm: DynamicTexture;
}

/** Writes one pixel of an ORM image: R = AO, G = roughness, B = metal mask. */
function ormPixel(d: Uint8ClampedArray, i: number, ao: number, rough: number, metal: number): void {
  d[i] = ao * 255;
  d[i + 1] = Math.max(0.02, Math.min(1, rough)) * 255;
  d[i + 2] = metal * 255;
  d[i + 3] = 255;
}

/**
 * Industrial floor: 2x2 heavy deck plates per texture tile, seams, bolts, scuffs and
 * oily stains. Albedo/normal cover one 8 m tile.
 */
export function floorSet(scene: Scene): PbrSet {
  const S = 1024;
  const n = 2;
  const P = S / n;
  const { c: ac, ctx: a } = canvas(S);
  const height = new Float32Array(S * S);
  const img = a.createImageData(S, S);
  const d = img.data;
  const r = rng(7);
  const tint: number[] = [];
  for (let i = 0; i < n * n; i++) tint.push(0.85 + r() * 0.3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const px = x % P;
      const py = y % P;
      const edge = Math.min(px, py, P - 1 - px, P - 1 - py);
      const panel = Math.floor(y / P) * n + Math.floor(x / P);
      const grain = fbm(u, v, 32, 4, 3);
      const blotch = fbm(u, v, 4, 3, 11);
      let h = 0.6 + (grain - 0.5) * 0.06;
      let alb = (0.2 + (grain - 0.5) * 0.06 + (blotch - 0.5) * 0.08) * tint[panel];
      // seams: recessed groove with a bevel
      if (edge < 4) {
        h = 0.05 + edge * 0.08;
        alb *= 0.35;
      } else if (edge < 10) {
        h = 0.6 - (10 - edge) * 0.015;
        alb *= 1.15; // worn bevel edge catches light
      }
      // inner inset frame line
      const inner = Math.abs(edge - 46);
      if (inner < 2) {
        h -= 0.12;
        alb *= 0.6;
      }
      height[y * S + x] = h;
      const i = (y * S + x) * 4;
      const g = Math.min(1, alb);
      d[i] = g * 255 * 0.96;
      d[i + 1] = g * 255;
      d[i + 2] = g * 255 * 1.06;
      d[i + 3] = 255;
    }
  }
  a.putImageData(img, 0, 0);
  // bolts
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (const [cx, cy] of [[22, 22], [P - 22, 22], [22, P - 22], [P - 22, P - 22]]) {
        const bx = i * P + cx;
        const by = j * P + cy;
        a.fillStyle = '#3b4046';
        a.beginPath();
        a.arc(bx, by, 7, 0, Math.PI * 2);
        a.fill();
        a.fillStyle = '#20242a';
        a.fillRect(bx - 4, by - 1, 8, 2);
        for (let yy = -8; yy <= 8; yy++)
          for (let xx = -8; xx <= 8; xx++) {
            const rr = Math.hypot(xx, yy);
            if (rr < 8) height[((by + yy + S) % S) * S + ((bx + xx + S) % S)] = 0.75 + (8 - rr) * 0.02;
          }
      }
  // scuffs and tire-like streaks
  a.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 220; i++) {
    const x = r() * S;
    const y = r() * S;
    const ang = r() * Math.PI;
    const len = 10 + r() * 70;
    a.strokeStyle = `rgba(120,128,138,${0.03 + r() * 0.07})`;
    a.lineWidth = 0.6 + r() * 1.2;
    a.beginPath();
    a.moveTo(x, y);
    a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    a.stroke();
  }
  a.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 14; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 30 + r() * 110;
    const g = a.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(60,58,56,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    a.fillStyle = g;
    a.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  a.globalCompositeOperation = 'source-over';

  // ORM at a different, non-integer scale (set by caller) for large wet patches.
  const O = 512;
  const { c: oc, ctx: o } = canvas(O);
  const oimg = o.createImageData(O, O);
  for (let y = 0; y < O; y++) {
    for (let x = 0; x < O; x++) {
      const u = x / O;
      const v = y / O;
      const wet = fbm(u, v, 3, 5, 21);
      const micro = fbm(u, v, 48, 2, 5);
      const puddle = Math.min(1, Math.max(0, (wet - 0.5) * 6));
      const rough = 0.42 + (micro - 0.5) * 0.25 - puddle * 0.36;
      ormPixel(oimg.data, (y * O + x) * 4, 1, rough, 1);
    }
  }
  o.putImageData(oimg, 0, 0);

  return {
    albedo: toTexture('floorAlb', ac, scene),
    normal: toTexture('floorNrm', heightToNormal(height, S, 6), scene, { srgb: false }),
    orm: toTexture('floorOrm', oc, scene, { srgb: false }),
  };
}

/** Wall cladding: vertical panels with seams, rivet rows, vents and rain/grime streaks. One tile = 4 m. */
export function wallSet(scene: Scene): PbrSet {
  const S = 512;
  const { c: ac, ctx: a } = canvas(S);
  const img = a.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const O = S;
  const { c: oc, ctx: o } = canvas(O);
  const oimg = o.createImageData(O, O);
  const cols = 2;
  const rows = 2;
  const PW = S / cols;
  const PH = S / rows;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const px = x % PW;
      const py = y % PH;
      const edge = Math.min(px, py, PW - 1 - px, PH - 1 - py);
      const streak = fbm(u * 1, v * 0.08, 24, 3, 9); // vertical streaks
      const grime = fbm(u, v, 8, 4, 2);
      let h = 0.6;
      let alb = 0.2 + (grime - 0.5) * 0.06 - Math.max(0, streak - 0.5) * 0.18;
      let rough = 0.48 + (grime - 0.5) * 0.3 + Math.max(0, streak - 0.55) * 0.5;
      if (edge < 3) {
        h = 0.1;
        alb *= 0.3;
        rough = 0.8;
      } else if (edge < 7) {
        h = 0.62;
        alb *= 1.25;
        rough -= 0.12;
      }
      // horizontal stiffener ribs
      const rib = Math.abs(py - PH * 0.5);
      if (rib < 6) {
        h = 0.75 - rib * 0.02;
        alb *= 0.85;
      }
      // vent slots on lower panels
      if (Math.floor(y / PH) === 1 && px > PW * 0.2 && px < PW * 0.8 && py > PH * 0.62 && py < PH * 0.86 && py % 12 < 5) {
        h = 0.15;
        alb *= 0.25;
        rough = 0.9;
      }
      height[y * S + x] = h;
      const i = (y * S + x) * 4;
      d[i] = alb * 255 * 0.92;
      d[i + 1] = alb * 255 * 0.98;
      d[i + 2] = alb * 255 * 1.08;
      d[i + 3] = 255;
      ormPixel(oimg.data, i, edge < 3 ? 0.5 : 1, rough, 1);
    }
  }
  a.putImageData(img, 0, 0);
  o.putImageData(oimg, 0, 0);
  // rivets
  a.fillStyle = 'rgba(30,34,40,0.9)';
  for (let cx = 0; cx < cols; cx++)
    for (let cy = 0; cy < rows; cy++)
      for (let k = 0; k < 8; k++) {
        for (const side of [10, PW - 10]) {
          const x = cx * PW + side;
          const y = cy * PH + 14 + k * ((PH - 28) / 7);
          a.beginPath();
          a.arc(x, y, 2.4, 0, Math.PI * 2);
          a.fill();
          for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) if (xx * xx + yy * yy < 9) height[(Math.round(y) + yy) * S + x + xx] = 0.8;
        }
      }
  return {
    albedo: toTexture('wallAlb', ac, scene),
    normal: toTexture('wallNrm', heightToNormal(height, S, 5), scene, { srgb: false }),
    orm: toTexture('wallOrm', oc, scene, { srgb: false }),
  };
}

/** Generic wear for small props and machines: grime albedo multiplier + roughness noise + scratches. */
export function wearSet(scene: Scene): PbrSet {
  const S = 256;
  const { c: ac, ctx: a } = canvas(S);
  const img = a.createImageData(S, S);
  const { c: oc, ctx: o } = canvas(S);
  const oimg = o.createImageData(S, S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const g = fbm(u, v, 6, 5, 31);
      const speck = vnoise(u * 96, v * 96, 96, 4);
      const alb = 0.86 + (g - 0.5) * 0.25 - (speck > 0.86 ? 0.25 : 0);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(1, alb) * 255;
      img.data[i + 3] = 255;
      ormPixel(oimg.data, i, 1, 0.75 + (g - 0.5) * 0.6 + (speck > 0.86 ? 0.2 : 0), 1);
      height[y * S + x] = g * 0.5 + (speck > 0.86 ? -0.1 : 0);
    }
  }
  a.putImageData(img, 0, 0);
  o.putImageData(oimg, 0, 0);
  const r = rng(99);
  o.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 90; i++) {
    const x = r() * S;
    const y = r() * S;
    const ang = r() * Math.PI;
    const len = 4 + r() * 30;
    o.strokeStyle = `rgba(255,${60 + r() * 60},255,0.7)`; // scratches are smoother
    o.lineWidth = 0.7;
    o.beginPath();
    o.moveTo(x, y);
    o.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    o.stroke();
  }
  return {
    albedo: toTexture('wearAlb', ac, scene, { aniso: 4 }),
    normal: toTexture('wearNrm', heightToNormal(height, S, 2), scene, { srgb: false, aniso: 4 }),
    orm: toTexture('wearOrm', oc, scene, { srgb: false, aniso: 4 }),
  };
}

/** Emissive skyline facade: dark with scattered lit windows. RGB only, used as emissive. */
export function windowsTexture(scene: Scene): DynamicTexture {
  const W = 256;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const r = rng(1234);
  for (let y = 4; y < H; y += 10) {
    for (let x = 3; x < W; x += 8) {
      const p = r();
      if (p < 0.12) {
        const warm = r() < 0.7;
        const k = 0.35 + r() * 0.65;
        ctx.fillStyle = warm ? `rgba(255,${150 + r() * 60},${70 + r() * 40},${k})` : `rgba(120,${200 + r() * 55},255,${k})`;
        ctx.fillRect(x, y, 5, 6);
      }
    }
  }
  // occasional horizontal light bands
  for (let i = 0; i < 6; i++) {
    const y = Math.floor(r() * H);
    ctx.fillStyle = `rgba(60,200,230,${0.3 + r() * 0.4})`;
    ctx.fillRect(0, y, W, 2);
  }
  return toTexture('windows', c, scene, { aniso: 4 });
}

// ---------------------------------------------------------------- particle sprites

function spriteTex(name: string, c: HTMLCanvasElement, scene: Scene): DynamicTexture {
  const t = new DynamicTexture(name, c, scene, true);
  t.update(false);
  t.hasAlpha = true;
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

/** Soft round flare. */
export function flareSprite(scene: Scene): DynamicTexture {
  const S = 64;
  const { c, ctx } = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return spriteTex('flareSprite', c, scene);
}

/** Billowy smoke puff (white, alpha from noise density, lit from above). */
export function smokeSprite(scene: Scene): DynamicTexture {
  const C = 128;
  const { c, ctx } = canvas(C);
  const img = ctx.createImageData(C, C);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const dx = (x - C / 2) / (C / 2);
      const dy = (y - C / 2) / (C / 2);
      const rr = Math.hypot(dx, dy);
      const n = fbm(x / C, y / C, 4, 5, 40);
      const n2 = fbm(x / C, y / C, 9, 3, 80);
      const fall = Math.max(0, 1 - rr * (1.05 + (n - 0.5) * 0.9));
      const dens = Math.max(0, Math.min(1, fall * 1.6 * (0.55 + n * 0.9)));
      const shade = 0.75 + (n2 - 0.5) * 0.5 + (1 - rr) * 0.15 - dy * 0.12;
      const i = (y * C + x) * 4;
      const v = Math.max(0, Math.min(1, shade)) * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = dens * dens * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return spriteTex('smokeSprite', c, scene);
}

/** Long thin spark streak for stretched billboards (oriented along +Y of the texture). */
export function sparkSprite(scene: Scene): DynamicTexture {
  const W = 16;
  const H = 64;
  const { c, ctx } = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.35, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-in';
  const h = ctx.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, W, H);
  return spriteTex('sparkSprite', c, scene);
}

/** Shockwave ring (soft-edged annulus). */
export function ringSprite(scene: Scene): DynamicTexture {
  const S = 256;
  const { c, ctx } = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.92, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return spriteTex('ringSprite', c, scene);
}

/** Four-point star flash used for muzzle flashes and explosion cores. */
export function starSprite(scene: Scene): DynamicTexture {
  const S = 128;
  const { c, ctx } = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2);
      const dy = (y - S / 2) / (S / 2);
      const rr = Math.hypot(dx, dy);
      const core = Math.max(0, 1 - rr * 2.2);
      const rays = Math.max(0, 1 - Math.abs(dx) * 14) * Math.max(0, 1 - Math.abs(dy)) + Math.max(0, 1 - Math.abs(dy) * 14) * Math.max(0, 1 - Math.abs(dx));
      const glow = Math.max(0, 1 - rr) ** 3 * 0.6;
      const v = Math.min(1, core + rays * 0.9 + glow);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = v * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return spriteTex('starSprite', c, scene);
}

/** Scorch mark decal: dark burnt blotch with a charred rim (alpha). */
export function scorchSprite(scene: Scene): DynamicTexture {
  const S = 256;
  const { c, ctx } = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2);
      const dy = (y - S / 2) / (S / 2);
      const ang = Math.atan2(dy, dx);
      const rr = Math.hypot(dx, dy);
      const n = fbm(x / S, y / S, 6, 4, 61);
      const spikes = 0.75 + 0.25 * Math.sin(ang * 9 + n * 6);
      const a = Math.max(0, Math.min(1, (1 - rr / spikes) * 2.2 * (0.6 + n * 0.6)));
      const i = (y * S + x) * 4;
      const s = 14 + n * 20;
      img.data[i] = s + 6;
      img.data[i + 1] = s + 2;
      img.data[i + 2] = s;
      img.data[i + 3] = a * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  return spriteTex('scorchSprite', c, scene);
}
