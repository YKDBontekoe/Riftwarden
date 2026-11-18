import { useEffect, useRef, useState } from 'react';
import type { Game } from '../../core/Game';
import { type HitKind, uiEvents, useHud } from '../store';
import { Num } from './widgets';

export function Crosshair() {
  const spread = useHud((s) => s.spread);
  const build = useHud((s) => s.buildMode);
  const overheated = useHud((s) => s.overheated);
  const heat = useHud((s) => s.heat);
  const g = Math.round(spread);
  // Heat arc hugging the right of the reticle.
  const r = 26;
  const arc = Math.PI * 0.5;
  const a0 = -arc / 2;
  const a1 = a0 + arc * Math.max(0.001, heat);
  const p = (a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
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
    </div>
  );
}

export function Hitmarker() {
  const [state, setState] = useState<{ kind: HitKind; id: number } | null>(null);
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    const off = uiEvents.on('hit', (kind) => {
      id++;
      setState({ kind, id });
      clearTimeout(timer);
      timer = setTimeout(() => setState(null), kind === 'kill' ? 320 : 160);
    });
    return () => {
      off();
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
    </div>
  );
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

/** Floating damage numbers, positioned imperatively each animation frame (no per-frame React renders). */
export function DamageNumbers({ game }: { game: Game }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const live: Num[] = [];
    const pool: HTMLDivElement[] = [];
    const off = uiEvents.on('damageNumber', (e) => {
      if (!host.current) return;
      if (!e.player && e.kind !== 'kill' && Math.random() < 0.5) return; // keep turret noise down
      if (live.length > 40) {
        const old = live.shift()!;
        old.el.style.display = 'none';
        pool.push(old.el);
      }
      const el = pool.pop() ?? document.createElement('div');
      el.className = `dmg ${e.kind} ${e.player ? 'own' : 'ally'}`;
      el.textContent = String(e.amount);
      el.style.display = 'block';
      if (!el.parentElement) host.current.appendChild(el);
      live.push({ el, x: e.x, y: e.y, z: e.z, t: 0, dx: (Math.random() - 0.5) * 40 });
    });
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (let i = live.length - 1; i >= 0; i--) {
        const n = live[i];
        n.t += dt;
        const life = 0.8;
        if (n.t >= life) {
          n.el.style.display = 'none';
          pool.push(n.el);
          live.splice(i, 1);
          continue;
        }
        const p = game.project(n.x, n.y + 0.4 + n.t * 1.1, n.z);
        if (!p) {
          n.el.style.opacity = '0';
          continue;
        }
        const pop = n.t < 0.1 ? 1 + (0.1 - n.t) * 7 : 1;
        n.el.style.opacity = String(Math.min(1, (life - n.t) * 4));
        n.el.style.transform = `translate(${p.x + n.dx * n.t}px, ${p.y}px) translate(-50%, -50%) scale(${pop})`;
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
