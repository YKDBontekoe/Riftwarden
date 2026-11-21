import { ArcRotateCamera, Color3, Color4, Engine, type LinesMesh, type Mesh, MeshBuilder, PointerEventTypes, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { regionLayout } from './regions';
import { regionLiberation, type WarState } from './state';

/** Globe position of a latitude/longitude (degrees) on a sphere of radius r. */
export function globePoint(lat: number, lon: number, r = 1): Vector3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return new Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.sin(lo) * r);
}

const COL = {
  liberated: new Color3(0.35, 1, 0.85),
  active: new Color3(1, 0.55, 0.3),
  corrupt: new Color3(1, 0.2, 0.25),
  next: new Color3(0.4, 0.45, 0.5),
};

/**
 * The Rift War globe: a small hologram planet on its own canvas and engine (the terminal overlay blurs the main
 * canvas), with a lat/long grid, the rift scar, one marker per unlocked region (liberated cyan, contested
 * orange, mostly corrupted red, the next region grey) and a ring on the selected one. Drag to spin; clicking a
 * marker selects its region. Disposed with the React component.
 */
export class GlobeView {
  readonly engine: Engine;
  readonly scene: Scene;
  private camera: ArcRotateCamera;
  private markers: Mesh[] = [];
  private ring: Mesh;
  private grid: LinesMesh[] = [];
  private targetAlpha: number | null = null;
  private disposed = false;
  onSelect: ((k: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { antialias: true, preserveDrawingBuffer: true, stencil: false }, true);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.clearColor = new Color4(0, 0, 0, 0);
    const cam = new ArcRotateCamera('globeCam', 0, 1.25, 3.4, Vector3.Zero(), scene);
    cam.lowerRadiusLimit = cam.upperRadiusLimit = 3.4;
    cam.attachControl(canvas, true);
    cam.panningSensibility = 0;
    cam.wheelPrecision = 1e9;
    this.camera = cam;
    // Planet: dark core + additive rim shell.
    const core = MeshBuilder.CreateSphere('planet', { diameter: 1.96, segments: 32 }, scene);
    const cm = new StandardMaterial('planetMat', scene);
    cm.diffuseColor = new Color3(0.03, 0.06, 0.08);
    cm.emissiveColor = new Color3(0.02, 0.07, 0.09);
    cm.specularColor = new Color3(0.1, 0.2, 0.25);
    core.material = cm;
    const shell = MeshBuilder.CreateSphere('shell', { diameter: 2.04, segments: 32 }, scene);
    const sm = new StandardMaterial('shellMat', scene);
    sm.emissiveColor = new Color3(0.2, 0.55, 0.6);
    sm.alpha = 0.12;
    sm.disableLighting = true;
    shell.material = sm;
    shell.isPickable = false;
    // Lat/long grid.
    const lineCol = new Color4(0.45, 0.85, 0.8, 0.35);
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts = Array.from({ length: 73 }, (_, i) => globePoint(lat, i * 5, 1.005));
      this.grid.push(MeshBuilder.CreateLines(`lat${lat}`, { points: pts, colors: pts.map(() => lineCol) }, scene));
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const pts = Array.from({ length: 37 }, (_, i) => globePoint(-90 + i * 5, lon, 1.005));
      this.grid.push(MeshBuilder.CreateLines(`lon${lon}`, { points: pts, colors: pts.map(() => lineCol) }, scene));
    }
    this.ring = MeshBuilder.CreateTorus('selRing', { diameter: 0.34, thickness: 0.018, tessellation: 40 }, scene);
    const rm = new StandardMaterial('ringMat', scene);
    rm.emissiveColor = new Color3(1, 1, 1);
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
      t += this.engine.getDeltaTime() / 1000;
      if (this.targetAlpha !== null) {
        const d = ((this.targetAlpha - cam.alpha + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        cam.alpha += d * Math.min(1, this.engine.getDeltaTime() / 300);
        if (Math.abs(d) < 0.002) this.targetAlpha = null;
      } else cam.alpha += 0.0012;
      for (const m of this.markers) m.scaling.setAll(1 + Math.sin(t * 3 + (m.metadata.region as number)) * (m.metadata.pulse ? 0.18 : 0.04));
      this.ring.rotation.z = t;
      scene.render();
    });
  }

  /** Rebuild the markers from the war state and face the selected region. */
  update(war: WarState, selected: number): void {
    for (const m of this.markers) m.dispose(false, true);
    this.markers = [];
    const ks = [...war.regions.map((r) => r.k), Math.max(...war.regions.map((r) => r.k)) + 1];
    for (const k of ks) {
      const def = regionLayout(war.seed, k);
      const reg = war.regions.find((r) => r.k === k);
      const lib = reg ? regionLiberation(war, k) : 0;
      const corrupt = reg && reg.status === 'active' ? Object.values(reg.nodes).filter((n) => n.corrupt).length / Math.max(1, Object.keys(reg.nodes).length) : 0;
      const col = !reg ? COL.next : reg.status === 'liberated' ? COL.liberated : corrupt > 0.5 ? COL.corrupt : COL.active;
      const m = MeshBuilder.CreateDisc(`region${k}`, { radius: 0.11 + (reg ? 0.04 : 0), tessellation: 24 }, this.scene);
      const mat = new StandardMaterial(`regionMat${k}`, this.scene);
      mat.emissiveColor = col.scale(0.6 + lib / 250);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = reg ? 0.95 : 0.5;
      m.material = mat;
      const p = globePoint(def.lat, def.lon, 1.02);
      m.position.copyFrom(p);
      m.lookAt(p.scale(2));
      m.metadata = { region: k, pulse: reg?.status === 'active' };
      this.markers.push(m);
    }
    const sel = regionLayout(war.seed, selected);
    const sp = globePoint(sel.lat, sel.lon, 1.03);
    this.ring.position.copyFrom(sp);
    this.ring.lookAt(sp.scale(2));
    this.ring.rotate(new Vector3(1, 0, 0), Math.PI / 2);
    // Face the selected region: ArcRotate alpha is measured from +x around y.
    this.targetAlpha = Math.atan2(sp.z, sp.x);
    this.camera.beta = Math.PI / 2 - Math.max(-0.9, Math.min(0.9, (sel.lat * Math.PI) / 180)) * 0.7;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
