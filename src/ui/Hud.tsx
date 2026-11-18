import { TeamHud } from './TeamHud';
import { RunBadges } from './Roguelite';
import { useEffect, useRef, useState } from 'react';
import type { Game } from '../core/Game';
import { ARENA } from '../world/layout';
import { getTier } from '../progression/tiers';
import { type BannerEvent, type HitKind, uiEvents, useHud } from './store';
import { LootFeed, LootLabels, LootPrompt } from './LootHud';
import { rarity } from '../loot/rarity';
import { SurvivalHud } from './SurvivalHud';

export function Hud({ game }: { game: Game }) {
  return (
    <div className="hud">
      <Overlays />
      <HealthBars game={game} />
      <DamageNumbers game={game} />
      <LootLabels game={game} />
      <DamageDirection />
      <Crosshair />
      <Hitmarker />
      <LootPrompt />
      <LootFeed />
      <Radar game={game} />
      <TopCenter />
      <SurvivalHud />
      <Cores />
      <RunPanel />
      <PlayerPanel />
      <CenterPanel />
      <WeaponPanel />
      <Banner />
      <Hint />
      <Respawn />
      <RunBadges />
      <Perf />
      <TeamHud />
    </div>
  );
}

// ---------------------------------------------------------------- primitives

/** Segmented bar with a delayed "damage trail" that drains after the real value. */
export function SegBar({ value, tone, segments = 20, marker, className = '' }: { value: number; tone: string; segments?: number; marker?: number; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const [trail, setTrail] = useState(v);
  useEffect(() => {
    if (v >= trail) {
      setTrail(v);
      return;
    }
    const t = setTimeout(() => setTrail(v), 450);
    return () => clearTimeout(t);
  }, [v, trail]);
  return (
    <div className={`segbar ${tone} ${className}`} style={{ ['--segs' as string]: segments }}>
      <div className="trail" style={{ transform: `scaleX(${trail})` }} />
      <div className="fill" style={{ transform: `scaleX(${v})` }} />
      <div className="grid" />
      {marker !== undefined && <div className="marker" style={{ left: `${marker * 100}%` }} />}
    </div>
  );
}

export function Key({ k }: { k: string }) {
  return <kbd>{k}</kbd>;
}

// ---------------------------------------------------------------- overlays

function Overlays() {
  const tactical = useHud((s) => s.tacticalActive);
  const hp = useHud((s) => s.playerHp / s.playerMax);
  const alive = useHud((s) => s.respawnIn <= 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let level = 0;
    const off = uiEvents.on('hurt', (v) => {
      level = Math.min(1, level + 0.35 + v.severity * 0.8);
    });
    const tick = () => {
      if (level > 0) level = Math.max(0, level - 0.025);
      if (ref.current) ref.current.style.setProperty('--hurt', level.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);
  const low = hp < 0.35 && alive ? (0.35 - hp) / 0.35 : 0;
  return (
    <div ref={ref} className="overlays" style={{ ['--low' as string]: low.toFixed(3) }}>
      <div className={`tactical-tint ${tactical ? 'on' : ''}`}>
        <div className="tac-frame" />
      </div>
      <div className="damage-vignette" />
      <div className={`lowhp ${low > 0 ? 'on' : ''}`} />
      <div className="scanlines" />
    </div>
  );
}

function Crosshair() {
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

function Hitmarker() {
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
function DamageDirection() {
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

interface Num {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  t: number;
  dx: number;
}

/** Floating damage numbers, positioned imperatively each animation frame (no per-frame React renders). */
function DamageNumbers({ game }: { game: Game }) {
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
function HealthBars({ game }: { game: Game }) {
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

const RADAR_PX = 184;
const RADAR_RANGE = 57; // metres from center to edge (arena + gate tunnels)

/** North-up tactical map: static layout cached once, dynamic blips at ~20 Hz. */
function Radar({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = RADAR_PX * dpr;
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    const k = (S / 2 - 6 * dpr) / RADAR_RANGE;
    const X = (x: number) => S / 2 + x * k;
    const Y = (z: number) => S / 2 - z * k;

    // Static layer
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const b = base.getContext('2d')!;
    b.fillStyle = 'rgba(4,12,18,0.72)';
    b.fillRect(0, 0, S, S);
    b.strokeStyle = 'rgba(80,220,240,0.06)';
    b.lineWidth = 1;
    for (let g = -48; g <= 48; g += 8) {
      b.beginPath();
      b.moveTo(X(g), 0);
      b.lineTo(X(g), S);
      b.moveTo(0, Y(g));
      b.lineTo(S, Y(g));
      b.stroke();
    }
    for (const box of ARENA.boxes) {
      const [x0, , z0] = box.min;
      const [x1, , z1] = box.max;
      const fill = box.kind === 'platform' ? 'rgba(120,170,190,0.22)' : box.kind === 'wall' || box.kind === 'gate' ? 'rgba(150,200,215,0.42)' : 'rgba(120,150,165,0.32)';
      b.fillStyle = fill;
      b.fillRect(X(x0), Y(z1), (x1 - x0) * k, (z1 - z0) * k);
    }
    const routes = Object.values(ARENA.routes).map(({ gate, points }) => {
      const path = new Path2D();
      path.moveTo(X(points[0].x), Y(points[0].z));
      for (const p of points.slice(1)) path.lineTo(X(p.x), Y(p.z));
      return { gate, path, x: X(points[0].x), y: Y(points[0].z) };
    });
    // Reactor
    b.strokeStyle = 'rgba(80,230,245,0.9)';
    b.lineWidth = 1.5 * dpr;
    b.beginPath();
    b.arc(X(ARENA.reactor.x), Y(ARENA.reactor.z), ARENA.reactor.radius * k, 0, Math.PI * 2);
    b.stroke();
    b.fillStyle = 'rgba(80,230,245,0.35)';
    b.fill();

    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(base, 0, 0);
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      // Match the floor guides so the map points to the same incoming lanes.
      ctx.strokeStyle = '#ff9a42';
      ctx.fillStyle = '#ff9a42';
      ctx.lineWidth = 1.6 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.lineDashOffset = -((now * 0.009) % 7) * dpr;
      for (const route of routes) {
        const activity = game.gateActivity(route.gate);
        ctx.globalAlpha = 0.16 + activity * 0.68;
        ctx.stroke(route.path);
        ctx.globalAlpha = 0.27 + activity * (0.45 + pulse * 0.24);
        ctx.beginPath();
        ctx.arc(route.x, route.y, (2.4 + activity * 0.9) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      // Turrets: cyan diamonds with range hint
      ctx.fillStyle = '#5ff0ff';
      for (const t of game.turrets.turrets) {
        const x = X(t.pos.x);
        const y = Y(t.pos.z);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-2.6 * dpr, -2.6 * dpr, 5.2 * dpr, 5.2 * dpr);
        ctx.restore();
      }
      // Hostiles
      for (const e of game.enemies.active) {
        if (!e.alive) continue;
        const x = X(e.pos.x);
        const y = Y(e.pos.z);
        const boss = e.def.role === 'boss';
        const r = (boss ? 7 : e.def.radius > 1.1 ? 4 : e.kind === 'rusher' || e.kind === 'pylon' ? 2.2 : 3) * dpr;
        ctx.fillStyle = boss ? '#ff2a2a' : e.def.role === 'hvt' ? '#ffd25a' : e.def.role === 'support' ? (e.kind === 'pylon' ? '#b48cff' : '#5effb0') : e.elite ? '#ffffff' : e.kind === 'rusher' ? '#ffcf4a' : e.kind === 'artillery' ? '#ff3a7a' : '#ff5a2a';
        ctx.globalAlpha = 0.25 + 0.25 * pulse;
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Loot: rarity-coloured squares (rare+ pulse)
      for (const p of game.loot.pickups) {
        const r = rarity(p.item.rarity);
        const x = X(p.ground.x);
        const y = Y(p.ground.z);
        const sz = (r.index >= 2 ? 3.2 : 2.2) * dpr;
        ctx.globalAlpha = r.index >= 2 ? 0.6 + 0.4 * pulse : 0.75;
        ctx.fillStyle = r.color;
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
      }
      // Player: view cone + arrow
      const pp = game.player.position;
      const yaw = game.player.yaw;
      const px = X(pp.x);
      const py = Y(pp.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(yaw);
      const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, 42 * dpr);
      cone.addColorStop(0, 'rgba(230,250,255,0.28)');
      cone.addColorStop(1, 'rgba(230,250,255,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 42 * dpr, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6 * dpr);
      ctx.lineTo(4.2 * dpr, 4.5 * dpr);
      ctx.lineTo(0, 2.4 * dpr);
      ctx.lineTo(-4.2 * dpr, 4.5 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  const hostiles = useHud((s) => s.enemiesLeft);
  const phase = useHud((s) => s.phase);
  return (
    <div className="radar panel-frame">
      <div className="radar-head">
        <span>TACTICAL MAP</span>
        <span className={phase === 'combat' ? 'hot' : ''}>{phase === 'combat' ? `${hostiles} CONTACTS` : 'SECTOR CLEAR'}</span>
      </div>
      <div className="radar-body">
        <canvas ref={ref} style={{ width: RADAR_PX, height: RADAR_PX }} />
        <span className="north">N</span>
        <div className="sweep" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- panels

function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function TopCenter() {
  const wave = useHud((s) => s.wave);
  const phase = useHud((s) => s.phase);
  const timer = useHud((s) => Math.ceil(s.phaseTimer));
  const left = useHud((s) => s.enemiesLeft);
  const reactor = useHud((s) => s.reactorHp / s.reactorMax);
  const hit = useHud((s) => s.reactorUnderAttack);
  const phaseText = phase === 'prep' ? 'PREPARATION' : phase === 'combat' ? 'ENGAGED' : 'SECURED';
  const tone = reactor < 0.3 ? 'red' : reactor < 0.6 ? 'amber' : 'cyan';
  return (
    <div className={`top-center ${hit ? 'hit' : ''} ${reactor < 0.3 ? 'critical' : ''}`}>
      <div className="wave-row">
        <div className="wave-tag">
          <span>WAVE</span>
          <b>{String(wave).padStart(2, '0')}</b>
        </div>
        <div className={`phase-pill ${phase}`}>
          <i />
          {phaseText}
          <em>{phase === 'prep' ? fmtClock(timer) : phase === 'combat' ? `${left} HOSTILE${left === 1 ? '' : 'S'}` : '—'}</em>
        </div>
      </div>
      <div className="reactor">
        <div className="reactor-label">
          <span>REACTOR INTEGRITY</span>
          {hit && <span className="alert">▲ UNDER ATTACK</span>}
          <b>{Math.ceil(reactor * 100)}%</b>
        </div>
        <SegBar value={reactor} tone={tone} segments={30} className="big" />
      </div>
    </div>
  );
}

function Cores() {
  const cores = useHud((s) => s.cores);
  const [gains, setGains] = useState<{ id: number; v: number }[]>([]);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('coresGained', (v) => {
      const my = ++id;
      setBump(my);
      setGains((g) => [...g.slice(-3), { id: my, v }]);
      setTimeout(() => setGains((g) => g.filter((x) => x.id !== my)), 1000);
    });
  }, []);
  return (
    <div className="cores panel-frame">
      <svg className="gem" viewBox="0 0 24 24" width="26" height="26">
        <path d="M12 2 L21 9 L12 22 L3 9 Z" />
        <path d="M3 9 H21 M12 2 L8 9 L12 22 L16 9 Z" className="facet" />
      </svg>
      <div className="cores-text">
        <div key={bump} className="value">
          {Math.floor(cores)}
        </div>
        <div className="label">CORES</div>
      </div>
      <div className="gains">
        {gains.map((g) => (
          <div key={g.id} className="gain">
            +{g.v}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Threat tier, salvage (unsecured vs secured) and checkpoint progress. */
function RunPanel() {
  const run = useHud((s) => s.run);
  const cargo = useHud((s) => s.cargo);
  const cargoMax = useHud((s) => s.cargoMax);
  const [gains, setGains] = useState<{ id: number; v: number }[]>([]);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('salvageGained', (v) => {
      const my = ++id;
      setGains((g) => [...g.slice(-2), { id: my, v }]);
      setTimeout(() => setGains((g) => g.filter((x) => x.id !== my)), 900);
    });
  }, []);
  const [cgains, setCgains] = useState<{ id: number; v: number; c: boolean }[]>([]);
  useEffect(() => {
    let id = 0;
    const push = (v: number, c: boolean) => {
      if (!v) return;
      const my = ++id;
      setCgains((g) => [...g.slice(-2), { id: my, v, c }]);
      setTimeout(() => setCgains((g) => g.filter((x) => x.id !== my)), 1100);
    };
    const a = uiEvents.on('creditsGained', (v) => push(v, false));
    const b = uiEvents.on('componentsGained', (v) => push(v, true));
    return () => {
      a();
      b();
    };
  }, []);
  if (!run) return null;
  const tier = getTier(run.tier);
  return (
    <div className="run-panel panel-frame">
      <div className="rp-head">
        <span className="rp-tier">TIER {tier.roman}</span>
        <span className="rp-name">{tier.name}</span>
      </div>
      <div className="rp-row">
        <span>SALVAGE</span>
        <b className="unsec">{run.salvageUnsecured}</b>
        <em>UNSECURED</em>
        <div className="gains">
          {gains.map((g) => (
            <div key={g.id} className="gain">
              +{g.v}
            </div>
          ))}
        </div>
      </div>
      <div className="rp-row">
        <span />
        <b className="sec">{run.salvageSecured}</b>
        <em>SECURED</em>
      </div>
      <div className="rp-row">
        <span>CREDITS</span>
        <b className="unsec">{run.creditsUnsecured}</b>
        <em>
          + {run.creditsSecured} SEC · COMP <b className="unsec">{run.componentsUnsecured}</b>/{run.componentsSecured}
        </em>
        <div className="gains">
          {cgains.map((g) => (
            <div key={g.id} className={`gain ${g.c ? 'comp' : 'cr'}`}>
              +{g.v}
              {g.c ? ' COMP' : ' CR'}
            </div>
          ))}
        </div>
      </div>
      <div className="rp-row">
        <span>CARGO</span>
        <b className="unsec">{cargo}</b>
        <em>/ {cargoMax} ITEMS · <kbd>I</kbd></em>
      </div>
      <div className={`rp-cp ${run.checkpointOpen ? 'open' : ''}`}>{run.checkpointOpen ? <>CHECKPOINT · <kbd>H</kbd> RETURN TO HQ</> : `CHECKPOINT AT WAVE ${run.nextCheckpoint}`}</div>
    </div>
  );
}

function PlayerPanel() {
  const hp = useHud((s) => s.playerHp);
  const max = useHud((s) => s.playerMax);
  const sh = useHud((s) => s.playerShield);
  const shMax = useHud((s) => s.playerShieldMax);
  const charges = useHud((s) => s.dashCharges);
  const dashMax = useHud((s) => s.dashMax);
  const rech = useHud((s) => s.dashRecharge);
  const f = hp / max;
  return (
    <div className={`bottom-left panel-frame ${f < 0.35 ? 'low' : ''}`}>
      <div className="vitals">
        <div className="hp-num">
          <b>{Math.ceil(hp)}</b>
          <span>/{Math.round(max)}</span>
        </div>
        <div className="vitals-right">
          <div className="label">DRONE INTEGRITY</div>
          <SegBar value={f} tone={f < 0.35 ? 'red' : 'white'} segments={10} className="big" />
        </div>
      </div>
      {shMax > 0 && (
        <div className="shield-row">
          <span className="label">SHIELD</span>
          <SegBar value={sh / shMax} tone="cyan" segments={12} />
          <b>{Math.ceil(sh)}</b>
        </div>
      )}
      <div className="dash">
        <span className="label">
          DASH <Key k="SHIFT" />
        </span>
        <div className="chevrons">
          {Array.from({ length: dashMax }, (_, i) => (
            <span key={i} className={`chev ${i < charges ? 'full' : ''}`}>
              {i === charges && <i style={{ transform: `scaleX(${rech})` }} />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CenterPanel() {
  const tac = useHud((s) => s.tactical);
  const active = useHud((s) => s.tacticalActive);
  const min = useHud((s) => s.tacticalMin);
  const build = useHud((s) => s.buildMode);
  const valid = useHud((s) => s.buildValid);
  const msg = useHud((s) => s.buildMessage);
  const cost = useHud((s) => s.buildCost);
  const cores = useHud((s) => s.cores);
  const inspect = useHud((s) => s.inspect);
  const m5 = useHud((s) => s.m5);
  return (
    <div className="bottom-center">
      {build && (
        <div className={`build-panel panel-frame ${valid ? 'ok' : 'bad'}`}>
          <div className="bp-head">
            <span className="bp-icon">◈</span>
            <span className="bp-title">{m5?.template ?? 'TOWER'}</span>
            <span className={cores >= cost ? 'cost' : 'cost bad'}>◆ {cost}</span>
          </div>
          <div className="status">
            <i />
            {msg}
          </div>
          <div className="keys">
            <Key k="C" /> weapon <Key k="V" /> core <Key k="N" /> mod <Key k="M" /> base · <Key k="LMB" /> place <Key k="RMB" /> cancel {active ? <span className="rapid">RAPID PLACEMENT</span> : <><Key k="Q" /> tactical</>}
          </div>
        </div>
      )}
      {!build && inspect && (
        <div className="inspect-panel panel-frame">
          <div className="bp-head">
            <span className="bp-icon">◈</span>
            <span className="bp-title">{inspect.name}</span>
          </div>
          <div className="stat-row">
            <div>
              <b>{inspect.kills}</b>
              <span>KILLS</span>
            </div>
            <div>
              <b>{inspect.damage}</b>
              <span>DAMAGE</span>
            </div>
            <div>
              <b>◆{inspect.refund}</b>
              <span>REFUND</span>
            </div>
          </div>
          {inspect.card && (
            <div className="tc" data-testid="tower-card">
              <div className="tc-line"><span>L{inspect.card.level}/{inspect.card.maxLevel} · {inspect.card.base}</span><b>{inspect.card.st.dps.toFixed(0)} DPS</b>{inspect.card.empowered && <em className="emp">EMPOWERED</em>}</div>
              {inspect.card.slots.map((sl) => (
                <div key={sl.slot} className="tc-line">
                  <span>{sl.slot.toUpperCase()}</span>
                  <b>{sl.name}</b>
                  {sl.next ? <small>→ {sl.next} ◆{sl.nextCost}</small> : <small>—</small>}
                </div>
              ))}
              <div className="keys">
                <Key k="R" /> level {inspect.card.level < inspect.card.maxLevel ? `◆${inspect.card.levelCost}` : 'MAX'} <Key k="C" /> weapon <Key k="V" /> core <Key k="N" /> modifier
              </div>
              {inspect.edit && <div className="tc-warn">{inspect.edit}</div>}
            </div>
          )}
          <div className="keys">
            Hold <Key k="X" /> to recycle
          </div>
          {inspect.recycle > 0 && <SegBar value={inspect.recycle} tone="amber" segments={12} />}
        </div>
      )}
      <div className={`tactical ${active ? 'active' : ''} ${tac < min && !active ? 'low' : ''}`}>
        <div className="tac-label">
          <Key k="Q" />
          <span>TACTICAL</span>
          <em>{active ? 'TIME DILATED' : tac < min ? 'RECHARGING' : 'READY'}</em>
        </div>
        <SegBar value={tac} tone="violet" segments={24} marker={min} />
      </div>
    </div>
  );
}

function WeaponPanel() {
  const name = useHud((s) => s.weaponName);
  const heat = useHud((s) => s.heat);
  const hot = useHud((s) => s.overheated);
  const build = useHud((s) => s.buildMode);
  return (
    <div className={`bottom-right ${build ? 'stowed' : ''}`}>
      <div className="weapon-card panel-frame">
        <div className="wc-head">
          <span className="weapon">{name}</span>
          <span className="ammo">∞</span>
        </div>
        <SegBar value={heat} tone={hot ? 'red' : heat > 0.7 ? 'amber' : 'heat'} segments={20} />
        <div className={`label heat-label ${hot ? 'warn' : ''}`}>{hot ? 'OVERHEATED · VENTING' : `HEAT ${Math.round(heat * 100)}%`}</div>
      </div>
      <div className="slots">
        <span className={!build ? 'on' : ''}>
          <Key k="1" /> REPEATER
        </span>
        <span className={build ? 'on' : ''}>
          <Key k="2" /> SENTINEL
        </span>
      </div>
    </div>
  );
}

export function Banner() {
  const [b, setB] = useState<(BannerEvent & { id: number }) | null>(null);
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    const off = uiEvents.on('banner', (e) => {
      setB({ ...e, id: ++id });
      clearTimeout(timer);
      timer = setTimeout(() => setB(null), 3000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  if (!b) return null;
  return (
    <div key={b.id} className={`banner ${b.tone}`}>
      <div className="rule" />
      <div className="t" data-text={b.title}>
        {b.title}
      </div>
      {b.sub && <div className="s">{b.sub}</div>}
      <div className="rule" />
    </div>
  );
}

function Hint() {
  const hint = useHud((s) => s.hint);
  return hint ? (
    <div key={hint} className="hint">
      <span className="hint-tag">INTEL</span>
      {hint}
    </div>
  ) : null;
}

function Respawn() {
  const t = useHud((s) => s.respawnIn);
  if (t <= 0) return null;
  return (
    <div className="respawn">
      <div className="glitch" data-text="DRONE DISABLED">
        DRONE DISABLED
      </div>
      <div className="reboot">
        REBOOTING <b>{t.toFixed(1)}s</b>
      </div>
      <small>Turrets remain online</small>
    </div>
  );
}

export function Perf() {
  const p = useHud((s) => s.perf);
  if (!p) return null;
  return (
    <div className="perf">
      {p.fps} FPS · {p.enemies} enemies · {p.towers ?? 0} towers · {p.projectiles ?? 0} proj · {p.draws} draws · {p.particles} particles
      <br />
      fx queue {p.pending ?? 0} · {p.effects ?? 0} effects · {p.triggers ?? 0} triggers/s · {p.statuses ?? 0} statuses · dropped {p.dropped ?? 0} · dps player {p.dpsPlayer ?? 0} / tower {p.dpsTower ?? 0}
      <br />
      sim {p.frameMs ?? 0} ms · AI {p.aiMs ?? 0} ms · telegraphs {p.telegraphs ?? 0} · ordnance {p.ordnance ?? 0} · wave {p.wave} · tier {p.tier} · event {p.event} · boss {p.boss} · budget {p.budget} · spawn queue {p.spawnQueue} · elites {p.elites} · hp ×{p.hpMult} · dmg ×{p.dmgMult}
      {p.dev ? ' · DEV SESSION' : ''}
    </div>
  );
}
