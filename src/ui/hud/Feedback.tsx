import { useEffect, useRef, useState } from 'react';
import type { Game } from '../../core/Game';
import { type HitKind, uiEvents, useHud } from '../store';
import { Num } from './widgets';

export function Crosshair() {
  const spread = useHud((s) => s.spread);
  const build = useHud((s) => s.buildMode);
  const overheated = useHud((s) => s.overheated);
  const heat = useHud((s) => s.heat);
  const charge = useHud((s) => s.charge);
  // Charging tightens the reticle: the brackets close in as the shot builds.
  const g = Math.round(spread * (1 - charge * 0.45));
  // Heat arc hugging the right of the reticle.
  const r = 26;
  const arc = Math.PI * 0.5;
  const a0 = -arc / 2;
  const a1 = a0 + arc * Math.max(0.001, heat);
  const p = (a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  const q = (a: number) => `${(-Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  return (
    <div className={`crosshair ${build ? 'build' : ''} ${overheated ? 'hot' : ''}`}>
      <span className="ch" style={{ transform: `translate(-50%, ${-g - 9}px)` }} />
      <span className="ch" style={{ transform: `translate(-50%, ${g + 1}px)` }} />
      <span className="ch h" style={{ transform: `translate(${-g - 9}px, -50%)` }} />
      <span className="ch h" style={{ transform: `translate(${g + 1}px, -50%)` }} />
      <span className="dot" />
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

export function Hitmarker() {
  const [state, setState] = useState<{ kind: HitKind | 'limb'; id: number; label?: string } | null>(null);
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    let holdUntil = 0;
    const show = (kind: HitKind | 'limb', ms: number, label?: string) => {
      id++;
      setState({ kind, id, label });
      clearTimeout(timer);
      timer = setTimeout(() => setState(null), ms);
    };
    const offHit = uiEvents.on('hit', (kind) => {
      // A part knocked off holds its marker briefly over the ordinary hits that follow it.
      if (performance.now() < holdUntil && kind !== 'kill') return;
      show(kind, kind === 'kill' ? 320 : 160);
    });
    const offLimb = uiEvents.on('limb', (l) => {
      holdUntil = performance.now() + 260;
      show('limb', 620, LIMB_LABEL[l]);
    });
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

/** Red arcs around the reticle pointing toward whatever just hit the player. */
export function DamageDirection() {
  const [marks, setMarks] = useState<{ id: number; angle: number; sev: number }[]>([]);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('hurt', (e) => {
      if (e.angle === null) return;
      const my = ++id;
      setMarks((m) => [...m.slice(-4), { id: my, angle: e.angle!, sev: e.severity }]);
      setTimeout(() => setMarks((m) => m.filter((x) => x.id !== my)), 1100);
    });
  }, []);
  return (
    <div className="dmg-dir">
      {marks.map((m) => (
        <div key={m.id} className="arc" style={{ transform: `rotate(${m.angle}rad)`, ['--sev' as string]: 0.5 + m.sev * 0.5 }}>
          <i />
        </div>
      ))}
    </div>
  );
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
  useEffect(() => {
    type Live = Num & { total: number; kind: HitKind; pop: number; target?: number; player: boolean };
    // Element tint (non-kinetic) and affinity mark: ▲ weak (bigger), ▼ resisted (dimmer).
    const cls = (kind: HitKind, player: boolean, el?: string, aff?: number) =>
      `dmg ${kind} ${player ? 'own' : 'ally'}${el && el !== 'none' && el !== 'kinetic' ? ` el-${el}` : ''}${aff === 1 ? ' aff-weak' : aff === -1 ? ' aff-resist' : ''}`;
    const live: Live[] = [];
    const pool: HTMLDivElement[] = [];
    const byTarget = new Map<number, Live>();
    const drop = (n: Live) => {
      n.el.style.display = 'none';
      pool.push(n.el);
      if (n.target !== undefined && byTarget.get(n.target) === n) byTarget.delete(n.target);
    };
    const off = uiEvents.on('damageNumber', (e) => {
      if (!host.current) return;
      const merge = e.target !== undefined ? byTarget.get(e.target) : undefined;
      if (merge && merge.player === e.player && merge.t < MERGE_WINDOW) {
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
      if (!e.player && e.kind !== 'kill' && Math.random() < 0.5) return; // keep turret noise down
      if (live.length > 40) drop(live.shift()!);
      const el = pool.pop() ?? document.createElement('div');
      el.className = cls(e.kind, e.player, e.el, e.aff);
      el.textContent = String(e.amount);
      el.style.display = 'block';
      if (!el.parentElement) host.current.appendChild(el);
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
        const p = game.project(n.x, n.y + 0.4 + n.t * 1.1, n.z);
        if (!p) {
          n.el.style.opacity = '0';
          continue;
        }
        const scale = 1 + n.pop * n.pop * 0.7;
        n.el.style.opacity = String(Math.min(1, (life - n.t) * 4));
        n.el.style.transform = `translate(${p.x + n.dx * n.t}px, ${p.y}px) translate(-50%, -50%) scale(${scale})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [game]);
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
        if (!e.alive || e.def.role === 'boss') continue;
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
