import { Color3, type Material, MeshBuilder, PhysicsBody, PhysicsMotionType, PhysicsShapeBox, PhysicsShapeContainer, PointLight, Quaternion, type Scene, type TransformNode, Vector3 } from '@babylonjs/core';
import { type Emitter, sfx } from '../../audio/Sfx';
import type { Kit } from '../../visuals/kit';
import { unlit } from '../../visuals/materials';
import { PHYS_ENV } from '../../world/physicsGroups';
import type { SaveData } from '../../progression/save';
import type { Placeable } from '../placeables';
import { type Animator, buildPlaceable, type PropCtx } from '../props';
import { LIGHT_COLORS, LIMITS, pieceDef } from './catalog';
import { CELL, cellKey, cellMin, edgeCells, edgeSegment, GATEWAYS, parseCell, type Structure, WALL_H } from './model';

interface Built {
  root: TransformNode;
  body: PhysicsBody | null;
  sig: string;
  light?: PointLight | null;
  /** Positional hum of working machines (server racks, machinery, reactor models). */
  hum?: Emitter | null;
  /** Where the hum comes from, kept so it can be started once audio is unlocked. */
  humAt?: { kind: HumKind; x: number; y: number; z: number; gain: number };
}

type HumKind = 'hum' | 'machine';
const HUMS: Partial<Record<string, { kind: HumKind; y: number; gain: number }>> = {
  serverRack: { kind: 'hum', y: 1.4, gain: 0.3 },
  machinery: { kind: 'machine', y: 1.2, gain: 0.35 },
  reactorModel: { kind: 'hum', y: 1.5, gain: 0.3 },
};

/**
 * Renders the player-built part of the HQ from save data and keeps it in sync incrementally:
 * every module/object has its own node and collider, and only pieces whose data changed are
 * rebuilt. Geometry is instanced kit parts (one draw call per shape/material across all pieces).
 */
export class ExpansionLayer {
  private built = new Map<string, Built>();
  private lights = 0;
  /** Sliding doors (proximity animated). */
  private doors: { key: string; left: TransformNode; right: TransformNode; open: number; c: Vector3; axis: 'x' | 'z' }[] = [];
  private glass: Material;
  private stripMats = new Map<string, Material>();
  private lightBudget: number;

  constructor(
    private scene: Scene,
    private kit: Kit,
    private ctx: PropCtx,
    private playerPos: () => Vector3,
    high: boolean,
  ) {
    this.glass = ctx.M.glass;
    this.lightBudget = high ? LIMITS.lights : Math.min(3, LIMITS.lights);
  }

  /** Number of meshes/nodes built (diagnostics). */
  get count(): number {
    return this.built.size;
  }

  sync(save: Readonly<SaveData>): void {
    const want = new Map<string, { sig: string; build: () => Built }>();
    const s = save.base.structure;
    for (const [k, t] of Object.entries(s.floors)) want.set(`f:${k}`, { sig: `${t}|${this.railSig(s, k)}`, build: () => this.floor(s, k, t) });
    for (const [k, t] of Object.entries(s.edges)) want.set(`e:${k}`, { sig: t, build: () => this.edge(k, t) });
    for (const [k, t] of Object.entries(s.ceilings)) want.set(`c:${k}`, { sig: t, build: () => this.ceiling(k, t) });
    for (const k of Object.keys(s.pillars)) want.set(`p:${k}`, { sig: 'p', build: () => this.pillar(k) });
    for (const g of GATEWAYS) if (!s.floors[cellKey(...g.cell)]) want.set(`g:${g.id}`, { sig: 'sealed', build: () => this.sealedGate(g.door.x) });
    // Real light budget: the first N lit lights (in placement order) get dynamic lights.
    let lit = 0;
    for (const p of save.base.placeables) {
      const def = pieceDef(p.type);
      const real = !!def?.light && p.props.on !== false && lit < this.lightBudget;
      if (real) lit++;
      want.set(`o:${p.uid}`, { sig: JSON.stringify([p.type, p.position, p.rotationY, p.scale, p.props, real]), build: () => this.prop(p, real) });
    }
    for (const [k, b] of this.built) {
      const w = want.get(k);
      if (!w || w.sig !== b.sig) this.drop(k);
    }
    for (const [k, w] of want) {
      if (this.built.has(k)) continue;
      const b = w.build();
      b.sig = w.sig;
      this.built.set(k, b);
    }
    this.lights = lit;
  }

  private drop(k: string): void {
    const b = this.built.get(k);
    if (!b) return;
    b.body?.dispose();
    b.light?.dispose();
    b.hum?.dispose();
    b.root.dispose(false, false);
    this.built.delete(k);
    this.doors = this.doors.filter((d) => d.key !== k);
  }

  dispose(): void {
    for (const k of [...this.built.keys()]) this.drop(k);
  }

  /** Start the machine hums that could not start earlier (audio unlocks after the first gesture). */
  startSound(): void {
    for (const b of this.built.values()) this.startHum(b);
  }

  private startHum(b: Built): void {
    const h = b.humAt;
    if (!h || b.hum || !sfx.ready) return;
    b.hum = sfx.emitter(h.kind, h.x, h.y, h.z, h.gain, 2.5);
  }

  update(dt: number): void {
    const p = this.playerPos();
    for (const d of this.doors) {
      const near = Vector3.DistanceSquared(p, d.c) < 4.2 * 4.2;
      d.open += ((near ? 1 : 0) - d.open) * Math.min(1, dt * 6);
      const off = 0.6 + d.open * 1.1;
      if (d.axis === 'x') {
        d.left.position.z = -off;
        d.right.position.z = off;
      } else {
        d.left.position.x = -off;
        d.right.position.x = off;
      }
    }
  }

  // ------------------------------------------------------------------ colliders

  private body(boxes: [number, number, number, number, number, number][]): PhysicsBody | null {
    if (!boxes.length) return null;
    const shape = new PhysicsShapeContainer(this.scene);
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      const c = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      shape.addChild(new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), this.scene), c, Quaternion.Identity());
    }
    shape.filterMembershipMask = PHYS_ENV;
    const node = this.kit.node('expBody', null);
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = shape;
    const dispose = body.dispose.bind(body);
    body.dispose = () => {
      dispose();
      shape.dispose();
      node.dispose();
    };
    return body;
  }

  // ------------------------------------------------------------------ structure

  /** Exterior edges of a floor without a wall get a guard rail (signature for rebuilds). */
  private railSig(s: Structure, k: string): string {
    const [i, j] = parseCell(k);
    return (['n', 's', 'e', 'w'] as const)
      .map((side) => {
        const [di, dj] = side === 'n' ? [0, 1] : side === 's' ? [0, -1] : side === 'e' ? [1, 0] : [-1, 0];
        const ek = side === 'n' ? `${i},${j},n` : side === 's' ? `${i},${j - 1},n` : side === 'e' ? `${i},${j},e` : `${i - 1},${j},e`;
        const gate = GATEWAYS.some((g) => g.edge === ek);
        return !s.floors[cellKey(i + di, j + dj)] && !s.edges[ek] && !gate ? side : '';
      })
      .join('');
  }

  private floor(s: Structure, k: string, type: string): Built {
    const { kit, ctx } = this;
    const M = ctx.M;
    const [i, j] = parseCell(k);
    const [x, z] = cellMin(i, j);
    const root = kit.node(`floor_${k}`, null, [x + CELL / 2, 0, z + CELL / 2]);
    const top = type === 'floor_lab' ? M.white : type === 'floor_grate' ? M.metal : M.floor;
    kit.part('box', M.graphite, root, { pos: [0, -0.18, 0], scale: [CELL, 0.32, CELL] });
    kit.part('box', top, root, { pos: [0, -0.02, 0], scale: [CELL - 0.06, 0.04, CELL - 0.06] });
    if (type === 'floor_grate') {
      for (const x of [-1.66, 0, 1.66]) {
        kit.part('box', M.graphite, root, { pos: [x, 0.002, 0], scale: [1.48, 0.012, CELL - 0.36] });
        for (let n = -4; n <= 4; n++) kit.part('box', M.metal, root, { pos: [x, 0.009, n * 0.51], scale: [1.41, 0.013, 0.27] });
      }
      for (const z of [-2.31, 2.31]) kit.part('box', M.amberDim, root, { pos: [0, 0.009, z], scale: [CELL - 0.4, 0.014, 0.05], shadow: false });
    } else if (type === 'floor_lab') {
      for (const d of [-1, 1]) kit.part('box', M.cyan, root, { pos: [d * 1.6, 0.004, 0], scale: [0.04, 0.01, CELL - 0.3], shadow: false });
      kit.part('box', M.cyanDim, root, { pos: [0, 0.004, 0], scale: [CELL - 0.3, 0.01, 0.04], shadow: false });
    } else {
      // Panel seams + corner studs.
      kit.part('box', M.graphite, root, { pos: [0, 0.002, 0], scale: [0.05, 0.01, CELL - 0.1] });
      kit.part('box', M.graphite, root, { pos: [0, 0.002, 0], scale: [CELL - 0.1, 0.01, 0.05] });
    }
    // The floor is also a buildable/pickable surface for the editor and the arena-style placement picks.
    const pick = MeshBuilder.CreateBox(`floorPick_${k}`, { width: CELL, height: 0.02, depth: CELL }, this.scene);
    pick.parent = root;
    pick.isVisible = false;
    pick.metadata = { surface: 'floor' };
    const boxes: [number, number, number, number, number, number][] = [[x, -1, z, x + CELL, 0, z + CELL]];
    // Guard rails on open exterior edges.
    for (const side of this.railSig(s, k)) {
      const seg = edgeSegment(side === 'n' ? `${i},${j},n` : side === 's' ? `${i},${j - 1},n` : side === 'e' ? `${i},${j},e` : `${i - 1},${j},e`);
      const cx = (seg.x0 + seg.x1) / 2 - (x + CELL / 2);
      const cz = (seg.z0 + seg.z1) / 2 - (z + CELL / 2);
      const along = seg.axis === 'z';
      kit.part('box', M.graphite, root, { pos: [cx, 1.05, cz], scale: along ? [CELL, 0.08, 0.12] : [0.12, 0.08, CELL] });
      kit.part('box', M.cyan, root, { pos: [cx, 1.0, cz], scale: along ? [CELL - 0.1, 0.03, 0.13] : [0.13, 0.03, CELL - 0.1], shadow: false });
      for (const t of [-2.2, 0, 2.2]) kit.part('box', M.white, root, { pos: [cx + (along ? t : 0), 0.52, cz + (along ? 0 : t)], scale: [0.1, 1.04, 0.1] });
      boxes.push(along ? [seg.x0, 0, seg.z0 - 0.15, seg.x1, 1.3, seg.z0 + 0.15] : [seg.x0 - 0.15, 0, seg.z0, seg.x0 + 0.15, 1.3, seg.z1]);
    }
    return { root, body: this.body(boxes), sig: '' };
  }

  private edge(k: string, type: string): Built {
    const { kit, ctx } = this;
    const M = ctx.M;
    const seg = edgeSegment(k);
    const cx = (seg.x0 + seg.x1) / 2;
    const cz = (seg.z0 + seg.z1) / 2;
    const root = kit.node(`edge_${k}`, null, [cx, 0, cz]);
    // Local frame: wall runs along local x; thickness along local z.
    root.rotation.y = seg.axis === 'x' ? Math.PI / 2 : 0;
    const L = CELL;
    const T = 0.3;
    const H = WALL_H;
    const boxes: [number, number, number, number, number, number][] = [];
    const solid = (a0: number, a1: number, y0: number, y1: number) => {
      // World-space collider for a span along the wall from a0..a1 (local x).
      if (seg.axis === 'z') boxes.push([cx + a0, y0, cz - T / 2, cx + a1, y1, cz + T / 2]);
      else boxes.push([cx - T / 2, y0, cz + a0, cx + T / 2, y1, cz + a1]);
    };
    const panel = (a0: number, a1: number, y0: number, y1: number, mat = M.white) => {
      kit.part('box', mat, root, { pos: [(a0 + a1) / 2, (y0 + y1) / 2, 0], scale: [a1 - a0, y1 - y0, T] });
    };
    const trims = (a0: number, a1: number) => {
      kit.part('box', M.graphite, root, { pos: [(a0 + a1) / 2, 0.16, 0], scale: [a1 - a0, 0.32, T + 0.1] });
      kit.part('box', M.cyan, root, { pos: [(a0 + a1) / 2, 2.66, 0], scale: [a1 - a0, 0.06, T + 0.12], shadow: false });
      kit.part('box', M.graphite, root, { pos: [(a0 + a1) / 2, H - 0.15, 0], scale: [a1 - a0, 0.3, T + 0.08] });
    };
    const post = (a: number) => kit.part('box', M.graphite, root, { pos: [a, H / 2, 0], scale: [0.36, H, T + 0.16] });
    switch (type) {
      case 'wall_window': {
        panel(-L / 2, L / 2, 0, 1.1);
        panel(-L / 2, L / 2, 3.3, H);
        trims(-L / 2, L / 2);
        for (const a of [-L / 2 + 0.1, -0.8, 0.8, L / 2 - 0.1]) kit.part('box', M.graphite, root, { pos: [a, 2.2, 0], scale: [0.14, 2.2, T + 0.04] });
        const g = MeshBuilder.CreatePlane(`expGlass_${k}`, { width: L - 0.2, height: 2.2 }, this.scene);
        g.parent = root;
        g.position.y = 2.2;
        g.material = this.glass;
        g.isPickable = false;
        solid(-L / 2, L / 2, 0, H);
        break;
      }
      case 'wall_doorway':
      case 'wall_door': {
        const w = 1.25;
        panel(-L / 2, -w, 0, H);
        panel(w, L / 2, 0, H);
        panel(-w, w, 3.2, H);
        trims(-L / 2, -w);
        trims(w, L / 2);
        post(-w);
        post(w);
        kit.part('box', M.cyan, root, { pos: [0, 3.17, 0], scale: [2 * w, 0.05, T + 0.14], shadow: false });
        kit.part('box', M.metal, root, { pos: [0, 0.01, 0], scale: [2 * w, 0.02, 0.9] });
        solid(-L / 2, -w, 0, H);
        solid(w, L / 2, 0, H);
        solid(-w, w, 3.2, H);
        if (type === 'wall_door') {
          const left = kit.node('doorL', root, [-0.6, 0, 0]);
          const right = kit.node('doorR', root, [0.6, 0, 0]);
          for (const [n, s] of [[left, -1], [right, 1]] as const) {
            kit.part('box', M.white, n, { pos: [0, 1.6, 0], scale: [1.2, 3.2, 0.12] });
            for (const z of [-1, 1]) {
              kit.part('box', M.metal, n, { pos: [0, 1.04, z * 0.068], scale: [1.1, 0.9, 0.032] });
              kit.part('box', M.graphite, n, { pos: [-s * 0.47, 1.66, z * 0.08], scale: [0.14, 1.8, 0.05] });
              kit.part('box', M.amberDim, n, { pos: [-s * 0.47, 1.79, z * 0.108], scale: [0.055, 1.11, 0.012], shadow: false });
            }
          }
          this.doors.push({ key: `e:${k}`, left, right, open: 0, c: new Vector3(cx, 1, cz), axis: seg.axis });
        }
        break;
      }
      case 'wall_reinforced': {
        panel(-L / 2, L / 2, 0, H, M.graphite);
        for (let n = 0; n < 4; n++) kit.part('box', n % 2 ? M.graphite : M.amberDim, root, { pos: [0, 0.4 + n * 0.25, 0], scale: [L - 0.2, 0.12, T + 0.06], shadow: false });
        for (const f of [-1, 1]) for (let i = -1; i <= 1; i++) {
          kit.part('box', M.metal, root, { pos: [i * 1.43, 2.7, f * 0.18], scale: [1.32, 2.33, 0.11] });
          kit.part('box', M.graphite, root, { pos: [i * 1.43, 2.7, f * 0.234], scale: [1.12, 1.66, 0.032] });
        }
        post(-L / 2 + 0.2);
        post(L / 2 - 0.2);
        solid(-L / 2, L / 2, 0, H);
        break;
      }
      default: {
        panel(-L / 2, L / 2, 0, H);
        trims(-L / 2, L / 2);
        for (const a of [-1.25, 1.25]) kit.part('box', M.graphite, root, { pos: [a, 1.5, 0], scale: [0.12, 2.3, T + 0.06] });
        solid(-L / 2, L / 2, 0, H);
      }
    }
    void edgeCells;
    return { root, body: this.body(boxes), sig: '' };
  }

  private ceiling(k: string, type: string): Built {
    const { kit, ctx } = this;
    const M = ctx.M;
    const [i, j] = parseCell(k);
    const [x, z] = cellMin(i, j);
    const root = kit.node(`ceil_${k}`, null, [x + CELL / 2, WALL_H, z + CELL / 2]);
    if (type === 'ceiling_skylight') {
      for (const [a, b] of [[0, 2.35], [0, -2.35], [2.35, 0], [-2.35, 0]] as const) kit.part('box', M.graphite, root, { pos: [a, 0.1, b], scale: a ? [0.3, 0.2, CELL] : [CELL, 0.2, 0.3] });
      kit.part('box', M.graphite, root, { pos: [0, 0.1, 0], scale: [0.12, 0.16, CELL] });
      const g = MeshBuilder.CreatePlane(`skyGlass_${k}`, { width: CELL - 0.5, height: CELL - 0.5 }, this.scene);
      g.parent = root;
      g.rotation.x = Math.PI / 2;
      g.position.y = 0.15;
      g.material = this.glass;
      g.isPickable = false;
    } else {
      kit.part('box', M.ceiling, root, { pos: [0, 0.08, 0], scale: [CELL, 0.16, CELL] });
      for (const z of [-1.53, 1.53]) {
        kit.part('box', M.graphite, root, { pos: [0, -0.035, z], scale: [CELL * 0.76, 0.07, 0.38] });
        kit.part('box', M.lamp, root, { pos: [0, -0.072, z], scale: [CELL * 0.69, 0.014, 0.155], shadow: false });
      }
    }
    return { root, body: this.body([[x, WALL_H, z, x + CELL, WALL_H + 0.3, z + CELL]]), sig: '' };
  }

  private pillar(k: string): Built {
    const { kit, ctx } = this;
    const M = ctx.M;
    const [i, j] = parseCell(k);
    const [x, z] = cellMin(i, j);
    const root = kit.node(`pillar_${k}`, null, [x, 0, z]);
    kit.part('cyl6', M.graphite, root, { pos: [0, WALL_H / 2, 0], scale: [0.7, WALL_H, 0.7] });
    kit.part('cyl6', M.white, root, { pos: [0, 0.25, 0], scale: [0.95, 0.5, 0.95] });
    kit.part('cyl6', M.white, root, { pos: [0, WALL_H - 0.25, 0], scale: [0.95, 0.5, 0.95] });
    kit.part('cyl6', M.cyan, root, { pos: [0, 2.66, 0], scale: [0.74, 0.06, 0.74], shadow: false });
    return { root, body: this.body([[x - 0.35, 0, z - 0.35, x + 0.35, WALL_H, z + 0.35]]), sig: '' };
  }

  /** Closed blast door in an unbuilt gateway (the original "reserved" doors). */
  private sealedGate(dx: number): Built {
    const { kit, ctx } = this;
    const M = ctx.M;
    const root = kit.node(`gate_${dx}`, null, [dx, 0, 0]);
    const s = dx < 0 ? -1 : 1;
    kit.part('box', M.white, root, { pos: [s * 0.05, 1.8, -1.0], scale: [0.18, 3.6, 2.0] });
    kit.part('box', M.white, root, { pos: [s * 0.05, 1.8, 1.0], scale: [0.18, 3.6, 2.0] });
    for (let n = 0; n < 4; n++) kit.part('box', n % 2 ? M.graphite : M.amberDim, root, { pos: [s * -0.06, 0.4 + n * 0.22, 0], scale: [0.02, 0.1, 3.8], shadow: false });
    kit.part('box', M.amber, root, { pos: [s * -0.07, 3.35, 0], scale: [0.02, 0.1, 1.0], shadow: false });
    return { root, body: this.body([[dx - 0.2, 0, -2, dx + 0.2, 3.6, 2]]), sig: '' };
  }

  // ------------------------------------------------------------------ free objects

  private prop(p: Readonly<Placeable>, real: boolean): Built {
    const boxes: [number, number, number, number, number, number][] = [];
    const ctx: PropCtx = { ...this.ctx, collider: (x0, y0, z0, x1, y1, z1) => boxes.push([x0, y0, z0, x1, y1, z1]) };
    const root = buildPlaceable(ctx, p as Placeable);
    let light: PointLight | null = null;
    const def = pieceDef(p.type);
    if (def?.light || p.type === 'lightStrip') {
      const col = LIGHT_COLORS[(p.props.color as string) ?? 'white'] ?? LIGHT_COLORS.white;
      const on = p.props.on !== false;
      const k = typeof p.props.intensity === 'number' ? p.props.intensity : 1;
      // Emissive part reflects colour/intensity/on even when the budget denies a real light.
      const key = `${p.props.color ?? 'white'}|${on ? k : 0}`;
      let mat = this.stripMats.get(key);
      if (!mat) {
        mat = unlit(this.scene, `lightGlow_${key}`, on ? [col[0] * 2.2 * k, col[1] * 2.2 * k, col[2] * 2.2 * k] : [0.05, 0.05, 0.06]);
        this.stripMats.set(key, mat);
      }
      const h = p.type === 'ceilingLamp' ? 3.6 : p.type === 'floorLamp' ? 1.7 : p.type === 'lightStrip' ? 0.05 : 3.0;
      const glow = this.kit.part(p.type === 'lightStrip' ? 'box' : 'sphere', mat, root, { pos: [0, h, 0], scale: p.type === 'lightStrip' ? [2.2, 0.04, 0.12] : [0.36, 0.2, 0.36], shadow: false });
      glow.isPickable = false;
      if (real && on) {
        light = new PointLight(`hqUserLight_${p.uid}`, new Vector3(p.position[0], h * p.scale + 0.2, p.position[2]), this.scene);
        light.diffuse = new Color3(...col);
        light.specular = new Color3(...col).scale(0.4);
        light.intensity = 1.6 * k;
        light.range = 10;
      }
    }
    const built: Built = { root, body: this.body(boxes), sig: '', light };
    const hum = HUMS[p.type];
    if (hum) {
      built.humAt = { kind: hum.kind, x: p.position[0], y: hum.y * p.scale, z: p.position[2], gain: hum.gain };
      this.startHum(built);
    }
    return built;
  }

  get realLights(): number {
    return this.lights;
  }
}

export type { Animator };
