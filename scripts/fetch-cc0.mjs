// Fetch, licence-check and convert the CC0 assets listed in assets-src/cc0.sources.json into
// packages/game/src/assets/cc0/, then rewrite its manifest.json and docs/assets/credits.md.
//   node scripts/fetch-cc0.mjs            (everything missing)
//   node scripts/fetch-cc0.mjs --force    (re-convert everything)
//   node scripts/fetch-cc0.mjs barrel-red (only these ids)
// Needs curl and ffmpeg (libwebp, libmp3lame). No npm dependencies: glTF files are packed into GLB here, with
// their textures re-encoded as WebP (EXT_texture_webp), so the repository stays free of build-time asset tools.
// Only CC0 is accepted (docs/design/design-direction.md): Poly Haven publishes everything as CC0; OpenGameArt pages
// must list CC0 as their licence, and anything else (CC-BY, OGA-BY, GPL) aborts the run.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(ROOT, 'assets-src/cc0.sources.json');
const OUT = join(ROOT, 'packages/game/src/assets/cc0');
const MANIFEST = join(OUT, 'manifest.json');
const CREDITS = join(ROOT, 'docs/assets/credits.md');
const DETAIL = 512;

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = new Set(args.filter((a) => !a.startsWith('--')));
const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { assets: [] };
const entries = new Map(previous.assets.map((a) => [a.id, a]));
const work = mkdtempSync(join(tmpdir(), 'cc0-'));

const curl = (url) => execFileSync('curl', ['-sSfL', '--retry', '3', url], { maxBuffer: 1 << 30 });
const json = (url) => JSON.parse(curl(url).toString('utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const ffmpeg = (argv, input) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...argv], { input, maxBuffer: 1 << 30 });
const today = new Date().toISOString().slice(0, 10);

function wanted(id, file) {
  if (only.size && !only.has(id)) return false;
  return force || !existsSync(file) || !entries.has(id);
}

function record(entry, file) {
  const buf = readFileSync(file);
  entries.set(entry.id, { ...entry, file: file.slice(OUT.length + 1), license: 'CC0-1.0', retrieved: today, bytes: buf.length, sha256: sha(buf) });
  console.log(`  ${entry.id}: ${(buf.length / 1024).toFixed(0)} KB`);
}

/** Re-encode a JPEG/PNG as WebP, optionally resized to `size` px wide (square textures). */
function toWebp(input, size, quality = 82) {
  const src = join(work, 'in.img');
  const dst = join(work, 'out.webp');
  writeFileSync(src, input);
  ffmpeg(['-y', '-i', src, ...(size ? ['-vf', `scale=${size}:-1:flags=lanczos`] : []), '-c:v', 'libwebp', '-quality', String(quality), dst]);
  return readFileSync(dst);
}

// ------------------------------------------------------------------ models (Poly Haven glTF -> GLB + WebP)

function packGlb(gltf, bin, images) {
  const chunks = [bin];
  let offset = bin.length;
  const align = () => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
  };
  gltf.bufferViews ??= [];
  for (const [index, data] of images) {
    align();
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    gltf.images[index] = { bufferView: gltf.bufferViews.length - 1, mimeType: 'image/webp' };
    chunks.push(data);
    offset += data.length;
  }
  align();
  const body = Buffer.concat(chunks);
  gltf.buffers = [{ byteLength: body.length }];
  for (const texture of gltf.textures ?? []) {
    texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: texture.source } };
    delete texture.source;
  }
  // Transmission needs a refraction render pass per frame; small glass parts read fine as glossy dark glass.
  for (const material of gltf.materials ?? []) {
    if (!material.extensions?.KHR_materials_transmission) continue;
    delete material.extensions.KHR_materials_transmission;
    material.pbrMetallicRoughness = { ...material.pbrMetallicRoughness, baseColorFactor: [0.05, 0.06, 0.07, 1], roughnessFactor: 0.08, metallicFactor: 0 };
  }
  gltf.extensionsUsed = (gltf.extensionsUsed ?? []).filter((e) => e !== 'KHR_materials_transmission');
  gltf.extensionsUsed = [...new Set([...gltf.extensionsUsed, 'EXT_texture_webp'])];
  gltf.extensionsRequired = [...new Set([...(gltf.extensionsRequired ?? []), 'EXT_texture_webp'])];
  gltf.asset = { ...gltf.asset, generator: 'riftwarden fetch-cc0' };
  let text = Buffer.from(JSON.stringify(gltf), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, body)]);
}

function fetchModel(m) {
  const file = join(OUT, 'models', `${m.id}.glb`);
  if (!wanted(m.id, file)) return;
  const info = json(`https://api.polyhaven.com/info/${m.polyhaven}`);
  if (info.type !== 2) throw new Error(`${m.polyhaven} is not a Poly Haven model`);
  const files = json(`https://api.polyhaven.com/files/${m.polyhaven}`);
  const g = files.gltf?.['1k']?.gltf;
  if (!g) throw new Error(`${m.polyhaven}: no 1k glTF`);
  const gltf = JSON.parse(curl(g.url).toString('utf8'));
  if ((gltf.buffers ?? []).length !== 1) throw new Error(`${m.polyhaven}: expected one buffer`);
  const bin = curl(g.include[gltf.buffers[0].uri].url);
  const images = (gltf.images ?? []).map((image, index) => {
    const inc = g.include[image.uri];
    if (!inc) throw new Error(`${m.polyhaven}: missing ${image.uri}`);
    // Normal maps keep a higher quality: WebP block noise reads as surface dents under a low sun.
    const quality = /nor/i.test(image.uri) ? 90 : 80;
    return [index, toWebp(curl(inc.url), m.tex ?? 1024, quality)];
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, packGlb(gltf, bin, images));
  const authors = Object.keys(info.authors ?? {}).join(', ');
  record({ id: m.id, kind: 'model', title: info.name, author: authors, source: `https://polyhaven.com/a/${m.polyhaven}`, triangles: info.polycount, dimensionsMm: info.dimensions?.map((d) => Math.round(d)) }, file);
}

// ------------------------------------------------------------------ detail maps (Poly Haven textures)

/** Decode an image into `size`x`size` 8-bit channels (gray or rgb). */
function raw(input, size, fmt) {
  const src = join(work, 'tex.img');
  writeFileSync(src, input);
  return ffmpeg(['-y', '-i', src, '-vf', `scale=${size}:${size}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', fmt, '-']);
}

/** Wrap-around box blur (the sources tile), used to high-pass the albedo and roughness. */
function blur(src, size, r) {
  const out = new Float32Array(size * size);
  const tmp = new Float32Array(size * size);
  const n = 2 * r + 1;
  for (let y = 0; y < size; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * size + ((k + size) % size)];
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = acc / n;
      acc += src[y * size + ((x + r + 1) % size)] - src[y * size + ((x - r + size) % size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + size) % size) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc / n;
      acc += tmp[((y + r + 1) % size) * size + x] - tmp[((y - r + size) % size) * size + x];
    }
  }
  return out;
}

/**
 * Babylon detail map layout: R = albedo detail, G = normal Y, B = roughness detail, A = normal X, all centred on
 * 0.5. Albedo and roughness are high-passed (radius 24 px), so a scanned stain never repeats as a visible tile and
 * the procedural macro maps keep owning colour and wear; only the scanned micro detail is added.
 */
function fetchTexture(t) {
  const file = join(OUT, 'textures', `${t.id}-detail.webp`);
  if (!wanted(t.id, file)) return;
  const info = json(`https://api.polyhaven.com/info/${t.polyhaven}`);
  if (info.type !== 1) throw new Error(`${t.polyhaven} is not a Poly Haven texture`);
  const files = json(`https://api.polyhaven.com/files/${t.polyhaven}`);
  const pick = (key) => files[key]?.['1k']?.jpg?.url ?? files[key]?.['1k']?.png?.url;
  const diff = pick('Diffuse') ?? pick('diff');
  const nor = pick('nor_gl');
  const rough = pick('Rough') ?? pick('rough');
  if (!diff || !nor || !rough) throw new Error(`${t.polyhaven}: missing diffuse/normal/roughness`);
  const size = DETAIL;
  const albedo = raw(curl(diff), size, 'gray');
  const normal = raw(curl(nor), size, 'rgb24');
  const roughness = raw(curl(rough), size, 'gray');
  const a = Float32Array.from(albedo, (v) => v / 255);
  const r = Float32Array.from(roughness, (v) => v / 255);
  const am = blur(a, size, 24);
  const rm = blur(r, size, 24);
  // Normalise the detail strength across sources: the material's blend level, not the scan, sets the look.
  let as = 0, rs = 0;
  for (let i = 0; i < a.length; i++) {
    as += (a[i] - am[i]) ** 2;
    rs += (r[i] - rm[i]) ** 2;
  }
  const ag = 0.12 / Math.max(1e-3, Math.sqrt(as / a.length));
  const rg = 0.1 / Math.max(1e-3, Math.sqrt(rs / r.length));
  const out = Buffer.alloc(size * size * 4);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = clamp(0.5 + (a[i] - am[i]) * ag);
    out[i * 4 + 1] = normal[i * 3 + 1];
    out[i * 4 + 2] = clamp(0.5 + (r[i] - rm[i]) * rg);
    out[i * 4 + 3] = normal[i * 3];
  }
  const src = join(work, 'detail.rgba');
  writeFileSync(src, out);
  mkdirSync(dirname(file), { recursive: true });
  // Lossy colour, lossless alpha (libwebp keeps alpha lossless by default): lossy alpha bands the normal X channel.
  ffmpeg(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size}x${size}`, '-i', src, '-c:v', 'libwebp', '-quality', '90', '-compression_level', '6', file]);
  const authors = Object.keys(info.authors ?? {}).join(', ');
  record({ id: t.id, kind: 'texture', title: info.name, author: authors, source: `https://polyhaven.com/a/${t.polyhaven}` }, file);
}

// ------------------------------------------------------------------ full surface sets (Poly Haven textures)

/**
 * A full PBR set for a surface the game textures with world-scale UVs: albedo (sRGB), OpenGL normal and ARM
 * (R = AO, G = roughness, B = metal: the palette's ORM layout), each a WebP. Normals keep a higher quality.
 */
function fetchSet(t) {
  const base = join(OUT, 'sets', t.id);
  if (!wanted(`${t.id}-albedo`, `${base}-albedo.webp`) && (!only.size || !only.has(t.id))) return;
  const info = json(`https://api.polyhaven.com/info/${t.polyhaven}`);
  if (info.type !== 1) throw new Error(`${t.polyhaven} is not a Poly Haven texture`);
  const files = json(`https://api.polyhaven.com/files/${t.polyhaven}`);
  const res = t.res ?? '1k';
  const pick = (...keys) => {
    for (const k of keys) {
      const url = files[k]?.[res]?.jpg?.url ?? files[k]?.[res]?.png?.url;
      if (url) return url;
    }
    throw new Error(`${t.polyhaven}: no ${keys.join('/')} at ${res}`);
  };
  mkdirSync(dirname(base), { recursive: true });
  const maps = [['albedo', pick('Diffuse', 'diff'), 78], ['normal', pick('nor_gl'), 86], ['arm', pick('arm'), 80]];
  for (const [name, url, quality] of maps) {
    if (name === 'normal' && t.height) {
      // Height in the normal map's alpha (Babylon's parallax layout): the game's parallax occlusion reads it.
      const nor = join(work, 'nor.img');
      const disp = join(work, 'disp.img');
      writeFileSync(nor, curl(url));
      writeFileSync(disp, curl(pick('Displacement', 'disp')));
      const dst = join(work, 'nh.webp');
      ffmpeg(['-y', '-i', nor, '-i', disp, '-filter_complex', '[1:v]format=gray,scale=w=iw:h=ih[h];[0:v]format=rgb24[n];[h][n]scale2ref[h2][n2];[n2][h2]alphamerge,format=rgba', '-c:v', 'libwebp', '-quality', String(quality), dst]);
      writeFileSync(`${base}-${name}.webp`, readFileSync(dst));
      continue;
    }
    writeFileSync(`${base}-${name}.webp`, toWebp(curl(url), 0, quality));
  }
  const authors = Object.keys(info.authors ?? {}).join(', ');
  // One manifest entry per file, so the hash test covers each map.
  for (const [name] of maps) record({ id: `${t.id}-${name}`, kind: 'texture', title: `${info.name} (${name}, ${res})`, author: authors, source: `https://polyhaven.com/a/${t.polyhaven}` }, `${base}-${name}.webp`);
}

// ------------------------------------------------------------------ music (OpenGameArt, CC0 only)

function fetchMusic(m) {
  const file = join(OUT, 'music', `${m.id}.mp3`);
  if (!wanted(m.id, file)) return;
  const page = curl(m.page).toString('utf8');
  const field = page.match(/field-name-field-art-licenses[\s\S]{0,800}/)?.[0] ?? '';
  const licences = [...new Set(field.match(/CC0|CC-BY(?:-SA)? [0-9.]+|OGA-BY [0-9.]+|GPL [0-9.]+/g) ?? [])];
  if (licences.length !== 1 || licences[0] !== 'CC0') throw new Error(`${m.page}: licence ${licences.join(', ') || 'unknown'} is not CC0 only`);
  if (!page.includes(m.file)) throw new Error(`${m.page} does not list ${m.file}`);
  const src = join(work, 'music.in');
  writeFileSync(src, curl(m.file));
  mkdirSync(dirname(file), { recursive: true });
  // -18 LUFS leaves headroom for the procedural layers and effects that play on top (Music.ts).
  ffmpeg(['-y', '-i', src, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '96k', file]);
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
  record({ id: m.id, kind: 'music', title: m.title, author: m.author, source: m.page, seconds: Math.round(duration * 10) / 10 }, file);
}

// ------------------------------------------------------------------ run

try {
  console.log('models');
  for (const m of sources.models) fetchModel(m);
  console.log('textures');
  for (const t of sources.textures) fetchTexture(t);
  console.log('sets');
  for (const t of sources.sets ?? []) fetchSet(t);
  console.log('music');
  for (const m of sources.music) fetchMusic(m);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const listed = new Set([...sources.models, ...sources.textures, ...sources.music].map((a) => a.id));
for (const t of sources.sets ?? []) for (const m of ['albedo', 'normal', 'arm']) listed.add(`${t.id}-${m}`);
const assets = [...entries.values()].filter((a) => listed.has(a.id)).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
writeFileSync(MANIFEST, JSON.stringify({ $comment: 'Generated by scripts/fetch-cc0.mjs from assets-src/cc0.sources.json. Do not edit by hand.', assets }, null, 2) + '\n');

const total = assets.reduce((s, a) => s + a.bytes, 0);
const rows = assets.map((a) => `| ${a.kind} | \`${a.file}\` | [${a.title}](${a.source}) | ${a.author} | ${a.license} |`);
mkdirSync(dirname(CREDITS), { recursive: true });
writeFileSync(CREDITS, `# Third-party asset credits

Generated by \`node scripts/fetch-cc0.mjs\` from \`assets-src/cc0.sources.json\`; do not edit by hand. Every asset is
CC0 1.0 (public domain dedication); attribution is not required, it is kept for provenance. Files live under
\`packages/game/src/assets/cc0/\` (${(total / 1048576).toFixed(1)} MB in total). Models and textures: [Poly Haven](https://polyhaven.com/license).
Music: [OpenGameArt](https://opengameart.org) pages whose only listed licence is CC0.

| Kind | File | Source | Author | Licence |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`);
console.log(`${assets.length} assets, ${(total / 1048576).toFixed(1)} MB`);
