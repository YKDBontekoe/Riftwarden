import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { Box } from '@riftwarden/rules/world/layout';
import { smoothLatheData } from './sculpt';

/**
 * A machinery bank (`machine` solid) built as believable plant instead of a box with glow slots: a rear enclosure
 * with louvre panels and access doors, a front band of pump skids (pump volute, motor with cooling fins, coupling
 * guard, valved riser into a flanged header), a cable tray along the top, and filter vessels on the roof where the
 * gameplay colliders stand. One dim status lamp per bay is the only light. Everything stays inside the collision
 * volume (box + roof colliders), so collision, line of sight and placement are unchanged.
 */
export interface MachineHost {
  readonly scene: Scene;
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, surface: string | null): Mesh;
  add(mesh: Mesh, mat: Material, surface: string | null): void;
}

export interface MachineMaterials {
  casing: Material;
  steel: Material;
  metal: Material;
  guard: Material;
  /** Pumps and motors: a different paint from the enclosure, as on real plant. */
  drive: Material;
  cable: Material;
  lamp: Material;
}

/** Roof vessel centres (local along-run offsets) that match the gameplay colliders (3 per bank). */
export function machineRoofSlots(run: number, n = 3): number[] {
  return Array.from({ length: n }, (_, i) => -run / 2 + (run * (i + 0.5)) / n);
}

export function buildMachineBank(h: MachineHost, b: Box, front: 1 | -1, M: MachineMaterials): void {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const alongX = x1 - x0 > z1 - z0;
  const run = alongX ? x1 - x0 : z1 - z0;
  const depth = alongX ? z1 - z0 : x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const H = y1 - y0;
  const ha = run / 2;
  const hc = depth / 2;
  // Local frame: a along the run, c across with +c toward the arena (front), y up.
  const put = (pa: number, ya: number, pc: number, qa: number, yb: number, qc: number, mat: Material, surface: string | null = 'wall') => {
    const [a0, a1] = pa < qa ? [pa, qa] : [qa, pa];
    const [c0, c1] = (pc < qc ? [pc, qc] : [qc, pc]).map((c) => c * front).sort((u, v) => u - v);
    return alongX ? h.box(cx + a0, y0 + ya, cz + c0, cx + a1, y0 + yb, cz + c1, mat, surface) : h.box(cx + c0, y0 + ya, cz + a0, cx + c1, y0 + yb, cz + a1, mat, surface);
  };
  /** Cylinder along a local axis ('a' run, 'c' across, 'y' up), centred at (a, y, c). */
  const cyl = (axis: 'a' | 'c' | 'y', a: number, y: number, c: number, len: number, d: number, mat: Material, surface: string | null = 'wall', tess = 16) => {
    const m = MeshBuilder.CreateCylinder('machinePart', { height: len, diameter: d, tessellation: tess }, h.scene);
    const wc = c * front;
    m.position.set(alongX ? cx + a : cx + wc, y0 + y, alongX ? cz + wc : cz + a);
    const worldAxis = axis === 'y' ? 'y' : (axis === 'a') === alongX ? 'x' : 'z';
    if (worldAxis === 'x') m.rotation.z = Math.PI / 2;
    else if (worldAxis === 'z') m.rotation.x = Math.PI / 2;
    h.add(m, mat, surface);
  };

  // Rear enclosure: the back 55% of the footprint, with a plinth, louvre bands and recessed access doors.
  const encFront = -hc + depth * 0.55;
  put(-ha, 0, -hc, ha, 0.18, hc, M.steel); // base frame under everything
  put(-ha + 0.05, 0.18, -hc + 0.05, ha - 0.05, H - 0.12, encFront, M.casing);
  put(-ha, H - 0.12, -hc, ha, H, encFront + 0.06, M.casing); // roof edge, slightly proud
  const bays = Math.max(1, Math.round(run / 2.6));
  const bw = run / bays;
  for (let k = 0; k < bays; k++) {
    const a = -ha + (k + 0.5) * bw;
    // Access door (recess frame + leaf) and a louvre band above it.
    put(a - bw * 0.32, 0.3, encFront, a + bw * 0.32, Math.min(2.1, H - 0.5), encFront + 0.03, M.steel);
    put(a - bw * 0.28, 0.34, encFront + 0.03, a + bw * 0.28, Math.min(2.06, H - 0.54), encFront + 0.045, M.casing);
    put(a + bw * 0.2, 1.1, encFront + 0.045, a + bw * 0.25, 1.22, encFront + 0.09, M.metal, null); // handle
    for (let l = 0; l < 4; l++) {
      const y = Math.min(2.25, H - 0.45) + l * 0.075;
      if (y > H - 0.2) break;
      put(a - bw * 0.36, y, encFront, a + bw * 0.36, y + 0.045, encFront + 0.07, M.steel, null);
    }
    // Pump skid in front of each bay.
    const skidC0 = encFront + 0.12;
    const skidC1 = hc - 0.08;
    const sc = (skidC0 + skidC1) / 2;
    put(a - bw * 0.42, 0.18, skidC0, a + bw * 0.42, 0.3, skidC1, M.steel); // skid channel
    const pumpA = a - bw * 0.18;
    const motorA = a + bw * 0.16;
    const shaftY = 0.62;
    // Pump volute: a squat drum across the run, with a suction stub.
    cyl('c', pumpA, shaftY, sc, Math.min(0.42, skidC1 - skidC0), 0.62, M.drive);
    put(pumpA - 0.16, 0.3, sc - 0.14, pumpA + 0.16, shaftY - 0.28, sc + 0.14, M.drive); // pedestal
    // Motor along the run with cooling fins and a terminal box.
    cyl('a', motorA, shaftY, sc, bw * 0.34, 0.5, M.drive);
    for (let f = -3; f <= 3; f++) cyl('a', motorA + f * bw * 0.045, shaftY, sc, 0.018, 0.56, M.drive, null, 14);
    put(motorA - 0.12, shaftY + 0.24, sc - 0.1, motorA + 0.08, shaftY + 0.42, sc + 0.1, M.drive, null);
    put(motorA - bw * 0.14, 0.3, sc - 0.18, motorA + bw * 0.14, shaftY - 0.22, sc + 0.18, M.steel); // motor feet
    // Coupling guard (painted safety yellow) between pump and motor.
    put(pumpA + 0.2, shaftY - 0.13, sc - 0.13, motorA - bw * 0.17, shaftY + 0.13, sc + 0.13, M.guard);
    // Riser from the pump up to the header, with a gate valve and handwheel.
    const riserTop = H - 0.55;
    cyl('y', pumpA, (shaftY + 0.3 + riserTop) / 2, sc, riserTop - shaftY - 0.3, 0.16, M.metal);
    const valveY = Math.min(1.55, riserTop - 0.35);
    cyl('y', pumpA, valveY, sc, 0.26, 0.26, M.drive);
    const wheel = MeshBuilder.CreateTorus('handwheel', { diameter: 0.42, thickness: 0.035, tessellation: 18 }, h.scene);
    wheel.position.set(alongX ? cx + pumpA : cx + sc * front, y0 + valveY + 0.26, alongX ? cz + sc * front : cz + pumpA);
    h.add(wheel, M.guard, null);
    cyl('y', pumpA, valveY + 0.2, sc, 0.14, 0.04, M.metal, null, 8); // stem
    // Status lamp: a small, dim indicator, not a neon strip.
    const lamp = MeshBuilder.CreateSphere('statusLamp', { diameter: 0.07, segments: 6 }, h.scene);
    lamp.position.set(alongX ? cx + motorA - 0.02 : cx + (sc + 0.11) * front, y0 + shaftY + 0.36, alongX ? cz + (sc + 0.11) * front : cz + motorA - 0.02);
    h.add(lamp, M.lamp, null);
  }
  // Header pipe along the whole bank, flanged at each bay joint, on brackets from the enclosure.
  const headC = hc - 0.32;
  cyl('a', 0, H - 0.55, headC, run - 0.2, 0.3, M.metal);
  for (let k = 0; k <= bays; k++) {
    const a = -ha + 0.1 + k * ((run - 0.2) / bays);
    cyl('a', a, H - 0.55, headC, 0.05, 0.4, M.steel, null);
    put(a - 0.04, H - 0.75, encFront, a + 0.04, H - 0.68, headC, M.steel, null); // bracket
  }
  // Cable tray on the roof edge: ladder tray with a bundle of cables.
  put(-ha + 0.1, H - 0.02, encFront - 0.35, ha - 0.1, H + 0.02, encFront - 0.33, M.steel, null);
  put(-ha + 0.1, H - 0.02, encFront - 0.05, ha - 0.1, H + 0.02, encFront - 0.03, M.steel, null);
  for (const c of [-0.28, -0.2, -0.12]) cyl('a', 0, H + 0.04, encFront + c, run - 0.3, 0.05, M.cable, null, 8);

  // Roof filter vessels where the gameplay colliders stand (1.5 x 1.6 x 1.5 above the box top).
  const vessel = smoothLatheData([[0.62, 0], [0.64, 0.08], [0.6, 0.12], [0.6, 1.18], [0.64, 1.22], [0.62, 1.3], [0.48, 1.46], [0.2, 1.56], [0, 1.58]], 24);
  for (const a of machineRoofSlots(run)) {
    const m = new Mesh('filterVessel', h.scene);
    vessel.applyToMesh(m);
    m.position.set(alongX ? cx + a : cx, y1, alongX ? cz : cz + a);
    h.add(m, M.casing, 'wall');
    // Flange band, inlet pipe to the header and a pressure gauge stub.
    cyl('y', a, H + 0.62, 0, 0.07, 1.3, M.steel, null, 24);
  }
}
