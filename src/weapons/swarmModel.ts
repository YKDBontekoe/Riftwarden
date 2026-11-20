import { loftData } from '../visuals/sculpt';
import { boxData, prismData } from './geometry';
import type { Ctx, Mounts, V3 } from './model';
import { cylX, cylZ, tubeZ } from './shapes';

/**
 * Drone Swarm hive (viewmodel + preview geometry). A squat carrier body with a drone magazine on top and a launch pod
 * at the front; the pod's tubes are the muzzles (launches cycle through them). Chassis: `swarm_hive` (standard),
 * `swarm_brood` (heavy, taller magazine), `swarm_wasp` (light, slim). Barrels: hex pod, twin racks, hive cluster,
 * long uplink (pod + tracking mast). Seeker pips sit in the tubes and slide forward with the salvo lock (charge hooks).
 */
export function swarmChassis(c: Ctx): Mounts {
  const { a, M } = c;
  const root = a.root;
  const brood = c.b.chassis === 'swarm_brood';
  const wasp = c.b.chassis === 'swarm_wasp';
  const L = brood ? 1.08 : wasp ? 0.9 : 1;
  const H = (brood ? 1.14 : wasp ? 0.9 : 1) * (0.96 + 0.08 * c.b.params.bulk);
  const W = brood ? 0.112 : wasp ? 0.084 : 0.098;
  const z = (v: number) => v * L;
  const y = (v: number) => v * H;

  // Carrier body: a wide, flat-sided housing that narrows into the launch pod mount.
  a.add(loftData([
    { t: z(-0.29), w: W * 0.36, h: y(0.03), v: y(0.012), n: 5 },
    { t: z(-0.24), w: W * 0.5, h: y(0.055), v: y(0.024), n: 6 },
    { t: z(-0.06), w: W * 0.54, h: y(0.06), v: y(0.028), n: 6 },
    { t: z(0.1), w: W * 0.5, h: y(0.052), v: y(0.026), n: 6 },
    { t: z(0.17), w: W * 0.42, h: y(0.044), v: y(0.03), n: 5 },
  ], 'z', 24), M.graphite, root);
  // Drone magazine on the spine: a ribbed box with a lit feed window.
  const magH = brood ? 0.05 : wasp ? 0.03 : 0.04;
  a.add(boxData(W * 0.72, y(magH), z(0.2), 0.006), c.shell, root, [0, y(0.088 + magH / 2), z(-0.1)]);
  for (let i = 0; i < 5; i++) a.add(boxData(W * 0.76, y(0.006), z(0.012), 0.0015), c.trim, root, [0, y(0.09 + magH / 2), z(-0.18 + i * 0.04)]);
  a.add(boxData(W * 0.3, y(0.004), z(0.15), 0.001), c.chargeGlow, root, [0, y(0.092 + magH), z(-0.1)]);
  // Feed chute from the magazine down into the pod root.
  a.add(prismData([[z(0.0), y(0.09)], [z(0.12), y(0.09)], [z(0.17), y(0.055)], [z(0.05), y(0.05)]], W * 0.42, 0.004), M.dark, root);
  for (const side of [-1, 1]) {
    const x = side * W * 0.53;
    // Side cheeks with louvres and a printed band.
    a.add(prismData([[z(-0.26), y(-0.01)], [z(0.12), y(-0.016)], [z(0.16), y(0.03)], [z(0.08), y(0.075)], [z(-0.22), y(0.07)]], 0.012, 0.0035), c.shell, root, [x, 0, 0]);
    for (let i = 0; i < 4; i++) a.add(boxData(0.006, y(0.022), z(0.01), 0.0012), M.dark, root, [x + side * 0.006, y(0.03), z(-0.17 + i * 0.026)], [-0.35, 0, 0]);
    a.add(boxData(0.004, y(0.006), z(0.09), 0.001), c.trim, root, [x + side * 0.007, y(-0.004), z(0.02)]);
    // Rotor stubs: the carrier hovers its drones on two small fans.
    const fan = a.node('hiveFan', root, [side * W * 0.62, y(0.07), z(-0.24)]);
    a.add(tubeZ(0.02, 0.016, -0.004, 0.004, 20), c.trim, fan, [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 3; k++) a.add(boxData(0.032, 0.002, 0.006, 0.0006), M.satin, fan, [0, 0, 0], [0, (k / 3) * Math.PI, 0]);
    c.rig.spin.push({ node: fan, axis: 'y', rate: side * 9 });
  }
  a.add(boxData(0.002, y(0.012), z(0.07), 0.0005), c.chargeGlow, root, [-W * 0.53 - 0.0135, y(0.05), z(-0.08)]);
  a.add(cylX(0.026, -W * 0.5, W * 0.5, 0.004), M.satin, root, [0, y(-0.046), z(-0.04)]);
  return {
    axisY: y(0.03),
    barrelZ: z(0.17),
    core: { pos: [-W * 0.55 - 0.001, y(-0.02), z(-0.05)], len: z(0.16) },
    top: { y: y(0.092 + magH), z0: z(0.02), z1: z(0.1) },
    status: { y: y(0.093 + magH), z: z(-0.2) },
    flank: { y: y(-0.026), z0: z(-0.2), z1: z(0.1), x: W * 0.54 },
    rear: z(-0.29),
  };
}

/** Launch tubes at the given (x, y) offsets around the barrel axis; returns the front z. */
function tubes(c: Ctx, ay: number, offsets: [number, number][], r: number, z0: number, len: number): number {
  const { a, M } = c;
  const slide = c.rig.slide!;
  for (const [x, yy] of offsets) {
    const at: V3 = [x, ay + yy, 0];
    a.add(tubeZ(r, r * 0.78, z0, z0 + len, 16), M.graphite, slide, at);
    a.add(tubeZ(r * 1.06, r * 0.8, z0 + len - 0.008, z0 + len, 16), c.heat, slide, at);
    // Seeker pip waiting in the tube: slides forward with the salvo lock.
    const pip = a.node('seekerPip', slide, [x, ay + yy, z0 + len * 0.6]);
    a.add(cylZ(r * 0.55, -0.01, 0.012, 0.002, 10), c.energy, pip);
    c.rig.charge.push({ node: pip, travel: len * 0.3, z0: pip.position.z });
    const m = a.node('muzzle', slide, [x, ay + yy, z0 + len + 0.01]);
    c.rig.muzzles.push(m);
  }
  return z0 + len + 0.01;
}

export function swarmBarrel(c: Ctx, m: Mounts): number {
  const { a, M, b } = c;
  const slide = c.rig.slide!;
  const ay = m.axisY;
  const z0 = m.barrelZ;
  const lenK = b.params.length;
  const L = 0.1 + 0.04 * lenK;
  const ring = (n: number, rad: number, phase = 0): [number, number][] => Array.from({ length: n }, (_, i) => [Math.cos(phase + (i / n) * Math.PI * 2) * rad, Math.sin(phase + (i / n) * Math.PI * 2) * rad]);
  switch (b.barrel) {
    case 'sw_twin': {
      // Two stacked rectangular racks, three tubes each.
      for (const yy of [0.028, -0.028]) {
        a.add(boxData(0.1, 0.05, L, 0.006), c.shell, slide, [0, ay + yy, z0 + L / 2]);
        a.add(boxData(0.104, 0.006, L * 0.8, 0.0015), c.trim, slide, [0, ay + yy + 0.027, z0 + L / 2]);
      }
      return tubes(c, ay, [[-0.03, 0.028], [0, 0.028], [0.03, 0.028], [-0.03, -0.028], [0, -0.028], [0.03, -0.028]], 0.012, z0 + 0.005, L);
    }
    case 'sw_hive': {
      // Honeycomb: centre + six, wrapped in a hexagonal shroud.
      a.add(loftData([
        { t: z0, w: 0.058, h: 0.058, v: ay, n: 6, roll: Math.PI / 6 },
        { t: z0 + L, w: 0.062, h: 0.062, v: ay, n: 6, roll: Math.PI / 6 },
      ], 'z', 6), c.shell, slide);
      for (let i = 0; i < 6; i++) a.add(boxData(0.006, 0.006, L * 0.9, 0.001), c.chargeGlow, slide, [Math.cos((i / 6) * Math.PI * 2) * 0.06, ay + Math.sin((i / 6) * Math.PI * 2) * 0.06, z0 + L / 2]);
      return tubes(c, ay, [[0, 0], ...ring(6, 0.03, Math.PI / 6)], 0.013, z0 + 0.006, L);
    }
    case 'sw_uplink': {
      // Pod with a tracking mast: a spinning sensor head above the tubes.
      a.add(loftData([
        { t: z0, w: 0.05, h: 0.05, v: ay, n: 2.2 },
        { t: z0 + L, w: 0.054, h: 0.054, v: ay, n: 2.2 },
      ], 'z', 24), c.shell, slide);
      a.add(boxData(0.008, 0.06, 0.012, 0.002), M.graphite, slide, [0, ay + 0.08, z0 + 0.03]);
      const head = a.node('uplinkHead', slide, [0, ay + 0.112, z0 + 0.03]);
      a.add(boxData(0.05, 0.012, 0.018, 0.003), c.trim, head);
      a.add(boxData(0.03, 0.004, 0.004, 0.001), c.chargeGlow, head, [0, 0.007, 0.009]);
      c.rig.spin.push({ node: head, axis: 'y', rate: 2.4 });
      return tubes(c, ay, ring(5, 0.028, Math.PI / 2), 0.011, z0 + 0.006, L * 1.2);
    }
    default: {
      // Hex launch pod: six tubes around a rotating loader.
      a.add(loftData([
        { t: z0, w: 0.05, h: 0.05, v: ay, n: 6, roll: Math.PI / 6 },
        { t: z0 + L, w: 0.053, h: 0.053, v: ay, n: 6, roll: Math.PI / 6 },
      ], 'z', 6), c.shell, slide);
      const loader = a.node('podLoader', slide, [0, ay, z0 + L * 0.5]);
      a.add(tubeZ(0.016, 0.01, -L * 0.45, L * 0.45, 12), M.satin, loader);
      for (let i = 0; i < 3; i++) a.add(boxData(0.004, 0.02, L * 0.7, 0.001), c.chargeGlow, loader, [0, 0, 0], [0, 0, (i / 3) * Math.PI]);
      c.rig.spin.push({ node: loader, axis: 'z', rate: 2 });
      return tubes(c, ay, ring(6, 0.032, Math.PI / 6), 0.012, z0 + 0.006, L);
    }
  }
}
