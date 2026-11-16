import { useEffect, useRef, useState } from 'react';
import type { Game } from '../core/Game';
import { type BannerEvent, type HitKind, uiEvents, useHud } from './store';

export function Hud({ game }: { game: Game }) {
  return (
    <div className="hud">
      <Overlays />
      <Crosshair />
      <Hitmarker />
      <DamageNumbers game={game} />
      <TopCenter />
      <Cores />
      <PlayerPanel />
      <CenterPanel />
      <WeaponPanel />
      <Banner />
      <Hint />
      <Respawn />
      <Perf />
    </div>
  );
}

function Bar({ value, tone, marker }: { value: number; tone: string; marker?: number }) {
  return (
    <div className="bar">
      <div className={`fill ${tone}`} style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
      {marker !== undefined && <div className="tick" style={{ left: `${marker * 100}%` }} />}
    </div>
  );
}

function Overlays() {
  const tactical = useHud((s) => s.tacticalActive);
  const [hurt, setHurt] = useState(0);
  const hp = useHud((s) => s.playerHp / s.playerMax);
  useEffect(() => {
    let raf = 0;
    let level = 0;
    const off = uiEvents.on('hurt', (v) => {
      level = Math.min(1, level + 0.4 + v);
      setHurt(level);
    });
    const tick = () => {
      if (level > 0) {
        level = Math.max(0, level - 0.03);
        setHurt(level);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);
  const low = hp < 0.35 ? (0.35 - hp) * 1.6 : 0;
  return (
    <>
      <div className={`tactical-tint ${tactical ? 'on' : ''}`} />
      <div className="damage-vignette" style={{ opacity: Math.min(1, hurt + low) }} />
    </>
  );
}

function Crosshair() {
  const spread = useHud((s) => s.spread);
  const build = useHud((s) => s.buildMode);
  const overheated = useHud((s) => s.overheated);
  const g = Math.round(spread);
  return (
    <div className={`crosshair ${build ? 'build' : ''} ${overheated ? 'hot' : ''}`}>
      <span className="ch" style={{ transform: `translate(-50%, ${-g - 8}px)` }} />
      <span className="ch" style={{ transform: `translate(-50%, ${g}px)` }} />
      <span className="ch h" style={{ transform: `translate(${-g - 8}px, -50%)` }} />
      <span className="ch h" style={{ transform: `translate(${g}px, -50%)` }} />
      <span className="dot" />
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
      timer = setTimeout(() => setState(null), kind === 'kill' ? 260 : 140);
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
    </div>
  );
}

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
      live.push({ el, x: e.x, y: e.y, z: e.z, t: 0, dx: (Math.random() - 0.5) * 30 });
    });
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (let i = live.length - 1; i >= 0; i--) {
        const n = live[i];
        n.t += dt;
        const life = 0.75;
        if (n.t >= life) {
          n.el.style.display = 'none';
          pool.push(n.el);
          live.splice(i, 1);
          continue;
        }
        const p = game.project(n.x, n.y + 0.4 + n.t * 1.2, n.z);
        if (!p) {
          n.el.style.opacity = '0';
          continue;
        }
        const pop = n.t < 0.08 ? 1 + (0.08 - n.t) * 6 : 1;
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

function TopCenter() {
  const wave = useHud((s) => s.wave);
  const phase = useHud((s) => s.phase);
  const timer = useHud((s) => Math.ceil(s.phaseTimer));
  const left = useHud((s) => s.enemiesLeft);
  const reactor = useHud((s) => s.reactorHp / s.reactorMax);
  const hit = useHud((s) => s.reactorUnderAttack);
  const phaseText = phase === 'prep' ? `PREPARATION · ${timer}s` : phase === 'combat' ? `${left} HOSTILES` : 'WAVE CLEARED';
  return (
    <div className="top-center">
      <div className="wave">
        WAVE <b>{wave}</b>
      </div>
      <div className={`phase ${phase}`}>{phaseText}</div>
      <div className={`reactor ${hit ? 'hit' : ''} ${reactor < 0.3 ? 'critical' : ''}`}>
        <div className="label">
          REACTOR <span>{Math.ceil(reactor * 100)}%</span>
        </div>
        <Bar value={reactor} tone={reactor < 0.3 ? 'red' : reactor < 0.6 ? 'amber' : 'cyan'} />
      </div>
    </div>
  );
}

function Cores() {
  const cores = useHud((s) => s.cores);
  const [gains, setGains] = useState<{ id: number; v: number }[]>([]);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('coresGained', (v) => {
      const my = ++id;
      setGains((g) => [...g.slice(-3), { id: my, v }]);
      setTimeout(() => setGains((g) => g.filter((x) => x.id !== my)), 900);
    });
  }, []);
  return (
    <div className="cores">
      <div className="value">
        <span className="gem">◆</span>
        {Math.floor(cores)}
      </div>
      <div className="label">CORES</div>
      {gains.map((g) => (
        <div key={g.id} className="gain">
          +{g.v}
        </div>
      ))}
    </div>
  );
}

function PlayerPanel() {
  const hp = useHud((s) => s.playerHp);
  const max = useHud((s) => s.playerMax);
  const charges = useHud((s) => s.dashCharges);
  const dashMax = useHud((s) => s.dashMax);
  const rech = useHud((s) => s.dashRecharge);
  return (
    <div className="bottom-left">
      <div className="label">
        INTEGRITY <b>{Math.ceil(hp)}</b>
      </div>
      <Bar value={hp / max} tone={hp / max < 0.35 ? 'red' : 'white'} />
      <div className="pips">
        <span className="label">DASH</span>
        {Array.from({ length: dashMax }, (_, i) => (
          <span key={i} className={`pip ${i < charges ? 'full' : ''}`}>
            {i === charges && <i style={{ transform: `scaleX(${rech})` }} />}
          </span>
        ))}
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
  return (
    <div className="bottom-center">
      {build && (
        <div className={`build-panel ${valid ? 'ok' : 'bad'}`}>
          <div className="title">
            SENTINEL TURRET <span className={cores >= cost ? 'cost' : 'cost bad'}>◆ {cost}</span>
          </div>
          <div className="status">{msg}</div>
          <div className="keys">
            <b>LMB</b> place <b>RMB</b> cancel {active ? <>· rapid placement active</> : <><b>Q</b> tactical</>}
          </div>
        </div>
      )}
      {!build && inspect && (
        <div className="inspect-panel">
          <div className="title">{inspect.name}</div>
          <div className="row">
            {inspect.kills} kills · {inspect.damage} damage
          </div>
          <div className="keys">
            Hold <b>X</b> to recycle (+◆{inspect.refund})
          </div>
          {inspect.recycle > 0 && <Bar value={inspect.recycle} tone="amber" />}
        </div>
      )}
      <div className={`tactical ${active ? 'active' : ''} ${tac < min && !active ? 'low' : ''}`}>
        <div className="label">
          TACTICAL <b>Q</b> {active ? '· TIME DILATED' : tac < min ? '· RECHARGING' : ''}
        </div>
        <Bar value={tac} tone="violet" marker={min} />
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
      <div className="weapon">{name}</div>
      <Bar value={heat} tone={hot ? 'red' : heat > 0.7 ? 'amber' : 'heat'} />
      <div className={`label ${hot ? 'warn' : ''}`}>{hot ? 'OVERHEATED · VENTING' : 'HEAT'}</div>
      <div className="slots">
        <span className={!build ? 'on' : ''}>
          <b>1</b> REPEATER
        </span>
        <span className={build ? 'on' : ''}>
          <b>2</b> SENTINEL
        </span>
      </div>
    </div>
  );
}

function Banner() {
  const [b, setB] = useState<(BannerEvent & { id: number }) | null>(null);
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    const off = uiEvents.on('banner', (e) => {
      setB({ ...e, id: ++id });
      clearTimeout(timer);
      timer = setTimeout(() => setB(null), 2600);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  if (!b) return null;
  return (
    <div key={b.id} className={`banner ${b.tone}`}>
      <div className="t">{b.title}</div>
      {b.sub && <div className="s">{b.sub}</div>}
    </div>
  );
}

function Hint() {
  const hint = useHud((s) => s.hint);
  return hint ? <div className="hint">{hint}</div> : null;
}

function Respawn() {
  const t = useHud((s) => s.respawnIn);
  if (t <= 0) return null;
  return (
    <div className="respawn">
      DRONE DISABLED
      <small>Rebooting in {t.toFixed(1)}s · turrets still active</small>
    </div>
  );
}

function Perf() {
  const p = useHud((s) => s.perf);
  if (!p) return null;
  return (
    <div className="perf">
      {p.fps} FPS · {p.enemies} enemies · {p.draws} draws · {p.particles} particles
    </div>
  );
}
