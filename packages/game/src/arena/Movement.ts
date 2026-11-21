import { Color3, type Mesh, MeshBuilder, type Scene, Vector3 } from '@babylonjs/core';
import type { Director } from '../combat/Director';
import type { CombatStats } from '@riftwarden/rules/combat/stats';
import type { Input } from '../core/Input';
import type { Effects } from '../fx/Effects';
import type { PoundLanding } from '../player/MoveKit';
import { KIT, poundBlast } from '@riftwarden/rules/player/movement';
import type { Player } from '../player/Player';
import { uiEvents } from '../ui/store';
import { unlit } from '../visuals/materials';

/** What the movement kit needs from the arena (no Game import). */
export interface MovementHost {
  readonly scene: Scene;
  readonly player: Player;
  readonly director: Director;
  readonly fx: Effects;
  readonly input: Input;
  readonly stats: CombatStats;
  /** Enemy level scale (pound damage grows with it like flat item stats). */
  readonly attackerScale: number;
  /** The drone is in play and the controls are live (not build mode, menus, defeat). */
  canAct(): boolean;
  /** R is free for the grapple (not levelling the tower under the crosshair). */
  grappleKeyFree(): boolean;
  /** A ground pound landed: apply it (Game.groundPound; co-op clients forward it to the server). */
  pound(at: Vector3, fall: number): void;
}

/** HUD row for the movement kit. */
export interface MoveHud {
  state: string;
  grapple: number;
  grappleMax: number;
  pound: number;
  poundMax: number;
}

const HAND = new Vector3();
const MID = new Vector3();
const DIR = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Arena side of slide / wall-run / grapple / ground pound: grapple input (R or middle mouse), the pound's blast
 * through the director pipeline (source 'effect' / 'move:pound', so it charges the ultimate like other effects),
 * and the grapple line. The movement itself lives in `Player` + `MoveKit`.
 */
export class Movement {
  private rope: Mesh | null = null;
  /** Ground pounds applied this run (diagnostics / tests). */
  pounds = 0;
  lastPound: { at: Vector3; radius: number; damage: number; hit: number } | null = null;

  constructor(private readonly h: MovementHost) {}

  update(): void {
    const { player, input } = this.h;
    const kit = player.kit;
    kit.powerMult = this.h.stats.abilityPowerMult;
    if (this.h.canAct() && (input.mousePressed(1) || (input.pressed('KeyR') && this.h.grappleKeyFree()))) {
      const r = player.grapple();
      if (r === 'miss') uiEvents.emit('notice', { text: 'NO GRAPPLE POINT', tone: 'white' });
    }
    if (kit.landed) {
      const l: PoundLanding = kit.landed;
      kit.landed = null;
      this.h.pound(l.at, l.fall);
    }
    kit.grappleEvent = null;
    this.updateRope();
  }

  /** Apply a ground pound at `at` after a fall of `fall` metres (Game.groundPound; the server runs it per avatar). */
  blast(at: Vector3, fall: number, shooter: Player = this.h.player): number {
    const { director: dir, fx } = this.h;
    const b = poundBlast(fall, this.h.stats.abilityPowerMult);
    const damage = b.damage * this.h.attackerScale;
    const center = at.clone();
    center.y = Math.max(0.6, at.y - 0.4);
    const hit = dir.blast(center, b.radius, damage, 'none', { kind: 'effect', id: 'move:pound' }, dir.bus.newChain(), { falloff: 0.45, shock: fall >= 6 });
    const ground = at.clone();
    ground.y = Math.max(0.05, at.y - 0.85);
    fx.explode(ground, { scale: b.radius / 7, style: fall >= 6 ? 'electric' : undefined, debris: 3, scorch: false });
    fx.ring(ground.add(new Vector3(0, 0.1, 0)), b.radius * 2, 0.45, new Color3(2.2, 2.6, 3.4), true);
    fx.burst('sparks', ground, 18, UP, 1.2);
    shooter.addTrauma(b.shake);
    this.pounds++;
    this.lastPound = { at: center, radius: b.radius, damage, hit };
    return hit;
  }

  hud(): MoveHud {
    const k = this.h.player.kit;
    return { state: k.state, grapple: k.grappleCd, grappleMax: k.grappleCdMax, pound: k.poundCd, poundMax: KIT.poundCooldown };
  }

  dispose(): void {
    this.rope?.dispose();
    this.rope = null;
  }

  private updateRope(): void {
    const p = this.h.player;
    if (!p.kit.grappling) {
      this.rope?.setEnabled(false);
      return;
    }
    if (!this.rope) {
      this.rope = MeshBuilder.CreateCylinder('grappleLine', { height: 1, diameter: 0.035, tessellation: 5 }, this.h.scene);
      this.rope.material = unlit(this.h.scene, 'grappleLineMat', [1.6, 2.6, 3.6]);
      this.rope.isPickable = false;
    }
    // The line leaves from below-right of the view (the drone's hardpoint), not from the eye.
    const f = p.forward(DIR);
    const yaw = p.yaw;
    HAND.copyFrom(p.eye).addInPlaceFromFloats(Math.cos(yaw) * 0.32 + f.x * 0.5, -0.3 + f.y * 0.5, -Math.sin(yaw) * 0.32 + f.z * 0.5);
    const a = p.kit.anchor;
    const len = Vector3.Distance(HAND, a);
    MID.copyFrom(HAND).addInPlace(a).scaleInPlace(0.5);
    const r = this.rope;
    r.setEnabled(true);
    r.position.copyFrom(MID);
    r.scaling.set(1, len, 1);
    // Cylinder axis is +y: point it along hand -> anchor.
    DIR.copyFrom(a).subtractInPlace(HAND).normalize();
    const pitch = Math.acos(Math.max(-1, Math.min(1, DIR.y)));
    const heading = Math.atan2(DIR.x, DIR.z);
    r.rotation.set(pitch, heading, 0);
  }
}
