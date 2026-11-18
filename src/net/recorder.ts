// Presentation capture for the headless server: effects, sounds and HUD events produced by the
// authoritative simulation are recorded and streamed to the replicas (see ClientGame.applyEvent).
import type { Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import type { Effects } from '../fx/Effects';
import type { Ordnance, Telegraphs } from '../fx/Hostile';
import type { WeaponFx } from '../fx/WeaponFx';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { SurvivalRuntime } from '../survival/SurvivalRuntime';
import { uiEvents } from '../ui/store';
import { FX_CALLS, ORDNANCE_CALLS, TELE_CREATE_CALLS, TELE_EDIT_CALLS } from './replicated';
import { arr, enc } from './wire';

/** Replicated event (tuple, see ClientGame for the decoder). `to` restricts delivery to one player. */
export interface NetEvent {
  e: unknown[];
  to?: string;
  /** Everyone except this player (presentation the actor already showed locally). */
  not?: string;
}

/**
 * Presentation recorder for the headless server: effects, sounds and HUD events produced by the
 * authoritative simulation are captured and streamed to the replicas. `pause` silences paths the
 * replicas reproduce on their own (enemy deaths, shield hits) so nothing is shown twice.
 */
export class Recorder {
  out: NetEvent[] = [];
  /** Player that owns the presentation currently being produced (shots, hits): personal events go only to them. */
  owner: string | null = null;
  paused = 0;
  /** Last world position asked for panning: attached to the next sound (positional audio on replicas). */
  panPos: Vector3 | null = null;

  push(e: unknown[], to?: string | null): void {
    if (this.paused > 0) return;
    this.out.push(to ? { e, to } : { e });
  }
  pushExcept(e: unknown[], not: string): void {
    if (this.paused > 0) return;
    this.out.push({ e, not });
  }
  quiet<T>(fn: () => T): T {
    this.paused++;
    try {
      return fn();
    } finally {
      this.paused--;
    }
  }
  take(): NetEvent[] {
    const o = this.out;
    this.out = [];
    return o;
  }
}

/** Sounds and HUD events emitted while this recorder is current (one simulation runs at a time). */
let current: Recorder | null = null;

/** Make `rec` current and return the previous one (for constructors, where `super()` cannot sit inside a callback). */
export function enterRecorder(rec: Recorder | null): Recorder | null {
  const prev = current;
  current = rec;
  return prev;
}

/** Run `fn` with `rec` as the recorder that sounds / HUD events are captured into (restores the previous one). */
export function withRecorder<T>(rec: Recorder, fn: () => T): T {
  const prev = current;
  current = rec;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

const PERSONAL_UI = new Set(['hit', 'damageNumber', 'hurt', 'loot']);
let patched = false;
export function patchGlobals(): void {
  if (patched) return;
  patched = true;
  const play = sfx.play.bind(sfx);
  sfx.play = ((name: string, o: Record<string, unknown> = {}) => {
    const r = current;
    if (r && r.paused === 0) {
      const pos = r.panPos;
      r.panPos = null;
      r.push(['s', name, enc({ ...o, pan: undefined }), pos ? arr(pos) : null], r.owner);
    }
    void play;
  }) as typeof sfx.play;
  const emit = uiEvents.emit.bind(uiEvents);
  uiEvents.emit = ((k: string, v: unknown) => {
    const r = current;
    if (r && r.paused === 0) {
      const personal = PERSONAL_UI.has(k);
      if (!personal || r.owner) r.push(['u', k, enc(v)], personal ? r.owner : null);
    }
    void emit;
  }) as typeof uiEvents.emit;
}


/** The parts of a Game whose presentation is captured. */
export interface PresentationSource {
  readonly fx: Effects;
  readonly wfx: WeaponFx;
  readonly tele: Telegraphs;
  readonly ordnance: Ordnance;
  readonly enemies: EnemyManager;
  readonly survival: SurvivalRuntime;
}

/**
 * Replace the presentation entry points of a server game with recorders: effects, telegraphs and ordnance are
 * encoded into events (enemy-internal presentation is reproduced by the replicas themselves).
 */
export function capturePresentation(g: PresentationSource, rec: Recorder): void {
  const fx = g.fx as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of FX_CALLS) {
    fx[m] = (...args: unknown[]) => rec.push(['f', m, enc(args)]);
  }
  const spawnProjectile = fx.spawnProjectile.bind(g.fx);
  fx.spawnProjectile = (...args: unknown[]) => {
    rec.push(['f', 'spawnProjectile', enc([args[0], args[1], 0])]);
    return rec.quiet(() => spawnProjectile(...args));
  };
  const wfx = g.wfx as unknown as Record<string, (...a: unknown[]) => unknown>;
  wfx.arc = (...args: unknown[]) => rec.push(['w', 'arc', enc(args)]);
  wfx.rail = () => {};
  wfx.bolt = () => {};
  wfx.beam = () => {};
  const tele = g.tele as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of TELE_CREATE_CALLS) {
    const orig = tele[m].bind(g.tele);
    tele[m] = (...args: unknown[]) => {
      const id = orig(...args) as number;
      rec.push(['t', m, id, enc(args)]);
      return id;
    };
  }
  for (const m of TELE_EDIT_CALLS) {
    const orig = tele[m].bind(g.tele);
    tele[m] = (...args: unknown[]) => {
      rec.push(['t', m, args[0], enc(args.slice(1))]);
      return orig(...args);
    };
  }
  const ord = g.ordnance as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ORDNANCE_CALLS) {
    const orig = ord[m].bind(g.ordnance);
    ord[m] = (...args: unknown[]) => {
      const ok = rec.quiet(() => orig(...args));
      if (ok) rec.push(['o', m, g.ordnance.lastId, enc(args)]);
      return ok;
    };
  }
  // Enemy-internal presentation (deaths, shield/armor hits) is reproduced by the replicas themselves.
  const kill = g.enemies.kill.bind(g.enemies);
  g.enemies.kill = (e, fx2, ctx, det) => {
    if (e.alive) g.enemies.hooks.killed?.(e, !!det);
    const h = g.enemies.hooks.killed;
    g.enemies.hooks.killed = undefined;
    try {
      rec.quiet(() => kill(e, fx2, ctx, det));
    } finally {
      g.enemies.hooks.killed = h;
    }
  };
  const damage = g.enemies.damage.bind(g.enemies);
  g.enemies.damage = (e, ...rest) => {
    const res = rec.quiet(() => damage(e, ...rest));
    if (res && res.toShield + res.toHp > 0) rec.push(['ed', e.id, res.toShield > 0 ? 1 : 0]);
    return res;
  };
  // Evolution / gates.
  const evo = g.survival.applyEvolution.bind(g.survival);
  g.survival.applyEvolution = (id, instant) => {
    rec.push(['ev', id, instant ? 1 : 0]);
    return evo(id, instant);
  };
}
