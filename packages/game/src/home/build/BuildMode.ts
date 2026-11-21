import { ArcRotateCamera, type Camera, Color3, type LinesMesh, type Mesh, MeshBuilder, Plane, type Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { sfx } from '../../audio/Sfx';
import type { Input } from '../../core/Input';
import type { OpResult } from '@riftwarden/rules/progression/ops';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { hudStore } from '../../ui/store';
import { newUid } from '@riftwarden/rules/progression/items';
import { type PieceDef, PIECES, pieceDef } from '@riftwarden/rules/home/build/catalog';
import { blueprintStatus } from '@riftwarden/rules/home/build/ops';
import {
  CELL,
  cellAt,
  cellKey,
  cellMin,
  checkCeiling,
  checkEdge,
  checkFloor,
  checkFree,
  checkPillar,
  coreCell,
  edgeKey,
  edgeSegment,
  GRID,
  inBounds,
  isMovableStation,
  type PlacedProp,
  stationPoses,
  WALL_H,
} from '@riftwarden/rules/home/build/model';

export type BuildTool = { kind: 'select' } | { kind: 'place'; piece: string } | { kind: 'remove' } | { kind: 'station'; id: string };

/** What the construction HUD shows (published to hudStore.construct). */
export interface BuildHud {
  tool: BuildTool;
  yaw: number;
  scale: number;
  snap: boolean;
  valid: boolean;
  message: string;
  selection: { type: 'prop'; uid: string; piece: string; props: Record<string, unknown> } | { type: 'station'; id: string; title: string } | null;
  moving: boolean;
  undo: number;
  redo: number;
  cursor: [number, number] | null;
  lights: number;
}

interface Step {
  label: string;
  redo: [string, unknown[]];
  undo: [string, unknown[]];
}

/** Undo/redo stacks survive HQ rebuilds (station moves rebuild the scene) within one editing session. */
const session = { undo: [] as Step[], redo: [] as Step[], target: null as Vector3 | null, radius: 34, alpha: -Math.PI / 2, tool: { kind: 'select' } as BuildTool, yaw: 0, scale: 1, snap: true };

export function resetBuildSession(): void {
  session.undo = [];
  session.redo = [];
  session.tool = { kind: 'select' };
}

/**
 * Construction mode: an orbiting top-down camera over the HQ with a free mouse cursor. Snapped
 * pieces preview the cell/edge/vertex under the cursor; free pieces follow the cursor with
 * rotation (R / Shift+R), optional 15° / 0.5 m snapping (G) and scale (+ / −). Every action is a
 * validated profile operation; undo/redo replays the inverse operation through the same rules.
 */
export class BuildMode {
  readonly camera: ArcRotateCamera;
  private prevCamera: Camera | null = null;
  active = false;
  private ghost: Mesh;
  private ghostOk: StandardMaterial;
  private ghostBad: StandardMaterial;
  private ring: Mesh;
  private grid: LinesMesh;
  private cursor: Vector3 | null = null;
  private pointer = { x: 0, y: 0, inside: false };
  private clicks: number[] = [];
  private wheel = 0;
  private hud: BuildHud;
  private selection: BuildHud['selection'] = null;
  private moving = false;
  private listeners: [string, EventListener][] = [];
  private hudT = 0;
  private lastOk = true;
  private lastMsg = '';

  constructor(
    private scene: Scene,
    private canvas: HTMLCanvasElement,
    private input: Input,
    private save: () => Readonly<SaveData>,
    private op: (name: string, args: unknown[]) => OpResult,
    private realLights: () => number,
  ) {
    this.camera = new ArcRotateCamera('buildCam', session.alpha, 0.95, session.radius, session.target ?? new Vector3(0, 0, 2), scene);
    this.camera.minZ = 0.3;
    this.camera.maxZ = 400;
    this.camera.fov = 0.9;
    this.ghostOk = mat(scene, 'buildGhostOk', new Color3(0.2, 0.9, 1));
    this.ghostBad = mat(scene, 'buildGhostBad', new Color3(1, 0.25, 0.15));
    this.ghost = MeshBuilder.CreateBox('buildGhost', { size: 1 }, scene);
    this.ghost.isPickable = false;
    this.ghost.setEnabled(false);
    this.ring = MeshBuilder.CreateTorus('buildRing', { diameter: 2, thickness: 0.06, tessellation: 40 }, scene);
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
    this.grid = this.makeGrid();
    this.grid.setEnabled(false);
    this.hud = { tool: session.tool, yaw: session.yaw, scale: session.scale, snap: session.snap, valid: true, message: '', selection: null, moving: false, undo: session.undo.length, redo: session.redo.length, cursor: null, lights: 0 };
  }

  private makeGrid(): LinesMesh {
    const lines: Vector3[][] = [];
    for (let i = GRID.iMin; i <= GRID.iMax + 1; i++) {
      const x = GRID.x0 + i * CELL;
      lines.push([new Vector3(x, 0.03, GRID.z0 + GRID.jMin * CELL), new Vector3(x, 0.03, GRID.z0 + (GRID.jMax + 1) * CELL)]);
    }
    for (let j = GRID.jMin; j <= GRID.jMax + 1; j++) {
      const z = GRID.z0 + j * CELL;
      lines.push([new Vector3(GRID.x0 + GRID.iMin * CELL, 0.03, z), new Vector3(GRID.x0 + (GRID.iMax + 1) * CELL, 0.03, z)]);
    }
    const g = MeshBuilder.CreateLineSystem('buildGrid', { lines }, this.scene);
    g.color = new Color3(0.2, 0.55, 0.65);
    g.alpha = 0.35;
    g.isPickable = false;
    return g;
  }

  // ------------------------------------------------------------------ lifecycle

  enter(focus: Vector3): void {
    if (this.active) return;
    this.active = true;
    this.prevCamera = this.scene.activeCamera;
    if (!session.target) session.target = new Vector3(focus.x, 0, focus.z);
    this.camera.target.copyFrom(session.target);
    this.camera.alpha = session.alpha;
    this.camera.radius = session.radius;
    this.scene.activeCamera = this.camera;
    this.grid.setEnabled(true);
    const on = (type: string, fn: EventListener) => {
      this.canvas.addEventListener(type, fn);
      this.listeners.push([type, fn]);
    };
    on('pointermove', ((e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true };
    }) as EventListener);
    on('pointerleave', (() => (this.pointer.inside = false)) as EventListener);
    on('pointerdown', ((e: PointerEvent) => void this.clicks.push(e.button)) as unknown as EventListener);
    on('wheel', ((e: WheelEvent) => {
      this.wheel += e.deltaY;
      e.preventDefault();
    }) as EventListener);
    on('contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
    this.publish(true);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    session.target = this.camera.target.clone();
    session.alpha = this.camera.alpha;
    session.radius = this.camera.radius;
    for (const [t, fn] of this.listeners) this.canvas.removeEventListener(t, fn);
    this.listeners = [];
    this.ghost.setEnabled(false);
    this.ring.setEnabled(false);
    this.grid.setEnabled(false);
    if (this.prevCamera) this.scene.activeCamera = this.prevCamera;
    hudStore.set({ construct: null });
  }

  dispose(): void {
    this.exit();
  }

  // ------------------------------------------------------------------ public controls (UI)

  setTool(t: BuildTool): void {
    session.tool = t;
    this.moving = false;
    if (t.kind !== 'select') this.selection = null;
    sfx.play('ui', { pitch: 1.3, volume: 0.5 });
    this.publish(true);
  }

  rotate(dir = 1): void {
    session.yaw = wrap(session.yaw + (dir * Math.PI) / (session.snap ? 12 : 36));
    this.publish(true);
  }
  setScale(s: number): void {
    session.scale = Math.round(Math.max(0.75, Math.min(1.3, s)) * 20) / 20;
    this.publish(true);
  }
  toggleSnap(): void {
    session.snap = !session.snap;
    this.publish(true);
  }

  /** Start moving the selected object (it follows the cursor until a click confirms). */
  startMove(): void {
    if (!this.selection) return;
    const s = this.save();
    if (this.selection.type === 'prop') {
      const sel = this.selection;
      const p = s.base.placeables.find((q) => q.uid === sel.uid);
      if (p) {
        session.yaw = p.rotationY;
        session.scale = p.scale;
      }
    } else {
      const sel = this.selection;
      const st = stationPoses(s.base.stations).find((q) => q.id === sel.id);
      if (st) session.yaw = st.yaw;
    }
    this.moving = true;
    this.publish(true);
  }

  removeSelected(): void {
    const sel = this.selection;
    if (!sel) return;
    if (sel.type === 'prop') {
      const p = this.save().base.placeables.find((q) => q.uid === sel.uid);
      if (!p) return;
      const snapshot = JSON.parse(JSON.stringify(p)) as PlacedProp;
      this.run(`Remove ${pieceDef(p.type)?.name ?? 'object'}`, ['hqRemove', [p.uid]], ['hqPlace', [snapshot.uid, snapshot.type, snapshot.position[0], snapshot.position[2], snapshot.rotationY, snapshot.scale, snapshot.props]]);
    } else {
      const before = this.save().base.stations[sel.id];
      if (!before) return this.note(false, 'Already at its original place');
      this.run('Reset station', ['hqStationReset', [sel.id]], ['hqStation', [sel.id, before.x, before.z, before.yaw]]);
    }
    this.selection = null;
    this.moving = false;
  }

  /** Light colour / intensity / on-off, accents. */
  setProps(patch: Record<string, unknown>): void {
    const sel = this.selection;
    if (!sel || sel.type !== 'prop') return;
    const p = this.save().base.placeables.find((q) => q.uid === sel.uid);
    if (!p) return;
    this.run('Adjust', ['hqSet', [p.uid, patch]], ['hqSet', [p.uid, { ...p.props }]]);
  }

  undo(): void {
    const s = session.undo.pop();
    if (!s) return;
    const r = this.op(s.undo[0], s.undo[1]);
    if (r.ok) {
      session.redo.push(s);
      this.note(true, `Undone: ${s.label}`);
      sfx.play('recycle', { volume: 0.5 });
    } else {
      session.undo.push(s);
      this.note(false, `Cannot undo: ${(r as { reason: string }).reason}`);
    }
  }

  redo(): void {
    const s = session.redo.pop();
    if (!s) return;
    const r = this.op(s.redo[0], s.redo[1]);
    if (r.ok) {
      session.undo.push(s);
      this.note(true, `Redone: ${s.label}`);
      sfx.play('build', { volume: 0.5 });
    } else {
      session.redo.push(s);
      this.note(false, `Cannot redo: ${(r as { reason: string }).reason}`);
    }
  }

  /** Run an operation and record its inverse. */
  private run(label: string, redo: [string, unknown[]], undo: [string, unknown[]]): boolean {
    const r = this.op(redo[0], redo[1]);
    if (!r.ok) {
      this.note(false, (r as { reason: string }).reason);
      sfx.play('buildDeny');
      return false;
    }
    session.undo.push({ label, redo, undo });
    if (session.undo.length > 80) session.undo.shift();
    session.redo = [];
    this.note(true, label);
    return true;
  }

  private note(ok: boolean, msg: string): void {
    this.lastOk = ok;
    this.lastMsg = msg;
    this.publish(true);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    if (!this.active) return;
    const inp = this.input;
    // Camera: WASD pans relative to the view, Q/E orbit, wheel zooms.
    const sp = (18 + this.camera.radius * 0.6) * dt;
    const fx = Math.cos(this.camera.alpha + Math.PI);
    const fz = Math.sin(this.camera.alpha + Math.PI);
    let mx = 0;
    let mz = 0;
    if (inp.isDown('KeyW')) mz += 1;
    if (inp.isDown('KeyS')) mz -= 1;
    if (inp.isDown('KeyD')) mx += 1;
    if (inp.isDown('KeyA')) mx -= 1;
    const t = this.camera.target;
    t.x = clamp(t.x + (fx * mz + fz * mx) * sp, -95, 95);
    t.z = clamp(t.z + (fz * mz - fx * mx) * sp, -55, 55);
    if (inp.isDown('KeyQ')) this.camera.alpha -= dt * 1.4;
    if (inp.isDown('KeyE')) this.camera.alpha += dt * 1.4;
    if (this.wheel) {
      this.camera.radius = clamp(this.camera.radius * Math.exp(this.wheel * 0.0012), 10, 90);
      this.wheel = 0;
    }
    if (inp.pressed('KeyR')) this.rotate(inp.isDown('ShiftLeft') ? -1 : 1);
    if (inp.pressed('KeyG')) this.toggleSnap();
    if (inp.pressed('Equal') || inp.pressed('NumpadAdd')) this.setScale(session.scale + 0.05);
    if (inp.pressed('Minus') || inp.pressed('NumpadSubtract')) this.setScale(session.scale - 0.05);
    if (inp.pressed('KeyZ') && (inp.isDown('ControlLeft') || inp.isDown('MetaLeft'))) {
      if (inp.isDown('ShiftLeft')) this.redo();
      else this.undo();
    }
    if (inp.pressed('KeyY') && (inp.isDown('ControlLeft') || inp.isDown('MetaLeft'))) this.redo();
    if (inp.pressed('Delete') || inp.pressed('Backspace')) this.removeSelected();
    if (inp.pressed('KeyM') && this.selection) this.startMove();

    // Cursor on the ground plane.
    this.cursor = null;
    if (this.pointer.inside) {
      const ray = this.scene.createPickingRay(this.pointer.x, this.pointer.y, null, this.camera);
      const d = ray.intersectsPlane(Plane.FromPositionAndNormal(Vector3.Zero(), Vector3.Up()));
      if (d !== null && d > 0) this.cursor = ray.origin.add(ray.direction.scale(d));
    }
    const click = this.clicks.shift();
    this.clicks.length = 0;
    this.preview(click);
    this.hudT -= dt;
    if (this.hudT <= 0) this.publish();
  }

  /** Ghost + validity for the current tool; a click (0 = left, 2 = right) acts. */
  private preview(click: number | undefined): void {
    const s = this.save();
    const c = this.cursor;
    this.ghost.setEnabled(false);
    this.ring.setEnabled(false);
    if (click === 2) {
      // Right click: cancel move/selection, back to select.
      if (this.moving) this.moving = false;
      else if (session.tool.kind !== 'select') this.setTool({ kind: 'select' });
      else this.selection = null;
      this.publish(true);
      return;
    }
    if (!c) return;
    const tool = session.tool;
    let x = c.x;
    let z = c.z;
    if (session.snap) {
      x = Math.round(x * 2) / 2;
      z = Math.round(z * 2) / 2;
    }
    // ---- moving the selection
    if (this.moving && this.selection) {
      const sel = this.selection;
      const type = sel.type === 'prop' ? s.base.placeables.find((q) => q.uid === sel.uid)?.type ?? '' : `station:${sel.id}`;
      const r = sel.type === 'prop' ? checkFree(s.base.structure, type, x, z, session.scale, s.base.placeables as PlacedProp[], s.base.stations, sel.uid) : checkFree(s.base.structure, type, x, z, 1, s.base.placeables as PlacedProp[], s.base.stations, undefined, sel.id);
      this.showFree(x, z, sel.type === 'prop' ? (pieceDef(type)?.radius ?? 1) * session.scale : 1, r.ok, session.yaw);
      this.status(r.ok, r.ok ? 'Click to set down · R rotate · right-click cancels' : r.reason);
      if (click === 0 && r.ok) {
        if (sel.type === 'prop') {
          const p = s.base.placeables.find((q) => q.uid === sel.uid)!;
          if (this.run('Move object', ['hqMove', [p.uid, x, z, session.yaw, session.scale]], ['hqMove', [p.uid, p.position[0], p.position[2], p.rotationY, p.scale]])) sfx.play('equip');
        } else {
          const before = s.base.stations[sel.id];
          if (this.run('Relocate station', ['hqStation', [sel.id, x, z, session.yaw]], before ? ['hqStation', [sel.id, before.x, before.z, before.yaw]] : ['hqStationReset', [sel.id]])) sfx.play('equip');
        }
        this.moving = false;
      } else if (click === 0) sfx.play('buildDeny');
      return;
    }
    if (tool.kind === 'select' || tool.kind === 'remove') {
      const hit = this.objectAt(s, c.x, c.z);
      if (hit) this.showFree(hit.x, hit.z, hit.r, tool.kind === 'select', hit.yaw);
      const structural = !hit && tool.kind === 'remove' ? this.structuralAt(s, c.x, c.z) : null;
      if (structural) this.showStructural(structural, false);
      this.status(true, hit ? hit.label : structural ? `Remove ${structural.label}` : tool.kind === 'remove' ? 'Click an object or module to remove it' : 'Click an object or station to select it');
      if (click === 0) {
        if (tool.kind === 'select') {
          this.selection = hit ? (hit.uid ? { type: 'prop', uid: hit.uid, piece: hit.piece!, props: hit.props! } : { type: 'station', id: hit.station!, title: hit.label }) : null;
          if (hit) sfx.play('ui', { pitch: 1.4 });
          this.publish(true);
        } else if (hit?.uid) {
          this.selection = { type: 'prop', uid: hit.uid, piece: hit.piece!, props: hit.props! };
          this.removeSelected();
        } else if (structural) this.removeStructural(structural);
      }
      return;
    }
    if (tool.kind === 'place') {
      const def = pieceDef(tool.piece);
      if (!def) return;
      const bp = blueprintStatus(s, def);
      if (def.kind === 'prop' || def.kind === 'light' || def.kind === 'facility') {
        let r = checkFree(s.base.structure, def.id, x, z, session.scale, s.base.placeables as PlacedProp[], s.base.stations);
        if (r.ok && !bp.unlocked) r = { ok: false, reason: `Blueprint locked: ${bp.how}` };
        this.showFree(x, z, (def.radius ?? 1) * session.scale, r.ok, session.yaw);
        this.status(r.ok, r.ok ? `${def.name} · ${costText(def)} · click to place` : r.reason);
        if (click === 0) {
          if (!r.ok) return void sfx.play('buildDeny');
          const uid = newUid('pl');
          const props = def.light || def.id === 'lightStrip' ? { color: 'white', intensity: 1, on: true } : { accent: 'cyan' };
          if (this.run(`Place ${def.name}`, ['hqPlace', [uid, def.id, x, z, session.yaw, session.scale, props]], ['hqRemove', [uid]])) sfx.play('build');
        }
        return;
      }
      const target = this.structuralTarget(def, c.x, c.z);
      if (!target) return this.status(false, 'Outside the construction zone');
      let r = this.checkStructural(s, def, target);
      if (r.ok && !bp.unlocked) r = { ok: false, reason: `Blueprint locked: ${bp.how}` };
      this.showStructural(target, r.ok);
      this.status(r.ok, r.ok ? `${def.name} · ${costText(def)} · click to build` : r.reason);
      if (click === 0) {
        if (!r.ok) return void sfx.play('buildDeny');
        const [redo, undo] = this.structuralOps(def, target);
        if (this.run(`Build ${def.name}`, redo, undo)) sfx.play('build');
      }
    }
  }

  // ------------------------------------------------------------------ structural helpers

  private structuralTarget(def: PieceDef, x: number, z: number): { kind: 'cell' | 'edge' | 'vertex'; i: number; j: number; key: string; label: string } | null {
    const [i, j] = cellAt(x, z);
    if (!inBounds(i, j)) return null;
    if (def.kind === 'edge') {
      const [x0, z0] = cellMin(i, j);
      const lx = x - x0;
      const lz = z - z0;
      const d = [lz, CELL - lz, lx, CELL - lx];
      const side = (['s', 'n', 'w', 'e'] as const)[d.indexOf(Math.min(...d))];
      return { kind: 'edge', i, j, key: edgeKey(i, j, side), label: 'wall' };
    }
    if (def.kind === 'pillar') {
      const vi = Math.round((x - GRID.x0) / CELL);
      const vj = Math.round((z - GRID.z0) / CELL);
      return { kind: 'vertex', i: vi, j: vj, key: cellKey(vi, vj), label: 'pillar' };
    }
    return { kind: 'cell', i, j, key: cellKey(i, j), label: def.kind };
  }

  private checkStructural(s: Readonly<SaveData>, def: PieceDef, t: { kind: string; i: number; j: number; key: string }) {
    if (def.kind === 'floor') return checkFloor(s.base.structure, t.i, t.j, def.id);
    if (def.kind === 'edge') return checkEdge(s.base.structure, t.key, def.id, s.base.stations);
    if (def.kind === 'ceiling') return checkCeiling(s.base.structure, t.i, t.j, def.id);
    return checkPillar(s.base.structure, t.i, t.j);
  }

  private structuralOps(def: PieceDef, t: { i: number; j: number; key: string }): [[string, unknown[]], [string, unknown[]]] {
    if (def.kind === 'floor') return [['hqFloor', [t.i, t.j, def.id]], ['hqUnfloor', [t.i, t.j]]];
    if (def.kind === 'edge') return [['hqEdge', [t.key, def.id]], ['hqUnedge', [t.key]]];
    if (def.kind === 'ceiling') return [['hqCeiling', [t.i, t.j, def.id]], ['hqUnceiling', [t.i, t.j]]];
    return [['hqPillar', [t.i, t.j]], ['hqUnpillar', [t.i, t.j]]];
  }

  /** The structural module under the cursor for removal (walls near edges, then pillars, ceilings, floors). */
  private structuralAt(s: Readonly<SaveData>, x: number, z: number) {
    const [i, j] = cellAt(x, z);
    const st = s.base.structure;
    const [x0, z0] = cellMin(i, j);
    const lx = x - x0;
    const lz = z - z0;
    const d = [lz, CELL - lz, lx, CELL - lx];
    const m = Math.min(...d);
    const side = (['s', 'n', 'w', 'e'] as const)[d.indexOf(m)];
    const ek = edgeKey(i, j, side);
    if (m < 0.8 && st.edges[ek]) return { kind: 'edge' as const, i, j, key: ek, label: pieceDef(st.edges[ek])?.name ?? 'wall', id: st.edges[ek] };
    const vi = Math.round((x - GRID.x0) / CELL);
    const vj = Math.round((z - GRID.z0) / CELL);
    const vx = GRID.x0 + vi * CELL;
    const vz = GRID.z0 + vj * CELL;
    if ((x - vx) ** 2 + (z - vz) ** 2 < 0.8 && st.pillars[cellKey(vi, vj)]) return { kind: 'vertex' as const, i: vi, j: vj, key: cellKey(vi, vj), label: 'pillar', id: 'pillar' };
    const k = cellKey(i, j);
    if (st.ceilings[k]) return { kind: 'cell' as const, i, j, key: k, label: pieceDef(st.ceilings[k])?.name ?? 'ceiling', id: st.ceilings[k], ceiling: true };
    if (st.floors[k]) return { kind: 'cell' as const, i, j, key: k, label: pieceDef(st.floors[k])?.name ?? 'floor', id: st.floors[k] };
    return null;
  }

  private removeStructural(t: NonNullable<ReturnType<BuildMode['structuralAt']>>): void {
    if (t.kind === 'edge') this.run(`Remove ${t.label}`, ['hqUnedge', [t.key]], ['hqEdge', [t.key, t.id]]);
    else if (t.kind === 'vertex') this.run('Remove pillar', ['hqUnpillar', [t.i, t.j]], ['hqPillar', [t.i, t.j]]);
    else if ('ceiling' in t && t.ceiling) this.run(`Remove ${t.label}`, ['hqUnceiling', [t.i, t.j]], ['hqCeiling', [t.i, t.j, t.id]]);
    else this.run(`Remove ${t.label}`, ['hqUnfloor', [t.i, t.j]], ['hqFloor', [t.i, t.j, t.id]]);
    sfx.play('recycle');
  }

  /** Object (prop or station) under the cursor. */
  private objectAt(s: Readonly<SaveData>, x: number, z: number) {
    let best: { x: number; z: number; r: number; yaw: number; label: string; uid?: string; piece?: string; props?: Record<string, unknown>; station?: string } | null = null;
    let bd = Infinity;
    for (const p of s.base.placeables) {
      const r = (pieceDef(p.type)?.radius ?? 0.9) * p.scale;
      const d = (p.position[0] - x) ** 2 + (p.position[2] - z) ** 2;
      if (d < Math.max(r, 0.8) ** 2 && d < bd) {
        bd = d;
        best = { x: p.position[0], z: p.position[2], r, yaw: p.rotationY, label: pieceDef(p.type)?.name ?? p.type, uid: p.uid, piece: p.type, props: { ...p.props } };
      }
    }
    for (const st of stationPoses(s.base.stations)) {
      if (!isMovableStation(st.id)) continue;
      const d = (st.x - x) ** 2 + (st.z - z) ** 2;
      if (d < 1.4 ** 2 && d < bd) {
        bd = d;
        best = { x: st.x, z: st.z, r: 1.1, yaw: st.yaw, label: st.title, station: st.id };
      }
    }
    return best;
  }

  private showFree(x: number, z: number, r: number, ok: boolean, yaw: number): void {
    this.ring.setEnabled(true);
    this.ring.position.set(x, 0.06, z);
    this.ring.scaling.set(r, 1, r);
    this.ring.material = ok ? this.ghostOk : this.ghostBad;
    this.ghost.setEnabled(true);
    this.ghost.position.set(x + Math.sin(yaw) * r * 0.8, 0.5, z + Math.cos(yaw) * r * 0.8);
    this.ghost.scaling.set(0.18, 1, 0.18);
    this.ghost.material = ok ? this.ghostOk : this.ghostBad;
  }

  private showStructural(t: { kind: 'cell' | 'edge' | 'vertex'; i: number; j: number; key: string }, ok: boolean): void {
    this.ghost.setEnabled(true);
    this.ghost.material = ok ? this.ghostOk : this.ghostBad;
    this.ghost.rotation.y = 0;
    if (t.kind === 'cell') {
      const [x, z] = cellMin(t.i, t.j);
      const core = coreCell(t.i, t.j);
      this.ghost.position.set(x + CELL / 2, 0.08, z + CELL / 2);
      this.ghost.scaling.set(CELL - 0.1, core ? 0.05 : 0.16, CELL - 0.1);
    } else if (t.kind === 'edge') {
      const e = edgeSegment(t.key);
      this.ghost.position.set((e.x0 + e.x1) / 2, WALL_H / 2, (e.z0 + e.z1) / 2);
      this.ghost.scaling.set(e.axis === 'z' ? CELL : 0.34, WALL_H, e.axis === 'z' ? 0.34 : CELL);
    } else {
      this.ghost.position.set(GRID.x0 + t.i * CELL, WALL_H / 2, GRID.z0 + t.j * CELL);
      this.ghost.scaling.set(0.7, WALL_H, 0.7);
    }
  }

  private status(ok: boolean, msg: string): void {
    if (ok === this.hud.valid && msg === this.hud.message) return;
    this.hud.valid = ok;
    this.hud.message = msg;
    this.publish(true);
  }

  private publish(force = false): void {
    this.hudT = 0.1;
    const h = this.hud;
    const sel = this.selection;
    let selection = sel;
    if (sel?.type === 'prop') {
      const p = this.save().base.placeables.find((q) => q.uid === sel.uid);
      selection = p ? { type: 'prop', uid: p.uid, piece: p.type, props: { ...p.props } } : null;
      if (!p) this.selection = null;
    }
    const next: BuildHud = {
      ...h,
      tool: session.tool,
      yaw: session.yaw,
      scale: session.scale,
      snap: session.snap,
      selection,
      moving: this.moving,
      undo: session.undo.length,
      redo: session.redo.length,
      cursor: this.cursor ? [Math.round(this.cursor.x * 10) / 10, Math.round(this.cursor.z * 10) / 10] : null,
      lights: this.realLights(),
      message: this.lastMsg && force ? this.lastMsg : h.message,
      valid: this.lastMsg && force ? this.lastOk : h.valid,
    };
    this.lastMsg = '';
    this.hud = next;
    hudStore.set({ construct: next });
  }

  /** Automation: place/act at a world point as if clicked. */
  clickAt(x: number, z: number, button = 0): void {
    this.cursor = new Vector3(x, 0, z);
    this.preview(button);
  }
}

function mat(scene: Scene, name: string, c: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = c;
  m.diffuseColor = Color3.Black();
  m.alpha = 0.45;
  m.disableLighting = true;
  return m;
}

export function costText(def: PieceDef): string {
  if (def.owned) return 'owned piece';
  const c = def.cost;
  const parts = [c.credits ? `${c.credits} cr` : '', c.salvage ? `${c.salvage} salvage` : '', c.components ? `${c.components} comp` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'free';
}

export const BUILD_CATEGORIES: { id: PieceDef['category'] | 'stations'; label: string }[] = [
  { id: 'structure', label: 'STRUCTURE' },
  { id: 'furniture', label: 'FURNITURE' },
  { id: 'machinery', label: 'MACHINERY' },
  { id: 'lighting', label: 'LIGHTING' },
  { id: 'facility', label: 'FACILITIES' },
  { id: 'trophy', label: 'TROPHIES' },
  { id: 'stations', label: 'STATIONS' },
];

export { PIECES };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
