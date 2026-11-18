import { type Scene, Vector3 } from '@babylonjs/core';
import { type Emitter, sfx } from '../audio/Sfx';
import { damp } from '../visuals/anim';
import { buildWardenDrone, type DroneRig } from '../visuals/droneModel';
import type { Kit } from '../visuals/kit';
import type { Palette } from '../visuals/materials';
import { angleDelta } from './StationFocus';
import { findPath, nearestNode, type NavGraph } from './ambientNav';

/** What the drones need from the HQ (narrow on purpose). */
export interface AmbientHost {
  scene: Scene;
  kit: Kit;
  pal: Palette;
  /** The player's position (drones keep their distance). */
  playerPosition(): Vector3;
}

interface Drone {
  rig: DroneRig;
  pos: Vector3;
  vx: number;
  vz: number;
  yaw: number;
  roll: number;
  path: number[];
  step: number;
  idle: number;
  t: number;
  hum: Emitter | null;
}

const HOVER = 2.5;
const SPEED = 2.3;
const KEEP_AWAY = 2.4;

/**
 * A few small service drones that patrol between the HQ stations on the pure waypoint graph:
 * cosmetic life only, no gameplay state and nothing persisted.
 */
export class AmbientDrones {
  private drones: Drone[] = [];
  private stations: number[];

  constructor(private host: AmbientHost, private graph: NavGraph, count = 3, private rand: () => number = Math.random) {
    this.stations = graph.nodes.map((n, i) => (n.kind === 'station' ? i : -1)).filter((i) => i >= 0);
    const rooms = graph.nodes.map((n, i) => (n.kind === 'room' ? i : -1)).filter((i) => i >= 0);
    for (let i = 0; i < count; i++) {
      const rig = buildWardenDrone(host.scene, host.kit, host.pal, 3);
      rig.pod.setEnabled(false);
      rig.root.scaling.setAll(0.6);
      const start = graph.nodes[rooms[Math.floor(rand() * rooms.length)]];
      const pos = new Vector3(start.x + (rand() - 0.5) * 3, HOVER, start.z + (rand() - 0.5) * 3);
      rig.root.position.copyFrom(pos);
      this.drones.push({ rig, pos, vx: 0, vz: 0, yaw: rand() * Math.PI * 2, roll: 0, path: [], step: 0, idle: rand() * 2, t: rand() * 10, hum: null });
    }
  }

  get count(): number {
    return this.drones.length;
  }

  /** Positions (tests / diagnostics). */
  positions(): readonly Vector3[] {
    return this.drones.map((d) => d.pos);
  }

  /** Quiet hum that follows each drone (started once audio is unlocked). */
  startSound(): void {
    for (const d of this.drones) if (!d.hum) d.hum = sfx.emitter('hum', d.pos.x, d.pos.y, d.pos.z, 0.18, 2.5);
  }

  private pickRoute(d: Drone): void {
    const from = nearestNode(this.graph, d.pos.x, d.pos.z);
    let to = this.stations[Math.floor(this.rand() * this.stations.length)];
    if (to === from && this.stations.length > 1) to = this.stations[(this.stations.indexOf(to) + 1) % this.stations.length];
    d.path = findPath(this.graph, from, to);
    d.step = 0;
  }

  update(dt: number): void {
    const pp = this.host.playerPosition();
    for (const d of this.drones) {
      d.t += dt;
      let wantX = 0;
      let wantZ = 0;
      if (d.idle > 0) {
        d.idle -= dt;
        if (d.idle <= 0) this.pickRoute(d);
      } else if (d.step >= d.path.length) {
        d.idle = 3 + this.rand() * 3;
      } else {
        const n = this.graph.nodes[d.path[d.step]];
        const dx = n.x - d.pos.x;
        const dz = n.z - d.pos.z;
        const dist = Math.hypot(dx, dz);
        const last = d.step === d.path.length - 1;
        if (dist < (last ? 0.5 : 1.2)) d.step++;
        else {
          const sp = SPEED * (last ? Math.min(1, dist / 2.5) : 1);
          wantX = (dx / dist) * sp;
          wantZ = (dz / dist) * sp;
        }
      }
      // Give the player room.
      const px = d.pos.x - pp.x;
      const pz = d.pos.z - pp.z;
      const pd = Math.hypot(px, pz);
      if (pd < KEEP_AWAY && pd > 0.01) {
        const push = (1 - pd / KEEP_AWAY) * 3.2;
        wantX += (px / pd) * push;
        wantZ += (pz / pd) * push;
      }
      d.vx = damp(d.vx, wantX, 2.6, dt);
      d.vz = damp(d.vz, wantZ, 2.6, dt);
      d.pos.x += d.vx * dt;
      d.pos.z += d.vz * dt;
      const speed = Math.hypot(d.vx, d.vz);
      let turn = 0;
      if (speed > 0.25) {
        turn = angleDelta(d.yaw, Math.atan2(d.vx, d.vz));
        d.yaw += turn * Math.min(1, dt * 4);
      } else d.yaw += Math.sin(d.t * 0.7) * dt * 0.4;
      d.roll = damp(d.roll, Math.max(-0.4, Math.min(0.4, -turn * 0.35)), 5, dt);
      d.pos.y = HOVER + Math.sin(d.t * 1.7) * 0.08;
      const r = d.rig;
      r.root.position.copyFrom(d.pos);
      r.root.rotation.set(Math.min(0.2, speed * 0.05), d.yaw, d.roll);
      r.body.position.y = Math.sin(d.t * 2.4) * 0.04;
      r.ring.rotation.y += dt * (3 + speed * 2);
      d.hum?.move(d.pos.x, d.pos.y, d.pos.z);
    }
  }

  dispose(): void {
    for (const d of this.drones) {
      d.hum?.dispose();
      d.rig.root.dispose(false, false);
      d.rig.accent.dispose();
    }
    this.drones = [];
  }
}
