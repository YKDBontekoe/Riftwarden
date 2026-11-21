import {
  Color3,
  Constants,
  DynamicTexture,
  type InstancedMesh,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Quaternion,
  type Scene,
  Texture,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import type { WeaponFamily } from '@riftwarden/rules/data/defs';
import { starSprite } from '../visuals/textures';

/**
 * World-space weapon effects, pooled and capped. Gameplay (damage) is resolved before
 * any of these run; they only visualise it:
 *  - plasma: travelling bolts (crossed soft quads, hot core + coloured glow) whose impact
 *    effect fires on arrival,
 *  - rail: an instant hypersonic trail (white core, coloured sheath that widens and fades)
 *    with a ring of sparks along the path,
 *  - beam: one persistent flickering beam with an endpoint flare and contact light,
 *  - arcs: jagged lightning segments for the Arc Conductor.
 */
const TMP = new Vector3();
const TMP2 = new Vector3();

/** Two perpendicular quads spanning z in [-0.5, 0.5]: a cheap volumetric-looking streak. */
function streakData(): VertexData {
  const p: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const quad = (ax: [number, number, number]) => {
    const b = p.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const w = v - 0.5;
      p.push(ax[0] * w, ax[1] * w, u - 0.5);
      uv.push(u, v);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad([1, 0, 0]);
  quad([0, 1, 0]);
  const vd = new VertexData();
  vd.positions = p;
  vd.indices = idx;
  vd.uvs = uv;
  const n: number[] = [];
  VertexData.ComputeNormals(p, idx, n);
  vd.normals = n;
  return vd;
}

/** Soft line texture: gaussian across v, tapered ends along u. */
function streakTexture(scene: Scene): DynamicTexture {
  const W = 128;
  const H = 32;
  const t = new DynamicTexture('streakTex', { width: W, height: H }, scene, true, Texture.BILINEAR_SAMPLINGMODE);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1) - 0.5;
      const across = Math.exp(-(v * v) / (2 * 0.12 * 0.12)) + 0.6 * Math.exp(-(v * v) / (2 * 0.03 * 0.03));
      const ends = Math.min(1, u / 0.12, (1 - u) / 0.12);
      const a = Math.max(0, Math.min(1, across * Math.max(0, ends)));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = a * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  t.update(false);
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

function additive(scene: Scene, name: string, c: Color3, tex: DynamicTexture): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.unlit = true;
  m.albedoColor = Color3.Black();
  m.metallic = 0;
  m.roughness = 1;
  m.metallicF0Factor = 0;
  m.emissiveColor = c.clone();
  m.emissiveTexture = tex;
  m.alphaMode = Constants.ALPHA_ADD;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.disableDepthWrite = true;
  m.backFaceCulling = false;
  return m;
}

interface Bolt {
  glow: Mesh;
  core: Mesh;
  pos: Vector3;
  dir: Vector3;
  left: number;
  travelled: number;
  width: number;
  speed: number;
  active: boolean;
  arrive: (() => void) | null;
  /** Swarm seeker: quadratic curve start / control / end and progress (0..1) over `dur` seconds. */
  curve: boolean;
  a: Vector3;
  c: Vector3;
  b: Vector3;
  u: number;
  dur: number;
}

interface Trail {
  core: Mesh;
  glow: Mesh;
  coreMat: PBRMaterial;
  glowMat: PBRMaterial;
  life: number;
  max: number;
  width: number;
}

interface Arc {
  mesh: Mesh;
  life: number;
}

export class WeaponFx {
  private bolts: Bolt[] = [];
  private trails: Trail[] = [];
  private trailNext = 0;
  private arcs: Arc[] = [];
  private arcNext = 0;
  private boltMat: PBRMaterial;
  private boltCoreMat: PBRMaterial;
  private arcMat: PBRMaterial;
  private beamCore: Mesh;
  private beamGlow: Mesh;
  private beamCoreMat: PBRMaterial;
  private beamGlowMat: PBRMaterial;
  private beamFlare: Mesh;
  private beamFlareMat: PBRMaterial;
  private beamLight: PointLight;
  private t = 0;
  private color = new Color3(0.3, 1.7, 2.6);

  constructor(scene: Scene) {
    const tex = streakTexture(scene);
    const vd = streakData();
    const mk = (name: string, mat: PBRMaterial) => {
      const m = new Mesh(name, scene);
      vd.applyToMesh(m);
      m.material = mat;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      return m;
    };
    this.boltMat = additive(scene, 'boltGlow', this.color, tex);
    this.boltCoreMat = additive(scene, 'boltCore', new Color3(3, 3.4, 3.6), tex);
    const glowSrc = mk('boltGlowSrc', this.boltMat);
    const coreSrc = mk('boltCoreSrc', this.boltCoreMat);
    glowSrc.isVisible = coreSrc.isVisible = false;
    for (let i = 0; i < 48; i++) {
      const glow = glowSrc.clone('bolt');
      const core = coreSrc.clone('boltCore');
      glow.isVisible = core.isVisible = true;
      glow.isPickable = core.isPickable = false;
      glow.setEnabled(false);
      core.setEnabled(false);
      this.bolts.push({ glow, core, pos: new Vector3(), dir: new Vector3(), left: 0, travelled: 0, width: 0.3, speed: 0, active: false, arrive: null, curve: false, a: new Vector3(), c: new Vector3(), b: new Vector3(), u: 0, dur: 1 });
    }
    for (let i = 0; i < 5; i++) {
      const coreMat = additive(scene, 'railCore', new Color3(), tex);
      const glowMat = additive(scene, 'railGlow', new Color3(), tex);
      const core = mk('railCore', coreMat);
      const glow = mk('railGlow', glowMat);
      core.setEnabled(false);
      glow.setEnabled(false);
      this.trails.push({ core, glow, coreMat, glowMat, life: 0, max: 1, width: 0.1 });
    }
    this.arcMat = additive(scene, 'arcMat', new Color3(1.6, 2.4, 4.5), tex);
    const arcSrc = mk('arcSrc', this.arcMat);
    arcSrc.isVisible = false;
    for (let i = 0; i < 90; i++) {
      const m = arcSrc.clone('arc');
      m.isVisible = true;
      m.isPickable = false;
      m.setEnabled(false);
      this.arcs.push({ mesh: m, life: 0 });
    }
    this.beamCoreMat = additive(scene, 'beamCore', new Color3(), tex);
    this.beamGlowMat = additive(scene, 'beamGlow', new Color3(), tex);
    this.beamCore = mk('beamCore', this.beamCoreMat);
    this.beamGlow = mk('beamGlow', this.beamGlowMat);
    const star = starSprite(scene);
    this.beamFlareMat = additive(scene, 'beamFlare', new Color3(), star as DynamicTexture);
    this.beamFlareMat.opacityTexture = null;
    this.beamFlare = MeshBuilder.CreatePlane('beamFlare', { size: 1 }, scene);
    this.beamFlare.material = this.beamFlareMat;
    this.beamFlare.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.beamFlare.isPickable = false;
    this.beamLight = new PointLight('beamLight', Vector3.Zero(), scene);
    this.beamLight.range = 9;
    this.beamLight.intensity = 0;
    for (const m of [this.beamCore, this.beamGlow, this.beamFlare]) m.setEnabled(false);
  }

  /** Tint everything for the equipped weapon's energy colour. */
  setColor(c: Color3): void {
    this.color.copyFrom(c);
    this.boltMat.emissiveColor.copyFrom(c).scaleInPlace(1.2);
    this.boltCoreMat.emissiveColor.set(2.2 + c.r * 0.4, 2.4 + c.g * 0.3, 2.6 + c.b * 0.3);
    this.beamLight.diffuse.copyFrom(c).scaleInPlace(0.5);
  }

  /** Camera position for ribbon facing (set every update). */
  eye = new Vector3();
  private readonly ax = new Vector3();
  private readonly ay = new Vector3();
  private readonly az = new Vector3();

  /** Stretch a streak from `from` to `to`, rotated about its axis to face the camera. */
  private orient(m: Mesh | InstancedMesh, from: Vector3, to: Vector3, width: number): number {
    const len = Vector3.Distance(from, to);
    Vector3.LerpToRef(from, to, 0.5, m.position);
    if (len > 1e-4) {
      this.face(m, TMP.copyFrom(to).subtractInPlace(from).scaleInPlace(1 / len));
    }
    m.scaling.set(width, width, Math.max(0.001, len));
    return len;
  }

  private face(m: Mesh | InstancedMesh, dir: Vector3): void {
    const z = this.az.copyFrom(dir);
    const y = this.ay.copyFrom(this.eye).subtractInPlace(m.position);
    y.subtractInPlace(TMP2.copyFrom(z).scaleInPlace(Vector3.Dot(y, z)));
    if (y.lengthSquared() < 1e-8) y.set(0, 1, 0);
    y.normalize();
    Vector3.CrossToRef(y, z, this.ax);
    if (!m.rotationQuaternion) m.rotationQuaternion = new Quaternion();
    Quaternion.RotationQuaternionFromAxisToRef(this.ax, y, z, m.rotationQuaternion);
  }

  /** Plasma bolt from the muzzle to the hit point; `arrive` runs when it gets there. */
  bolt(from: Vector3, to: Vector3, speed: number, width: number, arrive: (() => void) | null): void {
    const b = this.bolts.find((x) => !x.active) ?? this.bolts[0];
    if (b.active && b.arrive) b.arrive();
    const d = TMP.copyFrom(to).subtractInPlace(from);
    const dist = d.length();
    if (dist < 0.05) {
      arrive?.();
      return;
    }
    b.dir.copyFrom(d).scaleInPlace(1 / dist);
    b.pos.copyFrom(from);
    b.left = dist;
    b.travelled = 0.3;
    b.width = width;
    b.speed = speed;
    b.active = true;
    b.arrive = arrive;
    b.curve = false;
    b.glow.setEnabled(true);
    b.core.setEnabled(true);
    this.placeBolt(b, width);
  }

  /**
   * Swarm seeker drone: flies a curved path (kicked out sideways / up from the pod, then homing in) from the muzzle
   * to the struck point; `arrive` runs on contact. Damage was already resolved at launch.
   */
  seeker(from: Vector3, to: Vector3, speed: number, arrive: (() => void) | null): void {
    const b = this.bolts.find((x) => !x.active) ?? this.bolts[0];
    if (b.active && b.arrive) b.arrive();
    const d = TMP.copyFrom(to).subtractInPlace(from);
    const dist = d.length();
    if (dist < 0.05) {
      arrive?.();
      return;
    }
    // Control point: a third of the way out, thrown sideways and up by up to 35% of the distance.
    const side = TMP2.set(-d.z, 0, d.x).normalize().scaleInPlace((Math.random() - 0.5) * 0.7 * Math.min(dist, 30));
    b.a.copyFrom(from);
    b.b.copyFrom(to);
    b.c.copyFrom(from).addInPlace(d.scaleInPlace(0.35)).addInPlace(side).addInPlaceFromFloats(0, (0.15 + Math.random() * 0.25) * Math.min(dist, 30), 0);
    b.u = 0;
    b.dur = Math.max(0.12, (dist * 1.15) / Math.max(1, speed));
    b.pos.copyFrom(from);
    b.dir.copyFrom(b.c).subtractInPlace(from).normalize();
    b.travelled = 0.3;
    b.width = 0.16;
    b.speed = speed;
    b.left = dist;
    b.curve = true;
    b.active = true;
    b.arrive = arrive;
    b.glow.setEnabled(true);
    b.core.setEnabled(true);
    this.placeBolt(b);
  }

  /** Advance a seeker along its curve; true when it arrived. */
  private stepSeeker(b: Bolt, dt: number): boolean {
    b.u = Math.min(1, b.u + dt / b.dur);
    const u = b.u;
    const k = 1 - u;
    const x = k * k * b.a.x + 2 * k * u * b.c.x + u * u * b.b.x;
    const y = k * k * b.a.y + 2 * k * u * b.c.y + u * u * b.b.y;
    const z = k * k * b.a.z + 2 * k * u * b.c.z + u * u * b.b.z;
    b.dir.set(x - b.pos.x, y - b.pos.y, z - b.pos.z);
    const step = b.dir.length();
    if (step > 1e-5) b.dir.scaleInPlace(1 / step);
    b.pos.set(x, y, z);
    b.travelled = Math.min(1.4, b.travelled + step);
    return u >= 1;
  }

  private placeBolt(b: Bolt, width = b.width): void {
    // Head at the bolt position; the tail stretches back toward the muzzle (max 4.5 m),
    // so shots read as lines from the barrel even when flying straight away.
    const len = Math.max(0.3, Math.min(4.5, b.travelled));
    const mid = TMP2.copyFrom(b.dir).scaleInPlace(-len * 0.5).addInPlace(b.pos);
    b.glow.position.copyFrom(mid);
    b.core.position.copyFrom(mid);
    this.face(b.glow, b.dir);
    this.face(b.core, b.dir);
    b.glow.scaling.set(width, width, len);
    b.core.scaling.set(width * 0.4, width * 0.4, len * 0.9);
  }

  /** Railgun discharge: instant trail with a hot core and a coloured sheath. */
  rail(from: Vector3, to: Vector3, power: number): void {
    const tr = this.trails[this.trailNext];
    this.trailNext = (this.trailNext + 1) % this.trails.length;
    tr.life = tr.max = 0.45 + 0.25 * power;
    tr.width = 0.07 + 0.08 * power;
    tr.core.setEnabled(true);
    tr.glow.setEnabled(true);
    this.orient(tr.core, from, to, tr.width * 0.35);
    this.orient(tr.glow, from, to, tr.width * 2.2);
    this.fadeTrail(tr);
  }

  private fadeTrail(tr: Trail): void {
    const f = Math.max(0, tr.life / tr.max);
    const c = this.color;
    tr.coreMat.emissiveColor.set(3.2 * f * f, 3.4 * f * f, 3.8 * f * f);
    tr.glowMat.emissiveColor.set(c.r * f * 0.7, c.g * f * 0.7, c.b * f * 0.7);
    const grow = 1 + (1 - f) * 2.5;
    tr.glow.scaling.x = tr.glow.scaling.y = tr.width * 2.2 * grow;
    tr.core.scaling.x = tr.core.scaling.y = tr.width * 0.35 * f;
  }

  /** Continuous beam state for this frame (called every frame while the weapon updates). */
  beam(on: boolean, from: Vector3, to: Vector3, intensity: number, contact: boolean): void {
    for (const m of [this.beamCore, this.beamGlow]) m.setEnabled(on);
    this.beamFlare.setEnabled(on && contact);
    if (!on) {
      this.beamLight.intensity = 0;
      return;
    }
    const k = Math.max(0.3, Math.min(2.5, intensity));
    const flick = 0.85 + 0.15 * Math.sin(this.t * 71) + 0.08 * Math.sin(this.t * 133);
    this.orient(this.beamCore, from, to, 0.07 * flick * (0.8 + 0.2 * k));
    this.orient(this.beamGlow, from, to, (0.3 + 0.08 * k) * flick);
    const c = this.color;
    this.beamCoreMat.emissiveColor.set(2.4 + c.r * 0.5 * k, 2.6 + c.g * 0.4 * k, 2.4 + c.b * 0.4 * k);
    this.beamGlowMat.emissiveColor.set(c.r * 0.9 * k, c.g * 0.9 * k, c.b * 0.9 * k);
    if (contact) {
      this.beamFlare.position.copyFrom(to);
      this.beamFlare.scaling.setAll((0.45 + 0.25 * k) * flick);
      this.beamFlare.rotation.z = this.t * 7;
      this.beamFlareMat.emissiveColor.set(c.r * k, c.g * k, c.b * k);
      this.beamLight.position.copyFrom(to);
      this.beamLight.intensity = 1.6 * k * flick;
    } else this.beamLight.intensity = 0;
  }

  /** Jagged lightning between two points (Arc Conductor). */
  arc(from: Vector3, to: Vector3): void {
    const segs = 6;
    let prev = from.clone();
    const span = Vector3.Distance(from, to);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const p = Vector3.Lerp(from, to, t);
      if (i < segs) p.addInPlaceFromFloats((Math.random() - 0.5) * span * 0.15, (Math.random() - 0.5) * span * 0.15, (Math.random() - 0.5) * span * 0.15);
      const a = this.arcs[this.arcNext];
      this.arcNext = (this.arcNext + 1) % this.arcs.length;
      a.mesh.setEnabled(true);
      this.orient(a.mesh, prev, p, 0.09);
      a.life = 0.16 + Math.random() * 0.06;
      prev = p;
    }
  }

  update(dt: number, eye?: Vector3): void {
    this.t += dt;
    if (eye) this.eye.copyFrom(eye);
    for (const b of this.bolts) {
      if (!b.active) continue;
      let done: boolean;
      if (b.curve) done = this.stepSeeker(b, dt);
      else {
        const step = b.speed * dt;
        b.left -= step;
        b.travelled += step;
        b.pos.addInPlace(TMP.copyFrom(b.dir).scaleInPlace(step));
        done = b.left <= 0;
      }
      if (done) {
        b.active = false;
        b.glow.setEnabled(false);
        b.core.setEnabled(false);
        const fn = b.arrive;
        b.arrive = null;
        fn?.();
        continue;
      }
      this.placeBolt(b);
    }
    for (const tr of this.trails) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.core.setEnabled(false);
        tr.glow.setEnabled(false);
        continue;
      }
      this.fadeTrail(tr);
    }
    for (const a of this.arcs) {
      if (a.life <= 0) continue;
      a.life -= dt;
      if (a.life <= 0) a.mesh.setEnabled(false);
    }
  }

  get liveBolts(): number {
    return this.bolts.filter((b) => b.active).length;
  }

  reset(): void {
    for (const b of this.bolts) {
      b.active = false;
      b.arrive = null;
      b.glow.setEnabled(false);
      b.core.setEnabled(false);
    }
    for (const tr of this.trails) {
      tr.life = 0;
      tr.core.setEnabled(false);
      tr.glow.setEnabled(false);
    }
    for (const a of this.arcs) {
      a.life = 0;
      a.mesh.setEnabled(false);
    }
    this.beam(false, Vector3.ZeroReadOnly, Vector3.ZeroReadOnly, 0, false);
  }

  /** Family for future per-family tweaks (kept for symmetry with the viewmodel). */
  family: WeaponFamily = 'plasma';
}
