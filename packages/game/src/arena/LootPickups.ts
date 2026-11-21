import { type PhysicsEngineV2, PhysicsRaycastResult, type Scene, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { Effects } from '../fx/Effects';
import { pickInteractable } from '../home/interaction';
import { LootField, type Pickup, PICKUP_RANGE } from '../loot/LootField';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { uiEvents } from '../ui/store';
import { ENV_QUERY } from '../world/physicsGroups';

/** What loot placement and targeting need from the arena (no Game import). */
export interface LootHost {
  readonly scene: Scene;
  readonly loot: LootField;
  readonly fx: Effects;
  /** True when the segment a -> b is blocked by level geometry. */
  blocked(a: Vector3, b: Vector3): boolean;
  panFor(p: Vector3): { volume: number; pan: number };
}

const FROM = new Vector3();
const TO = new Vector3();
const FWD = new Vector3();

/**
 * Physical loot in the arena: where a drop lands (Havok ray down), landing / pickup presentation and which pickup
 * the drone is looking at. Ownership rules stay in RunInventory/RunLedger; the co-op server and replica reuse the
 * placement and targeting and only change who collects.
 */
export class LootPickups {
  private ray = new PhysicsRaycastResult();

  constructor(private h: LootHost) {}

  /** A walkable landing point near `at` (never on top of tall geometry or inside a wall). */
  groundPoint(at: Vector3): Vector3 {
    const physics = this.h.scene.getPhysicsEngine() as PhysicsEngineV2 | null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = attempt === 5 ? 0 : 1 + Math.random() * 1.8;
      const x = at.x + Math.cos(a) * d;
      const z = at.z + Math.sin(a) * d;
      if (!physics) return new Vector3(x, 0, z);
      physics.raycastToRef(FROM.set(x, Math.max(at.y, 0) + 2.5, z), TO.set(x, -3, z), this.ray, ENV_QUERY);
      if (!this.ray.hasHit) continue;
      const y = this.ray.hitPointWorld.y;
      if (y > at.y + 1.2 || this.ray.hitNormalWorld.y < 0.7) continue;
      return new Vector3(x, y, z);
    }
    return new Vector3(at.x, 0, at.z);
  }

  /** A pickup touched down: ring, flash + chime for rare+, feed entry, banner for legendary+. */
  landed(p: Pickup): void {
    const { fx } = this.h;
    const r = rarity(p.item.rarity);
    const c = LootField.color(p.item.rarity);
    fx.ring(p.ground.add(new Vector3(0, 0.08, 0)), 1.2 + r.index * 0.5, 0.45 + r.index * 0.08, c.scale(0.8), true);
    if (r.index >= 2) {
      fx.flashLight(p.focus, 1.5 + r.index, 0.5 + r.index * 0.12, c.scale(0.4));
      const a = this.h.panFor(p.ground);
      sfx.play('lootDrop', { pitch: 0.8 + r.index * 0.12, volume: Math.max(0.5, a.volume), pan: a.pan });
    }
    uiEvents.emit('loot', { kind: 'drop', name: p.item.name, rarity: p.item.rarity, level: p.item.level, category: p.item.category, count: 1 });
    if (r.index >= 4) uiEvents.emit('banner', { title: `${r.label.toUpperCase()} SIGNAL`, sub: p.item.name, tone: r.index >= 5 ? 'red' : 'orange' });
  }

  /** The hold refused a pickup. */
  refused(p: Pickup): void {
    sfx.play('buildDeny');
    uiEvents.emit('loot', { kind: 'full', name: p.item.name, rarity: p.item.rarity, level: p.item.level, category: p.item.category, count: 1 });
  }

  /** A pickup went into the cargo: burst, ring, chime, feed entry; removes it from the field. */
  collected(p: Pickup): void {
    const { fx } = this.h;
    const r = rarity(p.item.rarity);
    const c = LootField.color(p.item.rarity);
    fx.burst('build', p.focus, 14 + r.index * 8);
    fx.ring(p.ground.add(new Vector3(0, 0.1, 0)), 2 + r.index * 0.6, 0.35, c, true);
    if (r.index >= 3) fx.flashLight(p.focus, 2 + r.index, 0.35, c.scale(0.5));
    sfx.play('pickup', { pitch: 1 + r.index * 0.1, volume: 0.8 + r.index * 0.05 });
    this.h.loot.remove(p);
    uiEvents.emit('loot', { kind: 'pickup', name: p.item.name, rarity: p.item.rarity, level: p.item.level, category: p.item.category, count: 1 });
  }

  /** The landed pickup in the view cone within reach and not occluded, or null. */
  target(eye: Vector3, forward: (out: Vector3) => Vector3): Pickup | null {
    const loot = this.h.loot;
    if (loot.count === 0) return null;
    // Distance prefilter first: only pickups within reach go through the cone/occlusion test.
    const r2 = (PICKUP_RANGE + 0.5) * (PICKUP_RANGE + 0.5);
    const cands: { id: string; point: Vector3; range: number; p: Pickup }[] = [];
    for (const p of loot.pickups) {
      if (!loot.landed(p)) continue;
      const dx = p.focus.x - eye.x;
      const dz = p.focus.z - eye.z;
      if (dx * dx + dz * dz <= r2) cands.push({ id: '', point: p.focus, range: PICKUP_RANGE, p });
    }
    if (!cands.length) return null;
    const hit = pickInteractable(cands, eye, forward(FWD), { maxAngle: 0.42, targetRadius: 0.6 }, (c) => this.h.blocked(eye, c.point));
    return hit?.p ?? null;
  }
}
