import { currencyTooltip } from '../../economy/currencies';
import { ElementTag } from '../ElementTag';
import { useEffect, useRef, useState } from 'react';
import { getTier } from '../../progression/tiers';
import { type BannerEvent, uiEvents, useHud } from '../store';
import { BoundKey, Key, SegBar, fmtClock } from './widgets';

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
    <div ref={ref} className="overlays" style={{ ['--low' as string]: low.toFixed(3) }}>
      <div className={`tactical-tint ${tactical ? 'on' : ''}`}>
        <div className="tac-frame" />
      </div>
      <div className="damage-vignette" />
      <div className={`lowhp ${low > 0 ? 'on' : ''}`} />
    </div>
  );
}

export function TopCenter() {
  const wave = useHud((s) => s.wave);
  const phase = useHud((s) => s.phase);
  const timer = useHud((s) => Math.ceil(s.phaseTimer));
  const left = useHud((s) => s.enemiesLeft);
  const reactor = useHud((s) => s.reactorHp / s.reactorMax);
  const hit = useHud((s) => s.reactorUnderAttack);
  const survival = useHud((s) => s.mode === 'survival');
  const hull = useHud((s) => s.playerHp / Math.max(1, s.playerMax));
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
      {survival ? (
        <div className="reactor survival-mode" data-testid="survival-banner">
          <div className="reactor-label">
            <span>SURVIVAL · HUNTED · ONE LIFE</span>
            <b>{Math.ceil(hull * 100)}%</b>
          </div>
          <SegBar value={hull} tone={hull < 0.3 ? 'red' : hull < 0.6 ? 'amber' : 'white'} segments={30} className="big" />
        </div>
      ) : (
      <div className="reactor">
        <div className="reactor-label">
          <span>REACTOR INTEGRITY</span>
          {hit && <span className="alert">▲ UNDER ATTACK</span>}
          <b>{Math.ceil(reactor * 100)}%</b>
        </div>
        <SegBar value={reactor} tone={tone} segments={30} className="big" />
      </div>
      )}
    </div>
  );
}

export function Cores() {
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
export function RunPanel() {
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
        <span>Salvage at risk</span><b className="unsec">{run.salvageUnsecured}</b>
        <div className="gains">{gains.map(g => <div key={g.id} className="gain">+{g.v}</div>)}</div>
      </div>
      {run.salvageSecured > 0 && <div className="rp-row"><span>Banked salvage</span><b className="sec">{run.salvageSecured}</b></div>}
      {run.creditsUnsecured + run.creditsSecured > 0 && <div className="rp-row"><span>Credits <small>held / banked</small></span><b>{run.creditsUnsecured} / {run.creditsSecured}</b></div>}
      {(run.xpUnsecured ?? 0) + (run.xpSecured ?? 0) > 0 && <div className="rp-row res-xp" title={currencyTooltip('xp')}><span>Warden XP <small>at risk / banked</small></span><b data-testid="run-xp">{run.xpUnsecured ?? 0} / {run.xpSecured ?? 0}</b></div>}
      {run.componentsUnsecured + run.componentsSecured > 0 && <div className="rp-row"><span>Components <small>held / banked</small></span><b>{run.componentsUnsecured} / {run.componentsSecured}</b></div>}
      <div className="rp-row">
        <span>Cargo <BoundKey action="inventory" /></span><b>{cargo} / {cargoMax}</b>
        <div className="gains">{cgains.map(g => <div key={g.id} className={`gain ${g.c ? 'comp' : 'cr'}`}>+{g.v} {g.c ? 'COMP' : 'CR'}</div>)}</div>
      </div>
      <div className={`rp-cp ${run.checkpointOpen ? 'open' : ''}`}>{run.checkpointOpen ? <>CHECKPOINT · <BoundKey action="checkpoint" /> RETURN TO HQ</> : `Checkpoint · Wave ${run.nextCheckpoint}`}</div>
    </div>
  );
}

export function PlayerPanel() {
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
          DASH <BoundKey action="dash" />
        </span>
        <div className="chevrons">
          {Array.from({ length: dashMax }, (_, i) => (
            <span key={i} className={`chev ${i < charges ? 'full' : ''}`}>
              {i === charges && <i style={{ transform: `scaleX(${rech})` }} />}
            </span>
          ))}
        </div>
      </div>
      <MoveRow />
    </div>
  );
}

/** Grapple and ground pound cooldowns (slide and wall-run have no cooldown worth showing). */
function MoveRow() {
  const m = useHud((s) => s.moves);
  const chip = (label: string, action: string, cd: number, max: number, on: boolean) => (
    <span className={`mv-chip ${on ? 'active' : cd > 0 ? 'cooling' : 'ready'}`}>
      <BoundKey action={action} /> {label}
      <i style={{ transform: `scaleX(${max > 0 ? Math.max(0, Math.min(1, 1 - cd / max)) : 1})` }} />
    </span>
  );
  return (
    <div className="move-row">
      {chip('GRAPPLE', 'grapple', m.grapple, m.grappleMax, m.state === 'grapple')}
      {chip('POUND', 'slide', m.pound, m.poundMax, m.state === 'pound')}
      {m.state === 'slide' && <b className="mv-state">SLIDE</b>}
      {m.state === 'wall' && <b className="mv-state">WALL-RUN</b>}
    </div>
  );
}

export function CenterPanel() {
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
      <div className={`tactical ${active ? 'active' : ''} ${tac < min && !active ? 'low' : ''}`}>
        <div className="tac-label">
          <BoundKey action="tactical" />
          <span>TACTICAL</span>
          <em>{active ? 'TIME DILATED' : tac < min ? 'RECHARGING' : 'READY'}</em>
        </div>
        <SegBar value={tac} tone="violet" segments={24} marker={min} />
      </div>
    </div>
  );
}

const ABILITY_KEY = { ability: 'RMB', ability2: 'F', ultimate: 'T' } as const;

/** Ability I/II cooldowns and the ultimate charge, stacked above the weapon card. */
function AbilityBar() {
  const rows = useHud((s) => s.abilities);
  if (!rows.length) return null;
  return (
    <div className="ability-bar">
      {rows.map((r) => {
        const ult = r.slot === 'ultimate';
        const fill = ult ? r.cd : r.max > 0 ? 1 - r.cd / r.max : 1;
        const state = r.active > 0 ? 'active' : r.ready ? 'ready' : 'cooling';
        return (
          <div key={r.slot} className={`ab-slot ${ult ? 'ult' : ''} ${state}`} title={r.name}>
            <kbd>{ABILITY_KEY[r.slot]}</kbd>
            <span className="ab-name">{r.name}</span>
            <span className="ab-state">{r.active > 0 ? `${r.active.toFixed(1)}s` : r.ready ? 'READY' : ult ? `${Math.floor(r.cd * 100)}%` : `${r.cd.toFixed(1)}s`}</span>
            <i className="ab-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, fill))})` }} />
          </div>
        );
      })}
    </div>
  );
}

export function WeaponPanel() {
  const name = useHud((s) => s.weaponName);
  const holster = useHud((s) => s.holster);
  const element = useHud((s) => s.weaponElement);
  const aff = useHud((s) => s.weaponAff);
  const heat = useHud((s) => s.heat);
  const hot = useHud((s) => s.overheated);
  const build = useHud((s) => s.buildMode);
  const survival = useHud((s) => s.mode === 'survival');
  return (
    <div className={`bottom-right ${build ? 'stowed' : ''}`}>
      <AbilityBar />
      <div className="weapon-card panel-frame">
        <div className="wc-head">
          <span className="weapon">{name}</span>
          <ElementTag element={element} />
          {aff !== 0 && <span className={`el-aff ${aff > 0 ? 'weak' : 'resist'}`} title={aff > 0 ? 'This sector\'s faction is weak to this element' : 'This sector\'s faction resists this element'}>{aff > 0 ? '▲ WEAK' : '▼ RESIST'}</span>}
          <span className="ammo">∞</span>
        </div>
        <SegBar value={heat} tone={hot ? 'red' : heat > 0.7 ? 'amber' : 'heat'} segments={20} />
        <div className={`label heat-label ${hot ? 'warn' : ''}`}>{hot ? 'OVERHEATED · VENTING' : `HEAT ${Math.round(heat * 100)}%`}</div>
        {holster && (
          <div className={`wc-holster ${holster.overheated ? 'warn' : ''}`}>
            <BoundKey action="swap" />
            <span className="wh-name">{holster.secondary ? 'SECONDARY' : 'PRIMARY'} · {holster.name}</span>
            <ElementTag element={holster.element} />
            {holster.aff !== 0 && <span className={`el-aff ${holster.aff > 0 ? 'weak' : 'resist'}`}>{holster.aff > 0 ? '▲' : '▼'}</span>}
            <span className="wh-heat">{holster.overheated ? 'VENTING' : holster.heat > 0.01 ? `${Math.round(holster.heat * 100)}%` : 'READY'}</span>
          </div>
        )}
      </div>
      <div className="slots">
        <span className={!build ? 'on' : ''}>
          <Key k="1" /> WEAPON
        </span>
        {!survival && (
          <span className={build ? 'on' : ''}>
            <Key k="2" /> BUILD
          </span>
        )}
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
  const t = useHud((s) => s.respawnIn);
  const survival = useHud((s) => s.mode === 'survival');
  const team = useHud((s) => !!s.coop);
  if (t <= 0) return null;
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
