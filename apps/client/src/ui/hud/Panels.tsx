import { useEffect, useRef, useState } from 'react';
import { type BannerEvent, uiEvents } from '@riftwarden/game/ui/store';
import { useHud } from '../useHud';
import { BoundKey, Key, SegBar } from './widgets';
import { LiveBar, LiveText, useLiveStyle } from './live';
import type { HudState } from '@riftwarden/game/ui/store';

export function Overlays() {
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
    <div ref={ref} className="overlays fixed inset-[0] [--hurt:0] [--low:0]" style={{ ['--low' as string]: low.toFixed(3) }}>
      <div className={`tactical-tint ${tactical ? 'on' : ''}`}>
        <div className="absolute inset-[18px] [border:1px_solid_rgba(167,123,255,0.35)] [clip-path:polygon(0_0,60px_0,60px_1px,1px_1px,1px_60px,0_60px,0_100%,60px_100%,60px_calc(100%_-_1px),1px_calc(100%_-_1px),1px_calc(100%_-_60px),0_calc(100%_-_60px),0_0,100%_0,100%_60px,calc(100%_-_1px)_60px,calc(100%_-_1px)_1px,calc(100%_-_60px)_1px,calc(100%_-_60px)_0,100%_0,100%_100%,calc(100%_-_60px)_100%,calc(100%_-_60px)_calc(100%_-_1px),calc(100%_-_1px)_calc(100%_-_1px),calc(100%_-_1px)_calc(100%_-_60px),100%_calc(100%_-_60px))]" />
      </div>
      <div className="fixed inset-[0] [opacity:var(--hurt)] [background:radial-gradient(ellipse_at_center,transparent_45%,rgba(255,30,10,0.25)_75%,rgba(255,20,10,0.6)_100%)]" />
      <div className={`lowhp ${low > 0 ? 'on' : ''}`} />
    </div>
  );
}

/** Grapple and ground pound cooldowns (slide and wall-run have no cooldown worth showing). */
function MoveChip({ label, action, kind }: { label: string; action: string; kind: 'grapple' | 'pound' }) {
  const max = (s: HudState) => (kind === 'grapple' ? s.moves.grappleMax : s.moves.poundMax);
  const cd = (s: HudState) => (kind === 'grapple' ? s.moves.grapple : s.moves.pound);
  const state = useHud((s) => (s.moves.state === kind ? 'active' : cd(s) > 0 ? 'cooling' : 'ready'));
  const fill = useLiveStyle((s) => (max(s) > 0 ? Math.max(0, Math.min(1, 1 - cd(s) / max(s))) : 1), (st, v) => (st.transform = `scaleX(${v})`));
  return (
    <span className={`mv-chip ${state}`}>
      <BoundKey action={action} /> {label}
      <i ref={fill} />
    </span>
  );
}

export function MoveRow() {
  const state = useHud((s) => s.moves.state);
  const contextual = useHud((s) => s.phase === 'combat' && !s.buildMode);
  const ready = useHud((s) => s.moves.grapple <= 0 && s.moves.pound <= 0);
  if (contextual && ready && !state) return null;
  return (
    <div className="movement-row flex gap-[6px] items-center mt-[6px] text-[10px] tracking-[0.08em]">
      <MoveChip label="GRAPPLE" action="grapple" kind="grapple" />
      <MoveChip label="POUND" action="slide" kind="pound" />
      {state === 'slide' && <b className="mv-state">SLIDE</b>}
      {state === 'wall' && <b className="mv-state">WALL-RUN</b>}
    </div>
  );
}

/** Conditional affixes: one chip per condition the gear uses, lit while it holds (nothing without conditional gear). */
export function CondRow() {
  const key = useHud((s) => s.conds.map((c) => `${c.id}:${c.on ? 1 : 0}:${c.tag}`).join(','));
  if (!key) return null;
  return (
    <div className="cond-row flex gap-[5px] items-center mt-[5px] text-[9px] tracking-[0.1em]" data-testid="cond-row">
      {key.split(',').map((k) => {
        const [id, on, tag] = k.split(':');
        return (
          <span key={id} className={`cond-chip ${on === '1' ? 'on' : ''}`} data-cond={id} title={on === '1' ? 'Conditional affixes active' : 'Conditional affixes waiting for this condition'}>
            {tag}
          </span>
        );
      })}
    </div>
  );
}

export function CenterPanel() {
  const active = useHud((s) => s.tacticalActive);
  const min = useHud((s) => s.tacticalMin);
  const low = useHud((s) => s.tactical < s.tacticalMin);
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
            <Key k="C" /> weapon <Key k="V" /> core <Key k="N" /> mod <Key k="M" /> base · <Key k="LMB" /> place <Key k="RMB" /> cancel {active ? <span className="rapid">RAPID PLACEMENT</span> : <><BoundKey action="tactical" /> tactical</>}
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
          {inspect.hp && (
            <div className={`tower-hp ${inspect.hp.wrecked ? 'wrecked' : ''}`} data-testid="tower-hp">
              <div className="tc-line">
                <span>{inspect.hp.wrecked ? 'WRECKED · NOT FIRING, NOT BLOCKING' : 'STRUCTURE'}</span>
                <b>{inspect.hp.wrecked ? '0' : inspect.hp.hp} / {inspect.hp.max}</b>
              </div>
              <SegBar value={inspect.hp.wrecked ? 0 : inspect.hp.hp / Math.max(1, inspect.hp.max)} tone={inspect.hp.wrecked || inspect.hp.hp < inspect.hp.max * 0.35 ? 'red' : 'cyan'} segments={16} />
              {inspect.hp.repair > 0 && (
                <div className="keys">
                  <BoundKey action="repair" /> {inspect.hp.wrecked ? 'rebuild' : 'repair'} ◆{inspect.hp.repair}
                </div>
              )}
            </div>
          )}
          <div className="keys">
            Hold <BoundKey action="recycle" /> to recycle
          </div>
          {inspect.recycle > 0 && <SegBar value={inspect.recycle} tone="amber" segments={12} />}
        </div>
      )}
      <div className={`tactical ${active ? 'active' : ''} ${low && !active ? 'low' : ''}`}>
        <div className="tac-label">
          <BoundKey action="tactical" />
          <span>TACTICAL</span>
          <em>{active ? 'TIME DILATED' : low ? 'RECHARGING' : 'READY'}</em>
        </div>
        <LiveBar select={(s) => ({ value: s.tactical, tone: 'violet' })} segments={24} marker={min} />
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

export function Hint() {
  const hint = useHud((s) => s.hint);
  return hint ? (
    <div key={hint} className="hint">
      <span className="hint-tag">INTEL</span>
      {hint}
    </div>
  ) : null;
}

export function Respawn() {
  const down = useHud((s) => s.respawnIn > 0);
  const survival = useHud((s) => s.mode === 'survival');
  const team = useHud((s) => !!s.coop);
  if (!down) return null;
  if (survival)
    return (
      <div className="respawn">
        <div className="glitch" data-text="DRONE LOST">
          DRONE LOST
        </div>
        <small>{team ? 'Survival: one life. Your team fights on; you rejoin when the node is secured.' : 'Survival: one life.'}</small>
      </div>
    );
  return (
    <div className="respawn">
      <div className="glitch" data-text="DRONE DISABLED">
        DRONE DISABLED
      </div>
      <div className="reboot">
        REBOOTING <LiveText as="b" select={(s) => `${s.respawnIn.toFixed(1)}s`} />
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
