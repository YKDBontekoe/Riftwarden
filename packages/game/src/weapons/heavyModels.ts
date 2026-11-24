import { loftData } from '../visuals/sculpt';
import { boxData, prismData } from './geometry';
import type { Ctx, Mounts, V3 } from './model';
import { cylX, cylZ, tubeZ } from './shapes';

/**
 * Launcher and Flamer viewmodels (and preview geometry), built like the other chassis: the chassis returns mount
 * points, the barrel builder hangs tubes / nozzles on the slide and registers the muzzles.
 *
 * Launcher: a boxy receiver under a fat launch tube with a rear venturi; a rocket warhead glows inside each tube.
 * Chassis `launcher_tube` (standard), `launcher_siege` (heavy, thicker tube), `launcher_hornet` (light, slim).
 * Barrels: launch tube, twin tubes, guided tube (long + guidance collar), thermobaric bore (fat, flared).
 *
 * Flamer: a pump body over a fuel tank, a ribbed feed line into the nozzle, a pilot light under the muzzle.
 * Chassis `flamer_torch`, `flamer_inferno` (heavy, double tank), `flamer_needle` (light). Barrels: spray nozzle,
 * fan manifold (flattened), lance nozzle (long, narrow), twin igniters (stacked nozzles).
 */
export function launcherChassis(c: Ctx): Mounts {
  const { a, M } = c;
  const root = a.root;
  const siege = c.b.chassis === 'launcher_siege';
  const hornet = c.b.chassis === 'launcher_hornet';
  const L = siege ? 1.08 : hornet ? 0.92 : 1;
  const H = (siege ? 1.12 : hornet ? 0.9 : 1) * (0.96 + 0.08 * c.b.params.bulk);
  const W = siege ? 0.112 : hornet ? 0.088 : 0.1;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;
  const tubeR = (siege ? 0.042 : hornet ? 0.03 : 0.036) * H;
  const ay = y(0.05);

  // Receiver: a squared housing under the tube, stepping down into the grip block.
  a.add(loftData([
    { t: z(-0.24), w: W * 0.42, h: y(0.032), v: y(-0.004), n: 4 },
    { t: z(-0.2), w: W * 0.5, h: y(0.04), v: y(-0.002), n: 5 },
    { t: z(0.02), w: W * 0.5, h: y(0.042), v: y(0.0), n: 5 },
    { t: z(0.1), w: W * 0.42, h: y(0.034), v: y(0.004), n: 4 },
  ], 'z', 20), M.graphite, root);
  // The launch tube body runs over the receiver from the venturi to the barrel mount.
  a.add(tubeZ(tubeR * 1.08, tubeR * 0.86, z(-0.27), z(0.12), 28), c.shell, root, [0, ay, 0]);
  for (let i = 0; i < 4; i++) a.add(tubeZ(tubeR * 1.16, tubeR * 1.04, z(-0.2 + i * 0.08), z(-0.18 + i * 0.08), 28), c.trim, root, [0, ay, 0]);
  // Rear venturi: a flared exhaust cone with a heat-tinted lip.
  a.add(tubeZ(tubeR * 1.35, tubeR * 1.1, z(-0.33), z(-0.27), 28), M.dark, root, [0, ay, 0]);
  a.add(tubeZ(tubeR * 1.42, tubeR * 1.3, z(-0.335), z(-0.325), 28), c.heat, root, [0, ay, 0]);
  // Loader hatch on top with a lit round counter.
  a.add(boxData(W * 0.5, y(0.014), z(0.12), 0.004), c.shell, root, [0, ay + tubeR * 1.06, z(-0.1)]);
  a.add(boxData(W * 0.22, y(0.004), z(0.07), 0.001), c.chargeGlow, root, [0, ay + tubeR * 1.06 + y(0.009), z(-0.1)]);
  for (const side of [-1, 1]) {
    const x = side * W * 0.5;
    // Side cheeks: armour plates with bolts and a stencil band.
    a.add(prismData([[z(-0.22), y(-0.03)], [z(0.08), y(-0.03)], [z(0.1), y(0.02)], [z(-0.2), y(0.025)]], 0.01, 0.003), c.shell, root, [x, 0, 0]);
    for (let i = 0; i < 3; i++) a.add(cylX(0.004, -0.003, 0.003, 0.0008, 10), M.satin, root, [x + side * 0.007, y(0.006), z(-0.16 + i * 0.1)]);
    a.add(boxData(0.004, y(0.008), z(0.12), 0.001), c.trim, root, [x + side * 0.006, y(-0.014), z(-0.05)]);
    // Tube saddles tying the tube to the receiver.
    a.add(boxData(0.012, y(0.03), z(0.03), 0.002), M.dark, root, [side * tubeR * 0.85, ay - tubeR * 0.7, z(-0.06)]);
  }
  a.add(boxData(0.002, y(0.012), z(0.06), 0.0005), c.chargeGlow, root, [-W * 0.5 - 0.011, y(0.0), z(-0.08)]);
  return {
    axisY: ay,
    barrelZ: z(0.12),
    core: { pos: [W * 0.55, y(-0.01), z(-0.08)], len: z(0.14) },
    top: { y: ay + tubeR * 1.06 + y(0.007), z0: z(-0.02), z1: z(0.08) },
    status: { y: ay + tubeR * 1.06 + y(0.012), z: z(-0.2) },
    flank: { y: y(-0.02), z0: z(-0.2), z1: z(0.08), x: W * 0.52 },
    rear: z(-0.335),
  };
}

/** One launch tube with a deflector collar, heat lip and a glowing warhead waiting inside; returns the front z. */
function launchTube(c: Ctx, at: V3, r: number, z0: number, len: number, flare = 1): number {
  const { a, M } = c;
  const slide = c.rig.slide!;
  a.add(tubeZ(r, r * 0.84, z0, z0 + len, 24), c.shell, slide, at);
  a.add(tubeZ(r * 1.12 * flare, r * 0.9, z0 + len - 0.018, z0 + len, 24), M.graphite, slide, at);
  a.add(tubeZ(r * 1.16 * flare, r * 0.96 * flare, z0 + len - 0.004, z0 + len, 24), c.heat, slide, at);
  // Warhead: a cone-tipped rocket seated a little inside the tube mouth.
  a.add(cylZ(r * 0.62, z0 + len * 0.45, z0 + len - 0.03, 0.002, 14), M.satin, slide, at);
  a.add(cylZ(r * 0.5, z0 + len - 0.03, z0 + len - 0.012, 0.004, 14), c.energy, slide, at);
  c.rig.muzzles.push(a.node('muzzle', slide, [at[0], at[1], z0 + len + 0.01]));
  return z0 + len + 0.01;
}

export function launcherBarrel(c: Ctx, m: Mounts): number {
  const { a, b } = c;
  const slide = c.rig.slide!;
  const ay = m.axisY;
  const z0 = m.barrelZ;
  const L = 0.13 + 0.05 * b.params.length;
  switch (b.barrel) {
    case 'ln_twin': {
      // Two tubes side by side on a shared bracket; they fire alternately.
      a.add(boxData(0.12, 0.018, 0.03, 0.004), c.trim, slide, [0, ay - 0.032, z0 + 0.02]);
      let f = 0;
      for (const x of [-0.032, 0.032]) f = launchTube(c, [x, ay, 0], 0.026, z0, L);
      return f;
    }
    case 'ln_long': {
      // Long guided tube with a guidance collar and a lit seeker strip.
      a.add(boxData(0.05, 0.05, 0.05, 0.006), c.trim, slide, [0, ay, z0 + 0.04]);
      a.add(boxData(0.006, 0.004, 0.04, 0.001), c.chargeGlow, slide, [0, ay + 0.027, z0 + 0.04]);
      return launchTube(c, [0, ay, 0], 0.03, z0, L * 1.55);
    }
    case 'ln_wide': {
      // Thermobaric bore: a fat tube flaring at the mouth, ribbed for strength.
      for (let i = 0; i < 3; i++) a.add(tubeZ(0.05, 0.046, z0 + 0.02 + i * 0.04, z0 + 0.03 + i * 0.04, 24), c.trim, slide, [0, ay, 0]);
      return launchTube(c, [0, ay, 0], 0.046, z0, L * 0.9, 1.25);
    }
    default:
      return launchTube(c, [0, ay, 0], 0.036, z0, L);
  }
}

export function flamerChassis(c: Ctx): Mounts {
  const { a, M } = c;
  const root = a.root;
  const inferno = c.b.chassis === 'flamer_inferno';
  const needle = c.b.chassis === 'flamer_needle';
  const L = inferno ? 1.06 : needle ? 0.92 : 1;
  const H = (inferno ? 1.1 : needle ? 0.9 : 1) * (0.96 + 0.08 * c.b.params.bulk);
  const W = inferno ? 0.108 : needle ? 0.084 : 0.096;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;
  const ay = y(0.035);

  // Pump body: a rounded housing with a domed rear.
  a.add(loftData([
    { t: z(-0.27), w: W * 0.3, h: y(0.03), v: y(0.03), n: 2.4 },
    { t: z(-0.22), w: W * 0.46, h: y(0.046), v: y(0.032), n: 3 },
    { t: z(0.0), w: W * 0.48, h: y(0.05), v: y(0.034), n: 3 },
    { t: z(0.1), w: W * 0.36, h: y(0.036), v: y(0.035), n: 3 },
  ], 'z', 24), c.shell, root);
  // Fuel tank(s) slung under the body, strapped, with a lit gauge.
  const tanks: number[] = inferno ? [-W * 0.26, W * 0.26] : [0];
  for (const x of tanks) {
    const r = inferno ? 0.03 : 0.036;
    a.add(cylZ(r, z(-0.22), z(0.04), 0.01, 24), M.graphite, root, [x, y(-0.03), 0]);
    for (const zz of [-0.15, -0.04]) a.add(tubeZ(r * 1.08, r, z(zz), z(zz + 0.012), 24), M.satin, root, [x, y(-0.03), 0]);
    a.add(boxData(0.004, 0.006, z(0.14), 0.001), c.chargeGlow, root, [x, y(-0.03) - r - 0.001, z(-0.09)]);
  }
  // Pump fan visible through a top grille (spins while the stream runs).
  const fan = a.node('flamerPump', root, [0, ay + y(0.05), z(-0.1)]);
  a.add(tubeZ(0.024, 0.02, -0.004, 0.004, 20), c.trim, fan, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) a.add(boxData(0.04, 0.002, 0.007, 0.0006), M.satin, fan, [0, 0, 0], [0, (k / 4) * Math.PI, 0]);
  c.rig.spin.push({ node: fan, axis: 'y', rate: 7 });
  // Feed line: a ribbed hose from the tank up into the nozzle root.
  for (let i = 0; i < 6; i++) a.add(tubeZ(0.011, 0.007, z(0.02 + i * 0.016), z(0.032 + i * 0.016), 14), i % 2 ? M.dark : M.satin, root, [W * 0.28, y(-0.005 + i * 0.006), 0]);
  for (const side of [-1, 1]) {
    const x = side * W * 0.47;
    a.add(prismData([[z(-0.2), y(0.0)], [z(0.06), y(0.004)], [z(0.08), y(0.05)], [z(-0.18), y(0.06)]], 0.008, 0.0025), M.graphite, root, [x, 0, 0]);
    for (let i = 0; i < 4; i++) a.add(boxData(0.005, y(0.018), z(0.008), 0.001), M.dark, root, [x + side * 0.005, y(0.03), z(-0.15 + i * 0.03)], [-0.35, 0, 0]);
  }
  return {
    axisY: ay,
    barrelZ: z(0.1),
    core: { pos: [-W * 0.5, y(0.02), z(-0.08)], len: z(0.14) },
    top: { y: ay + y(0.052), z0: z(-0.02), z1: z(0.07) },
    status: { y: ay + y(0.053), z: z(-0.2) },
    flank: { y: y(0.0), z0: z(-0.2), z1: z(0.06), x: W * 0.49 },
    rear: z(-0.27),
  };
}

/** One ribbed nozzle with a pilot light under the mouth; returns the front z. */
function nozzle(c: Ctx, at: V3, r: number, z0: number, len: number): number {
  const { a, M } = c;
  const slide = c.rig.slide!;
  a.add(tubeZ(r, r * 0.7, z0, z0 + len, 20), M.graphite, slide, at);
  const ribs = Math.max(3, Math.round(len / 0.02));
  for (let i = 0; i < ribs; i++) a.add(tubeZ(r * 1.18, r * 0.98, z0 + 0.01 + (i * (len - 0.03)) / ribs, z0 + 0.016 + (i * (len - 0.03)) / ribs, 20), c.trim, slide, at);
  a.add(tubeZ(r * 1.1, r * 0.8, z0 + len - 0.01, z0 + len, 20), c.heat, slide, at);
  // Pilot light: a small igniter under the mouth that glows in the element colour.
  a.add(cylZ(0.005, z0 + len - 0.03, z0 + len - 0.004, 0.001, 10), M.satin, slide, [at[0], at[1] - r - 0.006, 0]);
  a.add(cylZ(0.0045, z0 + len - 0.004, z0 + len + 0.002, 0.001, 10), c.energy, slide, [at[0], at[1] - r - 0.006, 0]);
  c.rig.muzzles.push(a.node('muzzle', slide, [at[0], at[1], z0 + len + 0.012]));
  return z0 + len + 0.012;
}

export function flamerBarrel(c: Ctx, m: Mounts): number {
  const { a, b } = c;
  const slide = c.rig.slide!;
  const ay = m.axisY;
  const z0 = m.barrelZ;
  const L = 0.12 + 0.05 * b.params.length;
  switch (b.barrel) {
    case 'fl_fan': {
      // Fan manifold: a flattened spreader with a lit slot.
      a.add(boxData(0.07, 0.022, L * 0.6, 0.004), c.shell, slide, [0, ay, z0 + L * 0.7]);
      a.add(boxData(0.06, 0.004, 0.006, 0.001), c.chargeGlow, slide, [0, ay, z0 + L + 0.001]);
      return nozzle(c, [0, ay, 0], 0.018, z0, L);
    }
    case 'fl_lance':
      return nozzle(c, [0, ay, 0], 0.014, z0, L * 1.6);
    case 'fl_twin': {
      a.add(boxData(0.03, 0.07, 0.03, 0.004), c.trim, slide, [0, ay, z0 + 0.02]);
      nozzle(c, [0, ay + 0.02, 0], 0.016, z0, L);
      return nozzle(c, [0, ay - 0.02, 0], 0.016, z0, L * 0.9);
    }
    default:
      return nozzle(c, [0, ay, 0], 0.02, z0, L);
  }
}
