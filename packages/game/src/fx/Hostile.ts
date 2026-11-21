import { type PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { type Scene } from '@babylonjs/core/scene';
import { unlit } from '../visuals/materials';

export type TeleColor = 'red' | 'orange' | 'blue' | 'violet' | 'green' | 'white';

const COLORS: Record<TeleColor, [number, number, number]> = {
  red: [2.8, 0.25, 0.12],
  orange: [2.9, 0.9, 0.12],
  blue: [0.45, 1.3, 3.4],
  violet: [1.8, 0.45, 3.2],
  green: [0.3, 2.6, 1.2],
  white: [2.6, 2.6, 2.8],
};

interface Marker {
  ring: Mesh;
  fill: Mesh;
  t: number;
  dur: number;
  r: number;
  color: TeleColor;
  id: number;
  follow: (() => Vector3 | null) | null;
}

interface Line {
  mesh: Mesh;
  t: number;
  dur: number;
  id: number;
}

/**
 * Attack telegraphs (presentation only, but never skipped: they are gameplay information).
 * Ground marker = a ring at the blast radius + a fill disc that grows to meet it at impact time.
 * Lines = laser sights from a weapon to its target. Pools grow on demand (bounded) per colour.
 */
export class Telegraphs {
  private markers: Marker[] = [];
  private lines: Line[] = [];
  private ringMats = new Map<TeleColor, PBRMaterial>();
  private fillMats = new Map<TeleColor, PBRMaterial>();
  private lineMats = new Map<TeleColor, PBRMaterial>();
  private ringT: Mesh;
  private fillT: Mesh;
  private lineT: Mesh;
  private nextId = 1;
  static readonly MAX = 64;

  constructor(scene: Scene) {
    this.ringT = MeshBuilder.CreateTorus('teleRing', { diameter: 2, thickness: 0.07, tessellation: 48 }, scene);
    this.fillT = MeshBuilder.CreateDisc('teleFill', { radius: 1, tessellation: 40 }, scene);
    this.fillT.rotation.x = Math.PI / 2;
    this.fillT.bakeCurrentTransformIntoVertices();
    this.lineT = MeshBuilder.CreateBox('teleLine', { width: 1, height: 1, depth: 1 }, scene);
    for (const t of [this.ringT, this.fillT, this.lineT]) {
      t.isPickable = false;
      t.setEnabled(false);
    }
    for (const c of Object.keys(COLORS) as TeleColor[]) {
      const [r, g, b] = COLORS[c];
      this.ringMats.set(c, unlit(scene, `teleRing:${c}`, [r, g, b], { additive: true }));
      this.fillMats.set(c, unlit(scene, `teleFill:${c}`, [r * 0.16, g * 0.16, b * 0.16], { additive: true, zOffset: -3 }));
      this.lineMats.set(c, unlit(scene, `teleLine:${c}`, [r * 0.8, g * 0.8, b * 0.8], { additive: true }));
    }
  }

  /** Compile every telegraph shader up front (first boss attack must not hitch or appear late). */
  warm(): Promise<unknown> {
    const jobs: Promise<unknown>[] = [];
    for (const m of this.ringMats.values()) jobs.push(m.forceCompilationAsync(this.ringT).catch(() => {}));
    for (const m of this.fillMats.values()) jobs.push(m.forceCompilationAsync(this.fillT).catch(() => {}));
    for (const m of this.lineMats.values()) jobs.push(m.forceCompilationAsync(this.lineT).catch(() => {}));
    return Promise.all(jobs);
  }

  get active(): number {
    let n = 0;
    for (const m of this.markers) if (m.t < m.dur) n++;
    for (const l of this.lines) if (l.t < l.dur) n++;
    return n;
  }

  /** Ground marker at `pos` (y is projected to `pos.y + 0.06`). `follow` keeps it on a moving target. */
  marker(pos: Vector3, radius: number, duration: number, color: TeleColor, follow: (() => Vector3 | null) | null = null): number {
    let m = this.markers.find((x) => x.t >= x.dur && x.color === color);
    if (!m) {
      if (this.markers.length >= Telegraphs.MAX) m = this.markers.reduce((a, b) => (a.dur - a.t < b.dur - b.t ? a : b));
      else {
        const ring = this.ringT.clone('teleRingI')!;
        const fill = this.fillT.clone('teleFillI')!;
        ring.material = this.ringMats.get(color)!;
        fill.material = this.fillMats.get(color)!;
        m = { ring, fill, t: 0, dur: 0, r: 1, color, id: 0, follow: null };
        this.markers.push(m);
      }
      m.ring.material = this.ringMats.get(color)!;
      m.fill.material = this.fillMats.get(color)!;
      m.color = color;
    }
    m.t = 0;
    m.dur = Math.max(0.05, duration);
    m.r = radius;
    m.id = this.nextId++;
    m.follow = follow;
    m.ring.position.set(pos.x, pos.y + 0.07, pos.z);
    m.fill.position.set(pos.x, pos.y + 0.06, pos.z);
    m.ring.setEnabled(true);
    m.fill.setEnabled(true);
    this.layoutMarker(m);
    return m.id;
  }

  /** Laser sight between two points for `duration` seconds. */
  line(from: Vector3, to: Vector3, duration: number, color: TeleColor, width = 0.05): number {
    let l = this.lines.find((x) => x.t >= x.dur);
    if (!l) {
      if (this.lines.length >= Telegraphs.MAX) l = this.lines[0];
      else {
        l = { mesh: this.lineT.clone('teleLineI')!, t: 0, dur: 0, id: 0 };
        this.lines.push(l);
      }
    }
    l.mesh.material = this.lineMats.get(color)!;
    l.t = 0;
    l.dur = duration;
    l.id = this.nextId++;
    this.place(l.mesh, from, to, width);
    l.mesh.setEnabled(true);
    return l.id;
  }

  /** Update a live line's endpoints (tracking sights). */
  moveLine(id: number, from: Vector3, to: Vector3, width = 0.05): void {
    const l = this.lines.find((x) => x.id === id && x.t < x.dur);
    if (l) this.place(l.mesh, from, to, width);
  }

  /** M7: live markers that follow a target ([id, x, y, z]) for replication. */
  followed(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const m of this.markers) if (m.t < m.dur && m.follow) out.push([m.id, m.ring.position.x, m.ring.position.y - 0.07, m.ring.position.z]);
    return out;
  }

  /** M7: move a live marker (replicas follow the server's target). */
  moveMarker(id: number, x: number, y: number, z: number): void {
    const m = this.markers.find((q) => q.id === id && q.t < q.dur);
    if (!m) return;
    m.ring.position.set(x, y + 0.07, z);
    m.fill.position.set(x, y + 0.06, z);
  }

  cancel(id: number): void {
    for (const m of this.markers) if (m.id === id) m.t = m.dur;
    for (const l of this.lines) if (l.id === id) l.t = l.dur;
  }

  private place(mesh: Mesh, a: Vector3, b: Vector3, w: number): void {
    const d = b.subtract(a);
    const len = d.length() || 0.01;
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.scaling.set(w, w, len);
    mesh.rotation.set(-Math.asin(Math.max(-1, Math.min(1, d.y / len))), Math.atan2(d.x, d.z), 0);
  }

  private layoutMarker(m: Marker): void {
    const f = Math.min(1, m.t / m.dur);
    m.ring.scaling.set(m.r, 1, m.r);
    const fill = Math.max(0.02, f);
    m.fill.scaling.set(m.r * fill, 1, m.r * fill);
  }

  update(dt: number): void {
    for (const m of this.markers) {
      if (m.t >= m.dur) continue;
      m.t += dt;
      if (m.follow) {
        const p = m.follow();
        if (p) {
          m.ring.position.set(p.x, p.y + 0.07, p.z);
          m.fill.position.set(p.x, p.y + 0.06, p.z);
        }
      }
      if (m.t >= m.dur) {
        m.ring.setEnabled(false);
        m.fill.setEnabled(false);
      } else this.layoutMarker(m);
    }
    for (const l of this.lines) {
      if (l.t >= l.dur) continue;
      l.t += dt;
      if (l.t >= l.dur) l.mesh.setEnabled(false);
    }
  }

  reset(): void {
    for (const m of this.markers) {
      m.t = m.dur;
      m.ring.setEnabled(false);
      m.fill.setEnabled(false);
    }
    for (const l of this.lines) {
      l.t = l.dur;
      l.mesh.setEnabled(false);
    }
  }
}

// ------------------------------------------------------------------ ordnance

export type OrdnanceKind = 'shell' | 'orb' | 'missile' | 'bomb';

export interface Impact {
  kind: OrdnanceKind;
  pos: Vector3;
  radius: number;
  damage: number;
  /** Reactor damage (shells aimed at the reactor). */
  reactorDamage: number;
  /** Seconds towers inside the radius stay offline. */
  disable: number;
  /** Direct hit on the player (orbs/missiles): no area. */
  direct: boolean;
  owner: number;
}

interface Round {
  kind: OrdnanceKind;
  mesh: Mesh;
  active: boolean;
  pos: Vector3;
  vel: Vector3;
  from: Vector3;
  to: Vector3;
  t: number;
  dur: number;
  arc: number;
  life: number;
  impact: Omit<Impact, 'pos' | 'kind' | 'direct'>;
  marker: number;
  turn: number;
  id: number;
}

export interface OrdnanceCtx {
  /** Chest position of the drone this round targets (null when none is alive). `at` = round position. */
  player(at?: Vector3): Vector3 | null;
  /** Static geometry hit between a and b (null = clear). */
  ray(a: Vector3, b: Vector3): Vector3 | null;
  impact(i: Impact): void;
  trail(kind: OrdnanceKind, pos: Vector3): void;
}

const TMP = new Vector3();

/**
 * Hostile ordnance with readable flight: shells are lobbed on a fixed-duration arc to a ground point that is
 * marked from launch to impact; orbs fly straight and slow; missiles home weakly (outrun them / break line of
 * sight). Pooled per kind (cap 48 each). Integrated with hostile time, so tactical mode slows them.
 */
export class Ordnance {
  private rounds: Round[] = [];
  private mats: Record<OrdnanceKind, PBRMaterial>;
  private templates: Record<OrdnanceKind, Mesh>;
  static readonly CAP = 48;
  fired = 0;
  /** Id of the most recently launched round (replication). */
  lastId = 0;
  private nextRound = 1;

  constructor(scene: Scene, private tele: Telegraphs) {
    this.mats = {
      shell: unlit(scene, 'ordShell', [3.2, 1.0, 0.18]),
      orb: unlit(scene, 'ordOrb', [1.6, 0.6, 3.4]),
      missile: unlit(scene, 'ordMissile', [3.4, 1.6, 0.4]),
      bomb: unlit(scene, 'ordBomb', [3.4, 0.4, 0.2]),
    };
    this.templates = {
      shell: MeshBuilder.CreateSphere('ordShellT', { diameter: 0.7, segments: 8 }, scene),
      orb: MeshBuilder.CreateIcoSphere('ordOrbT', { radius: 0.42, subdivisions: 2 }, scene),
      missile: MeshBuilder.CreateCylinder('ordMissileT', { diameterTop: 0.05, diameterBottom: 0.28, height: 1.1, tessellation: 8 }, scene),
      bomb: MeshBuilder.CreateSphere('ordBombT', { diameter: 1.4, segments: 10 }, scene),
    };
    for (const k of Object.keys(this.templates) as OrdnanceKind[]) {
      const t = this.templates[k];
      t.material = this.mats[k];
      t.isPickable = false;
      t.setEnabled(false);
    }
  }

  get live(): number {
    let n = 0;
    for (const r of this.rounds) if (r.active) n++;
    return n;
  }

  warm(): Promise<unknown> {
    return Promise.all((Object.keys(this.templates) as OrdnanceKind[]).map((k) => this.mats[k].forceCompilationAsync(this.templates[k]).catch(() => {})));
  }

  private take(kind: OrdnanceKind): Round | null {
    let r = this.rounds.find((x) => !x.active && x.kind === kind);
    if (!r) {
      if (this.rounds.filter((x) => x.kind === kind).length >= Ordnance.CAP) return null;
      const mesh = this.templates[kind].clone(`ord_${kind}`)!;
      r = { kind, mesh, active: false, pos: new Vector3(), vel: new Vector3(), from: new Vector3(), to: new Vector3(), t: 0, dur: 1, arc: 0, life: 0, impact: { radius: 0, damage: 0, reactorDamage: 0, disable: 0, owner: 0 }, marker: 0, turn: 0, id: 0 };
      this.rounds.push(r);
    }
    r.active = true;
    r.mesh.setEnabled(true);
    r.id = this.lastId = this.nextRound++;
    this.fired++;
    return r;
  }

  /** Lobbed shell to a ground point, landing after `dur` seconds; marked on the ground the whole flight. */
  lob(from: Vector3, to: Vector3, dur: number, impact: Omit<Impact, 'pos' | 'kind' | 'direct'>, color: TeleColor = 'red', kind: OrdnanceKind = 'shell'): boolean {
    const r = this.take(kind);
    if (!r) return false;
    r.from.copyFrom(from);
    r.to.copyFrom(to);
    r.pos.copyFrom(from);
    r.t = 0;
    r.dur = dur;
    r.arc = Math.max(6, Vector3.Distance(from, to) * 0.45);
    r.impact = { ...impact };
    r.marker = this.tele.marker(to, impact.radius, dur, color);
    r.mesh.position.copyFrom(from);
    return true;
  }

  /** Straight orb at `speed` toward `to` (keeps going past it). */
  orb(from: Vector3, to: Vector3, speed: number, damage: number, owner: number): boolean {
    const r = this.take('orb');
    if (!r) return false;
    r.pos.copyFrom(from);
    r.vel.copyFrom(to).subtractInPlace(from).normalize().scaleInPlace(speed);
    r.life = 5;
    r.impact = { radius: 0.9, damage, reactorDamage: 0, disable: 0, owner };
    r.mesh.position.copyFrom(from);
    return true;
  }

  /** Weakly homing missile (turn rate rad/s). */
  missile(from: Vector3, dir: Vector3, speed: number, turn: number, damage: number, radius: number, owner: number): boolean {
    const r = this.take('missile');
    if (!r) return false;
    r.pos.copyFrom(from);
    r.vel.copyFrom(dir).normalize().scaleInPlace(speed);
    r.life = 5.5;
    r.turn = turn;
    r.impact = { radius, damage, reactorDamage: 0, disable: 0, owner };
    r.mesh.position.copyFrom(from);
    return true;
  }

  private finish(r: Round, ctx: OrdnanceCtx, at: Vector3, direct: boolean): void {
    r.active = false;
    r.mesh.setEnabled(false);
    this.tele.cancel(r.marker);
    ctx.impact({ ...r.impact, kind: r.kind, pos: at.clone(), direct });
  }

  update(hdt: number, ctx: OrdnanceCtx, rt: number): void {
    if (hdt <= 0) return;
    for (const r of this.rounds) {
      if (!r.active) continue;
      const pl = r.kind === 'missile' || r.kind === 'orb' ? ctx.player(r.pos) : null;
      if (r.kind === 'shell' || r.kind === 'bomb') {
        r.t += hdt;
        const f = Math.min(1, r.t / r.dur);
        Vector3.LerpToRef(r.from, r.to, f, r.pos);
        r.pos.y += Math.sin(f * Math.PI) * r.arc;
        r.mesh.position.copyFrom(r.pos);
        r.mesh.scaling.setAll(1 + 0.15 * Math.sin(rt * 30));
        if (Math.random() < 0.5) ctx.trail(r.kind, r.pos);
        if (f >= 1) this.finish(r, ctx, r.to, false);
        continue;
      }
      if (r.kind === 'missile' && pl) {
        // Steer the velocity toward the player by at most `turn` rad/s.
        const speed = r.vel.length();
        const want = TMP.copyFrom(pl).subtractInPlace(r.pos).normalize();
        const cur = r.vel.scale(1 / speed);
        const dot = Math.max(-1, Math.min(1, Vector3.Dot(cur, want)));
        const ang = Math.acos(dot);
        const k = ang > 1e-4 ? Math.min(1, (r.turn * hdt) / ang) : 0;
        Vector3.LerpToRef(cur, want, k, cur);
        r.vel.copyFrom(cur.normalize().scaleInPlace(speed));
        r.mesh.lookAt(r.pos.add(r.vel));
        r.mesh.rotation.x += Math.PI / 2;
      }
      const next = TMP.copyFrom(r.vel).scaleInPlace(hdt).addInPlace(r.pos);
      if (pl && segSphere(r.pos, next, pl, r.kind === 'orb' ? 0.95 : 0.8)) {
        this.finish(r, ctx, pl, true);
        continue;
      }
      const hit = ctx.ray(r.pos, next);
      if (hit) {
        this.finish(r, ctx, hit, false);
        continue;
      }
      r.pos.copyFrom(next);
      r.mesh.position.copyFrom(next);
      if (r.kind === 'orb') r.mesh.rotation.y += hdt * 6;
      if (Math.random() < 0.35) ctx.trail(r.kind, r.pos);
      r.life -= hdt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.setEnabled(false);
      }
    }
  }

  /** M7: free-flying rounds ([id, x, y, z]) for replication. */
  positions(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const r of this.rounds) if (r.active && (r.kind === 'orb' || r.kind === 'missile')) out.push([r.id, r.pos.x, r.pos.y, r.pos.z]);
    return out;
  }

  /** M7: replicas correct a round's position (or drop it when the server no longer has it). */
  correct(id: number, x: number, y: number, z: number): void {
    const r = this.rounds.find((q) => q.active && q.id === id);
    if (!r) return;
    r.pos.set(x, y, z);
    r.mesh.position.copyFrom(r.pos);
  }

  drop(id: number): void {
    const r = this.rounds.find((q) => q.active && q.id === id);
    if (!r) return;
    r.active = false;
    r.mesh.setEnabled(false);
    this.tele.cancel(r.marker);
  }

  activeIds(): number[] {
    return this.rounds.filter((r) => r.active && (r.kind === 'orb' || r.kind === 'missile')).map((r) => r.id);
  }

  reset(): void {
    for (const r of this.rounds) {
      r.active = false;
      r.mesh.setEnabled(false);
    }
  }
}

function segSphere(a: Vector3, b: Vector3, c: Vector3, rad: number): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - c.x;
  const dy = a.y + aby * t - c.y;
  const dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz < rad * rad;
}

export const TELE_COLOR = COLORS;
export const C3 = (c: TeleColor) => new Color3(...COLORS[c]);
