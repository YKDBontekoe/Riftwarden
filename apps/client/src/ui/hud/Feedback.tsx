import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Game } from '@riftwarden/game/core/Game';
import { type HitKind, uiEvents } from '@riftwarden/game/ui/store';
import { useHud } from '../useHud';
import { Num } from './widgets';

export function Crosshair() {
  const spread = useHud((s) => s.spread);
  const build = useHud((s) => s.buildMode);
  const overheated = useHud((s) => s.overheated);
  const heat = useHud((s) => s.heat);
  const charge = useHud((s) => s.charge);
  const { reticle, reticleSize, aimFeedback } = useHud((s) => s.combatUi);
  const target = useHud((s) => s.aimTarget);
  // Charging tightens the reticle: the brackets close in as the shot builds.
  const g = reticle === 'fixed' && !build ? 9 : Math.round(spread * (1 - charge * 0.45));
  // Heat arc hugging the right of the reticle.
  const r = 26;
  const arc = Math.PI * 0.5;
  const a0 = -arc / 2;
  const a1 = a0 + arc * Math.max(0.001, heat);
  const p = (a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  const q = (a: number) => `${(-Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  return (
    <div className={`crosshair ${build ? 'build' : ''} ${overheated ? 'hot' : ''}`} data-reticle={build ? 'dynamic' : reticle} data-target={aimFeedback && !build ? target ?? undefined : undefined} style={{ '--reticle-scale': reticleSize } as CSSProperties}>
      {(build || reticle !== 'dot') && <>
        <span className="ch" style={{ transform: `translate(-50%, ${-g - 9}px)` }} />
        <span className="ch" style={{ transform: `translate(-50%, ${g + 1}px)` }} />
        <span className="ch h" style={{ transform: `translate(${-g - 9}px, -50%)` }} />
        <span className="ch h" style={{ transform: `translate(${g + 1}px, -50%)` }} />
      </>}
      <span className="dot" />
      <span className="aim-mark" aria-hidden="true" />
      {!build && overheated && <span className="reticle-venting" aria-hidden="true">Venting</span>}
      {!build && heat > 0.02 && (
        <svg className="heat-arc" viewBox="-40 -40 80 80" width="80" height="80">
          <path d={`M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a0 + arc)}`} className="bg" />
          <path d={`M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`} className={`fg ${heat > 0.7 ? 'warm' : ''} ${overheated ? 'over' : ''}`} />
        </svg>
      )}
      {!build && charge > 0.02 && (
        // Charge arc mirrors the heat arc on the left; a full charge pulses the ring.
        <svg className={`charge-arc ${charge >= 0.999 ? 'full' : ''}`} viewBox="-40 -40 80 80" width="80" height="80" data-testid="charge-arc">
          <path d={`M ${q(a0)} A ${r} ${r} 0 0 0 ${q(a0 + arc)}`} className="bg" />
          <path d={`M ${q(a0)} A ${r} ${r} 0 0 0 ${q(a0 + arc * charge)}`} className="fg" />
          {charge >= 0.999 && <circle r={r - 6} className="ready" />}
        </svg>
      )}
    </div>
  );
}

const LIMB_LABEL = { cannon: 'CANNON SHEARED · DISARMED', arm: 'ARM SEVERED', head: 'SENSOR HEAD OFF · BLINDED', leg: 'LEG SHOT OFF · CRAWLING' } as const;
const MARKER_PRIORITY = { hit: 0, shield: 0, crit: 1, limb: 2, kill: 3 } as const;
const MARKER_DURATION = { hit: 160, shield: 160, crit: 160, limb: 620, kill: 320 } as const;

export function Hitmarker() {
  const [state, setState] = useState<{ kind: HitKind | 'limb'; id: number; label?: string } | null>(null);
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    let holdUntil = 0;
    let priority = 0;
    const show = (kind: HitKind | 'limb', label?: string) => {
      const now = performance.now();
      if (now < holdUntil && MARKER_PRIORITY[kind] < priority) return;
      const duration = MARKER_DURATION[kind];
      priority = MARKER_PRIORITY[kind];
      holdUntil = now + (kind === 'limb' ? 260 : duration);
      id++;
      setState({ kind, id, label });
      clearTimeout(timer);
      timer = setTimeout(() => setState(null), duration);
    };
    const offHit = uiEvents.on('hit', (kind) => show(kind));
    const offLimb = uiEvents.on('limb', (l) => show('limb', LIMB_LABEL[l]));
    return () => {
      offHit();
      offLimb();
      clearTimeout(timer);
    };
  }, []);
  if (!state) return null;
  return (
    <div key={state.id} className={`hitmarker ${state.kind}`}>
      <span />
      <span />
      <span />
      <span />
      {state.kind === 'kill' && <i className="kill-ring" />}
      {state.kind === 'limb' && <em className="limb-label">{state.label}</em>}
    </div>
  );
}

/** Kill flash: a brief warm pulse at the screen edges on every player kill (off with reduced motion via CSS). */
export function KillPulse() {
  const [id, setId] = useState(0);
  useEffect(() => uiEvents.on('hit', (kind) => kind === 'kill' && setId((n) => n + 1)), []);
  if (!id) return null;
  return <div key={id} className="kill-pulse" />;
}

/** Threat arcs keep pointing at the source as the player turns. */
export function DamageDirection({ game }: { game: Game }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const marks = new Map<number, { el: HTMLDivElement; bearing: number; severity: number; until: number }>();
    let raf = 0;
    const draw = (now: number) => {
      for (const [sector, mark] of marks) {
        const remaining = mark.until - now;
        if (remaining <= 0) {
          mark.el.remove();
          marks.delete(sector);
          continue;
        }
        mark.el.style.transform = `rotate(${mark.bearing - game.player.yaw}rad)`;
        mark.el.style.opacity = String((0.55 + mark.severity * 0.45) * Math.min(1, remaining / 350));
      }
      raf = marks.size ? requestAnimationFrame(draw) : 0;
    };
    const off = uiEvents.on('hurt', ({ bearing, severity, shield }) => {
      if (bearing === null || !host.current) return;
      const sector = (Math.round(bearing / (Math.PI / 4)) + 8) % 8;
      const now = performance.now();
      const previous = marks.get(sector);
      const el = previous?.el ?? document.createElement('div');
      el.className = shield ? 'arc shield' : 'arc hull';
      if (!previous) {
        el.appendChild(document.createElement('i'));
        host.current.appendChild(el);
      }
      marks.set(sector, { el, bearing, severity, until: now + 950 });
      if (!raf) draw(now);
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
      for (const { el } of marks.values()) el.remove();
    };
  }, [game]);
  return <div ref={host} className="dmg-dir" aria-hidden="true" />;
}

// ---------------------------------------------------------------- world-anchored UI

/** Hits on one target within this window add up into a single rising number instead of stacking new ones. */
const MERGE_WINDOW = 0.45;
const KIND_RANK: Record<HitKind, number> = { shield: 0, hit: 1, crit: 2, kill: 3 };

/**
 * Floating damage numbers, positioned imperatively each animation frame (no per-frame React renders). Rapid
 * fire on one enemy merges into one total that pops on every hit and keeps the strongest kind (crit / kill).
 */
export function DamageNumbers({ game }: { game: Game }) {
  const host = useRef<HTMLDivElement>(null);
  const { damageNumbers, reduceMotion } = useHud((s) => s.combatUi);
  useEffect(() => {
    const container = host.current;
    if (!container || damageNumbers === 'off') return;
    const reduced = reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    type Live = Num & { total: number; kind: HitKind; pop: number; target?: number; player: boolean };
    // Element tint (non-kinetic) and affinity mark: ▲ weak (bigger), ▼ resisted (dimmer).
    const cls = (kind: HitKind, player: boolean, el?: string, aff?: number) =>
      `dmg ${kind} ${player ? 'own' : 'ally'}${el && el !== 'none' && el !== 'kinetic' ? ` el-${el}` : ''}${aff === 1 ? ' aff-weak' : aff === -1 ? ' aff-resist' : ''}`;
    const live: Live[] = [];
    const pool: HTMLDivElement[] = [];
    const personal = new Map<number, Live>();
    const allied = new Map<number, Live>();
    const group = (player: boolean) => player ? personal : allied;
    const drop = (n: Live) => {
      n.el.style.display = 'none';
      pool.push(n.el);
      const byTarget = group(n.player);
      if (n.target !== undefined && byTarget.get(n.target) === n) byTarget.delete(n.target);
    };
    const off = uiEvents.on('damageNumber', (e) => {
      if (!e.player && damageNumbers === 'personal') return;
      const byTarget = group(e.player);
      const merge = e.target !== undefined ? byTarget.get(e.target) : undefined;
      if (merge && merge.t < MERGE_WINDOW) {
        merge.total += e.amount;
        if (KIND_RANK[e.kind] >= KIND_RANK[merge.kind]) merge.kind = e.kind;
        merge.el.className = cls(merge.kind, e.player, e.el, e.aff);
        merge.el.textContent = String(merge.total);
        merge.x = e.x;
        merge.y = e.y;
        merge.z = e.z;
        merge.t = Math.min(merge.t, 0.12);
        merge.pop = 1;
        return;
      }
      if (live.length >= 40) {
        const ally = live.findIndex((n) => !n.player);
        if (ally < 0 && !e.player) return;
        drop(live.splice(Math.max(0, ally), 1)[0]);
      }
      const el = pool.pop() ?? document.createElement('div');
      el.className = cls(e.kind, e.player, e.el, e.aff);
      el.textContent = String(e.amount);
      el.style.display = 'block';
      el.style.opacity = '0';
      if (!el.parentElement) container.appendChild(el);
      const n: Live = { el, x: e.x, y: e.y, z: e.z, t: 0, dx: (Math.random() - 0.5) * 40, total: e.amount, kind: e.kind, pop: 1, target: e.target, player: e.player };
      live.push(n);
      if (e.target !== undefined) byTarget.set(e.target, n);
    });
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (let i = live.length - 1; i >= 0; i--) {
        const n = live[i];
        n.t += dt;
        n.pop = Math.max(0, n.pop - dt * 9);
        const life = n.kind === 'kill' ? 0.9 : 0.75;
        if (n.t >= life) {
          drop(n);
          live.splice(i, 1);
          continue;
        }
        const travel = reduced ? 0 : n.t;
        const p = game.project(n.x, n.y + 0.4 + travel * 1.1, n.z);
        if (!p) {
          n.el.style.opacity = '0';
          continue;
        }
        const scale = reduced ? 1 : 1 + n.pop * n.pop * 0.7;
        n.el.style.opacity = String(Math.min(1, (life - n.t) * 4));
        n.el.style.transform = `translate(${p.x + n.dx * travel}px, ${p.y}px) translate(-50%, -50%) scale(${scale})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
      container.replaceChildren();
    };
  }, [game, damageNumbers, reduceMotion]);
  return <div className="dmg-host" ref={host} />;
}

/** Kill chain counter beside the reticle: grows with every kill inside the chain window, fades when it ends. */
export function KillChain() {
  const [st, setSt] = useState<{ n: number; id: number } | null>(null);
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    const off = uiEvents.on('chain', (n) => {
      setSt({ n, id: ++id });
      clearTimeout(timer);
      timer = setTimeout(() => setSt(null), 2400);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  if (!st) return null;
  const tier = st.n >= 12 ? 'max' : st.n >= 6 ? 'hot' : '';
  const label = st.n >= 12 ? 'OVERDRIVE' : st.n >= 6 ? 'RAMPAGE' : 'CHAIN';
  return (
    <div className={`kill-chain ${tier}`}>
      <b key={st.id}>×{st.n}</b>
      <span>{label}</span>
    </div>
  );
}

/** Health/shield bars over recently damaged hostiles. Imperative DOM pool. */
export function HealthBars({ game }: { game: Game }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = new Map<number, HTMLDivElement>();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const seen = new Set<number>();
      const pp = game.player.position;
      for (const e of game.enemies.active) {
        if (!e.alive || e.hidden || e.def.role === 'boss') continue;
        const dx = e.pos.x - pp.x;
        const dz = e.pos.z - pp.z;
        const d2 = dx * dx + dz * dz;
        // Elites, support units and the courier keep their bar + name in view (priority targets); others after a hit.
        const priority = (e.elite || e.def.role === 'support' || e.def.role === 'hvt') && d2 < 45 * 45;
        if (!priority && (!e.lastHit || now - e.lastHit > 2600)) continue;
        if (d2 > 70 * 70) continue;
        const top = e.def.topY + (e.threat ? 0.9 : 0);
        const p = game.project(e.pos.x, e.pos.y + top, e.pos.z);
        if (!p) continue;
        seen.add(e.id);
        let el = els.get(e.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'ehp';
          el.innerHTML = '<div class="ename"></div><div class="hp"><i></i></div><div class="sh"><i></i></div>';
          host.current?.appendChild(el);
          els.set(e.id, el);
        }
        const nm = el.children[0] as HTMLElement;
        const label = e.elite || e.def.role === 'support' || e.def.role === 'hvt' ? e.displayName.toUpperCase() : '';
        if (nm.textContent !== label) {
          nm.textContent = label;
          nm.className = `ename ${e.def.role === 'support' ? 'support' : ''}`;
        }
        const fade = priority ? 1 : Math.min(1, (2600 - (now - e.lastHit)) / 400);
        el.style.opacity = String(fade);
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
        (el.children[1].firstChild as HTMLElement).style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`;
        const sh = el.children[2] as HTMLElement;
        sh.style.display = e.maxShield > 0 ? 'block' : 'none';
        if (e.maxShield > 0) (sh.firstChild as HTMLElement).style.transform = `scaleX(${Math.max(0, e.shield / e.maxShield)})`;
      }
      for (const [id, el] of els) {
        if (!seen.has(id)) {
          el.remove();
          els.delete(id);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of els.values()) el.remove();
    };
  }, [game]);
  return <div className="ehp-host" ref={host} />;
}

// ---------------------------------------------------------------- radar
