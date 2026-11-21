import '../babylonSideEffects';
import { Ray } from '@babylonjs/core/Culling/ray.core';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { type Scene } from '@babylonjs/core/scene';
import { sfx } from '../audio/Sfx';
import type { CombatStats } from '@riftwarden/rules/combat/stats';
import type { Input } from '../core/Input';
import type { Wallet } from '@riftwarden/rules/core/tactical';
import type { Construction } from '../defense/Construction';
import type { Turret, TurretContext, TurretHitboxMeta, TurretManager } from '../defense/Turrets';
import type { Effects } from '../fx/Effects';
import type { Player } from '../player/Player';
import { availableParts, configCost, levelCost, MAX_TOWER_LEVEL, partDef, swapCost, type TowerConfig, type TowerSlot } from '@riftwarden/rules/towers/components';
import { planBuildConfig, planRefit } from '@riftwarden/rules/towers/refit';
import { uiEvents } from '../ui/store';
import type { TowerWear } from './TowerWear';

export type TowerEdit = { ok: true; cost: number } | { ok: false; reason: string };

/** What tower building, inspection and refits need from the arena (no Game import). */
export interface TowerHost {
  readonly scene: Scene;
  readonly player: Player;
  readonly input: Input;
  readonly construction: Construction;
  readonly turrets: TurretManager;
  readonly wallet: Wallet;
  readonly fx: Effects;
  readonly stats: CombatStats;
  readonly turretCtx: TurretContext;
  readonly towerTech: ReadonlySet<string>;
  readonly wear: TowerWear;
  /** Mazing arena: towers can be breached, wrecked and repaired. */
  readonly mazing: boolean;
  /** Template new towers are built from. */
  buildConfig: TowerConfig;
  /** Why tower edits are unavailable right now (null = allowed). */
  editBlock(): string | null;
  /** HUD note under the crosshair. */
  note(text: string, seconds: number): void;
  /** Overridable actions (the co-op replica turns them into server requests). */
  modify(t: Turret, what: 'level' | TowerSlot, id?: string): TowerEdit;
  recycle(t: Turret): void;
  repair(t: Turret): void;
  bumpStats(): void;
  /** Durability scale for new towers (wave damage). */
  towerHpScale(): number;
  /** Bumped when tower/inventory panels should refresh. */
  changed(): void;
}

const HOTKEYS: readonly [string, TowerSlot][] = [['KeyC', 'weapon'], ['KeyV', 'core'], ['KeyN', 'modifier'], ['KeyM', 'base']];
/** Seconds X must be held to recycle a tower. */
const RECYCLE_HOLD = 0.6;

/**
 * The drone's tower controls: which tower is under the crosshair, hold-X recycle, F repair, refit hotkeys
 * (R level, C/V/N parts) and build-template cycling in build mode. Rules come from `towers/refit`; actions go
 * through the host so the co-op replica can send them to the server instead.
 */
export class TowerControl {
  /** Tower under the crosshair (null in build mode). */
  inspected: Turret | null = null;
  /** Hold-to-recycle progress (0..1). */
  recycleT = 0;
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 30);

  constructor(private h: TowerHost) {}

  reset(): void {
    this.inspected = null;
    this.recycleT = 0;
  }

  /** A tower left the field: stop inspecting it. */
  forget(t: Turret): void {
    if (this.inspected === t) this.reset();
  }

  /** Pick the tower under the crosshair and run hold-to-recycle / repair on it. */
  inspect(dt: number, controls: boolean): void {
    const h = this.h;
    let t: Turret | null = null;
    if (controls && !h.construction.active) {
      const cam = h.player.camera;
      this.ray.origin.copyFrom(cam.position);
      cam.getDirectionToRef(Vector3.Forward(), this.ray.direction);
      const hit = h.scene.pickWithRay(this.ray, (m) => (!!m.metadata?.turret || !!m.metadata?.surface) && m.isEnabled());
      const meta = hit?.pickedMesh?.metadata as TurretHitboxMeta | undefined;
      if (meta?.turret && !meta.turret.building && !meta.turret.temporary) t = meta.turret;
    }
    if (t !== this.inspected) this.recycleT = 0;
    this.inspected = t;
    h.construction.showInspect(t);
    if (!t) return;
    if (controls && h.input.pressed('KeyF') && h.mazing) h.repair(t);
    if (!h.input.isDown('KeyX')) {
      this.recycleT = 0;
      return;
    }
    this.recycleT += dt / RECYCLE_HOLD;
    if (this.recycleT >= 1) {
      this.recycleT = 0;
      h.recycle(t);
    }
  }

  /** Local recycle: refund, effects, remove. */
  recycleLocal(t: Turret): void {
    const h = this.h;
    const refund = t.recycleValue;
    h.wallet.earn(refund);
    uiEvents.emit('coresGained', refund);
    h.fx.burst('build', t.head, 30);
    h.fx.debrisBurst(t.head, 6, 4, 0.8);
    h.turrets.remove(t);
    h.bumpStats();
    sfx.play('recycle');
    this.forget(t);
  }

  /** Local repair through the wear rules. */
  repairLocal(t: Turret): void {
    const why = this.h.wear.repair(t);
    if (why) this.fail(why);
    else this.h.note(`${t.name} repaired`, 2.5);
  }

  /** Place a tower from the build template at the construction cursor. Returns the tower or null. */
  placeLocal(): Turret | null {
    const h = this.h;
    const c = h.construction;
    const cost = configCost(h.buildConfig, h.stats.buildCostMult);
    if (!c.valid || !h.wallet.spend(cost)) {
      sfx.play('buildDeny');
      return null;
    }
    const built = h.turrets.add(c.point, h.player.yaw, h.turretCtx, h.buildConfig);
    built.paid = cost;
    built.rescaleHp(h.towerHpScale());
    h.bumpStats();
    h.fx.burst('build', c.point.add(new Vector3(0, 0.5, 0)), 40);
    return built;
  }

  fail(text: string): { ok: false; reason: string } {
    this.h.note(text, 3);
    sfx.play('buildDeny');
    return { ok: false, reason: text };
  }

  /**
   * Upgrade a tower's level or swap its weapon / core / modifier. Validates phase, compatibility, research and
   * resources first, then spends, recomposes numbers from scratch, rebuilds the model and resets attack state.
   */
  refitLocal(t: Turret, what: 'level' | TowerSlot, id?: string): TowerEdit {
    const h = this.h;
    const plan = planRefit({
      phaseBlock: h.editBlock(),
      exists: h.turrets.turrets.includes(t),
      building: t.building,
      config: t.config,
      level: t.level,
      what,
      id,
      tech: h.towerTech,
      cores: h.wallet.cores,
      costMult: h.stats.buildCostMult,
    });
    if (!plan.ok) return this.fail(plan.reason);
    if (!h.wallet.spend(plan.cost)) return this.fail(`Not enough cores (need ${plan.cost})`);
    t.paid += plan.cost;
    t.refit(plan.config, plan.level, h.turretCtx);
    h.bumpStats();
    h.fx.burst('build', t.head, 24);
    h.fx.ring(new Vector3(t.pos.x, t.pos.y + 0.1, t.pos.z), 3, 0.4, new Color3(0.4, 1.8, 2.2), true);
    sfx.play('equip', { pitch: 1.1 });
    h.note(`${t.name} refit${what === 'level' ? ` · level ${plan.level}` : ''}${plan.cost ? ` · -${plan.cost} cores` : ''}`, 3);
    h.changed();
    return { ok: true, cost: plan.cost };
  }

  /** Choose the configuration for towers built from now on (no cost). Incompatible dependants reset to defaults. */
  setBuildConfig(slot: TowerSlot, id: string): { ok: true } | { ok: false; reason: string } {
    const plan = planBuildConfig(this.h.buildConfig, slot, id, this.h.towerTech);
    if (!plan.ok) return plan;
    this.h.buildConfig = plan.config;
    this.h.construction.setTemplate(plan.config);
    this.h.changed();
    return { ok: true };
  }

  /** Next owned + compatible component of a slot (hotkey cycling), or null. */
  nextPart(cfg: TowerConfig, slot: TowerSlot): string | null {
    const list = availableParts(cfg, slot, this.h.towerTech);
    if (list.length < 2) return null;
    const i = list.findIndex((p) => p.id === cfg[slot]);
    return list[(i + 1) % list.length].id;
  }

  /** In-world hotkeys: while aiming at a tower (refit) or in build mode (template). R level, C weapon, V core, N modifier, M base. */
  keys(input: Input): void {
    const h = this.h;
    if (h.construction.active) {
      for (const [key, slot] of HOTKEYS) {
        if (!input.pressed(key)) continue;
        const nxt = this.nextPart(h.buildConfig, slot);
        const r = nxt ? this.setBuildConfig(slot, nxt) : { ok: false as const, reason: 'No other compatible blueprint owned' };
        h.note(r.ok ? `Build template: ${partDef(slot, nxt!)?.name} · ${configCost(h.buildConfig, h.stats.buildCostMult)} cores` : r.reason, 2.5);
        sfx.play(r.ok ? 'ui' : 'buildDeny');
      }
      return;
    }
    const t = this.inspected;
    if (!t) return;
    if (input.pressed('KeyR')) h.modify(t, 'level');
    for (const [key, slot] of HOTKEYS) {
      if (!input.pressed(key) || slot === 'base') continue;
      const nxt = this.nextPart(t.config, slot);
      if (!nxt) this.fail('No other compatible blueprint owned');
      else h.modify(t, slot, nxt);
    }
  }

  /** Inspect card data for HUD / panel. */
  info(t: Turret) {
    const mult = this.h.stats.buildCostMult;
    const slots = (['weapon', 'core', 'modifier'] as const).map((slot) => {
      const nxt = this.nextPart(t.config, slot);
      return { slot, id: t.config[slot], name: partDef(slot, t.config[slot])?.name ?? '?', next: nxt ? partDef(slot, nxt)?.name ?? null : null, nextCost: nxt ? swapCost(t.config, slot, nxt, mult) : 0 };
    });
    return { id: t.id, name: t.name, base: partDef('base', t.config.base)?.name ?? '', level: t.level, maxLevel: MAX_TOWER_LEVEL, levelCost: t.level < MAX_TOWER_LEVEL ? levelCost(t.config, t.level, mult) : 0, slots, st: { ...t.st }, empowered: t.empowered, kills: t.kills, damage: Math.round(t.damageDealt) };
  }
}
