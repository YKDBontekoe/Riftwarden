import { Color3, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { Game } from '../core/Game';
import type { Turret } from '../defense/Turrets';
import type { Enemy } from '../enemies/EnemyManager';
import type { EnemyKind } from '../data/defs';
import type { DropSource } from '../loot/drops';
import { DROP_SOURCES } from '../loot/drops';
import type { Category } from '../loot/types';
import { uiEvents } from '../ui/store';
import type { WaveDef } from '../waves/waves';
import { BOSSES } from './bosses';
import { EVENTS, EVENT_TUNING, type EventId } from './events';
import { EVOLUTIONS, type EvolutionId, THEME_LABEL, type WavePlan } from './plan';
import { milestoneLabel, newMilestones, ROMAN } from './records';

const TMP = new Vector3();

export interface Strike {
  pos: Vector3;
  t: number;
  marker: number;
}

/**
 * Arena-side M6 survival state for one run: wave plans from the director, arena evolution, dynamic event
 * mechanics + rewards + cleanup, the high-value target, boss bookkeeping and milestone tracking.
 * Everything lives on the Game and dies with it.
 */
export class SurvivalRuntime {
  plan: WavePlan | null = null;
  /** Event of the wave in combat (null otherwise). */
  event: EventId | null = null;
  eventT = 0;
  private strikes: Strike[] = [];
  private strikeCd = 0;
  private strikeN = 0;
  /** HVT result for the current wave. */
  hvt: { enemy: Enemy | null; result: 'killed' | 'escaped' | null; spawnedAt: number } = { enemy: null, result: null, spawnedAt: 0 };
  /** Evolutions applied so far. */
  readonly evolved = new Set<EvolutionId>();
  /** Surge credits paid this event (statistics). */
  surge = 0;
  bossKills = 0;
  constructor(private g: Game) {}

  get tier() {
    return this.g.cfg.tier;
  }

  // ------------------------------------------------------------------ lifecycle hooks (WaveManager)

  /** Preparation of wave `w`: apply scheduled evolutions and announce what is coming. */
  prep(w: WaveDef): void {
    this.plan = w.plan ?? null;
    // Pre-build rigs for the coming wave (bounded by the active cap) while the player prepares.
    const counts: Partial<Record<EnemyKind, number>> = {};
    for (const sp of w.spawns) counts[sp.kind] = Math.min(14, (counts[sp.kind] ?? 0) + 1);
    if (w.plan?.boss) counts.pylon = 5;
    this.g.enemies.prewarm(counts);
    const p = this.plan;
    if (!p) return;
    for (const id of p.evolved) if (!this.evolved.has(id)) this.applyEvolution(id, p.evolution !== id);
    const tone = p.boss ? 'red' : 'orange';
    if (p.boss) {
      const b = BOSSES[p.boss.id];
      uiEvents.emit('banner', { title: `WARNING · ${b.name}${p.boss.encounter > 1 ? ` ${ROMAN[Math.min(9, p.boss.encounter - 1)]}` : ''}`, sub: `${b.warning}. Prepare defenses: it arrives when the wave starts.`, tone });
      uiEvents.emit('alert', { text: `BOSS INBOUND · ${b.name}`, tone: 'red' });
      sfx.play('alarm', { volume: 0.8 });
    } else if (p.event) {
      const ev = EVENTS[p.event];
      uiEvents.emit('alert', { text: ev.warning, tone: 'orange' });
      if (p.event === 'hvt' && p.signal) uiEvents.emit('alert', { text: `COURIER SIGNAL · ${p.signal.toUpperCase()} CACHE`, tone: 'white' });
      sfx.play('alarm', { volume: 0.5 });
    }
  }

  start(w: WaveDef): void {
    const p = w.plan;
    this.event = p?.event ?? null;
    this.eventT = 0;
    this.strikeCd = 2;
    this.strikeN = 0;
    this.surge = 0;
    this.hvt = { enemy: null, result: null, spawnedAt: 0 };
    if (this.event) {
      const ev = EVENTS[this.event];
      this.g.cfg.run.survival.events.push(this.event);
      uiEvents.emit('banner', { title: ev.name.toUpperCase(), sub: ev.blurb, tone: this.event === 'instability' ? 'cyan' : 'orange' });
      if (this.event === 'instability') this.g.bumpStats();
    }
  }

  cleared(w: WaveDef): void {
    const ev = this.event;
    if (ev) {
      const def = EVENTS[ev];
      const tierMult = this.tier.salvageMult;
      const credits = Math.round(w.clearReward * 0.5 * def.reward.credits * tierMult);
      const salvage = Math.round((4 + w.number) * def.reward.salvage * tierMult);
      const components = def.reward.components + (ev === 'eliteAssault' ? Math.floor(this.tier.id / 2) : 0);
      const hvtOk = ev !== 'hvt' || this.hvt.result === 'killed';
      if (hvtOk && this.g.cfg.run.collect({ credits, salvage, components })) {
        if (credits) uiEvents.emit('creditsGained', credits);
        if (salvage) uiEvents.emit('salvageGained', salvage);
        if (components) uiEvents.emit('componentsGained', components);
      }
      if (def.reward.drop && hvtOk) this.g.dropFrom(DROP_SOURCES[def.reward.drop], new Vector3(0, 3, -5), w.number);
      uiEvents.emit('alert', { text: hvtOk ? `${def.name.toUpperCase()} SURVIVED · BONUS SECURED FOR CHECKPOINT` : `${def.name.toUpperCase()} · TARGET LOST`, tone: hvtOk ? 'blue' : 'orange' });
    }
    this.endEvent();
    this.checkMilestones(w.number);
  }

  /** Clean every temporary event effect (wave cleared, defeat, run reset). */
  endEvent(): void {
    const was = this.event;
    this.event = null;
    for (const s of this.strikes) this.g.tele.cancel(s.marker);
    this.strikes.length = 0;
    if (was === 'instability') this.g.bumpStats();
  }

  // ------------------------------------------------------------------ evolution

  /** Apply an arena evolution (instant = catching up after a debug jump). */
  applyEvolution(id: EvolutionId, instant = false): void {
    if (this.evolved.has(id)) return;
    this.evolved.add(id);
    const d = EVOLUTIONS[id];
    if (id === 'routes') {
      this.g.dynamics.openSouth(instant);
      this.g.openGate('south');
    } else {
      this.g.dynamics.activateInstability(instant);
      this.g.bumpStats();
    }
    if (!instant) {
      uiEvents.emit('banner', { title: d.warning, sub: d.blurb, tone: 'orange' });
      uiEvents.emit('alert', { text: d.warning, tone: 'orange' });
      sfx.play('alarm', { volume: 0.7 });
      sfx.play('grind', { volume: 0.8 });
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, hdt: number): void {
    if (this.event) this.eventT += hdt;
    if (this.event === 'instability' && this.g.waves.phase === 'combat') this.updateStrikes(hdt);
    // High-value target tracking
    if (this.event === 'hvt' && !this.hvt.enemy) {
      const c = this.g.enemies.active.find((e) => e.tag === 'hvt' && e.alive);
      if (c) {
        this.hvt.enemy = c;
        this.hvt.spawnedAt = this.eventT;
        uiEvents.emit('alert', { text: 'VAULT COURIER DETECTED · DESTROY IT BEFORE IT ESCAPES', tone: 'white' });
      }
    }
    void dt;
  }

  private updateStrikes(hdt: number): void {
    const T = EVENT_TUNING;
    this.strikeCd -= hdt;
    if (this.strikeCd <= 0) {
      this.strikeCd = T.strikeEvery;
      // Alternate: near the drone (fair 2 s warning), on a machine, on a tower position.
      const k = this.strikeN++ % 3;
      const pos = new Vector3();
      const pl = this.g.player;
      const enemies = this.g.enemies.active.filter((e) => e.alive && e.pos.y < 1);
      const towers = this.g.turrets.turrets;
      if (k === 0 && pl.alive) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 4;
        pos.set(pl.position.x + Math.cos(a) * r, 0, pl.position.z + Math.sin(a) * r);
      } else if (k === 1 && enemies.length) {
        const e = enemies[Math.floor(Math.random() * enemies.length)];
        pos.set(e.pos.x, 0, e.pos.z);
      } else if (towers.length) {
        const t = towers[Math.floor(Math.random() * towers.length)];
        pos.set(t.pos.x + (Math.random() - 0.5) * 3, t.pos.y, t.pos.z + (Math.random() - 0.5) * 3);
      } else pos.set((Math.random() - 0.5) * 50, 0, (Math.random() - 0.5) * 50);
      const lim = this.g.layout.half - 2;
      pos.x = Math.max(-lim, Math.min(lim, pos.x));
      pos.z = Math.max(-lim, Math.min(lim, pos.z));
      this.strikes.push({ pos, t: T.strikeWindup, marker: this.g.tele.marker(pos, T.strikeRadius, T.strikeWindup, 'blue') });
      sfx.play('charge', { pitch: 2.4, volume: 0.4, pan: this.g.panFor(pos).pan });
    }
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t -= hdt;
      if (s.t > 0) continue;
      this.strikes.splice(i, 1);
      this.strike(s.pos);
    }
  }

  private strike(pos: Vector3): void {
    const T = EVENT_TUNING;
    const g = this.g;
    const w = g.waves.wave;
    g.tele.line(new Vector3(pos.x, 34, pos.z), pos, 0.18, 'white', 0.35);
    g.tele.line(new Vector3(pos.x + 0.6, 30, pos.z - 0.4), pos, 0.14, 'blue', 0.18);
    g.fx.burst('zap', TMP.copyFrom(pos).addInPlaceFromFloats(0, 0.5, 0), 30, undefined, 1.6);
    g.fx.ring(new Vector3(pos.x, pos.y + 0.1, pos.z), T.strikeRadius * 1.15, 0.35, new Color3(0.6, 1.4, 3.6), true);
    g.fx.flashLight(TMP.copyFrom(pos).addInPlaceFromFloats(0, 2, 0), 8, 0.25, new Color3(0.5, 0.8, 1.6));
    sfx.play('arc', { volume: 1, pitch: 0.6, pan: g.panFor(pos).pan });
    sfx.thunder(0.05);
    g.hostileBlast(pos, T.strikeRadius, { player: T.strikeDamage * w.damageMult, disable: 0, enemies: T.strikeDamage * 2.2 * w.hpMult, color: 'blue', shock: true });
    for (const t of g.turrets.turrets) {
      if ((t.pos.x - pos.x) ** 2 + (t.pos.z - pos.z) ** 2 < T.strikeRadius ** 2 && Math.random() < T.towerShortChance * 2) t.disable(3);
    }
  }

  // ------------------------------------------------------------------ kills & rewards

  /** Extra effects of a kill (called before the enemy is released). */
  onKill(e: Enemy): void {
    const s = this.g.cfg.run.survival;
    if (e.elite) s.elitesKilled++;
    if (this.event === 'instability') {
      const c = Math.round(EVENT_TUNING.surgeCredits * this.tier.salvageMult);
      if (this.g.cfg.run.collect({ credits: c })) {
        this.surge += c;
        uiEvents.emit('creditsGained', c);
      }
    }
    if (e.tag === 'hvt') {
      s.hvtKilled++;
      this.hvt.result = 'killed';
      uiEvents.emit('banner', { title: 'VAULT COURIER DESTROYED', sub: `Targeted ${this.plan?.signal ?? 'equipment'} cache recovered`, tone: 'cyan' });
      this.g.dropFrom(this.hvtSource(), e.center(), this.g.waves.number);
    }
    if (e.def.role === 'boss') {
      s.bossesKilled++;
      this.bossKills++;
      s.bosses.push(`${e.def.name} ${ROMAN[Math.min(9, e.encounter - 1)]}`);
      uiEvents.emit('banner', { title: `${e.def.name.toUpperCase()} DESTROYED`, sub: 'Boss cache deployed · secure it before the next checkpoint', tone: 'cyan' });
      this.checkMilestones();
    }
  }

  onEscape(e: Enemy): void {
    if (e.tag === 'hvt') {
      this.g.cfg.run.survival.hvtEscaped++;
      this.hvt.result = 'escaped';
      uiEvents.emit('banner', { title: 'TARGET ESCAPED', sub: 'The Vault Courier left the facility with its cache', tone: 'orange' });
    }
  }

  /** HVT drops favour the announced signal category (hybrid target farming). */
  hvtSource(): DropSource {
    const base = DROP_SOURCES.hvt;
    const sig = (this.plan?.signal ?? 'weapon') as Category;
    const categories = { ...base.categories } as Partial<Record<Category, number>>;
    for (const k of Object.keys(categories) as Category[]) categories[k] = k === sig ? 10 : 1;
    return { ...base, categories };
  }

  /** Elites roll on the elite table, with chance and luck rising per modifier. */
  eliteSource(e: Enemy): DropSource {
    const base = DROP_SOURCES.elite;
    const n = e.mods.length;
    return { ...base, chance: Math.min(1, base.chance + 0.12 * n + (e.tag === 'squad' ? 0.15 : 0)), luck: base.luck + n * 0.35 };
  }

  private checkMilestones(cleared = 0): void {
    const run = this.g.cfg.run;
    const got = newMilestones({ wavesCleared: Math.max(run.wavesCleared, cleared), tier: this.tier.id, survival: run.survival }, run.survival.milestones);
    const known = this.g.cfg.milestones ?? [];
    for (const m of got) {
      run.survival.milestones.push(m.id);
      uiEvents.emit('alert', { text: `MILESTONE · ${milestoneLabel(m.id).toUpperCase()}`, tone: 'white' });
      // First time on this profile: a milestone cache (unsecured until the next checkpoint; never in dev sessions).
      if (!run.survival.dev && !known.includes(m.id)) {
        const credits = Math.round(150 * this.tier.salvageMult);
        const components = 2 + Math.floor(this.tier.id / 2);
        if (run.collect({ credits, components })) {
          uiEvents.emit('creditsGained', credits);
          uiEvents.emit('componentsGained', components);
        }
        this.g.dropFrom(DROP_SOURCES.eliteCache, new Vector3(0, 3, -5), this.g.waves.number);
        uiEvents.emit('banner', { title: 'MILESTONE REACHED', sub: `${milestoneLabel(m.id)} · first-time cache deployed at the reactor`, tone: 'white' });
      }
    }
  }

  // ------------------------------------------------------------------ towers

  /** Fire-rate multiplier from the arena state: conduit-fed near active vents, overdriven during instability. */
  towerBoost(t: Turret): number {
    let m = 1;
    if (this.g.dynamics.nearVent(t.pos.x, t.pos.z)) m *= 1.25;
    if (this.event === 'instability') m *= 1 + EVENT_TUNING.towerOverdrive;
    return m;
  }

  // ------------------------------------------------------------------ HUD

  hud(): import('../ui/store').SurvivalHud {
    const p = this.plan;
    const w = this.g.waves;
    const boss = this.g.enemies.active.find((e) => e.def.role === 'boss' && e.alive) ?? null;
    const bossInfo = boss ? this.g.bossHud(boss) : null;
    const hvtE = this.hvt.enemy && this.hvt.enemy.alive ? this.hvt.enemy : null;
    const upcoming = w.phase === 'prep' && p ? (p.boss ? `BOSS · ${BOSSES[p.boss.id].name}` : p.event ? EVENTS[p.event].name.toUpperCase() : '') : '';
    return {
      theme: p ? THEME_LABEL[p.theme] : '',
      event: this.event ? { id: this.event, name: EVENTS[this.event].name, blurb: EVENTS[this.event].blurb } : null,
      upcoming,
      evolved: [...this.evolved].map((id) => EVOLUTIONS[id].name),
      boss: bossInfo,
      hvt: hvtE ? { hp: hvtE.hp / hvtE.maxHp, shield: hvtE.maxShield > 0 ? hvtE.shield / hvtE.maxShield : 0, escapeIn: Math.max(0, EVENT_TUNING.hvtEscape - ((hvtE.ai as { life?: number }).life ?? 0)), signal: p?.signal ?? '' } : null,
      elites: this.g.enemies.active.filter((e) => e.alive && e.elite).length,
    };
  }
}
