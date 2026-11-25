import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { regionLayout } from '@riftwarden/rules/war/regions';
import { regionLiberation, type WarState } from '@riftwarden/rules/war/state';
import type { BiomeId } from '@riftwarden/rules/world/biomes';

/** Globe position of a latitude/longitude (degrees) on a sphere of radius r. */
export function globePoint(lat: number, lon: number, r = 1): Vector3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return new Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.sin(lo) * r);
}

type Status = 'liberated' | 'front' | 'fallen' | 'locked';
const STATUS: Record<Status, [number, number, number]> = {
  liberated: [0.5, 0.88, 0.78],
  front: [1, 0.54, 0.24],
  fallen: [1, 0.24, 0.2],
  locked: [0.62, 0.66, 0.7],
};
/** Ground tint per biome (multiplied into the rock albedo around a region). */
const BIOME_TINT: Record<BiomeId, [number, number, number]> = {
  outpost: [1.05, 0.95, 0.82],
  cryo: [1.25, 1.4, 1.6],
  foundry: [0.75, 0.62, 0.55],
};
/** Angular radius (degrees) of a region's territory on the planet. */
const REGION_DEG = 15;
const TEX_W = 768;
const TEX_H = 384;

// ---------------------------------------------------------------- noise (3D value noise sampled on the sphere: no seam)
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
function fbm(x: number, y: number, z: number, seed: number, oct = 5): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f, seed + i * 31);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
/**
 * Unit-sphere direction of texel (i, j) of the equirectangular maps, matching Babylon's sphere UVs (u = yaw / 2π with
 * the vertex at (sin z·cos u, cos z, -sin z·sin u), v = z / π from the north pole; the textures upload unflipped).
 */
function texelDir(i: number, j: number): [number, number, number] {
  const u = ((i + 0.5) / TEX_W) * Math.PI * 2;
  const lat = (0.5 - (j + 0.5) / TEX_H) * Math.PI;
  return [Math.cos(lat) * Math.cos(u), Math.sin(lat), -Math.cos(lat) * Math.sin(u)];
}

interface Territory { dir: Vector3; status: Status; biome: BiomeId; rift: boolean; lib: number }

/**
 * The Rift War planet on its own canvas and engine (the terminal overlay blurs the main canvas): a lit rocky world
 * with a procedural surface, biome-tinted ground around each region, territory painted by war status (liberated
 * teal, the front ember, corrupted red, the next region grey), a glowing rift scar, city lights on the night side,
 * an atmosphere rim and a diamond pin per region with an HTML label. Drag to spin; clicking a pin selects its region.
 */
export class GlobeView {
  readonly engine: Engine;
  readonly scene: Scene;
  private camera: ArcRotateCamera;
  private planet: Mesh;
  private albedo: DynamicTexture;
  private glow: DynamicTexture;
  private base: Float32Array | null = null;
  private pins: Mesh[] = [];
  private ring: Mesh;
  private labels: HTMLElement | null = null;
  private labelEls = new Map<number, HTMLElement>();
  private targetAlpha: number | null = null;
  private disposed = false;
  private seed = -1;
  onSelect: ((k: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, labels?: HTMLElement | null) {
    this.labels = labels ?? null;
    this.engine = new Engine(canvas, true, { antialias: true, preserveDrawingBuffer: true, stencil: false }, true);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.ambientColor = new Color3(0.06, 0.08, 0.1);
    const cam = new ArcRotateCamera('globeCam', 0, 1.25, 3.3, Vector3.Zero(), scene);
    cam.lowerRadiusLimit = cam.upperRadiusLimit = 3.3;
    cam.attachControl(canvas, true);
    cam.panningSensibility = 0;
    cam.wheelPrecision = 1e9;
    cam.fov = 0.72;
    this.camera = cam;
    // Sun from the upper left of the view (the light follows the camera so the terminator stays on screen).
    const sun = new DirectionalLight('sun', new Vector3(1, -0.35, 0.6), scene);
    sun.intensity = 1.5;
    sun.diffuse = new Color3(1, 0.93, 0.84);
    sun.specular = new Color3(0.25, 0.25, 0.25);
    const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
    fill.intensity = 0.12;
    fill.diffuse = new Color3(0.45, 0.6, 0.75);
    fill.groundColor = new Color3(0.05, 0.05, 0.08);

    this.albedo = new DynamicTexture('planetAlbedo', { width: TEX_W, height: TEX_H }, scene, true);
    this.glow = new DynamicTexture('planetGlow', { width: TEX_W, height: TEX_H }, scene, true);
    this.planet = MeshBuilder.CreateSphere('planet', { diameter: 2, segments: 64 }, scene);
    const pm = new StandardMaterial('planetMat', scene);
    pm.diffuseTexture = this.albedo;
    pm.emissiveTexture = this.glow;
    pm.specularColor = new Color3(0.08, 0.09, 0.1);
    pm.specularPower = 24;
    this.planet.material = pm;
    this.planet.isPickable = false;
    // Atmosphere: a slightly larger shell, transparent in the middle and bright at the rim.
    const atmo = MeshBuilder.CreateSphere('atmo', { diameter: 2.1, segments: 48 }, scene);
    const am = new StandardMaterial('atmoMat', scene);
    am.disableLighting = true;
    am.diffuseColor = Color3.Black();
    am.emissiveColor = Color3.Black();
    const rim = new FresnelParameters();
    rim.leftColor = new Color3(0.6, 0.9, 1.1);
    rim.rightColor = Color3.Black();
    rim.bias = 0;
    rim.power = 2;
    am.emissiveFresnelParameters = rim;
    am.alpha = 0.999;
    am.alphaMode = Engine.ALPHA_ADD;
    atmo.material = am;
    atmo.isPickable = false;

    this.ring = MeshBuilder.CreateTorus('selRing', { diameter: 0.22, thickness: 0.012, tessellation: 40 }, scene);
    const rm = new StandardMaterial('ringMat', scene);
    rm.emissiveColor = new Color3(1, 0.62, 0.32);
    rm.disableLighting = true;
    this.ring.material = rm;
    this.ring.isPickable = false;

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERTAP) return;
      const k = pi.pickInfo?.pickedMesh?.metadata?.region;
      if (typeof k === 'number') this.onSelect?.(k);
    });
    let t = 0;
    this.engine.runRenderLoop(() => {
      if (this.disposed) return;
      const dt = this.engine.getDeltaTime();
      t += dt / 1000;
      if (this.targetAlpha !== null) {
        const d = ((this.targetAlpha - cam.alpha + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        cam.alpha += d * Math.min(1, dt / 300);
        if (Math.abs(d) < 0.002) this.targetAlpha = null;
      } else cam.alpha += 0.0008;
      // Keep the sun at a fixed angle to the view: the lit side and the terminator always read.
      const fwd = cam.target.subtract(cam.position).normalize();
      const right = Vector3.Cross(fwd, Vector3.Up()).normalize();
      sun.direction = fwd.scale(0.55).add(right.scale(0.75)).add(new Vector3(0, -0.35, 0)).normalize();
      for (const m of this.pins) m.scaling.setAll(1 + Math.sin(t * 3 + (m.metadata.region as number)) * (m.metadata.pulse ? 0.16 : 0.03));
      this.ring.rotation.y = t * 0.8;
      scene.render();
      this.placeLabels();
    });
  }

  /** Rock albedo of the whole planet (once per war seed). */
  private buildBase(seed: number): void {
    const out = new Float32Array(TEX_W * TEX_H);
    for (let j = 0; j < TEX_H; j++)
      for (let i = 0; i < TEX_W; i++) {
        const [x, y, z] = texelDir(i, j);
        const n = fbm(x * 2.2 + 7, y * 2.2, z * 2.2, seed);
        const ridge = 1 - Math.abs(fbm(x * 5, y * 5 + 3, z * 5, seed + 9, 4) * 2 - 1);
        out[j * TEX_W + i] = Math.min(1, n * 0.85 + ridge * ridge * 0.35);
      }
    this.base = out;
    this.seed = seed;
  }

  /** Paint albedo (rock x biome x territory) and the emissive layer (borders, rift, lights) for these territories. */
  private paint(ters: Territory[], seed: number): void {
    if (!this.base || this.seed !== seed) this.buildBase(seed);
    const base = this.base!;
    const ac = this.albedo.getContext() as CanvasRenderingContext2D;
    const gc = this.glow.getContext() as CanvasRenderingContext2D;
    const a = ac.createImageData(TEX_W, TEX_H);
    const g = gc.createImageData(TEX_W, TEX_H);
    const cosR = Math.cos((REGION_DEG * Math.PI) / 180);
    const cosEdge = Math.cos(((REGION_DEG - 1.6) * Math.PI) / 180);
    const cosBiome = Math.cos(((REGION_DEG + 14) * Math.PI) / 180);
    for (let j = 0; j < TEX_H; j++)
      for (let i = 0; i < TEX_W; i++) {
        const [x, y, z] = texelDir(i, j);
        const p = j * TEX_W + i;
        const h = base[p];
        // Rock: dark basalt to dusty highlands.
        let r = 0.1 + h * 0.34, gg = 0.1 + h * 0.3, b = 0.11 + h * 0.27;
        let er = 0, eg = 0, eb = 0;
        let best = -2;
        let ter: Territory | null = null;
        for (const t of ters) {
          const d = x * t.dir.x + y * t.dir.y + z * t.dir.z;
          if (d > cosBiome) {
            const k = Math.min(1, (d - cosBiome) / (cosR - cosBiome));
            const tint = BIOME_TINT[t.biome];
            r *= 1 + (tint[0] - 1) * k;
            gg *= 1 + (tint[1] - 1) * k;
            b *= 1 + (tint[2] - 1) * k;
          }
          if (d > best) { best = d; ter = t; }
        }
        // Polar caps.
        const cap = Math.max(0, (Math.abs(y) - 0.86) * 9) * (0.6 + h * 0.6);
        if (cap > 0) { r += cap * 0.5; gg += cap * 0.52; b += cap * 0.56; }
        if (ter && best > cosR) {
          const s = STATUS[ter.status];
          // Territory: a wash of the status colour, stronger in the lowlands, and a lit border.
          const wash = ter.status === 'locked' ? 0.12 : 0.3;
          r = r * (1 - wash) + s[0] * wash * 0.6;
          gg = gg * (1 - wash) + s[1] * wash * 0.6;
          b = b * (1 - wash) + s[2] * wash * 0.6;
          const edge = Math.max(0, 1 - Math.abs(best - (cosR + cosEdge) / 2) / ((cosEdge - cosR) * 0.9));
          const grid = (Math.abs(Math.sin(i * 0.9)) < 0.06 || Math.abs(Math.sin(j * 0.9)) < 0.06) ? 0.12 : 0;
          const lvl = ter.status === 'locked' ? 0.25 : 0.8;
          er += s[0] * (edge * lvl + grid * 0.5);
          eg += s[1] * (edge * lvl + grid * 0.5);
          eb += s[2] * (edge * lvl + grid * 0.5);
          // City lights in liberated ground, fires on the front.
          const speck = hash3(i, j, 3, seed);
          if (ter.status === 'liberated' && speck > 0.985 - ter.lib * 0.0002) { er += 0.9; eg += 0.85; eb += 0.6; }
          if (ter.status === 'front' && speck > 0.992) { er += 1; eg += 0.45; eb += 0.15; }
        }
        // Foundry lava veins and the rift scar.
        for (const t of ters) {
          const d = x * t.dir.x + y * t.dir.y + z * t.dir.z;
          if (t.biome === 'foundry' && d > cosR) {
            const v = Math.abs(fbm(x * 9, y * 9, z * 9, seed + 77, 3) - 0.5);
            if (v < 0.025) { er += 0.9; eg += 0.3; eb += 0.05; }
          }
          if (t.rift && d > Math.cos((8 * Math.PI) / 180)) {
            const v = Math.abs(fbm(x * 6 + 1, y * 6, z * 6, seed + 51, 3) - 0.5);
            const k = (d - Math.cos((8 * Math.PI) / 180)) * 60;
            if (v < 0.05) { er += 1.2 * Math.min(1, k); eg += 0.25 * Math.min(1, k); eb += 0.9 * Math.min(1, k); }
          }
        }
        const q = p * 4;
        a.data[q] = Math.min(255, r * 255);
        a.data[q + 1] = Math.min(255, gg * 255);
        a.data[q + 2] = Math.min(255, b * 255);
        a.data[q + 3] = 255;
        g.data[q] = Math.min(255, er * 255);
        g.data[q + 1] = Math.min(255, eg * 255);
        g.data[q + 2] = Math.min(255, eb * 255);
        g.data[q + 3] = 255;
      }
    ac.putImageData(a, 0, 0);
    gc.putImageData(g, 0, 0);
    this.albedo.update(false);
    this.glow.update(false);
  }

  /** Rebuild territories, pins and labels from the war state and face the selected region. */
  update(war: WarState, selected: number): void {
    for (const m of this.pins) m.dispose(false, true);
    this.pins = [];
    const ks = [...war.regions.map((r) => r.k), Math.max(...war.regions.map((r) => r.k)) + 1];
    const ters: Territory[] = [];
    const seen = new Set<number>();
    for (const k of ks) {
      seen.add(k);
      const def = regionLayout(war.seed, k);
      const reg = war.regions.find((r) => r.k === k);
      const lib = reg ? regionLiberation(war, k) : 0;
      const corrupt = reg && reg.status === 'active' ? Object.values(reg.nodes).filter((n) => n.corrupt).length / Math.max(1, Object.keys(reg.nodes).length) : 0;
      const status: Status = !reg ? 'locked' : reg.status === 'liberated' ? 'liberated' : corrupt > 0.5 ? 'fallen' : 'front';
      const dir = globePoint(def.lat, def.lon, 1);
      ters.push({ dir, status, biome: def.biome, rift: !!reg && reg.status !== 'liberated', lib });
      // Diamond pin standing just off the surface.
      const pin = MeshBuilder.CreateDisc(`region${k}`, { radius: 0.06, tessellation: 4 }, this.scene);
      const mat = new StandardMaterial(`regionMat${k}`, this.scene);
      const c = STATUS[status];
      mat.emissiveColor = new Color3(c[0], c[1], c[2]);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = reg ? 1 : 0.6;
      pin.material = mat;
      const p = globePoint(def.lat, def.lon, 1.035);
      pin.position.copyFrom(p);
      pin.lookAt(p.scale(2));
      pin.metadata = { region: k, pulse: reg?.status === 'active', status };
      this.pins.push(pin);
      this.label(k, def.name, status, lib, !!reg, k === selected);
    }
    for (const [k, el] of this.labelEls) if (!seen.has(k)) { el.remove(); this.labelEls.delete(k); }
    this.paint(ters, war.seed);
    const sel = regionLayout(war.seed, selected);
    const sp = globePoint(sel.lat, sel.lon, 1.04);
    this.ring.position.copyFrom(sp);
    this.ring.lookAt(sp.scale(2));
    this.ring.rotate(new Vector3(1, 0, 0), Math.PI / 2);
    this.targetAlpha = Math.atan2(sp.z, sp.x);
    this.camera.beta = Math.PI / 2 - Math.max(-1.1, Math.min(1.1, (sel.lat * Math.PI) / 180));
  }

  private label(k: number, name: string, status: Status, lib: number, open: boolean, selected: boolean): void {
    if (!this.labels) return;
    let el = this.labelEls.get(k);
    if (!el) {
      el = document.createElement('div');
      el.addEventListener('click', () => this.onSelect?.(k));
      this.labels.appendChild(el);
      this.labelEls.set(k, el);
    }
    el.className = `gl-label s-${status}${selected ? ' on' : ''}`;
    el.dataset.region = String(k);
    const sub = !open ? 'Locked · next region' : status === 'liberated' ? 'Liberated' : status === 'fallen' ? 'Fallen · rift source' : `${Math.round(lib)}% liberated`;
    el.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = name;
    const s = document.createElement('span');
    s.textContent = sub;
    el.append(b, s);
  }

  /** Move the HTML labels next to their pins; hide the ones on the far side. */
  private placeLabels(): void {
    if (!this.labels || !this.labelEls.size) return;
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const cw = this.labels.clientWidth || w;
    const ch = this.labels.clientHeight || h;
    const vp = this.camera.viewport.toGlobal(w, h);
    const tm = this.scene.getTransformMatrix();
    const camDir = this.camera.position.normalizeToNew();
    for (const pin of this.pins) {
      const el = this.labelEls.get(pin.metadata.region as number);
      if (!el) continue;
      const front = Vector3.Dot(pin.position.normalizeToNew(), camDir);
      if (front < 0.2) { el.style.opacity = '0'; continue; }
      const s = Vector3.Project(pin.position, Matrix.IdentityReadOnly, tm, vp);
      el.style.opacity = String(Math.min(1, (front - 0.2) * 4));
      el.style.transform = `translate(${(s.x / w) * cw + 12}px, ${(s.y / h) * ch - 10}px)`;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop();
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    this.scene.dispose();
    this.engine.dispose();
  }
}
