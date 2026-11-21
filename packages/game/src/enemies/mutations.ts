/**
 * M10 mutation runtime (the M6 modifiers live in EnemyManager.updateElite). Called from EnemyManager for every
 * elite; state is kept in `Enemy.mut` so pooled objects reset cleanly on spawn.
 *
 *   regenerating  heals regenRate x max HP / s after regenDelay s without losing HP (burning stops it)
 *   splitting     on death: splitCount copies of its kind at splitHp health, no modifiers
 *   shielded      energy barrier = shieldShare x max HP (applied on spawn; the shared shield regen recharges it)
 *   blinking      every blinkEvery s: phases blinkDist m forward along its path (not while shocked/frozen)
 *   frostbound    chill/freeze immune (Director); telegraphed frost nova: drone damage, towers shorted
 *   molten        burn immune (Director); drops slag pools behind it (arena hazard, scorches the drone)
 */
import { Color3, Vector3 } from '@babylonjs/core';
import { sfx } from '../audio/Sfx';
import { isBurning, isFrozen, isShocked } from '@riftwarden/rules/combat/status';
import { ELITE } from '@riftwarden/rules/survival/elites';
import type { Enemy, EnemyContext, EnemyManager } from './EnemyManager';

const TMP = new Vector3();
const TMP2 = new Vector3();

export interface MutationState {
  quiet: number;
  lastHp: number;
  blinkCd: number;
  novaCd: number;
  novaWind: number;
  novaMark: number;
  slagCd: number;
}

export const freshMutationState = (): MutationState => ({ quiet: 0, lastHp: 0, blinkCd: ELITE.blinkEvery * Math.random(), novaCd: 2 + ELITE.novaEvery * Math.random(), novaWind: 0, novaMark: 0, slagCd: 0 });

/** Spawn-time setup (after modifiers were applied). */
export function setupMutations(e: Enemy): void {
  e.mut = freshMutationState();
  e.mut.lastHp = e.hp;
  if (e.has('shielded')) {
    const s = e.maxHp * ELITE.shieldShare;
    e.maxShield += s;
    e.shield += s;
  }
}

/** Per-frame mutation mechanics (hostile time). */
export function updateMutations(e: Enemy, hdt: number, ctx: EnemyContext, m: EnemyManager): void {
  const st = e.mut;
  const pinned = isShocked(e.status) || isFrozen(e.status);
  if (e.has('regenerating')) {
    if (e.hp < st.lastHp - 0.01) st.quiet = 0;
    else st.quiet += hdt;
    if (st.quiet > ELITE.regenDelay && !isBurning(e.status) && e.hp < e.maxHp) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * ELITE.regenRate * hdt);
      if (Math.random() < hdt * 3) ctx.effects.burst('build', e.center(TMP), 1, undefined, 0.5);
    }
    st.lastHp = e.hp;
  }
  if (e.has('blinking') && e.state === 'move' && !pinned) {
    st.blinkCd -= hdt;
    if (st.blinkCd <= 0) {
      st.blinkCd = ELITE.blinkEvery * (0.8 + Math.random() * 0.4);
      blink(e, ctx, m);
    }
  }
  if (e.has('frostbound')) {
    if (st.novaWind > 0) {
      st.novaWind -= hdt;
      if (st.novaWind <= 0) frostNova(e, ctx);
    } else {
      st.novaCd -= hdt;
      if (st.novaCd <= 0) {
        st.novaCd = ELITE.novaEvery;
        const c = e.center(TMP);
        const r2 = (ELITE.novaRadius + 2) ** 2;
        const near = (ctx.player.alive && Vector3.DistanceSquared(c, ctx.player.position) < r2) || ctx.towers.some((t) => !t.building && (t.pos.x - c.x) ** 2 + (t.pos.z - c.z) ** 2 < r2);
        if (near && !pinned) {
          st.novaWind = ELITE.novaWindup;
          st.novaMark = ctx.tele.marker(new Vector3(e.pos.x, 0, e.pos.z), ELITE.novaRadius, ELITE.novaWindup, 'blue', () => (e.alive ? TMP2.set(e.pos.x, 0, e.pos.z) : null));
        }
      }
    }
  }
  if (e.has('molten') && e.state === 'move') {
    st.slagCd -= hdt;
    if (st.slagCd <= 0) {
      st.slagCd = ELITE.slagEvery;
      ctx.hazard?.(e.pos.x, e.pos.z, ELITE.slagRadius, 'slag', ELITE.slagLife);
    }
  }
  // Presentation: spins and flickers.
  for (const id of ['regenerating', 'splitting', 'blinking'] as const) {
    const p = e.eliteParts.get(id);
    if (p?.spin && e.has(id)) p.spin.rotation.y += hdt * (id === 'blinking' ? 2 + (1 - st.blinkCd / ELITE.blinkEvery) * 8 : 2.4);
  }
  const sh = e.eliteParts.get('shielded');
  if (sh?.core && e.has('shielded')) sh.core.setEnabled(e.shield > 0);
  const mo = e.eliteParts.get('molten');
  if (mo && e.has('molten')) for (const f of mo.flames) f.scaling.y = 0.08 + 0.05 * Math.sin(ctx.time * 9 + f.uniqueId);
}

/** Phase forward along the path (a short teleport with a flash at both ends). */
function blink(e: Enemy, ctx: EnemyContext, m: EnemyManager): void {
  const from = e.center(new Vector3());
  let left: number = ELITE.blinkDist;
  while (left > 0 && e.seg < e.path.length) {
    const p = e.path[e.seg];
    const dx = p.x - e.pos.x;
    const dz = p.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > left) {
      e.pos.x += (dx / d) * left;
      e.pos.z += (dz / d) * left;
      left = 0;
    } else {
      e.pos.x = p.x;
      e.pos.z = p.z;
      left -= d;
      e.seg++;
    }
  }
  if (e.seg >= e.path.length) e.seg = e.path.length - 1;
  e.motion?.reset(e.pos, e.yaw);
  e.root.position.copyFrom(e.pos);
  const to = e.center(new Vector3());
  ctx.effects.burst('zap', from, 8, undefined, 1);
  ctx.effects.burst('zap', to, 8, undefined, 1);
  ctx.tele.line(from, to, 0.18, 'violet', 0.06);
  sfx.play('dash', { pitch: 1.6, volume: 0.5, pan: ctx.panFor(to).pan });
  void m;
}

function frostNova(e: Enemy, ctx: EnemyContext): void {
  const c = new Vector3(e.pos.x, 0.2, e.pos.z);
  ctx.effects.burst('frost', e.center(TMP), 22, undefined, 1.4);
  ctx.effects.ring(c, ELITE.novaRadius, 0.35, new Color3(1.2, 2.2, 3), true);
  ctx.hostileBlast(c, ELITE.novaRadius, { player: e.dmg(ELITE.novaDamage), disable: ELITE.novaDisable, color: 'blue', owner: e });
}

/** Death hook: splitting enemies leave two lesser copies. */
export function mutationDeath(e: Enemy, ctx: EnemyContext): void {
  if (e.has('frostbound') && e.mut.novaMark) ctx.tele.cancel(e.mut.novaMark);
  if (!e.has('splitting')) return;
  for (let i = 0; i < ELITE.splitCount; i++) {
    const a = e.yaw + (i ? 1 : -1) * 1.2;
    const at = new Vector3(e.pos.x + Math.sin(a) * 1.4, 0, e.pos.z + Math.cos(a) * 1.4);
    const child = ctx.summon(e.kind, at);
    if (!child) break;
    child.maxHp = child.hp = Math.max(1, child.maxHp * ELITE.splitHp);
    child.maxShield = child.shield = 0;
  }
  ctx.effects.burst('zap', e.center(TMP), 12, undefined, 1.1);
}
