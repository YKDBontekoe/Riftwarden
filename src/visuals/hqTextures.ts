import type { DynamicTexture, Scene } from '@babylonjs/core';
import { canvas, fbm, heightToNormal, rng, toTexture, vnoise } from './textures';

/**
 * Headquarters surface sets (clean high-tech interior). Procedural like the arena sets,
 * but each also carries an emissive map so inset light channels, LED seams and lit
 * recesses are part of the surface (no extra meshes or lights).
 *
 * Tile sizes match `HqBuilder` box projection: deck 6 m, walls 4 m, ceiling 2.5 m.
 */
export interface HqSet {
  albedo: DynamicTexture;
  normal: DynamicTexture;
  orm: DynamicTexture;
  emissive: DynamicTexture;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Pixel buffers for one set; `px` writes all maps at once. */
function buffers(size: number) {
  const A = canvas(size);
  const O = canvas(size);
  const E = canvas(size);
  const albedo = A.ctx.createImageData(size, size);
  const orm = O.ctx.createImageData(size, size);
  const emis = E.ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const px = (x: number, y: number, r: number, g: number, b: number, h: number, ao: number, rough: number, metal: number, er = 0, eg = 0, eb = 0) => {
    const i = (y * size + x) * 4;
    albedo.data[i] = clamp01(r) * 255;
    albedo.data[i + 1] = clamp01(g) * 255;
    albedo.data[i + 2] = clamp01(b) * 255;
    albedo.data[i + 3] = 255;
    orm.data[i] = clamp01(ao) * 255;
    orm.data[i + 1] = clamp01(rough) * 255;
    orm.data[i + 2] = clamp01(metal) * 255;
    orm.data[i + 3] = 255;
    emis.data[i] = clamp01(er) * 255;
    emis.data[i + 1] = clamp01(eg) * 255;
    emis.data[i + 2] = clamp01(eb) * 255;
    emis.data[i + 3] = 255;
    height[y * size + x] = h;
  };
  const finish = (scene: Scene, name: string, normalStrength: number): HqSet => {
    A.ctx.putImageData(albedo, 0, 0);
    O.ctx.putImageData(orm, 0, 0);
    E.ctx.putImageData(emis, 0, 0);
    return {
      albedo: toTexture(`${name}Alb`, A.c, scene, { aniso: 8 }),
      normal: toTexture(`${name}Nrm`, heightToNormal(height, size, normalStrength), scene, { srgb: false }),
      orm: toTexture(`${name}Orm`, O.c, scene, { srgb: false }),
      emissive: toTexture(`${name}Emi`, E.c, scene),
    };
  };
  return { px, finish };
}

/** Bevelled seam profile: 0 in the gap, ramps to 1 over `bevel` past `gap` (all in tile units). */
function seamProfile(edge: number, gap: number, bevel: number): { k: number; rim: number } {
  if (edge < gap) return { k: 0, rim: 0 };
  const t = (edge - gap) / bevel;
  if (t >= 1) return { k: 1, rim: 0 };
  return { k: smooth(t), rim: 1 - t };
}

/**
 * Deck: four 3 m plates per 6 m tile. Plate 0 brushed with corner bolts, plate 1 split
 * into four service tiles, plate 2 a traction plate with milled grip bands, plate 3 plain
 * brushed steel. Bevels show worn bright metal; one seam carries an inset LED channel.
 */
export function hqDeckSet(scene: Scene, high: boolean): HqSet {
  const size = high ? 1024 : 512;
  const { px, finish } = buffers(size);
  const random = rng(731);
  const tint = Array.from({ length: 8 }, () => (random() - 0.5) * 0.05);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const plate = Math.floor(v * 2) * 2 + Math.floor(u * 2);
      const pu = (u * 2) % 1;
      const pv = (v * 2) % 1;
      let eu = Math.min(pu, 1 - pu);
      let ev = Math.min(pv, 1 - pv);
      // Service tiles: plate 1 subdivided 2x2.
      let sub = 0;
      if (plate === 1) {
        const su = (pu * 2) % 1;
        const sv = (pv * 2) % 1;
        eu = Math.min(eu, Math.min(su, 1 - su) * 0.5);
        ev = Math.min(ev, Math.min(sv, 1 - sv) * 0.5);
        sub = Math.floor(pv * 2) * 2 + Math.floor(pu * 2);
      }
      const edge = Math.min(eu, ev);
      const brushed = vnoise(u * 6, v * 420, 6, 17, 420) - 0.5;
      const mottle = fbm(u, v, 6, 3, 23) - 0.5;
      const speck = vnoise(u * 300, v * 300, 300, 5);
      let base = 0.66 + tint[plate] + (plate === 1 ? tint[4 + sub] : 0) + brushed * 0.035 + mottle * 0.05 - Math.max(0, speck - 0.82) * 0.25;
      let rough = 0.42 + mottle * 0.12 - brushed * 0.08;
      let metal = 0.55;
      let ao = 1;
      let h = 0.6 + brushed * 0.01;
      let er = 0, eg = 0, eb = 0;
      const s = seamProfile(edge, 0.0035, 0.008);
      if (s.k < 1) {
        h = 0.2 + 0.4 * s.k;
        base = base * (0.3 + 0.7 * s.k) + s.rim * 0.14; // dark gap, bright worn bevel
        metal = 0.55 + s.rim * 0.4;
        rough = 0.75 - s.rim * 0.45;
        ao = 0.45 + 0.55 * s.k;
      }
      // Corner bolts (plates 0 and 2).
      if (plate === 0 || plate === 2) {
        const bx = eu - 0.045;
        const by = ev - 0.045;
        const d2 = bx * bx + by * by;
        if (d2 < 0.00028) {
          const rim = d2 > 0.00018;
          base = rim ? base * 0.5 : 0.78;
          h = rim ? 0.48 : 0.7;
          metal = 0.9;
          rough = rim ? 0.6 : 0.25;
          ao = rim ? 0.7 : 1;
        }
      }
      // Traction plate: two milled grip bands.
      if (plate === 2 && eu > 0.12 && (Math.abs(pv - 0.3) < 0.07 || Math.abs(pv - 0.7) < 0.07)) {
        const groove = Math.abs(((pu + pv) * 70) % 1 - 0.5) < 0.18 ? 1 : 0;
        base -= groove * 0.12 + 0.03;
        h -= groove * 0.08;
        rough += 0.18;
        metal -= 0.15;
      }
      // Inset LED channel along the seam between the two plate columns (u = 0.5).
      const du = Math.abs(u - 0.5);
      if (du < 0.0045) {
        const dot = Math.abs(((v * 48) % 1) - 0.5) < 0.22 ? 1 : 0.15;
        base = 0.08;
        h = 0.3;
        rough = 0.2;
        er = 0.25 * dot;
        eg = 0.9 * dot;
        eb = 1 * dot;
      }
      px(x, y, base * 0.97, base, base * 1.03, h, ao, rough, metal, er, eg, eb);
    }
  }
  return finish(scene, 'hqDeck2', 4.2);
}

/**
 * Wall cladding: 2 m composite panels (2x2 per 4 m tile) with crisp seams. Panel 0 has a
 * recessed band with a lit slit, panel 1 an acoustic micro-perforated field, panel 2 a
 * screwed access hatch with a stencil label, panel 3 fine ribs across the top.
 */
export function hqWallSet(scene: Scene, high: boolean): HqSet {
  const size = high ? 1024 : 512;
  const { px, finish } = buffers(size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      // Two tall 2 x 4 m panels per tile; each half is treated as an upper/lower zone (0/2 left, 1/3 right).
      const col = Math.floor(u * 2);
      const pu = (u * 2) % 1;
      const pv = v;
      const panel = col + (pv > 0.5 ? 2 : 0);
      const eu = Math.min(pu, 1 - pu);
      const ev = Math.min(pv, 1 - pv) * 0.5;
      const edge = Math.min(eu, ev);
      const grain = vnoise(u * 220, v * 220, 220, 7) - 0.5;
      const cloud = fbm(u, v, 4, 3, 41) - 0.5;
      let base = 0.86 + grain * 0.012 + cloud * 0.025 + [0.01, -0.02, 0, -0.01][panel];
      let rough = 0.55 + cloud * 0.06;
      let metal = 0;
      let ao = 1;
      let h = 0.6 + grain * 0.004;
      let er = 0, eg = 0, eb = 0;
      const s = seamProfile(edge, 0.0025, 0.006);
      if (s.k < 1) {
        h = 0.3 + 0.3 * s.k;
        base = base * (0.45 + 0.55 * s.k) + s.rim * 0.04;
        ao = 0.4 + 0.6 * s.k;
        rough = 0.7;
      }
      if (col === 0 && eu > 0.03 && Math.abs(pv - 0.5) < 0.022) {
        // Recessed graphite band with a cyan light slit, across the left panel at mid height.
        const d = Math.abs(pv - 0.5) * 2.2;
        base = 0.16;
        metal = 0.5;
        rough = 0.35;
        h = d > 0.042 ? 0.4 : 0.45;
        ao = d > 0.042 ? 0.6 : 1;
        if (d < 0.006 && eu > 0.06) {
          base = 0.1;
          er = 0.35;
          eg = 0.95;
          eb = 0.9;
        }
      }
      if (panel === 1 && eu > 0.14 && pv > 0.1 && pv < 0.34) {
        // Acoustic micro-perforation field (upper right).
        const hole = Math.hypot(((pu * 70) % 1) - 0.5, ((pv * 140) % 1) - 0.5) < 0.16;
        base -= 0.025;
        if (hole) {
          base -= 0.18;
          h = 0.5;
          ao = 0.75;
        }
      }
      if (panel === 2) {
        // Access hatch.
        const hx = Math.abs(pu - 0.5);
        const hy = Math.abs(pv - 0.8) * 2;
        const hatch = Math.max(hx / 0.3, hy / 0.22);
        if (hatch < 1.04 && hatch > 0.985) {
          base *= 0.35;
          h = 0.35;
          ao = 0.55;
        }
        const screws = [[-0.26, -0.18], [0.26, -0.18], [-0.26, 0.18], [0.26, 0.18]];
        for (const [sx, sy] of screws) {
          const d = Math.hypot(pu - 0.5 - sx, (pv - 0.8) * 2 - sy);
          if (d < 0.009) {
            base = 0.5;
            metal = 0.9;
            rough = 0.3;
            h = 0.68;
          }
        }
        // Stencil label plate above the hatch.
        if (Math.abs(pu - 0.5) < 0.16 && Math.abs(pv - 0.64) < 0.016) {
          base = 0.2;
          rough = 0.4;
          h = 0.62;
        }
      }
      if (panel === 1 && pv > 0.04 && pv < 0.08 && eu > 0.05) {
        const rib = Math.abs(((pv * 180) % 1) - 0.5) < 0.2;
        if (rib) {
          base -= 0.1;
          h = 0.5;
        }
      }
      // Very light bottom-of-panel grime (indoor, cleaned often).
      base -= Math.max(0, pv - 0.92) * 0.25 * (0.5 + cloud);
      px(x, y, base * 0.985, base, base * 1.01, h, ao, rough, metal, er, eg, eb);
    }
  }
  // Stencil text: label plate above the hatch (panel 2) and a deck marking in the band panel.
  const S = size;
  const set = finish(scene, 'hqWall2', 4.5);
  const ctx = set.albedo.getContext() as unknown as CanvasRenderingContext2D;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(0.014 * S)}px monospace`;
  ctx.fillStyle = 'rgba(225,235,238,0.85)';
  ctx.fillText('SVC-04 · 230V', 0.25 * S, 0.64 * S);
  ctx.font = `600 ${Math.round(0.011 * S)}px monospace`;
  ctx.fillStyle = 'rgba(40,52,58,0.5)';
  ctx.fillText('HQ · DECK A', 0.25 * S, 0.535 * S);
  set.albedo.update(false);
  return set;
}

/** Ceiling: 1.25 m acoustic tiles with micro-perforation and a linear light slot per tile. */
export function hqCeilingSet(scene: Scene, high: boolean): HqSet {
  const size = high ? 512 : 256;
  const { px, finish } = buffers(size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const pu = (u * 2) % 1;
      const pv = (v * 2) % 1;
      const edge = Math.min(pu, 1 - pu, pv, 1 - pv);
      const hole = Math.hypot(((pu * 40) % 1) - 0.5, ((pv * 40) % 1) - 0.5) < 0.18;
      let base = hole ? 0.55 : 0.72;
      let h = hole ? 0.5 : 0.6;
      let ao = 1;
      let rough = 0.85;
      let metal = 0;
      let er = 0, eg = 0, eb = 0;
      if (edge < 0.012) {
        base = 0.3;
        h = 0.3;
        ao = 0.5;
        metal = 0.6;
        rough = 0.4;
      }
      const slot = Math.abs(pu - 0.5);
      const lit = u < 0.5 && v < 0.5;
      if (lit && slot < 0.035 && pv > 0.08 && pv < 0.92) {
        base = 0.9;
        rough = 0.3;
        h = 0.45;
        const k = slot < 0.022 ? 1 : 0.4;
        er = 0.95 * k;
        eg = 0.97 * k;
        eb = 1 * k;
      }
      px(x, y, base, base, base * 1.02, h, ao, rough, metal, er, eg, eb);
    }
  }
  return finish(scene, 'hqCeil2', 3);
}
