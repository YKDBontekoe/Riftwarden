type SurfaceSource = 'concrete' | 'paint' | 'steel' | 'frost';

const SOURCE_SIZE = 256;
const TILES: Record<SurfaceSource, readonly [number, number]> = {
  concrete: [0, 0], paint: [1, 0], steel: [0, 1], frost: [1, 1],
};
const sources = new Map<SurfaceSource, Float32Array>();
const resampled = new Map<string, Float32Array>();
const neutral = () => 0;

/** Decode the tileable, neutral detail atlas before the first scene builds its procedural maps. */
export async function loadSurfaceSources(): Promise<void> {
  if (typeof Image === 'undefined' || sources.size) return;
  const image = new Image();
  image.src = new URL('../assets/industrial-surface-grain.webp', import.meta.url).href;
  try {
    await image.decode();
    if (image.naturalWidth !== SOURCE_SIZE * 2 || image.naturalHeight !== SOURCE_SIZE * 2) return;
    const atlas = document.createElement('canvas');
    atlas.width = atlas.height = SOURCE_SIZE * 2;
    const ctx = atlas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    for (const material of Object.keys(TILES) as SurfaceSource[]) {
      const [x, y] = TILES[material];
      const { data } = ctx.getImageData(x * SOURCE_SIZE, y * SOURCE_SIZE, SOURCE_SIZE, SOURCE_SIZE);
      const tile = new Float32Array(SOURCE_SIZE * SOURCE_SIZE);
      for (let i = 0; i < tile.length; i++) tile[i] = (data[i * 4] - 128) / 128;
      sources.set(material, tile);
    }
  } catch {
    // If the optional detail atlas cannot be decoded, use the procedural surfaces.
  }
}

/** A repeated, resolution-matched zero-centered detail signal for albedo, height and roughness. */
export function surfaceGrain(material: SurfaceSource, size: number, repeats = 1): (x: number, y: number) => number {
  const src = sources.get(material);
  if (!src) return neutral;
  const width = Math.max(1, Math.round(size / repeats));
  const key = `${material}:${width}`;
  let tile = resampled.get(key);
  if (!tile) {
    tile = new Float32Array(width * width);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const scale = SOURCE_SIZE / width;
      const x0 = Math.floor(x * scale), x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      const y0 = Math.floor(y * scale), y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += src[sy * SOURCE_SIZE + sx];
      tile[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
    }
    resampled.set(key, tile);
  }
  return (x, y) => tile[(y % width) * width + x % width];
}
