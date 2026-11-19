import { DynamicTexture, type Scene, Texture } from '@babylonjs/core';

/**
 * Canvas-generated tileable noise, height-to-normal conversion, PBR texture sets
 * (albedo, normal, ORM) and particle sprites.
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
export function vnoise(x: number, y: number, period: number, seed = 0, periodY = period): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const ax = wrap(x0, period);
  const ay = wrap(y0, periodY);
  const bx = wrap(x0 + 1, period);
  const by = wrap(y0 + 1, periodY);
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

/** Sample the same puddle field used by the yard's roughness map. */
export function arenaDeckWetness(x: number, z: number): number {
  const u = (x + 60) / 120;
  const v = (z + 60) / 120;
  const depression = fbm(u, v, 25, 3, 21);
  const watershed = vnoise(u * 9, v * 9, 9, 83);
  return smooth(Math.max(0, Math.min(1, (depression * 0.78 + watershed * 0.22 - 0.59) * 12)));
}

/** Poured yard slab. The macro map spans the entire yard so puddles don't repeat. */
export function yardDeckSet(scene: Scene, high: boolean): PbrSet {
  const size = high ? 1024 : 512;
  const { c: ac, ctx: a } = canvas(size);
  const { c: oc, ctx: o } = canvas(size);
  const albedo = a.createImageData(size, size);
  const orm = o.createImageData(size, size);
  const height = new Float32Array(size * size);
  // Cracks: jagged random walks drawn once, read back as a mask.
  const { ctx: crackCtx } = canvas(size);
  const cr = rng(2027);
  crackCtx.strokeStyle = 'rgba(255,255,255,1)';
  crackCtx.lineCap = 'round';
  for (let c = 0; c < 26; c++) {
    let x = cr() * size;
    let y = cr() * size;
    let ang = cr() * Math.PI * 2;
    crackCtx.lineWidth = Math.max(0.8, (0.6 + cr() * 1.4) * size / 1024);
    crackCtx.beginPath();
    crackCtx.moveTo(x, y);
    const steps = 6 + Math.floor(cr() * 18);
    for (let k = 0; k < steps; k++) {
      ang += (cr() - 0.5) * 1.1;
      const l = (4 + cr() * 12) * size / 1024;
      x += Math.cos(ang) * l;
      y += Math.sin(ang) * l;
      crackCtx.lineTo(x, y);
    }
    crackCtx.stroke();
  }
  const cracks = crackCtx.getImageData(0, 0, size, size).data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const wet = arenaDeckWetness(u * 120 - 60, v * 120 - 60);
      const grit = fbm(u, v, 43, 3, 53);
      const stain = vnoise(u * 13, v * 13, 13, 71);
      const slab = (u * 9) % 1;
      const seam = Math.min(slab, 1 - slab, Math.abs(((v * 9 + Math.floor(u * 9) * 0.5) % 1) - 0.5));
      const expansionJoint = Math.max(0, 1 - seam * 155);
      const i = (y * size + x) * 4;
      // Stains ~2-4 m across (the deck map spans the whole 120 m yard).
      const oil = smooth(Math.max(0, Math.min(1, (fbm(u, v, 36, 3, 91) - 0.68) * 8))) * 0.8;
      const rustStain = smooth(Math.max(0, Math.min(1, (fbm(u, v, 40, 3, 133) - 0.64) * 6))) * (0.4 + expansionJoint * 0.6);
      const crack = cracks[i + 3] / 255;
      const base = (0.46 + (grit - 0.5) * 0.16 + (stain - 0.5) * 0.12 - wet * 0.115 - expansionJoint * 0.12) * (1 - oil * 0.45) * (1 - crack * 0.6);
      albedo.data[i] = base * 255 * (1 + rustStain * 0.12);
      albedo.data[i + 1] = base * 255 * 0.98 * (1 - rustStain * 0.2);
      albedo.data[i + 2] = base * 255 * 0.945 * (1 - rustStain * 0.42);
      albedo.data[i + 3] = 255;
      height[y * size + x] = 0.5 + (grit - 0.5) * (0.035 - wet * 0.025) - expansionJoint * 0.19 - crack * 0.12;
      ormPixel(orm.data, i, 1 - expansionJoint * 0.24 - crack * 0.3, 0.79 + (grit - 0.5) * 0.11 - wet * 0.66 - oil * 0.42 + crack * 0.1, 0);
    }
  }
  a.putImageData(albedo, 0, 0);
  o.putImageData(orm, 0, 0);
  return {
    albedo: toTexture('yardAlbedo', ac, scene),
    normal: toTexture('yardNormal', heightToNormal(height, size, 2.6), scene, { srgb: false }),
    orm: toTexture('yardOrm', oc, scene, { srgb: false }),
  };
}

/** Steel HQ deck plates with recessed fasteners, grip strips and worn paint. */
export function floorSet(scene: Scene, high: boolean): PbrSet {
  const size = high ? 1024 : 512;
  const name = 'hqDeck';
  const { c: ac, ctx: a } = canvas(size);
  const { c: oc, ctx: o } = canvas(size);
  const albedo = a.createImageData(size, size);
  const orm = o.createImageData(size, size);
  const height = new Float32Array(size * size);
  const random = rng(18);
  const plates = 2;
  const panelTint = Array.from({ length: plates * plates }, () => (random() - 0.5) * 0.09);

  // Scratch marks contribute to all three maps, including the exposed metal beneath the paint.
  const { ctx: scratches } = canvas(size);
  for (let i = 0; i < 80; i++) {
    const x = random() * size;
    const y = random() * size;
    const length = (0.002 + random() ** 3 * 0.026) * size;
    const angle = (random() - 0.5) * 2.5;
    scratches.strokeStyle = `rgba(255,255,255,${0.2 + random() * 0.7})`;
    scratches.lineWidth = Math.max(0.65, (0.5 + random() * 1.6) * size / 1024);
    scratches.beginPath();
    scratches.moveTo(x, y);
    scratches.lineTo(x + Math.sin(angle) * length, y + Math.cos(angle) * length);
    scratches.stroke();
  }
  const scuffs = scratches.getImageData(0, 0, size, size).data;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const py = (v * plates) % 1;
    const dy = Math.min(py, 1 - py);
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const px = (u * plates) % 1;
      const dx = Math.min(px, 1 - px);
      const edge = Math.min(dx, dy);
      const panel = Math.floor(v * plates) * plates + Math.floor(u * plates);
      const grain = vnoise(u * 256, v * 256, 256, 3) - 0.5;
      const grime = fbm(u, v, 12, 2, 11);
      const stain = fbm(u, v, 5, 3, 21);
      const i = (y * size + x) * 4;
      const nick = scuffs[i + 3] / 255;
      const dirt = 0.045 * grime * Math.max(0, 1 - edge * 7);
      let base = 0.58 + panelTint[panel] + grain * 0.037 + (stain - 0.5) * 0.16 + nick * 0.14 - dirt;
      let metal = 0.13 + nick * 0.5;
      let rough = 0.57 + (grime - 0.5) * 0.18 + grain * 0.045 - nick * 0.08;
      let ao = 1;
      let relief = 0.58 + grain * 0.028 - nick * 0.075;

      // Separate the top face, machined bevel and dark gap between plates.
      const seam = 0.012;
      if (edge < seam) {
        const bevel = smooth(edge / seam);
        relief -= (1 - bevel) * 0.38;
        base *= 0.43 + 0.57 * bevel;
        rough += (1 - bevel) * 0.25;
        ao = 0.53 + 0.47 * bevel;
      }

      const bx = dx - 0.05;
      const by = dy - 0.05;
      const bolt = bx * bx + by * by;
      if (bolt < 0.00031) {
        if (bolt > 0.0002) {
          base *= 0.54;
          relief -= 0.19;
          ao = 0.7;
        } else {
          const slot = Math.abs(bx + by * 0.55) < 0.0025 && bolt < 0.00013;
          base = slot ? 0.24 : 0.65;
          relief = slot ? 0.41 : 0.7 - bolt * 180;
          rough = slot ? 0.65 : 0.28;
          metal = 0.82;
        }
      }

      // Some plates have narrow milled traction strips near their short edges.
      if (panel % 3 !== 1 && dx > 0.20 && dy > 0.085 && dy < 0.155) {
        const cut = Math.max(0, 1 - Math.abs((dy * 58) % 1 - 0.5) * 3.6);
        const grip = cut * Math.min(1, (dx - 0.20) * 28);
        base -= grip * 0.10;
        relief -= grip * 0.15;
        rough += grip * 0.26;
      }

      height[y * size + x] = relief;
      albedo.data[i] = base * 0.95 * 255;
      albedo.data[i + 1] = base * 255;
      albedo.data[i + 2] = base * 1.045 * 255;
      albedo.data[i + 3] = 255;
      ormPixel(orm.data, i, ao, rough, metal);
    }
  }
  a.putImageData(albedo, 0, 0);
  o.putImageData(orm, 0, 0);
  return {
    albedo: toTexture(`${name}Alb`, ac, scene),
    normal: toTexture(`${name}Nrm`, heightToNormal(height, size, 4), scene, { srgb: false }),
    orm: toTexture(`${name}Orm`, oc, scene, { srgb: false }),
  };
}

/** Wall cladding: vertical panels with seams, rivet rows, vents and rain/grime streaks. One tile = 4 m. */
export function wallSet(scene: Scene, high: boolean, indoor: boolean): PbrSet {
  const S = high ? 1024 : 512;
  const scale = S / 512;
  const { c: ac, ctx: a } = canvas(S);
  const img = a.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const { c: oc, ctx: o } = canvas(S);
  const oimg = o.createImageData(S, S);
  const cols = 2;
  const rows = 2;
  const PW = S / cols;
  const PH = S / rows;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const px = (x % PW) / scale;
      const py = (y % PH) / scale;
      const width = PW / scale;
      const depth = PH / scale;
      const edge = Math.min(px, py, width - px, depth - py);
      // Broad runoff streaks (~20 cm): narrow ones read as wood grain under warm light.
      const streak = vnoise(u * 20, v * 3, 20, 9, 3);
      const runoff = (indoor ? 0.12 : 1) * Math.max(0, streak - 0.43) * Math.max(0, 1 - py / (depth * 0.86));
      const grime = fbm(u, v, 8, 3, 2);
      const grain = vnoise(u * 192, v * 192, 192, 25) - 0.5;
      const panel = Math.floor(y / PH) * cols + Math.floor(x / PW);
      const tint = [0.04, -0.064, -0.026, 0.07][panel];
      let h = 0.6 + grain * 0.03;
      let alb = 0.72 + tint + (grime - 0.5) * (indoor ? 0.055 : 0.23) + grain * 0.034 - runoff * 0.31;
      let rough = 0.42 + (grime - 0.5) * 0.12 + Math.max(0, streak - 0.6) * 0.2;
      if (edge < 2) {
        h = 0.1;
        alb *= 0.35;
        rough = 0.7;
      } else if (edge < 6) {
        h = 0.62;
        rough -= 0.1;
      }
      // horizontal stiffener ribs
      const rib = Math.abs(py - depth * 0.5);
      if (!indoor && panel !== 1 && rib < 4) {
        h = 0.75 - rib * 0.02;
        alb *= 0.55; // dark accent band
        rough = 0.3;
      }
      // vent slots on lower panels
      if (panel === 2 && px > width * 0.2 && px < width * 0.8 && py > depth * 0.62 && py < depth * 0.86 && py % 12 < 4) {
        h = 0.15;
        alb *= 0.25;
        rough = 0.9;
      }
      height[y * S + x] = h;
      const i = (y * S + x) * 4;
      // Outdoor runoff carries rust: warm the streaks instead of only darkening them.
      const rr = indoor ? 0 : Math.min(1, runoff * 1.6 + Math.max(0, grime - 0.62) * 0.8);
      d[i] = alb * 255 * (indoor ? 1 : 0.91) * (1 - rr * 0.08);
      d[i + 1] = alb * 255 * (indoor ? 1.015 : 0.99) * (1 - rr * 0.32);
      d[i + 2] = alb * 255 * (indoor ? 1.025 : 1.06) * (1 - rr * 0.55);
      d[i + 3] = 255;
      ormPixel(oimg.data, i, edge < 3 ? 0.5 : 1, rough, 1);
    }
  }
  a.putImageData(img, 0, 0);
  o.putImageData(oimg, 0, 0);
  // rivets
  a.fillStyle = 'rgba(90,96,104,0.9)';
  for (let cx = 0; cx < cols; cx++)
    for (let cy = 0; cy < rows; cy++)
      for (let k = 0; k < 8; k++) {
        for (const side of [10 * scale, PW - 10 * scale]) {
          const x = cx * PW + side;
          const y = cy * PH + 14 * scale + k * ((PH - 28 * scale) / 7);
          a.beginPath();
          a.arc(x, y, 2.4 * scale, 0, Math.PI * 2);
          a.fill();
          const radius = 3 * scale;
          for (let yy = -radius; yy <= radius; yy++) {
            for (let xx = -radius; xx <= radius; xx++) {
              const distance = Math.hypot(xx, yy) / radius;
              if (distance < 1) height[(Math.round(y) + yy) * S + x + xx] = 0.62 + (1 - distance) * 0.23;
            }
          }
        }
      }
  if (!indoor) {
    // Rust bleeding down from rivets and the stiffener ribs.
    const r = rng(404);
    for (let cx = 0; cx < cols; cx++)
      for (let cy = 0; cy < rows; cy++)
        for (let k = 0; k < 8; k++)
          for (const side of [10 * scale, PW - 10 * scale]) {
            if (r() > 0.55) continue;
            const x = cx * PW + side;
            const y = cy * PH + 14 * scale + k * ((PH - 28 * scale) / 7);
            const len = (14 + r() * 60) * scale;
            const g = a.createLinearGradient(x, y, x, y + len);
            g.addColorStop(0, `rgba(118,58,24,${0.35 + r() * 0.3})`);
            g.addColorStop(1, 'rgba(118,58,24,0)');
            a.fillStyle = g;
            a.fillRect(x - 1.6 * scale, y, (2.2 + r() * 2.5) * scale, len);
          }
  }
  return {
    albedo: toTexture('wallAlb', ac, scene),
    normal: toTexture('wallNrm', heightToNormal(height, S, 5), scene, { srgb: false }),
    orm: toTexture('wallOrm', oc, scene, { srgb: false }),
  };
}

/** Generic wear for small props and machines: grime albedo multiplier + roughness noise + scratches. */
export function wearSet(scene: Scene, high: boolean, rust = 1): PbrSet {
  const S = high ? 512 : 256;
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
      const brushing = vnoise(u * 7, v * 192, 7, 41, 192) - 0.5;
      // Light speckle only: dense dark pits read as cork/plywood once warm light hits them.
      const alb = 0.93 + (g - 0.5) * 0.15 + brushing * 0.02 - Math.max(0, speck - 0.8) * 0.18;
      // Rust: blotches where the paint has failed (fbm threshold), pitted inside, with a soft halo.
      // Rust runs: vertically stretched noise, so failures read as streaks and drips, not spots.
      const patch = vnoise(u * 28, v * 5, 28, 77, 5) * 0.6 + fbm(u, v, 9, 3, 78) * 0.4;
      const pit = vnoise(u * 80, v * 80, 80, 13);
      const rm = rust * smooth(Math.max(0, Math.min(1, (patch - 0.66) * 9)));
      const halo = rust * smooth(Math.max(0, Math.min(1, (patch - 0.6) * 10))) * 0.25;
      const k = Math.max(rm, halo);
      const rAlb = alb * (0.62 + (pit - 0.5) * 0.25);
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(1, alb * (1 - k) + rAlb * 0.95 * k) * 255;
      img.data[i + 1] = Math.min(1, alb * (1 - k) + rAlb * 0.52 * k) * 255;
      img.data[i + 2] = Math.min(1, alb * (1 - k) + rAlb * 0.3 * k) * 255;
      img.data[i + 3] = 255;
      ormPixel(oimg.data, i, 1 - rm * 0.15, Math.min(1, 0.77 + (g - 0.5) * 0.32 + brushing * 0.06 + rm * 0.25), 1 - rm * 0.75);
      height[y * S + x] = g * 0.12 + brushing * 0.03 - rm * (0.05 + pit * 0.08);
    }
  }
  a.putImageData(img, 0, 0);
  o.putImageData(oimg, 0, 0);
  const r = rng(99);
  o.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 25; i++) {
    const x = r() * S;
    const y = r() * S;
    const ang = r() * Math.PI;
    const len = (4 + r() * 30) * (S / 256);
    o.strokeStyle = `rgba(255,${60 + r() * 60},255,0.7)`; // scratches are smoother
    o.lineWidth = 0.7 * (S / 256);
    o.beginPath();
    o.moveTo(x, y);
    o.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    o.stroke();
  }
  return {
    albedo: toTexture('wearAlb', ac, scene, { aniso: 4 }),
    normal: toTexture('wearNrm', heightToNormal(height, S, 3), scene, { srgb: false }),
    orm: toTexture('wearOrm', oc, scene, { srgb: false, aniso: 4 }),
  };
}

/** Corroded steel: mottled oxide with flaking paint islands and pitting (wreckage, scrap, rebar). */
export function rustSet(scene: Scene, high: boolean): PbrSet {
  const S = high ? 512 : 256;
  const { c: ac, ctx: a } = canvas(S);
  const { c: oc, ctx: o } = canvas(S);
  const img = a.createImageData(S, S);
  const oimg = o.createImageData(S, S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const ox = fbm(u, v, 6, 5, 211);
      const fine = vnoise(u * 96, v * 96, 96, 17);
      const paint = smooth(Math.max(0, Math.min(1, (fbm(u, v, 4, 3, 307) - 0.58) * 9)));
      const dark = 0.55 + ox * 0.6 + (fine - 0.5) * 0.25;
      const i = (y * S + x) * 4;
      const r = (0.5 * dark) * (1 - paint) + 0.36 * paint;
      const g = (0.25 * dark) * (1 - paint) + 0.38 * paint;
      const b = (0.11 * dark) * (1 - paint) + 0.36 * paint;
      img.data[i] = Math.min(1, r) * 255;
      img.data[i + 1] = Math.min(1, g) * 255;
      img.data[i + 2] = Math.min(1, b) * 255;
      img.data[i + 3] = 255;
      ormPixel(oimg.data, i, 0.85 + ox * 0.15, 0.88 - paint * 0.3 - (fine - 0.5) * 0.1, 0.2 + paint * 0.4);
      height[y * S + x] = ox * 0.3 + (fine - 0.5) * 0.12 + paint * 0.06;
    }
  }
  a.putImageData(img, 0, 0);
  o.putImageData(oimg, 0, 0);
  return {
    albedo: toTexture('rustAlb', ac, scene),
    normal: toTexture('rustNrm', heightToNormal(height, S, 4), scene, { srgb: false }),
    orm: toTexture('rustOrm', oc, scene, { srgb: false }),
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

/** Billowing smoke or a hotter, filamented flame using the same soft-edge density field. */
/** Smoke uses a looping 4×4 sheet. Every cell is transparent at the border. */
export const SMOKE_CELL = 128;
export const SMOKE_FRAMES = 16;

export function plumeSprite(scene: Scene, fire = false): DynamicTexture {
  const cell = fire ? 192 : SMOKE_CELL;
  const atlas = fire ? 1 : 4;
  const size = cell * atlas;
  const { c, ctx } = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let frame = 0; frame < atlas * atlas; frame++) {
    const angle = frame * Math.PI * 2 / (atlas * atlas);
    const driftX = fire ? 0 : Math.sin(angle) * 0.09;
    const driftY = fire ? 0 : Math.cos(angle) * 0.10;
    const left = (frame % atlas) * cell;
    const top = Math.floor(frame / atlas) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = x / cell;
        const v = y / cell;
        const dx = u * 2 - 1;
        const dy = v * 2 - 1;
        const radius = Math.hypot(dx, dy);
        if (radius >= 0.99) continue;
        const clouds = fbm(u + driftX, v + driftY, 4, 5, fire ? 31 : 40);
        const detail = fbm(u + 0.10 * clouds - driftY, v - 0.14 * clouds + driftX, 8, 4, 80);
        const falloff = Math.max(0, 1 - radius * 1.07);
        const density = Math.max(0, Math.min(1, falloff * 1.23 + (clouds - 0.64) * 0.86));
        const edge = Math.min(1, (0.99 - radius) * 9);
        const veins = Math.max(0, 1 - Math.abs(detail - 0.52) * 7);
        const shade = fire ? 0.65 + veins * 0.35 : 0.66 + (detail - 0.5) * 0.75 - dy * 0.18;
        const i = ((top + y) * size + left + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = shade * 255;
        const opacity = fire ? density ** 1.75 * (0.32 + veins * 0.68) : density ** 1.55;
        img.data[i + 3] = opacity * edge * 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return spriteTex(fire ? 'flameSprite' : 'smokeFlipbook', c, scene);
}

/** A bright spark head and tapering trail for velocity-aligned billboards. */
export function sparkSprite(scene: Scene): DynamicTexture {
  const width = 32;
  const height = 128;
  const { c, ctx } = canvas(width, height);
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const tail = Math.max(0, 1 - Math.abs(t - 0.26) / (t < 0.26 ? 0.26 : 0.74));
    const spread = 0.11 + tail * 0.32;
    for (let x = 0; x < width; x++) {
      const side = Math.abs(x / width * 2 - 1);
      const core = Math.max(0, 1 - side / spread);
      const halo = Math.max(0, 1 - side) ** 3 * tail ** 2 * 0.26;
      const i = (y * width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(1, core * tail + halo) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return spriteTex('sparkSprite', c, scene);
}

/** Shockwave ring (soft-edged annulus). */
export function ringSprite(scene: Scene): DynamicTexture {
  const S = 256;
  const { c, ctx } = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.68, 'rgba(255,255,255,0)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.83, 'rgba(255,255,255,0.13)');
  g.addColorStop(0.90, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.94, 'rgba(255,255,255,1)');
  g.addColorStop(0.97, 'rgba(255,255,255,0.25)');
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
